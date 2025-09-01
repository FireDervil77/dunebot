const { MessageFlags } = require("discord.js");
const { handleSlashCommand, handleContext } = require("../handler");
const { ServiceManager } = require("dunebot-core");
const { parseJsonArray } = require("dunebot-sdk/utils");


/**
 * @param {import('discord.js').Interaction} interaction 
 */
module.exports = async (interaction) => {
    const dbService = ServiceManager.get("dbService");

    if (!interaction.guild) {
        return interaction
            .reply({
                content: "Command can only be executed in a discord server",
                flags: MessageFlags.Ephemeral,
            })
            .catch(() => {});
    }

    const guild = interaction.guild;

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
            const settings = await dbService.getSettings(guild.id);
            
            // Parse enabled_plugins (ist ein JSON-String)
            const enabledPlugins = parseJsonArray(settings.enabled_plugins, ['core']);
            const disabledSlash = parseJsonArray(settings.disabled_slash, []);
            
            // check if the plugin is disabled
            if (!enabledPlugins.includes(cmd.plugin.name)) {
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