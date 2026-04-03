const { purgeMessages } = require("../../utils");
const { ApplicationCommandOptionType, ChannelType } = require("discord.js");

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: "purge",
    description: "moderation:PURGE.DESCRIPTION",
    userPermissions: ["ManageMessages"],
    botPermissions: ["ManageMessages", "ReadMessageHistory"],
    command: {
        enabled: true,
        usage: "<amount>",
        minArgsCount: 1,
    },
    slashCommand: {
        enabled: true,
        ephemeral: true,
        options: [
            {
                name: "all",
                description: "moderation:PURGE.SUB_ALL_DESC",
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: "channel",
                        description: "moderation:PURGE.SUB_COMMON_CHANNEL",
                        type: ApplicationCommandOptionType.Channel,
                        channelTypes: [ChannelType.GuildText],
                        required: true,
                    },
                    {
                        name: "amount",
                        description: "moderation:PURGE.SUB_COMMON_AMOUNT",
                        type: ApplicationCommandOptionType.Integer,
                        required: false,
                    },
                ],
            },
            {
                name: "attachments",
                description: "moderation:PURGE.SUB_ATTACH_DESC",
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: "channel",
                        description: "moderation:PURGE.SUB_COMMON_CHANNEL",
                        type: ApplicationCommandOptionType.Channel,
                        channelTypes: [ChannelType.GuildText],
                        required: true,
                    },
                    {
                        name: "amount",
                        description: "moderation:PURGE.SUB_COMMON_AMOUNT",
                        type: ApplicationCommandOptionType.Integer,
                        required: false,
                    },
                ],
            },
            {
                name: "bots",
                description: "moderation:PURGE.SUB_BOT_DESC",
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: "channel",
                        description: "moderation:PURGE.SUB_COMMON_CHANNEL",
                        type: ApplicationCommandOptionType.Channel,
                        channelTypes: [ChannelType.GuildText],
                        required: true,
                    },
                    {
                        name: "amount",
                        description: "moderation:PURGE.SUB_COMMON_AMOUNT",
                        type: ApplicationCommandOptionType.Integer,
                        required: false,
                    },
                ],
            },
            {
                name: "links",
                description: "moderation:PURGE.SUB_LINK_DESC",
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: "channel",
                        description: "moderation:PURGE.SUB_COMMON_CHANNEL",
                        type: ApplicationCommandOptionType.Channel,
                        channelTypes: [ChannelType.GuildText],
                        required: true,
                    },
                    {
                        name: "amount",
                        description: "moderation:PURGE.SUB_COMMON_AMOUNT",
                        type: ApplicationCommandOptionType.Integer,
                        required: false,
                    },
                ],
            },
            {
                name: "token",
                description: "moderation:PURGE.SUB_TOKEN_DESC",
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: "channel",
                        description: "moderation:PURGE.SUB_COMMON_CHANNEL",
                        type: ApplicationCommandOptionType.Channel,
                        channelTypes: [ChannelType.GuildText],
                        required: true,
                    },
                    {
                        name: "token",
                        description: "moderation:PURGE.SUB_TOKEN_TOKEN",
                        type: ApplicationCommandOptionType.String,
                        required: true,
                    },
                    {
                        name: "amount",
                        description: "moderation:PURGE.SUB_COMMON_AMOUNT",
                        type: ApplicationCommandOptionType.Integer,
                        required: false,
                    },
                ],
            },
            {
                name: "user",
                description: "moderation:PURGE.SUB_USER_DESC",
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: "channel",
                        description: "moderation:PURGE.SUB_COMMON_CHANNEL",
                        type: ApplicationCommandOptionType.Channel,
                        channelTypes: [ChannelType.GuildText],
                        required: true,
                    },
                    {
                        name: "user",
                        description: "moderation:PURGE.SUB_USER_USER",
                        type: ApplicationCommandOptionType.User,
                        required: true,
                    },
                    {
                        name: "amount",
                        description: "moderation:PURGE.SUB_COMMON_AMOUNT",
                        type: ApplicationCommandOptionType.Integer,
                        required: false,
                    },
                ],
            },
        ],
    },

    async messageRun({ message, args }) {
        const amount = args[0];

        if (isNaN(amount)) return message.replyT("moderation:PURGE.INVALID_AMOUNT");
        if (parseInt(amount) > 99) return message.replyT("moderation:PURGE.TOO_MANY_MESSAGES");

        const { channel, guild } = message;
        const response = await purgeMessages(message.member, channel, "ALL", amount);

        if (typeof response === "number") {
            return channel.send(guild.getT("moderation:PURGE.SUCCESS", { amount: response, channel: channel.toString() }));
        } else if (response === "BOT_PERM") {
            return message.reply(guild.getT("moderation:PURGE.BOT_PERM", { channel }), 5);
        } else if (response === "MEMBER_PERM") {
            return message.reply(guild.getT("moderation:PURGE.MEMBER_PERM", { channel }), 5);
        } else if (response === "NO_MESSAGES") {
            return channel.send(guild.getT("moderation:PURGE.NO_MESSAGES"), 5);
        } else {
            return message.replyT("moderation:PURGE.ERROR");
        }
    },

    async interactionRun({ interaction }) {
        const { options, member } = interaction;

        const sub = options.getSubcommand();
        const channelOption = options.getChannel("channel");
        const channel = interaction.guild.channels.cache.get(channelOption.id) || channelOption;
        const amount = options.getInteger("amount") || 99;

        if (amount > 100) return interaction.followUpT("moderation:PURGE.TOO_MANY_MESSAGES");

        let response;
        switch (sub) {
            case "all":
                response = await purgeMessages(member, channel, "ALL", amount);
                break;

            case "attachments":
                response = await purgeMessages(member, channel, "ATTACHMENT", amount);
                break;

            case "bots":
                response = await purgeMessages(member, channel, "BOT", amount);
                break;

            case "links":
                response = await purgeMessages(member, channel, "LINK", amount);
                break;

            case "token": {
                const token = interaction.options.getString("token");
                response = await purgeMessages(member, channel, "TOKEN", amount, token);
                break;
            }

            case "user": {
                const user = interaction.options.getUser("user");
                response = await purgeMessages(member, channel, "USER", amount, user.id);
                break;
            }

            default:
                return interaction.followUp("Oops! Not a valid command selection");
        }

        // Success
        if (typeof response === "number") {
            return interaction.followUpT("moderation:PURGE.SUCCESS", { amount: response, channel: `<#${channel.id}>` });
        }

        // Member missing permissions
        else if (response === "MEMBER_PERM") {
            return interaction.followUpT("moderation:PURGE.MEMBER_PERM", { channel });
        }

        // Bot missing permissions
        else if (response === "BOT_PERM") {
            return interaction.followUpT("moderation:PURGE.BOT_PERM", { channel });
        }

        // No messages
        else if (response === "NO_MESSAGES") {
            return interaction.followUpT("moderation:PURGE.NO_MESSAGES");
        }

        // Remaining
        else {
            return interaction.followUpT("moderation:PURGE.ERROR");
        }
    },
};
