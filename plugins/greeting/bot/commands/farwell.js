const { ApplicationCommandOptionType, ChannelType } = require("discord.js");
const { MiscUtils } = require("dunebot-sdk/utils");
const { buildGreeting } = require("../utils");
const { ServiceManager } = require('dunebot-core');

/**
 * Parse JSON embed data from database
 * @param {string|object} embedData 
 * @returns {object}
 */
function parseEmbedData(embedData) {
    if (!embedData) return {};
    if (typeof embedData === 'string') {
        try {
            return JSON.parse(embedData);
        } catch (err) {
            return {};
        }
    }
    return embedData;
}

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: "farewell",
    description: "greeting:FAREWELL.DESCRIPTION",
    userPermissions: ["ManageGuild"],
    command: {
        enabled: true,
        minArgsCount: 1,
        subcommands: [
            {
                trigger: "status <on|off>",
                description: "greeting:FAREWELL.SUB_STATUS",
            },
            {
                trigger: "channel <#channel>",
                description: "greeting:FAREWELL.SUB_CHANNEL",
            },
            {
                trigger: "preview",
                description: "greeting:FAREWELL.SUB_PREVIEW",
            },
            {
                trigger: "desc <text>",
                description: "greeting:FAREWELL.SUB_DESC",
            },
            {
                trigger: "thumbnail <ON|OFF>",
                description: "greeting:FAREWELL.SUB_THUMBNAIL",
            },
            {
                trigger: "color <hexcolor>",
                description: "greeting:FAREWELL.SUB_COLOR",
            },
            {
                trigger: "footer <text>",
                description: "greeting:FAREWELL.SUB_FOOTER",
            },
            {
                trigger: "image <url>",
                description: "greeting:FAREWELL.SUB_IMAGE",
            },
        ],
    },
    slashCommand: {
        enabled: true,
        ephemeral: true,
        options: [
            {
                name: "status",
                description: "greeting:FAREWELL.SUB_STATUS",
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: "status",
                        description: "greeting:FAREWELL.SUB_STATUS_STATUS",
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
                name: "preview",
                description: "greeting:FAREWELL.SUB_PREVIEW",
                type: ApplicationCommandOptionType.Subcommand,
            },
            {
                name: "message",
                description: "greeting:FAREWELL.SUB_MSG",
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: "channel",
                        description: "greeting:FAREWELL.SUB_MSG_CHANNEL",
                        type: ApplicationCommandOptionType.Channel,
                        channelTypes: [ChannelType.GuildText],
                        required: true,
                    },
                    {
                        name: "description",
                        description: "greeting:FAREWELL.SUB_MSG_DESC",
                        type: ApplicationCommandOptionType.String,
                        required: true,
                    },
                    {
                        name: "status",
                        description: "greeting:FAREWELL.SUB_MSG_THUMBNAIL",
                        type: ApplicationCommandOptionType.String,
                        required: true,
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
                    {
                        name: "hex-code",
                        description: "greeting:FAREWELL.SUB_MSG_COLOR",
                        type: ApplicationCommandOptionType.String,
                        required: false,
                    },
                    {
                        name: "footer",
                        description: "greeting:FAREWELL.SUB_MSG_FOOTER",
                        type: ApplicationCommandOptionType.String,
                        required: false,
                    },
                    {
                        name: "url",
                        description: "greeting:FAREWELL.SUB_MSG_IMAGE",
                        type: ApplicationCommandOptionType.String,
                        required: false,
                    },
                ],
            },
        ],
    },

    async messageRun({ message, args }) {
        const dbService = ServiceManager.get('dbService');
        const rows = await dbService.query(
            'SELECT * FROM greeting_settings WHERE guild_id = ?',
            [message.guild.id]
        );
        const settings = rows?.[0] || {};
        
        const type = args[0].toLowerCase();
        let response;

        // preview
        if (type === "preview") {
            response = await sendPreview(settings, message.member, message.guild);
        }

        // status
        else if (type === "status") {
            const status = args[1]?.toUpperCase();
            if (!status || !["ON", "OFF"].includes(status))
                return message.replyT("greeting:FAREWELL.INVALID_THUMBNAIL");
            response = await setStatus(settings, status, message.guild);
        }

        // channel
        else if (type === "channel") {
            const channel = message.mentions.channels.first();
            response = await setChannel(settings, channel, message.guild);
        }

        // desc
        else if (type === "desc") {
            if (args.length < 2) return message.replyT("greeting:FAREWELL.INVALID_CONTENT");
            const desc = args.slice(1).join(" ");
            response = await setDescription(settings, desc, message.guild);
        }

        // thumbnail
        else if (type === "thumbnail") {
            const status = args[1]?.toUpperCase();
            if (!status || !["ON", "OFF"].includes(status))
                return message.replyT("greeting:FAREWELL.INVALID_THUMBNAIL");
            response = await setThumbnail(settings, status, message.guild);
        }

        // color
        else if (type === "color") {
            response = await setColor(settings, args[1], message.guild);
        }

        // footer
        else if (type === "footer") {
            if (args.length < 2) return message.replyT("greeting:FAREWELL.INVALID_CONTENT");
            const content = args.slice(1).join(" ");
            response = await setFooter(settings, content, message.guild);
        }

        // image
        else if (type === "image") {
            const url = args[1];
            if (!url) return message.replyT("greeting:FAREWELL.INVALID_IMAGE");
            response = await setImage(settings, url, message.guild);
        }

        //
        else response = message.guild.getT("INVALID_SUBCOMMAND", { sub: type });
        return message.reply(response);
    },

    async interactionRun({ interaction }) {
        const dbService = ServiceManager.get('dbService');
        const rows = await dbService.query(
            'SELECT * FROM greeting_settings WHERE guild_id = ?',
            [interaction.guild.id]
        );
        const settings = rows?.[0] || {};
        
        const sub = interaction.options.getSubcommand();

        let response;
        switch (sub) {
            case "preview":
                response = await sendPreview(settings, interaction.member, interaction.guild);
                break;

            case "status":
                response = await setStatus(
                    settings,
                    interaction.options.getString("status"),
                    interaction.guild,
                );
                break;

            case "message":
                response = await setMessage(settings, interaction);
                break;

            default:
                response = interaction.guild.getT("INVALID_SUBCOMMAND", { sub });
        }

        return interaction.followUp(response);
    },
};

