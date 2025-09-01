const {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    Message,
    ButtonBuilder,
    CommandInteraction,
    ApplicationCommandOptionType,
    ButtonStyle,
    ComponentType,
} = require("discord.js");
const { getCommandUsage, getSlashUsage } = require("../handler");
const { EmbedUtils, parseJsonArray } = require("dunebot-sdk/utils");
const { ServiceManager } = require("dunebot-core");

const CMDS_PER_PAGE = 5;
const IDLE_TIMEOUT = 30;

module.exports = {
    name: "help",
    description: "core:HELP.DESCRIPTION",
    botPermissions: ["EmbedLinks"],
    validations: [],
    command: {
        enabled: true,
        usage: "[plugin|command]",
    },
    slashCommand: {
        enabled: true,
        options: [
            {
                name: "plugin",
                description: "core:HELP.PLUGIN_DESC",
                required: false,
                type: ApplicationCommandOptionType.String,
            },
            {
                name: "command",
                description: "core:HELP.COMMAND_DESC",
                required: false,
                type: ApplicationCommandOptionType.String,
            },
        ],
    },

    async messageRun({ message, args, prefix, plugin }) {
        const dbService = ServiceManager.get("dbService");
        let trigger = args[0];

        try {
            // Get settings from database
            const settings = await dbService.getSettings(message.guild.id);
            // teste die neue jsonParse-Funktion
            const enabledPlugins = parseJsonArray(settings.enabled_plugins, ['core']);
            const disabledPrefix = parseJsonArray(settings.disabled_prefix, []);

            // !help
            if (!trigger) {
                const response = await getHelpMenu({ 
                    client: message.client, 
                    guild: message.guild,
                    plugin 
                });
                const sentMsg = await message.reply(response);
                return waiter(sentMsg, message.author.id, prefix, disabledPrefix);
            }

            // check if category help (!help cat)
            if (message.client.commandManager.plugins.some(
                (p) => p.name === trigger && !p.ownerOnly && enabledPlugins.includes(p.name)
            )) {
                return pluginWaiter(message, trigger, prefix, disabledPrefix);
            }

            // check if command help (!help cmdName)
            const cmd = message.client.commandManager.findPrefixCommand(trigger);
            if (cmd && !disabledPrefix.includes(trigger)) {
                const embed = getCommandUsage(message.guild, cmd, prefix, trigger);
                return message.reply({ embeds: [embed] });
            }

            // No matching command/category found
            await message.replyT("core:HELP.NOT_FOUND");
        } catch (error) {
            console.error("Error in help command:", error);
            await message.replyT("core:HANDLER.ERROR");
        }
    },

    async interactionRun({ interaction, plugin }) {
        const dbService = ServiceManager.get("dbService");
        let pluginName = interaction.options.getString("plugin");
        let cmdName = interaction.options.getString("command");

        try {
            // Get settings from database
            const settings = await dbService.getSettings(interaction.guild.id);
            const enabledPlugins = parseJsonArray(settings.enabled_plugins, ['core']);
            const disabledSlash = parseJsonArray(settings.disabled_slash, []);

            // !help
            if (!cmdName && !pluginName) {
                const response = await getHelpMenu({ 
                    client: interaction.client, 
                    guild: interaction.guild,
                    plugin 
                });
                const sentMsg = await interaction.followUp(response);
                return waiter(sentMsg, interaction.user.id, null, disabledSlash);
            }

            // check if category help (!help cat)
            if (pluginName) {
                if (interaction.client.commandManager.plugins.some(
                    (p) => p.name === pluginName && !p.ownerOnly && enabledPlugins.includes(p.name)
                )) {
                    return pluginWaiter(interaction, pluginName, null, disabledSlash);
                }
                return interaction.followUpT("core:HELP.NOT_FOUND");
            }

            // check if command help (!help cmdName)
            if (cmdName) {
                const cmd = interaction.client.commandManager.findSlashCommand(cmdName);
                if (cmd && !disabledSlash.includes(cmd.name)) {
                    const embed = getSlashUsage(interaction.guild, cmd);
                    return interaction.followUp({ embeds: [embed] });
                }
                return interaction.followUpT("core:HELP.COMMAND_NOT_FOUND");
            }
        } catch (error) {
            console.error("Error in help command:", error);
            await interaction.followUpT("core:HANDLER.ERROR");
        }
    }
};

