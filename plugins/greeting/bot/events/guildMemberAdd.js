const { buildGreeting } = require("../utils");
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
        if (!settings) {
            logger.debug(`[Greeting] No settings found for guild ${member.guild.id}`);
            return;
        }

        // Autorole assignment
        if (settings.autorole_id) {
            const role = member.guild.roles.cache.get(settings.autorole_id);
            if (role) {
                await member.roles.add(role).catch((err) => {
                    logger.error(`[Greeting] Failed to assign autorole ${role.name} to ${member.user.tag}:`, err);
                });
            }
        }

        // Welcome message
        if (!settings.welcome_enabled) return;

        const channel = member.guild.channels.cache.get(settings.welcome_channel);
        if (!channel) {
            logger.warn(`[Greeting] Welcome channel ${settings.welcome_channel} not found in guild ${member.guild.id}`);
            return;
        }

        const inviterData = member.inviterData || {};

        // Parse welcome_embed if it's a JSON string
        let embedData = {};
        if (settings.welcome_embed) {
            try {
                embedData = typeof settings.welcome_embed === 'string' 
                    ? JSON.parse(settings.welcome_embed) 
                    : settings.welcome_embed;
            } catch (err) {
                logger.error(`[Greeting] Failed to parse welcome_embed for guild ${member.guild.id}:`, err);
            }
        }

        // Build welcome config object from DB fields
        const welcomeConfig = {
            enabled: settings.welcome_enabled,
            channel: settings.welcome_channel,
            content: settings.welcome_content,
            embed: embedData
        };

        // Build and send welcome message
        const response = await buildGreeting(member, "WELCOME", welcomeConfig, inviterData);
        await channel.send(response);
        
        logger.info(`[Greeting] Sent welcome message for ${member.user.tag} in ${member.guild.name}`);

    } catch (error) {
        logger.error(`[Greeting] Error in guildMemberAdd event for guild ${member.guild.id}:`, error);
    }
};
