/**
 * IPC-Handler: GET_GUILD_CHANNELS
 * Gibt alle Text-Channels einer Guild zurück (für Dashboard-Dropdowns)
 * 
 * @param {Object} payload - IPC Payload
 * @param {string} payload.guildId - Guild ID
 * @param {import('discord.js').Client} client - Discord Client
 * @returns {Object} Response mit Channel-Liste
 * 
 * @author FireBot Team
 */
module.exports = (payload, client) => {
    const { guildId } = payload;
    
    // Guild aus Cache holen
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
        return {
            success: false,
            error: 'Guild not found',
            channels: []
        };
    }

    try {
        // Nur Text-Channels (Type 0 = GUILD_TEXT)
        const textChannels = guild.channels.cache
            .filter(channel => channel.type === 0 && channel.viewable)
            .sort((a, b) => a.position - b.position)
            .map(channel => {
                // Parent Category Name
                const parentName = channel.parent ? channel.parent.name : null;
                
                return {
                    id: channel.id,
                    name: channel.name,
                    position: channel.position,
                    parentId: channel.parentId,
                    parentName: parentName
                };
            });

        return {
            success: true,
            channels: textChannels
        };
        
    } catch (error) {
        console.error('[IPC] Error fetching guild channels:', error);
        return {
            success: false,
            error: error.message,
            channels: []
        };
    }
};
