/**
 * Masterserver Plugin - Guild Routes
 * 
 * Alle guild-spezifischen Routen für das Masterserver-Plugin
 * - Dashboard (Übersicht)
 * - Daemon-Setup (Wizard)
 * - Server-Registry
 * - Daemon-Logs
 * 
 * @module masterserver/routes/guild
 * @author FireBot Team
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const RootServer = require('../models/RootServer');

// Helper: themeManager.renderView() wrapper
const renderView = async (res, viewPath, data) => {
    const themeManager = ServiceManager.get('themeManager');
    return await themeManager.renderView(res, viewPath, data);
};

// Helper: "Daemon" für eine Guild = erster/primärer RootServer
// Rückgabe hat daemon_id, daemon_status als status, daemon_version als version etc.
const getDaemonForGuild = async (guildId) => {
    const rootservers = await RootServer.getByGuild(guildId);
    if (!rootservers.length) return null;
    const rs = rootservers[0];
    // Backwards-compat Aliase für bestehenden Code
    rs.status           = rs.daemon_status;
    rs.version          = rs.daemon_version;
    rs.last_heartbeat   = rs.last_seen;
    rs.last_ping_latency = rs.last_ping_ms;
    return rs;
};

// =====================================================
// Route: Hauptmenü-Redirect
// URL: /guild/:guildId/plugins/masterserver
// Redirected zu: /dashboard
// =====================================================
router.get('/', requirePermission('MASTERSERVER.VIEW'), (req, res) => {
    const guildId = res.locals.guildId;
    res.redirect(`/guild/${guildId}/plugins/masterserver/dashboard`);
});

// =====================================================
// Route 1: Masterserver Dashboard (Hauptseite)
// URL: /guild/:guildId/plugins/masterserver/dashboard
// =====================================================
router.get('/dashboard', requirePermission('MASTERSERVER.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const ipmServer = ServiceManager.get('ipmServer');
    const guildId = res.locals.guildId;

    try {
        // Plugin-Kontext für i18n
        res.locals.pluginName = 'masterserver';
        req.params.pluginName = 'masterserver';

        // Daemon-Daten laden
        const daemon = await getDaemonForGuild(guildId);
        
        // Server-Statistiken für physische RootServer (nicht Gameserver!)
        const serverStats = await RootServer.getStats(guildId);

        // Online-Status vom IPMServer
        const isOnline = daemon ? ipmServer.isDaemonOnline(daemon.daemon_id) : false;

        await renderView(res, 'guild/masterserver-dashboard', {
            title: 'Masterserver Dashboard',
            activeMenu: `/guild/${guildId}/plugins/masterserver/dashboard`,
            daemon,
            isOnline,
            serverStats,
            guildId
        });

    } catch (error) {
        Logger.error('[Masterserver] Dashboard Error:', error);
        res.status(500).render('error', { 
            message: 'Fehler beim Laden des Dashboards',
            error: error.message 
        });
    }
});

// =====================================================
// Route 2: Daemon-Setup (Wizard)
// URL: /guild/:guildId/plugins/masterserver/daemon
// =====================================================
// Legacy: /daemon → redirect to /rootservers
router.get('/daemon', requirePermission('MASTERSERVER.VIEW'), (req, res) => {
    const guildId = res.locals.guildId;
    res.redirect(301, `/guild/${guildId}/plugins/masterserver/rootservers`);
});

// =====================================================
// Route 2b: Daemon Update-Info abrufen (API)
// URL: GET /guild/:guildId/plugins/masterserver/daemon/update-info
// =====================================================
router.get('/daemon/update-info', requirePermission('MASTERSERVER.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;

    try {
        // Daemon-Daten laden
        const daemon = await getDaemonForGuild(guildId);
        if (!daemon) {
            return res.status(404).json({
                success: false,
                message: 'Kein Daemon für diese Guild gefunden'
            });
        }

        // IPMServer abrufen und Update-Info aus Connection-Metadata holen
        const ipmServer = ServiceManager.get('ipmServer');
        if (!ipmServer) {
            return res.status(503).json({
                success: false,
                message: 'IPM-Server nicht verfügbar'
            });
        }

        const stand = ipmServer.daemonUpdateStand(daemon.daemon_id);
        if (!stand.online) {
            return res.json({
                success: true,
                updateInfo: null,
                daemonOnline: false
            });
        }

        const updateInfo = stand.updateAvailable ? {
            available: true,
            currentVersion: stand.version || daemon.daemon_version,
            latestVersion: stand.latestVersion
        } : null;

        res.json({
            success: true,
            updateInfo,
            daemonOnline: true
        });

    } catch (error) {
        Logger.error('[Masterserver] Update-Info Error:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Abrufen der Update-Info'
        });
    }
});

// =====================================================
// Route 2c: Daemon-Update triggern (POST)
// URL: POST /guild/:guildId/plugins/masterserver/daemon/trigger-update
// =====================================================
router.post('/daemon/trigger-update', requirePermission('MASTERSERVER.DAEMON.MANAGE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;

    try {
        // Daemon-Daten laden.
        // WICHTIG: Wenn der Client eine daemon_id mitsendet (RootServer-Übersicht hat
        // einen Update-Button PRO RootServer), muss genau DIESER Daemon geupdatet
        // werden — vorher wurde die daemon_id ignoriert und immer der erste
        // RootServer der Guild genommen (weitere Daemons waren nie updatebar).
        let daemon = null;
        const requestedDaemonId = req.body?.daemon_id;

        if (requestedDaemonId) {
            const rootservers = await RootServer.getByGuild(guildId);
            daemon = rootservers.find(rs => rs.daemon_id === requestedDaemonId) || null;
            if (!daemon) {
                return res.status(404).json({
                    success: false,
                    message: 'RootServer mit dieser daemon_id nicht gefunden (oder gehört nicht zu dieser Guild)'
                });
            }
        } else {
            daemon = await getDaemonForGuild(guildId);
        }

        if (!daemon) {
            return res.status(404).json({
                success: false,
                message: 'Kein Daemon für diese Guild gefunden'
            });
        }

        // IPMServer abrufen
        const ipmServer = ServiceManager.get('ipmServer');
        if (!ipmServer) {
            return res.status(503).json({
                success: false,
                message: 'IPM-Server nicht verfügbar'
            });
        }

        // Prüfen ob Daemon online
        const connection = ipmServer.connections.get(daemon.daemon_id);
        if (!connection) {
            return res.status(400).json({
                success: false,
                message: 'Daemon ist offline - Update nicht möglich'
            });
        }

        // Command an Daemon senden
        Logger.info(`[Masterserver] Triggere Daemon-Update für ${daemon.daemon_id}`);
        ipmServer.wache.kuendigeAn(daemon.daemon_id);
        
        const response = await ipmServer.sendCommand(daemon.daemon_id, 'daemon.update', {});
        
        if (response.success) {
            res.json({
                success: true,
                message: 'Update wird durchgeführt - Daemon startet neu'
            });
        } else {
            res.status(500).json({
                success: false,
                message: response.error || 'Update-Command fehlgeschlagen'
            });
        }

    } catch (error) {
        Logger.error('[Masterserver] Trigger Update Error:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Triggern des Updates'
        });
    }
});

// `POST /daemon/create` stand hier bis zum 2026-08-02. Das zugehörige Formular
// lag in `masterserver-daemon.ejs`, einer Seite, die seit dem Redirect auf
// /rootservers niemand mehr rendert. Die Route legte einen RootServer mit
// 127.0.0.1 als Vorgabe an und setzte `SETUP_WIZARD_STEP` — einen Wert, den
// keine Zeile je gelesen hat.

// Hier lag bis zum 2026-08-02 ein zweiter Weg, RootServer anzulegen und zu
// verwalten: /servers, /servers/create, /servers/:id/edit samt PUT und DELETE.
// Er schrieb in dieselbe Tabelle wie /rootservers, nur mit eigenem, von Hand
// gebautem INSERT — ohne fqdn und FastDL, mit sofortigem install_status
// 'completed' und einem zweiten API-Key, den nie jemand las. Benutzt wurde er
// nachweislich nie: beide RootServer im Bestand tragen eigene daemon_ids und
// einer ein fqdn, was nur über /rootservers entsteht. In der Navigation stand
// er nicht, und sein POST-Handler protokollierte den kompletten Request-Body
// samt SQL-Parametern per console.log am Logger vorbei.
//
// Wer einen weiteren RootServer braucht, nimmt /rootservers.

// =====================================================
// Route 5: Daemon-Logs
// URL: /guild/:guildId/plugins/masterserver/logs
//      …/logs/export   (JSON zum Herunterladen)
//      DELETE …/logs   (Löschen, Name eintippen)
//
// Bis 2026-11-03 zeigte die Seite nur die Logs des ERSTEN Rootservers der Guild
// (`getDaemonForGuild`), bei zwei Maschinen fehlte die zweite ganz. Export und
// Löschen riefen Routen, die es nie gab: Der Browser meldete beim Export, die
// Datei sei auf der Website nicht verfügbar, und gelöscht wurde nie etwas.
// Jetzt wählt man die Maschine, und alle drei Wege nehmen dieselbe Auswahl.
// =====================================================

const LOG_STUFEN = ['debug', 'info', 'warn', 'error'];
/** Mehr kommt nicht in eine Exportdatei; ein Daemon schreibt nur Ereignisse, kein Rauschen. */
const LOG_EXPORT_GRENZE = 50000;

