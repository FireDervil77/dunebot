const { ChannelType } = require('discord.js');
const ems = require('enhanced-ms');

const SETUP_PERMS = ['ViewChannel', 'SendMessages', 'EmbedLinks'];

/**
 * @param {import('discord.js').GuildMember} member
 * @param {import('discord.js').GuildTextBasedChannel} giveawayChannel
 * @param {string} duration
 * @param {string} prize
 * @param {number} winners
 * @param {string} hostId
 * @param {string} rolesString
 */
module.exports = async (member, giveawayChannel, duration, prize, winners, hostId, rolesString) => {
    try {
        const { guild, client } = member;

        if (!member.permissions.has('ManageMessages'))
            return guild.getT('giveaways:MEMBER_PERMS');

        if (!giveawayChannel || giveawayChannel.type !== ChannelType.GuildText)
            return guild.getT('giveaways:START_CHANNEL_TYPE');

        if (!giveawayChannel.permissionsFor(guild.members.me).has(SETUP_PERMS)) {
            return guild.getT('giveaways:START_CHANNEL_PERMS', {
                channel: giveawayChannel.toString()
            });
        }

        const durationMs = ems(duration);
        if (!durationMs || isNaN(durationMs))
            return guild.getT('giveaways:START_INVALID_DURATION');

        if (!winners) winners = 1;
        if (isNaN(winners) || winners < 1)
            return guild.getT('giveaways:START_INVALID_WINNERS');

        let host = null;
        if (hostId) {
            try {
                host = await client.users.fetch(hostId);
            } catch (ex) {
                return guild.getT('giveaways:START_INVALID_HOST');
            }
        }
        if (!host) host = member.user;

        const allowedRoles = rolesString
            ?.split(',')
            ?.map(r => r.trim())
            ?.filter(roleId => guild.roles.cache.get(roleId)) || [];

        await client.giveawayManager.createGiveaway(guild.id, giveawayChannel.id, {
            prize,
            duration: durationMs,
            winnerCount: parseInt(winners),
            createdBy: member.id,
            hostedBy: host.id,
            allowedRoles: allowedRoles.length > 0 ? allowedRoles : null,
        });

        return guild.getT('giveaways:START_SUCCESS', { channel: giveawayChannel.toString() });
    } catch (error) {
        member.client.logger?.error?.('Giveaway Start', error);
        return member.guild.getT('giveaways:START_ERROR');
    }
};

