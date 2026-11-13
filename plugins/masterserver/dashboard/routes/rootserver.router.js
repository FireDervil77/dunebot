/**
 * Masterserver Plugin - RootServer Routes
 * 
 * Alle Routen für RootServer-Management
 * - Liste aller RootServer
 * - RootServer Details
 * - RootServer erstellen/bearbeiten/löschen
 * - Status-Management
 * 
 * @module masterserver/routes/rootserver
 * @author FireBot Team
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const RootServer = require('../models/RootServer');
const Maschinenbefund = require('../helpers/Maschinenbefund');
const RootServerAnlegen = require('../helpers/RootServerAnlegen');
const { dbGrenzeFehler } = RootServerAnlegen;
// Die Liste der laufenden Umzugszustände gibt es einmal (Vorbild: werkbank
// liest Serverseite aus dem Gameserver-Plugin).
const { LAEUFT: UMZUG_LAEUFT } = require('../../../gameserver/dashboard/helpers/Umzugsstand');

/** Der Bereich, aus dem diese Maschine Spielports vergibt — oder null, solange keiner angelegt ist. */
async function spielportBereich(rootserverId) {
    if (!rootserverId) return null;
    const [b] = await ServiceManager.get('dbService').query(
        'SELECT MIN(port) AS von, MAX(port) AS bis FROM port_allocations WHERE rootserver_id = ?', [rootserverId]);
    return b && b.von ? { von: Number(b.von), bis: Number(b.bis) } : null;
}

// Helper: themeManager.renderView() wrapper
const renderView = async (res, viewPath, data) => {
    const themeManager = ServiceManager.get('themeManager');
    return await themeManager.renderView(res, viewPath, data);
};

// =====================================================
// Route: Rootserver-Liste
// GET /guild/:guildId/plugins/masterserver/rootservers
// =====================================================
router.get('/', requirePermission('MASTERSERVER.ROOTSERVER.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipmServer = ServiceManager.get('ipmServer');
    const guildId = res.locals.guildId;

    try {
        res.locals.pluginName = 'masterserver';
        req.params.pluginName = 'masterserver';

        // Noch kein RootServer → direkt zum Onboarding-Wizard
        const rootservers = await RootServer.getByGuild(guildId);
        if (!rootservers || rootservers.length === 0) {
            return res.redirect(`/guild/${guildId}/plugins/masterserver/rootservers/create`);
        }

        // Daemon Online-Status anhand des primären RootServers prüfen
        const primaryDaemonId = rootservers[0].daemon_id;
        const daemonOnline = ipmServer.isDaemonOnline(primaryDaemonId);
        
        // Daemon Hardware-Daten holen (falls online)
        const daemonHardware = daemonOnline ? ipmServer.getDaemonHardware(primaryDaemonId) : null;

        // Online-Status für jeden RootServer prüfen
        // Update-Stand frisch je Abruf (daemonUpdateStand) — ein neu gebauter
        // Daemon erscheint ohne Neustart von Dashboard oder Daemon.
        const rootserversWithStatus = rootservers.map(rs => {
            const stand = ipmServer.daemonUpdateStand(rs.daemon_id);
            return {
                ...rs,
                isOnline: stand.online,
                updateAvailable: stand.updateAvailable,
                latestVersion:   stand.latestVersion,
            };
        });

        // Status-Zusammenfassung berechnen
        const serverStats = {
            total: rootservers.length,
            active: rootservers.filter(rs => rs.daemon_status === 'online').length,
            maintenance: rootservers.filter(rs => rs.daemon_status === 'offline' || rs.install_status === 'installing').length,
            totalGameservers: rootservers.reduce((sum, rs) => sum + (parseInt(rs.gameserver_count) || 0), 0)
        };

        await renderView(res, 'guild/masterserver-rootservers', {
            title: 'RootServer',
            activeMenu: `/guild/${guildId}/plugins/masterserver/rootservers`,
            servers: rootserversWithStatus,
            serverStats,
            daemonOnline,
            daemonHardware,
            guildId
        });

    } catch (error) {
        Logger.error('[Masterserver] RootServer List Error:', error);
        res.status(500).render('error', { 
            message: 'Fehler beim Laden der RootServer-Liste',
            error: error.message 
        });
    }
});

// =====================================================
// Route: SSE-Events für RootServer-Metriken (Live-Push)
// GET /guild/:guildId/plugins/masterserver/rootservers/events
// ⚠️ MUSS VOR /:id stehen, sonst wird "events" als ID interpretiert!
// =====================================================
router.get('/events', requirePermission('MASTERSERVER.ROOTSERVER.VIEW'), (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const sseManager = ServiceManager.get('sseManager');
    const guildId = res.locals.guildId;

    try {
        const sessionUser = req.session?.user;
        const localUser = res.locals.user;
        const userId = localUser?.id || sessionUser?.info?.id || 'anonymous';
        const clientId = `ms-${userId}-${Date.now()}`;

        // Optional: Filter auf bestimmten RootServer
        const daemonFilter = req.query.daemon_id ?
            (message) => {
                return message.data && message.data.daemon_id === req.query.daemon_id;
            } : null;

        sseManager.addClient(guildId, clientId, res, {
            filter: daemonFilter,
            metadata: {
                userId,
                source: 'masterserver',
                daemonId: req.query.daemon_id || null
            }
        });

        Logger.info(`[Masterserver SSE] Client ${clientId} connected (Guild: ${guildId})`);

        // Jemand sieht zu: Live-Messwerte der Maschinen bestellen (alle 3 s,
        // solange erneuert wird — Baustelle 207, helpers/Messwertbestellung).
        require('../helpers/Messwertbestellung').zuschauerDa(guildId);
    } catch (error) {
        Logger.error('[Masterserver SSE] Fehler:', error);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'SSE-Fehler' });
        }
    }
});

