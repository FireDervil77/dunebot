const fs = require("fs");
const path = require("path");

const Config = require("./Config");
const { ServiceManager } = require("dunebot-core");

/**
 * Basisklasse für Dashboard-Plugins
 * 
 * @author firedervil
 * @class DashboardPlugin
 */
class DashboardPlugin {
    /**
     * @param {Object} data - Plugin-Daten
     * @param {string} data.name - Name des Plugins
     * @param {string} data.displayName - Anzeigename des Plugins
     * @param {string} data.description - Beschreibung des Plugins
     * @param {string} data.version - Version des Plugins
     * @param {string} data.author - Autor des Plugins
     * @param {string} data.icon - Icon-Klasse des Plugins
     * @param {string} data.baseDir - Basisverzeichnis des Plugins
     */
    constructor(data) {
        const Logger = ServiceManager.get('Logger');

        DashboardPlugin.#validate(data);
        
        this.pluginDir = path.join(data.baseDir, "..");
        
        // Versuche zuerst, Daten aus package.json zu laden
        try {
            const packageJson = require(path.join(this.pluginDir, "package.json"));
            this.name = data.name || packageJson.name;
            this.version = data.version || packageJson.version;
            this.displayName = data.displayName || packageJson.displayName || this.name;
            this.description = data.description || packageJson.description || '';
            this.author = data.author || packageJson.author || 'Unbekannt';
        } catch (error) {
            // Fallback, wenn package.json nicht existiert
            this.name = data.name;
            this.displayName = data.displayName || data.name;
            this.description = data.description || '';
            this.version = data.version || '1.0.0';
            this.author = data.author || 'Unbekannt';
        }
        
        this.icon = data.icon || 'fa-solid fa-puzzle-piece';
        this.baseDir = data.baseDir;
        this.ownerOnly = data.ownerOnly || false;
        this.publicAssets = data.publicAssets || false; // Assets aus /public bereitstellen
        
        // Router-Instanzen
        this.guildRouter = data.guildRouter || null;
        this.apiRouter = data.apiRouter || null;
        this.frontendRouter = data.frontendRouter || null;
        
        // Callback-Methoden
        this.onEnable = data.onEnable || this.onEnable;
        this.onDisable = data.onDisable || this.onDisable;
        this.onGuildEnable = data.onGuildEnable || this.onGuildEnable;
        this.onGuildDisable = data.onGuildDisable || this.onGuildDisable;
        
        // Konfiguration - WICHTIG: Hier config statt configManager verwenden, 
        // um mit dem bestehenden Code kompatibel zu bleiben
        this.config = new Config(this.name, this.baseDir);

        // App-Referenz wird später gesetzt
        this.app = null;

        Logger.debug(`Initialized plugin "${this.name}" in DashboardPlugin`);
    }

    /**
     * Wird aufgerufen, wenn das Plugin aktiviert wird
     * @param {Object} app - Express App-Instanz
     * @param {Object} dbService - Datenbank-Service
     */
    async onEnable(app) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        if (!dbService) {
            throw new TypeError("dbService must be provided to DashboardPlugin");
        }

