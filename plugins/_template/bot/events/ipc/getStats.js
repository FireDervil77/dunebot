/**
 * Beispiel IPC-Event-Handler
 * 
 * IPC-Events ermöglichen Kommunikation zwischen Bot und Dashboard.
 * 
 * Dieser Handler kann vom Dashboard aufgerufen werden:
 * const result = await ipcClient.send('template:GET_STATS', { guildId });
 * 
 * @author DuneBot Team
 * @version 1.0.0
 */

const { ServiceManager } = require('dunebot-core');

/**
 * IPC-Handler: Statistiken abrufen
 * 
 * Event-Name: 'template:GET_STATS'
 * Payload: { guildId: string }
 * Response: { success: boolean, data: Object }
 * 
 * @param {Object} payload - Request-Payload vom Dashboard
 * @param {import('discord.js').Client} client - Discord Client
 * @returns {Promise<Object>} Response-Objekt
 */
async function getStats(payload, client) {
    const Logger = ServiceManager.get('Logger');
    
    try {
        const { guildId } = payload;
        
        // Plugin-Instanz abrufen
        const plugin = client.pluginManager.getPlugin('template');
        if (!plugin) {
            return {
                success: false,
                error: 'Plugin nicht gefunden'
            };
        }

        // Plugin-Stats abrufen
        const stats = plugin.getStats();

        // Guild-spezifische Stats
        let guildStats = null;
        if (guildId) {
            const guild = client.guilds.cache.get(guildId);
            if (guild) {
                const guildSettings = plugin.getGuildSettings(guildId);
                guildStats = {
                    guildName: guild.name,
                    settings: guildSettings,
                    memberCount: guild.memberCount
                };
            }
        }

        return {
            success: true,
            data: {
                global: stats,
                guild: guildStats
            }
        };

    } catch (error) {
        Logger.error('[Template IPC] Fehler in getStats:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

module.exports = getStats;
