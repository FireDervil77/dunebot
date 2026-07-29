const express = require("express");
const router = express.Router();
const { ServiceManager } = require("dunebot-core");

// Controllers
const apiController = require("../controllers/api.controller");
const authController = require("../controllers/auth.controller"); // Controller für Bot-Status-Check hinzufügen

// Middlewares
const pluginMiddleware = require("../middlewares/context/plugin.middleware");
const { CheckAuth } = require("../middlewares/auth.middleware");


// Basis-API-Endpunkte (mit Authentication!)
router.get("/user", CheckAuth, apiController.getUserInfo);
router.get("/guilds", CheckAuth, apiController.getGuilds);
router.get("/guilds/:guildId", CheckAuth, apiController.getGuildInfo);

/**
 * Spracheinstellung des Benutzers aktualisieren
 * @route POST /api/language
 * @author firedervil
 */
router.post('/language', CheckAuth, apiController.updateDashboardLanguage);

/**
 * Spracheinstellung für Gäste (ohne Authentifizierung)
 * @route POST /api/language/guest
 * @author firedervil
 */
router.post('/language/guest', apiController.updateGuestLanguage);

/**
 * Bot-Status in Guild prüfen (für automatische Weiterleitung nach Bot-Einladung)
 * @author firedervil
 */
router.get('/bot-status/:guildId', CheckAuth, authController.checkBotInGuild);

/**
 * TEST-Route um API-Erreichbarkeit zu prüfen (NUR FÜR DEVELOPMENT!)
 * @route GET /api/test
 * @security Nur in NODE_ENV=development verfügbar
 */
if (process.env.NODE_ENV === 'development') {
    router.get('/test', (req, res) => {
        const Logger = ServiceManager.get('Logger');
        Logger.info('🧪 [TEST] API Test-Route aufgerufen');
        res.json({ 
            success: true, 
            message: 'API ist erreichbar (DEV MODE)',
            timestamp: new Date().toISOString(),
            session: !!req.session,
            user: req.session?.user?.info?.id || 'NICHT EINGELOGGT'
        });
    });

    /**
     * Anonymer Session-Test (NUR FÜR DEVELOPMENT!)
     * @route GET /api/session-test
     */
    router.get('/session-test', (req, res) => {
        const Logger = ServiceManager.get('Logger');
        Logger.info('🧪 [SESSION-TEST] Anonymer Session-Test aufgerufen');
        res.json({ 
            success: true, 
            message: 'Session-Test erfolgreich (DEV MODE)',
            sessionExists: !!req.session,
            sessionId: req.session?.id || 'NO_SESSION',
            timestamp: new Date().toISOString()
        });
    });
}

/**
 * Session-Statistiken (nur für Admins)
 * @route GET /api/sessions/stats
 */
router.get('/sessions/stats', CheckAuth, async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const sessionManager = ServiceManager.get('sessionManager');
    
    try {
        // Nur für Admins (OWNER_IDS)
        const { isAdminUser } = require('../middlewares/admin.middleware');
        if (!isAdminUser(req.session?.user)) {
            return res.status(403).json({
                success: false,
                message: 'Zugriff verweigert'
            });
        }

        const stats = await sessionManager.getSessionStats();
        
        if (!stats) {
            return res.status(500).json({
                success: false,
                message: 'Fehler beim Abruf der Session-Statistiken'
            });
        }
        
        Logger.info(`📊 Session-Stats abgerufen: ${JSON.stringify(stats)}`);
        
        res.json({
            success: true,
            data: stats
        });
        
    } catch (error) {
        Logger.error('❌ Fehler beim Abruf der Session-Stats:', error);
        res.status(500).json({
            success: false,
            message: 'Interner Serverfehler'
        });
    }
});

/**
 * Manuelles Session-Cleanup (nur für Admins)
 * @route POST /api/sessions/cleanup
 */
router.post('/sessions/cleanup', CheckAuth, async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const sessionManager = ServiceManager.get('sessionManager');
    
    try {
        // Nur für Admins (OWNER_IDS)
        const { isAdminUser } = require('../middlewares/admin.middleware');
        if (!isAdminUser(req.session?.user)) {
            return res.status(403).json({
                success: false,
                message: 'Zugriff verweigert'
            });
        }

        const cleanedCount = await sessionManager.cleanupExpiredSessions();
        
        Logger.info(`🧹 Manuelles Session-Cleanup: ${cleanedCount} Sessions bereinigt`);
        
        res.json({
            success: true,
            message: `${cleanedCount} abgelaufene Sessions bereinigt`,
            cleaned: cleanedCount
        });
        
    } catch (error) {
        Logger.error('❌ Fehler beim manuellen Session-Cleanup:', error);
        res.status(500).json({
            success: false,
            message: 'Interner Serverfehler'
        });
    }
});

