const { BotPlugin } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

class ModerationBotPlugin extends BotPlugin {
    constructor() {
        super({
            name: 'moderation',
            displayName: 'Moderation',
            description: 'Moderation-Tools für FireBot',
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
        Logger.info('Moderation-Plugin wird aktiviert...');
        Logger.success('Moderation-Plugin aktiviert');
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
        Logger.info('Moderation-Plugin wird deaktiviert...');
        
        // Keine Tabellen löschen hier - das macht das Dashboard-Plugin
        // Bot-Plugin kümmert sich nur um Commands/Events cleanup

        Logger.success('Moderation-Plugin deaktiviert');
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
        Logger.info(`Moderation-Plugin für Guild ${guildId} aktiviert`);
        try {
            // Default-Einstellungen in DB erstellen
            await this.dbService.query(`
                INSERT INTO moderation_settings (
                    guild_id, modlog_channel, max_warn_limit, max_warn_action,
                    modlog_events, dm_on_warn, dm_on_kick, dm_on_ban, dm_on_timeout
                )
                VALUES (?, NULL, 5, 'KICK', ?, 1, 1, 1, 1)
                ON DUPLICATE KEY UPDATE guild_id = guild_id
            `, [guildId, JSON.stringify(['WARN','KICK','BAN','TIMEOUT','UNTIMEOUT','SOFTBAN','UNBAN'])]);
            
            Logger.success(`Moderation-Konfiguration für Guild ${guildId} initialisiert`);
        } catch (err) {
            Logger.error(`Fehler beim Initialisieren der Moderation-Konfiguration für ${guildId}:`, err);
        }
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
        Logger.info(`Moderation-Plugin für Guild ${guildId} wird deaktiviert...`);
        
        try {
            // HINWEIS: Plugin wird bereits vom PluginManager via disablePluginForGuild()
            // in guild_plugins deaktiviert - keine manuelle ENABLED_PLUGINS Manipulation mehr nötig!

            Logger.success(`Moderation-Plugin für Guild ${guildId} deaktiviert`);
        } catch (err) {
            Logger.error(`Fehler beim Deaktivieren des Moderation-Plugins für Guild ${guildId}:`, err);
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
        
        Logger.debug('Moderation-Plugin-Hooks registriert');
    }
   
}

module.exports = new ModerationBotPlugin();