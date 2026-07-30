/**
 * PanelService – hält Discord-Status-Panels aktuell (E4)
 *
 * Der Bot fragt **nichts** ab. Der StatusPoller ist seit E1 die einzige Instanz,
 * die Gameserver abfragt; ein zweiter Timer im Bot wäre eine weitere Wahrheit mit
 * eigenem Takt und eigener Sicht auf „online". Stattdessen schiebt das Dashboard:
 * Der Poller hat den Snapshot schon in der Hand, hier hängt sich der Push an den
 * Bot daneben.
 *
 * Zwei Bremsen halten Discords Rate-Limits ein:
 *   1. `min_interval_s` – nie zwei Edits desselben Panels näher beieinander.
 *   2. Hash über die angezeigten Felder – kein Edit, wenn sich nichts geändert
 *      hat. Sonst schreibt ein leerer Server rund um die Uhr identische Embeds.
 *
 * @module helpers/PanelService
 */

'use strict';

const { ServiceManager } = require('dunebot-core');
const { resolveStatusConfig } = require('./StatusSchema');
const { buildPanelPayload, payloadHash } = require('./PanelPresenter');

/** Wie lange die Server-Liste mit Panels zwischengespeichert wird */
const PANEL_INDEX_TTL_MS = 30_000;

/**
 * Server-IDs mit aktivem Panel – als Set im Speicher, weil `_intervalFor()` im
 * Poller synchron entscheiden muss und pro Tick über alle Server läuft.
 * @type {Set<string>}
 */
let panelServerIds = new Set();
let panelIndexLoadedAt = 0;
let panelIndexInFlight = null;

class PanelService {

    // ────────────────────────────────────────────────────────────
    // Index: welche Server haben überhaupt ein Panel?
    // ────────────────────────────────────────────────────────────

    /**
     * Synchrone Auskunft für den Poller.
     *
     * Bewusst ohne await: Ein Panel, das gerade angelegt wurde, wird höchstens
     * einen Tick später berücksichtigt – dafür kostet die Abfrage im Poller
     * nichts. `invalidateIndex()` verkürzt das Fenster beim Anlegen auf null.
     *
     * @param {number|string} serverId
     * @returns {boolean}
     */
    static hasPanel(serverId) {
        return panelServerIds.has(String(serverId));
    }

    /** Lädt den Index neu, wenn er abgelaufen ist (fire and forget). */
    static refreshIndexIfStale() {
        if (Date.now() - panelIndexLoadedAt < PANEL_INDEX_TTL_MS) return;
        if (panelIndexInFlight) return;

        const dbService = ServiceManager.get('dbService');
        const Logger    = ServiceManager.get('Logger');

        panelIndexInFlight = dbService
            .query('SELECT DISTINCT server_id FROM gameserver_status_panels WHERE enabled = 1')
            .then(rows => {
                panelServerIds     = new Set((rows || []).map(r => String(r.server_id)));
                panelIndexLoadedAt = Date.now();
            })
            .catch(err => Logger?.warn?.(`[PanelService] Panel-Index nicht geladen: ${err.message}`))
            .finally(() => { panelIndexInFlight = null; });
    }

    /** Erzwingt das Neuladen des Index beim nächsten Zugriff. */
    static invalidateIndex() {
        panelIndexLoadedAt = 0;
    }

    // ────────────────────────────────────────────────────────────
    // Push
    // ────────────────────────────────────────────────────────────

    /**
     * Wird vom Poller nach jedem Snapshot gerufen.
     *
     * @param {object} server - Zeile aus StatusPoller._loadServers()
     * @param {object} snapshot - Ergebnis von StatusService.refresh()
     * @returns {Promise<void>}
     */
    static async onSnapshot(server, snapshot) {
        PanelService.refreshIndexIfStale();
        if (!PanelService.hasPanel(server.id)) return;

        try {
            await PanelService.pushForServer(server.id, snapshot, { force: false });
        } catch (err) {
            const Logger = ServiceManager.get('Logger');
            Logger?.warn?.(`[PanelService] Push fehlgeschlagen (Server ${server.id}): ${err.message}`);
        }
    }

