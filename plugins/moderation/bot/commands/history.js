const { EmbedBuilder, ApplicationCommandOptionType } = require("discord.js");
const { getHistory } = require("../utils");

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: "history",
    description: "moderation:HISTORY.DESCRIPTION",
    userPermissions: ["KickMembers"],
    command: {
        enabled: true,
        usage: "<ID|@member>",
        minArgsCount: 1,
    },
    slashCommand: {
        enabled: true,
        options: [
            {
                name: "user",
                description: "moderation:HISTORY.USER_DESC",
                type: ApplicationCommandOptionType.User,
                required: true,
            },
            {
                name: "limit",
                description: "moderation:HISTORY.LIMIT_DESC",
                type: ApplicationCommandOptionType.Integer,
                required: false,
                minValue: 1,
                maxValue: 50,
            },
        ],
    },

    async messageRun({ message, args }) {
        const target = await message.guild.resolveMember(args[0], true);
        if (!target) return message.replyT("moderation:NO_MATCH_USER", { query: args[0] });
        const response = await showHistory(message.guild, target.user);
        await message.reply(response);
    },

    async interactionRun({ interaction }) {
        const user = interaction.options.getUser("user");
        const limit = interaction.options.getInteger("limit") || 25;
        const response = await showHistory(interaction.guild, user, limit);
        await interaction.followUp(response);
    },
};

async function showHistory(guild, user, limit = 25) {
    const logs = await getHistory(guild.id, user.id, limit);

    if (!logs || logs.length === 0) {
        return guild.getT("moderation:HISTORY.NO_HISTORY", { target: user.username });
    }

    const typeEmoji = {
        WARN: "⚠️", KICK: "👢", BAN: "🔨", SOFTBAN: "🔨",
        TIMEOUT: "⏱️", UNTIMEOUT: "✅", UNBAN: "✅", PURGE: "🗑️",
        VMUTE: "🔇", VUNMUTE: "🔊", DEAFEN: "🔇", UNDEAFEN: "🔊",
        DISCONNECT: "📴", MOVE: "↔️",
    };

    const lines = logs.map(log => {
        const emoji = typeEmoji[log.type] || "ℹ️";
        const date = `<t:${Math.floor(new Date(log.created_at).getTime() / 1000)}:R>`;
        const caseStr = log.case_number ? `#${log.case_number}` : "–";
        const reason = log.reason
            ? (log.reason.length > 50 ? log.reason.substring(0, 50) + "…" : log.reason)
            : "Kein Grund";
        return `${emoji} **Case ${caseStr}** — ${log.type} ${date}\n└ ${reason} (by ${log.admin_tag})`;
    });

    // Aufteilen in Seiten falls nötig (max 4096 Zeichen pro Embed)
    const description = lines.join("\n");

    const embed = new EmbedBuilder()
        .setAuthor({ name: guild.getT("moderation:HISTORY.TITLE", { target: user.username }) })
        .setThumbnail(user.displayAvatarURL())
        .setColor("#607D8B")
        .setDescription(description.length > 4000 ? description.substring(0, 4000) + "\n…" : description)
        .setFooter({ text: guild.getT("moderation:HISTORY.FOOTER", { count: logs.length.toString() }) });

    return { embeds: [embed] };
}
