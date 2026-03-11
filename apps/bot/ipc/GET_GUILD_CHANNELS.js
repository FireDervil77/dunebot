'use strict';

/**
 * Kern-IPC-Handler: GET_GUILD_CHANNELS
 * Gibt alle sichtbaren Text-Channels einer Guild zurück (für Dashboard-Dropdowns).
 */
module.exports = (payload, client) => {
    const { guildId } = payload;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
        return { success: false, error: 'Guild not found', channels: [] };
    }

    try {
        const textChannels = guild.channels.cache
            .filter(channel => channel.type === 0 && channel.viewable)
            .sort((a, b) => a.position - b.position)
            .map(channel => ({
                id: channel.id,
                name: channel.name,
                position: channel.position,
                parentId: channel.parentId,
                parentName: channel.parent ? channel.parent.name : null
            }));

        return { success: true, channels: textChannels };

    } catch (error) {
        return { success: false, error: error.message, channels: [] };
    }
};
