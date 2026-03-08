const express = require("express");
const router = express.Router();
const { ServiceManager } = require("dunebot-core");

// Controllers
const guildController = require("../controllers/guild.controller");

// Middlewares
const pluginMiddleware = require("../middlewares/context/plugin.middleware");
const { CheckAuth, CheckGuildAccess } = require("../middlewares/auth.middleware");

// Kern-Routen
const permissionsRouter = require("./permissions.router");
const settingsRouter = require("./guild/settings.router");
const feedbackRouter = require("./guild/feedback.router");
const { donateRouter, hallOfFameRouter } = require('./guild/donations.router');
const pluginReloadRouter = require("./guild/plugin-reload.router");

// NEU: /guild (Index) → immer zuerst Server-Selector anzeigen
router.get("/", (req, res) => {
    return res.redirect("/auth/server-selector");
});


// Dashboard der gewählten Guild
router.get("/:guildId", CheckGuildAccess, guildController.getDashboard); 

// Kern-Settings-Routes (direkt, nicht über Plugin-System)
router.use("/:guildId/settings", CheckAuth, CheckGuildAccess, settingsRouter);

// Kern-Feedback-Routes (Bug Report, Feature Request, Toast History, My Feedback)
router.use("/:guildId/feedback", CheckAuth, CheckGuildAccess, feedbackRouter);

// Kern-Donations-Routes (Donate, Hall of Fame)
router.use("/:guildId/donate", CheckAuth, CheckGuildAccess, donateRouter);
router.use("/:guildId/hall-of-fame", CheckAuth, CheckGuildAccess, hallOfFameRouter);

// Plugin Guild Routen
router.get("/:guildId/plugins", CheckGuildAccess, guildController.getPlugins);
router.post("/:guildId/plugins", CheckGuildAccess, guildController.updatePlugins);

// Plugin Update Route
router.post("/:guildId/plugins/:pluginName/update", CheckGuildAccess, guildController.updatePluginVersion);

// Guild locales
router.get("/:guildId/locales", CheckGuildAccess, guildController.getLocales);

// Kern-Permissions-Routes (direkt, nicht über Plugin-System)
router.use("/:guildId/permissions", CheckAuth, CheckGuildAccess, permissionsRouter);

// Kern-Plugin-Reload Route
router.use("/:guildId/plugin-reload", CheckAuth, CheckGuildAccess, pluginReloadRouter);


// Plugin-spezifische Routen (MIT Auth-Check!)
router.use("/:guildId/plugins/:pluginName", CheckAuth, CheckGuildAccess, pluginMiddleware.loadPlugin, (req, res, next) => {
    const plugin = res.locals.plugin;
    const Logger = ServiceManager.get('Logger');

    if (!plugin || !plugin.guildRouter) {
        Logger.error('Plugin oder Router nicht gefunden:', {
            plugin: plugin ? plugin.name : 'nicht gefunden',
            hasRouter: plugin ? !!plugin.guildRouter : false,
            path: req.path
        });
        return res.status(404).render("error", { 
            message: "Plugin nicht gefunden oder kein Guild-Bereich verfügbar",
            error: { status: 404 }
        });
    }

    // Debug-Logging für Plugin-Routen (sichtbar auf info)
    Logger.info('Plugin-Route aufgerufen:', {
        plugin: plugin.name,
        path: req.path,
        method: req.method,
        guildId: req.params.guildId
    });

    // Zusätzliche Daten in res.locals setzen
    res.locals.currentPluginName = plugin.name;
    res.locals.currentPluginDisplayName = plugin.displayName || plugin.name;
    
    // Router des Plugins ausführen
    plugin.guildRouter(req, res, next);
});

module.exports = router;