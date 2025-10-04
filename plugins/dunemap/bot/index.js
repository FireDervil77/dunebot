const { BotPlugin } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

class DuneMapBotPlugin extends BotPlugin {
    constructor() {
        super({
            name: 'dunemap',
            displayName: 'DuneMap',
            description: 'Interaktive Karte für Dune-Spiele',
            version: '1.0.0',
            author: 'DuneBot Team',
            icon: 'fa-solid fa-map',
            baseDir: __dirname,
            ownerOnly: false
        });
        
        this.Logger = ServiceManager.get("Logger");
        this.dbService = ServiceManager.get("dbService");
    }

    /**
     * Wird aufgerufen, wenn das Plugin aktiviert wird
     * Initialisiert Standardkonfigurationen
     * 
     * @param {import('discord.js').Client} client - Discord.js Client
     * @returns {Promise<void>}
     * @author DuneBot Team
     */
    async onEnable(client) {
        const Logger = ServiceManager.get("Logger");
        Logger.info('DuneMap-Bot-Plugin wird aktiviert...');
        Logger.success('DuneMap-Bot-Plugin aktiviert');
    }

    /**
     * Wird aufgerufen, wenn das Plugin deaktiviert wird
     * 
     * @param {import('discord.js').Client} client - Discord.js Client
     * @returns {Promise<void>}
     * @author DuneBot Team
     */
    async onDisable(client) {
        const Logger = ServiceManager.get("Logger");
        Logger.info('DuneMap-Bot-Plugin wird deaktiviert...');
        
        // Keine Tabellen löschen hier - das macht das Dashboard-Plugin
        // Bot-Plugin kümmert sich nur um Commands/Events cleanup
        
        Logger.success('DuneMap-Bot-Plugin deaktiviert');
    }
        
    /**
     * Wird aufgerufen, wenn das Plugin für eine bestimmte Guild aktiviert wird
     * 
     * @param {string} guildId - ID der Discord-Guild
     * @returns {Promise<void>}
     * @author DuneBot Team
     */
    async onGuildEnable(guildId) {
        const Logger = ServiceManager.get("Logger");
        Logger.info(`DuneMap-Plugin für Guild ${guildId} aktiviert`);
        
        try {
            // Default Config aus der config.json laden
            const defaultConfig = require('../config.json');
            
            // Alle Konfigurationen für diese Guild initialisieren
            for (const [key, value] of Object.entries(defaultConfig)) {
                const existingConfig = await this.dbService.getConfig(
                    'dunemap',
                    key,
                    'shared',
                    guildId
                );
                
                // Nur setzen wenn noch keine Konfiguration existiert
                if (!existingConfig) {
                    await this.dbService.setConfig(
                        'dunemap',
                        key,
                        value,
                        'shared',
                        guildId,
                        false  // Nicht global
                    );
                }
            }

            // Sicherstellen dass das Plugin in ENABLED_PLUGINS ist
            const coreConfig = await this.dbService.getConfigs(guildId, "core", "shared");
            let enabledPlugins = coreConfig?.ENABLED_PLUGINS || ["core"];
            
            // Wenn es ein String ist, parsen
            if (typeof enabledPlugins === 'string') {
                enabledPlugins = JSON.parse(enabledPlugins);
            }
            
            // DuneMap hinzufügen wenn noch nicht drin
            if (!enabledPlugins.includes("dunemap")) {
                enabledPlugins.push("dunemap");
                await this.dbService.setConfig(
                    "core",
                    "ENABLED_PLUGINS",
                    enabledPlugins,
                    "shared",
                    guildId,
                    false
                );
            }
            
            Logger.debug(`DuneMap-Konfiguration für Guild ${guildId} initialisiert`);
        } catch (err) {
            Logger.error(`Fehler beim Initialisieren der Guild-Konfiguration für ${guildId}:`, err);
        }
    }

    /**
     * Wird aufgerufen, wenn das Plugin für eine bestimmte Guild deaktiviert wird
     * 
     * @param {string} guildId - ID der Discord-Guild
     * @returns {Promise<void>}
     * @author DuneBot Team
     */
    async onGuildDisable(guildId) {
        const Logger = ServiceManager.get("Logger");
        Logger.info(`DuneMap-Plugin für Guild ${guildId} wird deaktiviert...`);
        
        try {
            // Aus ENABLED_PLUGINS entfernen
            const coreConfig = await this.dbService.getConfigs(guildId, "core", "shared");
            let enabledPlugins = coreConfig?.ENABLED_PLUGINS || ["core"];
            
            // Wenn es ein String ist, parsen
            if (typeof enabledPlugins === 'string') {
                enabledPlugins = JSON.parse(enabledPlugins);
            }
            
            // DuneMap entfernen
            enabledPlugins = enabledPlugins.filter(p => p !== "dunemap");
            
            await this.dbService.setConfig(
                "core",
                "ENABLED_PLUGINS",
                enabledPlugins,
                "shared",
                guildId,
                false
            );
            
            Logger.success(`DuneMap-Plugin für Guild ${guildId} deaktiviert`);
        } catch (err) {
            Logger.error(`Fehler beim Deaktivieren des Plugins für Guild ${guildId}:`, err);
            throw err;
        }
    }

    /**
         * Registriert hooks für das Dunemap-Plugin
         * 
         * @param {import('dunebot-sdk').HookSystem} hooks - Das Hook-System
         * @returns {void}
         * @author DuneBot Team
         */
        registerHooks(hooks) {
            const Logger = ServiceManager.get("Logger");
            // Beispiel für einen Filter-Hook
            hooks.addFilter('modify_command_prefix', (prefix, guildId) => {
                // Hier könnte der Präfix für bestimmte Guilds geändert werden
                return prefix;
            });
            
            // Beispiel für einen Action-Hook
            hooks.addAction('after_command_execution', (commandContext) => {
                // Hier könnte Logging nach jeder Befehlsausführung durchgeführt werden
            });
            
            Logger.debug('Core-Plugin-Hooks registriert');
        }
   
}

module.exports = new DuneMapBotPlugin();