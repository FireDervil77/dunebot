/**
 * Guild Controller - Verwaltet alle serverspezifischen Funktionen
 * 
 * @author firedervil
 * @module controllers/guild.controller
 */

const { ServiceManager } = require("dunebot-core");

/**
 * Guild-Dashboard anzeigen
 * @author firedervil
 * @param {import('express').Request} req - Express Request Objekt
 * @param {import('express').Response} res - Express Response Objekt
 * @returns {Promise<void>}
 */
exports.getDashboard = async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipcServer = ServiceManager.get('ipcServer');
    const pluginManager = ServiceManager.get('pluginManager');
    const themeManager = ServiceManager.get('themeManager');
    const dbService = ServiceManager.get('dbService');

    try {
        // Guild-Layout verwenden
        res.locals.layout = themeManager.getLayout('guild');
        
        // User-Daten für das Template bereitstellen
        res.locals.user = req.session?.user || null;
        
        const guildId = req.params.guildId;
        const guild = res.locals.guild;
        
        if (!guild) {
            return res.status(404).render("error", { 
                message: "Server nicht gefunden", 
                error: { status: 404 } 
            });
        }
        
        // Server-Widgets laden (Hook-Funktion) - bleibt unverändert
        let widgets = [];
        if (pluginManager?.hooks) {
            // Hook: 'guild_dashboard_widgets' - Erlaubt Plugins, eigene Widgets hinzuzufügen
            widgets = await pluginManager.hooks.applyFilter(
                'guild_dashboard_widgets', 
                [], // Default: leeres Array
                guildId, // Parameter 1: Guild ID
                guild    // Parameter 2: Guild-Objekt
            );
        }
        
        // Erweiterte Server-Stats laden via IPC - bleibt unverändert
        let stats = {};
        try {
            // Standard-Statistiken laden
            const statsResponse = await ipcServer.broadcastOne("dashboard:GET_GUILD_STATS", { guildId });
            if (statsResponse?.success) {
                stats = statsResponse.data;
            }
            
            // Erweiterte Statistiken laden (falls verfügbar)
            const extendedStatsResponse = await ipcServer.broadcastOne("dashboard:GET_GUILD_EXTENDED_STATS", { guildId });
            if (extendedStatsResponse?.success) {
                // Erweiterte Daten mit Basisdaten zusammenführen
                stats = { ...stats, ...extendedStatsResponse.data };
            }
        } catch (err) {
            Logger.error(`Fehler beim Laden der Statistiken für Guild ${guildId}:`, err);
        }
        
        // Aktivierte Plugins aus der Datenbank laden
        let enabledPlugins = [];
        try {
            const [settings] = await dbService.query(
                "SELECT enabled_plugins FROM settings WHERE _id = ?",
                [guildId]
            );
            
            // JSON-Feld parsen
            enabledPlugins = settings?.enabled_plugins ? 
                (typeof settings.enabled_plugins === 'string' ? 
                    JSON.parse(settings.enabled_plugins) : 
                    settings.enabled_plugins) : 
                ["core"];
        } catch (err) {
            Logger.error(`Fehler beim Laden der aktivierten Plugins für Guild ${guildId}:`, err);
            enabledPlugins = ["core"]; 
        }
        
        // Sicherstellen, dass das Icon-URL korrekt ist
        if (guild && !guild.icon && stats && stats.guild && stats.guild.icon) {
        guild.icon = stats.guild.icon; // Icon aus den erweiterten Statistiken übernehmen
        }

        // Breadcrumbs definieren
        const breadcrumbs = [
            { title: 'Dashboard', url: `/guild/${guildId}` },
            { title: guild.name, url: `/guild/${guildId}` }
        ];
        
        // Template rendern
        res.render("guild/dashboard", {
            title: `Dashboard: ${guild.name}`,
            activeMenu: `/guild/${guildId}`,
            user: req.session?.user || null,
            guild,
            guildId,
            stats,
            widgets,
            enabledPlugins,
            breadcrumbs,
            // Meta-Daten
            meta: {
                pageType: 'guild_dashboard',
                objectId: guildId,
                capabilities: ['manage_server'],
            }
        });
    } catch (error) {
        Logger.error(`Fehler beim Rendern des Server-Dashboards für ${req.params.guildId}:`, error);
        res.status(500).render("error", {
            message: "Fehler beim Laden des Server-Dashboards",
            error
        });
    }
};

