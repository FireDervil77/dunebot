const { BotPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

class DuneMapBotPlugin extends BotPlugin {
    constructor() {
        super({
            name: 'dunemap',
            displayName: 'DuneMap',
            description: 'DuneMap Plugin für Discord-Integration',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
            displayName: 'DuneMap',
            description: 'Interaktive Karte für Dune the Awakening',
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
     * @author DuneBot Team
     */
    async onEnable(client) {
        const Logger = ServiceManager.get("Logger");
        Logger.info('[DuneMap]-Plugin wird aktiviert...');
        Logger.success('[DuneMap]-Plugin aktiviert');
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
        Logger.info('[DuneMap]-Plugin wird deaktiviert...');
        
        // Keine Tabellen löschen hier - das macht das Dashboard-Plugin
        // Bot-Plugin kümmert sich nur um Commands/Events cleanup
        
        Logger.success('[DuneMap]-Plugin deaktiviert');
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
        Logger.info(`[DuneMap]-Plugin für Guild ${guildId} aktiviert`);
        
        try {
            // Default Config aus der config.json laden
            const defaultConfig = require('../dashboard/config.json');
            
            // Alle Konfigurationen für diese Guild initialisieren
            // ensureConfigs() erstellt nur fehlende Configs, überschreibt KEINE existierenden!
            const stats = await this.dbService.ensureConfigs(
                'dunemap',
                defaultConfig,
                'shared',
                guildId
            );
            
            Logger.debug(`[DuneMap]-Config für Guild ${guildId}: ${stats.created} neu, ${stats.existing} bereits vorhanden`);

            // HINWEIS: Plugin wird bereits vom PluginManager via enablePluginForGuild() 
            // in guild_plugins eingetragen - keine manuelle ENABLED_PLUGINS Manipulation mehr nötig!
            
            Logger.debug(`[DuneMap]-Konfiguration für Guild ${guildId} initialisiert`);
        } catch (err) {
            Logger.error(`Fehler beim Initialisieren der [DuneMap]-Konfiguration für ${guildId}:`, err);
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
        Logger.info(`[DuneMap]-Plugin für Guild ${guildId} wird deaktiviert...`);

        try {
            // HINWEIS: Plugin wird bereits vom PluginManager via disablePluginForGuild()
            // in guild_plugins deaktiviert - keine manuelle ENABLED_PLUGINS Manipulation mehr nötig!
            
            Logger.success(`[DuneMap]-Plugin für Guild ${guildId} deaktiviert`);
        } catch (err) {
            Logger.error(`Fehler beim Deaktivieren des [DuneMap]-Plugins für Guild ${guildId}:`, err);
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
        
        Logger.debug('[DuneMap]-Plugin-Hooks registriert');
    }
   
}

module.exports = new DuneMapBotPlugin();