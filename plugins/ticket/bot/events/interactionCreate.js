const {
    getExistingTicketChannel,
    getTicketChannels,
    closeTicket,
    parse,
    genTicketId,
    reopenTicket,
} = require("../utils");
const {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ComponentType,
    ChannelType,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");
const { ServiceManager } = require("dunebot-core");
const { TicketSettings, TicketCategories, Tickets } = require("../../shared/models");

const OPEN_PERMS = ["ManageChannels"];

/**
 * @param {import('discord.js').BaseInteraction} interaction
 */
module.exports = async (interaction) => {
    if (!interaction.isButton()) return;
    const Logger = ServiceManager.get("Logger");

    //  Ticket Open Button
    if (interaction.customId === "ticket:CREATE") {
        const { guild, user, member } = interaction;

        if (!guild.members.me.permissions.has(OPEN_PERMS))
            return interaction.reply({ content: guild.getT("ticket:HANDLER.OPEN_PERMS"), ephemeral: true });

        const settings = await TicketSettings.getSettings(guild.id);
        const alreadyExists = getExistingTicketChannel(guild, user.id);
        if (alreadyExists) return interaction.reply({ content: guild.getT("ticket:HANDLER.ALREADY_OPEN"), ephemeral: true });

        // limit check
        const existing = getTicketChannels(guild).size;
        if (existing >= (settings.ticket_limit || 50))
            return interaction.reply({ content: guild.getT("ticket:HANDLER.TOO_MANY"), ephemeral: true });

        let defaultMsg = {
            title: guild.getT("ticket:HANDLER.OPEN_EMBED_TITLE"),
            description: guild.getT("ticket:HANDLER.OPEN_EMBED_DESC"),
            footer: guild.getT("ticket:HANDLER.OPEN_EMBED_FOOTER"),
        };

        let useDefault = true;
        let category = {
            name: "Default",
            description: "Default ticket category",
            parent_id: null,
            channel_style: "NUMBER",
            staff_roles: [],
            member_roles: [],
            open_msg_title: null,
            open_msg_description: null,
            open_msg_footer: null,
            form_fields: [],
        };

        const categories = await TicketCategories.getActive(guild.id);
        if (categories.length > 0) {
            await interaction.deferReply({ ephemeral: true });
            const options = categories.map((cat) => ({
                label: cat.name,
                value: cat.name,
                description: cat.description || undefined,
            }));
            const menuRow = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId("ticket-menu")
                    .setPlaceholder(guild.getT("ticket:HANDLER.OPEN_MENU_REPLY"))
                    .addOptions(options),
            );

            await interaction.followUp({
                content: guild.getT("ticket:HANDLER.OPEN_MENU_PLACEHOLDER"),
                components: [menuRow],
            });

            const res = await interaction.channel
                .awaitMessageComponent({
                    componentType: ComponentType.StringSelect,
                    time: 60 * 1000,
                })
                .catch((err) => {
                    if (err.message.includes("time")) return;
                });

            if (!res)
                return interaction.editReply({
                    content: guild.getT("ticket:HANDLER.OPEN_MENU_TIMEOUT"),
                    components: [],
                });

            useDefault = false;
            category = categories.find((cat) => cat.name === res.values[0]);
            if (!category) {
                return interaction.editReply(guild.getT("ticket:HANDLER.OPEN_FAILED"));
            }

            // === FORMS: Show modal if category has form_fields ===
            if (category.form_fields && category.form_fields.length > 0) {
                const formFields = category.form_fields.slice(0, 5); // Discord max 5 fields
                const modal = new ModalBuilder()
                    .setCustomId(`ticket:FORM:${category.id}`)
                    .setTitle(guild.getT("ticket:HANDLER.FORM_MODAL_TITLE", { category: category.name }));

                for (let i = 0; i < formFields.length; i++) {
                    const field = formFields[i];
                    const input = new TextInputBuilder()
                        .setCustomId(`form_field_${i}`)
                        .setLabel(field.label.substring(0, 45))
                        .setStyle(field.style === "PARAGRAPH" ? TextInputStyle.Paragraph : TextInputStyle.Short)
                        .setRequired(field.required !== false)
                        .setPlaceholder(field.placeholder || "");

                    modal.addComponents(new ActionRowBuilder().addComponents(input));
                }

                await res.showModal(modal);

                const modalSubmit = await res
                    .awaitModalSubmit({
                        time: 5 * 60 * 1000,
                        filter: (m) => m.customId === `ticket:FORM:${category.id}` && m.user.id === user.id,
                    })
                    .catch(() => null);

                if (!modalSubmit) {
                    return interaction.editReply({
                        content: guild.getT("ticket:HANDLER.FORM_TIMEOUT"),
                        components: [],
                    });
                }

                await modalSubmit.deferUpdate().catch(() => {});

                // Gather form responses
                const formResponses = formFields.map((field, i) => ({
                    label: field.label,
                    value: modalSubmit.fields.getTextInputValue(`form_field_${i}`) || "",
                }));

                await interaction.editReply({
                    content: guild.getT("ticket:HANDLER.OPEN_MENU_PROCESS"),
                    components: [],
                });

                return createTicketChannel(interaction, guild, user, member, settings, category, useDefault, defaultMsg, formResponses);
            }

            await interaction.editReply({
                content: guild.getT("ticket:HANDLER.OPEN_MENU_PROCESS"),
                components: [],
            });

            return createTicketChannel(interaction, guild, user, member, settings, category, useDefault, defaultMsg, null);
        }

        // No categories: check for form_fields on default or just create
        await interaction.deferReply({ ephemeral: true });
        return createTicketChannel(interaction, guild, user, member, settings, category, useDefault, defaultMsg, null);
    }

    //  Ticket Close Button
    else if (interaction.customId === "ticket:CLOSE") {
        await interaction.deferReply({ ephemeral: true });
        const status = await closeTicket(interaction.channel, interaction.user);
        if (status === "MISSING_PERMISSIONS") {
            return interaction.followUpT("ticket:HANDLER.CLOSE_PERMS");
        } else if (status === "ERROR") {
            return interaction.followUpT("ticket:HANDLER.CLOSE_FAIL");
        }
    }

    //  Ticket Claim Button
    else if (interaction.customId === "ticket:CLAIM") {
        await interaction.deferReply({ ephemeral: true });
        const { guild, user, member, channel } = interaction;

        const ticketDetails = await require("../utils").parseTicketDetails(channel);
        if (!ticketDetails) return interaction.followUpT("ticket:HANDLER.NOT_TICKET");

        const ticket = await Tickets.getByTicketId(guild.id, ticketDetails.ticketId);
        if (!ticket) return interaction.followUpT("ticket:HANDLER.NOT_TICKET");

        // Nur Staff-Mitglieder dürfen Tickets claimen
        const cat = await TicketCategories.getById(ticket.category_id, guild.id);
        const staffRoles = cat?.staff_roles || [];
        const isStaff = member.permissions.has("ManageGuild") || staffRoles.some(r => member.roles.cache.has(r));
        if (!isStaff) {
            return interaction.followUp({ content: guild.getT("ticket:HANDLER.CLAIM_NO_PERMISSION") || "❌ Nur Team-Mitglieder können Tickets übernehmen.", ephemeral: true });
        }

        if (ticket.claimed_by) {
            return interaction.followUp(
                guild.getT("ticket:HANDLER.ALREADY_CLAIMED", { user: `<@${ticket.claimed_by}>` }),
            );
        }

        const success = await Tickets.claim(guild.id, ticketDetails.ticketId, user.id);
        if (!success) return interaction.followUpT("ticket:HANDLER.CLAIM_FAIL");

        // Update the embed in the channel to show claim info
        const claimEmbed = new EmbedBuilder()
            .setColor("#00C853")
            .setDescription(guild.getT("ticket:HANDLER.CLAIMED_MSG", { user: user.toString() }));

        await channel.send({ embeds: [claimEmbed] });

        // Replace claim button with unclaim
        try {
            const messages = await channel.messages.fetch({ limit: 10 });
            const botMsg = messages.find(
                (m) => m.author.id === guild.members.me.id && m.components.length > 0
                    && m.components[0].components.some((c) => c.customId === "ticket:CLAIM" || c.customId === "ticket:CLOSE"),
            );
            if (botMsg) {
                const newRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel(guild.getT("ticket:HANDLER.OPEN_CLOSE_BTN"))
                        .setCustomId("ticket:CLOSE")
                        .setEmoji("🔒")
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setLabel(guild.getT("ticket:HANDLER.UNCLAIM_BTN"))
                        .setCustomId("ticket:UNCLAIM")
                        .setEmoji("📤")
                        .setStyle(ButtonStyle.Secondary),
                );
                await botMsg.edit({ components: [newRow] });
            }
        } catch { /* ignore button update error */ }

        // Log
        const settings = await TicketSettings.getSettings(guild.id);
        if (settings.log_channel) {
            const logChannel = guild.channels.cache.get(settings.log_channel);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setColor("#00C853")
                    .setAuthor({ name: guild.getT("ticket:HANDLER.CLAIM_LOG_TITLE") })
                    .setFields([
                        { name: guild.getT("ticket:HANDLER.TICKET_ID"), value: ticketDetails.ticketId, inline: true },
                        { name: guild.getT("ticket:HANDLER.CLAIM_LABEL"), value: user.toString(), inline: true },
                    ]);
                logChannel.send({ embeds: [logEmbed] }).catch(() => {});
            }
        }

        await interaction.followUp(guild.getT("ticket:HANDLER.CLAIM_SUCCESS"));
    }

    //  Ticket Unclaim Button
    else if (interaction.customId === "ticket:UNCLAIM") {
        await interaction.deferReply({ ephemeral: true });
        const { guild, user, channel } = interaction;

        const ticketDetails = await require("../utils").parseTicketDetails(channel);
        if (!ticketDetails) return interaction.followUpT("ticket:HANDLER.NOT_TICKET");

        const ticket = await Tickets.getByTicketId(guild.id, ticketDetails.ticketId);
        if (!ticket) return interaction.followUpT("ticket:HANDLER.NOT_TICKET");

        if (ticket.claimed_by !== user.id) {
            return interaction.followUp(guild.getT("ticket:HANDLER.UNCLAIM_NOT_OWNER"));
        }

        await Tickets.unclaim(guild.id, ticketDetails.ticketId);

        const unclaimEmbed = new EmbedBuilder()
            .setColor("#FF9800")
            .setDescription(guild.getT("ticket:HANDLER.UNCLAIMED_MSG", { user: user.toString() }));
        await channel.send({ embeds: [unclaimEmbed] });

        // Replace unclaim button back to claim
        try {
            const messages = await channel.messages.fetch({ limit: 10 });
            const botMsg = messages.find(
                (m) => m.author.id === guild.members.me.id && m.components.length > 0
                    && m.components[0].components.some((c) => c.customId === "ticket:UNCLAIM" || c.customId === "ticket:CLOSE"),
            );
            if (botMsg) {
                const newRow = new ActionRowBuilder().addComponents(
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
                await botMsg.edit({ components: [newRow] });
            }
        } catch { /* ignore */ }

        await interaction.followUp(guild.getT("ticket:HANDLER.UNCLAIM_SUCCESS"));
    }

    //  Ticket Reopen Button (from log channel)
    else if (interaction.customId.startsWith("ticket:REOPEN:")) {
        await interaction.deferReply({ ephemeral: true });
        const ticketId = interaction.customId.split(":")[2];
        const { guild, user } = interaction;

        const status = await reopenTicket(guild, user, ticketId);
        if (status === "NOT_FOUND") return interaction.followUp(guild.getT("ticket:HANDLER.REOPEN_NOT_FOUND"));
        if (status === "ALREADY_OPEN") return interaction.followUp(guild.getT("ticket:HANDLER.REOPEN_ALREADY_OPEN"));
        if (status === "ERROR") return interaction.followUp(guild.getT("ticket:HANDLER.REOPEN_FAIL"));

        // Disable the reopen button
        try {
            const msg = interaction.message;
            if (msg && msg.components.length > 0) {
                const disabledRow = ActionRowBuilder.from(msg.components[0]);
                disabledRow.components.forEach((c) => c.setDisabled(true));
                await msg.edit({ components: [disabledRow] });
            }
        } catch { /* ignore */ }

        await interaction.followUp(guild.getT("ticket:HANDLER.REOPEN_SUCCESS"));
    }
};