// =====================================================
// Route: RootServer erstellen (Wizard)
// GET /guild/:guildId/plugins/masterserver/rootservers/create
// =====================================================
router.get('/create', requirePermission('MASTERSERVER.ROOTSERVER.CREATE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;

    try {
        res.locals.pluginName = 'masterserver';
        req.params.pluginName = 'masterserver';

        // Quota-Profile laden
        const quotaProfiles = await dbService.query(
            `SELECT * FROM quota_profiles WHERE is_active = 1 ORDER BY ram_mb ASC`
        );

        // Daemon-Hardware-Daten (falls ein primärer RootServer schon online)
        const ipmServer = ServiceManager.get('ipmServer');
        const existingRS = (await RootServer.getByGuild(guildId))[0] || null;
        const daemonOnline = existingRS ? ipmServer.isDaemonOnline(existingRS.daemon_id) : false;
        const daemonHardware = daemonOnline ? (ipmServer.getDaemonHardware(existingRS.daemon_id) || null) : null;

        await renderView(res, 'guild/masterserver-rootserver-create', {
            title: 'RootServer erstellen',
            activeMenu: `/guild/${guildId}/plugins/masterserver/rootservers`,
            guildId,
            quotaProfiles,
            daemonHardware,
            daemonOnline
        });

    } catch (error) {
        Logger.error('[Masterserver] RootServer Create Wizard Error:', error);
        res.status(500).render('error', { 
            message: 'Fehler beim Laden des Setup-Wizards',
            error: error.message 
        });
    }
});

// =====================================================
// Route: RootServer erstellen (POST - Simplified)
// POST /guild/:guildId/plugins/masterserver/rootservers
// =====================================================
router.post('/', requirePermission('MASTERSERVER.ROOTSERVER.CREATE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;

    try {
        // Derselbe Ablauf wie `/daemon register` im Bot (2026-11-06):
        // helpers/RootServerAnlegen.js. Dort steht, was das Formular fragt und
        // warum die Hardware leer bleibt.
        const ergebnis = await RootServerAnlegen.anlegen({
            guildId,
            ownerUserId: res.locals.user?.id || null, // Discord User ID aus Session (optional)
            felder: req.body
        });
        if (!ergebnis.ok) {
            return res.status(ergebnis.status).json({ success: false, message: ergebnis.fehler });
        }

        res.json({
            success: true,
            message: 'RootServer erfolgreich erstellt! Sie werden zur Details-Seite weitergeleitet...',
            data: {
                ...ergebnis.data,
                redirectUrl: `/guild/${guildId}/plugins/masterserver/rootservers/${ergebnis.data.id}`
            }
        });

    } catch (error) {
        Logger.error('[Masterserver] RootServer Create Error:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Erstellen des RootServers',
            error: error.message
        });
    }
});

/**
 * Gameserver, deren Umzugsverlauf an dieser Maschine hängt (K375, K377).
 *
 * `gameserver_migrations` zeigt mit `ON DELETE RESTRICT` auf Quelle und Ziel
 * (am 2026-11-12 und 2026-11-13 in `information_schema.REFERENTIAL_CONSTRAINTS`
 * nachgesehen; es sind die einzigen RESTRICT auf `rootserver`). Die Zeilen
 * leben, solange es den Gameserver gibt (CASCADE an `server_id`) — auch dann,
 * wenn er längst auf einer anderen Maschine liegt.
 *
 * K375 sperrte deshalb das Löschen. Seit K377 (Betreiber 2026-11-13: „wenn
 * keine gameserver mehr dort sind, bringt es ja nichts an einem starren
 * verlauf zu hängen") geht der Verlauf mit der Maschine. Gesperrt bleibt sie
 * nur, solange ein Umzug von oder zu ihr läuft: `laufend` zählt Zeilen, die
 * die jüngste ihres Servers sind und einen Zustand aus `Umzugsstand.LAEUFT`
 * tragen — dieselbe Lesart wie Serverliste und Serverseite. Ein Umzug HIERHER
 * lässt die Maschine leer aussehen, bis er die Datenbank umschreibt.
 *
 * `laufend` ist eine SUMME und kommt als Text ("0"), `umzuege` als Zahl —
 * beide mit Number() lesen.
 */
async function umzugsverlaufAn(dbService, rootserverId) {
    return dbService.query(
        `SELECT gs.id, gs.name, COUNT(*) AS umzuege,
                SUM(m.status IN (${UMZUG_LAEUFT.map(() => '?').join(', ')})
                    AND m.id = (SELECT MAX(j.id) FROM gameserver_migrations j WHERE j.server_id = m.server_id)) AS laufend
           FROM gameserver_migrations m
           JOIN gameservers gs ON gs.id = m.server_id
          WHERE m.source_rootserver_id = ? OR m.target_rootserver_id = ?
          GROUP BY gs.id, gs.name
          ORDER BY gs.name`,
        [...UMZUG_LAEUFT, rootserverId, rootserverId]
    );
}

// =====================================================
// Route: RootServer Details
// GET /guild/:guildId/plugins/masterserver/rootservers/:id
// =====================================================
router.get('/:id', requirePermission('MASTERSERVER.ROOTSERVER.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipmServer = ServiceManager.get('ipmServer');
    const guildId = res.locals.guildId;
    const rootserverId = req.params.id;

    try {
        res.locals.pluginName = 'masterserver';
        req.params.pluginName = 'masterserver';

        // RootServer laden
        const rootserver = await RootServer.getById(rootserverId);

        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).render('error', {
                message: 'RootServer nicht gefunden'
            });
        }

        // Online-Status prüfen
        const isOnline = ipmServer.isDaemonOnline(rootserver.daemon_id);

        // Gameserver-Statistiken und Liste für diesen RootServer laden
        const dbService = ServiceManager.get('dbService');
        const gameservers = await dbService.query(
            // Die Messwerte stehen in derselben Zeile (B146). Der LEFT JOIN auf
            // `server_registry` verglich `varchar(36)` mit `int` und traf nie
            // etwas — die Tabelle hatte null Zeilen. CPU und RAM je Gameserver
            // waren auf dieser Seite deshalb immer leer.
            `SELECT gs.id AS server_id, gs.name AS server_name, gs.name AS display_name,
                    gs.template_name AS game_name, gs.status,
                    gs.current_players, gs.max_players,
                    gs.cpu_percent, gs.ram_used_mb, gs.ram_total_mb, gs.last_heartbeat,
                    gs.platz_belegt_bytes, gs.platz_grenze_bytes, gs.platz_ueber
             FROM gameservers gs
             WHERE gs.rootserver_id = ?
             ORDER BY gs.name ASC`,
            [rootserverId]
        );

        const gameserverStats = {
            total: gameservers.length,
            running: gameservers.filter(g => g.status === 'online').length,
            stopped: gameservers.filter(g => g.status === 'offline').length
        };

        // Wen ein Wechsel des Datenbank-Images trifft (K318): laufende Server
        // dieser Maschine mit mindestens einer Datenbank.
        const dbBetroffen = rootserver.db_image_neu
            ? await dbService.query(
                `SELECT DISTINCT gs.id, gs.name
                   FROM gameserver_datenbanken d
                   JOIN gameservers gs ON gs.id = d.server_id
                  WHERE gs.rootserver_id = ? AND gs.status = 'online'
                  ORDER BY gs.name`, [rootserverId])
            : [];

        // Sperre fürs Löschen (K375): steht schon im roten Fenster, nicht erst
        // in der Antwort der Route.
        const umzugsverlauf = await umzugsverlaufAn(dbService, rootserverId);

        await renderView(res, 'guild/masterserver-rootserver-detail', {
            title: `RootServer: ${rootserver.name}`,
            activeMenu: `/guild/${guildId}/plugins/masterserver/rootservers`,
            rootserver,
            isOnline,
            gameserverStats,
            gameservers,
            umzugsverlauf,
            dbBetroffen,
            guildId
        });

    } catch (error) {
        Logger.error('[Masterserver] RootServer Details Error:', error);
        res.status(500).render('error', { 
            message: 'Fehler beim Laden der RootServer-Details',
            error: error.message 
        });
    }
});