    /**
     * Schiebt alle Panels eines Servers.
     *
     * @param {number} serverId
     * @param {object} snapshot - aktueller Snapshot
     * @param {object} [opts]
     * @param {boolean} [opts.force] - Mindestabstand und Hash ignorieren
     * @returns {Promise<{pushed: number, skipped: number}>}
     */
    static async pushForServer(serverId, snapshot, { force = false } = {}) {
        const dbService = ServiceManager.get('dbService');

        const panels = await dbService.query(
            'SELECT * FROM gameserver_status_panels WHERE server_id = ? AND enabled = 1',
            [serverId]
        );
        if (!panels?.length) return { pushed: 0, skipped: 0 };

        // Name und Addon stehen nicht im Poller-Payload – hier nachladen, weil es
        // nur passiert, wenn wirklich ein Panel existiert.
        const [server] = await dbService.query(
            `SELECT gs.id, gs.name, gs.status,
                    am.name AS game_name,
                    COALESCE(am.game_data, gs.frozen_game_data) AS game_data
             FROM gameservers gs
             LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
             WHERE gs.id = ? LIMIT 1`,
            [serverId]
        );
        if (!server) return { pushed: 0, skipped: 0 };

        const gameData = typeof server.game_data === 'string'
            ? JSON.parse(server.game_data)
            : (server.game_data || {});
        const { display } = resolveStatusConfig(gameData);

        let pushed = 0, skipped = 0;

        for (const panel of panels) {
            const payload = buildPanelPayload({
                panel:    PanelService._normalizePanel(panel),
                server,
                snapshot,
                display,
                gameName: server.game_name,
            });
            const hash = payloadHash(payload);

            if (!force && !PanelService._shouldPush(panel, hash)) {
                skipped++;
                continue;
            }

            // Erst den Push beanspruchen, dann senden. Ohne diesen Schritt
            // erschien das Panel beim Anlegen zweimal: Der erzwungene Push aus
            // create() und der reguläre aus dem Poller lasen beide
            // `message_id = NULL` und posteten beide eine neue Nachricht.
            if (!await PanelService._claim(panel)) {
                skipped++;
                continue;
            }

            await PanelService._send(panel, payload, hash);
            pushed++;
        }

        return { pushed, skipped };
    }

    /**
     * Entscheidet, ob ein Panel jetzt geschrieben werden darf.
     *
     * @private
     * @param {object} panel
     * @param {string} hash
     * @returns {boolean}
     */
    static _shouldPush(panel, hash) {
        // Noch nie gepostet → immer schicken, sonst bliebe das Panel leer.
        if (!panel.message_id) return true;

        // Nichts geändert → nichts zu tun. Der Zeitstempel im Embed altert
        // sichtbar mit, das ist ehrlicher als ein Edit ohne Neuigkeit.
        if (panel.last_hash && panel.last_hash === hash) return false;

        if (panel.last_pushed_at) {
            const age = Date.now() - new Date(panel.last_pushed_at).getTime();
            if (age < Number(panel.min_interval_s || 60) * 1000) return false;
        }
        return true;
    }

    /**
     * Beansprucht das Recht, dieses Panel jetzt zu schreiben.
     *
     * Optimistische Sperre über `push_seq`: Wer den Zähler von dem Wert
     * hochsetzt, den er gelesen hat, hat gewonnen – alle anderen treffen keine
     * Zeile mehr und lassen es. Ein Zähler statt `last_pushed_at`, weil zwei
     * Pushes in derselben Sekunde denselben DATETIME schreiben würden und MySQL
     * dann keine geänderte Zeile meldet, obwohl die Bedingung zutraf.
     *
     * @private
     * @param {object} panel
     * @returns {Promise<boolean>}
     */
    static async _claim(panel) {
        const dbService = ServiceManager.get('dbService');
        const result = await dbService.query(
            'UPDATE gameserver_status_panels SET push_seq = push_seq + 1 WHERE id = ? AND push_seq = ?',
            [panel.id, Number(panel.push_seq) || 0]
        );
        return (result?.affectedRows ?? 0) === 1;
    }

