const { ApplicationCommandOptionType, ChannelType } = require("discord.js");
const { EmbedUtils } = require("dunebot-sdk/utils");
const { stripIndent } = require("common-tags");
const { AutoModSettings } = require("../../shared/models");

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: "automod",
    description: "automod:AUTOMOD.CONFIG_DESC",
    userPermissions: ["ManageGuild"],
    command: {
        enabled: true,
        minArgsCount: 1,
        subcommands: [
            {
                trigger: "status",
                description: "automod:AUTOMOD.CONFIG_STATUS",
            },
            {
                trigger: "log <#channel|off>",
                description: "automod:AUTOMOD.CONFIG_LOG",
            },
            {
                trigger: "strikes <number>",
                description: "automod:AUTOMOD.CONFIG_STRIKES",
            },
            {
                trigger: "action <TIMEOUT|KICK|BAN>",
                description: "automod:AUTOMOD.CONFIG_ACTION",
            },
            {
                trigger: "debug <on|off>",
                description: "automod:AUTOMOD.CONFIG_DEBUG",
            },
            {
                trigger: "whitelist",
                description: "automod:AUTOMOD.CONFIG_WHITELIST_LIST",
            },
            {
                trigger: "whitelistadd <channel>",
                description: "automod:AUTOMOD.CONFIG_WHITELIST_ADD",
            },
            {
                trigger: "whitelistremove <channel>",
                description: "automod:AUTOMOD.CONFIG_WHITELIST_REM",
            },
            {
                trigger: "unlock",
                description: "automod:AUTOMOD.CONFIG_UNLOCK",
            },
        ],
    },
    slashCommand: {
        enabled: true,
        ephemeral: true,
        options: [
            {
                name: "status",
                description: "automod:AUTOMOD.CONFIG_STATUS",
                type: ApplicationCommandOptionType.Subcommand,
            },
            {
                name: "log",
                description: "automod:AUTOMOD.CONFIG_LOG",
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: "channel",
                        description: "automod:AUTOMOD.CONFIG_LOG_CHANNEL",
                        required: false,
                        type: ApplicationCommandOptionType.Channel,
                        channelTypes: [ChannelType.GuildText],
                    },
                ],
            },
            {
                name: "strikes",
                description: "automod:AUTOMOD.CONFIG_STRIKES",
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: "amount",
                        description: "automod:AUTOMOD.CONFIG_STRIKES_AMOUNT",
                        required: true,
                        type: ApplicationCommandOptionType.Integer,
                    },
                ],
            },
            {
                name: "action",
                description: "automod:AUTOMOD.CONFIG_ACTION",
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: "action",
                        description: "automod:AUTOMOD.CONFIG_ACTION_TYPE",
                        type: ApplicationCommandOptionType.String,
                        required: true,
                        choices: [
                            {
                                name: "TIMEOUT",
                                value: "TIMEOUT",
                            },
                            {
                                name: "KICK",
                                value: "KICK",
                            },
                            {
                                name: "BAN",
                                value: "BAN",
                            },
                        ],
                    },
                ],
            },
            {
                name: "debug",
                description: "automod:AUTOMOD.CONFIG_DEBUG",
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: "status",
                        description: "automod:AUTOMOD.CONFIG_DEBUG_STATUS",
                        required: true,
                        type: ApplicationCommandOptionType.String,
                        choices: [
                            {
                                name: "ON",
                                value: "ON",
                            },
                            {
                                name: "OFF",
                                value: "OFF",
                            },
                        ],
                    },
                ],
            },
            {
                name: "whitelist",
                description: "automod:AUTOMOD.CONFIG_WHITELIST_LIST",
                type: ApplicationCommandOptionType.Subcommand,
            },
            {
                name: "whitelistadd",
                description: "automod:AUTOMOD.CONFIG_WHITELIST_ADD",
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: "channel",
                        description: "automod:AUTOMOD.CONFIG_WHITELIST_ADD_CH",
                        required: true,
                        type: ApplicationCommandOptionType.Channel,
                        channelTypes: [ChannelType.GuildText],
                    },
                ],
            },
            {
                name: "whitelistremove",
                description: "automod:AUTOMOD.CONFIG_WHITELIST_REM",
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: "channel",
                        description: "automod:AUTOMOD.CONFIG_WHITELIST_REM_CH",
                        required: true,
                        type: ApplicationCommandOptionType.Channel,
                        channelTypes: [ChannelType.GuildText],
                    },
                ],
            },
            {
                name: "unlock",
                description: "automod:AUTOMOD.CONFIG_UNLOCK",
                type: ApplicationCommandOptionType.Subcommand,
            },
        ],
    },

    async messageRun({ message, args }) {
        const input = args[0].toLowerCase();
        const settings = await AutoModSettings.getSettings(message.guild.id);

        let response;
        if (input === "status") {
            response = await getStatus(settings, message.guild);
        } else if (input === "strikes") {
            const strikes = args[1];
            if (isNaN(strikes) || Number.parseInt(strikes) < 1) {
                return message.reply("Strikes must be a valid number greater than 0");
            }
            response = await setStrikes(settings, strikes, message.guild);
        } else if (input === "action") {
            const action = args[1].toUpperCase();
            if (!action || !["TIMEOUT", "KICK", "BAN"].includes(action))
                return message.reply("Not a valid action. Action can be `Timeout`/`Kick`/`Ban`");
            response = await setAction(settings, message.guild, action);
        } else if (input === "debug") {
            const status = args[1].toLowerCase();
            if (!["on", "off"].includes(status))
                return message.reply("Invalid status. Value must be `on/off`");
            response = await setDebug(settings, status, message.guild);
        }

        // log
        else if (input === "log") {
            if (args[1] === "off") response = await setChannel(null, settings, message.guild);
            else {
                const match = message.guild.findMatchingChannels(args[1]);
                if (!match.length) return message.reply(`No channel found matching ${args[1]}`);
                response = await setChannel(match[0], settings, message.guild);
            }
        }

        // whitelist
        else if (input === "whitelist") {
            response = getWhitelist(message.guild, settings);
        }

        // whitelist add
        else if (input === "whitelistadd") {
            const match = message.guild.findMatchingChannels(args[1]);
            if (!match.length) return message.reply(`No channel found matching ${args[1]}`);
            response = await whiteListAdd(settings, match[0].id, message.guild);
        }

        // whitelist remove
        else if (input === "whitelistremove") {
            const match = message.guild.findMatchingChannels(args[1]);
            if (!match.length) return message.reply(`No channel found matching ${args[1]}`);
            response = await whiteListRemove(settings, match[0].id, message.guild);
        }

        //
        else response = message.guild.getT("INVALID_SUBCOMMAND", { sub: input });
        await message.reply(response);
    },

    async interactionRun({ interaction }) {
        const sub = interaction.options.getSubcommand();
        const settings = await AutoModSettings.getSettings(interaction.guild.id);

        let response;

        if (sub === "status") {
            response = await getStatus(settings, interaction.guild);
        } else if (sub === "strikes") {
            response = await setStrikes(
                settings,
                interaction.options.getInteger("amount"),
                interaction.guild,
            );
        } else if (sub === "action") {
            response = await setAction(
                settings,
                interaction.guild,
                interaction.options.getString("action"),
            );
        } else if (sub === "debug") {
            response = await setDebug(
                settings,
                interaction.options.getString("status"),
                interaction.guild,
            );
        } else if (sub === "log") {
            const channel = interaction.options.getChannel("channel");
            response = await setChannel(channel, settings, interaction.guild);
        } else if (sub === "whitelist") {
            response = getWhitelist(interaction.guild, settings);
        } else if (sub === "whitelistadd") {
            const channelId = interaction.options.getChannel("channel").id;
            response = await whiteListAdd(settings, channelId, interaction.guild);
        } else if (sub === "whitelistremove") {
            const channelId = interaction.options.getChannel("channel").id;
            response = await whiteListRemove(settings, channelId, interaction.guild);
        } else if (sub === "unlock") {
            response = await unlockServer(settings, interaction.guild);
        } else response = interaction.guild.getT("INVALID_SUBCOMMAND", { sub });

        await interaction.followUp(response);
    },
};

