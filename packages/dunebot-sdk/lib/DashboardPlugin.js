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
     * Wird aufgerufen, wenn das Plugin in einer Guild aktiviert wird
     * @param {string} guildId - ID der Guild
     */
    async onGuildEnable(guildId) {
        const Logger = ServiceManager.get('Logger');
        Logger.debug(`Plugin ${this.name} in Guild ${guildId} aktiviert`);
    }

    /**
     * Wird aufgerufen, wenn das Plugin in einer Guild deaktiviert wird
     * @param {string} guildId - ID der Guild
     */
    async onGuildDisable(guildId) {
        const Logger = ServiceManager.get('Logger');
        Logger.debug(`Plugin ${this.name} in Guild ${guildId} deaktiviert`);
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