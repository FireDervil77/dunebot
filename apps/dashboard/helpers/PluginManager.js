const fs = require("fs");
const path = require("path");
const { ServiceManager, BasePluginManager, PluginHooks } = require("dunebot-core");
const { DashboardPlugin } = require("dunebot-sdk");
const execa = require("execa");

class PluginManager extends BasePluginManager {
    /**
     * @param {import('express').Application} app
     * @param {string} registryPath
     * @param {string} pluginDir
     */
    constructor(app, registryPath, pluginDir) {
        const dbService = ServiceManager.get("dbService");
        const Logger = ServiceManager.get("Logger");
        const navigationManager = ServiceManager.get('navigationManager');

        super(registryPath, pluginDir, Logger);
        this.context = 'dashboard'; // Kontext explizit setzen
        this.app = app;
        this.hooks = new PluginHooks(Logger); // Hook-System direkt initialisieren
               
        // Dashboard-spezifische Hook-Registrierung
        this._registerCoreHooks();
        this.navigationManager = navigationManager;
    }

    /**
     * Kern-Hooks für das Dashboard registrieren
     */
    _registerCoreHooks() {
        // Filter-Hooks
        this.hooks.addFilter('guild_navigation_items', async (items) => items);
        this.hooks.addFilter('dashboard_widgets', async (widgets) => widgets);
        this.hooks.addFilter('guild_sections', async (sections) => sections);
        
        // Action-Hooks
        this.hooks.addAction('before_route_render', () => {});
        this.hooks.addAction('after_plugin_enable', () => {});
    }

    /**
     * Registriert Plugin-Routen in der Express-App
     * 
     * @author firedervil
     */
    registerPluginRoutes() {
    const Logger = ServiceManager.get('Logger');

    // "before_register_routes" Hook aufrufen
    this.hooks.doAction('before_register_routes', this.app);
    
    // Plugin-Array abrufen
    const plugins = this.plugins;
    
    Logger.debug(`Registriere Routen für ${plugins.length} Plugins`);
    
    // Über Plugins iterieren
    for (const plugin of plugins) {
        try {
            if (!plugin || !plugin.name) {
                Logger.warn('Ungültiges Plugin-Objekt übersprungen');
                continue;
            }
            
            const pluginName = plugin.name;
            Logger.debug(`Verarbeite Routen für Plugin ${pluginName}`);
            
                // Guild-Router validieren
                if (plugin.guildRouter) {
                    try {
                        Logger.debug(`Plugin ${pluginName} hat einen guildRouter vom Typ: ${typeof plugin.guildRouter}`);
                        
                        if (!plugin.guildRouter || typeof plugin.guildRouter.use !== 'function') {
                            Logger.warn(`Plugin ${pluginName} hat einen ungültigen guildRouter`);
                            plugin.guildRouter = null;
                        } else {
                            // Router validiert und bereit zur Verwendung
                            Logger.debug(`Guild-Router für Plugin ${pluginName} validiert`);
                            
                            // DEBUG: Router-Routen ausgeben
                            Logger.debug('Registrierte Routen:', {
                                plugin: pluginName,
                                routes: plugin.guildRouter.stack
                                    .filter(r => r.route)
                                    .map(r => ({
                                        path: r.route.path,
                                        methods: Object.keys(r.route.methods)
                                    }))
                            });
                        }
                    } catch (routeError) {
                        Logger.error(`Fehler beim Validieren des Guild-Routers für Plugin ${pluginName}:`, routeError);
                        plugin.guildRouter = null;
                    }
                }
                
                // API-Router verarbeiten
                if (plugin.apiRouter) {
                    try {
                        Logger.debug(`Plugin ${pluginName} hat einen apiRouter vom Typ: ${typeof plugin.apiRouter}`);
                        
                        if (!plugin.apiRouter || typeof plugin.apiRouter.use !== 'function') {
                            Logger.warn(`Plugin ${pluginName} hat einen ungültigen apiRouter (Typ: ${typeof plugin.apiRouter})`);
                        } else {
                            // Direkt den Original-Router verwenden (Filter verursacht Probleme)
                            const apiRouter = plugin.apiRouter;
                            
                            // API-Route registrieren
                            this.app.use(
                                `/api/${pluginName}`,
                                (req, res, next) => {
                                    res.locals.plugin = plugin;
                                    next();
                                },
                                apiRouter
                            );
                            Logger.debug(`API-Router für Plugin ${pluginName} erfolgreich registriert`);
                        }
                    } catch (routeError) {
                        Logger.error(`Fehler beim Registrieren des API-Routers für Plugin ${pluginName}:`, routeError);
                    }
                }
                
                // Frontend-Router verarbeiten
                if (plugin.frontendRouter) {
                    try {
                        Logger.debug(`Plugin ${pluginName} hat einen frontendRouter vom Typ: ${typeof plugin.frontendRouter}`);
                        
                        if (!plugin.frontendRouter || typeof plugin.frontendRouter.use !== 'function') {
                            Logger.warn(`Plugin ${pluginName} hat einen ungültigen frontendRouter (Typ: ${typeof plugin.frontendRouter})`);
                        } else {
                            // Direkt den Original-Router verwenden (Filter verursacht Probleme)
                            const frontendRouter = plugin.frontendRouter;
                            
                            // Frontend-Route registrieren
                            this.app.use(
                                `/plugin/${pluginName}`,
                                (req, res, next) => {
                                    res.locals.plugin = plugin;
                                    next();
                                },
                                frontendRouter
                            );
                            Logger.debug(`Frontend-Router für Plugin ${pluginName} erfolgreich registriert`);
                        }
                    } catch (routeError) {
                        Logger.error(`Fehler beim Registrieren des Frontend-Routers für Plugin ${pluginName}:`, routeError);
                    }
                }
            } catch (pluginError) {
                Logger.error(`Fehler bei der Verarbeitung des Plugins ${plugin?.name || 'unknown'}:`, pluginError);
            }
        }
        
        // "after_register_routes" Hook aufrufen
        this.hooks.doAction('after_register_routes', this.app);
    }

