const { EmbedBuilder, ApplicationCommandOptionType } = require("discord.js");
const { getCase } = require("../utils");

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: "case",
    description: "moderation:CASE.DESCRIPTION",
    userPermissions: ["KickMembers"],
    command: {
        enabled: true,
        usage: "<case_number>",
        minArgsCount: 1,
    },
    slashCommand: {
        enabled: true,
        options: [
            {
                name: "number",
                description: "moderation:CASE.NUMBER_DESC",
                type: ApplicationCommandOptionType.Integer,
                required: true,
                minValue: 1,
            },
        ],
    },

    async messageRun({ message, args }) {
        const caseNumber = parseInt(args[0]);
        if (isNaN(caseNumber) || caseNumber < 1) {
            return message.replyT("moderation:CASE.INVALID_NUMBER");
        }
        const response = await showCase(message.guild, caseNumber);
        await message.reply(response);
    },

    async interactionRun({ interaction }) {
        const caseNumber = interaction.options.getInteger("number");
        const response = await showCase(interaction.guild, caseNumber);
        await interaction.followUp(response);
    },
};

async function showCase(guild, caseNumber) {
    const caseData = await getCase(guild.id, caseNumber);

    if (!caseData) {
        return guild.getT("moderation:CASE.NOT_FOUND", { number: caseNumber });
    }

    const embed = new EmbedBuilder()
        .setAuthor({ name: `Case #${caseData.case_number} — ${caseData.type}` })
        .setColor(getTypeColor(caseData.type))
        .addFields(
            { name: "User", value: `<@${caseData.member_id}> (${caseData.member_id})`, inline: true },
            { name: "Moderator", value: `<@${caseData.admin_id}> (${caseData.admin_tag})`, inline: true },
            { name: "Grund", value: caseData.reason || "Kein Grund angegeben", inline: false },
            { name: "Datum", value: `<t:${Math.floor(new Date(caseData.created_at).getTime() / 1000)}:F>`, inline: true },
        )
        .setTimestamp(new Date(caseData.created_at));

    if (caseData.deleted) {
        embed.setFooter({ text: "⚠️ Dieser Case wurde gelöscht/widerrufen" });
    }

    return { embeds: [embed] };
}

function getTypeColor(type) {
    const colors = {
        WARN: "#FFA726",
        KICK: "#FF7961",
        BAN: "#D32F2F",
        SOFTBAN: "#AF4448",
        TIMEOUT: "#102027",
        UNTIMEOUT: "#4B636E",
        UNBAN: "#00C853",
        PURGE: "#9C27B0",
        VMUTE: "#102027",
        VUNMUTE: "#4B636E",
        DEAFEN: "#102027",
        UNDEAFEN: "#4B636E",
        DISCONNECT: "#E91E63",
        MOVE: "#9C27B0",
    };
    return colors[type] || "#607D8B";
}
