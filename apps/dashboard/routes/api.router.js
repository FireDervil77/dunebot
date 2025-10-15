const express = require("express");
const router = express.Router();
const { ServiceManager } = require("dunebot-core");

// Controllers
const apiController = require("../controllers/api.controller");
const authController = require("../controllers/auth.controller"); // Controller für Bot-Status-Check hinzufügen

// Middlewares
const pluginMiddleware = require("../middlewares/context/plugin.middleware");
const { CheckAuth } = require("../middlewares/auth.middleware");


// Basis-API-Endpunkte
router.get("/user", apiController.getUserInfo);
router.get("/guilds", apiController.getGuilds);
router.get("/guilds/:guildId", apiController.getGuildInfo);

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
 * TEST-Route um API-Erreichbarkeit zu prüfen (ohne Auth)
 * @route GET /api/test
 */
router.get('/test', (req, res) => {
    const Logger = ServiceManager.get('Logger');
    Logger.info('🧪 [TEST] API Test-Route aufgerufen');
    res.json({ 
        success: true, 
        message: 'API ist erreichbar',
        timestamp: new Date().toISOString(),
        session: !!req.session,
        user: req.session?.user?.info?.id || 'NICHT EINGELOGGT'
    });
});

/**
 * Anonymer Session-Test (keine Auth)
 * @route GET /api/session-test
 */
router.get('/session-test', (req, res) => {
    const Logger = ServiceManager.get('Logger');
    Logger.info('🧪 [SESSION-TEST] Anonymer Session-Test aufgerufen');
    res.json({ 
        success: true, 
        message: 'Session-Test erfolgreich',
        sessionExists: !!req.session,
        sessionId: req.session?.id || 'NO_SESSION',
        timestamp: new Date().toISOString()
    });
});

/**
 * Session-Statistiken (nur für Admins)
 * @route GET /api/sessions/stats
 */
router.get('/sessions/stats', CheckAuth, async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const sessionManager = ServiceManager.get('sessionManager');
    
    try {
        // Nur für SuperAdmin
        if (!req.session?.user?.info?.isSuperAdmin) {
            return res.status(403).json({
                success: false,
                message: 'Nur für SuperAdmins'
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
        // Nur für SuperAdmin
        if (!req.session?.user?.info?.isSuperAdmin) {
            return res.status(403).json({
                success: false,
                message: 'Nur für SuperAdmins'
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

// Plugin-spezifische API-Endpunkte (AM ENDE!)
router.use("/:pluginName", pluginMiddleware.loadPlugin, (req, res, next) => {
    const plugin = res.locals.plugin;
    if (!plugin || !plugin.apiRouter) {
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
 */
router.post('/notifications/dismiss/:id', async (req, res) => {
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