// =====================================================
// Route: RootServer bearbeiten (PUT)
// PUT /guild/:guildId/plugins/masterserver/rootservers/:id
// =====================================================
/**
 * SFTP-Wunsch an den verbundenen Daemon (sftp.anwenden) und seinen Befund
 * übernehmen. Ist er nicht verbunden, geschieht es bei der nächsten Anmeldung
 * (Absicht) — die Meldung sagt das.
 *
 * @returns {Promise<string|null>} ein Satz für die Rückmeldung, oder null bei Daemon ohne SFTP-Teil
 */
async function sftpAnwenden(rootserverId) {
    const Logger = ServiceManager.get('Logger');
    const neu = await RootServer.getById(rootserverId);
    const ipm = ServiceManager.has('ipmServer') ? ServiceManager.get('ipmServer') : null;
    if (!neu?.daemon_id || !ipm?.isDaemonOnline(neu.daemon_id)) {
        return 'gilt, sobald der Daemon sich wieder anmeldet';
    }
    try {
        const a = await ipm.sendCommand(neu.daemon_id, 'sftp.anwenden',
            { an: !!neu.sftp_gewuenscht, port: Number(neu.sftp_port_wunsch) || 0 }, 45000);
        const d = a?.data && typeof a.data === 'object' ? a.data : (a || {});
        const s = await RootServer.uebernimmSftp(neu.daemon_id, {
            port: d.sftp_port || null, grund: d.sftp_grund || null, fingerabdruck: d.sftp_fingerprint || null });
        return s?.grund || null;
    } catch (fehler) {
        // Ein Daemon vor der Steuerung kennt den Befehl nicht — dann gilt der
        // Wunsch bei der nächsten Anmeldung erst mit dem neuen Daemon.
        Logger.warn(`[Masterserver] SFTP nicht angewendet (Rootserver ${rootserverId}): ${fehler.message}`);
        return `noch nicht angewendet (${fehler.message})`;
    }
}

/**
 * Datenbank-Wunsch an den verbundenen Daemon (`datenbank.anwenden`, Stufe 11).
 *
 * Anders als bei SFTP wartet die Route nicht auf das Ergebnis: Das erste
 * Einschalten holt ein Image und wartet die Ersteinrichtung ab. Der Daemon
 * nimmt sofort an, der Zustand kommt als Ereignis `datenbank.befund`
 * (IPMServer → RootServer.uebernimmDatenbank). Bis dahin steht hier, was
 * gerade geschieht — nicht der alte Stand.
 *
 * @returns {Promise<string>} ein Satz für die Rückmeldung
 */
async function datenbankAnwenden(rootserverId) {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const neu = await RootServer.getById(rootserverId);
    const an = !!neu?.db_gewuenscht;
    const setze = (grund) => dbService.query(
        'UPDATE rootserver SET db_moeglich = 0, db_grund = ? WHERE id = ?', [grund, rootserverId]);
    const ipm = ServiceManager.has('ipmServer') ? ServiceManager.get('ipmServer') : null;
    if (!neu?.daemon_id || !ipm?.isDaemonOnline(neu.daemon_id)) {
        await setze(an ? 'Gewünscht — gilt, sobald der Daemon sich wieder anmeldet.' : 'Nicht angefordert.');
        return 'gilt, sobald der Daemon sich wieder anmeldet';
    }
    try {
        await ipm.sendCommand(neu.daemon_id, 'datenbank.anwenden', { an }, 15000);
        await setze(an ? 'Gewünscht — der Daemon richtet den Container fb-datenbank gerade ein.' : 'Nicht angefordert.');
        return an ? 'der Daemon richtet den Container ein, der Stand erscheint unter „Datenbanken"' : 'der Daemon stoppt den Container, die Daten bleiben erhalten';
    } catch (fehler) {
        // Ein Daemon vor 1.0.140 kennt den Befehl nicht.
        Logger.warn(`[Masterserver] Datenbanken nicht angewendet (Rootserver ${rootserverId}): ${fehler.message}`);
        await setze(an ? `Gewünscht, noch nicht angewendet: ${String(fehler.message).slice(0, 150)}` : 'Nicht angefordert.');
        return `noch nicht angewendet (${fehler.message})`;
    }
}


