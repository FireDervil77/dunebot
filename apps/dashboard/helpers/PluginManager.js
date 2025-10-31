const fs = require("fs");
const path = require("path");
const { ServiceManager, BasePluginManager, PluginHooks } = require("dunebot-core");
const { DashboardPlugin } = require("dunebot-sdk");
const { parseJsonArray } = require("dunebot-sdk/utils");

const execa = require("execa");
const https = require("https");
const tar = require("tar");

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
    * Nutzt den PermissionManager für die Prüfung
    * 
    * @param {string} userId - Discord User-ID
    * @param {string} guildId - Discord Guild-ID
    * @param {string} pluginName - Name des Plugins (wird ignoriert - Permissions sind plugin-unabhängig)
    * @param {string|string[]} requiredPermissions - Erforderliche Permission-Keys (z.B. "SETTINGS.VIEW")
    * @returns {Promise<boolean>}
    */
    async checkUserGuildPluginPermissions(userId, guildId, pluginName, requiredPermissions) {
        const Logger = ServiceManager.get('Logger');
        const permissionManager = ServiceManager.get('permissionManager');
        
        try {
            // Keine Permissions erforderlich? → Zugriff erlaubt
            if (!requiredPermissions) {
                return true;
            }
            
            // Array von Permissions? → Alle müssen erfüllt sein
            if (Array.isArray(requiredPermissions)) {
                for (const permKey of requiredPermissions) {
                    const hasPermission = await permissionManager.hasPermission(userId, guildId, permKey);
                    if (!hasPermission) {
                        Logger.debug(`[PluginManager] User ${userId} fehlt Permission: ${permKey}`);
                        return false;
                    }
                }
                return true; // Alle Permissions vorhanden
            }
            
            // Einzelne Permission prüfen
            const hasPermission = await permissionManager.hasPermission(userId, guildId, requiredPermissions);
            if (!hasPermission) {
                Logger.debug(`[PluginManager] User ${userId} fehlt Permission: ${requiredPermissions}`);
            }
            return hasPermission;
            
        } catch (error) {
            Logger.error(`[PluginManager] Error checking permissions for user ${userId}:`, error);
            return false; // Im Fehlerfall: Kein Zugriff
        }
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
            // SQL-Dateien aus dashboard/sql/ laden (MIT MIGRATION-TRACKING!)
            const dashboardSqlDir = path.join(this.pluginsDir, plugin.name, 'dashboard', 'sql');
            if (fs.existsSync(dashboardSqlDir)) {
                await this.registerModelsFromDir(plugin, dashboardSqlDir, 'dashboard-sql');
            }
            
            // "after_register_tables" Hook aufrufen
            await this.hooks.doAction('after_register_tables', plugin);
        } catch (error) {
            // "register_tables_failed" Hook aufrufen
            await this.hooks.doAction('register_tables_failed', plugin, error);
            Logger.error(`Error registering dashboard tables for ${plugin.name}:`, error);
        }
    }

    /**
     * Registriert Permissions aus permissions.json eines Plugins
     * Lädt automatisch die permissions.json und trägt sie in permission_definitions ein
     * 
     * @param {Object} plugin - Das Plugin-Objekt
     * @returns {Promise<number>} Anzahl der registrierten Permissions
     * @author FireDervil
     */
    async registerPluginPermissions(plugin) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        
        try {
            // permissions.json Pfad
            const permissionsFile = path.join(this.pluginsDir, plugin.name, 'dashboard', 'permissions.json');
            
            // Prüfen ob File existiert
            if (!fs.existsSync(permissionsFile)) {
                Logger.debug(`Plugin ${plugin.name} hat keine permissions.json - überspringe`);
                return 0;
            }
            
            // JSON laden
            const permissionsData = JSON.parse(fs.readFileSync(permissionsFile, 'utf8'));
            
            if (!permissionsData.permissions || !Array.isArray(permissionsData.permissions)) {
                Logger.warn(`permissions.json von ${plugin.name} hat ungültiges Format (permissions Array fehlt)`);
                return 0;
            }
            
            Logger.info(`📋 Registriere ${permissionsData.permissions.length} Permissions für Plugin ${plugin.name}...`);
            
            let registeredCount = 0;
            
            // Jede Permission registrieren
            for (const perm of permissionsData.permissions) {
                const {
                    key,
                    name,
                    description,
                    category,
                    is_dangerous = 0,
                    requires = null
                } = perm;
                
                // Validierung
                if (!key || !name || !category) {
                    Logger.warn(`Überspringe ungültige Permission:`, perm);
                    continue;
                }
                
                // requires_permissions zu JSON konvertieren (erwartet Array oder null)
                let requiresJson = null;
                if (requires) {
                    // Wenn String: Als Array mit einem Element behandeln
                    const requiresArray = typeof requires === 'string' ? [requires] : requires;
                    requiresJson = JSON.stringify(requiresArray);
                }
                
                try {
                    // INSERT ... ON DUPLICATE KEY UPDATE Pattern
                    // Schema: permission_key, name_translation_key, description_translation_key, category, is_dangerous, requires_permissions, plugin_name
                    await dbService.query(`
                        INSERT INTO permission_definitions 
                        (permission_key, name_translation_key, description_translation_key, category, is_dangerous, requires_permissions, plugin_name)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE
                            name_translation_key = VALUES(name_translation_key),
                            description_translation_key = VALUES(description_translation_key),
                            category = VALUES(category),
                            is_dangerous = VALUES(is_dangerous),
                            requires_permissions = VALUES(requires_permissions),
                            plugin_name = VALUES(plugin_name)
                    `, [key, name, description, category, is_dangerous, requiresJson, plugin.name]);
                    
                    registeredCount++;
                    Logger.debug(`  ✅ Permission registriert: ${key}`);
                    
                } catch (err) {
                    Logger.error(`Fehler beim Registrieren von Permission ${key}:`, err);
                }
            }
            
            Logger.success(`✅ ${registeredCount} Permissions für Plugin ${plugin.name} registriert`);
            return registeredCount;
            
        } catch (error) {
            Logger.error(`Fehler beim Registrieren der Permissions für Plugin ${plugin.name}:`, error);
            return 0;
        }
    }

    /**
     * ÜBERSCHRIEBEN: Nutzt Migration-Tracking für SQL-Dateien
     * Verhindert doppelte Ausführung von Schemas
     * 
     * @param {Object} plugin - Plugin-Instanz
     * @param {string} dirPath - Pfad zum Models/SQL-Verzeichnis
     * @param {string} context - Kontext (z.B. 'dashboard', 'bot', 'shared')
     * @author FireDervil
     */
    async registerModelsFromDir(plugin, dirPath, context) {
        const dbService = ServiceManager.get("dbService");
        const Logger = ServiceManager.get('Logger');
        
        Logger.debug(`Suche nach ${context} Models in ${dirPath}`);

        try {
            // Nach JS-Dateien UND SQL-Dateien suchen
            const modelFiles = fs.readdirSync(dirPath)
                .filter(file => file.endsWith('.js') || file.endsWith('.sql'));
                
            for (const file of modelFiles) {
                const modelName = path.basename(file, path.extname(file));
                
                try {
                    if (file.endsWith('.sql')) {
                        // ✅ NEU: SQL-Datei mit Migration-Tracking ausführen
                        const sqlFilePath = path.join(dirPath, file);
                        const pluginMeta = this.loadPluginMeta(plugin.name);
                        const version = pluginMeta?.version || '0.0.0';
                        
                        const result = await this.executeSQLMigration(
                            plugin.name, 
                            sqlFilePath, 
                            version, 
                            null, // null = globales Schema, nicht guild-spezifisch
                            false // force = false (überspringen wenn bereits ausgeführt)
                        );
                        
                        if (result.skipped) {
                            Logger.debug(`⏭️  ${file} übersprungen (bereits ausgeführt)`);
                        }
                        
                    } else {
                        // JS-Dateien wie bisher behandeln
                        const modelModule = require(path.join(dirPath, file));
                        
                        if (typeof modelModule === 'string' && modelModule.trim().toLowerCase().startsWith('create table')) {
                            await dbService.query(modelModule);
                            Logger.debug(`SQL-Schema ${modelName} aus JS-Modul für Plugin ${plugin.name} (${context}) ausgeführt`);
                        } else if (modelModule.schema && typeof modelModule.schema === 'string') {
                            await dbService.query(modelModule.schema);
                            Logger.debug(`SQL-Schema ${modelName} aus .schema Property für Plugin ${plugin.name} (${context}) ausgeführt`);
                            
                            // Trigger separat ausführen (falls vorhanden)
                            if (modelModule.trigger && typeof modelModule.trigger === 'string') {
                                try {
                                    const triggerStatements = modelModule.trigger
                                        .split(';')
                                        .map(s => s.trim())
                                        .filter(s => s.length > 0);
                                    
                                    for (const statement of triggerStatements) {
                                        await dbService.query(statement);
                                    }
                                    
                                    Logger.debug(`Trigger für ${modelName} (Plugin ${plugin.name}) erfolgreich erstellt`);
                                } catch (triggerError) {
                                    Logger.warn(`Trigger für ${modelName} konnte nicht erstellt werden:`, triggerError.message);
                                }
                            }
                        } else {
                            Logger.warn(`Model ${modelName} in ${plugin.name}/${context} hat kein gültiges SQL-Schema und wird übersprungen`);
                        }
                    }
                } catch (error) {
                    Logger.error(`Fehler beim Registrieren des Models ${modelName} aus ${dirPath}/${file}:`, error);
                }
            }
        } catch (error) {
            Logger.error(`Fehler beim Lesen des Verzeichnisses ${dirPath}:`, error);
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
                    
                    // ✅ NEU: Permissions registrieren
                    await this.registerPluginPermissions(plugin);
                    
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
            
            // ENABLED_PLUGINS System ist obsolet - guild_plugins Tabelle nutzt jetzt Plugin-Status
            
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
            // ════════════════════════════════════════════════════════════
            // DEPENDENCY CHECK: Prüfe ob andere Plugins dieses Plugin brauchen
            // ════════════════════════════════════════════════════════════
            if (pluginName === 'masterserver') {
                const gameserverActive = await this._isPluginActiveInGuild(guildId, 'gameserver');
                if (gameserverActive) {
                    const error = new Error(
                        'Das Masterserver-Plugin kann nicht deaktiviert werden, ' +
                        'solange das Gameserver-Plugin aktiv ist. ' +
                        'Bitte deaktiviere zuerst das Gameserver-Plugin.'
                    );
                    await this.hooks.doAction('disable_in_guild_failed', pluginName, guildId, error);
                    throw error;
                }
            }
            
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
        const metaPath = path.join(this.pluginsDir, pluginName, 'plugin.json');
        
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
            // 1. GitHub Release prüfen (statt lokale plugin.json)
            const latestRelease = await this.getLatestGitHubRelease(pluginName);
            
            if (!latestRelease) {
                Logger.debug(`[PluginManager] Kein GitHub Release für ${pluginName} gefunden`);
                return;
            }
            
            const githubVersion = this.extractVersionFromTag(latestRelease.tag_name, pluginName);
            
            if (!githubVersion) {
                Logger.warn(`[PluginManager] Ungültiges Release Tag Format: ${latestRelease.tag_name}`);
                return;
            }
            
            // 2. Aktuelle Version aus DB
            const [versionRow] = await dbService.query(`
                SELECT current_version, update_status 
                FROM plugin_versions 
                WHERE plugin_name = ? AND guild_id = ?
            `, [pluginName, guildId]);
            
            const currentVersion = versionRow?.current_version || '0.0.0';
            
            // 3. Versions-Vergleich
            if (semver.gt(githubVersion, currentVersion)) {
                Logger.warn(`[PluginManager] Update verfügbar: ${pluginName} ${currentVersion} → ${githubVersion}`);
                
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
                
                // Changelog aus GitHub Release Body extrahieren
                const changelog = this.parseReleaseChangelog(latestRelease.body || '');
                
                // Update-Info in DB speichern
                await dbService.query(`
                    INSERT INTO plugin_versions 
                        (plugin_name, guild_id, current_version, available_version, 
                         update_available_at, update_deadline_at, update_status, changelog, release_url)
                    VALUES 
                        (?, ?, ?, ?, ?, ?, 'available', ?, ?)
                    ON DUPLICATE KEY UPDATE
                        available_version = VALUES(available_version),
                        update_available_at = VALUES(update_available_at),
                        update_deadline_at = VALUES(update_deadline_at),
                        update_status = 'available',
                        changelog = VALUES(changelog),
                        release_url = VALUES(release_url)
                `, [
                    pluginName, 
                    guildId, 
                    currentVersion, 
                    githubVersion,
                    updateAvailableAt,
                    updateDeadlineAt,
                    JSON.stringify(changelog),
                    latestRelease.html_url
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
            
            // 1. Download & Installation von GitHub
            const downloadResult = await this.downloadAndInstallUpdate(pluginName, targetVersion, guildId);
            
            if (!downloadResult.success) {
                throw new Error(downloadResult.error || 'Download fehlgeschlagen');
            }
            
            // 2. Migration ausführen (falls vorhanden)
            await this.runMigration(pluginName, targetVersion, guildId);
            
            // 3. Status aktualisieren (wird bereits in downloadAndInstallUpdate gemacht, aber sicherstellen)
            await dbService.query(`
                UPDATE plugin_versions 
                SET 
                    current_version = ?,
                    available_version = NULL,
                    update_status = ?,
                    auto_update_at = ?,
                    error_log = NULL,
                    updated_at = NOW()
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
        
        const migrationPath = path.join(this.pluginsDir, pluginName, migrationFile);
        
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
     * Prüft ob eine Migration bereits ausgeführt wurde
     * @param {string} pluginName - Name des Plugins
     * @param {string} migrationFile - Dateiname der Migration (z.B. "001_create_permissions.sql")
     * @param {string} guildId - Guild-ID (IMMER erforderlich - alle Migrations sind guild-spezifisch!)
     * @returns {Promise<boolean>} true wenn bereits ausgeführt
     * @author FireDervil
     */
    async hasMigrationRun(pluginName, migrationFile, guildId) {
        const dbService = ServiceManager.get('dbService');
        
        const [result] = await dbService.query(`
            SELECT id FROM plugin_migrations 
            WHERE plugin_name = ? 
            AND migration_file = ? 
            AND guild_id = ?
            AND success = TRUE
        `, [pluginName, migrationFile, guildId]);
        
        return !!result;
    }

    /**
     * Markiert eine Migration als ausgeführt
     * @param {string} pluginName - Name des Plugins
     * @param {string} migrationFile - Dateiname der Migration
     * @param {string} version - Plugin-Version
     * @param {string} guildId - Guild-ID (IMMER erforderlich!)
     * @param {number} executionTimeMs - Ausführungszeit in Millisekunden
     * @param {string} migrationType - Art der Migration ('schema', 'data', 'update')
     * @author FireDervil
     */
    async recordMigration(pluginName, migrationFile, version, guildId, executionTimeMs = 0, migrationType = 'schema') {
        const dbService = ServiceManager.get('dbService');
        
        await dbService.query(`
            INSERT INTO plugin_migrations 
                (plugin_name, guild_id, migration_file, migration_version, 
                 migration_type, execution_time_ms, success)
            VALUES (?, ?, ?, ?, ?, ?, TRUE)
            ON DUPLICATE KEY UPDATE
                migration_version = VALUES(migration_version),
                executed_at = CURRENT_TIMESTAMP,
                execution_time_ms = VALUES(execution_time_ms),
                success = TRUE,
                error_log = NULL
        `, [pluginName, guildId, migrationFile, version, migrationType, executionTimeMs]);
    }

    /**
     * Markiert eine fehlgeschlagene Migration
     * @param {string} pluginName 
     * @param {string} migrationFile 
     * @param {string} version 
     * @param {string} guildId - Guild-ID (IMMER erforderlich!)
     * @param {string} errorMessage 
     * @author FireDervil
     */
    async recordMigrationError(pluginName, migrationFile, version, guildId, errorMessage) {
        const dbService = ServiceManager.get('dbService');
        
        await dbService.query(`
            INSERT INTO plugin_migrations 
                (plugin_name, guild_id, migration_file, migration_version, success, error_log)
            VALUES (?, ?, ?, ?, FALSE, ?)
            ON DUPLICATE KEY UPDATE
                success = FALSE,
                error_log = VALUES(error_log),
                executed_at = CURRENT_TIMESTAMP
        `, [pluginName, guildId, migrationFile, version, errorMessage]);
    }

    /**
     * Führt SQL-Datei aus (mit Migration-Tracking)
     * Überspringt Dateien die bereits ausgeführt wurden
     * 
     * @param {string} pluginName - Name des Plugins
     * @param {string} sqlFile - Pfad zur SQL-Datei
     * @param {string} version - Plugin-Version
     * @param {string|null} guildId - Guild-ID (null für globale Schemas)
     * @param {boolean} force - Ausführung erzwingen (auch wenn bereits ausgeführt)
     * @returns {Promise<{success: boolean, skipped?: boolean, error?: string}>}
     * @author FireDervil
     */
    async executeSQLMigration(pluginName, sqlFile, version, guildId = null, force = false) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        
        const fileName = path.basename(sqlFile);
        
        // 1. Prüfen ob bereits ausgeführt
        if (!force && await this.hasMigrationRun(pluginName, fileName, guildId)) {
            Logger.debug(`[Migration] Überspringe ${fileName} für ${pluginName} (bereits ausgeführt)`);
            return { success: true, skipped: true };
        }
        
        try {
            const startTime = Date.now();
            
            // 2. SQL-Datei lesen
            let sql = fs.readFileSync(sqlFile, 'utf8');
            
            // 3. Pre-Processing: DELIMITER-Statements entfernen (MariaDB/MySQL kann die nicht)
            // DELIMITER ist nur für CLI-Tools (mysql, mysqldump), nicht für mysql2 driver
            sql = sql.replace(/DELIMITER\s+\$\$/gi, ''); // Entferne DELIMITER $$
            sql = sql.replace(/DELIMITER\s+;/gi, '');    // Entferne DELIMITER ;
            
            // 4. Split in einzelne Statements (nur bei $$ als Trennzeichen)
            const statements = sql
                .split('$$')
                .map(s => s.trim())
                .filter(s => s.length > 0 && !s.match(/^(--|\/\*)/)); // Kommentare entfernen
            
            // 5. Jedes Statement einzeln ausführen
            for (const statement of statements) {
                if (statement.trim().length === 0) continue;
                
                try {
                    await dbService.query(statement);
                } catch (stmtError) {
                    // Ignore "Object already exists" errors (für CREATE OR REPLACE, CREATE IF NOT EXISTS)
                    if (
                        stmtError.code === 'ER_TABLE_EXISTS_ERROR' ||
                        stmtError.code === 'ER_DUP_KEYNAME' ||
                        stmtError.message.includes('already exists')
                    ) {
                        Logger.debug(`[Migration] Statement übersprungen (Objekt existiert bereits): ${statement.substring(0, 50)}...`);
                        continue;
                    }
                    throw stmtError; // Andere Fehler weiterwerfen
                }
            }
            
            const executionTime = Date.now() - startTime;
            
            // 6. Migration tracken
            await this.recordMigration(pluginName, fileName, version, guildId, executionTime, 'schema');
            
            Logger.success(`[Migration] ✅ ${fileName} ausgeführt (${executionTime}ms)`);
            return { success: true };
            
        } catch (error) {
            Logger.error(`[Migration] ❌ ${fileName} fehlgeschlagen:`, error);
            
            // Fehler tracken
            await this.recordMigrationError(pluginName, fileName, version, guildId, error.message);
            
            return { success: false, error: error.message };
        }
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

    // ============================================================
    // GITHUB RELEASE INTEGRATION
    // ============================================================

    /**
     * Holt das neueste GitHub Release für ein Plugin
     * @param {string} pluginName - Name des Plugins
     * @returns {Promise<Object|null>} GitHub Release Objekt oder null
     * @author FireDervil
     */
    async getLatestGitHubRelease(pluginName) {
        const Logger = ServiceManager.get('Logger');
        
        try {
            const releases = await this.fetchGitHubReleases();
            
            // Finde neueste Version für dieses Plugin
            // Format: pluginname-vX.Y.Z (z.B. "dunemap-v2.1.0")
            const pluginReleases = releases.filter(r => 
                r.tag_name.startsWith(`${pluginName}-v`) && !r.draft && !r.prerelease
            );
            
            if (pluginReleases.length === 0) {
                return null;
            }
            
            // Sortiere nach Veröffentlichungsdatum (neueste zuerst)
            pluginReleases.sort((a, b) => 
                new Date(b.published_at) - new Date(a.published_at)
            );
            
            return pluginReleases[0];
            
        } catch (error) {
            Logger.error(`[PluginManager] Fehler beim Abrufen des GitHub Releases für ${pluginName}:`, error);
            return null;
        }
    }

    /**
     * Holt alle GitHub Releases des Repositories
     * @returns {Promise<Array>} Array mit GitHub Release Objekten
     * @author FireDervil
     */
    async fetchGitHubReleases() {
        const Logger = ServiceManager.get('Logger');
        
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.github.com',
                path: '/repos/FireDervil77/dunebot/releases',
                method: 'GET',
                headers: {
                    'User-Agent': 'DuneBot-UpdateManager',
                    'Accept': 'application/vnd.github.v3+json'
                }
            };
            
            // Optional: GitHub Token für höhere Rate Limits
            const githubToken = process.env.GITHUB_TOKEN;
            if (githubToken) {
                options.headers['Authorization'] = `token ${githubToken}`;
            }
            
            https.get(options, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try {
                            const releases = JSON.parse(data);
                            resolve(releases);
                        } catch (error) {
                            Logger.error('[PluginManager] Fehler beim Parsen der GitHub API Response:', error);
                            reject(error);
                        }
                    } else {
                        Logger.error(`[PluginManager] GitHub API Error: ${res.statusCode}`);
                        reject(new Error(`GitHub API returned status ${res.statusCode}`));
                    }
                });
            }).on('error', (error) => {
                Logger.error('[PluginManager] Fehler beim Abrufen der GitHub Releases:', error);
                reject(error);
            });
        });
    }

    /**
     * Extrahiert die Version aus einem GitHub Release Tag
     * @param {string} tagName - Release Tag (z.B. "dunemap-v2.1.0")
     * @param {string} pluginName - Name des Plugins
     * @returns {string|null} Version (z.B. "2.1.0") oder null
     * @author FireDervil
     */
    extractVersionFromTag(tagName, pluginName) {
        // Format: pluginname-vX.Y.Z
        const prefix = `${pluginName}-v`;
        
        if (!tagName.startsWith(prefix)) {
            return null;
        }
        
        return tagName.substring(prefix.length);
    }

    /**
     * Parst den Changelog aus einem GitHub Release Body
     * @param {string} releaseBody - Markdown Text des Release
     * @returns {Array<string>} Array mit Changelog-Einträgen
     * @author FireDervil
     */
    parseReleaseChangelog(releaseBody) {
        if (!releaseBody) return [];
        
        const lines = releaseBody.split('\n');
        const changelog = [];
        
        for (const line of lines) {
            const trimmed = line.trim();
            
            // Erkenne Changelog-Einträge (Listen mit -, *, oder Nummern)
            if (trimmed.match(/^[-*]\s+/) || trimmed.match(/^\d+\.\s+/)) {
                // Entferne Markdown-Formatierung
                const cleanedLine = trimmed
                    .replace(/^[-*]\s+/, '')
                    .replace(/^\d+\.\s+/, '')
                    .trim();
                    
                if (cleanedLine) {
                    changelog.push(cleanedLine);
                }
            }
        }
        
        return changelog.length > 0 ? changelog : ['Update verfügbar'];
    }

    /**
     * Führt ein lokales Plugin-Update aus (ohne Download)
     * Für Monorepo-Projekte: Code ist bereits da, nur Migrationen müssen laufen
     * 
     * WICHTIG: Führt ALLE Migrationen zwischen current_version und target_version aus!
     * 
     * @param {string} pluginName - Name des Plugins
     * @param {string} version - Zielversion
     * @param {string} guildId - Guild ID für Guild-spezifische Updates
     * @returns {Promise<{success: boolean, error?: string}>}
     * @author FireDervil
     */
    async downloadAndInstallUpdate(pluginName, version, guildId) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        let pluginMeta = null; // Für catch-Block verfügbar machen
        
        try {
            Logger.info(`[PluginManager] Starte lokales Update: ${pluginName} v${version} für Guild ${guildId}`);
            
            // 1. Prüfe ob Plugin existiert
            const pluginPath = path.join(this.pluginsDir, pluginName);
            if (!fs.existsSync(pluginPath)) {
                throw new Error(`Plugin "${pluginName}" nicht gefunden in ${pluginPath}`);
            }
            
            // 2. Lade Plugin-Metadaten
            pluginMeta = await this.loadPluginMeta(pluginName);
            if (!pluginMeta) {
                throw new Error(`plugin.json für "${pluginName}" nicht gefunden`);
            }
            
            // 3. Hole aktuelle Version aus DB
            const [currentVersionRow] = await dbService.query(
                'SELECT current_version FROM plugin_versions WHERE plugin_name = ? AND guild_id = ?',
                [pluginName, guildId]
            );
            
            const currentVersion = currentVersionRow?.[0]?.current_version || '0.0.0';
            Logger.info(`[PluginManager] Version-Upgrade: ${currentVersion} → ${version}`);
            
            // 4. Finde ALLE Migrationen zwischen current und target
            const migrations = pluginMeta.migrations || {};
            const migrationVersions = Object.keys(migrations).sort((a, b) => {
                // Semver-Vergleich (einfach)
                const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
                const [bMajor, bMinor, bPatch] = b.split('.').map(Number);
                
                if (aMajor !== bMajor) return aMajor - bMajor;
                if (aMinor !== bMinor) return aMinor - bMinor;
                return aPatch - bPatch;
            });
            
            // Filter: Nur Versionen > current UND <= target
            const [currentMajor, currentMinor, currentPatch] = currentVersion.split('.').map(Number);
            const [targetMajor, targetMinor, targetPatch] = version.split('.').map(Number);
            
            const migrationsToRun = migrationVersions.filter(v => {
                const [major, minor, patch] = v.split('.').map(Number);
                
                // Ist größer als current?
                if (major > currentMajor) return true;
                if (major === currentMajor && minor > currentMinor) return true;
                if (major === currentMajor && minor === currentMinor && patch > currentPatch) return true;
                
                // Ist kleiner oder gleich target?
                if (major < targetMajor) return true;
                if (major === targetMajor && minor < targetMinor) return true;
                if (major === targetMajor && minor === targetMinor && patch <= targetPatch) return true;
                
                return false;
            });
            
            if (migrationsToRun.length === 0) {
                Logger.warn(`[PluginManager] Keine Migrationen zwischen ${currentVersion} und ${version} gefunden`);
            } else {
                Logger.info(`[PluginManager] Führe ${migrationsToRun.length} Migration(en) aus: ${migrationsToRun.join(', ')}`);
                
                // 5. Führe Migrationen SEQUENZIELL aus
                for (const migrationVersion of migrationsToRun) {
                    const migrationFile = migrations[migrationVersion];
                    
                    Logger.info(`[PluginManager] → Migration ${migrationVersion}: ${migrationFile}`);
                    
                    // Prüfe ob bereits ausgeführt (WICHTIG: Parameter-Reihenfolge beachten!)
                    const alreadyRun = await this.hasMigrationRun(pluginName, migrationFile, guildId);
                    
                    if (alreadyRun) {
                        Logger.info(`[PluginManager]   ⏭️ Bereits ausgeführt, überspringe`);
                        continue;
                    }
                    
                    // Migration ausführen
                    const migrationPath = path.join(pluginPath, migrationFile);
                    
                    if (!fs.existsSync(migrationPath)) {
                        throw new Error(`Migrations-Datei nicht gefunden: ${migrationPath}`);
                    }
                    
                    const startTime = Date.now();
                    const migration = require(migrationPath);
                    
                    if (typeof migration.up !== 'function') {
                        throw new Error(`Migration ${migrationFile} hat keine up() Funktion`);
                    }
                    
                    // Führe up() Migration aus
                    await migration.up(dbService, guildId);
                    
                    const executionTime = Date.now() - startTime;
                    
                    // Markiere als ausgeführt
                    await this.recordMigration(
                        pluginName, 
                        migrationFile, 
                        migrationVersion, 
                        guildId, 
                        executionTime, 
                        'data'
                    );
                    
                    Logger.success(`[PluginManager]   ✅ Migration ${migrationVersion} erfolgreich (${executionTime}ms)`);
                }
            }
            
            // 7. Version in DB aktualisieren (UPSERT!)
            await dbService.query(`
                INSERT INTO plugin_versions (plugin_name, guild_id, current_version, available_version, update_status, updated_at)
                VALUES (?, ?, ?, NULL, 'up-to-date', NOW())
                ON DUPLICATE KEY UPDATE
                    current_version = VALUES(current_version),
                    available_version = NULL,
                    update_status = 'up-to-date',
                    updated_at = NOW()
            `, [pluginName, guildId, version]);
            
            Logger.success(`[PluginManager] ${pluginName} erfolgreich auf v${version} aktualisiert (Guild ${guildId})`);
            
            return { success: true };
            
        } catch (error) {
            Logger.error(`[PluginManager] Fehler beim Plugin-Update:`, error);
            
            // Bei lokalem Update: Migration-Fehler tracken
            if (pluginMeta?.migrations?.[version]) {
                const migrationFile = pluginMeta.migrations[version];
                // recordMigrationError(pluginName, migrationFile, version, guildId, errorMessage)
                await this.recordMigrationError(
                    pluginName,
                    migrationFile,
                    version,
                    guildId,
                    error.message
                );
                Logger.warn(`[PluginManager] Migration-Fehler protokolliert`);
            }
            
            return { success: false, error: error.message };
        }
    }

    /**
     * Erstellt ein Backup des aktuellen Plugins
     * @param {string} pluginName - Name des Plugins
     * @returns {Promise<string>} Pfad zum Backup
     * @author FireDervil
     */
    async createPluginBackup(pluginName) {
        const backupDir = path.join(__dirname, '../../../backups/plugins');
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(backupDir, `${pluginName}-backup-${timestamp}`);
        
        const sourcePath = path.join(this.pluginsDir, pluginName);
        
        // Kopiere rekursiv
        await this.copyDirectory(sourcePath, backupPath);
        
        return backupPath;
    }

    /**
     * Kopiert ein Verzeichnis rekursiv
     * @param {string} source - Quellverzeichnis
     * @param {string} destination - Zielverzeichnis
     * @author FireDervil
     */
    async copyDirectory(source, destination) {
        if (!fs.existsSync(destination)) {
            fs.mkdirSync(destination, { recursive: true });
        }
        
        const entries = fs.readdirSync(source, { withFileTypes: true });
        
        for (const entry of entries) {
            const sourcePath = path.join(source, entry.name);
            const destPath = path.join(destination, entry.name);
            
            if (entry.isDirectory()) {
                await this.copyDirectory(sourcePath, destPath);
            } else {
                fs.copyFileSync(sourcePath, destPath);
            }
        }
    }

    /**
     * Lädt eine Datei von einer URL herunter
     * @param {string} url - Download URL
     * @param {string} destination - Zielpfad
     * @returns {Promise<void>}
     * @author FireDervil
     */
    async downloadFile(url, destination) {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(destination);
            
            https.get(url, (response) => {
                // Handle Redirects
                if (response.statusCode === 302 || response.statusCode === 301) {
                    https.get(response.headers.location, (redirectResponse) => {
                        redirectResponse.pipe(file);
                        file.on('finish', () => {
                            file.close(resolve);
                        });
                    }).on('error', reject);
                } else {
                    response.pipe(file);
                    file.on('finish', () => {
                        file.close(resolve);
                    });
                }
            }).on('error', (err) => {
                fs.unlink(destination, () => {});
                reject(err);
            });
        });
    }

    /**
     * Extrahiert ein Plugin aus einem GitHub Release Tarball
     * @param {string} tarballPath - Pfad zum Tarball
     * @param {string} extractDir - Extraktionsverzeichnis
     * @param {string} pluginName - Name des Plugins
     * @returns {Promise<void>}
     * @author FireDervil
     */
    async extractPluginFromTarball(tarballPath, extractDir, pluginName) {
        // Extrahiere vollständiges Tarball
        await tar.extract({
            file: tarballPath,
            cwd: extractDir
        });
        
        // Finde Plugin-Ordner im extrahierten Archiv
        // GitHub Format: dunebot-pluginname-vX.Y.Z/plugins/pluginname/
        const extractedContents = fs.readdirSync(extractDir);
        const rootFolder = extractedContents[0]; // Normalerweise nur ein Ordner
        
        const pluginSourcePath = path.join(extractDir, rootFolder, 'plugins', pluginName);
        
        if (!fs.existsSync(pluginSourcePath)) {
            throw new Error(`Plugin ${pluginName} nicht im Release gefunden`);
        }
        
        // Verschiebe Plugin-Ordner an Root von extractDir
        const tempPluginPath = path.join(extractDir, 'plugin-temp');
        fs.renameSync(pluginSourcePath, tempPluginPath);
        
        // Cleanup
        fs.rmSync(path.join(extractDir, rootFolder), { recursive: true, force: true });
        fs.renameSync(tempPluginPath, path.join(extractDir, pluginName));
    }

    /**
     * Ersetzt Plugin-Dateien mit neuer Version
     * @param {string} source - Quellverzeichnis (neue Version)
     * @param {string} destination - Zielverzeichnis (aktuelles Plugin)
     * @author FireDervil
     */
    async replacePluginFiles(source, destination) {
        // Entferne altes Plugin (außer Backups)
        if (fs.existsSync(destination)) {
            fs.rmSync(destination, { recursive: true, force: true });
        }
        
        // Kopiere neues Plugin
        const sourcePath = path.join(source, fs.readdirSync(source)[0]);
        await this.copyDirectory(sourcePath, destination);
    }

    /**
     * Rollback zu vorheriger Plugin-Version
     * @param {string} pluginName - Name des Plugins
     * @returns {Promise<void>}
     * @author FireDervil
     */
    async rollbackPlugin(pluginName) {
        const Logger = ServiceManager.get('Logger');
        const backupDir = path.join(__dirname, '../../../backups/plugins');
        
        // Finde neuestes Backup
        const backups = fs.readdirSync(backupDir)
            .filter(f => f.startsWith(`${pluginName}-backup-`))
            .sort()
            .reverse();
        
        if (backups.length === 0) {
            throw new Error(`Kein Backup für ${pluginName} gefunden`);
        }
        
        const latestBackup = path.join(backupDir, backups[0]);
        const pluginPath = path.join(this.pluginsDir, pluginName);
        
        // Entferne fehlerhafte Version
        if (fs.existsSync(pluginPath)) {
            fs.rmSync(pluginPath, { recursive: true, force: true });
        }
        
        // Stelle Backup wieder her
        await this.copyDirectory(latestBackup, pluginPath);
        
        Logger.info(`[PluginManager] Rollback erfolgreich: ${pluginName} wiederhergestellt`);
    }

    /**
     * Hilfsfunktion: Prüft ob ein Plugin in einer Guild aktiv ist
     * 
     * @param {string} guildId - Discord Guild ID
     * @param {string} pluginName - Name des zu prüfenden Plugins
     * @returns {Promise<boolean>} True wenn Plugin aktiv ist
     * @private
     */
    async _isPluginActiveInGuild(guildId, pluginName) {
        const dbService = ServiceManager.get('dbService');
        
        try {
            const [result] = await dbService.query(
                'SELECT is_enabled FROM guild_plugins WHERE guild_id = ? AND plugin_name = ?',
                [guildId, pluginName]
            );
            
            return result ? result.is_enabled === 1 : false;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error(`[PluginManager] Fehler beim Prüfen von Plugin ${pluginName} in Guild ${guildId}:`, error);
            return false;
        }
    }
}

module.exports = PluginManager;