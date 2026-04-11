const { EmbedBuilder } = require('discord.js');
const { ServiceManager } = require('dunebot-core');

/**
 * IPC Handler: greeting:SEND_REACTION_ROLE_PANEL
 * Sends a reaction role panel (embed + reactions) to a channel
 */
module.exports = async (data, discordClient) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const { guildId, panelId } = data;

    try {
        // Load panel
        const [panel] = await dbService.query(
            'SELECT * FROM greeting_reaction_panels WHERE id = ? AND guild_id = ?',
            [panelId, guildId]
        );
        if (!panel) {
            return { success: false, error: 'Panel not found' };
        }

        // Load mappings
        const mappings = await dbService.query(
            'SELECT * FROM greeting_reaction_roles WHERE panel_id = ?',
            [panel.id]
        );
        if (mappings.length === 0) {
            return { success: false, error: 'No emoji-role mappings configured for this panel' };
        }

        // Get guild and channel
        const guild = discordClient.guilds.cache.get(guildId);
        if (!guild) return { success: false, error: 'Guild not found in cache' };

        const channel = guild.channels.cache.get(panel.channel_id);
        if (!channel) return { success: false, error: 'Channel not found' };

        // Build embed
        const embed = new EmbedBuilder()
            .setTitle(panel.title || 'Reaction Roles')
            .setColor(panel.color ? parseInt(panel.color.replace('#', ''), 16) : 0x5865F2)
            .setTimestamp();

        // Build description with emoji → role mapping list
        let desc = panel.description ? panel.description + '\n\n' : '';
        for (const mapping of mappings) {
            const role = guild.roles.cache.get(mapping.role_id);
            const roleName = role ? role.name : `<@&${mapping.role_id}>`;
            desc += `${mapping.emoji} — **${roleName}**`;
            if (mapping.description) desc += ` — ${mapping.description}`;
            desc += '\n';
        }
        embed.setDescription(desc.trim());

        // Send message
        const msg = await channel.send({ embeds: [embed] });

        // Add reactions
        for (const mapping of mappings) {
            try {
                await msg.react(mapping.emoji);
            } catch (e) {
                Logger.warn(`[Greeting] Could not add reaction ${mapping.emoji}: ${e.message}`);
            }
        }

        // Store message ID
        await dbService.query(
            'UPDATE greeting_reaction_panels SET message_id = ? WHERE id = ?',
            [msg.id, panel.id]
        );

        Logger.info(`[Greeting] Reaction role panel sent to #${channel.name} in ${guild.name} (${mappings.length} roles)`);
        return { success: true, messageId: msg.id };
    } catch (error) {
        Logger.error('[Greeting] IPC sendReactionRolePanel error:', error);
        return { success: false, error: error.message };
    }
};