/**
 * Welche Zeilen gemeint sind: Maschinen der Guild (alle oder eine) und Stufe.
 * Eine fremde daemon_id fällt hier heraus, nie in die Abfrage.
 */
async function logAuswahl(guildId, quelle) {
    const maschinen = await RootServer.getByGuild(guildId);
    const mitDaemon = maschinen.filter(m => m.daemon_id);
    const wunsch = String(quelle.daemon || '');
    const gewaehlt = mitDaemon.find(m => m.daemon_id === wunsch) || null;
    const ids = gewaehlt ? [gewaehlt.daemon_id] : mitDaemon.map(m => m.daemon_id);
    const level = LOG_STUFEN.includes(quelle.level) ? quelle.level : null;

    let wo = 'guild_id = ? AND daemon_id IN (?)';
    const werte = [guildId, ids];
    if (level) {
        wo += ' AND level = ?';
        werte.push(level);
    }
    return {
        maschinen: mitDaemon, gewaehlt, ids, level, wo, werte,
        namen: new Map(mitDaemon.map(m => [m.daemon_id, m.name])),
    };
}

/** Metadaten als Objekt: Sie stehen als JSON-Text in der Tabelle. */
function logMetadaten(roh) {
    try {
        const w = typeof roh === 'string' ? JSON.parse(roh) : roh;
        return w && typeof w === 'object' && Object.keys(w).length ? w : null;
    } catch {
        return null;
    }
}

