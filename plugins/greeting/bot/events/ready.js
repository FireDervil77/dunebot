const { ServiceManager } = require('dunebot-core');
const { cacheGuildInvites } = require('../inviteTracker');

/**
 * Caches invites for all guilds on bot ready
 * @param {import('discord.js').Client} client
 */
module.exports = async (client) => {
    const logger = ServiceManager.get('Logger');

    let cached = 0;
    for (const guild of client.guilds.cache.values()) {
        await cacheGuildInvites(guild);
        cached++;
    }

    logger.info(`[Greeting] Invite cache initialized for ${cached} guilds`);
};
