const { ServiceManager } = require('dunebot-core');

/**
 * IPC Event Handler für das Template-Plugin
 * 
 * Dieser Handler empfängt IPC-Anfragen vom Dashboard und sendet Antworten zurück.
 * Ermöglicht Kommunikation zwischen Bot und Dashboard.
 * 
 * IPC Call Format: 'template:GET_STATS'
 * 
 * @author DuneBot Team
 */
module.exports = {
    /**
     * Name des IPC-Calls (wird vom Dashboard verwendet)
     */
    name: 'template:GET_STATS',
    
    /**
     * Beschreibung des IPC-Calls
     */
    description: 'Holt Plugin-Statistiken für das Dashboard',
    
    /**
     * IPC Handler Funktion
     * 
     * @param {import('discord.js').Client} client - Discord.js Client
     * @param {Object} data - Daten vom Dashboard
     * @param {string} data.guildId - Guild ID
     * @returns {Promise<Object>} Antwort für das Dashboard
     */
    async execute(client, data) {
        const Logger = ServiceManager.get('Logger');
        const { guildId } = data;
        
        Logger.debug(`[Template IPC] Statistiken für Guild ${guildId} angefordert`);
        
        try {
            const guild = client.guilds.cache.get(guildId);
            
            if (!guild) {
                return {
                    success: false,
                    error: 'Guild not found'
                };
            }
            
            // Beispiel: Statistiken sammeln
            const stats = {
                totalMembers: guild.memberCount,
                onlineMembers: guild.members.cache.filter(m => m.presence?.status !== 'offline').size,
                botMembers: guild.members.cache.filter(m => m.user.bot).size,
                channels: {
                    total: guild.channels.cache.size,
                    text: guild.channels.cache.filter(c => c.type === 0).size,
                    voice: guild.channels.cache.filter(c => c.type === 2).size
                },
                roles: guild.roles.cache.size,
                emojis: guild.emojis.cache.size
            };
            
            // Beispiel: Datenbank-Abfrage für Plugin-spezifische Stats
            const dbService = ServiceManager.get('dbService');
            const [result] = await dbService.query(
                'SELECT COUNT(*) as count FROM template_data WHERE guild_id = ?',
                [guildId]
            );
            
            stats.pluginData = result?.count || 0;
            
            return {
                success: true,
                stats
            };
            
        } catch (error) {
            Logger.error('[Template IPC] Fehler beim Abrufen der Statistiken:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
};
