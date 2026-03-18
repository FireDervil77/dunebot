/**
 * IPC Handler: Create a giveaway from the dashboard
 * Called via ipcServer.broadcast('giveaway:createGiveaway', payload)
 */
module.exports = async (payload, client) => {
    const { guildId, channelId, prize, duration, winnerCount, createdBy, hostedBy, allowedRoles } = payload;

    if (!client.giveawayManager) return { success: false, error: 'Giveaway system not available' };
    if (!guildId || !channelId || !prize || !duration) {
        return { success: false, error: 'Missing required fields' };
    }

    try {
        const giveaway = await client.giveawayManager.createGiveaway(guildId, channelId, {
            prize,
            duration: parseInt(duration),
            winnerCount: parseInt(winnerCount) || 1,
            createdBy: createdBy || null,
            hostedBy: hostedBy || createdBy || null,
            allowedRoles: allowedRoles || null,
        });

        return { success: true, giveaway };
    } catch (error) {
        return { success: false, error: error.message };
    }
};
