/**
 * @param {import('discord.js').GuildMember} member
 * @param {string} messageId
 */
module.exports = async (member, messageId) => {
    const { guild, client } = member;
    if (!messageId) return guild.getT('giveaways:INVALID_MESSAGE_ID');

    if (!member.permissions.has('ManageMessages'))
        return guild.getT('giveaways:MEMBER_PERMS');

    const giveaway = await client.giveawayManager.getGiveawayByMessage(messageId, guild.id);
    if (!giveaway) return guild.getT('giveaways:NOT_FOUND', { messageId });

    if (giveaway.status !== 'ended')
        return guild.getT('giveaways:STILL_RUNNING');

    try {
        const result = await client.giveawayManager.rerollGiveaway(giveaway.id);
        if (result.error === 'no_entries') return guild.getT('giveaways:NO_ENTRIES');
        return guild.getT('giveaways:REROLL_SUCCESS');
    } catch (error) {
        client.logger?.error?.('Giveaway Reroll', error);
        return guild.getT('giveaways:REROLL_ERROR');
    }
};

