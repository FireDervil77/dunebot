/**
 * Modelle des Musik-Plugins.
 *
 * `MusicSession` haelt die **laufende** Warteschlange. Das war urspruenglich
 * anders gedacht - sie sollte nur im Arbeitsspeicher leben und mit der
 * Sprachverbindung enden. Im Betrieb war das die falsche Abwaegung: nach
 * jedem Neustart war eine muehsam zusammengestellte Liste weg.
 */
module.exports = {
    MusicSettings: require('./MusicSettings'),
    MusicHistory: require('./MusicHistory'),
    MusicPlaylists: require('./MusicPlaylists'),
    MusicSession: require('./MusicSession'),
    MusicFiles: require('./MusicFiles')
};