router.get('/logs', requirePermission('MASTERSERVER.LOGS.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;

    try {
        res.locals.pluginName = 'masterserver';
        req.params.pluginName = 'masterserver';

        const a = await logAuswahl(guildId, req.query);
        if (!a.maschinen.length) {
            return res.redirect(`/guild/${guildId}/plugins/masterserver/rootservers`);
        }
        const limit = [50, 100, 200, 500].includes(parseInt(req.query.limit)) ? parseInt(req.query.limit) : 100;

        // `mysql2` setzt das Array hinter IN (?) selbst ein: query, nicht execute.
        // ── Namen gegen das echte Schema (Befund 2026-09-07) ──────────────
        // Die Ansicht liest timestamp, log_id, source und metadata als Objekt;
        // umgeformt wird hier, eine kaputte Zeile kostet ihr Feld, nicht die Seite.
        const roh = await dbService.rawQuery(
            `SELECT * FROM daemon_logs WHERE ${a.wo} ORDER BY created_at DESC, id DESC LIMIT ?`,
            [...a.werte, limit]);
        const logs = (roh || []).map((z) => ({
            ...z,
            log_id: z.id,
            timestamp: z.created_at,
            source: z.event_type || 'daemon',
            aktion: z.action || null,
            maschine: a.namen.get(z.daemon_id) || z.daemon_id,
            metadata: logMetadaten(z.metadata),
        }));

        const [stats] = await dbService.rawQuery(
            `SELECT COUNT(*) AS total,
                    SUM(level = 'error') AS errors, SUM(level = 'warn') AS warnings, SUM(level = 'info') AS info
               FROM daemon_logs WHERE guild_id = ? AND daemon_id IN (?)`, [guildId, a.ids]);

        const retentionDays = parseInt(await dbService.getConfig('masterserver', 'LOG_RETENTION_DAYS', 'shared', guildId) || '30');

        await renderView(res, 'guild/masterserver-logs', {
            title: 'Daemon-Logs',
            activeMenu: `/guild/${guildId}/plugins/masterserver/logs`,
            maschinen: a.maschinen.map(m => ({ daemon_id: m.daemon_id, name: m.name, id: m.id })),
            gewaehlt: a.gewaehlt ? a.gewaehlt.daemon_id : '',
            logs,
            level: a.level,
            limit,
            stats: {
                total: Number(stats?.total) || 0, errors: Number(stats?.errors) || 0,
                warnings: Number(stats?.warnings) || 0, info: Number(stats?.info) || 0,
            },
            retentionDays,
            guildId
        });

    } catch (error) {
        Logger.error('[Masterserver] Logs Error:', error);
        res.status(500).render('error', {
            message: 'Fehler beim Laden der Logs',
            error: error.message
        });
    }
});

