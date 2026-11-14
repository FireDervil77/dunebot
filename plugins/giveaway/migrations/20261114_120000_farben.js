'use strict';

/**
 * Farben der Verlosungen (G-09, K382, 2026-11-14).
 *
 * 1. `START_EMBED_COLOR` und `END_EMBED_COLOR` entfernen: ohne Leser
 *    (nachgemessen am 2026-11-14). Aus `dashboard/config.json` im selben
 *    Commit raus; der PluginManager löscht in `configs` nie, deshalb hier.
 * 2. `giveaways.embed_color` darf leer sein. Leer heißt: Die Verlosung nimmt
 *    die Farbe „Akzent“ von giveaway (`Gestaltung.farbe`), also die der Guild
 *    oder die Vorgabe des Plugins `#f59e0b`. Bisher bekam jede neue Verlosung
 *    `#f59e0b` fest eingetragen, und eine Farbe der Guild hätte sie nie
 *    erreicht. Bestehende Zeilen behalten ihren Wert, beim Rollout ändert
 *    sich nichts.
 *
 * `down` füllt leere Werte mit der alten Vorgabe und macht die Spalte wieder
 * Pflicht.
 */
module.exports = {
    description: 'Giveaway: tote Farbschlüssel entfernen, Farbe je Verlosung darf leer sein (G-09)',

    async up(db) {
        await db.query("DELETE FROM configs WHERE plugin_name = 'giveaway' AND config_key IN ('START_EMBED_COLOR', 'END_EMBED_COLOR')");
        await db.query('ALTER TABLE giveaways MODIFY embed_color VARCHAR(7) NULL DEFAULT NULL');
    },

    async down(db) {
        await db.query("UPDATE giveaways SET embed_color = '#f59e0b' WHERE embed_color IS NULL");
        await db.query("ALTER TABLE giveaways MODIFY embed_color VARCHAR(7) NOT NULL DEFAULT '#f59e0b'");
    }
};
