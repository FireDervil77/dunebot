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

    if (giveaway.status === 'ended' || giveaway.status === 'cancelled')
        return guild.getT('giveaways:ALREADY_ENDED');

    try {
        await client.giveawayManager.endGiveaway(giveaway.id, true);
        return guild.getT('giveaways:END_SUCCESS');
    } catch (error) {
        client.logger?.error?.('Giveaway End', error);
        return guild.getT('giveaways:END_ERROR');
    }
};

