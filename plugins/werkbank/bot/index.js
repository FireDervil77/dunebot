const { BotPlugin, VersionHelper } = require('dunebot-sdk');

/**
 * Werkbank — Bot-Teil. Absichtlich leer.
 *
 * Die Werkbank hat im Bot nichts zu tun: Sie spricht mit dem Daemon, nicht mit
 * Discord. Der Teil muss trotzdem da sein: `BasePluginManager.loadPluginModule`
 * gibt im Bot-Kontext ohne `bot`-Export das GANZE Modul zurück („alte
 * Struktur"), und der Bot versuchte dann, `{ dashboard: … }` als Plugin zu
 * starten. Vorbild ist der ebenso leere Bot-Teil des gameserver-Plugins.
 */
class WerkbankBotPlugin extends BotPlugin {
    constructor() {
        super({
            name: 'werkbank',
            displayName: 'Werkbank',
            description: 'Spielpakete bauen (nur Dashboard)',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
            icon: 'fa-solid fa-screwdriver-wrench',
            baseDir: __dirname,
            ownerOnly: false
        });
    }
}

module.exports = new WerkbankBotPlugin();
