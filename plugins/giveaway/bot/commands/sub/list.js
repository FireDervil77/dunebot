const { EmbedUtils } = require('dunebot-sdk/utils');

/**
 * @param {import('discord.js').GuildMember} member
 */
module.exports = async (member) => {
    const { guild, client } = member;

    if (!member.permissions.has('ManageMessages'))
        return guild.getT('giveaways:MEMBER_PERMS');

    try {
        const giveaways = await client.giveawayManager.getActiveGiveaways(guild.id);

        if (!giveaways.length)
            return guild.getT('giveaways:LIST_EMPTY');

        const desc = giveaways.map((g, i) => {
            const endsTs = Math.floor(new Date(g.ends_at).getTime() / 1000);
            const statusIcon = g.status === 'paused' ? '⏸️' : '🎁';
            return `${i + 1}. ${statusIcon} **${g.prize}** in <#${g.channel_id}> — ${g.entry_count} Teilnehmer — Endet <t:${endsTs}:R>`;
        }).join('\n');

        return {
            embeds: [
                EmbedUtils.embed()
                    .setTitle(guild.getT('giveaways:LIST_TITLE'))
                    .setDescription(desc)
            ]
        };
    } catch (error) {
        client.logger?.error?.('Giveaway List', error);
        return guild.getT('giveaways:LIST_ERROR') || '❌ Error loading giveaways.';
    }
};

