'use strict';

/**
 * Tote Farben entfernen (G-09, K382, 2026-11-14).
 *
 * Zwei Stellen trugen eine Embed-Farbe, die der Bot nie las (nachgemessen am
 * 2026-11-14, nur Datei und Route nennen sie):
 *
 *   - `EMBED_FARBE` in `config.json`: aus der Datei im selben Commit raus;
 *     der PluginManager sät per ensureConfig und löscht nie, deshalb hier die
 *     Zeile in `configs`.
 *   - Spalte `music_settings.embed_color`: Die Route nahm sie an, kein
 *     Formular schickte sie. In allen Zeilen stand die Vorgabe `#1DB954`.
 *
 * Die Farben von music stehen jetzt in der package.json unter `farben` und
 * sind je Guild über den Kern-Teil „Farben dieses Plugins“ einstellbar.
 *
 * `down` legt die Spalte mit der alten Vorgabe wieder an.
 */
module.exports = {
    description: 'Musik: tote Embed-Farbe aus configs und music_settings entfernen (G-09)',

    async up(db) {
        await db.query("DELETE FROM configs WHERE plugin_name = 'music' AND config_key = 'EMBED_FARBE'");
        const spalten = await db.query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'music_settings' AND COLUMN_NAME = 'embed_color'
        `);
        if (spalten.length) await db.query('ALTER TABLE music_settings DROP COLUMN embed_color');
    },

    async down(db) {
        await db.query("ALTER TABLE music_settings ADD COLUMN embed_color VARCHAR(9) NOT NULL DEFAULT '#1DB954'");
    }
};
