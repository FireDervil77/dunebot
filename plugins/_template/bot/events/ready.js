/**
 * Beispiel Event-Handler: ready
 * 
 * Dieses Event wird ausgelöst, wenn der Bot bereit ist.
 * 
 * Event-Handler-Struktur:
 * - name: Event-Name (z.B. 'ready', 'messageCreate', etc.)
 * - once: true = Event wird nur einmal ausgelöst, false = bei jedem Trigger
 * - execute: Event-Handler-Funktion
 * 
 * @author DuneBot Team
 * @version 1.0.0
 */

const { ServiceManager } = require('dunebot-core');

module.exports = {
    name: 'ready',
    once: true, // Nur einmal beim Bot-Start

    /**
     * Event-Handler-Funktion
     * 
     * @param {import('discord.js').Client} client - Discord Client
     */
    async execute(client) {
        const Logger = ServiceManager.get('Logger');
        const plugin = client.pluginManager.getPlugin('template');

        if (!plugin) {
            return;
        }

        try {
            Logger.info(`[Template] Bot ist bereit! Angemeldet als ${client.user.tag}`);
            
            // Beispiel: Stats initialisieren
            const stats = plugin.getStats();
            Logger.debug(`[Template] Plugin-Stats:`, stats);

            // Beispiel: Periodische Aufgabe starten (alle 60 Sekunden)
            setInterval(() => {
                const currentStats = plugin.getStats();
                Logger.debug(`[Template] Stats-Update:`, currentStats);
            }, 60000);

        } catch (error) {
            Logger.error('[Template] Fehler im ready-Event:', error);
        }
    }
};
