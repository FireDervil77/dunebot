const { baueNachricht, ANLAESSE } = require("../utils");
const { ServiceManager } = require('dunebot-core');

/**
 * @param {import('discord.js').GuildMember} member
 */
module.exports = async (member) => {
    const dbService = ServiceManager.get('dbService');
    const logger = ServiceManager.get('Logger');

    try {
        // Load greeting settings from database
        const rows = await dbService.query(
            'SELECT * FROM greeting_settings WHERE guild_id = ?',
            [member.guild.id]
        );

        const settings = rows?.[0];
        if (!settings || !settings.farewell_enabled) return;

        // Check if channel exists
        const channel = member.guild.channels.cache.get(settings.farewell_channel);
        if (!channel) {
            logger.warn(`[Greeting] Farewell channel ${settings.farewell_channel} not found in guild ${member.guild.id}`);
            return;
        }

        const response = await baueNachricht(member, ANLAESSE.farewell, { inviterData: member.inviterData || {} });
        await channel.send(response);
        
        logger.info(`[Greeting] Sent farewell message for ${member.user.tag} in ${member.guild.name}`);

    } catch (error) {
        logger.error(`[Greeting] Error in guildMemberRemove event for guild ${member.guild.id}:`, error);
    }
};