/**
 * Creates the actual ticket channel after all pre-checks (category selection, forms) are done.
 */
async function createTicketChannel(interaction, guild, user, member, settings, category, useDefault, defaultMsg, formResponses) {
    const Logger = ServiceManager.get("Logger");
    const existing = getTicketChannels(guild).size;

    const openMsg = {
        title: category.open_msg_title || defaultMsg.title,
        description: category.open_msg_description || defaultMsg.description,
        footer: category.open_msg_footer || defaultMsg.footer,
    };

    try {
        const ticketNumber = (existing + 1).toString();
        const botMember = guild.members.me;
        const permissionOverwrites = [
            {
                id: guild.roles.everyone,
                deny: ["ViewChannel"],
            },
            {
                id: user.id,
                allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"],
            },
            {
                id: botMember.id,
                allow: ["ViewChannel", "SendMessages", "ReadMessageHistory", "ManageChannels"],
            },
        ];

        category.staff_roles?.forEach((roleId) => {
            const role = guild.roles.cache.get(roleId);
            if (!role) return;
            if (role.position >= botMember.roles.highest.position) return;
            permissionOverwrites.push({
                id: role,
                allow: ["ViewChannel", "SendMessages", "ReadMessageHistory", "ManageChannels"],
            });
        });

        category.member_roles?.forEach((roleId) => {
            const role = guild.roles.cache.get(roleId);
            if (!role) return;
            if (role.position >= botMember.roles.highest.position) return;
            permissionOverwrites.push({
                id: role,
                allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"],
            });
        });

        // create category parent channel
        let parentId = category.parent_id;
        if (!parentId) {
            const parent = guild.channels.cache.find(
                (c) =>
                    c.type === ChannelType.GuildCategory &&
                    c.name === `tіckets-${category.name}`,
            );
            if (!parent) {
                const created = await guild.channels.create({
                    name: `tіckets-${category.name}`,
                    type: ChannelType.GuildCategory,
                    permissionOverwrites: [
                        {
                            id: guild.roles.everyone,
                            deny: ["ViewChannel"],
                        },
                        {
                            id: botMember.id,
                            allow: ["ViewChannel", "ManageChannels"],
                        },
                    ],
                });
                parentId = created.id;
            } else {
                parentId = parent.id;
            }
        }

        // generate ticket id
        const ticketId = genTicketId();

        // channel name style
        let channelName = "";
        switch (category.channel_style || "NUMBER") {
            case "NUMBER":
                channelName = ticketNumber;
                break;
            case "NAME":
                channelName = user.username;
                break;
            case "ID":
                channelName = user.id;
                break;
        }

        // Channel zuerst ohne Overwrites erstellen, dann Permissions separat setzen
        // Discord lehnt create() ab wenn parent + permissionOverwrites gleichzeitig gesetzt sind
        // und bestimmte Rollen-Hierarchie-Bedingungen nicht erfüllt sind
        const tktChannel = await guild.channels.create({
            name: `tіcket-${channelName}`,
            type: ChannelType.GuildText,
            topic: ticketId + " | " + user.toString(),
            parent: parentId || null,
            permissionOverwrites,
        });

        const openEmbed = new EmbedBuilder();

        const parseData = {
            "server": guild.name,
            "count": guild.memberCount,
            "member:name": member.displayName,
            "member:tag": member.user.username,
            "member:mention": member.toString(),
            "ticket:category": category.name,
            "ticket:number": ticketNumber,
            "ticket:id": ticketId,
        };

        if (openMsg.title) {
            openEmbed.setAuthor({ name: parse(openMsg.title, parseData) });
        }

        if (openMsg.description) {
            openEmbed.setDescription(parse(openMsg.description, parseData));
        }

        if (openMsg.footer) {
            openEmbed.setFooter({ text: parse(openMsg.footer, parseData) });
        }

        // Default style
        if (useDefault) {
            openEmbed.addFields(
                {
                    name: guild.getT("ticket:HANDLER.CATEGORY_LABEL"),
                    value: category.name,
                    inline: true,
                },
                {
                    name: guild.getT("ticket:HANDLER.TICKET_ID"),
                    value: ticketId,
                    inline: true,
                },
            );
        }

        // Add form responses to embed if present
        if (formResponses && formResponses.length > 0) {
            openEmbed.addFields({ name: "\u200b", value: "**" + guild.getT("ticket:HANDLER.FORM_RESPONSES_TITLE") + "**" });
            for (const resp of formResponses) {
                openEmbed.addFields({
                    name: resp.label,
                    value: resp.value || "-",
                    inline: false,
                });
            }
        }

        // Buttons: Close + Claim
        let btnRow = new ActionRowBuilder().addComponents(
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
            content: user.toString(),
            embeds: [openEmbed],
            components: [btnRow],
        });

        const commonFields = [
            {
                name: guild.getT("ticket:HANDLER.CATEGORY_LABEL"),
                value: category.name,
                inline: true,
            },
            {
                name: guild.getT("ticket:HANDLER.TICKET_ID"),
                value: ticketId,
                inline: true,
            },
        ];

        const chBtnRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel(guild.getT("ticket:HANDLER.OPEN_LOG_BTN"))
                .setURL(tktChannel.url)
                .setStyle(ButtonStyle.Link),
        );

        // Log Channel
        if (settings.log_channel) {
            const logChannel = guild.channels.cache.get(settings.log_channel);
            if (logChannel) {
                const logFields = [
                    {
                        name: guild.getT("ticket:HANDLER.OWNER_LABEL"),
                        value: user.toString() + ` [\`${user.id}\`]`,
                        inline: false,
                    },
                    ...commonFields,
                ];
                const logEmbed = new EmbedBuilder()
                    .setColor(settings.embed_color_create || "#068ADD")
                    .setAuthor({ name: guild.getT("ticket:HANDLER.OPEN_LOG_TITLE") })
                    .setFields(logFields);

                logChannel.send({ embeds: [logEmbed], components: [chBtnRow] }).catch(() => {});
            }
        }

        // DM the user
        if (user) {
            const dmFields = [
                {
                    name: guild.getT("ticket:HANDLER.SERVER_LABEL"),
                    value: guild.name,
                    inline: true,
                },
                ...commonFields,
            ];
            const dmEmbed = new EmbedBuilder()
                .setColor(settings.embed_color_create || "#068ADD")
                .setAuthor({ name: guild.getT("ticket:HANDLER.OPEN_LOG_TITLE") })
                .setThumbnail(guild.iconURL())
                .setFields(dmFields);

            user.send({ embeds: [dmEmbed], components: [chBtnRow] }).catch(() => {});
        }

        await Tickets.create(guild.id, {
            category_id: category.id || null,
            channel_id: tktChannel.id,
            ticket_id: ticketId,
            created_by: user.id,
            category_name: category.name,
            form_responses: formResponses || null,
        });

        await interaction.editReply(guild.getT("ticket:HANDLER.OPEN_SUCCESS"));
    } catch (ex) {
        Logger.error("handleTicketOpen", ex);
        return interaction.editReply(guild.getT("ticket:HANDLER.OPEN_FAILED"));
    }
}
