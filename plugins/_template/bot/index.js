/**
 * Template-Plugin für DuneBot - Bot-Teil
 * Verwenden Sie dieses Template als Ausgangspunkt für neue Plugins
 * 
 * @author DuneBot Team
 */
const path = require('path');
const { BotPlugin } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

/**
 * Template-Plugin für den Bot-Teil von DuneBot
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
class TemplateBotPlugin extends BotPlugin {
    /**
     * Erstellt eine neue Instanz des Template-Bot-Plugins
     */
    constructor() {
        super({
            name: 'template',
            displayName: 'Template Plugin',
            description: 'Ein Beispiel-Plugin für DuneBot',
            version: '1.0.0',
            author: 'Ihr Name',
            icon: 'fa-solid fa-puzzle-piece',
            baseDir: __dirname,
            ownerOnly: false
        });
        
        const Logger = ServiceManager.get("Logger");
        Logger.debug('Template-Bot-Plugin initialisiert');
    }
    
    /**
     * Wird aufgerufen, wenn das Plugin global aktiviert wird
     * Hier können globale Konfigurationen initialisiert werden
     * 
     * @param {import('discord.js').Client} client - Discord.js Client
     * @returns {Promise<void>}
     * @author DuneBot Team
     */
    async onEnable(client) {
        const Logger = ServiceManager.get("Logger");
        Logger.info('Template-Bot-Plugin wird aktiviert...');
        
        // Beispiel: Globale Konfiguration laden
        // const dbService = ServiceManager.get('dbService');
        // await dbService.setConfig('template', 'someGlobalSetting', 'value', 'bot', null, true);
        
        Logger.success('Template-Bot-Plugin aktiviert');
    }
    
    /**
     * Wird aufgerufen, wenn das Plugin deaktiviert wird
     * Hier sollten Aufräumarbeiten durchgeführt werden
     * 
     * @param {import('discord.js').Client} client - Discord.js Client
     * @returns {Promise<void>}
     * @author DuneBot Team
     */
    async onDisable(client) {
        const Logger = ServiceManager.get("Logger");
        Logger.info('Template-Bot-Plugin wird deaktiviert...');
        
        // Beispiel: Aufräumarbeiten
        // Listener entfernen, Timer stoppen, etc.
        
        Logger.success('Template-Bot-Plugin deaktiviert');
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
     * Registriert Hooks für das Template-Plugin
     * Hooks ermöglichen es, in andere Plugin-Prozesse einzugreifen
     * 
     * @param {import('dunebot-sdk').HookSystem} hooks - Das Hook-System
     * @returns {void}
     * @author DuneBot Team
     */
    registerHooks(hooks) {
        const Logger = ServiceManager.get("Logger");
        
        // Beispiel: Action Hook - Wird ausgeführt wenn ein Befehl läuft
        // hooks.addAction('command_executed', async (commandName, guildId) => {
        //     Logger.debug(`Befehl ${commandName} wurde in Guild ${guildId} ausgeführt`);
        // });
        
        // Beispiel: Filter Hook - Modifiziert Daten
        // hooks.addFilter('modify_command_response', (response, commandName) => {
        //     return response + ' - Modified by Template Plugin';
        // });
        
        Logger.debug('Template-Plugin Hooks registriert');
    }
    
    /**
     * Beispiel: Private Hilfsmethode für Guild-Initialisierung
     * 
     * @param {string} guildId - Guild ID
     * @returns {Promise<void>}
     * @private
     */
    async _initializeGuildDefaults(guildId) {
        const dbService = ServiceManager.get('dbService');
        
        // Beispiel: Standardkonfiguration für die Guild setzen
        const defaults = {
            enabled: true,
            notificationChannel: null,
            logLevel: 'info'
        };
        
        for (const [key, value] of Object.entries(defaults)) {
            await dbService.setConfig('template', key, value, 'bot', guildId);
        }
    }
}

module.exports = new TemplateBotPlugin;
