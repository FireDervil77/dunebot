const fs = require("fs");
const path = require("path");
const { ServiceManager, BasePluginManager, PluginHooks } = require("dunebot-core");
const { DashboardPlugin } = require("dunebot-sdk");
const { parseJsonArray } = require("dunebot-sdk/utils");

const execa = require("execa");
const { MigrationRunner } = require('dunebot-core');

class PluginManager extends BasePluginManager {
    /**
     * @param {import('express').Application} app
     * @param {string} pluginDir
     */
    constructor(app, pluginDir) {
        const dbService = ServiceManager.get("dbService");
        const Logger = ServiceManager.get("Logger");
        const navigationManager = ServiceManager.get('navigationManager');

        super(pluginDir, Logger);
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
                    `, [key, name, description, category, is_dangerous, requiresJson, plugin.name]); // global, kein guild_id
                    
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
     * Registriert Permissions für eine spezifische Guild
     * Lädt permissions.json und trägt sie MIT guild_id ein
     * 
     * @param {Object} plugin - Das Plugin-Objekt
     * @param {string} guildId - Die Guild-ID
     * @returns {Promise<number>} Anzahl der registrierten Permissions
     * @author FireDervil
     */
    async registerPluginPermissionsForGuild(plugin, guildId) {
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
            
            Logger.info(`📋 Registriere ${permissionsData.permissions.length} Permissions für Plugin ${plugin.name} in Guild ${guildId}...`);
            
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
                
                // requires_permissions zu JSON konvertieren
                let requiresJson = null;
                if (requires) {
                    const requiresArray = typeof requires === 'string' ? [requires] : requires;
                    requiresJson = JSON.stringify(requiresArray);
                }
                
                try {
                    // INSERT global, kein guild_id
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
            
            // ════════════════════════════════════════════════════════════
            // NEU: Administrator-Gruppe automatisch alle Permissions geben
            // ════════════════════════════════════════════════════════════
            try {
                // Administrator-Gruppe finden (KORREKTUR: guild_groups statt permission_groups)
                const adminGroups = await dbService.query(
                    'SELECT id, permissions FROM guild_groups WHERE guild_id = ? AND slug = ?',
                    [guildId, 'administrator']
                );
                
                if (adminGroups && adminGroups.length > 0) {
                    const adminGroup = adminGroups[0];
                    Logger.debug(`Administrator-Gruppe gefunden (ID: ${adminGroup.id}), weise neue Permissions zu...`);
                    
                    // Alle Permission-Keys des Plugins aus permissions.json holen
                    const permissionsData = JSON.parse(fs.readFileSync(permissionsFile, 'utf8'));
                    // Lade aktuelle Permissions (JSON)
                    const currentPerms = adminGroup.permissions ? JSON.parse(adminGroup.permissions) : {};
                    let addedCount = 0;
                    
                    for (const perm of permissionsData.permissions) {
                        // WICHTIG: permission_key ist OHNE Plugin-Prefix gespeichert!
                        const permKey = perm.key; // z.B. "GAMESERVER.VIEW" (nicht "gameserver:GAMESERVER.VIEW")
                        
                        try {
                            // Prüfe ob Permission bereits existiert
                            if (currentPerms[permKey] === true) {
                                Logger.debug(`  ℹ️  Permission ${permKey} bereits in Administrator-Gruppe vorhanden`);
                                continue;
                            }
                            
                            // Füge Permission zum JSON hinzu
                            currentPerms[permKey] = true;
                            addedCount++;
                            Logger.debug(`  ✅ Permission ${permKey} zu Administrator-Gruppe hinzugefügt`);
                            
                        } catch (permError) {
                            Logger.error(`  ❌ Fehler bei Permission ${permKey}:`, permError.message);
                        }
                    }
                    
                    // Schreibe aktualisiertes JSON zurück in DB
                    if (addedCount > 0) {
                        await dbService.query(
                            'UPDATE guild_groups SET permissions = ?, updated_at = NOW() WHERE id = ?',
                            [JSON.stringify(currentPerms), adminGroup.id]
                        );
                    }
                    
                    if (addedCount > 0) {
                        Logger.success(`✅ ${addedCount} neue Permissions automatisch zur Administrator-Gruppe hinzugefügt (RELATIONAL)`);
                    } else {
                        Logger.debug('Alle Permissions bereits in Administrator-Gruppe vorhanden');
                    }
                } else {
                    Logger.warn(`⚠️  Administrator-Gruppe nicht gefunden für Guild ${guildId} - Permissions nicht automatisch zugewiesen`);
                }
            } catch (adminError) {
                Logger.error(`Fehler beim automatischen Zuweisen der Permissions zur Administrator-Gruppe:`, adminError);
            }
            
            // ════════════════════════════════════════════════════════════
            // Default-Gruppen-Permissions aus permissions.json verarbeiten
            // Jedes Plugin kann via "default_groups": { "moderator": [...] }
            // festlegen, welche Permissions Moderator/Support/User erhalten.
            // ════════════════════════════════════════════════════════════
            try {
                const permissionsData = JSON.parse(fs.readFileSync(permissionsFile, 'utf8'));
                const defaultGroupsMap = permissionsData.default_groups || {};

                for (const [groupSlug, permKeys] of Object.entries(defaultGroupsMap)) {
                    if (!Array.isArray(permKeys) || permKeys.length === 0) continue;

                    const groupRows = await dbService.query(
                        'SELECT id, permissions FROM guild_groups WHERE guild_id = ? AND slug = ?',
                        [guildId, groupSlug]
                    );
                    if (!groupRows || groupRows.length === 0) continue;

                    const group = groupRows[0];
                    const currentPerms = group.permissions ? JSON.parse(group.permissions) : {};
                    let addedCount = 0;
                    for (const permKey of permKeys) {
                        if (!currentPerms[permKey]) { currentPerms[permKey] = true; addedCount++; }
                    }
                    if (addedCount > 0) {
                        await dbService.query(
                            'UPDATE guild_groups SET permissions = ?, updated_at = NOW() WHERE id = ?',
                            [JSON.stringify(currentPerms), group.id]
                        );
                        Logger.debug(`  ✅ ${addedCount} Default-Permissions für Gruppe '${groupSlug}' in Guild ${guildId}`);
                    }
                }
            } catch (defaultGroupsError) {
                Logger.error(`Fehler beim Verarbeiten der default_groups für ${plugin.name}:`, defaultGroupsError);
            }

            // ════════════════════════════════════════════════════════════
            // NEU: Guild-Owner automatisch zur Administrator-Gruppe hinzufügen
            // ════════════════════════════════════════════════════════════
            try {
                // 1. Administrator-Gruppe finden
                const adminGroupRows = await dbService.query(
                    'SELECT id FROM guild_groups WHERE guild_id = ? AND slug = ?',
                    [guildId, 'administrator']
                );
                
                if (!adminGroupRows || adminGroupRows.length === 0) {
                    Logger.warn(`⚠️  Administrator-Gruppe nicht gefunden für Guild ${guildId} - Owner kann nicht zugewiesen werden`);
                } else {
                    const adminGroupId = adminGroupRows[0].id;
                    
                    // 2. Guild-Owner finden
                    const ownerRows = await dbService.query(
                        'SELECT id, user_id FROM guild_users WHERE guild_id = ? AND is_owner = 1',
                        [guildId]
                    );
                    
                    if (ownerRows && ownerRows.length > 0) {
                        const guildUserId = ownerRows[0].id;      // guild_users.id (Primary Key)
                        const ownerId = ownerRows[0].user_id;      // Discord User ID
                        
                        Logger.debug(`Guild-Owner gefunden (User ID: ${ownerId}), füge zur Administrator-Gruppe hinzu...`);
                        
                        // 3. Owner zur Administrator-Gruppe hinzufügen (falls noch nicht drin)
                        const insertResult = await dbService.query(`
                            INSERT IGNORE INTO guild_user_groups 
                            (guild_user_id, group_id, assigned_at, assigned_by)
                            VALUES (?, ?, NOW(), 'system')
                        `, [guildUserId, adminGroupId]);
                        
                        if (insertResult.affectedRows > 0) {
                            Logger.success(`✅ Guild-Owner automatisch zur Administrator-Gruppe hinzugefügt`);
                        } else {
                            Logger.debug('Guild-Owner ist bereits in der Administrator-Gruppe');
                        }
                    } else {
                        Logger.warn(`⚠️  Guild-Owner nicht in guild_users gefunden für Guild ${guildId}`);
                    }
                }
            } catch (ownerError) {
                Logger.error(`Fehler beim Hinzufügen des Guild-Owners zur Administrator-Gruppe:`, ownerError);
            }
            
            return registeredCount;
            
        } catch (error) {
            Logger.error(`Fehler beim Registrieren der Permissions für Plugin ${plugin.name} in Guild ${guildId}:`, error);
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
                    
                    // Plugin-Migrationen ausführen (neue Migration-Dateien aus migrations/)
                    await MigrationRunner.runPlugin(
                        dbService,
                        pluginName,
                        this.pluginsDir,
                        ServiceManager.get('Logger')
                    );
                    
                    // ❌ DEAKTIVIERT: Permissions werden jetzt NUR noch guild-spezifisch registriert
                    // await this.registerPluginPermissions(plugin);
                    
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

            // ✅ NEU: Permissions für Guild registrieren
            Logger.info(`🔍 [DEBUG] Vor registerPluginPermissionsForGuild für ${pluginName} in Guild ${guildId}`);
            // Kern-Permissions zuerst sicherstellen (idempotent via ON DUPLICATE KEY UPDATE)
            const permissionManager = ServiceManager.get('permissionManager');
            if (permissionManager) {
                await permissionManager.loadKernelPermissions(guildId).catch(e =>
                    Logger.warn(`[PluginManager] Kern-Permissions für ${guildId} nicht ladbar: ${e.message}`)
                );
            }
            await this.registerPluginPermissionsForGuild(plugin, guildId);
            Logger.info(`🔍 [DEBUG] Nach registerPluginPermissionsForGuild für ${pluginName} in Guild ${guildId}`);

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

            // 5. Permissions entfernen
            try {
                const permissionManager = ServiceManager.get('permissionManager');
                if (permissionManager) {
                    await permissionManager.unregisterPluginPermissions(pluginName, guildId);
                    Logger.debug(`Permissions für Plugin ${pluginName} in Guild ${guildId} entfernt`);
                } else {
                    Logger.warn('PermissionManager nicht verfügbar - Permissions konnten nicht entfernt werden');
                }
            } catch (permError) {
                Logger.error(`Fehler beim Entfernen der Permissions für ${pluginName}:`, permError);
            }

            // 6. Navigation entfernen - NEU: Nutze NavigationManager statt ThemeManager
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
    // PLUGIN METADATA
    // ============================================================

    /**
     * Lädt Plugin-Metadaten aus package.json (Single Source of Truth)
     * @param {string} pluginName
     * @returns {Object|null}
     */
    loadPluginMeta(pluginName) {
        const Logger = ServiceManager.get('Logger');
        const pkgPath = path.join(this.pluginsDir, pluginName, 'package.json');

        if (!fs.existsSync(pkgPath)) {
            Logger.debug(`[PluginManager] Kein package.json für ${pluginName} gefunden`);
            return null;
        }

        try {
            return JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        } catch (error) {
            Logger.error(`[PluginManager] Fehler beim Laden von package.json für ${pluginName}:`, error);
            return null;
        }
    }

    // ============================================================
    // MIGRATION TRACKING (für registerModelsFromDir / sql/ Dateien)
    // ============================================================
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