/**
 * Guild-Einstellungen anzeigen
 * @author firedervil
 * @param {import('express').Request} req - Express Request Objekt
 * @param {import('express').Response} res - Express Response Objekt
 * @returns {Promise<void>}
 */
exports.getSettings = async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const pluginManager = ServiceManager.get('pluginManager');
    const themeManager = ServiceManager.get('themeManager');

    try {
        // Guild-Layout verwenden
        res.locals.layout = themeManager.getLayout('guild');

        const guildId = req.params.guildId;
        const guild = res.locals.guild;

        if (!guild) {
            return res.status(404).render("error", { 
                message: "Server nicht gefunden", 
                error: { status: 404 } 
            });
        }

        // Settings direkt aus der Datenbank laden
        let settings = {};
        try {
            const [dbSettings] = await dbService.query(
                "SELECT * FROM settings WHERE _id = ?",
                [guildId]
            );
            
            if (dbSettings) {
                settings = dbSettings;
                
                // JSON-Felder parsen
                if (settings.enabled_plugins) {
                    settings.enabled_plugins = typeof settings.enabled_plugins === 'string' ?
                        JSON.parse(settings.enabled_plugins) :
                        settings.enabled_plugins;
                }
            }
        } catch (err) {
            Logger.error(`Fehler beim Laden der Settings für Guild ${guildId}:`, err);
            settings = { enabled_plugins: ['core'] };
        }

        // Breadcrumbs
        const breadcrumbs = [
            { title: 'Dashboard', url: `/guild/${guildId}` },
            { title: 'Einstellungen', url: `/guild/${guildId}/settings` }
        ];

        // Render
        res.render("guild/settings", {
            title: `Einstellungen: ${guild.name}`,
            activeMenu: `/guild/${guildId}/settings`,
            user: req.session?.user || null,
            guild,
            guildId,
            settings,
            breadcrumbs,
            // Flash für die View bereitstellen (immer Arrays)
            success: Array.isArray(res.locals.success) ? res.locals.success : [],
            error: Array.isArray(res.locals.error) ? res.locals.error : [],
            // Meta
            meta: {
                pageType: 'guild_settings',
                objectId: guildId,
                capabilities: ['manage_server']
            }
        });
    } catch (error) {
        Logger.error(`Fehler beim Rendern der Server-Einstellungen für ${req.params.guildId}:`, error);
        res.status(500).render("error", { 
            message: "Ein Fehler ist aufgetreten.", 
            error 
        });
    }
};

/**
 * Guild-Einstellungen aktualisieren
 * @author firedervil
 * @param {import('express').Request} req - Express Request Objekt
 * @param {import('express').Response} res - Express Response Objekt
 * @returns {Promise<void>}
 */
