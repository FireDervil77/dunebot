const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
} = require("discord.js");
const ShortUniqueId = require("short-unique-id");
const uid = new ShortUniqueId({ length: 8 });
const { ServiceManager } = require("dunebot-core");
const { TicketSettings, TicketCategories, Tickets } = require("../shared/models");
const CLOSE_PERMS = ["ManageChannels", "ReadMessageHistory"];

const genTicketId = () => uid.rnd();

/**
 * @param {string} content
 * @param {Object} data
 */
const parse = (content, data) => {
    for (const key in data) {
        content = content.replace(new RegExp(`{${key}}`, "g"), data[key]);
    }
    return content;
};

/**
 * @param {import('discord.js').Channel} channel
 */
function isTicketChannel(channel) {
    return (
        channel.type === ChannelType.GuildText &&
        channel.name.startsWith("tіcket-") &&
        channel.topic &&
        channel.topic.includes(" | ")
    );
}

/**
 * @param {import('discord.js').Guild} guild
 */
function getTicketChannels(guild) {
    return guild.channels.cache.filter((ch) => isTicketChannel(ch));
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {string} userId
 */
function getExistingTicketChannel(guild, userId) {
    const tktChannels = getTicketChannels(guild);
    return tktChannels.filter((ch) => ch.topic.split("|")[1] === userId).first();
}

/**
 * @param {import('discord.js').BaseGuildTextChannel} channel
 */
async function parseTicketDetails(channel) {
    if (!channel.topic) return;
    const split = channel.topic?.split(" | ");
    const ticketId = split[0];
    const userId = split[1].match(/\d+/)[0];
    const user = await channel.client.users.fetch(userId, { cache: false }).catch(() => {});
    return { ticketId, user };
}

/**
 * @param {import('discord.js').BaseGuildTextChannel} channel
 * @param {import('discord.js').User} closedBy
 * @param {string} [reason]
 */
async function closeTicket(channel, closedBy, reason) {
    if (!channel.deletable || !channel.permissionsFor(channel.guild.members.me).has(CLOSE_PERMS)) {
        return "MISSING_PERMISSIONS";
    }
    const Logger = ServiceManager.get("Logger");
    const guild = channel.guild;

    try {
        const settings = await TicketSettings.getSettings(guild.id);
        const messages = await channel.messages.fetch();

        const transcript = Array.from(messages.values())
            .reverse()
            .map((m) => ({
                author: m.author.username,
                content: m.cleanContent,
                embeds: m.embeds.map((e) => e.toJSON()),
                timestamp: m.createdAt,
                bot: m.author.bot,
                attachments: m.attachments.map((att) => ({
                    name: att.name,
                    description: att.description,
                    url: att.proxyURL,
                })),
            }));

        const ticketDetails = await parseTicketDetails(channel);

        const ticketRecord = await Tickets.close(
            guild.id,
            ticketDetails.ticketId,
            closedBy.id,
            reason || "",
            transcript,
        );

        if (channel.deletable) await channel.delete();

        // send embed to log channel
        if (settings.log_channel) {
            const logChannel = guild.channels.cache.get(settings.log_channel);
            if (logChannel) {
                const embed = new EmbedBuilder()
                    .setAuthor({ name: guild.getT("ticket:HANDLER.CLOSE_LOG_EMBED_TITLE") })
                    .setColor(settings.embed_color_close || "#068ADD")
                    .setFields([
                        {
                            name: guild.getT("ticket:HANDLER.CLOSE_LOG_EMBED_OPENED"),
                            value: ticketDetails.user ? ticketDetails.user.username : "Unknown",
                            inline: true,
                        },
                        {
                            name: guild.getT("ticket:HANDLER.CLOSE_LOG_EMBED_CLOSED"),
                            value: closedBy ? closedBy.username : "Unknown",
                            inline: true,
                        },
                        {
                            name: guild.getT("ticket:HANDLER.CLOSE_LOG_EMBED_REASON"),
                            value: reason || "NA",
                            inline: true,
                        },
                        {
                            name: guild.getT("ticket:HANDLER.CATEGORY_LABEL"),
                            value: ticketRecord?.category_name || "Default",
                            inline: true,
                        },
                        {
                            name: guild.getT("ticket:HANDLER.TICKET_ID"),
                            value: ticketDetails.ticketId,
                            inline: true,
                        },
                    ]);

                const reopenRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel(guild.getT("ticket:HANDLER.REOPEN_BTN"))
                        .setCustomId(`ticket:REOPEN:${ticketDetails.ticketId}`)
                        .setEmoji("🔓")
                        .setStyle(ButtonStyle.Secondary),
                );

                logChannel.send({ embeds: [embed], components: [reopenRow] }).catch(() => {});
            }
        }

        // send embed to user
        if (ticketDetails.user) {
            const fields = [
                {
                    name: guild.getT("ticket:HANDLER.SERVER_LABEL"),
                    value: guild.name,
                    inline: false,
                },
                {
                    name: guild.getT("ticket:HANDLER.CATEGORY_LABEL"),
                    value: ticketRecord?.category_name || "Default",
                    inline: true,
                },
                {
                    name: guild.getT("ticket:HANDLER.TICKET_ID"),
                    value: ticketDetails.ticketId,
                    inline: true,
                },
                {
                    name: guild.getT("ticket:HANDLER.CLOSE_LOG_EMBED_CLOSED"),
                    value: closedBy ? closedBy.username : "Unknown",
                    inline: true,
                },
            ];

            if (reason) {
                fields.push({
                    name: guild.getT("ticket:HANDLER.CLOSE_LOG_EMBED_REASON"),
                    value: reason,
                    inline: false,
                });
            }

            const dmEmbed = new EmbedBuilder()
                .setAuthor({ name: guild.getT("ticket:HANDLER.CLOSE_LOG_EMBED_TITLE") })
                .setColor(settings.embed_color_close || "#068ADD")
                .setFields(fields)
                .setThumbnail(guild.iconURL());

            ticketDetails.user.send({ embeds: [dmEmbed] }).catch(() => {});
        }

        return "SUCCESS";
    } catch (ex) {
        Logger.error("closeTicket", ex);
        return "ERROR";
    }
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').User} author
 */
async function closeAllTickets(guild, author) {
    const channels = getTicketChannels(guild);
    let success = 0;
    let failed = 0;

    for (const ch of channels) {
        const status = await closeTicket(
            ch[1],
            author,
            guild.getT("ticket:HANDLER.CLOSE_ALL_REASON"),
        );
        if (status === "SUCCESS") success += 1;
        else failed += 1;
    }

    return [success, failed];
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').User} reopenedBy
 * @param {string} ticketId
 */
async function reopenTicket(guild, reopenedBy, ticketId) {
    const Logger = ServiceManager.get("Logger");
    try {
        const ticket = await Tickets.getByTicketId(guild.id, ticketId);
        if (!ticket) return "NOT_FOUND";
        if (ticket.status === "open") return "ALREADY_OPEN";

        const settings = await TicketSettings.getSettings(guild.id);

        // Restore permissions based on category
        let category = null;
        if (ticket.category_id) {
            category = await TicketCategories.getById(ticket.category_id, guild.id);
        }

        const createdByUser = await guild.client.users.fetch(ticket.created_by).catch(() => null);

        const permissionOverwrites = [
            { id: guild.roles.everyone, deny: ["ViewChannel"] },
            { id: ticket.created_by, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
            { id: guild.members.me.roles.highest.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
        ];

        if (category) {
            category.staff_roles?.forEach((roleId) => {
                const role = guild.roles.cache.get(roleId);
                if (!role) return;
                permissionOverwrites.push({
                    id: role,
                    allow: ["ViewChannel", "SendMessages", "ReadMessageHistory", "ManageChannels"],
                });
            });
            category.member_roles?.forEach((roleId) => {
                const role = guild.roles.cache.get(roleId);
                if (!role) return;
                permissionOverwrites.push({
                    id: role,
                    allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"],
                });
            });
        }

        // Find or create parent
        let parentId = category?.parent_id || null;
        if (!parentId) {
            const catName = ticket.category_name || "Default";
            const parent = guild.channels.cache.find(
                (c) => c.type === ChannelType.GuildCategory && c.name === `tіckets-${catName}`,
            );
            if (parent) parentId = parent.id;
        }

        // Create new channel
        const tktChannel = await guild.channels.create({
            name: `tіcket-reopened-${ticketId}`,
            type: ChannelType.GuildText,
            topic: ticketId + " | " + (createdByUser ? createdByUser.toString() : `<@${ticket.created_by}>`),
            parent: parentId ? guild.channels.cache.get(parentId) : null,
            permissionOverwrites,
        });

        // Update DB
        await Tickets.reopen(guild.id, ticketId, reopenedBy.id, tktChannel.id);

        // Send reopened embed
        const reopenEmbed = new EmbedBuilder()
            .setColor("#4CAF50")
            .setAuthor({ name: guild.getT("ticket:HANDLER.REOPEN_LOG_TITLE") })
            .setDescription(guild.getT("ticket:HANDLER.REOPEN_MSG", { user: reopenedBy.toString() }));

        const btnRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel(guild.getT("ticket:HANDLER.OPEN_CLOSE_BTN"))
                .setCustomId("ticket:CLOSE")
                .setEmoji("🔒")
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setLabel(guild.getT("ticket:HANDLER.CLAIM_BTN"))
                .setCustomId("ticket:CLAIM")
                .setEmoji("📥")
                .setStyle(ButtonStyle.Success),
        );

        await tktChannel.send({
            content: createdByUser ? createdByUser.toString() : `<@${ticket.created_by}>`,
            embeds: [reopenEmbed],
            components: [btnRow],
        });

        // Log
        if (settings.log_channel) {
            const logChannel = guild.channels.cache.get(settings.log_channel);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setColor("#4CAF50")
                    .setAuthor({ name: guild.getT("ticket:HANDLER.REOPEN_LOG_TITLE") })
                    .setFields([
                        { name: guild.getT("ticket:HANDLER.TICKET_ID"), value: ticketId, inline: true },
                        { name: guild.getT("ticket:HANDLER.REOPEN_LABEL"), value: reopenedBy.toString(), inline: true },
                    ]);

                const chBtnRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel(guild.getT("ticket:HANDLER.OPEN_LOG_BTN"))
                        .setURL(tktChannel.url)
                        .setStyle(ButtonStyle.Link),
                );

                logChannel.send({ embeds: [logEmbed], components: [chBtnRow] }).catch(() => {});
            }
        }

        // DM the ticket owner
        if (createdByUser) {
            const dmEmbed = new EmbedBuilder()
                .setColor("#4CAF50")
                .setAuthor({ name: guild.getT("ticket:HANDLER.REOPEN_LOG_TITLE") })
                .setDescription(guild.getT("ticket:HANDLER.REOPEN_DM", { server: guild.name }))
                .setThumbnail(guild.iconURL());

            const chBtnRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel(guild.getT("ticket:HANDLER.OPEN_LOG_BTN"))
                    .setURL(tktChannel.url)
                    .setStyle(ButtonStyle.Link),
            );

            createdByUser.send({ embeds: [dmEmbed], components: [chBtnRow] }).catch(() => {});
        }

        return "SUCCESS";
    } catch (ex) {
        Logger.error("reopenTicket", ex);
        return "ERROR";
    }
}

module.exports = {
    genTicketId,
    parse,
    getTicketChannels,
    getExistingTicketChannel,
    isTicketChannel,
    parseTicketDetails,
    closeTicket,
    closeAllTickets,
    reopenTicket,
};
