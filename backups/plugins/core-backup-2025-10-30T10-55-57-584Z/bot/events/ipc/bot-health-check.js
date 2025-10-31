/**
 * Bot Health Check IPC-Handler
 * 
 * Beantwortet Health-Check-Anfragen vom Dashboard.
 * Gibt Bot-Status und verfügbare Guild-Liste zurück.
 * 
 * @author FireDervil
 */

const { ServiceManager } = require('dunebot-core');

module.exports = {
    name: 'dashboard:BOT_HEALTH_CHECK',
    
    /**
     * Führt Health-Check aus und gibt Status zurück
     * @param {Client} client - Discord.js Client
     * @param {Object} message - IPC Message
     * @returns {Object} Health-Status
     */
    async execute(client, message) {
        const Logger = ServiceManager.get('Logger');
        
        try {
            // Alle Guild-IDs sammeln
            const guildIds = client.guilds.cache.map(g => g.id);
            
            const healthData = {
                status: 'online',
                uptime: process.uptime(),
                guilds: guildIds,
                guildCount: guildIds.length,
                ping: client.ws.ping,
                timestamp: Date.now(),
                memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024 // MB
            };
            
            Logger.debug(`[IPC Health-Check] ✓ ${healthData.guildCount} Guilds, ${healthData.ping}ms ping`);
            
            return healthData;
            
        } catch (error) {
            Logger.error('[IPC Health-Check] Error:', error);
            
            return { 
                status: 'error',
                guilds: [],
                guildCount: 0,
                error: error.message,
                timestamp: Date.now()
            };
        }
    }
};
