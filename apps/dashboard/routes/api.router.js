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
 * Bot-Status in Guild prüfen (für automatische Weiterleitung nach Bot-Einladung)
 * @author firedervil
 */
router.get('/bot-status/:guildId', CheckAuth, authController.checkBotInGuild);


// Plugin-spezifische API-Endpunkte
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
 * Markiert eine Benachrichtigung als gelesen
 * @route POST /api/notifications/dismiss/:id
 */
router.post('/dismiss/:id', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const notificationManager = ServiceManager.get('notificationManager');
    try {
        if (!notificationManager) {
            return res.status(501).json({ success: false, message: 'Benachrichtigungssystem nicht verfügbar' });
        }
        
        const success = await notificationManager.dismissNotification(req.params.id);
        
        if (success) {
            return res.json({ success: true });
        } else {
            return res.status(404).json({ success: false, message: 'Benachrichtigung nicht gefunden' });
        }
    } catch (error) {
        Logger.error('Fehler beim Markieren der Benachrichtigung als gelesen:', error);
        return res.status(500).json({ success: false, message: 'Interner Serverfehler' });
    }
});

module.exports = router;