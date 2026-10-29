'use strict';

/**
 * `DASHBOARD_LOGO_URL` entfernen — ein Schlüssel ohne Leser (Baustelle 129, 2026-10-29).
 *
 * Nachgemessen am 2026-10-29: Gelesen hat den Schlüssel niemand. Geschrieben
 * hat ihn nur der tote core-Router (`plugins/core/dashboard/routes/`, entfernt
 * in 4820a233). In `configs` standen 11 Zeilen (core, shared), alle mit
 * Pfaden, die es nicht gibt: `/images/DuneBot.png` (5) und `/images/logo.png`
 * (6). Betreiber: „entfernen".
 *
 * Im selben Commit aus `guild-defaults.json`, `plugins/core/dashboard/config.json`
 * und den Sprachtexten `LOGO_URL` raus. Der PluginManager sät `config.json` per
 * ensureConfig und löscht nie, deshalb räumt diese Migration den Bestand.
 *
 * `down` stellt nichts wieder her: Es wäre wieder ein Wert ohne Leser.
 */
module.exports = {
    description: 'DASHBOARD_LOGO_URL aus configs entfernen (Baustelle 129)',

    async up(db) {
        await db.query("DELETE FROM configs WHERE plugin_name = 'core' AND config_key = 'DASHBOARD_LOGO_URL'");
    },

    async down() {
        // Absichtlich leer, siehe Kopf.
    }
};
