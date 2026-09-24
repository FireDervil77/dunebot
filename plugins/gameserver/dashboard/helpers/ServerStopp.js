'use strict';

/**
 * Einen Gameserver stoppen — und wissen, wann er WIRKLICH unten ist.
 *
 * ── Warum es diesen Helfer gibt (2026-09-14) ────────────────────────────────
 *
 * Der Daemon antwortet auf `gameserver.stop` mit `queued`: Er reiht den Stopp
 * in seine Aufgabenliste ein und meldet sich sofort. Heruntergefahren wird
 * danach, und erst dann schickt er `stopping` und `stopped` als
 * `status_changed` (index.js `_handleStatusChanged`, das `last_status_update`
 * mitsetzt).
 *
 * Die Start- und die Neustart-Route wussten das (`response.task_id` → der Status
 * bleibt, bis der Daemon meldet). **Die Stopp-Route nicht:** Sie schrieb nach der
 * Antwort sofort `offline` und schickte dem Browser nichts. Zwei Folgen, beide am
 * 2026-09-14 vom Betreiber bemerkt bzw. dabei gefunden:
 *
 *  1. `stopping` kam nie live an. Der Knopf sprang, sobald der Daemon irgendwann
 *     `stopped` meldete — dazwischen stand der Server laut Datenbank schon auf
 *     `offline`, laut Seite noch auf `online`.
 *  2. **Ein laufender Container sah aus wie ein gestoppter.** Die Löschsperre
 *     („muss zuerst gestoppt werden") ließ dann durch, und der Daemon löscht beim
 *     Deinstallieren nur Volume und Verzeichnis — den Container stoppt er dabei
 *     NICHT (`internal/gameserver/uninstall.go`). Dateien unter einem noch
 *     herunterfahrenden Spiel zu löschen, ist genau der Fehler, den die Sperre
 *     verhindern sollte.
 *
 * ── Was hier gilt ───────────────────────────────────────────────────────────
 *
 * - **Ob gestoppt werden darf, entscheidet `ServerState.pruefeAktion`** — die
 *   Zustandslogik, die für genau diese Frage gebaut wurde. Der Discord-Weg im
 *   Kern (`apps/dashboard/helpers/IPCServer.js`, `SERVER_STOP`) benutzt sie seit
 *   langem und macht den Stopp dort auch richtig; die Web-Routen prüften bis zum
 *   2026-09-14 selbst und gröber. Damit gilt jetzt auch hier ihr Ventil: Ein
 *   Übergang, der länger als fünf Minuten steht, sperrt nicht mehr
 *   (Baustelle 115: ein hängendes `starting` blockierte das Löschen).
 * - `stopping` wird geschrieben UND sofort an den Browser geschickt.
 * - `queued` → der Status bleibt `stopping`. Offline setzt allein die Meldung
 *   des Daemons.
 * - Scheitert der Befehl, kehrt der Status zu dem zurück, was er VORHER war —
 *   nicht pauschal zu `online`, wie es die Route bis dahin tat.
 *
 * Die übrigen Stopp-Wege laufen hier noch NICHT durch: der Discord-Befehl über
 * den Kern (richtig gebaut, aber eigener Code — der Kern darf kein Plugin
 * `require`n), CronWorker, MigrationManager und der Plugin-Abbau. Das ist
 * benannt, nicht vergessen: siehe `docs/Baustellen.md`, Baustelle 119.
 *
 * @module helpers/ServerStopp
 */

const { ServiceManager } = require('dunebot-core');
const { pruefeAktion } = require('./ServerState');

/**
 * Wie lange das Löschen höchstens auf den echten Stopp wartet.
 *
 * Das Valheim-Paket erlaubt seinem Stopp 60 s SIGINT, 30 s SIGTERM und 10 s
 * SIGKILL — 100 Sekunden, bevor der Daemon überhaupt aufgibt. Dazu kommt die
 * Zeit in der Aufgabenliste des Daemons. 150 Sekunden lassen dafür Luft; der
 * Proxy vor dem Dashboard erlaubt 600 (`ProxyTimeout` in
 * `firenetworks-dashboard.conf`, gemessen am 2026-09-14).
 */
const STOPP_FRIST_MS = 150 * 1000;
const TAKT_MS = 2000;

