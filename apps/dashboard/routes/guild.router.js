const express = require("express");
const router = express.Router();
const { ServiceManager } = require("dunebot-core");

// Controllers
const guildController = require("../controllers/guild.controller");

// Middlewares
const pluginMiddleware = require("../middlewares/context/plugin.middleware");
const { CheckAuth, CheckGuildAccess } = require("../middlewares/auth.middleware");

// NEU: /guild (Index) → immer zuerst Server-Selector anzeigen
router.get("/", (req, res) => {
    return res.redirect("/auth/server-selector");
});


// Dashboard der gewählten Guild
router.get("/:guildId", CheckGuildAccess, guildController.getDashboard); 

// Settings Route - Weiterleitung zum Core-Plugin
router.get("/:guildId/settings", CheckGuildAccess, (req, res) => {
    // Redirect zu Core Plugin Settings
    res.redirect(`/guild/${req.params.guildId}/plugins/core/settings`);
});

// Settings Subnav - Weiterleitung zum Core-Plugin
router.get("/:guildId/settings/:section", CheckGuildAccess, (req, res) => {
    res.redirect(`/guild/${req.params.guildId}/plugins/core/settings/${req.params.section}`);
});

// Plugin Guild Routen
router.get("/:guildId/plugins", CheckGuildAccess, guildController.getPlugins);
router.post("/:guildId/plugins", CheckGuildAccess, guildController.updatePlugins);

// Guild locales
router.get("/:guildId/locales", CheckGuildAccess, guildController.getLocales);

// Plugin-spezifische Routen (MIT Auth-Check!)
router.use("/:guildId/plugins/:pluginName", CheckGuildAccess, pluginMiddleware.loadPlugin, (req, res, next) => {
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

    // Debug-Logging für Plugin-Routen
    Logger.debug('Plugin-Route aufgerufen:', {
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