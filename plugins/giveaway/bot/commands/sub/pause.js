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

    if (giveaway.status === 'paused')
        return guild.getT('giveaways:ALREADY_PAUSED');

    if (giveaway.status !== 'active')
        return guild.getT('giveaways:NOT_ACTIVE');

    try {
        await client.giveawayManager.pauseGiveaway(giveaway.id);
        return guild.getT('giveaways:PAUSE_SUCCESS');
    } catch (error) {
        client.logger?.error?.('Giveaway Pause', error);
        return guild.getT('giveaways:PAUSE_ERROR');
    }
};

