const { ServiceManager } = require('dunebot-core');

/**
 * Ready Event für das Template-Plugin
 * 
 * Dieses Event wird ausgelöst, wenn der Bot bereit ist und sich mit Discord verbunden hat.
 * Wird nur EINMAL beim Bot-Start ausgeführt.
 * 
 * @author DuneBot Team
 */
module.exports = {
    /**
     * Name des Events (muss mit Discord.js Event-Namen übereinstimmen)
     */
    name: 'ready',
    
    /**
     * Event nur einmal ausführen?
     * Bei 'ready' sollte dies true sein
     */
    once: true,
    
    /**
     * Event Handler Funktion
     * 
     * @param {import('discord.js').Client} client - Discord.js Client
     * @returns {Promise<void>}
     */
    async execute(client) {
        const Logger = ServiceManager.get('Logger');
        
        Logger.info(`[Template] Bot ist bereit! Eingeloggt als ${client.user.tag}`);
        Logger.info(`[Template] Der Bot ist in ${client.guilds.cache.size} Servern`);
        
        // Beispiel: Periodische Aufgabe starten
        // startPeriodicTask(client);
        
        // Beispiel: Bot-Status setzen
        // client.user.setPresence({
        //     activities: [{ name: 'Template Plugin', type: 'PLAYING' }],
        //     status: 'online'
        // });
    }
};

/**
 * Beispiel für eine periodische Aufgabe
 * 
 * @param {import('discord.js').Client} client - Discord Client
 */
function startPeriodicTask(client) {
    const Logger = ServiceManager.get('Logger');
    
    // Alle 5 Minuten ausführen
    setInterval(() => {
        Logger.debug(`[Template] Periodische Aufgabe läuft - ${client.guilds.cache.size} Guilds`);
        
        // Hier könnte z.B. Statistik-Update oder Daten-Cleanup erfolgen
    }, 5 * 60 * 1000);
}
