const { unBanTarget } = require("../utils");
const {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ApplicationCommandOptionType,
    ComponentType,
} = require("discord.js");

/**
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: "unban",
    description: "moderation:UNBAN.DESCRIPTION",
    botPermissions: ["BanMembers"],
    userPermissions: ["BanMembers"],
    command: {
        enabled: true,
        usage: "[ID|@member] [reason]",
        minArgsCount: 0, // Jetzt optional!
    },
    slashCommand: {
        enabled: true,
        ephemeral: true,
        options: [
            {
                name: "name",
                description: "moderation:UNBAN.NAME_DESC",
                type: ApplicationCommandOptionType.String,
                required: false, // Jetzt optional!
            },
            {
                name: "reason",
                description: "moderation:UNBAN.REASON_DESC",
                type: ApplicationCommandOptionType.String,
                required: false,
            },
        ],
    },

    async messageRun({ message, args }) {
        const match = args[0] || null; // Kann jetzt leer sein
        const reason = args[1] || message.content.split(args[0])[1]?.trim();

        const response = await getMatchingBans(message.guild, match);
        const sent = await message.reply(response);
        if (typeof response !== "string") await waitForBan(message.member, reason, sent, null);
    },

    async interactionRun({ interaction }) {
        const match = interaction.options.getString("name") || null; // Kann jetzt null sein
        const reason = interaction.options.getString("reason");

        const response = await getMatchingBans(interaction.guild, match);
        const sent = await interaction.editReply(response);
        if (typeof response !== "string") await waitForBan(interaction.member, reason, sent, interaction);
    },
};

/**
 * @param {import('discord.js').Guild} guild
 * @param {string|null} match
 */
async function getMatchingBans(guild, match) {
    const bans = await guild.bans.fetch({ cache: false });

    if (bans.size === 0) {
        return guild.getT("moderation:UNBAN.NO_BANS");
    }

    const matched = [];
    
    // Wenn kein Name angegeben: Zeige ALLE gebannten User (max 25 wegen Discord-Limit)
    if (!match || match.trim() === "") {
        for (const [, ban] of bans) {
            if (ban.user.partial) await ban.user.fetch();
            matched.push(ban.user);
            if (matched.length >= 25) break; // Discord Select Menu Limit
        }
    } else {
        // Wenn Name angegeben: Suche nach passenden Usern
        for (const [, ban] of bans) {
            if (ban.user.partial) await ban.user.fetch();

            // exact match
            if (ban.user.id === match || ban.user.tag === match) {
                matched.push(ban.user);
                break;
            }

            // partial match
            if (ban.user.username.toLowerCase().includes(match.toLowerCase())) {
                matched.push(ban.user);
            }
        }
    }

    if (matched.length === 0) {
        return guild.getT("moderation:NO_MATCH_USER", { query: match });
    }

    const options = [];
    for (const user of matched) {
        // Zeige Username und ID im Dropdown
        options.push({ 
            label: `${user.username} (${user.discriminator !== '0' ? user.tag : user.username})`, 
            description: `ID: ${user.id}`,
            value: user.id 
        });
    }

    const menuRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("unban-menu")
            .setPlaceholder(guild.getT("moderation:UNBAN.MENU_PLACEHOLDER"))
            .addOptions(options),
    );

    const contentMessage = match 
        ? guild.getT("moderation:UNBAN.MENU_CONTENT")
        : guild.getT("moderation:UNBAN.SELECT_USER", { count: matched.length });

    return { content: contentMessage, components: [menuRow] };
}

/**
 * @param {import('discord.js').GuildMember} issuer
 * @param {string} reason
 * @param {import('discord.js').Message} sent
 * @param {import('discord.js').CommandInteraction} interaction
 */
async function waitForBan(issuer, reason, sent, interaction = null) {
    const guild = issuer.guild;

    const collector = sent.channel.createMessageComponentCollector({
        filter: (m) =>
            m.member.id === issuer.id && m.customId === "unban-menu" && sent.id === m.message.id,
        time: 20000,
        max: 1,
        componentType: ComponentType.StringSelect,
    });

    //
    collector.on("collect", async (response) => {
        const userId = response.values[0];
        const user = await issuer.client.users.fetch(userId, { cache: true });

        const status = await unBanTarget(issuer, user, reason);
        const resultMessage = guild.getT(
            typeof status === "boolean"
                ? "moderation:UNBAN.SUCCESS"
                : "moderation:UNBAN.FAILED",
            {
                target: user.username,
            },
        );
        
        // Wenn es eine Interaction ist, update die Interaction
        if (interaction) {
            await response.update({
                content: resultMessage,
                components: [],
            });
        } else {
            // Ansonsten editiere die Message
            await sent.edit({
                content: resultMessage,
                components: [],
            });
        }
    });

    // collect user and unban
    collector.on("end", async (collected) => {
        if (collected.size === 0) {
            const timeoutMessage = guild.getT("moderation:COLLECT_TIMEOUT");
            if (interaction) {
                await interaction.editReply({ content: timeoutMessage, components: [] });
            } else {
                await sent.edit(timeoutMessage);
            }
        }
    });
}
