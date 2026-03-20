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
        if (!isAdminUser(req.session?.user?.id || req.session?.user?.info?.id)) {
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
        if (!isAdminUser(req.session?.user?.id || req.session?.user?.info?.id)) {
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

// Plugin-spezifische API-Endpunkte (AM ENDE!)
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

/**
 * Markiert eine Benachrichtigung als gelesen für den aktuellen User
 * @route POST /api/notifications/dismiss/:id
 * @security Authentifizierung erforderlich
 */
router.post('/notifications/dismiss/:id', CheckAuth, async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const notificationManager = ServiceManager.get('notificationManager');
    
    // ERWEITERES DEBUG LOGGING
    Logger.info('🔍 [DEBUG] Notification Dismiss Request:');
    Logger.info(`   - Notification ID: ${req.params.id}`);
    Logger.info(`   - Session existiert: ${!!req.session}`);
    Logger.info(`   - Session User: ${JSON.stringify(req.session?.user?.info || 'KEINE')}`);
    Logger.info(`   - req.user: ${JSON.stringify(req.user?.info || 'KEINE')}`);
    Logger.info(`   - Headers: ${JSON.stringify(req.headers.authorization || 'KEINE AUTH HEADER')}`);
    
    try {
        if (!notificationManager) {
            Logger.error('❌ NotificationManager nicht verfügbar!');
            return res.status(501).json({ success: false, message: 'Benachrichtigungssystem nicht verfügbar' });
        }

        // User-ID aus Session holen
        const userId = req.session?.user?.info?.id || req.user?.info?.id;
        Logger.info(`🎯 [DEBUG] Extrahierte User-ID: ${userId}`);
        
        if (!userId) {
            Logger.error('❌ Keine User-ID gefunden in Session!');
            return res.status(401).json({ success: false, message: 'Nicht authentifiziert' });
        }
        
        Logger.info(`📤 [DEBUG] Rufe notificationManager.dismissNotification(${req.params.id}, ${userId}) auf...`);
        const success = await notificationManager.dismissNotification(req.params.id, userId);
        Logger.info(`📥 [DEBUG] NotificationManager Ergebnis: ${success}`);
        
        if (success) {
            Logger.success(`✅ Notification ${req.params.id} erfolgreich dismissed für User ${userId}`);
            return res.json({ success: true });
        } else {
            Logger.error(`❌ NotificationManager dismiss fehlgeschlagen für Notification ${req.params.id}, User ${userId}`);
            return res.status(500).json({ success: false, message: 'Fehler beim Dismissing' });
        }
    } catch (error) {
        Logger.error('💥 [DEBUG] Fehler beim Markieren der Benachrichtigung als gelesen:', error);
        return res.status(500).json({ success: false, message: 'Interner Serverfehler' });
    }
});

module.exports = router;