/** SSE ist im Betrieb immer da — in einem Prüflauf nicht zwingend. */
function melde(guildId, serverId, status, zusatz = {}) {
    if (!ServiceManager.has('sseManager')) return;
    ServiceManager.get('sseManager').broadcast(guildId, 'gameserver', {
        action: 'status_changed',
        server_id: String(serverId),
        status,
        timestamp: Date.now(),
        ...zusatz,
    });
}

/**
 * Den Stopp auslösen.
 *
 * @param {{server: object, guildId: string}} auftrag
 *        `server` braucht id, name, status, last_status_update, daemon_id
 * @returns {Promise<{ok: boolean, status?: number, grund?: string, eingereiht?: boolean, taskId?: string}>}
 */
async function stoppe({ server, guildId }) {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const ipmServer = ServiceManager.has('ipmServer') ? ServiceManager.get('ipmServer') : null;

    const pruefung = pruefeAktion('stop', server.status, server.last_status_update);
    if (!pruefung.erlaubt) return { ok: false, status: 409, grund: pruefung.grund };
    if (pruefung.verfallen) {
        Logger.warn(`[Gameserver] Server ${server.id} hing in „${server.status}" — Stopp wird trotzdem ausgelöst`);
    }

    if (!server.daemon_id) return { ok: false, status: 404, grund: 'Kein Daemon zugewiesen' };
    if (!ipmServer) return { ok: false, status: 503, grund: 'IPM-Server nicht verfügbar' };
    if (!ipmServer.isDaemonOnline(server.daemon_id)) {
        return { ok: false, status: 503, grund: 'Daemon ist offline' };
    }

    const vorher = server.status;
    await dbService.query(
        'UPDATE gameservers SET status = ?, last_status_update = NOW() WHERE id = ?',
        ['stopping', server.id]);
    melde(guildId, server.id, 'stopping');

    Logger.info(`[Gameserver] Sende Stop-Command an Daemon ${server.daemon_id} (Server ${server.id})`);
    let antwort;
    try {
        antwort = await ipmServer.sendCommand(server.daemon_id, 'gameserver.stop', {
            server_id: String(server.id),
            guild_id: guildId,
        }, 30000);
    } catch (fehler) {
        antwort = { success: false, error: fehler.message };
    }

    if (!antwort?.success) {
        const grund = antwort?.error || 'Stop failed';
        await dbService.query(
            'UPDATE gameservers SET status = ?, error_message = ?, last_status_update = NOW() WHERE id = ?',
            [vorher, grund, server.id]);
        melde(guildId, server.id, vorher, { error_message: grund });
        Logger.error(`[Gameserver] Stop fehlgeschlagen für Server ${server.id}: ${grund}`);
        return { ok: false, status: 500, grund };
    }

    if (antwort.task_id) {
        Logger.info(`[Gameserver] Stopp für Server ${server.id} eingereiht (Task ${antwort.task_id}) — `
            + 'der Status bleibt „stopping", bis der Daemon „stopped" meldet');
        return { ok: true, eingereiht: true, taskId: antwort.task_id };
    }

    // Ohne Aufgabenkennung hat der Daemon synchron gestoppt.
    await dbService.query(
        'UPDATE gameservers SET status = ?, last_status_update = NOW() WHERE id = ?',
        ['offline', server.id]);
    melde(guildId, server.id, 'offline');
    Logger.success(`[Gameserver] Server ${server.id} gestoppt`);
    return { ok: true, eingereiht: false };
}

/**
 * Warten, bis der Server wirklich unten ist.
 *
 * Gelesen wird die Datenbank, nicht die Antwort des Befehls — dort schreibt
 * `_handleStatusChanged`, was der Daemon meldet. **`error` gilt NICHT als
 * gestoppt:** Ein Fehler beim Herunterfahren sagt nicht, dass der Container weg
 * ist, und hier hängt das Löschen von Dateien daran.
 *
 * @param {number|string} serverId
 * @param {{fristMs?: number, taktMs?: number}} [optionen]
 * @returns {Promise<{ok: boolean, grund?: string, zeitueberschreitung?: boolean}>}
 */
