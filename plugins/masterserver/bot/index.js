/**
 * Greeting-Plugin für DuneBot - Bot-Teil
 * 
 * @author DuneBot Team
 */
const path = require('path');
const { BotPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

/**
 * Greeting-Plugin für den Bot-Teil von DuneBot
 * 
 * ANLEITUNG:
 * 1. Ersetzen Sie 'template' durch den Namen Ihres Plugins
 * 2. Aktualisieren Sie displayName, description, author
 * 3. Implementieren Sie die Lifecycle-Methoden nach Bedarf
 * 4. Fügen Sie Commands in bot/commands/ hinzu
 * 5. Fügen Sie Events in bot/events/ hinzu
 * 
 * @extends {BotPlugin}
 * @author FireBot Team
 */
class MasterserverBotPlugin extends BotPlugin {
    /**
     * Erstellt eine neue Instanz des Masterserver-Bot-Plugins
     */
    constructor() {
        super({
            name: 'masterserver',
            displayName: 'Masterserver - Plugin',
            description: 'Ein Masterserver-Plugin für FireBot',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireDervil',
            icon: 'fa-solid fa-puzzle-piece',
            baseDir: __dirname,
            ownerOnly: false
        });
        
        const Logger = ServiceManager.get("Logger");
        Logger.debug('[Masterserver]-Bot-Plugin initialisiert');
    }

}
module.exports = new MasterserverBotPlugin;