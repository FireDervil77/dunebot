'use strict';

/**
 * `TAKT_SEKUNDEN` und `EMBED_FARBE_TWITCH` entfernen — ohne Leser (Baustelle 66, 2026-10-29).
 *
 * Beide standen seit August in `plugins/streaming/config.json`, gelesen hat sie
 * kein Code (nachgemessen am 2026-10-29: nur die Datei selbst nennt sie).
 * Betreiber: „wenn die wirklich nirgends gebraucht werden, entfernen."
 *
 * Aus `config.json` sind sie im selben Commit raus. Der PluginManager sät die
 * Datei per ensureConfig in `configs` und löscht nie — dort stand je eine
 * gemeinsame Zeile. Die räumt diese Migration.
 *
 * `down` stellt nichts wieder her: Es wären wieder zwei Werte ohne Leser.
 */
module.exports = {
    description: 'Streaming: zwei Schlüssel ohne Leser aus configs entfernen (Baustelle 66)',

    async up(db) {
        await db.query("DELETE FROM configs WHERE plugin_name = 'streaming' AND config_key = 'TAKT_SEKUNDEN'");
        await db.query("DELETE FROM configs WHERE plugin_name = 'streaming' AND config_key = 'EMBED_FARBE_TWITCH'");
    },

    async down() {
        // Absichtlich leer, siehe Kopf.
    }
};
