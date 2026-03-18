const {
    ApplicationCommandOptionType,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Message,
    ComponentType,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");
const { ServiceManager } = require("dunebot-core");
const { TicketCategories } = require("../../shared/models");

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: "ticketcat",
    description: "ticket:CATEGORY.DESCRIPTION",
    userPermissions: ["ManageGuild"],
    command: {
        enabled: true,
        minArgsCount: 1,
        subcommands: [
            {
                trigger: "list",
                description: "ticket:CATEGORY.SUB_LIST_DESC",
            },
            {
                trigger: "add <category> | <description>",
                description: "ticket:CATEGORY.SUB_ADD_DESC",
            },
            {
                trigger: "remove <category>",
                description: "ticket:CATEGORY.SUB_REMOVE_DESC",
            },
            {
                trigger: "config <category>",
                description: "ticket:CATEGORY.SUB_CONFIG_DESC",
            },
        ],
    },
    slashCommand: {
        enabled: true,
        ephemeral: true,
        options: [
            {
                name: "list",
                description: "ticket:CATEGORY.SUB_LIST_DESC",
                type: ApplicationCommandOptionType.Subcommand,
            },
            {
                name: "add",
                description: "ticket:CATEGORY.SUB_ADD_DESC",
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: "category",
                        description: "ticket:CATEGORY.SUB_ADD_CAT_NAME",
                        type: ApplicationCommandOptionType.String,
                        maxLength: 100,
                        required: true,
                    },
                    {
                        name: "description",
                        description: "ticket:CATEGORY.SUB_ADD_CAT_DESC",
                        type: ApplicationCommandOptionType.String,
                        maxLength: 100,
                        required: true,
                    },
                ],
            },
            {
                name: "remove",
                description: "ticket:CATEGORY.SUB_REMOVE_DESC",
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: "category",
                        description: "ticket:CATEGORY.SUB_REMOVE_CAT_NAME",
                        type: ApplicationCommandOptionType.String,
                        required: true,
                    },
                ],
            },
            {
                name: "config",
                description: "ticket:CATEGORY.SUB_CONFIG_DESC",
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: "category",
                        description: "ticket:CATEGORY.SUB_CONFIG_CAT_NAME",
                        type: ApplicationCommandOptionType.String,
                        required: true,
                    },
                ],
            },
        ],
    },

    async messageRun({ message, args }) {
        const sub = args[0].toLowerCase();
        const guildId = message.guild.id;
        let response;

        // list
        if (sub === "list") {
            response = await listCategories(message, guildId);
        }

        // add
        else if (sub === "add") {
            const split = args.slice(1).join(" ").split("|");
            const category = split[0].trim();
            const description = split[1]?.trim();
            response = await addCategory(message, guildId, category, description);
        }

        // remove
        else if (sub === "remove") {
            const category = args.slice(1).join(" ").trim();
            response = await removeCategory(message, guildId, category);
        }

        // config
        else if (sub === "config") {
            const category = args.slice(1).join(" ").trim();
            response = await configCategory(message, guildId, category);
        }

        // invalid subcommand
        else {
            response = message.guild.getT("INVALID_SUBCOMMAND", { sub });
        }

        if (response) await message.reply(response);
    },

    async interactionRun({ interaction }) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;
        let response;

        // list
        if (sub === "list") {
            response = await listCategories(interaction, guildId);
        }

        // add
        else if (sub === "add") {
            const name = interaction.options.getString("category");
            const description = interaction.options.getString("description");
            response = await addCategory(interaction, guildId, name, description);
        }

        // remove
        else if (sub === "remove") {
            const category = interaction.options.getString("category");
            response = await removeCategory(interaction, guildId, category);
        }

        // config
        else if (sub === "config") {
            const category = interaction.options.getString("category");
            response = await configCategory(interaction, guildId, category);
        }

        await interaction.followUp(response);
    },
};

async function listCategories({ guild }, guildId) {
    const categories = await TicketCategories.getAll(guildId);
    if (categories.length === 0) return guild.getT("ticket:CATEGORY.LIST_EMPTY");

    const fields = [];
    for (const category of categories) {
        const staffNames = category.staff_roles.map((r) => `<@&${r}>`).join(", ");
        const memNames = category.member_roles.map((r) => `<@&${r}>`).join(", ");
        fields.push({
            name: category.name,
            value: `**Staff Roles:** ${staffNames || "None"}\n**Member Roles:** ${memNames || "None"}`,
            inline: true,
        });
    }
    const embed = new EmbedBuilder()
        .setAuthor({ name: guild.getT("ticket:CATEGORY.LIST_EMBED_TITLE") })
        .addFields(fields);

    return { embeds: [embed] };
}

