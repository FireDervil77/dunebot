/**
 * Information-Plugin für DuneBot - Bot-Teil
 * Stellt Basisfunktionalitäten für den Bot bereit
 * 
 * @author DuneBot Team
 */
const path = require('path');
const { BotPlugin } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');
const { models } = require('dunebot-db-client');

/**
 * Information-Plugin für den Bot-Teil von DuneBot
 * Implementiert grundlegende Bot-Funktionen und Konfigurationen
 * 
 * @extends {BotPlugin}
 * @author DuneBot Team
 */
class InfoBotPlugin extends BotPlugin {
    /**
     * Erstellt eine neue Instanz des Information-Bot-Plugins
     */
    constructor() {
        super({
            name: 'information',
            displayName: 'Information-Plugin',
            description: 'Stellt verschiedene Informationen rund um den Server / Owner / Member bereit.',
            version: '1.0.0',
            author: 'DuneBot Team',
            icon: 'fa-solid fa-cog',
            baseDir: __dirname,
            ownerOnly: false
        });
        const Logger = ServiceManager.get("Logger");
        Logger.debug('Information-Bot-Plugin initialisiert');
    }
    
    /**
     * Wird aufgerufen, wenn das Plugin aktiviert wird
     * Initialisiert Standardkonfigurationen und Bot-Status
     * 
     * @param {import('discord.js').Client} client - Discord.js Client
     * @returns {Promise<void>}
     * @author DuneBot Team
     */
    async onEnable(client) {
        const Logger = ServiceManager.get("Logger");
        Logger.info('Information-Bot-Plugin wird aktiviert...');

        // Standardkonfiguration prüfen und initialisieren
        //await this.#initializeDefaultConfig();
        
        Logger.success('Information-Bot-Plugin aktiviert');
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
        Logger.info('Information-Bot-Plugin wird deaktiviert...');
        // Aufräumarbeiten hier durchführen
        
        Logger.success('Information-Bot-Plugin deaktiviert');
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
        Logger.info(`Information-Plugin für Guild ${guildId} aktiviert`);
        
        // Guild-spezifische Initialisierungen
            try {

                
               
            } catch (error) {
                Logger.error(`Fehler bei der Initialisierung der Guild ${guildId}:`, error);
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
        Logger.info(`Information-Plugin für Guild ${guildId} deaktiviert`);
        // Guild-spezifische Aufräumarbeiten
    }

    /**
     * Registriert hooks für das Presence-Plugin
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
        
        Logger.debug('Information-Plugin-Hooks registriert');
    }

}

module.exports = new InfoBotPlugin();