exports.updateSettings = async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const ipcServer = ServiceManager.get('ipcServer');

    try {
        const guildId = req.params.guildId;
        const updates = req.body;

        if (!updates || typeof updates !== 'object') {
            return res.status(400).json({
                success: false,
                message: "Keine oder ungültige Einstellungen übermittelt"
            });
        }

        // Normalisieren: enabled_plugins erlauben als Array oder JSON-String
        if (typeof updates.enabled_plugins !== 'undefined') {
            if (typeof updates.enabled_plugins === 'string') {
                try {
                    // Wenn ein JSON-Array-String übermittelt wurde
                    updates.enabled_plugins = JSON.parse(updates.enabled_plugins);
                } catch {
                    // CSV -> Array
                    updates.enabled_plugins = updates.enabled_plugins
                        .split(',')
                        .map(s => s.trim())
                        .filter(Boolean);
                }
            }
            if (!Array.isArray(updates.enabled_plugins)) {
                updates.enabled_plugins = ["core"];
            }
            // Core darf niemals entfernt werden
            if (!updates.enabled_plugins.includes("core")) {
                updates.enabled_plugins.unshift("core");
            }
        }

        // Settings in der Datenbank aktualisieren
        try {
            // Enabled Plugins als JSON speichern
            if (updates.enabled_plugins) {
                updates.enabled_plugins = JSON.stringify(updates.enabled_plugins);
            }

            await dbService.query(`
                INSERT INTO settings (_id, prefix, locale, enabled_plugins)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    prefix = VALUES(prefix),
                    locale = VALUES(locale),
                    enabled_plugins = VALUES(enabled_plugins)
            `, [
                guildId,
                updates.prefix || '!',
                updates.locale || 'de-DE',
                updates.enabled_plugins || JSON.stringify(['core'])
            ]);
        } catch (dbError) {
            Logger.error(`Fehler beim Aktualisieren der Settings für Guild ${guildId}:`, dbError);
            return res.status(500).json({
                success: false,
                message: "Fehler beim Speichern der Einstellungen"
            });
        }

        res.json({
            success: true,
            message: "Einstellungen erfolgreich gespeichert"
        });
    } catch (error) {
        Logger.error(`Fehler beim Aktualisieren der Server-Einstellungen für ${req.params.guildId}:`, error);
        res.status(500).json({
            success: false,
            message: "Ein Fehler ist aufgetreten."
        });
    }
};

/**
 * Guild Plugins anzeigen
 * @author firedervil
 * @param {import('express').Request} req - Express Request Objekt
 * @param {import('express').Response} res - Express Response Objekt
 * @returns {Promise<void>}
 */
