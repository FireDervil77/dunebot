const ems = require('enhanced-ms');

/**
 * @param {import('discord.js').GuildMember} member
 * @param {string} messageId
 * @param {number} [addDur]
 * @param {string} [newPrize]
 * @param {number} [newWinnerCount]
 */
module.exports = async (member, messageId, addDur, newPrize, newWinnerCount) => {
    const { guild, client } = member;
    if (!messageId) return guild.getT('giveaways:INVALID_MESSAGE_ID');

    if (!member.permissions.has('ManageMessages'))
        return guild.getT('giveaways:MEMBER_PERMS');

    const giveaway = await client.giveawayManager.getGiveawayByMessage(messageId, guild.id);
    if (!giveaway) return guild.getT('giveaways:NOT_FOUND', { messageId });

    if (giveaway.status === 'ended' || giveaway.status === 'cancelled')
        return guild.getT('giveaways:ALREADY_ENDED');

    const changes = {};

    if (addDur) {
        const addDurationMs = typeof addDur === 'number' ? addDur : ems(addDur);
        if (!addDurationMs || isNaN(addDurationMs))
            return guild.getT('giveaways:EDIT_INVALID_DURATION');
        changes.addDuration = addDurationMs;
    }

    if (newPrize) changes.prize = newPrize;
    if (newWinnerCount) {
        if (isNaN(newWinnerCount) || newWinnerCount < 1)
            return guild.getT('giveaways:EDIT_INVALID_WINNERS');
        changes.winnerCount = parseInt(newWinnerCount);
    }

    try {
        await client.giveawayManager.editGiveaway(giveaway.id, changes);
        return guild.getT('giveaways:EDIT_SUCCESS');
    } catch (error) {
        client.logger?.error?.('Giveaway Edit', error);
        return guild.getT('giveaways:EDIT_ERROR');
    }
};

