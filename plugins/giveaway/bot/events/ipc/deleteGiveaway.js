/**
 * IPC Handler: Delete a giveaway from the dashboard
 */
module.exports = async (payload, client) => {
    const { giveawayId } = payload;
    if (!client.giveawayManager) return { success: false, error: 'Giveaway system not available' };

    try {
        await client.giveawayManager.deleteGiveaway(giveawayId);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
};
