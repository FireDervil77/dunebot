const MusicBotPlugin = require('./bot');
const MusicDashboardPlugin = require('./dashboard');

/**
 * Musik-Plugin fuer FireBot
 *
 * Spielt Titel von YouTube, SoundCloud, direkten Adressen und Internetradio.
 * Spotify liefert nur Angaben zum Titel - die Tonspur sucht der Bot dann auf
 * YouTube, wie es alle bekannten Musik-Bots tun.
 */
module.exports = {
    bot: MusicBotPlugin,
    dashboard: MusicDashboardPlugin
};
