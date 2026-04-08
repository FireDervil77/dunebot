const { ServiceManager } = require("dunebot-core");

/**
 * 
 * Middleware to populate the request object
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
module.exports.dashboard = async (req, res, next) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const ipcServer = ServiceManager.get('ipcServer');
    const pluginManager = ServiceManager.get('pluginManager');

    const { guildId, pluginName } = req.params;
    const plugin = pluginManager.getPlugin(pluginName);
    
    
    if (!plugin) {
        return res.status(404).send("Plugin not found");
    }

    // PUT route
    if (req.method === "PUT") {
        const { guildId, pluginName } = req.params;

        // Plugin Status Toggle
        if (req.query.operation && req.query.operation === "toggle") {
            try {
                const shouldEnable = Boolean(req.body.plugin_toggle);
                if (shouldEnable) {
                    await pluginManager.enableInGuild(pluginName, guildId);
                    const ipcResp = await ipcServer.broadcast("dashboard:UPDATE_PLUGIN", {
                        pluginName: plugin.name,
                        action: "guildEnable",
                        guildId: guildId,
                    });
                    if (ipcResp.find((r) => !r.success)) {
                        await pluginManager.disableInGuild(pluginName);
                        throw new Error("Failed to enable plugin on other instances");
                    }
                } else {
                    await pluginManager.disableInGuild(pluginName, guildId);
                    const ipcResp = await ipcServer.broadcast("dashboard:UPDATE_PLUGIN", {
                        pluginName: plugin.name,
                        action: "guildDisable",
                        guildId: guildId,
                    });
                    if (ipcResp.find((r) => !r.success)) {
                        await pluginManager.enableInGuild(pluginName);
                        throw new Error("Failed to disable plugin on other instances");
                    }
                }

                return res.sendStatus(200);
            } catch (error) {
                Logger.error(error);
                return res.status(500).send(error.message);
            }
        }

        // Prefix Commands Toggle
        if (req.method === "PUT" && req.query.operation === "prefix_commands_toggle") {
            try {
                const keys = Object.keys(req.body);
                const filtered = keys
                    .filter((key) => key !== "prefix_commands_toggle" && req.body[key] === "on")
                    .map((key) => key.split("prefix_")[1]);

                const ipcResp = await ipcServer.broadcastOne("dashboard:GET_PLUGIN_CMDS", {
                    guildId,
                    pluginName,
                    type: "prefix",
                });
                const pluginCmds = ipcResp.success ? ipcResp.data : { prefix: [], slash: [] };

                const disabled = new Set();
                pluginCmds.prefix.forEach((cmd) => {
                    if (!filtered.includes(cmd.name)) {
                        disabled.add(cmd.name);
                        cmd.aliases?.forEach((alias) => disabled.add(alias));
                    }
                });

                // NEU: Config über DBService aktualisieren
                await dbService.setConfig(
                    "core",
                    "disabled_prefix",
                    Array.from(disabled),
                    "shared",
                    guildId,
                    false
                );

                return res.sendStatus(200);
            } catch (error) {
                Logger.error(error);
                return res.status(500).send(error.message);
            }
        }

        // Slash Commands Toggle
        if (req.method === "PUT" && req.query.operation === "slash_commands_toggle") {
            try {
                const keys = Object.keys(req.body);
                const filtered = keys
                    .filter((key) => key !== "slash_commands_toggle" && req.body[key] === "on")
                    .map((key) => key.split("slash_")[1]);

                const ipcResp = await ipcServer.broadcastOne("dashboard:GET_PLUGIN_CMDS", {
                    guildId,
                    pluginName,
                    type: "slash",
                });
                const pluginCmds = ipcResp.success ? ipcResp.data : { prefix: [], slash: [] };

                const disabled = new Set();
                pluginCmds.slash.forEach((cmd) => {
                    if (!filtered.includes(cmd.name)) {
                        disabled.add(cmd.name);
                    }
                });

                // NEU: Config über DBService aktualisieren
                await dbService.setConfig(
                    "core", 
                    "disabled_slash",
                    Array.from(disabled),
                    "shared",
                    guildId,
                    false
                );

                return res.sendStatus(200);
            } catch (error) {
                Logger.error(error);
                return res.status(500).send(error.message);
            }
        }
    }

     // Broadcast helper
    req.broadcast = function (eventName, data) {
        const event = `${plugin.name}:${eventName}`;
        return ipcServer.broadcast(event, data);
    };

    // NEU: Configs über getConfigs laden
    const [coreSettings, pluginConfig] = await Promise.all([
        dbService.getConfigs(guildId, "core", "shared"),
        plugin.getConfig()
    ]);

    const ipcResp = await ipcServer.broadcastOne("dashboard:GET_PLUGIN_CMDS", {
        guildId,
        pluginName,
    });
    const pluginCmds = ipcResp.success ? ipcResp.data : { prefix: [], slash: [] };

    const navigation = await dbService.query(
        "SELECT * FROM guild_nav_items WHERE guildId = ? ORDER BY plugin ASC, order_num ASC",
        [req.params.guildId || null]
    );

    const title =
        plugin.name.charAt(0).toUpperCase() +
        plugin.name.slice(1) +
        " | " +
        (coreSettings.DASHBOARD_LOGO_NAME || "FireBot");

    res.locals.locale = req.session.locale;
    res.locals.tr = req.translate;
    res.locals.coreSettings = coreSettings;
    res.locals.coreConfig = coreSettings;
    res.locals.user = req.session.user.info;
    res.locals.plugins = pluginManager.plugins;
    
    // Lade enabled Plugins aus guild_plugins Tabelle
    const enabledPluginsRows = await dbService.query(
        "SELECT plugin_name FROM guild_plugins WHERE guild_id = ? AND is_enabled = 1",
        [req.params.guildId]
    );
    
    // Validierung: enabledPluginsRows muss ein Array sein
    if (!Array.isArray(enabledPluginsRows)) {
        Logger.error('[Plugin Middleware] Query lieferte kein Array:', enabledPluginsRows);
        res.locals.enabledPlugins = [];
    } else {
        const enabledPluginNames = enabledPluginsRows.map(row => row.plugin_name);
        res.locals.enabledPlugins = pluginManager.plugins.filter((p) =>
            enabledPluginNames.includes(p.name)
        );
    }
    
    res.locals.plugin = plugin;
    res.locals.pluginCmds = pluginCmds;
    res.locals.config = pluginConfig;
    res.locals.navigation = navigation;
    res.locals.title = title;
    res.locals.slug = `/plugins/${plugin.name}`;
    res.locals.layout = "layouts/guild-tabbed";
    res.locals.breadcrumb = true;

    next();
};

/**
 * Middleware to populate the request object
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
module.exports.guild = async (req, res, next) => {
    const ipcServer = ServiceManager.get('ipcServer');
    const pluginManager = ServiceManager.get('pluginManager');
    const themeManager = ServiceManager.get('themeManager');

    // Guild-Layout verwenden
    res.locals.layout = themeManager.getLayout('guild');

    const { pluginName } = req.params;
    const plugin = pluginManager.getPlugin(pluginName);

    if (!plugin) {
        return res.status(404).send("Plugin not found");
    }

    const coreConfig = res.locals.coreConfig;
    const title =
        plugin.name.charAt(0).toUpperCase() +
        plugin.name.slice(1) +
        " | " +
        coreConfig["DASHBOARD_LOGO_NAME"];

    req.broadcast = function (eventName, data) {
        const event = `${plugin.name}:${eventName}`;
        return ipcServer.broadcast(event, data);
    };

    res.locals.tr = req.translate;
    res.locals.coreConfig = coreConfig;
    res.locals.user = req.session.user.info;
    res.locals.plugins = pluginManager.plugins;
    res.locals.plugin = plugin;
    res.locals.config = await plugin.getConfig();

    res.locals.title = title;
    res.locals.slug = `/plugins/${plugin.name}`;
    res.locals.breadcrumb = true;
    res.locals.layout = "layouts/guild";

    return next();
};

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

/**
 * Middleware zur Überprüfung der Plugin-Berechtigungen
 * Prüft, ob der aktuelle Benutzer die erforderlichen Berechtigungen für das Plugin hat
 * 
 * @author firedervil
 * @param {string|string[]} requiredPermissions - Erforderliche Berechtigungen
 * @returns {import('express').RequestHandler}
 */
