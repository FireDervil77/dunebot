const { MessageFlags } = require("discord.js");
const { handleSlashCommand, handleContext } = require("../handler");
const { ServiceManager } = require("dunebot-core");
const { parseJsonArray } = require("dunebot-sdk/utils");


/**
 * @param {import('discord.js').Interaction} interaction 
 */
module.exports = async (interaction) => {
    const dbService = ServiceManager.get("dbService");
    const Logger = ServiceManager.get("Logger");

    if (!interaction.guild) {
        return interaction
            .reply({
                content: "Command can only be executed in a discord server",
                flags: MessageFlags.Ephemeral,
            })
            .catch(() => {});
    }

    const guild = interaction.guild;
    
    // =====================================================
    // SICHERHEITSCHECK: Nur bekannte Guilds erlauben
    // =====================================================
    
    // 1. Guild muss im Discord-Cache sein
    const isInCache = interaction.client.guilds.cache.has(guild.id);
    if (!isInCache) {
        Logger.error(`❌ INTERACTION von unbekannter Guild: ${guild.id} (${guild.name})`);
        Logger.error(`Bot kennt nur: ${Array.from(interaction.client.guilds.cache.keys()).join(', ')}`);
        return interaction
            .reply({
                content: "❌ Dieser Server ist nicht registriert! Bot muss neu zum Server hinzugefügt werden.",
                flags: MessageFlags.Ephemeral,
            })
            .catch(() => {});
    }
    
    // 2. Guild muss in Datenbank sein
    const [guildInDB] = await dbService.query(
        "SELECT 1 FROM guilds WHERE _id = ? LIMIT 1",
        [guild.id]
    );
    
    if (!guildInDB) {
        Logger.error(`❌ INTERACTION von nicht-registrierter Guild: ${guild.id} (${guild.name})`);
        return interaction
            .reply({
                content: "❌ Dieser Server ist nicht in der Datenbank! Bitte warte kurz und versuche es erneut.",
                flags: MessageFlags.Ephemeral,
            })
            .catch(() => {});
    }
    
    Logger.debug(`✅ Interaction von valider Guild: ${guild.name} (${guild.id})`);

    // Slash Commands
    if (interaction.isChatInputCommand()) {
        const cmd = interaction.client.commandManager.findSlashCommand(interaction.commandName);
        if (!cmd) {
            return interaction
                .reply({
                    content: guild.getT("core:HANDLER.CMD_NOT_FOUND"),
                    flags: MessageFlags.Ephemeral,
                })
                .catch(() => {});
        }

        try {
            // Settings aus der Datenbank holen
            const settings = await dbService.getConfigs(guild.id);

            // NEU: Aktivierte Plugins aus guild_plugins laden
            const enabledPlugins = await dbService.getEnabledPlugins(guild.id);
            const disabledSlash = parseJsonArray(settings.disabled_slash, []);
            
            // check if the plugin is disabled (kern-Commands sind immer aktiv)
            if (cmd.plugin.name !== 'kern' && !enabledPlugins.includes(cmd.plugin.name)) {
                return interaction
                    .reply({
                        content: guild.getT("core:HANDLER.PLUGIN_DISABLED"),
                        flags: MessageFlags.Ephemeral,
                    })
                    .catch(() => {});
            }

            // check if the command is disabled
            if (disabledSlash.includes(cmd.name)) {
                return interaction
                    .reply({
                        content: guild.getT("core:HANDLER.CMD_DISABLED"),
                        flags: MessageFlags.Ephemeral,
                    })
                    .catch(() => {});
            }

            await handleSlashCommand(interaction, cmd);
        } catch (error) {
            console.error("Error handling slash command:", error);
            return interaction
                .reply({ 
                    content: guild.getT("core:HANDLER.ERROR"), 
                    flags: MessageFlags.Ephemeral 
                })
                .catch(() => {});
        }
    }

    // Context Menu
    else if (interaction.isContextMenuCommand()) {
        const context = interaction.client.commandManager.findContextMenu(interaction.commandName);
        if (context) {
            try {
                await handleContext(interaction, context);
            } catch (error) {
                console.error("Error handling context menu:", error);
                return interaction
                    .reply({ 
                        content: guild.getT("core:HANDLER.ERROR"), 
                        flags: MessageFlags.Ephemeral 
                    })
                    .catch(() => {});
            }
        } else {
            return interaction
                .reply({ 
                    content: guild.getT("core:HANDLER.ERROR"), 
                    flags: MessageFlags.Ephemeral 
                })
                .catch(() => {});
        }
    }
};