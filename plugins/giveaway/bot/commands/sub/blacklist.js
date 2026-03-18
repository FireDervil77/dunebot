const { ServiceManager } = require('dunebot-core');

/**
 * /giveaway blacklist add <user> [reason]
 * /giveaway blacklist remove <user>
 * /giveaway blacklist list
 * @param {import('discord.js').GuildMember} member
 * @param {string} action - add/remove/list
 * @param {string} targetUserId
 * @param {string} reason
 */
module.exports = async (member, action, targetUserId, reason) => {
    try {
        const { guild, client } = member;

        if (!member.permissions.has('ManageMessages'))
            return guild.getT('giveaways:MEMBER_PERMS');

        const manager = client.giveawayManager;
        if (!manager) return '❌ Giveaway system not available.';

        if (action === 'list') {
            const list = await manager.getBlacklist(guild.id);
            if (!list.length) return guild.getT('giveaways:BLACKLIST_EMPTY');

            const entries = list.map((b, i) =>
                `**${i + 1}.** <@${b.user_id}> — ${b.reason || 'Kein Grund'} (von <@${b.blocked_by}>)`
            ).join('\n');

            return { embeds: [{
                title: guild.getT('giveaways:BLACKLIST_TITLE'),
                description: entries,
                color: 0xff4444,
            }] };
        }

        if (!targetUserId) return guild.getT('giveaways:BLACKLIST_NO_USER');

        if (action === 'add') {
            const result = await manager.addToBlacklist(guild.id, targetUserId, reason || null, member.id);
            if (result.error === 'already_blacklisted') return guild.getT('giveaways:BLACKLIST_ALREADY');
            return guild.getT('giveaways:BLACKLIST_ADDED', { user: `<@${targetUserId}>` });
        }

        if (action === 'remove') {
            const result = await manager.removeFromBlacklist(guild.id, targetUserId);
            if (!result.success) return guild.getT('giveaways:BLACKLIST_NOT_FOUND');
            return guild.getT('giveaways:BLACKLIST_REMOVED', { user: `<@${targetUserId}>` });
        }

        return guild.getT('INVALID_SUBCOMMAND', { sub: action });
    } catch (error) {
        member.client.logger?.error?.('Giveaway Blacklist', error);
        return member.guild.getT('giveaways:BLACKLIST_ERROR');
    }
};
