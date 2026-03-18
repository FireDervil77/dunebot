'use strict';

const { BotPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

/**
 * Masterserver Bot-Plugin
 * Stellt /daemon Slash-Commands für Rootserver-Verwaltung bereit.
 *
 * Commands (bot/commands/):
 *   daemon.js  — /daemon list | status | register | apikey | delete
 *
 * @extends {BotPlugin}
 */
class MasterserverBotPlugin extends BotPlugin {
    constructor() {
        super({
            name: 'masterserver',
            displayName: 'Masterserver',
            description: 'Rootserver & Daemon-Verwaltung via Discord',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireDervil',
            icon: 'fa-solid fa-server',
            baseDir: __dirname,
            ownerOnly: false,
        });

        ServiceManager.get('Logger').debug('[Masterserver] Bot-Plugin initialisiert');
    }
}

module.exports = new MasterserverBotPlugin();