exports.checkPluginPermission = (requiredPermissions) => {
    const Logger = ServiceManager.get('Logger');
    const pluginManager = ServiceManager.get('pluginManager');

    return async (req, res, next) => {
        try {
            const pluginName = req.params.pluginName;
            const guildId = req.params.guildId;
            
            // Admin-Benutzer haben immer Zugriff
            if (req.session.user.admin) {
                return next();
            }
            
            // Plugin-Berechtigungen überprüfen
            let hasPermission = false;
            
            if (guildId) {
                // Server-spezifische Berechtigungen
                hasPermission = await pluginManager.checkUserGuildPluginPermissions(
                    req.session.user.info.id,
                    guildId,
                    pluginName,
                    requiredPermissions
                );
            } else {
                // Globale Plugin-Berechtigungen
                hasPermission = await pluginManager.checkUserPluginPermissions(
                    req.session.user.info.id,
                    pluginName,
                    requiredPermissions
                );
            }
            
            if (!hasPermission) {
                return res.status(403).render("error", {
                    message: "Du hast nicht die erforderlichen Berechtigungen für diese Aktion",
                    error: { status: 403 }
                });
            }
            
            // Weiter zum nächsten Middleware/Controller
            next();
            
        } catch (error) {
            Logger.error(`Fehler bei der Überprüfung der Plugin-Berechtigungen:`, error);
            res.status(500).render("error", { 
                message: "Ein Fehler ist aufgetreten bei der Berechtigungsprüfung.", 
                error 
            });
        }
    };
};

/**
 * Middleware zum Setzen des Plugin-Layouts
 * Diese Middleware setzt das Layout für Plugin-Seiten
 * 
 * @author firedervil
 * @param {import('express').Request} req - Express Request Objekt
 * @param {import('express').Response} res - Express Response Objekt
 * @param {import('express').NextFunction} next - Express Next Funktion
 * @returns {void}
 */
exports.setPluginLayout = (req, res, next) => {
    const themeManager = ServiceManager.get('themeManager');

    // Je nach Kontext das passende Layout setzen
    if (req.originalUrl.startsWith('/guild/')) {
        res.locals.layout = themeManager.getLayout('guild');
    } 
    
    // Weiter zum nächsten Middleware/Controller
    next();
};