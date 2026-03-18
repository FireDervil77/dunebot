/**
 * IPC Handler: Blacklist operations (add/remove/list)
 */
module.exports = async (payload, client) => {
    const { guildId, action, userId, reason, blockedBy } = payload;
    if (!client.giveawayManager) return { success: false, error: 'Giveaway system not available' };
    if (!guildId || !action) return { success: false, error: 'Missing required fields' };

    try {
        const manager = client.giveawayManager;

        if (action === 'add') {
            if (!userId || !blockedBy) return { success: false, error: 'Missing userId or blockedBy' };
            const result = await manager.addToBlacklist(guildId, userId, reason || null, blockedBy);
            return { success: !result.error, error: result.error };
        }

        if (action === 'remove') {
            if (!userId) return { success: false, error: 'Missing userId' };
            const result = await manager.removeFromBlacklist(guildId, userId);
            return { success: result.success };
        }

        if (action === 'list') {
            const list = await manager.getBlacklist(guildId);
            return { success: true, blacklist: list };
        }

        return { success: false, error: 'Invalid action' };
    } catch (error) {
        return { success: false, error: error.message };
    }
};
