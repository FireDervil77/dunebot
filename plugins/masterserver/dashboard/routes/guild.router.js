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

        const connection = ipmServer.connections.get(daemon.daemon_id);
        if (!connection) {
            return res.json({
                success: true,
                updateInfo: null,
                daemonOnline: false
            });
        }

        const meta = connection.metadata;
        const updateInfo = meta.updateAvailable ? {
            available: true,
            currentVersion: meta.version || daemon.daemon_version,
            latestVersion: meta.latestVersion
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
// =====================================================
router.get('/logs', requirePermission('MASTERSERVER.LOGS.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;

    try {
        res.locals.pluginName = 'masterserver';
        req.params.pluginName = 'masterserver';

        // Daemon prüfen
        const daemon = await getDaemonForGuild(guildId);
        if (!daemon) {
            return res.redirect(`/guild/${guildId}/plugins/masterserver/rootservers`);
        }

        // Filter aus Query-Params
        const level = req.query.level || null;
        const limit = parseInt(req.query.limit) || 100;

        // Logs laden
        let query = `
            SELECT * FROM daemon_logs 
            WHERE daemon_id = ?
        `;
        const params = [daemon.daemon_id];

        if (level) {
            query += ' AND level = ?';
            params.push(level);
        }

        query += ' ORDER BY created_at DESC LIMIT ?';
        params.push(limit);

        const logs = await dbService.query(query, params);

        // Stats berechnen
        const statsQuery = `
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) as errors,
                SUM(CASE WHEN level = 'warn' THEN 1 ELSE 0 END) as warnings,
                SUM(CASE WHEN level = 'info' THEN 1 ELSE 0 END) as info
            FROM daemon_logs 
            WHERE daemon_id = ?
        `;
        const statsResult = await dbService.query(statsQuery, [daemon.daemon_id]);
        const stats = statsResult[0] || { total: 0, errors: 0, warnings: 0, info: 0 };

        // Retention-Days aus Config
        const retentionDays = parseInt(await dbService.getConfig('masterserver', 'LOG_RETENTION_DAYS', 'shared', guildId) || '30');

        await renderView(res, 'guild/masterserver-logs', {
            title: 'Daemon-Logs',
            activeMenu: `/guild/${guildId}/plugins/masterserver/logs`,
            daemon,
            logs,
            level,
            limit,
            stats,
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

// Hier standen bis zum 2026-08-02 ein zweites `POST /tokens/generate` und ein
// zweites `GET /`. Express bedient bei gleichem Pfad immer den zuerst
// registrierten Handler — beide waren unerreichbar.

module.exports = router;
