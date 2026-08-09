/**
 * Discord-Plugin für FireBot — Bot-Teil
 *
 * Trägt heute noch keine eigenen Befehle oder Ereignisse: Rollen und Kanäle
 * werden über die IPC-Handler des Kerns (`apps/bot/ipc/`) bedient, die schon
 * vorher da waren und auch von anderen Plugins benutzt werden.
 *
 * Er existiert trotzdem, und zwar aus einem konkreten Grund: Der
 * Plugin-Lader des Bots sucht `plugins/<name>/bot/index.js` und fällt sonst
 * auf `plugins/<name>/index.js` zurück, das keine `BotPlugin`-Instanz ist —
 * das würde beim Start eine Ausnahme werfen
 * (`apps/bot/helpers/PluginManager.js`, Zeile 205 ff.).
 *
 * Ab Paket 2 (Reaktions- und Knopfrollen) kommen hier die Ereignisse hinein.
 *
 * @author FireBot Team
 */

const { BotPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

class DiscordBotPlugin extends BotPlugin {
    constructor() {
        super({
            name: 'discord',
            displayName: 'Discord',
            description: 'Direkter Zugriff auf Discord: Rollen und Kanäle',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
            icon: 'fa-brands fa-discord',
            baseDir: __dirname,
            ownerOnly: false
        });
    }

    /**
     * @param {string} guildId Discord-Guild-ID
     */
    async onGuildEnable(guildId) {
        ServiceManager.get('Logger').debug(`[Discord] Bot-Plugin für Guild ${guildId} aktiviert`);
    }

    /**
     * @param {string} guildId Discord-Guild-ID
     */
    async onGuildDisable(guildId) {
        ServiceManager.get('Logger').debug(`[Discord] Bot-Plugin für Guild ${guildId} deaktiviert`);
    }
}

module.exports = new DiscordBotPlugin();
