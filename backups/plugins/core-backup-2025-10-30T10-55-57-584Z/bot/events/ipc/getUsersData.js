/**
 * IPC-Handler: GET_USERS_DATA
 * Gibt User-Daten (Username, Avatar, etc.) für eine Liste von User IDs zurück
 * 
 * @param {Object} payload - IPC Payload
 * @param {string[]} payload.userIds - Array von Discord User IDs
 * @param {import('discord.js').Client} client - Discord Client
 * @returns {Object} Response mit User-Daten
 * 
 * @author FireBot Team
 */
module.exports = async (payload, client) => {
    const { userIds } = payload;
    
    if (!Array.isArray(userIds) || userIds.length === 0) {
        return {
            success: false,
            error: 'Invalid userIds array',
            users: {}
        };
    }

    try {
        const users = {};
        
        // User-Daten für jede ID holen
        for (const userId of userIds) {
            try {
                // Versuche User aus Cache zu holen
                let user = client.users.cache.get(userId);
                
                // Falls nicht im Cache, via API fetchen
                if (!user) {
                    user = await client.users.fetch(userId).catch(() => null);
                }
                
                if (user) {
                    users[userId] = {
                        id: user.id,
                        username: user.username,
                        discriminator: user.discriminator,
                        avatar: user.avatar,
                        avatarURL: user.displayAvatarURL({ dynamic: true, size: 128 }),
                        tag: user.tag,
                        bot: user.bot
                    };
                } else {
                    // User nicht gefunden - Fallback
                    users[userId] = {
                        id: userId,
                        username: 'Unbekannt',
                        discriminator: '0000',
                        avatar: null,
                        avatarURL: null,
                        tag: `Unbekannt#0000`,
                        bot: false
                    };
                }
            } catch (userErr) {
                console.error(`[IPC] Error fetching user ${userId}:`, userErr.message);
                // Fallback bei Fehler
                users[userId] = {
                    id: userId,
                    username: 'Fehler',
                    discriminator: '0000',
                    avatar: null,
                    avatarURL: null,
                    tag: `Fehler#0000`,
                    bot: false
                };
            }
        }

        return {
            success: true,
            users
        };
        
    } catch (error) {
        console.error('[IPC] Error in getUsersData:', error);
        return {
            success: false,
            error: error.message,
            users: {}
        };
    }
};