router.put('/:id', requirePermission('MASTERSERVER.ROOTSERVER.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const rootserverId = req.params.id;

    try {
        // RootServer laden und Berechtigung prüfen
        const rootserver = await RootServer.getById(rootserverId);

        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).json({
                success: false,
                message: 'RootServer nicht gefunden'
            });
        }

        const { name, host, hostname, datacenter, country_code, description, ram_total_gb, disk_total_gb,
                sftp_gewuenscht, sftp_port_wunsch, db_gewuenscht, db_je_server } = req.body;

        const portFehler = sftp_port_wunsch === undefined ? null
            : Maschinenbefund.sftpPortFehler(sftp_port_wunsch, await spielportBereich(rootserver.id));
        if (portFehler) return res.status(400).json({ success: false, message: portFehler });

        // Datenbanken: Fehlt das Häkchen im Formular (älteres Formular), bleibt alles, wie es ist.
        const dbAn = db_gewuenscht === undefined ? undefined : (db_gewuenscht === 'true' || db_gewuenscht === true);
        const dbFehler = dbAn === undefined ? null
            : dbGrenzeFehler(dbAn, db_je_server === undefined ? rootserver.db_je_server : db_je_server);
        if (dbFehler) return res.status(400).json({ success: false, message: dbFehler });

        // RootServer aktualisieren
        await RootServer.update(rootserverId, {
            name,
            host,
            hostname,
            datacenter,
            country_code,
            description,
            ram_total_gb:  ram_total_gb ? parseFloat(ram_total_gb) : undefined,
            disk_total_gb: disk_total_gb ? parseFloat(disk_total_gb) : undefined,
            // Fehlt das Feld, bleibt der Wunsch, wie er ist (älteres Formular).
            sftp_gewuenscht: sftp_gewuenscht === undefined ? undefined
                : (sftp_gewuenscht === 'true' || sftp_gewuenscht === true ? 1 : 0),
            sftp_port_wunsch: sftp_port_wunsch === undefined ? undefined
                : (String(sftp_port_wunsch).trim() ? Number(sftp_port_wunsch) : null),
            db_gewuenscht: dbAn === undefined ? undefined : (dbAn ? 1 : 0),
            db_je_server:  dbAn === undefined || db_je_server === undefined ? undefined : Number(db_je_server),
        });

        // SFTP sofort anwenden, nicht erst bei der nächsten Anmeldung (2026-10-27):
        // Der Daemon startet, stoppt oder verlegt den Dienst samt Firewall-Regel.
        const sftpMeldung = await sftpAnwenden(rootserver.id);
        // Datenbanken nur, wenn sich das Häkchen änderte: Ein zweites
        // „an" täte nichts, setzte aber den Grund kurz auf „wird eingerichtet".
        const dbMeldung = dbAn !== undefined && (dbAn ? 1 : 0) !== (rootserver.db_gewuenscht ? 1 : 0)
            ? await datenbankAnwenden(rootserver.id) : null;

        Logger.info(`[Masterserver] RootServer updated: ${rootserverId}`);

        res.json({
            success: true,
            message: 'RootServer erfolgreich aktualisiert' + (sftpMeldung ? ' — SFTP: ' + sftpMeldung : '')
                + (dbMeldung ? ' — Datenbanken: ' + dbMeldung : '')
        });

    } catch (error) {
        Logger.error('[Masterserver] RootServer Update Error:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Aktualisieren des RootServers',
            error: error.message
        });
    }
});

// Hier stand bis zum 2026-08-02 ein erstes `DELETE /:id`, das nur
// `RootServer.delete()` aufrief und an der Stelle des Gameserver-Checks ein
// blosses `// TODO` trug. Weil Express bei gleichem Pfad den zuerst
// registrierten Handler bedient, war es dieser — und der vollständige Handler
// weiter unten (Gameserver-Check + `virtual.delete` ans Daemon) lief nie.
// Ein RootServer liess sich damit mitsamt laufender Gameserver löschen, das
// Verzeichnis blieb auf der Maschine zurück.

// =====================================================
// Route: RootServer Status (Live-Daten)
// GET /guild/:guildId/plugins/masterserver/rootservers/:id/status
// =====================================================
router.get('/:id/status', requirePermission('MASTERSERVER.ROOTSERVER.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipmServer = ServiceManager.get('ipmServer');
    const guildId = res.locals.guildId;
    const rootserverId = req.params.id;

    try {
        // RootServer laden
        const rootserver = await RootServer.getById(rootserverId);

        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).json({
                success: false,
                message: 'RootServer nicht gefunden'
            });
        }

        // Online-Status prüfen
        const isOnline = ipmServer.isDaemonOnline(rootserver.daemon_id);

        // Live Hardware-Daten aus IPM-Verbindung
        const hw = isOnline ? (ipmServer.getDaemonHardware(rootserver.daemon_id) || {}) : {};
        const systemResources = {
            cpu_percent:  hw.cpu?.usage_percent  ?? rootserver.cpu_usage_percent  ?? null,
            ram_used_gb:  hw.ram?.used_gb        ?? rootserver.ram_usage_gb        ?? null,
            ram_total_gb: hw.ram?.total_gb       ?? rootserver.ram_total_gb        ?? null,
            disk_used_gb: hw.disk?.used_gb       ?? rootserver.disk_usage_gb       ?? null,
            disk_total_gb:hw.disk?.total_gb      ?? rootserver.disk_total_gb       ?? null,
            network:      hw.network             ?? null,
        };

        res.json({
            success: true,
            data: {
                status:          rootserver.daemon_status,
                isOnline,
                lastPingMs:      rootserver.last_ping_ms,
                version:         rootserver.daemon_version,
                osInfo:          rootserver.os_info,
                systemResources,
                // Stand von fb-datenbank (K318): Der Knopf „Jetzt wechseln"
                // fragt hier nach, bis der Daemon das Ergebnis gemeldet hat.
                datenbank: {
                    moeglich:  !!rootserver.db_moeglich,
                    grund:     rootserver.db_grund || null,
                    image:     rootserver.db_image || null,
                    image_neu: rootserver.db_image_neu || null,
                    wechsel:   rootserver.db_wechsel || null,
                },
            }
        });

    } catch (error) {
        Logger.error('[Masterserver] RootServer Status Error:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Abrufen des Status',
            error: error.message
        });
    }
});