exports.getPlugins = async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const pluginManager = ServiceManager.get('pluginManager');
    const themeManager = ServiceManager.get('themeManager');

    try {
        // Guild-Layout verwenden
        res.locals.layout = themeManager.getLayout('guild');

        const path = require('path');
        const fs = require('fs');

        const guildId = req.params.guildId;
        const guild = res.locals.guild;

        if (!guild) {
            return res.status(404).render("error", { 
                message: "Server nicht gefunden", 
                error: { status: 404 } 
            });
        }

       // Aktivierte Plugins aus der Datenbank laden
        let enabledServerPlugins = [];
        try {
            const [settings] = await dbService.query(
                "SELECT enabled_plugins FROM settings WHERE _id = ?",
                [guildId]
            );
            
            if (settings?.enabled_plugins) {
                enabledServerPlugins = typeof settings.enabled_plugins === 'string' ?
                    JSON.parse(settings.enabled_plugins) :
                    settings.enabled_plugins;
            }
        } catch (err) {
            Logger.error(`Fehler beim Laden der aktivierten Plugins für Guild ${guildId}:`, err);
            enabledServerPlugins = ["core"];
        }

        // Plugins-Verzeichnis ermitteln (vom Controller aus relativ zum Projekt-Root)
        const pluginsDir = path.resolve(__dirname, "../../../plugins");

        const enabledPlugins = [];
        const availablePlugins = [];

        try {
            if (!fs.existsSync(pluginsDir)) {
                Logger.warn(`[Plugins] Plugins-Verzeichnis nicht gefunden: ${pluginsDir}`);
            } else {
                const pluginDirs = fs.readdirSync(pluginsDir, { withFileTypes: true })
                    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
                    .map(d => d.name);

                for (const pluginName of pluginDirs) {
                    const pluginPath = path.join(pluginsDir, pluginName);
                    const packageJsonPath = path.join(pluginPath, "package.json");

                    if (!fs.existsSync(packageJsonPath)) {
                        Logger.debug(`[Plugins] Überspringe ${pluginName}: keine package.json`);
                        continue;
                    }

                    let pkg = {};
                    try {
                        pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
                    } catch (e) {
                        Logger.error(`[Plugins] Fehler beim Parsen der package.json von ${pluginName}:`, e);
                        continue;
                    }

                    // Heuristiken für Guild-Features/Settings
                    const hasBot = fs.existsSync(path.join(pluginPath, "bot"));
                    const hasDashboard = fs.existsSync(path.join(pluginPath, "dashboard"));
                    const hasGuildFeatures = hasBot || hasDashboard; // minimal
                    const hasSettings =
                        fs.existsSync(path.join(pluginPath, "dashboard", "routes")) ||
                        fs.existsSync(path.join(pluginPath, "dashboard", "views", "guild")) ||
                        fs.existsSync(path.join(pluginPath, "dashboard", "views", "admin"));

                    // Icon optional suchen (Fallback auf Theme-Icon)
                    let icon = "/themes/default/assets/images/DuneBot.png";
                    const iconCandidates = [
                        path.join(pluginPath, "dashboard", "public", "images", "icon.png"),
                        path.join(pluginPath, "dashboard", "public", "icon.png"),
                        path.join(pluginPath, "dashboard", "public", "images", "logo.png")
                    ];
                    for (const candidate of iconCandidates) {
                        if (fs.existsSync(candidate)) {
                            // Annahme: static-Mount für Plugin-Assets existiert unter /plugins/:name
                            icon = `/plugins/${pluginName}/images/${path.basename(candidate)}`;
                            break;
                        }
                    }

                    if (!hasGuildFeatures) {
                        continue;
                    }

                    const displayName = pkg.displayName || pkg.name || pluginName;
                    const isCore = pluginName === "core";

                    const plugin = {
                        name: pluginName,
                        displayName,
                        description: pkg.description || '',
                        version: pkg.version || '1.0.0',
                        author: (typeof pkg.author === 'string' ? pkg.author : (pkg.author?.name || 'Unbekannt')),
                        enabled: enabledServerPlugins.includes(pluginName),
                        hasSettings,
                        settingsUrl: hasSettings ? `/guild/${guildId}/plugins/${pluginName}/settings` : null,
                        icon,
                        isCore,
                        canDisable: !isCore
                    };

                    if (plugin.enabled) {
                        enabledPlugins.push(plugin);
                    } else {
                        availablePlugins.push(plugin);
                    }
                }

                // Sortieren nach DisplayName
                enabledPlugins.sort((a, b) => a.displayName.localeCompare(b.displayName));
                availablePlugins.sort((a, b) => a.displayName.localeCompare(b.displayName));
            }
        } catch (scanErr) {
            Logger.error(`[Plugins] Fehler beim Durchsuchen des Plugin-Verzeichnisses:`, scanErr);
        }

        // Breadcrumbs
        const breadcrumbs = [
            { title: 'Dashboard', url: `/guild/${guildId}` },
            { title: 'Plugins', url: `/guild/${guildId}/plugins` }
        ];

        // Template rendern
        res.render("guild/plugins", {
            title: `Plugins für ${guild.name}`,
            activeMenu: `/guild/${guildId}/plugins`,
            user: req.session?.user || null,
            guild,
            guildId,
            enabledPlugins,
            availablePlugins,
            breadcrumbs,
            // Flash-Nachrichten für die View bereitstellen (immer als Arrays)
            success: Array.isArray(res.locals.success) ? res.locals.success : [],
            error: Array.isArray(res.locals.error) ? res.locals.error : [],
            meta: {
                pageType: 'guild_plugins',
                objectId: guildId,
                capabilities: ['manage_plugins']
            }
        });
    } catch (error) {
        Logger.error(`Fehler beim Rendern der Guild-Plugins für ${req.params.guildId}:`, error);
        res.status(500).render("error", { 
            message: "Ein Fehler ist aufgetreten.", 
            error 
        });
    }
};

/**
 * Guild-Plugins aktualisieren
 * @author firedervil
 * @param {import('express').Request} req - Express Request Objekt
 * @param {import('express').Response} res - Express Response Objekt
 * @returns {Promise<void>}
 */
