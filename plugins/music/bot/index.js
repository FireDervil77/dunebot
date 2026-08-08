'use strict';
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

        // Ohne yt-dlp gibt es keinen Ton. Das einmal beim Start deutlich
        // sagen ist allemal besser, als es bei jedem Titel einzeln zu
        // erfahren - und beim letzten Mal hat genau diese fehlende Ansage
        // die Suche unnoetig lang gemacht.
        const { verfuegbar } = require('./quellen/strom');
        const ytdlp = await verfuegbar();
        if (ytdlp.da) {
            Logger.info(`[Musik] yt-dlp ${ytdlp.version} gefunden (${ytdlp.pfad})`);
        } else {
            Logger.error(
                `[Musik] yt-dlp fehlt (gesucht als "${ytdlp.pfad}") - es wird kein Ton abgespielt. ` +
                'Abhilfe: die eigenstaendige Datei nach ~/.local/bin/yt-dlp legen oder YTDLP_PATH setzen.'
            );
        }

        // Gesicherte Warteschlangen wieder aufnehmen.
        //
        // Erst wenn der Client bereit ist - vorher ist der Kanal-
        // Zwischenspeicher leer, und die Pruefung "ist ueberhaupt jemand da"
        // wuerde immer nein sagen. Wird das Plugin im Betrieb eingeschaltet,
        // ist er das laengst, dann geht es sofort los.
        const wiederaufnehmen = () => {
            client.musicManager.wiederherstellen()
                .then(anzahl => {
                    if (anzahl > 0) Logger.info(`[Musik] ${anzahl} Warteschlange(n) wieder aufgenommen`);
                })
                .catch(err => Logger.warn(`[Musik] Wiederaufnahme fehlgeschlagen: ${err.message}`));
        };

        if (client.isReady()) wiederaufnehmen();
        else client.once('ready', wiederaufnehmen);

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

module.exports = new MusicBotPlugin();
