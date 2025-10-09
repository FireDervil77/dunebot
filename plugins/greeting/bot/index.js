/**
 * Greeting-Plugin für DuneBot - Bot-Teil
 * 
 * @author DuneBot Team
 */
const path = require('path');
const { BotPlugin } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

/**
 * Greeting-Plugin für den Bot-Teil von DuneBot
 * 
 * ANLEITUNG:
 * 1. Ersetzen Sie 'template' durch den Namen Ihres Plugins
 * 2. Aktualisieren Sie displayName, description, author
 * 3. Implementieren Sie die Lifecycle-Methoden nach Bedarf
 * 4. Fügen Sie Commands in bot/commands/ hinzu
 * 5. Fügen Sie Events in bot/events/ hinzu
 * 
 * @extends {BotPlugin}
 * @author DuneBot Team
 */
class GreetingBotPlugin extends BotPlugin {
    /**
     * Erstellt eine neue Instanz des Greetings-Bot-Plugins
     */
    constructor() {
        super({
            name: 'greetings',
            displayName: 'Greetings - Plugin',
            description: 'Ein Greetings-Plugin für FireBot',
            version: '1.0.0',
            author: 'FireDervil',
            icon: 'fa-solid fa-puzzle-piece',
            baseDir: __dirname,
            ownerOnly: false
        });
        
        const Logger = ServiceManager.get("Logger");
        Logger.debug('Greeting-Bot-Plugin initialisiert');
    }

    /**
     * Wird aufgerufen, wenn das Plugin für eine bestimmte Guild aktiviert wird
     * Hier können Guild-spezifische Konfigurationen initialisiert werden
     * 
     * @param {string} guildId - ID der Discord-Guild
     * @returns {Promise<void>}
     * @author DuneBot Team
     */
    async onGuildEnable(guildId) {
        const Logger = ServiceManager.get("Logger");
        Logger.info(`Template-Plugin für Guild ${guildId} aktiviert`);
        
        // Beispiel: Guild-spezifische Konfiguration
        // const dbService = ServiceManager.get('dbService');
        // await dbService.setConfig('template', 'guildSetting', 'default', 'bot', guildId);
        
        // Beispiel: Standardwerte für diese Guild setzen
        // await this._initializeGuildDefaults(guildId);
    }
    
    /**
     * Wird aufgerufen, wenn das Plugin für eine bestimmte Guild deaktiviert wird
     * Hier können Guild-spezifische Aufräumarbeiten durchgeführt werden
     * 
     * @param {string} guildId - ID der Discord-Guild
     * @returns {Promise<void>}
     * @author DuneBot Team
     */
    async onGuildDisable(guildId) {
        const Logger = ServiceManager.get("Logger");
        Logger.info(`Template-Plugin für Guild ${guildId} deaktiviert`);
        
        // Beispiel: Guild-spezifische Daten löschen oder archivieren
        // const dbService = ServiceManager.get('dbService');
        // await dbService.query('DELETE FROM template_data WHERE guild_id = ?', [guildId]);
    }

     /**
     * Registriert hooks für das Core-Plugin
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

module.exports = new GreetingBotPlugin;