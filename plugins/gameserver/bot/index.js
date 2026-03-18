const { BotPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

class GameserverBotPlugin extends BotPlugin {
    constructor() {
        super({
            name: 'gameserver',
            displayName: 'GameServer',
            description: 'GameServer Plugin für Discord-Integration',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
            icon: 'fa-solid fa-server',
            baseDir: __dirname,
            ownerOnly: false
        });
        
        this.Logger = ServiceManager.get("Logger");
        this.dbService = ServiceManager.get("dbService");
    }




}
module.exports = new GameserverBotPlugin();