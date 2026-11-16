'use strict';

/**
 * Logging - Bot-Plugin (LG-1a, LG-1b Teil 1, K382, 2026-11-16).
 *
 * Erfasser unter `bot/events/`: Mitglieder, Bots, Server und Struktur,
 * Einladungen. Jedes Ereignis geht durch `bot/erfasser.js` (Kategorie
 * irgendwo an → Regeln der Guild → Zeile). Nur Metadaten; Inhalte erst mit
 * Stufe 2 nach der Pflichtentscheidung (F-LG2). Zustellung in Kanäle kommt
 * mit LG-1d.
 *
 * Den Täter liefert seit LG-1c (2026-11-16) der Zuordner (`bot/zuordner.js`)
 * aus `guildAuditLogEntryCreate`: Ereignisse, zu denen Discord einen
 * Audit-Eintrag schreibt, warten bis zu 5 s darauf.
 */

const { BotPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

class LoggingBotPlugin extends BotPlugin {
    constructor() {
        super({
            name: 'logging',
            displayName: 'Logging',
            description: 'Protokoll der Guild: Discord-Ereignisse und Fachereignisse der Plugins',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
            icon: 'fa-solid fa-clipboard-list',
            baseDir: __dirname,
            ownerOnly: false
        });
    }

    async onEnable() {
        ServiceManager.get('Logger').success('[Logging] Plugin aktiviert');
    }
}

module.exports = new LoggingBotPlugin();
