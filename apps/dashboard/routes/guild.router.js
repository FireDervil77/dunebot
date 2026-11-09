const express = require("express");
const router = express.Router();
const { ServiceManager } = require("dunebot-core");

// Controllers
const guildController = require("../controllers/guild.controller");

// Middlewares
const pluginMiddleware = require("../middlewares/context/plugin.middleware");
const Wissen = require("../helpers/Wissen");
const { CheckAuth, CheckGuildAccess } = require("../middlewares/auth.middleware");
const { loadUserPermissions } = require("../middlewares/permissions.middleware");

// Kern-Routen
// Rechte des Nutzers fuer ALLE Guild-Seiten bereitstellen.
//
// Bisher lief das nur im permissions.router und im gameserver-Plugin. Ueberall
// sonst war res.locals.userPermissions leer — eine Rechtepruefung in einer View
// sagte dort also immer "nein", ohne dass etwas im Log stand. Die Middleware
// faengt eigene Fehler ab und setzt notfalls leere Rechte.
router.use("/:guildId", loadUserPermissions);

const permissionsRouter = require("./permissions.router");
const settingsRouter = require("./guild/settings.router");
const profileRouter = require("./guild/profile.router");
const feedbackRouter = require("./guild/feedback.router");
const { donateRouter, hallOfFameRouter } = require('./guild/donations.router');
const pluginReloadRouter = require("./guild/plugin-reload.router");
const themesRouter = require("./guild/themes.router");
const mediaRouter = require("./guild/media.router");

// NEU: /guild (Index) → immer zuerst Server-Selector anzeigen
router.get("/", (req, res) => {
    return res.redirect("/auth/server-selector");
});


// Dashboard der gewählten Guild
router.get("/:guildId", CheckGuildAccess, guildController.getDashboard); 

// Eigenes Profil. **Kein requirePermission** — die Seite gehoert dem
// Angemeldeten selbst. Bis zum 2026-08-26 fehlte diese Zeile ganz, waehrend
// das Nutzermenue seit jeher darauf verwies (Baustelle 73): jeder Klick ein
// 404. Sie steht bewusst VOR den Settings, damit der Unterschied im Code
// sichtbar bleibt — Profil ist persoenlich, Settings ist Serverleitung.
router.use("/:guildId/profile", CheckAuth, CheckGuildAccess, profileRouter);

// Kern-Settings-Routes (direkt, nicht über Plugin-System)
router.use("/:guildId/settings", CheckAuth, CheckGuildAccess, settingsRouter);

// Kern-Themes-Routes (eigener Top-Level-Bereich)
router.use("/:guildId/themes", CheckAuth, CheckGuildAccess, themesRouter);

// Kern-Medien-Routes (WordPress-Style Media Manager)
router.use("/:guildId/media", CheckAuth, CheckGuildAccess, mediaRouter);

// Kern-Feedback-Routes (Bug Report, Feature Request, Toast History, My Feedback)
router.use("/:guildId/feedback", CheckAuth, CheckGuildAccess, feedbackRouter);

// Kern-Donations-Routes (Donate, Hall of Fame)
router.use("/:guildId/donate", CheckAuth, CheckGuildAccess, donateRouter);
router.use("/:guildId/hall-of-fame", CheckAuth, CheckGuildAccess, hallOfFameRouter);

// Plugin Guild Routen
router.get("/:guildId/plugins", CheckGuildAccess, guildController.getPlugins);
router.post("/:guildId/plugins", CheckGuildAccess, guildController.updatePlugins);

// `POST /:guildId/plugins/:pluginName/update` ist am 2026-11-09 entfallen (K028):
// Die Route rief `pluginManager.updatePlugin`, das es nie gab, und der Knopf
// dazu erschien nie. Plugins ziehen ihre Fassung beim Start nach.

// Willkommensseite nach dem Einladen. **Kein requirePermission** — wer den Bot
// gerade eingeladen hat, hat noch keine Gruppe in dieser Guild; CheckGuildAccess
// prueft, dass er dort ueberhaupt etwas zu sagen hat. Die Seite zeigt nur Links.
router.get("/:guildId/willkommen", CheckAuth, CheckGuildAccess, guildController.getWillkommen);

// Guild locales
router.get("/:guildId/locales", CheckGuildAccess, guildController.getLocales);

// Kern-Permissions-Routes (direkt, nicht über Plugin-System)
router.use("/:guildId/permissions", CheckAuth, CheckGuildAccess, permissionsRouter);

// Kern-Plugin-Reload Route
router.use("/:guildId/plugin-reload", CheckAuth, CheckGuildAccess, pluginReloadRouter);


// Plugin-spezifische Routen (MIT Auth-Check!)
router.use("/:guildId/plugins/:pluginName", CheckAuth, CheckGuildAccess, pluginMiddleware.loadPlugin, async (req, res, next) => {
    const plugin = res.locals.plugin;
    const Logger = ServiceManager.get('Logger');

    // Die Rechte eines internen Plugins gibt es in einer fremden Guild nicht, aber
    // die Route soll dort gar nicht erst da sein.
    if (plugin && !ServiceManager.get('pluginManager').istVerfuegbar(plugin.name, req.params.guildId)) {
        return res.status(404).render("error", { message: "Plugin nicht gefunden", error: { status: 404 } });
    }

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

    // „Hilfe“ in der Kopfleiste zeigt auf den Artikel dieses Plugins (K290,
    // 2026-11-09). Nur bei Seitenaufrufen: Abrufe aus Skripten und
    // Ereignisströme laufen auch hier durch und zeigen keine Kopfleiste.
    // Scheitert die Abfrage, führt „Hilfe“ zur Startseite von /kb — die
    // Seite selbst darf daran nicht hängen.
    if (req.method === 'GET' && String(req.headers.accept || '').includes('text/html')) {
        try {
            res.locals.hilfe = await Wissen.hilfeFuerPlugin(plugin.name, res.locals.locale);
        } catch (fehler) {
            Logger.error(`[Hilfe] Artikel für Plugin ${plugin.name} nicht gelesen:`, fehler);
        }
    }
    
    // Router des Plugins ausführen
    plugin.guildRouter(req, res, next);
});

module.exports = router;