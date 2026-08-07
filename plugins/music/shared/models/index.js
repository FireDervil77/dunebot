/**
 * Modelle des Musik-Plugins.
 *
 * Die laufende Warteschlange steht bewusst nicht dabei - die haengt an der
 * Sprachverbindung des Bots und lebt nur im Arbeitsspeicher.
 */
module.exports = {
    MusicSettings: require('./MusicSettings'),
    MusicHistory: require('./MusicHistory'),
    MusicPlaylists: require('./MusicPlaylists')
};
