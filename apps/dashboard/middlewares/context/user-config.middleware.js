/**
 * User-Config Middleware
 * Stellt user-spezifische Konfigurationen via req.userConfig zur Verfügung
 * 
 * @author firedervil
 * @created 2025-10-13
 */

const { ServiceManager } = require("dunebot-core");

/**
 * Middleware für User-Configs
 * Erweitert Request-Objekt mit userConfig Helper-Objekt
 * 
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
module.exports = async (req, res, next) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        // Nur wenn User eingeloggt ist
        if (req.session?.user?.id) {
            const userId = req.session.user.id;
            
            /**
             * User-Config Helper-Objekt
             * Bietet einfache Methoden zum Lesen/Schreiben von User-Configs
             */
            req.userConfig = {
                /**
                 * Holt eine User-Config
                 * @param {string} plugin Plugin-Name
                 * @param {string} key Config-Key
                 * @param {string|null} guildId Guild-ID oder null für global
                 * @returns {Promise<any>}
                 */
                get: async (plugin, key, guildId = null) => {
                    return await dbService.getUserConfig(userId, plugin, key, guildId);
                },
                
                /**
                 * Setzt eine User-Config
                 * @param {string} plugin Plugin-Name
                 * @param {string} key Config-Key
                 * @param {any} value Config-Wert
                 * @param {string|null} guildId Guild-ID oder null für global
                 * @returns {Promise<void>}
                 */
                set: async (plugin, key, value, guildId = null) => {
                    return await dbService.setUserConfig(userId, plugin, key, value, guildId);
                },
                
                /**
                 * Löscht eine User-Config
                 * @param {string} plugin Plugin-Name
                 * @param {string} key Config-Key
                 * @param {string|null} guildId Guild-ID oder null für global
                 * @returns {Promise<void>}
                 */
                delete: async (plugin, key, guildId = null) => {
                    return await dbService.deleteUserConfig(userId, plugin, key, guildId);
                },
                
                /**
                 * Holt alle Configs eines Plugins
                 * @param {string} plugin Plugin-Name
                 * @param {string|null} guildId Guild-ID oder null für global
                 * @returns {Promise<Object>}
                 */
                getAll: async (plugin, guildId = null) => {
                    return await dbService.getUserConfigs(userId, plugin, guildId);
                }
            };
            
            Logger.debug(`[UserConfig] Helper für User ${userId} initialisiert`);
        } else {
            // Kein User eingeloggt → leere Dummy-Funktionen
            req.userConfig = {
                get: async () => null,
                set: async () => {},
                delete: async () => {},
                getAll: async () => ({})
            };
        }
    } catch (error) {
        Logger.error('[UserConfig Middleware] Fehler:', error);
        // Fallback: Dummy-Funktionen
        req.userConfig = {
            get: async () => null,
            set: async () => {},
            delete: async () => {},
            getAll: async () => ({})
        };
    }
    
    next();
};