async function getStatus(settings, guild) {
    const logChannel = settings.log_channel
        ? guild.channels.cache.get(settings.log_channel).toString()
        : "Not Configured";

    // String Builder
    let desc = stripIndent`
    ❯ **${guild.getT("automod:AUTOMOD.STATUS_EMBED_MAXLINES")}**: ${settings.max_lines || "NA"}
    ❯ **${guild.getT("automod:AUTOMOD.STATUS_EMBED_MASSMENTION")}**: ${settings.anti_massmention ? "✓" : "✕"}
    ❯ **${guild.getT("automod:AUTOMOD.STATUS_EMBED_ATTACH")}**: ${settings.anti_attachments ? "✓" : "✕"}
    ❯ **${guild.getT("automod:AUTOMOD.STATUS_EMBED_LINKS")}**: ${settings.anti_links ? "✓" : "✕"}
    ❯ **${guild.getT("automod:AUTOMOD.STATUS_EMBED_INVITE")}**: ${settings.anti_invites ? "✓" : "✕"}
    ❯ **${guild.getT("automod:AUTOMOD.STATUS_EMBED_SPAM")}**: ${settings.anti_spam ? "✓" : "✕"}
    ❯ **${guild.getT("automod:AUTOMOD.STATUS_EMBED_GHOSTPING")}**: ${settings.anti_ghostping ? "✓" : "✕"}
  `;

    const embed = EmbedUtils.embed({ description: desc })
        .setAuthor({
            name: guild.getT("automod:AUTOMOD.STATUS_EMBED_TITLE"),
            iconURL: guild.iconURL(),
        })
        .addFields(
            {
                name: guild.getT("automod:AUTOMOD.STATUS_EMBED_LOG"),
                value: logChannel,
                inline: true,
            },
            {
                name: guild.getT("automod:AUTOMOD.STATUS_EMBED_STRIKES"),
                value: settings.max_strikes.toString(),
                inline: true,
            },
            {
                name: guild.getT("automod:AUTOMOD.STATUS_EMBED_ACTION"),
                value: settings.action,
                inline: true,
            },
            {
                name: guild.getT("automod:AUTOMOD.STATUS_EMBED_DEBUG"),
                value: settings.debug_mode ? "✓" : "✕",
                inline: true,
            },
        );

    return { embeds: [embed] };
}

