const { BotPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');
const GiveawayManager = require('./managers/GiveawayManager');

class GiveawayBotPlugin extends BotPlugin {
    constructor() {
        super({
            name: 'giveaway',
            displayName: 'Giveaway',
            description: 'Giveaway-System für Discord',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
            icon: 'fa-solid fa-gift',
            baseDir: __dirname,
            ownerOnly: false
        });
    }

    async onEnable(client) {
        const Logger = ServiceManager.get('Logger');
        Logger.info('[Giveaway] Plugin wird aktiviert...');

        // GiveawayManager initialisieren und am Client registrieren
        client.giveawayManager = new GiveawayManager(client);
        await client.giveawayManager.restoreTimers();

        Logger.success('[Giveaway] Plugin aktiviert');
    }

    async onDisable(client) {
        const Logger = ServiceManager.get('Logger');
        Logger.info('[Giveaway] Plugin wird deaktiviert...');

        if (client.giveawayManager) {
            client.giveawayManager.destroy();
            delete client.giveawayManager;
        }

        Logger.success('[Giveaway] Plugin deaktiviert');
    }
}

module.exports = new GiveawayBotPlugin();