async function sendPreview(settings, member, guild) {
    if (!settings || !settings.farewell_enabled) {
        return guild.getT("greeting:FAREWELL.FAREWELL_DISABLED");
    }

    const targetChannel = member.guild.channels.cache.get(settings.farewell_channel);
    if (!targetChannel) return guild.getT("greeting:FAREWELL.CHANNEL_NOT_CONFIG");

    // Build farewell config object
    const farewellConfig = {
        enabled: settings.farewell_enabled,
        channel: settings.farewell_channel,
        content: settings.farewell_content,
        embed: parseEmbedData(settings.farewell_embed)
    };

    const response = await buildGreeting(member, "FAREWELL", farewellConfig);
    await targetChannel.send(response);

    return guild.getT("greeting:FAREWELL.PREVIEW_SENT", {
        channel: targetChannel.toString(),
    });
}

async function setStatus(settings, status, guild) {
    const dbService = ServiceManager.get('dbService');
    const enabled = status.toUpperCase() === "ON";
    
    await dbService.query(
        'INSERT INTO greeting_settings (guild_id, farewell_enabled) VALUES (?, ?) ON DUPLICATE KEY UPDATE farewell_enabled = ?',
        [guild.id, enabled, enabled]
    );
    
    return enabled
        ? guild.getT("greeting:FAREWELL.ENABLED")
        : guild.getT("greeting:FAREWELL.DISABLED");
}

async function setChannel(settings, channel, guild) {
    if (!guild.members.me.permissionsIn(channel).has(['SendMessages', 'EmbedLinks'])) {
        return guild.getT("greeting:FAREWELL.CHANNEL_NO_PERMS", {
            channel: channel.toString(),
        });
    }
    
    const dbService = ServiceManager.get('dbService');
    await dbService.query(
        'INSERT INTO greeting_settings (guild_id, farewell_channel) VALUES (?, ?) ON DUPLICATE KEY UPDATE farewell_channel = ?',
        [guild.id, channel.id, channel.id]
    );
    
    return guild.getT("greeting:FAREWELL.CHANNEL_SET", {
        channel: channel.toString(),
    });
}