exports.updatePlugins = async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const ipcServer = ServiceManager.get('ipcServer');
    const pluginManager = ServiceManager.get('pluginManager');

    try {
        const guildId = req.params.guildId;
        const { action, plugins } = req.body;
        
        if (!action || !plugins || !Array.isArray(plugins)) {
            return res.status(400).json({
                success: false,
                message: "Ungültige Parameter"
            });
        }
        
        // Plugin-Manager überprüfen
        if (!pluginManager) {
            return res.status(500).json({
                success: false,
                message: "Plugin-Manager nicht verfügbar"
            });
        }
        
        // Aktion durchführen
        const results = [];
        
        if (action === 'enable') {
            for (const plugin of plugins) {
                try {
                    await pluginManager.enableInGuild(plugin, guildId);
                    results.push({
                        plugin,
                        success: true,
                        message: `Plugin "${plugin}" erfolgreich aktiviert für Server ${guildId}`
                    });
                } catch (err) {
                    results.push({
                        plugin,
                        success: false,
                        message: err.message || `Fehler beim Aktivieren von "${plugin}" für Server ${guildId}`
                    });
                }
            }
        } else if (action === 'disable') {
            for (const plugin of plugins) {
                try {
                    await pluginManager.disableInGuild(plugin, guildId);
                    results.push({
                        plugin,
                        success: true,
                        message: `Plugin "${plugin}" erfolgreich deaktiviert für Server ${guildId}`
                    });
                } catch (err) {
                    results.push({
                        plugin,
                        success: false,
                        message: err.message || `Fehler beim Deaktivieren von "${plugin}" für Server ${guildId}`
                    });
                }
            }
        } else {
            return res.status(400).json({
                success: false,
                message: "Ungültige Aktion"
            });
        }
        
        // Änderungen per IPC an den Bot senden
        try {
            await ipcServer.broadcastOne("dashboard:UPDATE_PLUGIN", {
                guildId,
                action,
                plugins
            });
        } catch (err) {
            Logger.error(`Fehler beim Senden der aktualisierten Plugin-Konfiguration für Guild ${guildId}:`, err);
        }
        
        res.json({
            success: true,
            results
        });
    } catch (error) {
        Logger.error(`Fehler beim Aktualisieren der Guild-Plugins für ${req.params.guildId}:`, error);
        res.status(500).json({
            success: false,
            message: "Ein Fehler ist aufgetreten."
        });
    }
};

/**
 * Guild Locales anzeigen
 * @author firedervil
 * @param {import('express').Request} req - Express Request Objekt
 * @param {import('express').Response} res - Express Response Objekt
 * @returns {Promise<void>}
 */
exports.getLocales = async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const pluginManager = ServiceManager.get('pluginManager');
    const themeManager = ServiceManager.get('themeManager');

    try {
        // Guild-Layout verwenden
        res.locals.layout = themeManager.getLayout('guild');

        const guildId = req.params.guildId;
        const guild = res.locals.guild;

        if (!guild) {
            return res.status(404).render("error", { 
                message: "Server nicht gefunden", 
                error: { status: 404 } 
            });
        }

        // Verfügbare Sprachen aus den Meta-Daten laden
        const availableLanguages = pluginManager.i18n.languagesMeta.map(lng => ({
            value: lng.name,
            name: lng.display || lng.name
        }));

        // Breadcrumbs
        const breadcrumbs = [
            { title: 'Dashboard', url: `/guild/${guildId}` },
            { title: 'Lokalisierung', url: `/guild/${guildId}/locales` }
        ];

        // Template rendern
        res.render("guild/locales", {
            title: `Lokalisierung: ${guild.name}`,
            activeMenu: `/guild/${guildId}/locales`,
            user: req.session?.user || null,
            guild,
            guildId,
            availableLanguages,
            breadcrumbs,
            // Flash-Nachrichten für die View bereitstellen
            success: Array.isArray(res.locals.success) ? res.locals.success : [],
            error: Array.isArray(res.locals.error) ? res.locals.error : [],
            meta: {
                pageType: 'guild_locales',
                objectId: guildId,
                capabilities: ['manage_locales']
            }
        });

    } catch (error) {
        Logger.error(`Fehler beim Rendern der Guild-Locales für ${req.params.guildId}:`, error);
        res.status(500).render("error", { 
            message: "Ein Fehler ist aufgetreten.", 
            error 
        });
    }
};
