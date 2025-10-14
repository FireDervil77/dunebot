const { BotPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

class TicketBotPlugin extends BotPlugin {
    constructor() {
        super({
            name: 'ticket',
            displayName: 'Ticket',
            description: 'Ticket-System für Discord',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
            displayName: 'Ticket',
            description: 'Ticket-Management für FireBot',
            version: '1.0.0',
            author: 'FireBot Team',
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
     * @author FireBot Team
     */
    async onEnable(client) {
        const Logger = ServiceManager.get("Logger");
        Logger.info('[Ticket]-Plugin wird aktiviert...');
        Logger.success('[Ticket]-Plugin aktiviert');
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
        Logger.info('[Ticket]-Plugin wird deaktiviert...');
        
        // Keine Tabellen löschen hier - das macht das Dashboard-Plugin
        // Bot-Plugin kümmert sich nur um Commands/Events cleanup

        Logger.success('[Ticket]-Plugin deaktiviert');
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
        Logger.info(`[Ticket]-Plugin für Guild ${guildId} aktiviert`);
      
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
        Logger.info(`[Ticket]-Plugin für Guild ${guildId} wird deaktiviert...`);
        
        try {
            // HINWEIS: Plugin wird bereits vom PluginManager via disablePluginForGuild()
            // in guild_plugins deaktiviert - keine manuelle ENABLED_PLUGINS Manipulation mehr nötig!

            Logger.success(`[Ticket]-Plugin für Guild ${guildId} deaktiviert`);
        } catch (err) {
            Logger.error(`Fehler beim Deaktivieren des [Ticket]-Plugins für Guild ${guildId}:`, err);
            throw err;
        }
    }

    /**
     * Registriert hooks für das Dunemap-Plugin
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
        
        Logger.debug('[Ticket]-Plugin-Hooks registriert');
    }
   
}

module.exports = new TicketBotPlugin();