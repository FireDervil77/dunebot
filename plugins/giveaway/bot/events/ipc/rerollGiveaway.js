/**
 * IPC Handler: Reroll winner from the dashboard
 */
module.exports = async (payload, client) => {
    const { giveawayId, count } = payload;
    if (!client.giveawayManager) return { success: false, error: 'Giveaway system not available' };

    try {
        const result = await client.giveawayManager.rerollGiveaway(giveawayId, count || 1);
        return { success: true, result };
    } catch (error) {
        return { success: false, error: error.message };
    }
};
