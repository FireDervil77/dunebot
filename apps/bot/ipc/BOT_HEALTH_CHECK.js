'use strict';

const { ServiceManager } = require('dunebot-core');

/**
 * Kern-IPC-Handler: BOT_HEALTH_CHECK
 * Beantwortet Health-Check-Anfragen vom Dashboard.
 * Gibt Bot-Status und Guild-Liste zurück.
 */
module.exports = async (payload, client) => {
    const Logger = ServiceManager.get('Logger');

    try {
        const guildIds = client.guilds.cache.map(g => g.id);

        const healthData = {
            status: 'online',
            uptime: process.uptime(),
            guilds: guildIds,
            guildCount: guildIds.length,
            ping: client.ws.ping,
            timestamp: Date.now(),
            memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024
        };

        Logger.debug(`[IPC] BOT_HEALTH_CHECK: ${healthData.guildCount} Guilds, ${healthData.ping}ms`);
        return healthData;

    } catch (error) {
        Logger.error('[IPC] BOT_HEALTH_CHECK Fehler:', error);
        return {
            status: 'error',
            guilds: [],
            guildCount: 0,
            error: error.message,
            timestamp: Date.now()
        };
    }
};
