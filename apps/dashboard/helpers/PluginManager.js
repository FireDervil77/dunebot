const fs = require("fs");
const path = require("path");
const { ServiceManager, BasePluginManager, PluginHooks } = require("dunebot-core");
const { DashboardPlugin } = require("dunebot-sdk");
const { parseJsonArray } = require("dunebot-sdk/utils");

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
        this.hooks.addFilter('guild_dashboard_widgets', async (widgets) => widgets);
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

    
    async getPluginUpdateInfo(pluginName) {
        const pluginsMeta = await this.getPluginsMeta();
        const plugin = pluginsMeta.find(p => p.name === pluginName);
        if (!plugin) return null;
        return {
            hasUpdate: plugin.hasUpdate,
            currentVersion: plugin.currentVersion,
            latestVersion: plugin.version,
            repository: plugin.repository
        };
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
            // Core ist immer aktiviert
            if (pluginName === "core") return true;

            // NEUE METHODE: guild_plugins Tabelle nutzen
            return await dbService.isPluginEnabledForGuild(guildId, pluginName);

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
    * Prüft, ob ein User die erforderlichen Berechtigungen für ein Plugin in einer Guild hat
    * @param {string} userId - Discord User-ID
    * @param {string} guildId - Discord Guild-ID
    * @param {string} pluginName - Name des Plugins
    * @param {string|string[]} requiredPermissions - Erforderliche Berechtigungen
    * @returns {Promise<boolean>}
    */
    async checkUserGuildPluginPermissions(userId, guildId, pluginName, requiredPermissions) {
        // Admins haben immer Zugriff
        const user = await this.getUser(userId);
        if (user?.admin) return true;

        // Discord Guild Permissions prüfen (z.B. MANAGE_GUILD, ADMINISTRATOR)
        const guild = await this.getGuild(guildId);
        const member = guild?.members?.find(m => m.id === userId);
        if (!member) return false;

        // Discord-Permissions prüfen
        const perms = member.permissions || [];
        if (perms.includes("ADMINISTRATOR") || perms.includes("MANAGE_GUILD")) return true;

        // Plugin-spezifische Berechtigungen prüfen (optional)
        // TODO: Custom-Logik für Plugin-Rollen etc.

        // requiredPermissions prüfen
        if (!requiredPermissions) return true;
        if (Array.isArray(requiredPermissions)) {
            return requiredPermissions.every(perm => perms.includes(perm));
        }
        return perms.includes(requiredPermissions);
    }

    /**
     * Prüft, ob ein User die erforderlichen Berechtigungen für ein Plugin (global) hat
     * @param {string} userId - Discord User-ID
     * @param {string} pluginName - Name des Plugins
     * @param {string|string[]} requiredPermissions - Erforderliche Berechtigungen
     * @returns {Promise<boolean>}
     */
    async checkUserPluginPermissions(userId, pluginName, requiredPermissions) {
        // Admins haben immer Zugriff
        const user = await this.getUser(userId);
        if (user?.admin) return true;

        // TODO: Custom-Logik für globale Plugin-Berechtigungen

        // requiredPermissions prüfen
        if (!requiredPermissions) return true;
        if (Array.isArray(requiredPermissions)) {
            return requiredPermissions.every(perm => user.permissions?.includes(perm));
        }
        return user.permissions?.includes(requiredPermissions);
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
     * @param {Object} req - Express Request-Objekt (optional, für Audit Trail)
     * @returns {Promise<boolean>} Erfolg der Aktivierung
     */
    async enableInGuild(pluginName, guildId, req = null) {
        const Logger = ServiceManager.get("Logger");
        const themeManager = ServiceManager.get('themeManager'); 
        const dbService = ServiceManager.get('dbService');

        try {
            await this.hooks.doAction('before_enable_in_guild', pluginName, guildId);

            // Plugin aktivieren wenn nötig, aber OHNE globale Config-Initialisierung
            if (!this.getPlugin(pluginName)) {
                const activated = await this.enablePlugin(pluginName, false);
                if (!activated) {
                    throw new Error(`Plugin ${pluginName} konnte nicht global aktiviert werden`);
                }
            }

            const plugin = this.getPlugin(pluginName);
            if (!plugin) {
                throw new Error(`Plugin ${pluginName} ist nicht aktiviert.`);
            }

            // NEU: Plugin Config NUR mit Guild-ID initialisieren
            // WICHTIG: Config-Speicherung funktioniert AUCH ohne plugin.config Objekt!
            try {
                // Falls plugin.config existiert, Guild-ID setzen
                if (plugin.config) {
                    plugin.config.setGuildId(guildId);
                }
                
                // Default-Config laden und flach speichern
                const configPath = path.join(plugin.baseDir, 'config.json');
                if (fs.existsSync(configPath)) {
                    const defaultConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                    
                    // Config flach machen und nur für Guild speichern
                    const flattenConfig = (obj, prefix = '') => {
                        return Object.keys(obj).reduce((acc, k) => {
                            const pre = prefix.length ? `${prefix}.${k}` : k;
                            if (typeof obj[k] === 'object' && obj[k] !== null && !Array.isArray(obj[k])) {
                                Object.assign(acc, flattenConfig(obj[k], pre));
                            } else {
                                acc[pre] = obj[k];
                            }
                            return acc;
                        }, {});
                    };

                    const flatConfig = flattenConfig(defaultConfig);
                    
                    // WICHTIG: ensureConfig() nutzen statt setConfig()
                    // Das überschreibt KEINE existierenden User-Configs!
                    for (const [key, value] of Object.entries(flatConfig)) {
                        await dbService.ensureConfig(
                            pluginName,
                            key,
                            value,
                            "shared",
                            guildId,  // Explizit Guild-ID
                            false     // nicht global
                        );
                    }
                    
                    Logger.info(`Config für Plugin ${pluginName} in Guild ${guildId} initialisiert`);
                }
            } catch (configError) {
                Logger.error(`Fehler beim Initialisieren der Plugin-Config für ${pluginName} in Guild ${guildId}:`, configError);
            }

            // NEU: Plugin in guild_plugins Tabelle aktivieren
            const userId = req?.session?.user?.info?.id || null;
            const pluginVersion = plugin.version || null;
            
            await dbService.enablePluginForGuild(guildId, pluginName, pluginVersion, userId);
            Logger.debug(`Plugin ${pluginName} (v${pluginVersion}) in guild_plugins für Guild ${guildId} aktiviert (User: ${userId || 'System'})`);

            // Plugin-spezifische Guild-Aktivierung aufrufen
            await this.hooks.doAction('before_plugin_guild_enable_method', plugin, guildId);
            
            if (plugin.onGuildEnable && typeof plugin.onGuildEnable === 'function') {
                try {
                    await plugin.onGuildEnable(guildId);
                    Logger.debug(`Plugin ${pluginName}: onGuildEnable() erfolgreich für Guild ${guildId}`);
                } catch (enableError) {
                    Logger.error(`Plugin ${pluginName}: Fehler in onGuildEnable() für Guild ${guildId}:`, enableError);
                    await this.hooks.doAction('plugin_guild_enable_method_failed', plugin, guildId, enableError);
                }
            }
            
            await this.hooks.doAction('after_plugin_guild_enable_method', plugin, guildId);

            await this.hooks.doAction('after_enable_in_guild', pluginName, guildId, plugin);

            return true;
        } catch (error) {
            Logger.error(`Fehler beim Aktivieren von Plugin ${pluginName} für Guild ${guildId}:`, error);
            await this.hooks.doAction('enable_in_guild_failed', pluginName, guildId, error);
            return false;
        }
    }

    /**
     * Plugin für eine bestimmte Guild deaktivieren
     * @param {string} pluginName - Name des zu deaktivierenden Plugins
     * @param {string} guildId - ID der Guild
     * @param {Object} req - Express Request-Objekt (optional, für Audit Trail)
     * @returns {Promise<boolean>} Erfolg der Deaktivierung
     */
    async disableInGuild(pluginName, guildId, req = null) {
        const Logger = ServiceManager.get("Logger");
        const dbService = ServiceManager.get('dbService');
        const navigationManager = ServiceManager.get('navigationManager');

        await this.hooks.doAction('before_disable_in_guild', pluginName, guildId);

        try {
            // Core Plugin kann niemals deaktiviert werden
            if (pluginName === "core") {
                const error = new Error("Cannot disable core plugin");
                await this.hooks.doAction('disable_in_guild_failed', pluginName, guildId, error);
                throw error;
            }

            const plugin = this.getPlugin(pluginName);
            if (!plugin) {
                Logger.warn(`Plugin ${pluginName} not found, cannot disable in guild ${guildId}`);
                return;
            }

            await this.hooks.doAction('before_guild_specific_disable', plugin, guildId);

            // 1. Plugin-spezifische Deaktivierung
            await this.hooks.doAction('before_plugin_guild_disable_method', plugin, guildId);
            
            if (plugin.onGuildDisable && typeof plugin.onGuildDisable === 'function') {
                try {
                    await plugin.onGuildDisable(guildId);
                    Logger.debug(`Plugin ${pluginName}: onGuildDisable() erfolgreich für Guild ${guildId}`);
                } catch (disableError) {
                    Logger.error(`Plugin ${pluginName}: Fehler in onGuildDisable() für Guild ${guildId}:`, disableError);
                    await this.hooks.doAction('plugin_guild_disable_method_failed', plugin, guildId, disableError);
                }
            }
            
            await this.hooks.doAction('after_plugin_guild_disable_method', plugin, guildId);

            await this.hooks.doAction('after_guild_specific_disable', plugin, guildId);

            // 2. Plugin-Konfiguration entfernen
            try {
                // Alle Konfigurationseinträge für dieses Plugin in dieser Guild löschen
                await dbService.query(
                    "DELETE FROM configs WHERE plugin_name = ? AND guild_id = ?",
                    [pluginName, guildId]
                );
                Logger.debug(`Konfigurationen für Plugin ${pluginName} in Guild ${guildId} entfernt`);
            } catch (configError) {
                Logger.error(`Fehler beim Entfernen der Konfigurationen für ${pluginName}:`, configError);
            }

            // 3. Plugin-spezifische Daten bereinigen
            try {
                // Plugin-Tabellen ermitteln
                const pluginTables = plugin.getDatabaseTables?.() || [];
                
                // Für jede Tabelle Guild-spezifische Einträge löschen
                for (const table of pluginTables) {
                    if (table.hasGuildData) {
                        await dbService.query(
                            `DELETE FROM ${table.name} WHERE guild_id = ?`,
                            [guildId]
                        );
                        Logger.debug(`Daten aus Tabelle ${table.name} für Guild ${guildId} entfernt`);
                    }
                }
            } catch (tableError) {
                Logger.error(`Fehler beim Bereinigen der Plugin-Tabellen für ${pluginName}:`, tableError);
            }

            await this.hooks.doAction('before_update_guild_settings_disable', plugin, guildId);

            // 4. Plugin in guild_plugins Tabelle deaktivieren (NEU!)
            const userId = req?.session?.user?.info?.id || null;
            await dbService.disablePluginForGuild(guildId, pluginName, userId);
            Logger.debug(`Plugin ${pluginName} in guild_plugins für Guild ${guildId} deaktiviert (User: ${userId || 'System'})`);

            await this.hooks.doAction('after_update_guild_settings_disable', plugin, guildId);

            // 5. Navigation entfernen - NEU: Nutze NavigationManager statt ThemeManager
            if (navigationManager) {
                await navigationManager.removeNavigation(pluginName, guildId);
                Logger.debug(`Navigation für Plugin ${pluginName} in Guild ${guildId} entfernt`);
            } else {
                Logger.warn('NavigationManager nicht verfügbar');
            }

            await this.hooks.doAction('after_disable_in_guild', pluginName, guildId, plugin);

            Logger.success(`Plugin ${pluginName} für Guild ${guildId} deaktiviert und bereinigt`);

            return true;
        } catch (error) {
            await this.hooks.doAction('disable_in_guild_failed', pluginName, guildId, error);
            Logger.error(`Fehler beim Deaktivieren des Plugins ${pluginName} in Guild ${guildId}:`, error);
            throw error;
        }
    }

    // ============================================================
    // PLUGIN UPDATE SYSTEM (WordPress-Style)
    // ============================================================

    /**
     * Lädt plugin.json Metadaten
     * @param {string} pluginName 
     * @returns {Object|null}
     */
    loadPluginMeta(pluginName) {
        const Logger = ServiceManager.get('Logger');
        const metaPath = path.join(this.pluginDir, pluginName, 'plugin.json');
        
        if (!fs.existsSync(metaPath)) {
            Logger.debug(`[PluginManager] Kein plugin.json für ${pluginName} gefunden`);
            return null;
        }
        
        try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            return meta;
        } catch (error) {
            Logger.error(`[PluginManager] Fehler beim Laden von plugin.json für ${pluginName}:`, error);
            return null;
        }
    }

    /**
     * Prüft alle aktiven Plugins auf Updates
     * @param {string} guildId 
     */
    async checkAllPluginUpdates(guildId) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        
        try {
            // Alle aktivierten Plugins für diese Guild
            const [plugins] = await dbService.query(`
                SELECT plugin_name 
                FROM guild_plugins 
                WHERE guild_id = ? AND enabled = 1
            `, [guildId]);
            
            Logger.debug(`[PluginManager] Prüfe Updates für ${plugins.length} Plugins in Guild ${guildId}`);
            
            for (const { plugin_name } of plugins) {
                await this.checkPluginUpdate(plugin_name, guildId);
            }
        } catch (error) {
            Logger.error(`[PluginManager] Fehler beim Prüfen von Plugin-Updates:`, error);
        }
    }

    /**
     * Prüft ein einzelnes Plugin auf Update
     * @param {string} pluginName 
     * @param {string} guildId 
     */
    async checkPluginUpdate(pluginName, guildId) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        const semver = require('semver');
        
        try {
            // plugin.json laden
            const pluginMeta = this.loadPluginMeta(pluginName);
            if (!pluginMeta || !pluginMeta.version) {
                return; // Kein plugin.json = kein Versioning
            }
            
            const fileVersion = pluginMeta.version;
            
            // Aktuelle Version aus DB
            const [versionRow] = await dbService.query(`
                SELECT current_version, update_status 
                FROM plugin_versions 
                WHERE plugin_name = ? AND guild_id = ?
            `, [pluginName, guildId]);
            
            const currentVersion = versionRow?.current_version || '0.0.0';
            
            // Versions-Vergleich
            if (semver.gt(fileVersion, currentVersion)) {
                Logger.warn(`[PluginManager] Update verfügbar: ${pluginName} ${currentVersion} → ${fileVersion}`);
                
                // SuperAdmin Config: Grace Period
                const [graceDaysRow] = await dbService.query(`
                    SELECT config_value 
                    FROM superadmin_config 
                    WHERE config_key = 'plugin_update_grace_days'
                `);
                
                const graceDays = parseInt(graceDaysRow?.config_value || '5');
                
                const updateAvailableAt = new Date();
                const updateDeadlineAt = new Date();
                updateDeadlineAt.setDate(updateDeadlineAt.getDate() + graceDays);
                
                // Update-Info in DB speichern
                await dbService.query(`
                    INSERT INTO plugin_versions 
                        (plugin_name, guild_id, current_version, available_version, 
                         update_available_at, update_deadline_at, update_status, changelog)
                    VALUES 
                        (?, ?, ?, ?, ?, ?, 'available', ?)
                    ON DUPLICATE KEY UPDATE
                        available_version = VALUES(available_version),
                        update_available_at = VALUES(update_available_at),
                        update_deadline_at = VALUES(update_deadline_at),
                        update_status = 'available',
                        changelog = VALUES(changelog)
                `, [
                    pluginName, 
                    guildId, 
                    currentVersion, 
                    fileVersion,
                    updateAvailableAt,
                    updateDeadlineAt,
                    JSON.stringify(pluginMeta.changelog?.[fileVersion] || [])
                ]);
                
                Logger.info(`[PluginManager] Update-Notice erstellt: ${pluginName} (Deadline: ${updateDeadlineAt.toLocaleDateString('de-DE')})`);
            } else {
                // Aktuell oder Downgrade
                Logger.debug(`[PluginManager] ${pluginName} ist aktuell (v${currentVersion})`);
            }
        } catch (error) {
            Logger.error(`[PluginManager] Fehler beim Prüfen von ${pluginName}:`, error);
        }
    }

    /**
     * Führt Plugin-Update durch (manuell oder automatisch)
     * @param {string} pluginName 
     * @param {string} guildId 
     * @param {boolean} isAutoUpdate 
     * @returns {Promise<{success: boolean, version?: string, error?: string}>}
     */
    async updatePlugin(pluginName, guildId, isAutoUpdate = false) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        
        try {
            // Update-Info laden
            const [updateInfo] = await dbService.query(`
                SELECT * FROM plugin_versions 
                WHERE plugin_name = ? AND guild_id = ?
            `, [pluginName, guildId]);
            
            if (!updateInfo || !updateInfo.available_version) {
                throw new Error('Kein Update verfügbar');
            }
            
            const targetVersion = updateInfo.available_version;
            
            Logger.info(`[PluginManager] Starte ${isAutoUpdate ? 'Auto-' : ''}Update: ${pluginName} → v${targetVersion} (Guild: ${guildId})`);
            
            // Migration ausführen
            await this.runMigration(pluginName, targetVersion, guildId);
            
            // Status aktualisieren
            await dbService.query(`
                UPDATE plugin_versions 
                SET 
                    current_version = ?,
                    available_version = NULL,
                    update_status = ?,
                    auto_update_at = ?,
                    error_log = NULL
                WHERE plugin_name = ? AND guild_id = ?
            `, [
                targetVersion,
                isAutoUpdate ? 'auto-updated' : 'up-to-date',
                isAutoUpdate ? new Date() : null,
                pluginName,
                guildId
            ]);
            
            Logger.success(`[PluginManager] ${pluginName} erfolgreich aktualisiert auf v${targetVersion}`);
            
            return { success: true, version: targetVersion };
            
        } catch (error) {
            Logger.error(`[PluginManager] Update fehlgeschlagen:`, error);
            
            // Fehler in DB speichern
            await dbService.query(`
                UPDATE plugin_versions 
                SET update_status = 'failed', error_log = ?
                WHERE plugin_name = ? AND guild_id = ?
            `, [error.message, pluginName, guildId]);
            
            return { success: false, error: error.message };
        }
    }

    /**
     * Führt Migration-Script aus
     * @param {string} pluginName 
     * @param {string} targetVersion 
     * @param {string} guildId 
     */
    async runMigration(pluginName, targetVersion, guildId) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        
        // plugin.json laden
        const pluginMeta = this.loadPluginMeta(pluginName);
        if (!pluginMeta || !pluginMeta.migrations) {
            Logger.debug(`[PluginManager] Keine Migrations für ${pluginName} definiert`);
            return;
        }
        
        // Migration-File für diese Version
        const migrationFile = pluginMeta.migrations[targetVersion];
        
        if (!migrationFile) {
            Logger.debug(`[PluginManager] Keine Migration für ${pluginName} v${targetVersion}`);
            return;
        }
        
        const migrationPath = path.join(this.pluginDir, pluginName, migrationFile);
        
        if (!fs.existsSync(migrationPath)) {
            throw new Error(`Migration-File nicht gefunden: ${migrationPath}`);
        }
        
        Logger.info(`[PluginManager] Führe Migration aus: ${pluginName} → v${targetVersion}`);
        
        // Migration laden und ausführen
        const migration = require(migrationPath);
        const result = await migration.up(dbService, guildId);
        
        if (!result.success) {
            throw new Error(`Migration fehlgeschlagen: ${result.error}`);
        }
        
        Logger.success(`[PluginManager] Migration erfolgreich: ${pluginName} v${targetVersion}`);
    }

    /**
     * Cronjob: Auto-Update für abgelaufene Deadlines
     * Wird täglich ausgeführt
     */
    async processAutoUpdates() {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        
        try {
            // SuperAdmin Config prüfen
            const [autoUpdateRow] = await dbService.query(`
                SELECT config_value 
                FROM superadmin_config 
                WHERE config_key = 'plugin_auto_update_enabled'
            `);
            
            const autoUpdateEnabled = autoUpdateRow?.config_value === 'true';
            
            if (!autoUpdateEnabled) {
                Logger.debug('[PluginManager] Auto-Update ist global deaktiviert');
                return;
            }
            
            // Alle abgelaufenen Updates
            const overdueUpdates = await dbService.query(`
                SELECT plugin_name, guild_id, available_version
                FROM plugin_versions
                WHERE update_status = 'available'
                AND update_deadline_at <= NOW()
            `);
            
            Logger.info(`[PluginManager] ${overdueUpdates.length} Auto-Updates anstehend`);
            
            for (const { plugin_name, guild_id, available_version } of overdueUpdates) {
                Logger.info(`[PluginManager] Auto-Update: ${plugin_name} für Guild ${guild_id}`);
                
                const result = await this.updatePlugin(plugin_name, guild_id, true);
                
                if (!result.success) {
                    // Admin benachrichtigen via IPC
                    await this.notifyAdminAboutFailedUpdate(guild_id, plugin_name, result.error);
                }
            }
        } catch (error) {
            Logger.error('[PluginManager] Fehler beim Auto-Update-Prozess:', error);
        }
    }

    /**
     * Benachrichtigt Guild-Owner über fehlgeschlagenes Auto-Update
     * @param {string} guildId 
     * @param {string} pluginName 
     * @param {string} error 
     */
    async notifyAdminAboutFailedUpdate(guildId, pluginName, error) {
        const Logger = ServiceManager.get('Logger');
        
        try {
            const ipcClient = ServiceManager.get('ipcClient');
            
            if (!ipcClient) {
                Logger.warn('[PluginManager] IPC Client nicht verfügbar für Admin-Benachrichtigung');
                return;
            }
            
            await ipcClient.send('bot:NOTIFY_GUILD_OWNER', {
                guildId,
                title: `⚠️ Plugin-Update fehlgeschlagen`,
                message: `Das automatische Update für **${pluginName}** ist fehlgeschlagen.\n\nFehler: ${error}\n\nBitte manuell über das Dashboard aktualisieren.`,
                color: 0xFF0000 // RED
            });
            
            Logger.info(`[PluginManager] Admin-Benachrichtigung für Guild ${guildId} gesendet`);
        } catch (error) {
            Logger.error('[PluginManager] Fehler beim Senden der Admin-Benachrichtigung:', error);
        }
    }

    /**
     * Lädt alle verfügbaren Plugin-Updates für eine Guild
     * @param {string} guildId 
     * @returns {Promise<Array>}
     */
    async getAvailableUpdates(guildId) {
        const dbService = ServiceManager.get('dbService');
        
        const updates = await dbService.query(`
            SELECT 
                plugin_name,
                current_version,
                available_version,
                update_available_at,
                update_deadline_at,
                update_status,
                changelog
            FROM plugin_versions
            WHERE guild_id = ?
            AND update_status IN ('available', 'failed')
            ORDER BY update_available_at DESC
        `, [guildId]);
        
        // Changelog JSON parsen
        return updates.map(update => ({
            ...update,
            changelog: JSON.parse(update.changelog || '[]'),
            daysLeft: this._calculateDaysLeft(update.update_deadline_at)
        }));
    }

    /**
     * Berechnet verbleibende Tage bis Deadline
     * @param {Date} deadline 
     * @returns {number}
     */
    _calculateDaysLeft(deadline) {
        if (!deadline) return 0;
        const now = new Date();
        const diff = new Date(deadline) - now;
        return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
    }
}

module.exports = PluginManager;