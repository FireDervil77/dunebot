/**
 * IPC Handler: Get giveaway analytics for a guild
 */
module.exports = async (payload, client) => {
    const { guildId } = payload;
    if (!client.giveawayManager) return { success: false, error: 'Giveaway system not available' };
    if (!guildId) return { success: false, error: 'Missing guildId' };

    try {
        const analytics = await client.giveawayManager.getAnalytics(guildId);
        return { success: true, analytics };
    } catch (error) {
        return { success: false, error: error.message };
    }
};
