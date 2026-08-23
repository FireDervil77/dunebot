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
        ServiceManager.get('Logger').success('[Streaming] Bot-Plugin aktiviert');
    }

    /**
     * @param {Object} client Discord-Client
     */
    async onDisable(client) {
        ServiceManager.get('Logger').info('[Streaming] Bot-Plugin deaktiviert');
    }
}

module.exports = StreamingBotPlugin;
