/**
 * Musik - Bot-Plugin
 *
 * Legt beim Aktivieren den MusicManager an und haengt ihn an den Client, damit
 * Befehle, Ereignisse und die IPC-Bruecke ihn erreichen.
 *
 * @author FireBot Team
 */

const { BotPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');
const MusicManager = require('./managers/MusicManager');

class MusicBotPlugin extends BotPlugin {
    constructor() {
        super({
            name: 'music',
            displayName: 'Musik',
            description: 'Musikwiedergabe aus YouTube, Spotify, SoundCloud und direkten Quellen',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
            icon: 'fa-solid fa-music',
            baseDir: __dirname,
            ownerOnly: false
        });
    }

    /**
     * @param {Object} client Discord-Client
     */
    async onEnable(client) {
        const Logger = ServiceManager.get('Logger');
        Logger.info('[Musik] Plugin wird aktiviert...');

        client.musicManager = new MusicManager(client);

        // Einmal beim Start protokollieren, was an Tonwerkzeugen da ist -
        // fehlt Opus oder ffmpeg, bleibt sonst nur ein stummer Bot uebrig.
        try {
            const { generateDependencyReport } = require('@discordjs/voice');
            Logger.debug(`[Musik] Tonwerkzeuge:\n${generateDependencyReport()}`);
        } catch { /* Bericht ist nur eine Hilfe, kein Muss */ }

        Logger.success('[Musik] Plugin aktiviert');
    }

    /**
     * @param {Object} client Discord-Client
     */
    async onDisable(client) {
        const Logger = ServiceManager.get('Logger');

        if (client.musicManager) {
            client.musicManager.zerstoeren();
            delete client.musicManager;
        }

        Logger.success('[Musik] Plugin deaktiviert');
    }
}

module.exports = MusicBotPlugin;