// Kern-API-Endpunkte (Toast, Donations, Notifications)
router.use('/core', CheckAuth, require('./api/kern.router'));

/**
 * Bot-Guilds abrufen (für Admin-Dropdowns wie Notification-Targeting)
 * @route GET /api/bot-guilds
 * @security Admin-only
 */
router.get('/bot-guilds', CheckAuth, async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const { isAdminUser } = require('../middlewares/admin.middleware');
    if (!isAdminUser(req.session?.user)) {
        return res.status(403).json({ success: false, error: 'Zugriff verweigert' });
    }
    try {
        const ipcServer = ServiceManager.get('ipcServer');
        const responses = await ipcServer.broadcast('dashboard:GET_BOT_GUILDS');
        const allBotGuilds = responses
            .filter(r => r && r.success)
            .flatMap(r => r.data || []);

        // Nur Guilds anzeigen, auf denen der User mindestens Administrator ist
        const userGuilds = req.session?.user?.guilds || [];
        const adminGuildIds = new Set(
            userGuilds
                .filter(g => (g.permissions & 0x8) === 0x8) // ADMINISTRATOR bit
                .map(g => g.id)
        );
        const guilds = allBotGuilds.filter(g => adminGuildIds.has(g.id));

        res.json({ success: true, guilds });
    } catch (error) {
        Logger.error('[API] Fehler beim Abrufen der Bot-Guilds:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Text-Channels einer Guild abrufen (für Channel-Picker in Notifications)
 * @route GET /api/guild-channels/:guildId
 * @security Admin-only
 */
router.get('/guild-channels/:guildId', CheckAuth, async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const { isAdminUser } = require('../middlewares/admin.middleware');
    if (!isAdminUser(req.session?.user)) {
        return res.status(403).json({ success: false, error: 'Zugriff verweigert' });
    }
    try {
        const ipcServer = ServiceManager.get('ipcServer');
        const responses = await ipcServer.broadcast('dashboard:GET_GUILD_CHANNELS', { guildId: req.params.guildId });
        const result = responses.find(r => r && r.success);
        if (result) {
            res.json({ success: true, channels: result.channels || [] });
        } else {
            res.json({ success: true, channels: [] });
        }
    } catch (error) {
        Logger.error('[API] Fehler beim Abrufen der Guild-Channels:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Markiert eine Benachrichtigung als gelesen für den aktuellen User
 * @route POST /api/notifications/dismiss/:id
 * @security Authentifizierung erforderlich
 */
router.post('/notifications/dismiss/:id', CheckAuth, async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const notificationManager = ServiceManager.get('notificationManager');
    
    try {
        if (!notificationManager) {
            return res.status(501).json({ success: false, message: 'Benachrichtigungssystem nicht verfügbar' });
        }

        const userId = req.session?.user?.info?.id || req.user?.info?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Nicht authentifiziert' });
        }
        
        const success = await notificationManager.dismissNotification(req.params.id, userId);
        
        if (success) {
            return res.json({ success: true });
        } else {
            return res.status(500).json({ success: false, message: 'Fehler beim Dismissing' });
        }
    } catch (error) {
        Logger.error('[API] Fehler beim Dismiss:', error);
        return res.status(500).json({ success: false, message: 'Interner Serverfehler' });
    }
});

// Plugin-spezifische API-Endpunkte (AM ENDE!)
// ============================================================================
// Migration-Streaming (Daemon ↔ Dashboard) — Token-Auth, KEINE Session!
// Der Quell-Daemon streamt das Migrations-Backup hoch (PUT), der Ziel-Daemon
// lädt es herunter (GET). Ersetzt den Base64-über-WebSocket-Transfer, der am
// ws-maxPayload-Limit (~100 MiB) scheiterte. Auth: pro Migration generierter
// Einmal-Token (MigrationManager), als Bearer-Header.
// ============================================================================

function getMigrationManager() {
    try {
        const path = require('path');
        return require(path.join(__dirname, '../../../plugins/gameserver/dashboard/helpers/MigrationManager.js'));
    } catch (err) {
        return null;
    }
}

function getTransferAuth(req) {
    const migrationManager = getMigrationManager();
    if (!migrationManager || typeof migrationManager.validateTransfer !== 'function') return { error: 'MigrationManager nicht verfügbar', status: 503 };

    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const transfer = migrationManager.validateTransfer(req.params.migrationId, token);
    if (!transfer) return { error: 'Ungültiger oder abgelaufener Transfer-Token', status: 403 };

    return { transfer };
}

// Upload: Quell-Daemon → Dashboard (Body wird direkt auf Platte gestreamt)
router.put('/migration/:migrationId/stream', (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const fs = require('fs');

    const auth = getTransferAuth(req);
    if (auth.error) return res.status(auth.status).json({ success: false, message: auth.error });
    const { filePath } = auth.transfer;

    Logger.info(`[MigrationStream] Upload startet: Migration ${req.params.migrationId} → ${filePath}`);

    const writeStream = fs.createWriteStream(filePath);
    let failed = false;

    // Fortschritt melden (max. alle 2 s), damit das UI bei großen Dateien
    // nicht minutenlang eingefroren wirkt
    const migrationManager = getMigrationManager();
    let received = 0;
    let lastReport = 0;
    req.on('data', (chunk) => {
        received += chunk.length;
        const now = Date.now();
        if (now - lastReport > 2000) {
            lastReport = now;
            try { migrationManager?.reportTransferProgress?.(req.params.migrationId, received, 'upload'); } catch (_) {}
        }
    });

    const fail = (status, msg, err) => {
        if (failed) return;
        failed = true;
        Logger.error(`[MigrationStream] Upload fehlgeschlagen (Migration ${req.params.migrationId}): ${err?.message || msg}`);
        try { writeStream.destroy(); } catch (_) {}
        try { fs.unlinkSync(filePath); } catch (_) {}
        if (!res.headersSent) res.status(status).json({ success: false, message: msg });
    };

    req.on('error', (err) => fail(400, 'Upload-Stream abgebrochen', err));
    writeStream.on('error', (err) => fail(500, 'Schreiben fehlgeschlagen', err));
    writeStream.on('finish', () => {
        if (failed) return;
        try {
            const size = fs.statSync(filePath).size;
            Logger.success(`[MigrationStream] Upload komplett: Migration ${req.params.migrationId} (${(size / 1024 / 1024).toFixed(1)} MB)`);
            res.json({ success: true, bytes: size });
        } catch (err) {
            fail(500, 'Upload-Verifikation fehlgeschlagen', err);
        }
    });

    req.pipe(writeStream);
});

// Download: Dashboard → Ziel-Daemon (Datei wird gestreamt)
router.get('/migration/:migrationId/stream', (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const fs = require('fs');

    const auth = getTransferAuth(req);
    if (auth.error) return res.status(auth.status).json({ success: false, message: auth.error });
    const { filePath } = auth.transfer;

    let stat;
    try {
        stat = fs.statSync(filePath);
    } catch (err) {
        return res.status(404).json({ success: false, message: 'Backup-Datei (noch) nicht vorhanden' });
    }

    Logger.info(`[MigrationStream] Download startet: Migration ${req.params.migrationId} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', stat.size);

    const readStream = fs.createReadStream(filePath);
    readStream.on('error', (err) => {
        Logger.error(`[MigrationStream] Download fehlgeschlagen (Migration ${req.params.migrationId}):`, err.message);
        if (!res.headersSent) res.status(500).json({ success: false, message: 'Lesen fehlgeschlagen' });
        else res.destroy();
    });
    readStream.pipe(res);
});

// HINWEIS: Plugins MÜSSEN CheckAuth selbst in ihren Routen verwenden!
// Das Base-API-System schützt nicht automatisch alle Plugin-Endpunkte
router.use("/:pluginName", pluginMiddleware.loadPlugin, (req, res, next) => {
    const Logger = ServiceManager.get('Logger');
    const plugin = res.locals.plugin;
    
    if (!plugin || !plugin.apiRouter) {
        Logger.warn(`[API Security] Plugin ${req.params.pluginName} nicht gefunden oder keine API`);
        return res.status(404).json({ 
            success: false,
            error: "Plugin nicht gefunden oder keine API verfügbar"
        });
    }

    // Plugin-API-Router einbinden
    plugin.apiRouter(req, res, next);
});

module.exports = router;