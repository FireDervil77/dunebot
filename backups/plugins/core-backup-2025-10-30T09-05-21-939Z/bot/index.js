/**
 * Core-Plugin für DuneBot - Bot-Teil
 * Stellt Basisfunktionalitäten für den Bot bereit
 * 
 * @author FireBot Team
 */
const path = require('path');
const fs = require('fs');
const { BotPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

/**
 * Core-Plugin für den Bot-Teil von DuneBot
 * Implementiert grundlegende Bot-Funktionen und Konfigurationen
 * 
 * @extends {BotPlugin}
 * @author FireBot Team
 */
class CoreBotPlugin extends BotPlugin {
    /**
     * Erstellt eine neue Instanz des Core-Bot-Plugins
     */
    constructor() {
        super({
            name: 'core',
            displayName: 'Kern-Plugin',
            description: 'Grundlegende Funktionen für den DuneBot',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'DuneBot Team',
            icon: 'fa-solid fa-cog',
            baseDir: __dirname,
            ownerOnly: false
        });
        const Logger = ServiceManager.get("Logger");
        Logger.debug('Core-Bot-Plugin initialisiert');
    }
    
    /**
     * Wird aufgerufen, wenn das Plugin aktiviert wird
     * Initialisiert Standardkonfigurationen und Bot-Status
     * 
     * @param {import('discord.js').Client} client - Discord.js Client
     * @returns {Promise<void>}
     * @author FireBot Team
     */
    async onEnable(client) {
        const Logger = ServiceManager.get("Logger");
        Logger.info('Core-Bot-Plugin wird aktiviert...');
        // IPC Handler werden automatisch aus events/ipc/ geladen
        
        Logger.success('Core-Bot-Plugin aktiviert');
    }
    
    /**
     * Wird aufgerufen, wenn das Plugin deaktiviert wird
     * 
     * @param {import('discord.js').Client} client - Discord.js Client
     * @returns {Promise<void>}
     * @author FireBot Team
     */
    async onDisable(client) {
        const Logger = ServiceManager.get("Logger");
        Logger.info('Core-Bot-Plugin wird deaktiviert...');
        // Aufräumarbeiten hier durchführen
        
        Logger.success('Core-Bot-Plugin deaktiviert');
    }
    
    /**
     * Wird aufgerufen, wenn das Plugin für eine bestimmte Guild aktiviert wird
     * 
     * @param {string} guildId - ID der Discord-Guild
     * @returns {Promise<void>}
     * @author FireBot Team
     */
    async onGuildEnable(guildId) {
        const Logger = ServiceManager.get("Logger");
        Logger.info(`Core-Plugin für Guild ${guildId} aktiviert`);
        
    }
    
    /**
     * Wird aufgerufen, wenn das Plugin für eine bestimmte Guild deaktiviert wird
     * 
     * @param {string} guildId - ID der Discord-Guild
     * @returns {Promise<void>}
     * @author FireBot Team
     */
    async onGuildDisable(guildId) {
        const Logger = ServiceManager.get("Logger");
        Logger.info(`Core-Plugin für Guild ${guildId} deaktiviert`);
        // Guild-spezifische Aufräumarbeiten
    }
    
    
    /**
     * Registriert hooks für das Core-Plugin
     * 
     * @param {import('dunebot-sdk').HookSystem} hooks - Das Hook-System
     * @returns {void}
     * @author FireBot Team
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

// Instanz des Plugins exportieren
module.exports = new CoreBotPlugin();