// =====================================================
// Route: RootServer löschen
// DELETE /guild/:guildId/plugins/masterserver/rootservers/:id
// =====================================================
router.delete('/:id', requirePermission('MASTERSERVER.ROOTSERVER.DELETE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const ipmServer = ServiceManager.get('ipmServer');
    const guildId = res.locals.guildId;
    const rootserverId = req.params.id;

    try {
        Logger.info(`[Masterserver] RootServer ${rootserverId} wird gelöscht...`);

        // 1. RootServer aus DB laden
        const rootserver = await RootServer.getById(rootserverId);

        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).json({
                success: false,
                message: 'RootServer nicht gefunden oder keine Berechtigung'
            });
        }

        // Rote Rückfrage (K348): Der Name steht auch hier noch einmal, nicht
        // nur im Browser — ein Aufruf ohne Fenster löscht nichts aus Versehen.
        if (String(req.body?.bestaetigung || '').trim() !== rootserver.name) {
            return res.status(400).json({ success: false, message: 'Zum Löschen den Namen des RootServers eintippen.' });
        }

        // 2. Prüfen ob Gameserver darauf laufen
        const gameserverCount = await dbService.query(
            'SELECT COUNT(*) as count FROM gameservers WHERE rootserver_id = ?',
            [rootserverId]
        );

        if (gameserverCount[0].count > 0) {
            return res.status(400).json({
                success: false,
                message: `RootServer kann nicht gelöscht werden: ${gameserverCount[0].count} Gameserver noch aktiv!`
            });
        }

        // 2b. Laufender Umzug von oder zu der Maschine (K377). Vor dem Daemon
        //     prüfen — sonst wäre der Eintrag dort schon weg. Abgeschlossener
        //     Verlauf sperrt nicht mehr (bis K377: jeder Verlauf, 409).
        const verlauf = await umzugsverlaufAn(dbService, rootserverId);
        const laufend = verlauf.filter(v => Number(v.laufend) > 0);
        if (laufend.length > 0) {
            const namen = laufend.map(v => `„${v.name}“`).join(', ');
            return res.status(409).json({
                success: false,
                message: `RootServer kann gerade nicht gelöscht werden: Ein Umzug von oder zu dieser Maschine läuft (${namen}). `
                    + 'Wenn er fertig ist, geht es.'
            });
        }

        // 3. Virtual Server im Daemon löschen (wenn online)
        //    Adressiert wird der Daemon DIESES RootServers. Vorher stand hier
        //    `RootServer_getDaemon(guildId)`, also immer der erste RootServer der
        //    Guild — bei mehreren Maschinen ging der Löschbefehl an die falsche.
        if (ipmServer.isDaemonOnline(rootserver.daemon_id)) {
            try {
                Logger.info(`[Masterserver] Sende virtual.delete Command an Daemon für RootServer ${rootserverId}`);

                const deleteResponse = await ipmServer.sendCommand(rootserver.daemon_id, 'virtual.delete', {
                    daemon_id: rootserver.daemon_id,
                    rootserver_id: rootserverId
                }, 30000);

                if (deleteResponse.success) {
                    Logger.success(`[Masterserver] Virtual Server ${rootserverId} im Daemon gelöscht`);
                } else {
                    Logger.warn(`[Masterserver] Virtual Server konnte nicht gelöscht werden: ${deleteResponse.error}`);
                }
            } catch (deleteError) {
                Logger.error('[Masterserver] Virtual Server Delete Error:', deleteError);
                // Nicht kritisch - RootServer wird trotzdem aus DB gelöscht
            }
        } else {
            Logger.warn(`[Masterserver] Daemon offline - Virtual Server ${rootserverId} muss manuell gelöscht werden`);
        }

        // 4. Umzugsverlauf und RootServer aus der Datenbank löschen (K377).
        //    Eine Transaktion: Scheitert die Maschine, bleibt der Verlauf.
        //    Quotas, IPs und Ports nimmt CASCADE mit.
        const verlaufWeg = await dbService.transaction(async (verbindung) => {
            const [weg] = await verbindung.query(
                'DELETE FROM gameserver_migrations WHERE source_rootserver_id = ? OR target_rootserver_id = ?',
                [rootserverId, rootserverId]
            );
            await verbindung.query(
                'DELETE FROM rootserver WHERE id = ? AND guild_id = ?',
                [rootserverId, guildId]
            );
            return weg.affectedRows;
        });

        Logger.success(`[Masterserver] RootServer ${rootserverId} erfolgreich gelöscht (Umzugsverlauf: ${verlaufWeg} Zeile(n) mit)`);

        res.json({
            success: true,
            message: verlaufWeg > 0
                ? `RootServer gelöscht, ${verlaufWeg === 1 ? '1 Eintrag im Umzugsverlauf ging' : `${verlaufWeg} Einträge im Umzugsverlauf gingen`} mit.`
                : 'RootServer erfolgreich gelöscht!'
        });

    } catch (error) {
        Logger.error('[Masterserver] RootServer Delete Error:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Löschen des RootServers',
            error: error.message
        });
    }
});