async function setDescription(settings, desc, guild) {
    const dbService = ServiceManager.get('dbService');
    const embedData = parseEmbedData(settings.farewell_embed);
    embedData.description = desc;
    
    await dbService.query(
        'INSERT INTO greeting_settings (guild_id, farewell_embed) VALUES (?, ?) ON DUPLICATE KEY UPDATE farewell_embed = ?',
        [guild.id, JSON.stringify(embedData), JSON.stringify(embedData)]
    );
    
    return guild.getT("greeting:FAREWELL.CONFIG_UPDATED");
}

async function setThumbnail(settings, status, guild) {
    const dbService = ServiceManager.get('dbService');
    const embedData = parseEmbedData(settings.farewell_embed);
    embedData.thumbnail = status.toUpperCase() === "ON";
    
    await dbService.query(
        'INSERT INTO greeting_settings (guild_id, farewell_embed) VALUES (?, ?) ON DUPLICATE KEY UPDATE farewell_embed = ?',
        [guild.id, JSON.stringify(embedData), JSON.stringify(embedData)]
    );
    
    return guild.getT("greeting:FAREWELL.CONFIG_UPDATED");
}

async function setColor(settings, color, guild) {
    if (!color || !MiscUtils.isHex(color)) return guild.getT("greeting:FAREWELL.INVALID_COLOR");
    
    const dbService = ServiceManager.get('dbService');
    const embedData = parseEmbedData(settings.farewell_embed);
    embedData.color = color;
    
    await dbService.query(
        'INSERT INTO greeting_settings (guild_id, farewell_embed) VALUES (?, ?) ON DUPLICATE KEY UPDATE farewell_embed = ?',
        [guild.id, JSON.stringify(embedData), JSON.stringify(embedData)]
    );
    
    return guild.getT("greeting:FAREWELL.CONFIG_UPDATED");
}

async function setFooter(settings, content, guild) {
    const dbService = ServiceManager.get('dbService');
    const embedData = parseEmbedData(settings.farewell_embed);
    embedData.footer = { text: content };
    
    await dbService.query(
        'INSERT INTO greeting_settings (guild_id, farewell_embed) VALUES (?, ?) ON DUPLICATE KEY UPDATE farewell_embed = ?',
        [guild.id, JSON.stringify(embedData), JSON.stringify(embedData)]
    );
    
    return guild.getT("greeting:FAREWELL.CONFIG_UPDATED");
}

async function setImage(settings, url, guild) {
    const dbService = ServiceManager.get('dbService');
    const embedData = parseEmbedData(settings.farewell_embed);
    embedData.image = url;
    
    await dbService.query(
        'INSERT INTO greeting_settings (guild_id, farewell_embed) VALUES (?, ?) ON DUPLICATE KEY UPDATE farewell_embed = ?',
        [guild.id, JSON.stringify(embedData), JSON.stringify(embedData)]
    );
    
    return guild.getT("greeting:FAREWELL.CONFIG_UPDATED");
}

async function setMessage(settings, interaction) {
    const channel = interaction.guild.channels.cache.get(
        interaction.options.getChannel("channel").id,
    );
    const status = interaction.options.getString("status") === "ON";
    const color = interaction.options.getString("hex-code");
    const footer = interaction.options.getString("footer");
    const url = interaction.options.getString("url");
    const desc = interaction.options.getString("description");

    const { guild } = interaction;

    if (!guild.members.me.permissionsIn(channel).has(['SendMessages', 'EmbedLinks'])) {
        return guild.getT("greeting:FAREWELL.CHANNEL_NO_PERMS", {
            channel: channel.toString(),
        });
    }

    if (color && !MiscUtils.isHex(color)) return guild.getT("greeting:FAREWELL.INVALID_COLOR");

    const dbService = ServiceManager.get('dbService');
    const embedData = parseEmbedData(settings.farewell_embed);
    embedData.description = desc;
    embedData.thumbnail = status;
    if (color) embedData.color = color;
    if (footer) embedData.footer = { text: footer };
    if (url) embedData.image = url;

    await dbService.query(
        `INSERT INTO greeting_settings (guild_id, farewell_enabled, farewell_channel, farewell_embed) 
         VALUES (?, TRUE, ?, ?) 
         ON DUPLICATE KEY UPDATE 
            farewell_enabled = TRUE,
            farewell_channel = ?,
            farewell_embed = ?`,
        [guild.id, channel.id, JSON.stringify(embedData), channel.id, JSON.stringify(embedData)]
    );

    return guild.getT("greeting:FAREWELL.CONFIG_SAVED", {
        channel: channel.toString(),
    });
}