     /**
     * Prüft ob ein Plugin für eine bestimmte Guild aktiviert ist
     * @param {string} pluginName - Name des Plugins
     * @param {string} guildId - ID der Guild
     * @returns {Promise<boolean>}
     */
    async isPluginEnabledForGuild(pluginName, guildId) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        try {
            // Settings aus der DB laden
            const [settings] = await dbService.query(
                "SELECT enabled_plugins FROM settings WHERE _id = ?",
                [guildId]
            );

            // Enabled Plugins parsen
            let enabledPlugins = ["core"]; // Core ist immer aktiviert
            if (settings?.enabled_plugins) {
                enabledPlugins = typeof settings.enabled_plugins === 'string' ?
                    JSON.parse(settings.enabled_plugins) :
                    settings.enabled_plugins;
            }

            return enabledPlugins.includes(pluginName);

        } catch (error) {
            Logger.error(`Fehler beim Prüfen des Plugin-Status für ${pluginName} in Guild ${guildId}:`, error);
            // Im Fehlerfall: Core = true, alle anderen = false
            return pluginName === "core";
        }
    }

    /**
     * Lädt die Plugin-Informationen aus der package.json
     * @param {string} pluginName - Name des Plugins
     * @returns {Promise<Object>} Plugin-Metadaten
     */
    async getPluginInfo(pluginName) {
        const Logger = ServiceManager.get('Logger');
        
        try {
            const packagePath = path.join(this.pluginsDir, pluginName, 'package.json');
            
            if (!fs.existsSync(packagePath)) {
                throw new Error(`package.json nicht gefunden für Plugin ${pluginName}`);
            }

            const packageData = require(packagePath);

            return {
                name: pluginName,
                displayName: packageData.displayName || pluginName,
                description: packageData.description || '',
                version: packageData.version || '1.0.0',
                author: typeof packageData.author === 'string' ? 
                    packageData.author : 
                    (packageData.author?.name || 'Unbekannt'),
                repository: packageData.repository || '',
                hasSettings: this.getPlugin(pluginName)?.guildRouter ? true : false,
                settingsUrl: this.getPlugin(pluginName)?.guildRouter ? 
                    `/guild/:guildId/plugins/${pluginName}/settings` : 
                    null
            };
        } catch (error) {
            Logger.error(`Fehler beim Laden der Plugin-Informationen für ${pluginName}:`, error);
            return {
                name: pluginName,
                displayName: pluginName,
                description: 'Keine Informationen verfügbar',
                version: '0.0.0',
                author: 'Unbekannt'
            };
        }
    }

    /**
     * Lädt Plugin-Widgets für das Dashboard
     * @param {string} guildId - ID der Guild
     */
    async getDashboardWidgets(guildId) {
        const widgets = [];
        
        // Hier auf die Getter-Methode der Basisklasse zugreifen
        const plugins = this.plugins;
        
        for (const plugin of plugins) {
            const pluginName = plugin.name;
            
            if (!plugin.dashboardWidgets || !Array.isArray(plugin.dashboardWidgets)) {
                continue;
            }
            
            // Widget-Liste durch Filter laufen lassen
            const pluginWidgets = await this.hooks.applyFilter(
                'filter_plugin_widgets',
                plugin.dashboardWidgets,
                plugin,
                guildId
            );
            
            for (const widget of pluginWidgets) {
                widgets.push({
                    ...widget,
                    plugin: pluginName
                });
            }
        }
        
        // Gesamte Widget-Liste durch Filter laufen lassen
        return await this.hooks.applyFilter('dashboard_widgets', widgets, guildId);
    }

    /**
     * Dashboard-spezifische Implementierung der Tabellen-Registrierung
     * @param {Object} plugin - Das Plugin-Objekt
     */
    async registerDashboardTables(plugin) {
        // ServiceManager bereit stellen
        const Logger = ServiceManager.get("Logger");

        // "before_register_tables" Hook aufrufen
        await this.hooks.doAction('before_register_tables', plugin);
        
        // Dashboard-Kontext verwenden
        await super.registerPluginTables(plugin, 'dashboard');
        
        try {
            // Prüfen, ob eine spezielle dashboard/models/ Struktur existiert
            const dashboardModelsDir = path.join(this.pluginsDir, plugin.name, 'dashboard', 'models');
            if (fs.existsSync(dashboardModelsDir)) {
                await this.registerModelsFromDir(plugin, dashboardModelsDir, 'dashboard-models');
            }
            
            // "after_register_tables" Hook aufrufen
            await this.hooks.doAction('after_register_tables', plugin);
        } catch (error) {
            // "register_tables_failed" Hook aufrufen
            await this.hooks.doAction('register_tables_failed', plugin, error);
            Logger.error(`Error registering dashboard tables for ${plugin.name}:`, error);
        }
    }


    async installPlugin(pluginName) {
        // "before_install_plugin" Hook aufrufen
        await this.hooks.doAction('before_install_plugin', pluginName);
        
        try {
            await super.installPlugin(pluginName);
            
            // "after_install_plugin" Hook aufrufen
            await this.hooks.doAction('after_install_plugin', pluginName);
        } catch (error) {
            // "install_plugin_failed" Hook aufrufen
            await this.hooks.doAction('install_plugin_failed', pluginName, error);
            throw error;
        }
    }

    /**
     * Plugin aktivieren
     * @param {string} pluginName - Name des zu aktivierenden Plugins
     * @param {boolean} registerNavigation - Ob die Navigation registriert werden soll
     * @returns {Promise<boolean>} Erfolg der Aktivierung
     */
    async enablePlugin(pluginName, registerNavigation = true) {
        // ServiceManager bereit stellen
        const Logger = ServiceManager.get("Logger");
        const themeManager = ServiceManager.get('themeManager');
        const dbService = ServiceManager.get('dbService');

        try {
            // Plugin-Aktivierung mit Hooks ausführen
            await this.hooks.doAction('before_enable_plugin', pluginName);
            
            // Prüfen, ob das Plugin bereits aktiviert ist
            if (this.isPluginEnabled(pluginName)) {
                Logger.debug(`Plugin ${pluginName} ist bereits aktiviert`);
                return true;
            }
            
            // Plugin-Verzeichnis prüfen
            const pluginDir = path.join(this.pluginsDir, pluginName);
            if (!fs.existsSync(pluginDir)) {
                throw new Error(`Plugin-Verzeichnis ${pluginDir} existiert nicht`);
            }
            
            Logger.info(`Aktiviere Plugin ${pluginName}...`);
            
            try {
                // Plugin-Modul laden
                const pluginModule = await this.loadPluginModule(pluginName);
                let plugin;
                
                // Prüfen, ob das Plugin für Dashboard implementiert ist
                if (pluginModule) {
                    // Wenn es sich um eine Klasse handelt, instanziieren
                    if (typeof pluginModule === 'function') {
                        plugin = new pluginModule(this.app);
                    } else if (pluginModule instanceof DashboardPlugin) {
                        // Wenn es bereits eine Instanz ist
                        plugin = pluginModule;
                    } else {
                        // Andernfalls direktes Objekt verwenden
                        plugin = pluginModule;
                    }
                    
                    // Minimale Eigenschaften sicherstellen
                    plugin.name = plugin.name || pluginName;
                    
                    // Tabellen registrieren vor dem Enable
                    await this.registerDashboardTables(plugin);
                    
                    // Plugin initialisieren
                    if (typeof plugin.onEnable === 'function') {
                        await plugin.onEnable(this.app, dbService);
                    }
                    
                    // Plugin in der Map speichern
                    this.setPlugin(pluginName, plugin);
                    
                } else {
                    Logger.warn(`Plugin ${pluginName} hat keinen Dashboard-Eintrag. Wird übersprungen.`);
                    return false;
                }
            } catch (err) {
                Logger.error(`Fehler beim Laden des Plugin-Moduls ${pluginName}:`, err);
                
                // Hook für Fehler ausführen
                await this.hooks.doAction('plugin_load_failed', pluginName, err);
                
                return false;
            }
            
            const plugin = this.getPlugin(pluginName);
            
            if (!plugin) {
                Logger.error(`Plugin ${pluginName} konnte nicht aktiviert werden: Nicht gefunden`);
                return false;
            }

            // Navigation registrieren, falls gewünscht
            if (registerNavigation && themeManager) {
                // Guild-Navigation
                if (plugin.dashboardRouter) {
                    themeManager.registerNavigation('guild', {
                        title: plugin.displayName || plugin.name,
                        url: `/guild/:guildId/${plugin.name}`,
                        icon: plugin.icon || 'fa-solid fa-puzzle-piece',
                        priority: plugin.navPriority || 50,
                        plugin: plugin.name
                    });
                    Logger.debug(`Navigation für Dashboard-Plugin ${pluginName} registriert`);
                }
            }

            // Nach der Aktivierung
            await this.hooks.doAction('after_enable_plugin', pluginName, plugin);
            Logger.success(`Plugin ${pluginName} erfolgreich aktiviert`);
            
            return true;
        } catch (error) {
            Logger.error(`Fehler beim Aktivieren von Plugin ${pluginName}:`, error);
            
            // Hook für Fehler ausführen
            await this.hooks.doAction('plugin_enable_failed', pluginName, error);
            
            return false;
        }
    }

    async disablePlugin(pluginName) {
        // ServiceManager bereit stellen
        const Logger = ServiceManager.get("Logger");
        const dbService = ServiceManager.get('dbService');

        // "before_disable_plugin" Hook aufrufen
        await this.hooks.doAction('before_disable_plugin', pluginName);
        
        try {
            const plugin = this.getPlugin(pluginName);
            
            if (!plugin) {
                Logger.warn(`Plugin ${pluginName} not enabled, cannot disable.`);
                return;
            }
            
            // Plugin-spezifische onDisable-Methode aufrufen
            if (plugin.onDisable) {
                // "before_plugin_disable_method" Hook aufrufen
                await this.hooks.doAction('before_plugin_disable_method', pluginName, plugin);
                
                await plugin.onDisable(this.app, dbService);
                
                // "after_plugin_disable_method" Hook aufrufen
                await this.hooks.doAction('after_plugin_disable_method', pluginName, plugin);
            }
            
            // Plugin aus registrierten Plugins entfernen
            this.removePlugin(pluginName);
            
            // Config aktualisieren
            if (pluginName !== "core") {
                const corePlugin = this.getPlugin("core");
                if (corePlugin) {
                    const config = await corePlugin.getConfig();
                    
                    config.ENABLED_PLUGINS = await this.hooks.applyFilter(
                        'modify_enabled_plugins',
                        config.ENABLED_PLUGINS.filter(p => p !== pluginName),
                        pluginName,
                        'remove'
                    );
                    
                    // Native MySQL statt Sequelize
                    await dbService.query(`
                        INSERT INTO configs (plugin_name, config_key, config_value, context)
                        VALUES (?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE
                            config_value = VALUES(config_value)
                    `, [
                        "core",
                        "ENABLED_PLUGINS",
                        JSON.stringify(config.ENABLED_PLUGINS),
                        "shared"
                    ]);
                }
            }
            
            Logger.success(`Disabled plugin: ${pluginName}`);
            
            // "after_disable_plugin" Hook aufrufen
            await this.hooks.doAction('after_disable_plugin', pluginName);
            
        } catch (error) {
            // "disable_plugin_failed" Hook aufrufen
            await this.hooks.doAction('disable_plugin_failed', pluginName, error);
            Logger.error(`Failed to disable plugin ${pluginName}:`, error);
            throw error;
        }
    }

    /**
     * Plugin für eine bestimmte Guild aktivieren
     * @param {string} pluginName - Name des zu aktivierenden Plugins
     * @param {string} guildId - ID der Guild
     * @returns {Promise<boolean>} Erfolg der Aktivierung
     */
    async enableInGuild(pluginName, guildId) {
        // ServiceManager bereit stellen
        const Logger = ServiceManager.get("Logger");
        const themeManager = ServiceManager.get('themeManager');
        const dbService = ServiceManager.get('dbService');

        try {
            // Hook vor der Aktivierung
            await this.hooks.doAction('before_enable_in_guild', pluginName, guildId);
            
            // Prüfen, ob Plugin bereits global aktiviert ist
            if (!this.getPlugin(pluginName)) {
                // Plugin global aktivieren, aber ohne Navigation (die ist guildspezifisch)
                const activated = await this.enablePlugin(pluginName, false);
                if (!activated) {
                    throw new Error(`Plugin ${pluginName} konnte nicht global aktiviert werden`);
                }
            }
            
            const plugin = this.getPlugin(pluginName);
            
            // Guild-spezifische Plugin-Aktivierung
            if (typeof plugin.onGuildEnable === 'function') {
                await plugin.onGuildEnable(guildId);
            }
            
            // Guild-Einstellungen aktualisieren
            // Settings aus der Datenbank laden
            const [settings] = await dbService.query(
                "SELECT * FROM settings WHERE _id = ?",
                [guildId]
            );
            
            if (!settings) {
                // Neue Settings erstellen
                await dbService.query(`
                    INSERT INTO settings 
                        (_id, prefix, locale, enabled_plugins, disabled_prefix, disabled_slash)
                    VALUES 
                        (?, ?, ?, ?, ?, ?)
                `, [
                    guildId,
                    "!",
                    "de-DE",
                    JSON.stringify(["core"]),
                    JSON.stringify([]),
                    JSON.stringify([])
                ]);
            }  else {
                // Vorhandene Einstellungen aktualisieren
                let enabledPlugins = [];
                
                if (settings.enabled_plugins) {
                    enabledPlugins = parseJsonArray(settings.enabled_plugins, ['core']);
                } else {
                    enabledPlugins = ['core'];
                }
                
                // Plugin hinzufügen, wenn nicht bereits vorhanden
                if (!enabledPlugins.includes(pluginName)) {
                    enabledPlugins.push(pluginName);
                }
                
                // Durch Filter laufen lassen
                enabledPlugins = await this.hooks.applyFilter(
                    'modify_guild_enabled_plugins',
                    enabledPlugins,
                    guildId
                );
                
                settings.enabled_plugins = JSON.stringify(enabledPlugins);
                await settings.save();
            }
            
            // Guild-spezifische Navigation registrieren, wenn ThemeManager vorhanden
            if (themeManager) {
                // Guild-Navigation mit Guild-ID
                if (plugin.guildRouter) {
                    themeManager.registerNavigation(`guild_${guildId}`, {
                        title: plugin.displayName || plugin.name,
                        url: `/guild/${guildId}/${plugin.name}`,
                        icon: plugin.icon || 'fa-solid fa-puzzle-piece',
                        priority: plugin.navPriority || 50,
                        plugin: plugin.name,
                        guildId: guildId
                    });
                }
            }
            
            // Nach der Aktivierung
            await this.hooks.doAction('after_enable_in_guild', pluginName, guildId, plugin);
            
            return true;
        } catch (error) {
            Logger.error(`Fehler beim Aktivieren von Plugin ${pluginName} für Guild ${guildId}:`, error);
            await this.hooks.doAction('enable_in_guild_failed', pluginName, guildId, error);
            return false;
        }
    }

    async disableInGuild(pluginName, guildId) {
        // ServiceManager bereit stellen
        const Logger = ServiceManager.get("Logger");
        const dbService = ServiceManager.get('dbService');

        // "before_disable_in_guild" Hook aufrufen
        await this.hooks.doAction('before_disable_in_guild', pluginName, guildId);
        
        try {
            if (pluginName === "core") {
                const error = new Error("Cannot disable core plugin");
                // "disable_in_guild_failed" Hook aufrufen
                await this.hooks.doAction('disable_in_guild_failed', pluginName, guildId, error);
                throw error;
            }

            const plugin = this.getPlugin(pluginName);
            if (!plugin) {
                Logger.warn(`Plugin ${pluginName} not found, cannot disable in guild ${guildId}`);
                return;
            }

            // "before_guild_specific_disable" Hook aufrufen
            await this.hooks.doAction('before_guild_specific_disable', plugin, guildId);
            
            if (plugin.onGuildDisable) {
                await plugin.onGuildDisable(guildId);
            }
            
            // "after_guild_specific_disable" Hook aufrufen
            await this.hooks.doAction('after_guild_specific_disable', plugin, guildId);

            const core = this.getPlugin("core");
            
            // "before_update_guild_settings_disable" Hook aufrufen
            await this.hooks.doAction('before_update_guild_settings_disable', plugin, guildId);
            
            const settings = await dbService.getSettings(guildId);
            let enabledPlugins;
            
            try {
                enabledPlugins = typeof settings.enabled_plugins === 'string' 
                    ? JSON.parse(settings.enabled_plugins)
                    : (Array.isArray(settings.enabled_plugins) 
                        ? settings.enabled_plugins 
                        : ['core']);
            } catch (e) {
                enabledPlugins = ['core'];
            }

            if (enabledPlugins.includes(pluginName)) {
                enabledPlugins = await this.hooks.applyFilter(
                    'modify_guild_enabled_plugins',
                    enabledPlugins.filter(p => p !== pluginName),
                    pluginName,
                    guildId,
                    'remove'
                );
                
                settings.enabled_plugins = JSON.stringify(enabledPlugins);
                
                // Settings aktualisieren
                await dbService.query(`
                    UPDATE settings 
                    SET enabled_plugins = ?
                    WHERE _id = ?
                `, [
                    settings.enabled_plugins,
                    guildId
                ]);
                
                // "after_update_guild_settings_disable" Hook aufrufen
                await this.hooks.doAction('after_update_guild_settings_disable', plugin, guildId, enabledPlugins);
            }
            
            // "after_disable_in_guild" Hook aufrufen
            await this.hooks.doAction('after_disable_in_guild', pluginName, guildId, plugin);
            
            Logger.success(`Disabled plugin ${pluginName} for guild ${guildId}`);
            
            return true;
        } catch (error) {
            // "disable_in_guild_failed" Hook aufrufen
            await this.hooks.doAction('disable_in_guild_failed', pluginName, guildId, error);
            Logger.error(`Failed to disable plugin ${pluginName} in guild ${guildId}:`, error);
            throw error;
        }
    }
}

module.exports = PluginManager;