// =====================================================
// Route: Vom Daemon bekannte Host-IPs (aus HardwareStats.Network)
// GET /guild/:guildId/plugins/masterserver/rootservers/:id/host-ips
// =====================================================
router.get('/:id/host-ips', requirePermission('MASTERSERVER.ROOTSERVER.VIEW'), async (req, res) => {
    const ipmServer = ServiceManager.get('ipmServer');
    const guildId = res.locals.guildId;
    const rootserverId = req.params.id;
    try {
        const rootserver = await RootServer.getById(rootserverId);
        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).json({ success: false, message: 'RootServer nicht gefunden' });
        }
        const hardware = ipmServer.getDaemonHardware(rootserver.daemon_id);
        if (!hardware || !hardware.network || !hardware.network.interfaces) {
            return res.json({ success: true, data: [] });
        }
        // Alle IPv4-Adressen aus physischen/echten Interfaces sammeln
        // Docker/virtuelle Bridge-Interfaces ausschließen
        const VIRTUAL_IFACE_PREFIXES = ['docker', 'br-', 'veth', 'virbr', 'cni', 'flannel', 'cali', 'tunl', 'weave'];
        const ips = [];
        for (const iface of hardware.network.interfaces) {
            if (iface.is_loopback || !iface.is_up) continue;
            // Virtuelle/Docker-Interfaces überspringen
            const name = (iface.name || '').toLowerCase();
            if (VIRTUAL_IFACE_PREFIXES.some(p => name.startsWith(p))) continue;
            for (const addr of (iface.addresses || [])) {
                // Nur IPv4 (kein ":" = kein IPv6), kein 127.x
                if (!addr.includes(':') && !addr.startsWith('127.')) {
                    // CIDR-Notation entfernen falls vorhanden
                    const ip = addr.split('/')[0];
                    ips.push({ ip, interface: iface.name });
                }
            }
        }
        res.json({ success: true, data: ips });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// =====================================================
// Route: IP-Adressen eines RootServers auflisten
// GET /guild/:guildId/plugins/masterserver/rootservers/:id/ips
// =====================================================
router.get('/:id/ips', requirePermission('MASTERSERVER.ROOTSERVER.VIEW'), async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const rootserverId = req.params.id;
    try {
        const rootserver = await RootServer.getById(rootserverId);
        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).json({ success: false, message: 'RootServer nicht gefunden' });
        }
        const ips = await dbService.query(
            'SELECT * FROM rootserver_ips WHERE rootserver_id = ? ORDER BY is_primary DESC, created_at ASC',
            [rootserverId]
        );
        res.json({ success: true, data: ips });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// =====================================================
// Route: IP-Adresse hinzufügen
// POST /guild/:guildId/plugins/masterserver/rootservers/:id/ips
// =====================================================
router.post('/:id/ips', requirePermission('MASTERSERVER.ROOTSERVER.EDIT'), async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const rootserverId = req.params.id;
    try {
        const rootserver = await RootServer.getById(rootserverId);
        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).json({ success: false, message: 'RootServer nicht gefunden' });
        }
        const { ip_address, label, is_primary } = req.body;
        if (!ip_address || !/^[\d.:a-fA-F]+$/.test(ip_address)) {
            return res.status(400).json({ success: false, message: 'Ungültige IP-Adresse' });
        }
        // Wenn neue IP primär → alle anderen nicht-primär setzen
        if (is_primary) {
            await dbService.query(
                'UPDATE rootserver_ips SET is_primary = 0 WHERE rootserver_id = ?',
                [rootserverId]
            );
        }
        const result = await dbService.query(
            'INSERT INTO rootserver_ips (rootserver_id, ip_address, label, is_primary) VALUES (?, ?, ?, ?)',
            [rootserverId, ip_address.trim(), label || null, is_primary ? 1 : 0]
        );
        res.json({ success: true, data: { id: result.insertId, ip_address, label, is_primary: !!is_primary } });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, message: 'Diese IP ist bereits eingetragen' });
        }
        res.status(500).json({ success: false, message: error.message });
    }
});

// =====================================================
// Route: Datenbank-Image wechseln (K318, 2026-11-08)
// POST /guild/:guildId/plugins/masterserver/rootservers/:id/datenbank/wechseln
//
// Der Daemon meldet ein neueres fb/mariadb:latest (db_image_neu); gewechselt
// wird nur hier, auf Knopfdruck — die Spiele mit Datenbank sind dabei einige
// Sekunden ohne sie. Kein eigener Befehl: `datenbank.anwenden` mit
// `image_wechseln`, der Fahrplan des Bahnhofs bleibt unverändert. Das Ergebnis
// kommt als Ereignis `datenbank.befund` (RootServer.uebernimmDatenbank).
// =====================================================
/** Anfang von db_grund, solange ein Wechsel läuft — die Seite fragt danach (Detailansicht). */
const WECHSEL_LAEUFT = 'Wechsel auf das Image';

router.post('/:id/datenbank/wechseln', requirePermission('MASTERSERVER.ROOTSERVER.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    try {
        const rootserver = await RootServer.getById(req.params.id);
        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).json({ success: false, message: 'RootServer nicht gefunden' });
        }
        if (!rootserver.db_gewuenscht || !rootserver.db_image_neu) {
            return res.status(409).json({ success: false, message: 'Es liegt kein neueres Datenbank-Image bereit.' });
        }
        const ipm = ServiceManager.has('ipmServer') ? ServiceManager.get('ipmServer') : null;
        if (!rootserver.daemon_id || !ipm?.isDaemonOnline(rootserver.daemon_id)) {
            return res.status(409).json({ success: false, message: 'Der Daemon ist nicht verbunden.' });
        }
        await ipm.sendCommand(rootserver.daemon_id, 'datenbank.anwenden', { an: true, image_wechseln: true }, 15000);
        await dbService.query('UPDATE rootserver SET db_moeglich = 0, db_grund = ? WHERE id = ?',
            [`${WECHSEL_LAEUFT} ${rootserver.db_image_neu} läuft — der Stand erscheint hier, sobald der Daemon ihn meldet.`,
                rootserver.id]);
        Logger.info(`[Masterserver] Datenbank-Image auf RootServer ${rootserver.id}: Wechsel ${rootserver.db_image} → ${rootserver.db_image_neu} angestoßen`);
        res.json({ success: true, message: 'Der Daemon wechselt das Image. Die Seite lädt neu, sobald er das Ergebnis meldet.', laeuft: WECHSEL_LAEUFT });
    } catch (error) {
        Logger.error('[Masterserver] Datenbank-Image nicht gewechselt:', error);
        res.status(500).json({ success: false, message: `Nicht gewechselt: ${error.message}` });
    }
});

// =====================================================
// Route: Token erneuern (FireBus Paket 5)
// POST /guild/:guildId/plugins/masterserver/rootservers/:id/token-erneuern
//
// Der neue Token fährt versiegelt zum Daemon, angezeigt wird er nie: Er wird
// nirgends von Hand gebraucht. Bis der Daemon unter ihm spricht, gilt der alte
// daneben weiter (IPMServer.erneuereToken).
// =====================================================
router.post('/:id/token-erneuern', requirePermission('MASTERSERVER.ROOTSERVER.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    try {
        const rootserver = await RootServer.getById(req.params.id);
        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).json({ success: false, message: 'RootServer nicht gefunden' });
        }
        // Wie beim Löschen der Logs: Der Name steht auch hier noch einmal, nicht nur im Browser.
        if (String(req.body?.bestaetigung || '').trim() !== rootserver.name) {
            return res.status(400).json({ success: false, message: 'Zum Bestätigen den Namen des RootServers eintippen.' });
        }
        const ergebnis = await ServiceManager.get('ipmServer').erneuereToken(rootserver.daemon_id);
        if (!ergebnis.success) {
            return res.status(409).json({ success: false, message: ergebnis.error });
        }
        Logger.info(`[Masterserver] Token für RootServer ${rootserver.id} erneuert`);
        res.json({ success: true, message: 'Der Daemon hat den neuen Token und verbindet sich neu. Ab dann gilt nur noch der neue.' });
    } catch (error) {
        Logger.error('[Masterserver] Token nicht erneuert:', error);
        res.status(500).json({ success: false, message: 'Der Token ließ sich nicht erneuern.' });
    }
});

