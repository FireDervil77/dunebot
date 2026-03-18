const { EmbedBuilder, ApplicationCommandOptionType } = require("discord.js");
const { getNotes, createNote, deleteNote } = require("../utils");

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: "note",
    description: "moderation:NOTE.DESCRIPTION",
    userPermissions: ["KickMembers"],
    command: {
        enabled: true,
        minArgsCount: 1,
        subcommands: [
            {
                trigger: "add <member> <note>",
                description: "moderation:NOTE.SUB_ADD_DESC",
            },
            {
                trigger: "list <member>",
                description: "moderation:NOTE.SUB_LIST_DESC",
            },
            {
                trigger: "delete <note_id>",
                description: "moderation:NOTE.SUB_DELETE_DESC",
            },
        ],
    },
    slashCommand: {
        enabled: true,
        options: [
            {
                name: "add",
                description: "moderation:NOTE.SUB_ADD_DESC",
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: "user",
                        description: "moderation:NOTE.SUB_ADD_USER",
                        type: ApplicationCommandOptionType.User,
                        required: true,
                    },
                    {
                        name: "text",
                        description: "moderation:NOTE.SUB_ADD_TEXT",
                        type: ApplicationCommandOptionType.String,
                        required: true,
                    },
                ],
            },
            {
                name: "list",
                description: "moderation:NOTE.SUB_LIST_DESC",
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: "user",
                        description: "moderation:NOTE.SUB_LIST_USER",
                        type: ApplicationCommandOptionType.User,
                        required: true,
                    },
                ],
            },
            {
                name: "delete",
                description: "moderation:NOTE.SUB_DELETE_DESC",
                type: ApplicationCommandOptionType.Subcommand,
                options: [
                    {
                        name: "id",
                        description: "moderation:NOTE.SUB_DELETE_ID",
                        type: ApplicationCommandOptionType.Integer,
                        required: true,
                        minValue: 1,
                    },
                ],
            },
        ],
    },

    async messageRun({ message, args }) {
        const sub = args[0]?.toLowerCase();
        let response = "";

        if (sub === "add") {
            const target = await message.guild.resolveMember(args[1], true);
            if (!target) return message.replyT("moderation:NO_MATCH_USER", { query: args[1] });
            const noteText = args.slice(2).join(" ");
            if (!noteText) return message.replyT("moderation:NOTE.NO_TEXT");
            response = await addNote(message.guild, message.member, target.user, noteText);
        } else if (sub === "list") {
            const target = await message.guild.resolveMember(args[1], true);
            if (!target) return message.replyT("moderation:NO_MATCH_USER", { query: args[1] });
            response = await listNotes(message.guild, target.user);
        } else if (sub === "delete") {
            const noteId = parseInt(args[1]);
            if (isNaN(noteId)) return message.replyT("moderation:NOTE.INVALID_ID");
            response = await removeNote(message.guild, message.member, noteId);
        } else {
            response = message.guild.getT("moderation:INVALID_SUBCOMMAND", { sub });
        }

        await message.reply(response);
    },

    async interactionRun({ interaction }) {
        const sub = interaction.options.getSubcommand();
        let response = "";

        if (sub === "add") {
            const user = interaction.options.getUser("user");
            const noteText = interaction.options.getString("text");
            response = await addNote(interaction.guild, interaction.member, user, noteText);
        } else if (sub === "list") {
            const user = interaction.options.getUser("user");
            response = await listNotes(interaction.guild, user);
        } else if (sub === "delete") {
            const noteId = interaction.options.getInteger("id");
            response = await removeNote(interaction.guild, interaction.member, noteId);
        }

        await interaction.followUp(response);
    },
};

async function addNote(guild, issuer, targetUser, noteText) {
    try {
        const noteId = await createNote(guild.id, targetUser.id, issuer.id, noteText);
        return guild.getT("moderation:NOTE.ADD_SUCCESS", { 
            target: targetUser.username, 
            id: noteId.toString() 
        });
    } catch (error) {
        return guild.getT("moderation:NOTE.ADD_FAILED");
    }
}

async function listNotes(guild, targetUser) {
    const notes = await getNotes(guild.id, targetUser.id);

    if (!notes || notes.length === 0) {
        return guild.getT("moderation:NOTE.NO_NOTES", { target: targetUser.username });
    }

    const lines = notes.map(n => {
        const date = `<t:${Math.floor(new Date(n.created_at).getTime() / 1000)}:R>`;
        const text = n.note.length > 80 ? n.note.substring(0, 80) + "…" : n.note;
        return `**#${n.id}** — ${date} (by <@${n.author_id}>)\n└ ${text}`;
    });

    const embed = new EmbedBuilder()
        .setAuthor({ name: guild.getT("moderation:NOTE.LIST_TITLE", { target: targetUser.username }) })
        .setThumbnail(targetUser.displayAvatarURL())
        .setColor("#78909C")
        .setDescription(lines.join("\n"))
        .setFooter({ text: guild.getT("moderation:NOTE.LIST_FOOTER", { count: notes.length.toString() }) });

    return { embeds: [embed] };
}

async function removeNote(guild, issuer, noteId) {
    const deleted = await deleteNote(guild.id, noteId, issuer.id);
    if (deleted) {
        return guild.getT("moderation:NOTE.DELETE_SUCCESS", { id: noteId.toString() });
    }
    return guild.getT("moderation:NOTE.DELETE_FAILED", { id: noteId.toString() });
}