/**
 * @param {Message | CommandInteraction} arg0
 */
async function getHelpMenu({ client, guild }) {
     const dbService = ServiceManager.get("dbService");
     const settings = await dbService.getSettings(guild.id);
     const enabledPlugins = parseJsonArray(settings.enabled_plugins, ['core']);


    // Menu Row
    const options = [];
    for (const plugin of client.pluginManager.plugins.filter((p) => !p.ownerOnly)) {
        if (!enabledPlugins.includes(plugin.name)) continue;
        options.push({
            label: plugin.name,
            value: plugin.name,
            description: guild.getT("core:HELP.MENU_DESC", { plugin: plugin.name }),
            // emoji: v.emoji,
        });
    }

    const menuRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("help-menu")
            .setPlaceholder(guild.getT("core:HELP.MENU_PLACEHOLDER"))
            .addOptions(options),
    );

    // Buttons Row
    let components = [];
    components.push(
        new ButtonBuilder()
            .setCustomId("previousBtn")
            .setEmoji("⬅️")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId("nextBtn")
            .setEmoji("➡️")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
    );

    let buttonsRow = new ActionRowBuilder().addComponents(components);
    const config = await client.pluginManager.getPlugin("core").getConfig();
    const embed = EmbedUtils.embed()
        .setThumbnail(client.user.displayAvatarURL())
        .setDescription(
            "**About Me:**\n" +
                `Hello I am ${guild.members.me.displayName}!\n` +
                "A cool multipurpose discord bot which can serve all your needs\n\n" +
                "When you first use the Dunebot, you can use the `help` command to get a list of all available commands.\n" +
                "You can also use the `help <plugin>` command to get more information about a specific plugin.\n\n" +
                "I have spend so many hours to build a framework that can handle all the plugins and commands.\n" +
                "If you have any questions or suggestions, feel free to join my support server.\n\n" +
                "**Links:**\n" +
                `**Website:** [Here](${config["WEBSITE"]})\n` +
                `**GitHub:** [Here](${config["GITHUB"]})\n` +
                `**Documentation:** [Here](${config["DOCUMENTATION"]})\n` +
                `**Support Server:** [Join](${config["SUPPORT_SERVER"]})\n` +
                '**Buy me a coffee:** [Here](https://ko-fi.com/dunebot)\n\n' +
                `**Invite Me:** [Here](${client.getInvite()})\n`
        );

    return {
        embeds: [embed],
        components: [menuRow, buttonsRow],
    };
}

/**
 * @param {Message} msg
 * @param {string} userId
 * @param {string} prefix
 * @param {string[]} disabledCmds
 */
const waiter = (msg, userId, prefix, disabledCmds) => {
    const collector = msg.channel.createMessageComponentCollector({
        filter: (reactor) => reactor.user.id === userId && msg.id === reactor.message.id,
        idle: IDLE_TIMEOUT * 1000,
        dispose: true,
        time: 5 * 60 * 1000,
    });

    let arrEmbeds = [];
    let currentPage = 0;
    let menuRow = msg.components[0];
    let buttonsRow = msg.components[1];

    collector.on("collect", async (response) => {
        if (!["help-menu", "previousBtn", "nextBtn"].includes(response.customId)) return;
        await response.deferUpdate();

        switch (response.customId) {
            case "help-menu": {
                const cat = response.values[0];
                arrEmbeds = prefix
                    ? getPrefixPluginCommandEmbed(msg.guild, cat, prefix, disabledCmds)
                    : getSlashPluginCommandsEmbed(msg.guild, cat, disabledCmds);
                currentPage = 0;

                // Buttons Row
                let components = [];
                buttonsRow.components.forEach((button) =>
                    components.push(
                        ButtonBuilder.from(button).setDisabled(arrEmbeds.length > 1 ? false : true),
                    ),
                );

                buttonsRow = new ActionRowBuilder().addComponents(components);
                msg.editable &&
                    (await msg.edit({
                        embeds: [arrEmbeds[currentPage]],
                        components: [menuRow, buttonsRow],
                    }));
                break;
            }

            case "previousBtn":
                if (currentPage !== 0) {
                    --currentPage;
                    msg.editable &&
                        (await msg.edit({
                            embeds: [arrEmbeds[currentPage]],
                            components: [menuRow, buttonsRow],
                        }));
                }
                break;

            case "nextBtn":
                if (currentPage < arrEmbeds.length - 1) {
                    currentPage++;
                    msg.editable &&
                        (await msg.edit({
                            embeds: [arrEmbeds[currentPage]],
                            components: [menuRow, buttonsRow],
                        }));
                }
                break;
        }
    });

    collector.on("end", () => {
        if (!msg.guild || !msg.channel) return;
        return msg.editable && msg.edit({ components: [] });
    });
};

