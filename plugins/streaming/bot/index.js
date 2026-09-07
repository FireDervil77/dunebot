'use strict';

/**
 * Streaming - Bot-Plugin
 *
 * Der Bot ist hier absichtlich duenn. Erkennung, Zustand und Entscheidung
 * leben im Dashboard-Vorgang - dort kommt der Webhook an und dort steht die
 * Datenbankverbindung. Der Bot bekommt spaeter fertige Auftraege ("poste das
 * in Kanal X") und beantwortet die Befehle, die man waehrend eines Streams
 * braucht.
 *
 * Der Plan dazu: docs/streamer-plugin/01-Schichten-und-Vertraege.md
 *
 * @author FireBot Team
 */

const { BotPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

class StreamingBotPlugin extends BotPlugin {
    constructor() {
        super({
            name: 'streaming',
            displayName: 'Streaming',
            description: 'Live-Benachrichtigungen fuer Twitch, spaeter Kick und YouTube',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
            icon: 'fa-solid fa-satellite-dish',
            baseDir: __dirname,
            ownerOnly: false
        });
    }

    /**
     * @param {Object} client Discord-Client
     */
    async onEnable(client) {
        // **Hier haengt sich Twitch an die Verlosung.** Die Ziehung laeuft im
        // Bot, also muss der Eintrag im Bot stehen. Das Verlosungs-Plugin
        // erfaehrt dadurch nie den Namen "streaming" - es fragt nur, wer ihm
        // Lose liefert. Ist dieses Plugin aus, fragt es ins Leere und zieht
        // wie eh und je.
        require('../shared/lose').anmelden();
        ServiceManager.get('Logger').success('[Streaming] Bot-Plugin aktiviert');
    }

    /**
     * @param {Object} client Discord-Client
     */
    async onDisable(client) {
        // Der Eintrag muss weg. Bliebe er stehen, zoege die Verlosung weiter
        // Lose aus einem Plugin, das gar nicht mehr laeuft - und der Gewinner
        // erfuehre nie davon, weil niemand mehr in den Chat schreibt.
        require('../shared/lose').abmelden();
        ServiceManager.get('Logger').info('[Streaming] Bot-Plugin deaktiviert');
    }
}

// **Eine Instanz, keine Klasse.** `PluginManager.js:241` prueft
// `plugin instanceof BotPlugin` und weist die Klasse selbst ab:
// "Kein gueltiges Plugin (Exportiert es eine Instanz der BotPlugin-Klasse?)".
//
// Auf der Dashboard-Seite ist es genau andersherum - dort wird die Klasse
// erwartet und mit `new Plugin(app)` erzeugt. Diese Asymmetrie kostete am
// 2026-08-24 eine Fehlersuche: Der Bot lud das Plugin nicht, kannte damit
// `streaming:post` nicht, und die Ankuendigung blieb aus.
module.exports = new StreamingBotPlugin();
