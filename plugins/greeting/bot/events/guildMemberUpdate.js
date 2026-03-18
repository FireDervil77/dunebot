const { buildGreeting } = require("../utils");
const { ServiceManager } = require('dunebot-core');

/**
 * Fires when a member updates (detects boost start)
 * @param {import('discord.js').GuildMember} oldMember
 * @param {import('discord.js').GuildMember} newMember
 */
module.exports = async (oldMember, newMember) => {
    const dbService = ServiceManager.get('dbService');
    const logger = ServiceManager.get('Logger');

    // Check if member just started boosting
    const wasBoosting = oldMember.premiumSince !== null;
    const isBoosting = newMember.premiumSince !== null;

    if (wasBoosting || !isBoosting) return; // Not a new boost

    try {
        const rows = await dbService.query(
            'SELECT * FROM greeting_settings WHERE guild_id = ?',
            [newMember.guild.id]
        );

        const settings = rows?.[0];
        if (!settings || !settings.boost_enabled) return;

        const channel = newMember.guild.channels.cache.get(settings.boost_channel);
        if (!channel) return;

        let embedData = {};
        if (settings.boost_embed) {
            try {
                embedData = typeof settings.boost_embed === 'string'
                    ? JSON.parse(settings.boost_embed)
                    : settings.boost_embed;
            } catch { /* ignore */ }
        }

        const boostConfig = {
            enabled: true,
            content: settings.boost_content,
            embed: embedData
        };

        const response = await buildGreeting(newMember, "BOOST", boostConfig, {});
        await channel.send(response);

        logger.info(`[Greeting] Sent boost message for ${newMember.user.tag} in ${newMember.guild.name}`);
    } catch (error) {
        logger.error(`[Greeting] Error in boost event for guild ${newMember.guild.id}:`, error);
    }
};
