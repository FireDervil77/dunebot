/**
 * SuperAdmin Bot Plugin
 * Leeres Plugin - SuperAdmin ist nur für das Dashboard
 * 
 * @author FireDervil
 */

const { BotPlugin } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

class SuperAdminBotPlugin extends BotPlugin {
    constructor(client) {
        super({
            name: 'superadmin',
            displayName: 'SuperAdmin',
            description: 'Bot-Owner Management Panel (Dashboard-only)',
            version: '1.0.0',
            author: 'FireDervil'
        });
        
        this.client = client;
    }

    /**
     * Plugin aktivieren (keine Bot-Funktionalität)
     */
    async onEnable(client) {
        const Logger = ServiceManager.get('Logger');
        Logger.info('[SuperAdmin Bot] Plugin geladen (Dashboard-only, keine Bot-Funktionen)');
    }

    /**
     * Guild-spezifische Aktivierung (keine Aktion)
     */
    async onGuildEnable(guildId) {
        const Logger = ServiceManager.get('Logger');
        Logger.debug(`[SuperAdmin Bot] Aktiviert für Guild ${guildId} (keine Aktion erforderlich)`);
    }

    /**
     * Plugin deaktivieren
     */
    async onDisable() {
        const Logger = ServiceManager.get('Logger');
        Logger.info('[SuperAdmin Bot] Plugin deaktiviert');
    }

    /**
     * Guild-spezifische Deaktivierung
     */
    async onGuildDisable(guildId) {
        const Logger = ServiceManager.get('Logger');
        Logger.debug(`[SuperAdmin Bot] Deaktiviert für Guild ${guildId}`);
    }
}

module.exports = SuperAdminBotPlugin;