    /**
     * Schickt die Nutzlast an den Bot und schreibt das Ergebnis zurück.
     *
     * @private
     */
    static async _send(panel, payload, hash) {
        const dbService = ServiceManager.get('dbService');
        const Logger    = ServiceManager.get('Logger');

        // ServiceManager.get() wirft bei unbekanntem Namen – has() zuerst, sonst
        // reißt ein Dashboard ohne Bot-Verbindung den ganzen Poll-Durchgang mit.
        if (!ServiceManager.has('ipcServer')) throw new Error('Kein IPC-Server verfügbar');
        const ipcServer = ServiceManager.get('ipcServer');

        // broadcastOne, nicht broadcast: Das Panel ist eine Nachricht, kein
        // Rundruf – bei mehreren Bot-Sockets würde sie sonst mehrfach editiert.
        const res = await ipcServer.broadcastOne('gameserver:UPDATE_STATUS_PANEL', payload);

        // Zwei Ebenen, zwei Bedeutungen: `res.success` sagt nur, dass der
        // IPCClient den Handler gefunden und aufgerufen hat, ohne dass er warf.
        // Was der Handler selbst meldet, steckt in `res.data` – deshalb heißt es
        // dort `ok`. Wer hier nur `res.success` prüft, hält jeden fehlgeschlagenen
        // Discord-Edit für gelungen und schreibt einen Hash, der nie gepostet wurde.
        const result = res?.data || {};

        if (!res?.success || !result.ok) {
            const error = result.error || res?.error || 'Bot hat nicht geantwortet';

            // Kanal weg oder Bot darf dort nicht schreiben: Das repariert sich
            // nicht von selbst, also stilllegen statt im Poll-Takt weiterlaufen.
            const fatal = !!result.disable;
            await dbService.query(
                `UPDATE gameserver_status_panels
                 SET last_error = ?, enabled = IF(?, 0, enabled)
                 WHERE id = ?`,
                [error, fatal ? 1 : 0, panel.id]
            );
            if (fatal) {
                PanelService.invalidateIndex();
                Logger?.warn?.(`[PanelService] Panel ${panel.id} stillgelegt: ${error}`);
            }
            return;
        }

        // Der Bot meldet die message_id zurück – auch dann, wenn er die alte
        // Nachricht nicht mehr fand und eine neue gepostet hat.
        const messageId = result.message_id || panel.message_id || null;

        // Diese Zeile ist die wichtigste im ganzen Ablauf: Nur weil die
        // message_id gespeichert ist, editiert der nächste Push dieselbe
        // Nachricht statt eine neue zu posten. Scheitert sie nach einem
        // erfolgreichen Versand, steht die Nachricht in Discord, ohne dass wir
        // sie kennen – dann postet der nächste Poll eine zweite. Darum laut.
        try {
            await dbService.query(
                `UPDATE gameserver_status_panels
                 SET message_id = ?, last_hash = ?, last_pushed_at = NOW(), last_error = NULL
                 WHERE id = ?`,
                [messageId, hash, panel.id]
            );
        } catch (err) {
            Logger?.error?.(
                `[PanelService] Panel ${panel.id}: Nachricht ${messageId} gepostet, aber nicht gespeichert `
                + `(${err.message}). Der nächste Push postet erneut – message_id von Hand nachtragen.`
            );
            throw err;
        }
    }

    /**
     * MySQL liefert BOOLEAN als 0/1 – der Presenter fragt sie direkt ab.
     * @private
     */
    static _normalizePanel(panel) {
        return {
            ...panel,
            show_players:  !!panel.show_players,
            show_controls: !!panel.show_controls,
            show_refresh:  !!panel.show_refresh,
        };
    }

    // ────────────────────────────────────────────────────────────
    // Verwaltung
    // ────────────────────────────────────────────────────────────

    /**
     * Legt ein Panel an und postet es sofort.
     *
     * @param {object} args
     * @param {string} args.guildId
     * @param {number} args.serverId
     * @param {string} args.channelId
     * @param {boolean} [args.showPlayers]
     * @param {boolean} [args.showControls]
     * @param {number} [args.minIntervalS]
     * @param {string} [args.createdBy]
     * @returns {Promise<object>} angelegtes Panel
     */
    static async create({ guildId, serverId, channelId, showPlayers = false,
                          showControls = true, showRefresh = true,
                          minIntervalS = 60, createdBy = null }) {
        const dbService = ServiceManager.get('dbService');

        await dbService.query(
            `INSERT INTO gameserver_status_panels
                (guild_id, server_id, channel_id, show_players, show_controls, show_refresh,
                 min_interval_s, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                show_players   = VALUES(show_players),
                show_controls  = VALUES(show_controls),
                show_refresh   = VALUES(show_refresh),
                min_interval_s = VALUES(min_interval_s),
                enabled        = 1,
                last_error     = NULL`,
            [guildId, serverId, channelId, showPlayers ? 1 : 0, showControls ? 1 : 0,
             showRefresh ? 1 : 0, Math.max(15, Number(minIntervalS) || 60), createdBy]
        );

        PanelService.invalidateIndex();
        await PanelService.refreshNow(serverId);

        const [panel] = await dbService.query(
            'SELECT * FROM gameserver_status_panels WHERE server_id = ? AND channel_id = ? LIMIT 1',
            [serverId, channelId]
        );
        return panel;
    }

