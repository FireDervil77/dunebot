'use strict';

/**
 * Der Menüpunkt „Widget-Bereiche" führte auf eine eigene Seite, auf der die
 * Karten des Dashboards sortiert wurden. Das Anordnen findet inzwischen im
 * Dashboard selbst statt, die Seite ist entfernt — der Menüpunkt würde also
 * ins Leere zeigen.
 *
 * Die Einträge liegen pro Guild in der Datenbank, deshalb reicht es nicht,
 * sie aus `KernNavigation.js` zu nehmen.
 */
module.exports = {
    description: 'Menüpunkt der entfernten Widget-Seite aus der Navigation nehmen',

    async up(db) {
        await db.query(
            "DELETE FROM guild_nav_items WHERE title = 'NAV.THEMES_WIDGETS' OR url LIKE '%/themes/widgets'"
        );
    },

    async down(db) {
        // Bewusst leer: Die Seite gibt es nicht mehr, ein Menüpunkt darauf
        // wäre ein toter Verweis. Wer sie zurückholt, meldet den Eintrag über
        // KernNavigation.js neu an.
    }
};