/**
 * @param {import('discord.js').ChatInputCommandInteraction | import('discord.js').Message} arg0
 * @param {string} pluginName
 * @param {string} prefix
 * @param {string[]} disabledCmds
 */
const pluginWaiter = async (arg0, pluginName, prefix, disabledCmds) => {
    let arrEmbeds = prefix
        ? getPrefixPluginCommandEmbed(arg0.guild, pluginName, prefix, disabledCmds)
        : getSlashPluginCommandsEmbed(arg0.guild, pluginName, disabledCmds, disabledCmds);

    let currentPage = 0;
    let buttonsRow = [];

    if (arrEmbeds.length > 1) {
        buttonsRow = new ActionRowBuilder().addComponents([
            new ButtonBuilder()
                .setCustomId("previousBtn")
                .setEmoji("⬅️")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(false),
            new ButtonBuilder()
                .setCustomId("nextBtn")
                .setEmoji("➡️")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(false),
        ]);
    }

    const reply = {
        embeds: [arrEmbeds[currentPage]],
        components: arrEmbeds.length > 1 ? [buttonsRow] : [],
    };

    const sentMsg = prefix ? await arg0.reply(reply) : await arg0.followUp(reply);
    const authorId = prefix ? arg0.author.id : arg0.user.id;
    if (arrEmbeds.length > 1) {
        const collector = arg0.channel.createMessageComponentCollector({
            filter: (reactor) => reactor.user.id === authorId && sentMsg.id === reactor.message.id,
            componentType: ComponentType.Button,
            idle: IDLE_TIMEOUT * 1000,
            dispose: true,
            time: 5 * 60 * 1000,
        });

        collector.on("collect", async (response) => {
            if (!["previousBtn", "nextBtn"].includes(response.customId)) return;
            await response.deferUpdate();

            switch (response.customId) {
                case "previousBtn":
                    if (currentPage !== 0) {
                        --currentPage;
                        if (sentMsg.editable) {
                            await sentMsg.edit({
                                embeds: [arrEmbeds[currentPage]],
                                components: [buttonsRow],
                            });
                        }
                    }
                    break;

                case "nextBtn":
                    if (currentPage < arrEmbeds.length - 1) {
                        currentPage++;
                        if (sentMsg.editable) {
                            await sentMsg.edit({
                                embeds: [arrEmbeds[currentPage]],
                                components: [buttonsRow],
                            });
                        }
                    }
                    break;
            }
        });

        collector.on("end", () => {
            if (!sentMsg.guild || !sentMsg.channel) return;
            return sentMsg.editable && sentMsg.edit({ components: [] });
        });
    }
};

/**
 * Returns an array of message embeds for a particular command category [SLASH COMMANDS]
 * @param {import('discord.js').Guild} guild
 * @param {string} pluginName
 * @param {string[]} disabledCmds
 */
