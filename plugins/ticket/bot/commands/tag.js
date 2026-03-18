const { ApplicationCommandOptionType } = require("discord.js");
const { EmbedUtils } = require("dunebot-sdk/utils");
const { ServiceManager } = require("dunebot-core");
const { TicketTags } = require("../../shared/models");
const { isTicketChannel } = require("../utils");

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: "tag",
    description: "ticket:TAG.DESCRIPTION",
    userPermissions: ["ManageGuild"],
    command: {
        enabled: true,
        minArgsCount: 1,
        subcommands: [
            { trigger: "use <name>", description: "ticket:TAG.SUB_USE_DESC" },
            { trigger: "create <name> | <content>", description: "ticket:TAG.SUB_CREATE_DESC" },
            { trigger: "edit <name> | <content>", description: "ticket:TAG.SUB_EDIT_DESC" },
            { trigger: "delete <name>", description: "ticket:TAG.SUB_DELETE_DESC" },
            { trigger: "list", description: "ticket:TAG.SUB_LIST_DESC" },
        ],
    },
    slashCommand: {
        enabled: true,
        options: [
            {
                name: "use",
                description: "ticket:TAG.SUB_USE_DESC",
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: "name",
                        description: "ticket:TAG.OPT_NAME",
                        type: ApplicationCommandOptionType.String,
                        required: true,
                    },
                ],
            },
            {
                name: "create",
                description: "ticket:TAG.SUB_CREATE_DESC",
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: "name",
                        description: "ticket:TAG.OPT_NAME",
                        type: ApplicationCommandOptionType.String,
                        required: true,
                    },
                    {
                        name: "content",
                        description: "ticket:TAG.OPT_CONTENT",
                        type: ApplicationCommandOptionType.String,
                        required: true,
                    },
                ],
            },
            {
                name: "edit",
                description: "ticket:TAG.SUB_EDIT_DESC",
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: "name",
                        description: "ticket:TAG.OPT_NAME",
                        type: ApplicationCommandOptionType.String,
                        required: true,
                    },
                    {
                        name: "content",
                        description: "ticket:TAG.OPT_CONTENT",
                        type: ApplicationCommandOptionType.String,
                        required: true,
                    },
                ],
            },
            {
                name: "delete",
                description: "ticket:TAG.SUB_DELETE_DESC",
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: "name",
                        description: "ticket:TAG.OPT_NAME",
                        type: ApplicationCommandOptionType.String,
                        required: true,
                    },
                ],
            },
            {
                name: "list",
                description: "ticket:TAG.SUB_LIST_DESC",
                type: ApplicationCommandOptionType.Subcommand,
            },
        ],
    },

    async messageRun({ message, args }) {
        const guild = message.guild;
        const sub = args[0].toLowerCase();
        let response;

        if (sub === "use") {
            if (!args[1]) return message.reply(guild.getT("ticket:TAG.NAME_REQUIRED"));
            response = await useTag(guild, message.channel, args[1]);
        } else if (sub === "create") {
            const rest = args.slice(1).join(" ");
            const [name, ...contentParts] = rest.split("|");
            if (!name?.trim() || !contentParts.length) return message.reply(guild.getT("ticket:TAG.CREATE_USAGE"));
            response = await createTag(guild, name.trim(), contentParts.join("|").trim(), message.author.id);
        } else if (sub === "edit") {
            const rest = args.slice(1).join(" ");
            const [name, ...contentParts] = rest.split("|");
            if (!name?.trim() || !contentParts.length) return message.reply(guild.getT("ticket:TAG.EDIT_USAGE"));
            response = await editTag(guild, name.trim(), contentParts.join("|").trim());
        } else if (sub === "delete") {
            if (!args[1]) return message.reply(guild.getT("ticket:TAG.NAME_REQUIRED"));
            response = await deleteTag(guild, args[1]);
        } else if (sub === "list") {
            response = await listTags(guild);
        } else {
            return message.reply(guild.getT("ticket:TAG.INVALID_SUB"));
        }

        if (response) await message.reply(response);
    },

    async interactionRun({ interaction }) {
        const sub = interaction.options.getSubcommand();
        const guild = interaction.guild;
        let response;

        if (sub === "use") {
            const name = interaction.options.getString("name");
            response = await useTag(guild, interaction.channel, name);
        } else if (sub === "create") {
            const name = interaction.options.getString("name");
            const content = interaction.options.getString("content");
            response = await createTag(guild, name, content, interaction.user.id);
        } else if (sub === "edit") {
            const name = interaction.options.getString("name");
            const content = interaction.options.getString("content");
            response = await editTag(guild, name, content);
        } else if (sub === "delete") {
            const name = interaction.options.getString("name");
            response = await deleteTag(guild, name);
        } else if (sub === "list") {
            response = await listTags(guild);
        }

        if (response) await interaction.followUp(response);
    },
};

async function useTag(guild, channel, name) {
    const tag = await TicketTags.getByName(guild.id, name.toLowerCase());
    if (!tag) return guild.getT("ticket:TAG.NOT_FOUND", { name });

    // Tag-Inhalt direkt in den Channel senden
    await channel.send(tag.content);
    return guild.getT("ticket:TAG.USED", { name: tag.name });
}

async function createTag(guild, name, content, createdBy) {
    const normalized = name.toLowerCase().replace(/[^a-z0-9-_]/g, '');
    if (!normalized || normalized.length > 50) return guild.getT("ticket:TAG.INVALID_NAME");

    const existing = await TicketTags.getByName(guild.id, normalized);
    if (existing) return guild.getT("ticket:TAG.ALREADY_EXISTS", { name: normalized });

    await TicketTags.create(guild.id, normalized, content, createdBy);
    return guild.getT("ticket:TAG.CREATED", { name: normalized });
}

async function editTag(guild, name, content) {
    const normalized = name.toLowerCase();
    const existing = await TicketTags.getByName(guild.id, normalized);
    if (!existing) return guild.getT("ticket:TAG.NOT_FOUND", { name: normalized });

    await TicketTags.update(guild.id, normalized, content);
    return guild.getT("ticket:TAG.UPDATED", { name: normalized });
}

async function deleteTag(guild, name) {
    const normalized = name.toLowerCase();
    const existing = await TicketTags.getByName(guild.id, normalized);
    if (!existing) return guild.getT("ticket:TAG.NOT_FOUND", { name: normalized });

    await TicketTags.delete(guild.id, normalized);
    return guild.getT("ticket:TAG.DELETED", { name: normalized });
}

async function listTags(guild) {
    const tags = await TicketTags.getAll(guild.id);
    if (!tags.length) return guild.getT("ticket:TAG.EMPTY");

    const list = tags.map(t => `\`${t.name}\``).join(", ");
    return guild.getT("ticket:TAG.LIST", { tags: list, count: tags.length });
}