    /**
     * Ändert die Einstellungen eines bestehenden Panels.
     *
     * Nur übergebene Felder werden angefasst – wer nur die Buttons abschalten
     * will, soll nicht versehentlich die Spielernamen mit umlegen.
     *
     * Danach wird sofort geschoben: Die Buttons ändern sich mit, ohne dass
     * jemand auf die nächste Statusänderung warten muss. Die Nachricht bleibt
     * dieselbe, es wird editiert.
     *
     * @param {object} args
     * @param {string} args.guildId
     * @param {number} args.serverId
     * @param {string} args.channelId
     * @param {boolean} [args.showPlayers]
     * @param {boolean} [args.showControls]
     * @param {boolean} [args.showRefresh]
     * @param {number}  [args.minIntervalS]
     * @returns {Promise<object|null>} geändertes Panel oder null
     */
    static async update({ guildId, panelId, serverId, channelId, showPlayers, showControls,
                          showRefresh, minIntervalS }) {
        const dbService = ServiceManager.get('dbService');

        // Zwei Wege zum selben Panel: Das Dashboard kennt die id, der Bot-Befehl
        // kennt Server und Kanal. Die guild_id steht in beiden Bedingungen –
        // sonst könnte eine fremde Guild über eine geratene id mitschreiben.
        const [panel] = panelId
            ? await dbService.query(
                'SELECT * FROM gameserver_status_panels WHERE id = ? AND guild_id = ? LIMIT 1',
                [panelId, guildId])
            : await dbService.query(
                `SELECT * FROM gameserver_status_panels
                 WHERE server_id = ? AND channel_id = ? AND guild_id = ? LIMIT 1`,
                [serverId, String(channelId), guildId]);

        if (!panel) return null;

        const sets = [], values = [];
        if (showPlayers  !== undefined && showPlayers  !== null) { sets.push('show_players = ?');  values.push(showPlayers  ? 1 : 0); }
        if (showControls !== undefined && showControls !== null) { sets.push('show_controls = ?'); values.push(showControls ? 1 : 0); }
        if (showRefresh  !== undefined && showRefresh  !== null) { sets.push('show_refresh = ?');  values.push(showRefresh  ? 1 : 0); }
        if (minIntervalS !== undefined && minIntervalS !== null) {
            sets.push('min_interval_s = ?');
            values.push(Math.max(15, Number(minIntervalS) || 60));
        }
        if (!sets.length) return panel;

        values.push(panel.id);
        await dbService.query(
            `UPDATE gameserver_status_panels SET ${sets.join(', ')} WHERE id = ?`,
            values
        );

        // Die Server-ID aus der Zeile, nicht aus dem Aufruf: Beim Weg über die
        // panelId ist sie gar nicht mitgekommen.
        await PanelService.refreshNow(panel.server_id);

        const [updated] = await dbService.query(
            'SELECT * FROM gameserver_status_panels WHERE id = ? LIMIT 1',
            [panel.id]
        );
        return updated;
    }

    /**
     * Entfernt ein Panel und lässt die Nachricht im Kanal löschen.
     *
     * @param {number} panelId
     * @param {string} guildId
     * @returns {Promise<boolean>}
     */
    static async remove(panelId, guildId) {
        const dbService = ServiceManager.get('dbService');
        const ipcServer = ServiceManager.has('ipcServer') ? ServiceManager.get('ipcServer') : null;

        const [panel] = await dbService.query(
            'SELECT * FROM gameserver_status_panels WHERE id = ? AND guild_id = ? LIMIT 1',
            [panelId, guildId]
        );
        if (!panel) return false;

        if (panel.message_id && ipcServer) {
            // Fehler hier sind nicht schlimm: Die Nachricht kann längst gelöscht
            // sein. Der DB-Eintrag muss trotzdem weg.
            await ipcServer.broadcastOne('gameserver:DELETE_STATUS_PANEL', {
                guild_id:   panel.guild_id,
                channel_id: panel.channel_id,
                message_id: panel.message_id,
            }).catch(() => null);
        }

        await dbService.query('DELETE FROM gameserver_status_panels WHERE id = ?', [panelId]);
        PanelService.invalidateIndex();
        return true;
    }

    /**
     * Frische Abfrage und sofortiger Push – für den „Neu laden"-Button und für
     * das Anlegen eines Panels.
     *
     * @param {number} serverId
     * @returns {Promise<object|null>} Snapshot oder null
     */
    static async refreshNow(serverId) {
        const dbService = ServiceManager.get('dbService');
        const StatusService = require('./StatusService');

        const [server] = await dbService.query(
            `SELECT gs.id, gs.guild_id, gs.status, gs.ports, gs.env_variables, gs.bind_ip,
                    COALESCE(am.game_data, gs.frozen_game_data) AS game_data,
                    r.host AS rootserver_ip, r.daemon_id
             FROM gameservers gs
             LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
             LEFT JOIN rootserver r         ON gs.rootserver_id = r.id
             WHERE gs.id = ? LIMIT 1`,
            [serverId]
        );
        if (!server) return null;

        const snapshot = await StatusService.refresh(server);

        // Nutzerausgelöst: Mindestabstand überspringen. Der Cooldown je Nutzer
        // sitzt im Bot, sonst wäre die 60-s-Bremse durch Klicken umgehbar.
        await PanelService.pushForServer(serverId, snapshot, { force: true });
        return snapshot;
    }
}

module.exports = PanelService;