router.get('/logs/export', requirePermission('MASTERSERVER.LOGS.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;

    try {
        const a = await logAuswahl(guildId, req.query);
        if (!a.maschinen.length) return res.status(404).json({ success: false, message: 'Kein Rootserver mit Daemon.' });

        const roh = await dbService.rawQuery(
            `SELECT * FROM daemon_logs WHERE ${a.wo} ORDER BY created_at, id LIMIT ?`,
            [...a.werte, LOG_EXPORT_GRENZE]);
        const zeilen = (roh || []).map(z => ({
            zeit: z.created_at,
            maschine: a.namen.get(z.daemon_id) || null,
            daemon_id: z.daemon_id,
            level: z.level,
            typ: z.event_type,
            aktion: z.action,
            meldung: z.message,
            metadaten: logMetadaten(z.metadata),
        }));

        const teil = a.gewaehlt ? a.gewaehlt.name : 'alle';
        const datei = `daemon-logs-${teil}-${new Date().toISOString().slice(0, 10)}.json`
            .replace(/[^A-Za-z0-9._-]+/g, '-');
        res.setHeader('Content-Disposition', `attachment; filename="${datei}"`);
        res.type('application/json').send(JSON.stringify({
            erstellt: new Date().toISOString(),
            maschinen: a.gewaehlt ? [a.gewaehlt.name] : a.maschinen.map(m => m.name),
            level: a.level,
            anzahl: zeilen.length,
            gekappt: zeilen.length >= LOG_EXPORT_GRENZE,
            zeilen,
        }, null, 2));
    } catch (error) {
        Logger.error('[Masterserver] Log-Export fehlgeschlagen:', error);
        res.status(500).json({ success: false, message: 'Der Export ist fehlgeschlagen.' });
    }
});

/**
 * Löscht die Logs der gewählten Maschine, oder aller Maschinen der Guild.
 * Verlangt den eingetippten Namen auch hier, nicht nur im Fenster: Ein Aufruf
 * ohne Fenster soll nicht aus Versehen alles leeren.
 */
router.delete('/logs', requirePermission('MASTERSERVER.DAEMON.MANAGE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;

    try {
        const a = await logAuswahl(guildId, { daemon: req.body?.daemon });
        if (!a.maschinen.length) return res.status(404).json({ success: false, message: 'Kein Rootserver mit Daemon.' });
        const soll = a.gewaehlt ? a.gewaehlt.name : 'ALLE';
        if (String(req.body?.bestaetigung || '').trim() !== soll) {
            return res.status(400).json({ success: false, message: `Zum Löschen „${soll}" eintippen.` });
        }

        const ergebnis = await dbService.rawQuery(`DELETE FROM daemon_logs WHERE ${a.wo}`, a.werte);
        const anzahl = ergebnis?.affectedRows || 0;
        const info = req.session?.user?.info || {};
        const wer = info.username ? `${info.username} (${info.id})` : String(info.id || 'unbekannt');
        Logger.info(`[Masterserver] ${anzahl} Daemon-Log(s) gelöscht von ${wer}: ${soll}`);

        // Eine Spur bleibt: Wer leert, steht danach als erste Zeile im Log.
        const ipm = ServiceManager.has('ipmServer') ? ServiceManager.get('ipmServer') : null;
        for (const id of a.ids) {
            await ipm?._logDaemonEvent(id, 'logs_geloescht', { von: wer, anzahl });
        }

        res.json({ success: true, anzahl, message: `${anzahl} Log-Einträge gelöscht.` });
    } catch (error) {
        Logger.error('[Masterserver] Logs löschen fehlgeschlagen:', error);
        res.status(500).json({ success: false, message: 'Die Logs ließen sich nicht löschen.' });
    }
});

// Hier standen bis zum 2026-08-02 ein zweites `POST /tokens/generate` und ein
// zweites `GET /`. Express bedient bei gleichem Pfad immer den zuerst
// registrierten Handler — beide waren unerreichbar.

module.exports = router;
