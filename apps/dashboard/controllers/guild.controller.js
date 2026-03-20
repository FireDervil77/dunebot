/**
 * Guild Controller - Verwaltet alle serverspezifischen Funktionen
 * 
 * @author firedervil
 * @module controllers/guild.controller
 */
const fs = require("fs");
const path = require("path");

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
        // WICHTIG: .info verwenden, damit isOwner/hasSystemAccess korrekt gesetzt ist!
        res.locals.user = req.session?.user?.info || null;
        
        const guildId = res.locals.guildId;
        const guild = res.locals.guild;
        
        if (!guild) {
            return res.status(404).render("error", { 
                message: "Server nicht gefunden", 
                error: { status: 404 } 
            });
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

        // Aktivierte Plugins aus guild_plugins Tabelle laden
        let enabledPlugins = [];
        try {
            enabledPlugins = await dbService.getEnabledPlugins(guildId);
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
        
        const options =
        {
            guildId,
            guild,
            req,
            res,
            theme: res.locals.theme,
            user: req.session?.user || null,
            stats,
            enabledPlugins
        }
        
        // Server-Widgets laden (Hook-Funktion) - bleibt unverändert
        let widgets = [];
        if (pluginManager?.hooks) {
            // Hook: 'guild_dashboard_widgets' - Erlaubt Plugins, eigene Widgets hinzuzufügen
            widgets = await pluginManager.hooks.applyFilter(
                'guild_dashboard_widgets', 
                [], // Default: leeres Array
                options
            );
        }

        // SuperAdmin Configs sind jetzt in res.locals verfügbar (aus guild.middleware)
        // supportUrl, supportName, dashboardVersion, botVersion

        // Widget-Config aus DB (guild-spezifische Overrides laden)
        let guildWidgetOverrides = [];
        try {
            const { getInstance: getWidgetManager } = require('dunebot-sdk/lib/WidgetManager');
            const wm = getWidgetManager();
            guildWidgetOverrides = await wm.getGuildWidgetConfig(guildId);
        } catch (_) { /* Tabelle noch nicht vorhanden → kein Problem */ }

        // renderWidgetArea-Helper für EJS: Widgets eines Bereichs als Array zurückgeben
        const _widgetOverrideMap = new Map(guildWidgetOverrides.map(o => [o.widget_id, o]));
        res.locals.renderWidgetArea = (areaId) => {
            return widgets
                .map(w => {
                    const ov = _widgetOverrideMap.get(w.id);
                    return {
                        ...w,
                        area:     ov?.area     ?? w.area     ?? 'dashboard-main',
                        position: ov?.position ?? w.position ?? 999,
                        visible:  ov?.visible  !== undefined ? Boolean(ov.visible) : (w.visible !== false),
                    };
                })
                .filter(w => w.area === areaId && w.visible)
                .sort((a, b) => a.position - b.position);
        };

        // Template rendern (Theme-Hierarchy: guild/dashboard → ggf. Child-Theme-Override)
        const viewData = {
            title: `Dashboard: ${guild.guild_name}`,
            activeMenu: `/guild/${guildId}`,
            user: req.session?.user?.info || null,
            guild,
            guildId,
            stats,
            widgets,
            guildNav: res.locals.guildNav,
            enabledPlugins,
            breadcrumbs,
            // Meta-Daten
            meta: {
                pageType: 'guild_dashboard',
                objectId: guildId,
                capabilities: ['manage_server'],
            }
        };
        if (themeManager?.renderView) {
            await themeManager.renderView(res, 'guild/dashboard', viewData);
        } else {
            res.render('guild/dashboard', viewData);
        }
    } catch (error) {
        Logger.error(`Fehler beim Rendern des Server-Dashboards für ${req.params.guildId}:`, error);
        res.status(500).render("error", {
            message: "Fehler beim Laden des Server-Dashboards",
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

        // Settings in der Datenbank aktualisieren via configs Tabelle
        try {
            // Prefix speichern
            if (updates.prefix) {
                await dbService.setConfig('core', 'PREFIX_COMMANDS_PREFIX', updates.prefix, 'shared', guildId);
            }
            
            // Locale speichern
            if (updates.locale) {
                await dbService.setConfig('core', 'LOCALE', updates.locale, 'shared', guildId);
            }
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
        
        const guildId = req.params.guildId;
        const guild = res.locals.guild;

        if (!guild) {
            return res.status(404).render("error", { 
                message: "Server nicht gefunden", 
                error: { status: 404 } 
            });
        }

        // NEU: Sicherstellen dass Guild-Name verfügbar ist
        const guildName = guild.guild_name || guild.name;
        if (!guildName) {
            Logger.warn(`Kein Guild-Name gefunden für Guild ${guildId}`);
        }

        // Aktivierte Plugins aus guild_plugins Tabelle laden (mit Versionen)
        let enabledServerPlugins = [];
        let pluginVersionsFromDB = {};
        try {
            const pluginsData = await dbService.query(`
                SELECT plugin_name, plugin_version 
                FROM guild_plugins 
                WHERE guild_id = ? AND is_enabled = 1
            `, [guildId]);
            
            enabledServerPlugins = pluginsData.map(p => p.plugin_name);
            pluginVersionsFromDB = pluginsData.reduce((acc, p) => {
                acc[p.plugin_name] = p.plugin_version;
                return acc;
            }, {});
            
            // Sicherstellen dass core immer aktiviert ist
            if (!enabledServerPlugins.includes('core')) {
                enabledServerPlugins.push('core');
            }
        } catch (err) {
            Logger.error(`Fehler beim Laden der aktivierten Plugins für Guild ${guildId}:`, err);
            enabledServerPlugins = ["core"];
        }

        // NEU: Plugin-Badges laden
        let pluginBadges = {};
        try {
            const badges = await dbService.getAllPluginBadges();
            pluginBadges = badges.reduce((acc, badge) => {
                acc[badge.plugin_name] = {
                    status: badge.badge_status,
                    until: badge.badge_until,
                    featured: badge.is_featured,
                    active: badge.is_active
                };
                return acc;
            }, {});
        } catch (err) {
            Logger.error(`Fehler beim Laden der Plugin-Badges:`, err);
            pluginBadges = {};
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

                    // Owner-only Plugins filtern (prüfe config.json)
                    const configPath = path.join(pluginPath, "config.json");
                    if (fs.existsSync(configPath)) {
                        try {
                            const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
                            if (config.BOT_OWNER_ID) {
                                const currentUser = req.session?.user;
                                const controlGuildId = process.env.CONTROL_GUILD_ID;
                                
                                // Prüfe Owner-ID
                                if (!currentUser || currentUser.info.id !== config.BOT_OWNER_ID) {
                                    Logger.debug(`[Plugins] Überspringe Owner-only Plugin ${pluginName} für User ${currentUser?.info.id}`);
                                    continue;
                                }
                                
                                // Prüfe Control Guild
                                if (controlGuildId && guildId !== controlGuildId) {
                                    Logger.debug(`[Plugins] Überspringe ${pluginName} - nur in Control Guild verfügbar`);
                                    continue;
                                }
                            }
                        } catch (configErr) {
                            Logger.error(`[Plugins] Fehler beim Parsen der config.json von ${pluginName}:`, configErr);
                        }
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
                    const isEnabled = enabledServerPlugins.includes(pluginName);

                    // Version aus DB verwenden, falls Plugin aktiviert ist
                    const version = isEnabled && pluginVersionsFromDB[pluginName] 
                        ? pluginVersionsFromDB[pluginName] 
                        : (pkg.version || '1.0.0');

                    const plugin = {
                        name: pluginName,
                        displayName,
                        description: pkg.description || '',
                        version: version,
                        packageVersion: pkg.version || '1.0.0', // Original-Version für Vergleich
                        author: (typeof pkg.author === 'string' ? pkg.author : (pkg.author?.name || 'Unbekannt')),
                        enabled: isEnabled,
                        hasSettings,
                        settingsUrl: hasSettings ? `/guild/${guildId}/plugins/${pluginName}/settings` : null,
                        icon,
                        isCore,
                        canDisable: !isCore,
                        // NEU: Badge-Informationen hinzufügen
                        badge: pluginBadges[pluginName] || null
                    };

                    if (plugin.enabled) {
                        enabledPlugins.push(plugin);
                    } else {
                        availablePlugins.push(plugin);
                    }
                }

                // Sortieren: Core immer zuerst, dann alphabetisch
                const priorityPlugins = ['core'];
                enabledPlugins.sort((a, b) => {
                    const aPriority = priorityPlugins.indexOf(a.name);
                    const bPriority = priorityPlugins.indexOf(b.name);
                    
                    // Beide in Priority-Liste: nach Liste sortieren
                    if (aPriority !== -1 && bPriority !== -1) return aPriority - bPriority;
                    // Nur A in Priority: A kommt zuerst
                    if (aPriority !== -1) return -1;
                    // Nur B in Priority: B kommt zuerst
                    if (bPriority !== -1) return 1;
                    // Beide nicht in Priority: alphabetisch
                    return a.displayName.localeCompare(b.displayName);
                });
                
                availablePlugins.sort((a, b) => {
                    const aPriority = priorityPlugins.indexOf(a.name);
                    const bPriority = priorityPlugins.indexOf(b.name);
                    
                    if (aPriority !== -1 && bPriority !== -1) return aPriority - bPriority;
                    if (aPriority !== -1) return -1;
                    if (bPriority !== -1) return 1;
                    return a.displayName.localeCompare(b.displayName);
                });
            }
        } catch (scanErr) {
            Logger.error(`[Plugins] Fehler beim Durchsuchen des Plugin-Verzeichnisses:`, scanErr);
        }

        const pendingUpdates = [];

        // Breadcrumbs
        const breadcrumbs = [
            { title: 'Dashboard', url: `/guild/${guildId}` },
            { title: 'Plugins', url: `/guild/${guildId}/plugins` }
        ];

        // Template rendern mit korrektem Titel
        res.render("guild/plugins", {
            title: `Plugins für ${guildName || 'Unbekannter Server'}`, // NEU: Fallback hinzugefügt
            activeMenu: `/guild/${guildId}/plugins`,
            user: res.locals.user || req.session?.user?.info || null,
            guild: {
                ...guild,
                name: guildName // NEU: Sicherstellen dass Name verfügbar ist
            },
            guildId,
            enabledPlugins,
            availablePlugins,
            pendingUpdates,
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
        
        // Owner-only Plugins prüfen
        const pluginsDir = path.resolve(__dirname, "../../../plugins");
        for (const pluginName of plugins) {
            const configPath = path.join(pluginsDir, pluginName, "config.json");
            if (fs.existsSync(configPath)) {
                try {
                    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
                    if (config.BOT_OWNER_ID) {
                        const currentUser = req.session?.user;
                        const controlGuildId = process.env.CONTROL_GUILD_ID;
                        
                        // Prüfe Owner-ID
                        if (!currentUser || currentUser.info.id !== config.BOT_OWNER_ID) {
                            return res.status(403).json({
                                success: false,
                                message: `Plugin "${pluginName}" ist nur für den Bot-Owner verfügbar.`
                            });
                        }
                        
                        // Prüfe Control Guild
                        if (controlGuildId && guildId !== controlGuildId) {
                            return res.status(403).json({
                                success: false,
                                message: `Plugin "${pluginName}" ist nur in der Control Guild verfügbar.`
                            });
                        }
                    }
                } catch (configErr) {
                    Logger.error(`[Plugins] Fehler beim Prüfen der config.json von ${pluginName}:`, configErr);
                }
            }
        }
        
        // Aktion durchführen
        const results = [];
        
        // Fix: else nach dem if und vor dem disable entfernen
        if (action === 'enable') {
            for (const plugin of plugins) {
                try {
                    await pluginManager.enableInGuild(plugin, guildId, req);
                    results.push({
                        plugin,
                        success: true,
                        message: `Plugin "${plugin}" erfolgreich aktiviert`
                    });
                } catch (err) {
                    results.push({
                        plugin,
                        success: false,
                        message: err.message
                    });
                }
            }
        } else if (action === 'disable') { // Fix: else if statt if
            for (const plugin of plugins) {
                try {
                    await pluginManager.disableInGuild(plugin, guildId, req);
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
            results,
            requiresReload: true // Fix: requiresReload für den AJAX Handler
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
        const i18n = ServiceManager.get('i18n');
        const languagesMeta = i18n?.languagesMeta || [];
        
        const availableLanguages = languagesMeta.map(lng => ({
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
            user: res.locals.user || req.session?.user?.info || null,
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

/**
 * Plugin-Update durchführen
 * @author firedervil
 * @param {import('express').Request} req - Express Request Objekt
 * @param {import('express').Response} res - Express Response Objekt
 * @returns {Promise<void>}
 */
exports.updatePluginVersion = async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const pluginManager = ServiceManager.get('pluginManager');

    try {
        const { guildId, pluginName } = req.params;
        
        Logger.info(`[Plugin Update] Starting update for plugin ${pluginName} in guild ${guildId}`);

        // Update durchführen (isAutoUpdate = false, da manuell)
        await pluginManager.updatePlugin(pluginName, guildId, false);

        Logger.info(`[Plugin Update] Successfully updated plugin ${pluginName} in guild ${guildId}`);

        res.json({
            success: true,
            message: `Plugin ${pluginName} wurde erfolgreich aktualisiert.`
        });

    } catch (error) {
        Logger.error(`[Plugin Update] Fehler beim Aktualisieren von Plugin ${req.params.pluginName}:`, error);
        res.status(500).json({
            success: false,
            message: error.message || "Ein Fehler ist beim Update aufgetreten."
        });
    }
};