function getSlashPluginCommandsEmbed(guild, pluginName, disabledCmds) {
    const commands = [
        ...guild.client.pluginManager.plugins.find((p) => p.name === pluginName).commands,
    ].filter((cmd) => cmd.slashCommand?.enabled && !disabledCmds.includes(cmd.name));

    if (commands.length === 0) {
        const embed = EmbedUtils.embed()
            // .setThumbnail(CommandCategory[category]?.image)
            .setAuthor({ name: `Plugin ${pluginName.toUpperCase()}` })
            .setDescription(guild.getT("core:HELP.EMPTY_CATEGORY"));

        return [embed];
    }

    const arrSplitted = [];
    const arrEmbeds = [];

    while (commands.length) {
        let toAdd = commands.splice(
            0,
            commands.length > CMDS_PER_PAGE ? CMDS_PER_PAGE : commands.length,
        );

        toAdd = toAdd.map((cmd) => {
            const subCmds = cmd.slashCommand.options?.filter(
                (opt) => opt.type === ApplicationCommandOptionType.Subcommand,
            );
            const subCmdsString = subCmds?.map((s) => s.name).join(", ");
            return `\`/${cmd.name}\`\n ❯ **${guild.getT("core:HELP.CMD_DESC")}**: ${guild.getT(cmd.description)}\n ${
                !subCmds?.length
                    ? "\n"
                    : `❯ **${guild.getT("core:HELP.CMD_SUBCOMMANDS")} [${subCmds?.length}]**: ${subCmdsString}\n`
            } `;
        });

        arrSplitted.push(toAdd);
    }

    arrSplitted.forEach((item, index) => {
        const embed = EmbedUtils.embed()
            // .setThumbnail(CommandCategory[category]?.image)
            .setAuthor({ name: `Plugin ${pluginName.toUpperCase()}` })
            .setDescription(item.join("\n"))
            .setFooter({
                text: guild.getT("core:HELP.PLUGIN_EMBED_FOOTER", {
                    page: index + 1,
                    pages: arrSplitted.length,
                    prefix: "/",
                }),
            });
        arrEmbeds.push(embed);
    });

    return arrEmbeds;
}

/**
 * Returns an array of message embeds for a particular command category [MESSAGE COMMANDS]
 * @param {import('discord.js').Guild} guild
 * @param {string} pluginName
 * @param {string} prefix
 *
 */
function getPrefixPluginCommandEmbed(guild, pluginName, prefix, disabledCmds) {
    const commands = [
        ...guild.client.pluginManager.plugins.find((p) => p.name === pluginName).commands,
    ].filter((cmd) => cmd.command?.enabled && !disabledCmds.includes(cmd.name));

    if (commands.length === 0) {
        const embed = EmbedUtils.embed()
            // .setThumbnail(CommandCategory[pluginName]?.image)
            .setAuthor({ name: `Plugin ${guild.getT(pluginName.toLowerCase() + ":TITLE")}` })
            .setDescription(guild.getT("core:HELP.EMPTY_CATEGORY"));

        return [embed];
    }

    const arrSplitted = [];
    const arrEmbeds = [];

    while (commands.length) {
        let toAdd = commands.splice(
            0,
            commands.length > CMDS_PER_PAGE ? CMDS_PER_PAGE : commands.length,
        );
        toAdd = toAdd.map((cmd) => {
            const subCmds = cmd.command.subcommands;
            const subCmdsString = subCmds?.map((s) => s.trigger.split(" ")[0]).join(", ");
            return `\`${prefix}${cmd.name}\`\n ❯ **${guild.getT("core:HELP.CMD_DESC")}**: ${guild.getT(cmd.description)}\n ${
                !subCmds?.length
                    ? "\n"
                    : `❯ **${guild.getT("core:HELP.CMD_SUBCOMMANDS")} [${subCmds?.length}]**: ${subCmdsString}\n`
            } `;
        });
        arrSplitted.push(toAdd);
    }

    arrSplitted.forEach((item, index) => {
        const embed = EmbedUtils.embed()
            // .setThumbnail(CommandCategory[pluginName]?.image)
            .setAuthor({ name: `Plugin ${guild.getT(pluginName.toLowerCase() + ":TITLE")}` })
            .setDescription(item.join("\n"))
            .setFooter({
                text: guild.getT("core:HELP.PLUGIN_EMBED_FOOTER", {
                    page: index + 1,
                    pages: arrSplitted.length,
                    prefix,
                }),
            });

        arrEmbeds.push(embed);
    });

    return arrEmbeds;
}