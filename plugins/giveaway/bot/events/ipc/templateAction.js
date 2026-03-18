/**
 * IPC Handler: Template operations (create/list/delete/use)
 */
module.exports = async (payload, client) => {
    const { guildId, action, name, config, createdBy, channelId } = payload;
    if (!client.giveawayManager) return { success: false, error: 'Giveaway system not available' };
    if (!guildId || !action) return { success: false, error: 'Missing required fields' };

    try {
        const manager = client.giveawayManager;

        if (action === 'create') {
            if (!name || !config) return { success: false, error: 'Missing name or config' };
            const result = await manager.createTemplate(guildId, name, config, createdBy || '0');
            return { success: !result.error, error: result.error };
        }

        if (action === 'list') {
            const templates = await manager.getTemplates(guildId);
            return { success: true, templates };
        }

        if (action === 'delete') {
            if (!name) return { success: false, error: 'Missing name' };
            const result = await manager.deleteTemplate(guildId, name);
            return { success: result.success };
        }

        if (action === 'use') {
            if (!name || !channelId) return { success: false, error: 'Missing name or channelId' };
            const tpl = await manager.getTemplate(guildId, name);
            if (!tpl) return { success: false, error: 'Template not found' };

            const cfg = tpl.config;
            const giveaway = await manager.createGiveaway(guildId, channelId, {
                prize: cfg.prize,
                duration: cfg.duration,
                winnerCount: cfg.winnerCount || 1,
                createdBy: createdBy || '0',
                hostedBy: createdBy || '0',
                embedColor: cfg.embedColor,
                buttonEmoji: cfg.buttonEmoji,
            });
            return { success: true, giveaway };
        }

        return { success: false, error: 'Invalid action' };
    } catch (error) {
        return { success: false, error: error.message };
    }
};