async function addCategory({ guild }, guildId, name, description) {
    if (!name) return guild.getT("ticket:CATEGORY.ADD_NO_NAME");

    // check if category already exists
    const existing = await TicketCategories.getByName(guildId, name);
    if (existing) {
        return guild.getT("ticket:CATEGORY.ADD_EXISTS", { category: name });
    }

    await TicketCategories.create(guildId, { name, description });
    return guild.getT("ticket:CATEGORY.ADD_SUCCESS", { category: name });
}

async function removeCategory({ guild }, guildId, name) {
    const existing = await TicketCategories.getByName(guildId, name);
    if (!existing) {
        return guild.getT("ticket:CATEGORY.REMOVE_NOT_EXISTS", { category: name });
    }

    await TicketCategories.delete(existing.id, guildId);
    return guild.getT("ticket:CATEGORY.REMOVE_SUCCESS", { category: name });
}

async function configCategory(arg0, guildId, name) {
    const { guild } = arg0;
    const cat = await TicketCategories.getByName(guildId, name);

    if (!cat) {
        return guild.getT("ticket:CATEGORY.CONFIG_NOT_EXISTS", { category: name });
    }

    const reply = {
        content: guild.getT("ticket:CATEGORY.CONFIG_CONTENT", { category: name }),
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("ticket:btn_tc_memRole")
                    .setLabel(guild.getT("ticket:CATEGORY.CONFIG_BTN_MEM_ROLE"))
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId("ticket:btn_tc_staffRole")
                    .setLabel(guild.getT("ticket:CATEGORY.CONFIG_BTN_STAFF_ROLE"))
                    .setStyle(ButtonStyle.Secondary),

                new ButtonBuilder()
                    .setCustomId("ticket:btn_tc_msg")
                    .setLabel(guild.getT("ticket:CATEGORY.CONFIG_BTN_MSG"))
                    .setStyle(ButtonStyle.Secondary),
            ),
        ],
    };

    /**
     * @type {Message}
     */
    const sentMsg = arg0 instanceof Message ? await arg0.reply(reply) : await arg0.followUp(reply);
    const authorId = arg0 instanceof Message ? arg0.author.id : arg0.user.id;
    const collector = sentMsg.channel.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: (i) => i.user.id === authorId && i.message.id === sentMsg.id,
        time: 2 * 60 * 1000,
    });

    collector.on("end", () => {
        if (sentMsg && sentMsg.editable)
            sentMsg.edit({ content: "> Timeout", components: [] }).catch(() => {});
    });

    collector.on("collect", async (response) => {
        // member role modal
        if (response.customId === "ticket:btn_tc_memRole") {
            response.showModal(
                new ModalBuilder({
                    title: guild.getT("ticket:CATEGORY.CONFIG_MODAL_MEM_ROLE_TITLE"),
                    customId: "ticket:modal_tc_memRole",
                    components: [
                        new ActionRowBuilder().addComponents([
                            new TextInputBuilder()
                                .setCustomId("role_add")
                                .setLabel(guild.getT("ticket:CATEGORY.CONFIG_MODAL_MEM_ROLE_ADD"))
                                .setStyle(TextInputStyle.Short)
                                .setRequired(false),
                        ]),
                        new ActionRowBuilder().addComponents([
                            new TextInputBuilder()
                                .setCustomId("role_remove")
                                .setLabel(
                                    guild.getT("ticket:CATEGORY.CONFIG_MODAL_MEM_ROLE_REMOVE"),
                                )
                                .setStyle(TextInputStyle.Short)
                                .setRequired(false),
                        ]),
                    ],
                }),
            );
        }

        // staff role modal
        else if (response.customId === "ticket:btn_tc_staffRole") {
            response.showModal(
                new ModalBuilder({
                    title: guild.getT("ticket:CATEGORY.CONFIG_MODAL_STAFF_ROLE_TITLE"),
                    customId: "ticket:modal_tc_manRole",
                    components: [
                        new ActionRowBuilder().addComponents([
                            new TextInputBuilder()
                                .setCustomId("role_add")
                                .setLabel(guild.getT("ticket:CATEGORY.CONFIG_MODAL_STAFF_ROLE_ADD"))
                                .setStyle(TextInputStyle.Short)
                                .setRequired(false),
                        ]),
                        new ActionRowBuilder().addComponents([
                            new TextInputBuilder()
                                .setCustomId("role_remove")
                                .setLabel(
                                    guild.getT("ticket:CATEGORY.CONFIG_MODAL_STAFF_ROLE_REMOVE"),
                                )
                                .setStyle(TextInputStyle.Short)
                                .setRequired(false),
                        ]),
                    ],
                }),
            );
        }

        // message config modal
        else if (response.customId === "ticket:btn_tc_msg") {
            await response.showModal(
                new ModalBuilder()
                    .setTitle(guild.getT("ticket:CATEGORY.CONFIG_MODAL_MSG_TITLE"))
                    .setCustomId("ticket:modal_tc_msg")
                    .addComponents(
                        new ActionRowBuilder().addComponents([
                            new TextInputBuilder()
                                .setCustomId("title")
                                .setLabel(
                                    guild.getT("ticket:CATEGORY.CONFIG_MODAL_MSG_EMBED_TITLE"),
                                )
                                .setStyle(TextInputStyle.Short),
                        ]),
                        new ActionRowBuilder().addComponents([
                            new TextInputBuilder()
                                .setCustomId("description")
                                .setLabel(guild.getT("ticket:CATEGORY.CONFIG_MODAL_MSG_EMBED_DESC"))
                                .setStyle(TextInputStyle.Paragraph),
                        ]),
                        new ActionRowBuilder().addComponents([
                            new TextInputBuilder()
                                .setCustomId("footer")
                                .setLabel(
                                    guild.getT("ticket:CATEGORY.CONFIG_MODAL_MSG_EMBED_FOOTER"),
                                )
                                .setStyle(TextInputStyle.Short),
                        ]),
                    ),
            );
        }

        const modal = await response
            .awaitModalSubmit({
                time: 60 * 1000,
                filter: (m) => m.message.id === sentMsg.id,
            })
            .catch(() => {});

        if (!modal) return;
        await modal.deferReply({ ephemeral: true }).catch(() => {});

        // member role
        if (modal.customId === "ticket:modal_tc_memRole") {
            const roleAdd = modal.fields.getTextInputValue("role_add");
            const roleRemove = modal.fields.getTextInputValue("role_remove");

            const memberRoles = [...cat.member_roles];

            if (roleAdd) {
                if (!modal.guild.roles.cache.has(roleAdd)) {
                    return modal.followUp(
                        guild.getT("ticket:CATEGORY.CONFIG_ROLE_NOT_EXIST", { role: roleAdd }),
                    );
                }
                if (!memberRoles.includes(roleAdd)) memberRoles.push(roleAdd);
            }

            if (roleRemove) {
                if (!modal.guild.roles.cache.has(roleRemove)) {
                    return modal.followUp(
                        guild.getT("ticket:CATEGORY.CONFIG_ROLE_NOT_EXIST", { role: roleRemove }),
                    );
                }
                const idx = memberRoles.indexOf(roleRemove);
                if (idx > -1) memberRoles.splice(idx, 1);
            }

            await TicketCategories.update(cat.id, guildId, { member_roles: memberRoles });
            cat.member_roles = memberRoles;
            await modal.followUp(guild.getT("ticket:CATEGORY.CONFIG_MEM_ROLE_SUCCESS"));
        }

        // staff role
        else if (modal.customId === "ticket:modal_tc_manRole") {
            const roleAdd = modal.fields.getTextInputValue("role_add");
            const roleRemove = modal.fields.getTextInputValue("role_remove");

            const staffRoles = [...cat.staff_roles];

            if (roleAdd) {
                if (!modal.guild.roles.cache.has(roleAdd)) {
                    return modal.followUp(
                        guild.getT("ticket:CATEGORY.CONFIG_ROLE_NOT_EXIST", { role: roleAdd }),
                    );
                }
                if (!staffRoles.includes(roleAdd)) staffRoles.push(roleAdd);
            }

            if (roleRemove) {
                if (!modal.guild.roles.cache.has(roleRemove)) {
                    return modal.followUp(
                        guild.getT("ticket:CATEGORY.CONFIG_ROLE_NOT_EXIST", { role: roleRemove }),
                    );
                }
                const idx = staffRoles.indexOf(roleRemove);
                if (idx > -1) staffRoles.splice(idx, 1);
            }

            await TicketCategories.update(cat.id, guildId, { staff_roles: staffRoles });
            cat.staff_roles = staffRoles;
            await modal.followUp(guild.getT("ticket:CATEGORY.CONFIG_STAFF_ROLE_SUCCESS"));
        }

        // message config
        else if (modal.customId === "ticket:modal_tc_msg") {
            const title = modal.fields.getTextInputValue("title");
            const description = modal.fields.getTextInputValue("description");
            const footer = modal.fields.getTextInputValue("footer");

            await TicketCategories.update(cat.id, guildId, {
                open_msg_title: title || null,
                open_msg_description: description || null,
                open_msg_footer: footer || null,
            });
            await modal.followUp(guild.getT("ticket:CATEGORY.CONFIG_MSG_SUCCESS"));
        }
    });
}