// =====================================================
// Route: IP-Adresse entfernen
// DELETE /guild/:guildId/plugins/masterserver/rootservers/:id/ips/:ipId
// =====================================================
router.delete('/:id/ips/:ipId', requirePermission('MASTERSERVER.ROOTSERVER.EDIT'), async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const { id: rootserverId, ipId } = req.params;
    try {
        const rootserver = await RootServer.getById(rootserverId);
        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).json({ success: false, message: 'RootServer nicht gefunden' });
        }
        const [ip] = await dbService.query(
            'SELECT id, ip_address FROM rootserver_ips WHERE id = ? AND rootserver_id = ?',
            [ipId, rootserverId]
        );
        if (!ip) {
            return res.status(404).json({ success: false, message: 'IP nicht gefunden' });
        }
        // Rote Rückfrage (K348): Die Adresse steht auch hier noch einmal.
        if (String(req.body?.bestaetigung || '').trim() !== ip.ip_address) {
            return res.status(400).json({ success: false, message: 'Zum Entfernen die Adresse eintippen.' });
        }
        // Bis K348 stand hier nur der Kommentar „prüfen, ob ein Gameserver sie
        // nutzt" — geprüft wurde nichts. gameservers.bind_ip ist die Adresse,
        // an der ein Server lauscht (K304).
        const [{ n }] = await dbService.query(
            'SELECT COUNT(*) AS n FROM gameservers WHERE rootserver_id = ? AND bind_ip = ?',
            [rootserverId, ip.ip_address]
        );
        if (Number(n) > 0) {
            return res.status(409).json({ success: false,
                message: `${n} Gameserver ${Number(n) === 1 ? 'lauscht' : 'lauschen'} an ${ip.ip_address} — erst umziehen oder löschen.` });
        }
        await dbService.query('DELETE FROM rootserver_ips WHERE id = ?', [ipId]);
        res.json({ success: true, message: `${ip.ip_address} entfernt` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// =====================================================
// Route: IP als primär setzen
// PUT /guild/:guildId/plugins/masterserver/rootservers/:id/ips/:ipId/primary
// =====================================================
router.put('/:id/ips/:ipId/primary', requirePermission('MASTERSERVER.ROOTSERVER.EDIT'), async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const { id: rootserverId, ipId } = req.params;
    try {
        const rootserver = await RootServer.getById(rootserverId);
        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).json({ success: false, message: 'RootServer nicht gefunden' });
        }
        await dbService.query('UPDATE rootserver_ips SET is_primary = 0 WHERE rootserver_id = ?', [rootserverId]);
        await dbService.query('UPDATE rootserver_ips SET is_primary = 1 WHERE id = ? AND rootserver_id = ?', [ipId, rootserverId]);
        res.json({ success: true, message: 'Primäre IP gesetzt' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// =====================================================
// PORT ALLOCATIONS (Pterodactyl-Style)
// =====================================================

// GET /guild/:guildId/plugins/masterserver/rootservers/:id/allocations
// Liste aller Port-Allocations für einen RootServer
router.get('/:id/allocations', requirePermission('MASTERSERVER.ROOTSERVER.VIEW'), async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const rootserverId = req.params.id;
    try {
        const rootserver = await RootServer.getById(rootserverId);
        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).json({ success: false, message: 'RootServer nicht gefunden' });
        }

        const allocations = await dbService.query(
            `SELECT pa.*, g.name AS server_name 
             FROM port_allocations pa 
             LEFT JOIN gameservers g ON pa.server_id = g.id
             WHERE pa.rootserver_id = ? 
             ORDER BY pa.ip ASC, pa.port ASC`,
            [rootserverId]
        );

        // Zusammenfassung
        const total = allocations.length;
        const assigned = allocations.filter(a => a.server_id !== null).length;
        const free = total - assigned;

        res.json({ 
            success: true, 
            data: allocations,
            summary: { total, assigned, free }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /guild/:guildId/plugins/masterserver/rootservers/:id/allocations
// Port-Allocations hinzufügen (IP + Port-Range → wird zu Einzel-Rows expandiert)
router.post('/:id/allocations', requirePermission('MASTERSERVER.ROOTSERVER.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const rootserverId = req.params.id;

    try {
        const rootserver = await RootServer.getById(rootserverId);
        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).json({ success: false, message: 'RootServer nicht gefunden' });
        }

        const { ip, ip_alias, ports } = req.body;

        // Validierung: IP
        if (!ip || !/^[\d.]+$/.test(ip)) {
            return res.status(400).json({ success: false, message: 'Ungültige IP-Adresse' });
        }

        // Validierung: Ports (komma-separiert, einzelne Ports oder Ranges wie "25565-25600")
        if (!ports || typeof ports !== 'string') {
            return res.status(400).json({ success: false, message: 'Ports fehlen (z.B. "25565-25600" oder "25565,25566,25567")' });
        }

        // Ports parsen (wie Pterodactyl AssignmentService)
        const PORT_FLOOR = 1024;
        const PORT_CEIL = 65535;
        const PORT_RANGE_LIMIT = 10000;

        const portList = [];
        const parts = ports.split(',').map(p => p.trim()).filter(Boolean);

        for (const part of parts) {
            const rangeMatch = part.match(/^(\d{1,5})-(\d{1,5})$/);
            if (rangeMatch) {
                const start = parseInt(rangeMatch[1]);
                const end = parseInt(rangeMatch[2]);
                if (start < PORT_FLOOR || end > PORT_CEIL || start > end) {
                    return res.status(400).json({ success: false, message: `Ungültiger Port-Range: ${part} (erlaubt: ${PORT_FLOOR}-${PORT_CEIL})` });
                }
                if (end - start + 1 > PORT_RANGE_LIMIT) {
                    return res.status(400).json({ success: false, message: `Port-Range zu groß: ${part} (max. ${PORT_RANGE_LIMIT} Ports pro Range)` });
                }
                for (let p = start; p <= end; p++) {
                    portList.push(p);
                }
            } else {
                const port = parseInt(part);
                if (isNaN(port) || port < PORT_FLOOR || port > PORT_CEIL) {
                    return res.status(400).json({ success: false, message: `Ungültiger Port: ${part}` });
                }
                portList.push(port);
            }
        }

        if (portList.length === 0) {
            return res.status(400).json({ success: false, message: 'Keine gültigen Ports gefunden' });
        }

        // Duplikate entfernen
        const uniquePorts = [...new Set(portList)];

        // Insert mit INSERT IGNORE (vorhandene überspringen)
        const values = uniquePorts.map(port => [rootserverId, ip.trim(), ip_alias || null, port]);
        const placeholders = values.map(() => '(?, ?, ?, ?)').join(', ');
        const flatValues = values.flat();

        const result = await dbService.query(
            `INSERT IGNORE INTO port_allocations (rootserver_id, ip, ip_alias, port) VALUES ${placeholders}`,
            flatValues
        );

        const created = result.affectedRows || 0;
        const skipped = uniquePorts.length - created;

        Logger.info(`[Masterserver] Port-Allocations: ${created} erstellt, ${skipped} übersprungen für RS ${rootserverId} (${ip}, ${uniquePorts.length} Ports)`);

        res.json({
            success: true,
            message: `${created} Allocations erstellt${skipped > 0 ? `, ${skipped} bereits vorhanden` : ''}`,
            data: { created, skipped, total: uniquePorts.length }
        });

    } catch (error) {
        Logger.error('[Masterserver] Port-Allocation Create Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE /guild/:guildId/plugins/masterserver/rootservers/:id/allocations/:allocId
// Einzelne Allocation löschen (nur wenn nicht zugewiesen)
router.delete('/:id/allocations/:allocId', requirePermission('MASTERSERVER.ROOTSERVER.EDIT'), async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const { id: rootserverId, allocId } = req.params;

    try {
        const rootserver = await RootServer.getById(rootserverId);
        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).json({ success: false, message: 'RootServer nicht gefunden' });
        }

        // Prüfen ob Allocation existiert und frei ist
        const [alloc] = await dbService.query(
            'SELECT * FROM port_allocations WHERE id = ? AND rootserver_id = ?',
            [allocId, rootserverId]
        );
        if (!alloc) {
            return res.status(404).json({ success: false, message: 'Allocation nicht gefunden' });
        }
        if (alloc.server_id) {
            return res.status(400).json({ success: false, message: 'Allocation ist einem Gameserver zugewiesen und kann nicht gelöscht werden' });
        }
        // Rote Rückfrage (K374): Die Portnummer steht auch hier noch einmal.
        if (String(req.body?.bestaetigung || '').trim() !== String(alloc.port)) {
            return res.status(400).json({ success: false, message: 'Zum Löschen die Portnummer eintippen.' });
        }

        // `server_id IS NULL` noch einmal im Löschbefehl: Zwischen Lesen und
        // Löschen kann eine Vergabe den Port buchen (Besitzerfilter, K349).
        const ergebnis = await dbService.query(
            'DELETE FROM port_allocations WHERE id = ? AND rootserver_id = ? AND server_id IS NULL',
            [allocId, rootserverId]
        );
        if (!ergebnis.affectedRows) {
            return res.status(409).json({ success: false, message: 'Der Port wurde inzwischen vergeben — nichts gelöscht.' });
        }
        res.json({ success: true, message: 'Allocation gelöscht' });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE /guild/:guildId/plugins/masterserver/rootservers/:id/allocations-bulk
// Die ausgewählten freien Allocations löschen (Sammelaktion der Tabelle, K374).
//
// Bis 2026-11-12 löschte diese Route ALLE freien Allocations einer IP, ohne
// Rückfrage — und hatte keinen Aufrufer; die Tabelle rief je Zeile die
// Einzelroute und fragte mit confirm(). Jetzt: genau die mitgeschickten
// Kennungen, und die Zahl der Ports als Bestätigung.
router.delete('/:id/allocations-bulk', requirePermission('MASTERSERVER.ROOTSERVER.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const rootserverId = req.params.id;

    try {
        const rootserver = await RootServer.getById(rootserverId);
        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).json({ success: false, message: 'RootServer nicht gefunden' });
        }

        const roh = Array.isArray(req.body?.ids) ? req.body.ids : [];
        const ids = [...new Set(roh.map(Number).filter(n => Number.isInteger(n) && n > 0))];
        if (ids.length === 0 || ids.length !== roh.length) {
            return res.status(400).json({ success: false, message: 'Keine gültige Auswahl.' });
        }
        if (String(req.body?.bestaetigung || '').trim() !== String(ids.length)) {
            return res.status(400).json({ success: false, message: 'Zum Löschen die Zahl der ausgewählten Ports eintippen.' });
        }

        const platzhalter = ids.map(() => '?').join(',');
        const result = await dbService.query(
            `DELETE FROM port_allocations WHERE rootserver_id = ? AND server_id IS NULL AND id IN (${platzhalter})`,
            [rootserverId, ...ids]
        );
        const geloescht = Number(result.affectedRows) || 0;
        const uebersprungen = ids.length - geloescht;

        Logger.info(`[Masterserver] ${geloescht} freie Allocations gelöscht, ${uebersprungen} übersprungen (RS ${rootserverId})`);

        res.json({
            success: true,
            message: `${geloescht} ${geloescht === 1 ? 'Allocation' : 'Allocations'} gelöscht`
                + (uebersprungen > 0 ? `, ${uebersprungen} übersprungen (vergeben oder nicht mehr da)` : ''),
            data: { deleted: geloescht, skipped: uebersprungen }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