async function warteBisGestoppt(serverId, { fristMs = STOPP_FRIST_MS, taktMs = TAKT_MS } = {}) {
    const dbService = ServiceManager.get('dbService');
    const ende = Date.now() + fristMs;

    for (;;) {
        const [zeile] = await dbService.query(
            'SELECT status, error_message FROM gameservers WHERE id = ?', [serverId]);
        if (!zeile) return { ok: false, grund: 'Der Server ist nicht mehr vorhanden' };
        if (zeile.status === 'offline') return { ok: true };
        if (zeile.status === 'error') {
            return { ok: false, grund: 'Der Server meldete beim Stoppen einen Fehler'
                + (zeile.error_message ? `: ${zeile.error_message}` : '') };
        }
        if (Date.now() >= ende) {
            return { ok: false, zeitueberschreitung: true,
                grund: `Der Server steht nach ${Math.round(fristMs / 1000)} Sekunden noch auf „${zeile.status}"` };
        }
        await new Promise(r => setTimeout(r, taktMs));
    }
}

/**
 * Läuft der Server? Dann stoppen und warten, bis er wirklich unten ist.
 *
 * Für alles, was Dateien unter dem Server anfasst — Löschen und
 * Neuinstallieren. Beide lassen den Container selbst stehen: Der Daemon löscht
 * beim Deinstallieren nur Volume und Verzeichnis, und beim Installieren prüft er
 * nicht, ob der Container läuft.
 *
 * ── Warum das nicht mehr nur beim Löschen steht (2026-09-24, Baustelle 155) ──
 *
 * Bis dahin stand dieser Ablauf allein in der Löschroute. Die Neuinstallation
 * schickte ihren Auftrag, ohne hinzusehen: #202 stand auf `online`, der
 * Container lief seit dem Vorabend, und die Installation tauschte Forge unter
 * dem laufenden Prozess aus. Danach setzte das Dashboard `offline` — der Server
 * lief weiter, nur das Panel sah ihn nicht mehr. Betreiber: *„wie beim
 * entfernen … wird vor dem reinstall sauber gestoppt. das dashboard meldet das
 * und dann startet der reinstall."*
 *
 * @param {{server: object, guildId: string}} auftrag
 *        `server` braucht id, status, last_status_update, daemon_id
 * @returns {Promise<{ok: boolean, gestoppt?: boolean, status?: number, grund?: string}>}
 *          `gestoppt` sagt, ob tatsächlich gestoppt wurde; `status` ist der
 *          HTTP-Status für die Route, wenn nicht.
 */
async function stoppeFallsLaeuft({ server, guildId }) {
    if (!['online', 'starting', 'stopping'].includes(server.status)) {
        return { ok: true, gestoppt: false };
    }
    const Logger = ServiceManager.get('Logger');

    // Ein laufender Stopp wird nicht doppelt ausgelöst — außer er hängt
    // länger, als ein Übergang darf (dasselbe Ventil wie beim Stoppen).
    const { uebergangVerfallen } = require('./ServerState');
    const schonImStopp = server.status === 'stopping'
        && !uebergangVerfallen(server.last_status_update);

    if (!schonImStopp) {
        Logger.info(`[Gameserver] Server ${server.id} läuft noch (${server.status}) — wird zuerst gestoppt`);
        const stopp = await module.exports.stoppe({ server, guildId });
        if (!stopp.ok) {
            return { ok: false, status: stopp.status || 500,
                grund: `Der Server läuft und ließ sich nicht stoppen: ${stopp.grund}` };
        }
    }

    // Über den Export, nicht direkt: `check-server-stopp.js` ersetzt das Warten,
    // um die REIHENFOLGE in den Routen zu prüfen statt der Uhr. Ein direkter
    // Aufruf ginge an diesem Ersatz vorbei, und die Prüfung liefe in die echte
    // Frist von 150 s (am 2026-09-24 genau so hängen geblieben).
    const warten = await module.exports.warteBisGestoppt(server.id);
    if (!warten.ok) {
        return { ok: false, status: warten.zeitueberschreitung ? 504 : 409, grund: warten.grund };
    }
    Logger.info(`[Gameserver] Server ${server.id} ist unten`);
    return { ok: true, gestoppt: true };
}

module.exports = { stoppe, warteBisGestoppt, stoppeFallsLaeuft, STOPP_FRIST_MS };