        try {
            this.app = app; // App speichern für spätere Verwendung
            
            // Konfiguration initialisieren
            await this.config.init(dbService);
            Logger.debug(`Configuration initialized for plugin ${this.name}`);
            
            Logger.debug(`Plugin ${this.name} successfully enabled`);
        } catch (error) {
            Logger.error(`Failed to enable plugin ${this.name}:`, error);
            throw error;
        }
    }

    /**
     * Wird aufgerufen, wenn das Plugin deaktiviert wird
     * @param {Object} app - Express App-Instanz
     * @param {Object} dbService - Datenbank-Service
     */
    async onDisable(app) {
        const Logger = ServiceManager.get('Logger');
        Logger.debug(`Plugin ${this.name} deaktiviert`);
    }

    /**
     * Reload-Methode für Plugin-Komponenten
     * Lädt Schemas, Models, Navigation und Config neu ohne Server-Restart
     * 
     * @param {Object} options - Reload-Optionen
     * @param {boolean} [options.schemas=true] - Schemas neu laden
     * @param {boolean} [options.models=true] - Models neu registrieren
     * @param {boolean} [options.navigation=true] - Navigation aktualisieren
     * @param {boolean} [options.config=false] - Config refreshen
     * @param {string} [options.guildId=null] - Spezifische Guild ID für Navigation
     * @returns {Promise<Object>} Reload-Status mit Details
     * @author DuneBot Team
     */
    async onReload(options = {}) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        
        const opts = {
            schemas: options.schemas !== false,
            models: options.models !== false,
            navigation: options.navigation !== false,
            config: options.config === true,
            guildId: options.guildId || null
        };
        
        const result = {
            success: true,
            schemas: { loaded: 0, failed: 0, files: [] },
            models: { registered: 0, failed: 0, names: [] },
            navigation: { updated: false, items: 0 },
            config: { refreshed: false },
            errors: []
        };
        
        Logger.info(`[Reload] Starting reload for plugin ${this.name}`, opts);
        
        try {
            // 1. SQL-Dateien nachladen
            if (opts.schemas && dbService) {
                try {
                    const sqlDir = path.join(this.baseDir, 'sql');
                    if (fs.existsSync(sqlDir)) {
                        const schemaFiles = fs.readdirSync(sqlDir)
                            .filter(f => f.endsWith('.sql') || f.endsWith('.js'));
                        
                        for (const file of schemaFiles) {
                            try {
                                const schemaPath = path.join(sqlDir, file);
                                
                                if (file.endsWith('.sql')) {
                                    const sql = fs.readFileSync(schemaPath, 'utf8');
                                    await dbService.query(sql);
                                    result.schemas.loaded++;
                                    result.schemas.files.push(file);
                                    Logger.debug(`[Reload] Schema loaded: ${file}`);
                                } else if (file.endsWith('.js')) {
                                    delete require.cache[require.resolve(schemaPath)];
                                    const schema = require(schemaPath);
                                    if (typeof schema === 'function') {
                                        await schema(dbService);
                                    }
                                    result.schemas.loaded++;
                                    result.schemas.files.push(file);
                                    Logger.debug(`[Reload] Schema executed: ${file}`);
                                }
                            } catch (error) {
                                result.schemas.failed++;
                                result.errors.push(`Schema ${file}: ${error.message}`);
                                Logger.error(`[Reload] Failed to load schema ${file}:`, error);
                            }
                        }
                    }
                } catch (error) {
                    result.errors.push(`Schemas: ${error.message}`);
                    Logger.error('[Reload] Schema loading failed:', error);
                }
            }
            
            // 2. Models neu registrieren
            if (opts.models && dbService) {
                try {
                    const modelsDir = path.join(this.baseDir, 'models');
                    if (fs.existsSync(modelsDir)) {
                        const modelFiles = fs.readdirSync(modelsDir)
                            .filter(f => f.endsWith('.js'));
                        
                        for (const file of modelFiles) {
                            try {
                                const modelPath = path.join(modelsDir, file);
                                delete require.cache[require.resolve(modelPath)];
                                const model = require(modelPath);
                                
                                if (model && model.name) {
                                    // Model im DBService registrieren (falls Methode existiert)
                                    if (typeof dbService.registerModel === 'function') {
                                        await dbService.registerModel(model.name, model);
                                        result.models.registered++;
                                        result.models.names.push(model.name);
                                        Logger.debug(`[Reload] Model registered: ${model.name}`);
                                    }
                                }
                            } catch (error) {
                                result.models.failed++;
                                result.errors.push(`Model ${file}: ${error.message}`);
                                Logger.error(`[Reload] Failed to register model ${file}:`, error);
                            }
                        }
                    }
                } catch (error) {
                    result.errors.push(`Models: ${error.message}`);
                    Logger.error('[Reload] Model registration failed:', error);
                }
            }
            
            // 3. Navigation aktualisieren
            if (opts.navigation && opts.guildId) {
                try {
                    const navigationManager = ServiceManager.get('navigationManager');
                    if (navigationManager) {
                        // Navigation für Guild neu laden
                        await navigationManager.reloadPluginNavigation(this.name, opts.guildId);
                        result.navigation.updated = true;
                        Logger.debug(`[Reload] Navigation updated for guild ${opts.guildId}`);
                    }
                } catch (error) {
                    result.errors.push(`Navigation: ${error.message}`);
                    Logger.error('[Reload] Navigation update failed:', error);
                }
            }
            
            // 4. Config refreshen
            if (opts.config) {
                try {
                    await this.config.reload();
                    result.config.refreshed = true;
                    Logger.debug('[Reload] Config refreshed');
                } catch (error) {
                    result.errors.push(`Config: ${error.message}`);
                    Logger.error('[Reload] Config refresh failed:', error);
                }
            }
            
            result.success = result.errors.length === 0;
            Logger.info(`[Reload] Completed for plugin ${this.name}:`, {
                schemas: `${result.schemas.loaded} loaded, ${result.schemas.failed} failed`,
                models: `${result.models.registered} registered, ${result.models.failed} failed`,
                navigation: result.navigation.updated ? 'updated' : 'skipped',
                config: result.config.refreshed ? 'refreshed' : 'skipped',
                errors: result.errors.length
            });
            
            return result;
            
        } catch (error) {
            Logger.error(`[Reload] Critical error for plugin ${this.name}:`, error);
            result.success = false;
            result.errors.push(`Critical: ${error.message}`);
            return result;
        }
    }

    /**
     * Wird aufgerufen, wenn das Plugin in einer Guild aktiviert wird
     * Registriert automatisch Permissions aus permissions.json
     * 
     * @param {string} guildId - ID der Guild
     */
    async onGuildEnable(guildId) {
        const Logger = ServiceManager.get('Logger');
        Logger.debug(`Plugin ${this.name} in Guild ${guildId} aktiviert`);
        
        // Automatische Permission-Registrierung
        try {
            const permissionManager = ServiceManager.get('permissionManager');
            const permissions = this.getPermissions();
            
            if (permissions && permissions.length > 0) {
                Logger.info(`[Plugin ${this.name}] Registering ${permissions.length} permissions for guild ${guildId}...`);
                
                const registered = await permissionManager.registerPluginPermissions(
                    this.name,
                    guildId,
                    permissions
                );
                
                Logger.success(`[Plugin ${this.name}] Registered ${registered} permissions for guild ${guildId}`);
            } else {
                Logger.debug(`[Plugin ${this.name}] No permissions.json found, skipping permission registration`);
            }
        } catch (error) {
            Logger.error(`[Plugin ${this.name}] Failed to register permissions for guild ${guildId}:`, error);
            // Nicht werfen - Plugin sollte trotzdem funktionieren
        }
    }

    /**
     * Wird aufgerufen, wenn das Plugin in einer Guild deaktiviert wird
     * Entfernt automatisch Permissions aus permission_definitions
     * 
     * @param {string} guildId - ID der Guild
     */
    async onGuildDisable(guildId) {
        const Logger = ServiceManager.get('Logger');
        Logger.debug(`Plugin ${this.name} in Guild ${guildId} deaktiviert`);
        
        // Automatische Permission-Entfernung
        try {
            const permissionManager = ServiceManager.get('permissionManager');
            
            Logger.info(`[Plugin ${this.name}] Unregistering permissions for guild ${guildId}...`);
            
            const result = await permissionManager.unregisterPluginPermissions(
                this.name,
                guildId
            );
            
            Logger.success(
                `[Plugin ${this.name}] Unregistered permissions for guild ${guildId}: ` +
                `${result.permissionsDeleted} deleted, ${result.groupsUpdated} groups updated`
            );
        } catch (error) {
            Logger.error(`[Plugin ${this.name}] Failed to unregister permissions for guild ${guildId}:`, error);
            // Nicht werfen - Plugin sollte trotzdem deaktiviert werden
        }
    }
    
    /**
     * Lädt permissions.json aus dem Plugin-Verzeichnis
     * Format: { plugin: "name", version: "1.0.0", permissions: [...] }
     * 
     * @returns {Array|null} Array von Permission-Objekten oder null wenn nicht vorhanden
     */
    getPermissions() {
        const Logger = ServiceManager.get('Logger');
        
        try {
            const permissionsPath = path.join(this.baseDir, 'permissions.json');
            
            if (!fs.existsSync(permissionsPath)) {
                return null;  // Kein permissions.json vorhanden
            }
            
            const permissionsData = require(permissionsPath);
            
            // Validierung
            if (!permissionsData.permissions || !Array.isArray(permissionsData.permissions)) {
                Logger.warn(`[Plugin ${this.name}] Invalid permissions.json format (missing permissions array)`);
                return null;
            }
            
            // Plugin-Name Check (optional - Warnung bei Mismatch)
            if (permissionsData.plugin && permissionsData.plugin !== this.name) {
                Logger.warn(
                    `[Plugin ${this.name}] permissions.json plugin name mismatch: ` +
                    `expected "${this.name}", got "${permissionsData.plugin}"`
                );
            }
            
            Logger.debug(`[Plugin ${this.name}] Loaded ${permissionsData.permissions.length} permissions from permissions.json`);
            
            return permissionsData.permissions;
            
        } catch (error) {
            Logger.error(`[Plugin ${this.name}] Failed to load permissions.json:`, error.message);
            return null;
        }
    }

    /**
     * Lädt die Konfiguration des Plugins
     * @param {string} [context='shared'] - Kontext der Konfiguration
     * @returns {Promise<Object>} Die Konfiguration
     */
    async getConfig(context = 'shared') {
        return await this.config.get(context);
    }

    /**
     * Speichert einen Konfigurationswert
     * @param {string} key - Konfigurationsschlüssel
     * @param {*} value - Konfigurationswert
     * @param {string} [context='shared'] - Kontext der Konfiguration
     * @returns {Promise<boolean>} Erfolg der Operation
     */
    async saveConfig(key, value, context = 'shared') {
        return await this.config.set(key, value, context);
    }
    
    /**
     * Speichert mehrere Konfigurationswerte auf einmal
     * @param {Object} configValues - Objekt mit Schlüssel-Wert-Paaren
     * @param {string} [context='shared'] - Kontext der Konfiguration
     * @returns {Promise<boolean>} Erfolg der Operation
     */
    async saveMultipleConfig(configValues, context = 'shared') {
        return await this.config.setMultiple(configValues, context);
    }

    async registerNavigation(guildId, navItems) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        if (!dbService || !guildId) {
            Logger.error('Cannot register navigation: missing dbService or guildId');
            return;
        }
        
        try {
            const NavItems = dbService.getModel("NavItems");
            
            // Prüfe ob bereits Navigation existiert
            const existing = await NavItems.findAll({
                where: { plugin: this.name, guildId }
            });
            
            if (existing && existing.length > 0) {
                Logger.debug(`Navigation for plugin ${this.name} already exists in guild ${guildId}`);
                return;
            }
            
            // Standard-Navigation aus Plugin-Definition oder übergebene Items
            const items = navItems || this.navigationItems || [];
            
            if (items.length === 0) {
                // Keine Navigation definiert
                Logger.warn(`No navigation items defined for plugin ${this.name}`);
                return;
            }
            
            const navEntries = items.map(item => ({
                plugin: this.name,
                guildId,
                title: item.title || this.name,
                path: item.path || `/guild/${guildId}/${this.name}`,
                icon: item.icon || this.icon || 'fa-solid fa-puzzle-piece',
                order: item.order || 1
            }));
            
            await NavItems.bulkCreate(navEntries);
            Logger.success(`Created navigation for plugin ${this.name} in guild ${guildId}`);
        } catch (error) {
            Logger.error(`Failed to register navigation for ${this.name}:`, error);
            // Füge das vollständige Error-Objekt aus
            console.error(error);
        }
    }

    // Neue Methode zum Laden der Navigation
    async getNavigation(context = {}) {
        const Logger = ServiceManager.get('Logger');

        if (!this.navigationHandler) {
            return [];
        }

        try {
            const navItems = await this.navigationHandler(context);
            return this.#validateNavItems(navItems);
        } catch (error) {
            Logger.error(`Failed to load navigation for plugin ${this.name}:`, error);
            return [];
        }
    }

    // Validator für Nav Items
    #validateNavItems(items) {
        const Logger = ServiceManager.get('Logger');

        if (!Array.isArray(items)) return [];
        
        return items.filter(item => {
            const isValid = (
                item.title && 
                typeof item.title === 'string' &&
                item.path && 
                typeof item.path === 'string'
            );

            if (!isValid) {
                Logger.warn(`Invalid navigation item in plugin ${this.name}:`, item);
            }

            return isValid;
        });
    }

    static #validate(data) {
        if (typeof data !== "object") {
            throw new TypeError("DashboardPlugin data must be an Object.");
        }

        if (!data.baseDir || typeof data.baseDir !== "string") {
            throw new Error("DashboardPlugin baseDir must be a string");
        }

        if (!fs.existsSync(data.baseDir)) {
            throw new Error("DashboardPlugin baseDir does not exist");
        }

        const packageJsonPath = path.join(data.baseDir, "../package.json");
        if (!fs.existsSync(packageJsonPath)) {
            throw new Error("No package.json found in plugin directory");
        }

        if (Object.prototype.hasOwnProperty.call(data, "ownerOnly")) {
            if (typeof data.ownerOnly !== "boolean") {
                throw new Error("DashboardPlugin ownerOnly must be a boolean");
            }
        }
        //navigation validation added
        if (data.navigationHandler && typeof data.navigationHandler !== "function") {
            throw new Error("DashboardPlugin navigationHandler must be a function");
        }

        if (data.icon && typeof data.icon !== "string") {
            throw new Error("DashboardPlugin icon must be a string");
        }

        if (data.onEnable && typeof data.onEnable !== "function") {
            throw new Error("DashboardPlugin onEnable must be a function");
        }

        if (data.onDisable && typeof data.onDisable !== "function") {
            throw new Error("DashboardPlugin onDisable must be a function");
        }

        if (data.onGuildEnable && typeof data.onGuildEnable !== "function") {
            throw new Error("DashboardPlugin onGuildEnable must be a function");
        }

        if (data.onGuildDisable && typeof data.onGuildDisable !== "function") {
            throw new Error("DashboardPlugin onGuildDisable must be a function");
        }

        if (data.dashboardRouter && !data.dashboardRouter.stack) {
            throw new Error(
                "DashboardPlugin dashboardRouter must be an instance of express.Router",
            );
        }
        if (data.adminRouter && !data.adminRouter.stack) {
            throw new Error("DashboardPlugin adminRouter must be an instance of express.Router");
        }

        if (data.dbService && !(data.dbService instanceof DBService)) {
            throw new Error("DashboardPlugin dbService must be an instance of DBService");
        }
    }
}

module.exports = DashboardPlugin;