async function setStrikes(settings, strikes, guild) {
    await AutoModSettings.updateSettings(guild.id, { max_strikes: strikes });
    return guild.getT("automod:AUTOMOD.STRIKES_SET", { amount: strikes });
}

async function setAction(settings, guild, action) {
    if (action === "TIMEOUT") {
        if (!guild.members.me.permissions.has("ModerateMembers")) {
            return guild.getT("automod:AUTOMOD.TIMEOUT_NO_PERMS");
        }
    }

    if (action === "KICK") {
        if (!guild.members.me.permissions.has("KickMembers")) {
            return guild.getT("automod:AUTOMOD.KICK_NO_PERMS");
        }
    }

    if (action === "BAN") {
        if (!guild.members.me.permissions.has("BanMembers")) {
            guild.getT("automod:AUTOMOD.BAN_NO_PERMS");
        }
    }

    await AutoModSettings.updateSettings(guild.id, { action: action });
    return guild.getT("automod:AUTOMOD.ACTION_SET", { action });
}

async function setDebug(settings, input, guild) {
    const status = input.toLowerCase() === "on" ? true : false;
    await AutoModSettings.updateSettings(guild.id, { debug_mode: status });
    return status
        ? guild.getT("automod:AUTOMOD.DEBUG_ENABLED")
        : guild.getT("automod:AUTOMOD.DEBUG_DISABLED");
}

async function setChannel(targetChannel, settings, guild) {
    if (!targetChannel && !settings.log_channel) {
        return guild.getT("automod:AUTOMOD.LOG_CHANNEL_DISABLED");
    }

    if (targetChannel && !guild.canSendEmbeds(targetChannel)) {
        return guild.getT("automod:AUTOMOD.LOG_CHANNEL_NO_PERMS");
    }

    await AutoModSettings.updateSettings(guild.id, { log_channel: targetChannel?.id || null });
    return targetChannel
        ? guild.getT("automod:AUTOMOD.LOG_CHANNEL_SET", { channel: targetChannel.toString() })
        : guild.getT("automod:AUTOMOD.LOG_CHANNEL_RESET");
}

function getWhitelist(guild, settings) {
    const whitelist = settings.whitelisted_channels;
    if (!whitelist || !whitelist.length) return guild.getT("automod:AUTOMOD.WHITELIST_NONE");

    const channels = [];
    for (const channelId of whitelist) {
        const channel = guild.channels.cache.get(channelId);
        if (!channel) continue;
        channels.push(channel.toString());
    }

    return guild.getT("automod:AUTOMOD.WHITELIST_LIST", { channels: channels.join(", ") });
}

async function whiteListAdd(settings, channelId, guild) {
    if (settings.whitelisted_channels.includes(channelId))
        return guild.getT("automod:AUTOMOD.WHITELIST_ALREADY");
    const updated = [...settings.whitelisted_channels, channelId];
    await AutoModSettings.updateSettings(guild.id, { whitelisted_channels: updated });
    return guild.getT("automod:AUTOMOD.WHITELIST_ADDED");
}

async function whiteListRemove(settings, channelId, guild) {
    if (!settings.whitelisted_channels.includes(channelId))
        return guild.getT("automod:AUTOMOD.WHITELIST_NOT");
    const updated = settings.whitelisted_channels.filter(id => id !== channelId);
    await AutoModSettings.updateSettings(guild.id, { whitelisted_channels: updated });
    return guild.getT("automod:AUTOMOD.WHITELIST_REMOVED");
}

async function unlockServer(settings, guild) {
    const Logger = require("dunebot-core").ServiceManager.get("Logger");
    
    if (!settings.raid_lockdown_active) {
        return guild.getT("automod:AUTOMOD.UNLOCK_NOT_LOCKED");
    }
    
    try {
        // Import deactivateLockdown dynamisch
        const { deactivateLockdown } = require('../events/guildMemberAdd');
        
        await deactivateLockdown(guild);
        
        Logger.info(`[AutoMod] Lockdown manuell deaktiviert für Guild ${guild.id} via Command`);
        return guild.getT("automod:AUTOMOD.UNLOCK_SUCCESS");
    } catch (err) {
        Logger.error(`[AutoMod] Fehler beim Deaktivieren des Lockdowns:`, err);
        return guild.getT("automod:AUTOMOD.UNLOCK_ERROR", { error: err.message });
    }
}
