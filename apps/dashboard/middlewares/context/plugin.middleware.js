const { ServiceManager } = require("dunebot-core");

/*
 * Bis 2026-11-10 standen hier vier weitere Exporte ohne Aufrufer (K340):
 * `dashboard` (Plugin-Umschalter, Abschalten ohne Guild und ohne Bestätigung,
 * Befehle einzeln abschalten), `guild`, `checkPluginPermission` und
 * `setPluginLayout`. Eingebunden wird nur `loadPlugin` (api.router,
 * guild.router). Ein- und Abschalten geht über guild.controller.updatePlugins.
 */

/**
 * Middleware zum Laden eines Plugins basierend auf dem URL-Parameter
 * Diese Middleware prüft, ob das angeforderte Plugin existiert und lädt
 * entsprechende Kontextinformationen in res.locals.
 * 
 * @author firedervil
 * @param {import('express').Request} req - Express Request Objekt
 * @param {import('express').Response} res - Express Response Objekt
 * @param {import('express').NextFunction} next - Express Next Funktion
 * @returns {Promise<void>}
 */
exports.loadPlugin = async (req, res, next) => {
    const Logger = ServiceManager.get('Logger');
    const pluginManager = ServiceManager.get('pluginManager');

    try {
        const pluginName = req.params.pluginName;
        
        if (!pluginName) {
            return res.status(400).render("error", {
                message: "Plugin-Name fehlt",
                error: { status: 400 }
            });
        }
        
        // PluginManager überprüfen
        if (!pluginManager) {
            Logger.error("Plugin-Manager nicht verfügbar");
            return res.status(500).render("error", {
                message: "Plugin-Manager nicht verfügbar",
                error: { status: 500 }
            });
        }
        
        // Prüfen, ob Plugin existiert
        const plugin = pluginManager.getPlugin(pluginName);
        
        if (!plugin) {
            return res.status(404).render("error", {
                message: `Plugin "${pluginName}" nicht gefunden`,
                error: { status: 404 }
            });
        }
        
        // Prüfen, ob das Plugin für diesen Server aktiviert ist (bei serverspezifischen Anfragen)
        const guildId = req.params.guildId;
        if (guildId) {
            const isEnabled = await pluginManager.isPluginEnabledForGuild(pluginName, guildId);
            if (!isEnabled && !req.session.user.admin) {
                return res.status(403).render("error", {
                    message: `Plugin "${pluginName}" ist für diesen Server nicht aktiviert`,
                    error: { status: 403 }
                });
            }
        } else {
            // Prüfen, ob das Plugin global aktiviert ist
            const isEnabled = pluginManager.isPluginEnabled(pluginName);
            if (!isEnabled && !req.session.user.admin) {
                return res.status(403).render("error", {
                    message: `Plugin "${pluginName}" ist nicht aktiviert`,
                    error: { status: 403 }
                });
            }
        }
        
        // Plugin-Metadaten laden
        const pluginInfo = await pluginManager.getPluginInfo(pluginName);
        
        // Plugin und Metadaten in res.locals für nachfolgende Handler verfügbar machen
        res.locals.plugin = plugin;
        res.locals.pluginInfo = pluginInfo;
        res.locals.pluginName = pluginName;
        
        // Bei Server-spezifischen Anfragen den Server-Kontext hinzufügen
        if (guildId && res.locals.guild) {
            res.locals.pluginGuildContext = {
                guildId,
                guild: res.locals.guild
            };
        }
        
        // Weiter zum nächsten Middleware/Controller
        next();
        
    } catch (error) {
        Logger.error(`Fehler beim Laden des Plugins ${req.params.pluginName}:`, error);
        res.status(500).render("error", { 
            message: "Ein Fehler ist aufgetreten beim Laden des Plugins.", 
            error 
        });
    }
};
