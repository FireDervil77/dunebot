'use strict';

/**
 * Bisher bestimmte allein der Bereich, wie breit eine Karte ist — in einem
 * Vollbreite-Bereich standen alle Karten untereinander. Mit einer eigenen
 * Breite pro Karte lassen sich zwei nebeneinander stellen.
 *
 * NULL heißt weiterhin „nimm die Vorgabe des Bereichs".
 */
module.exports = {
    description: 'Spaltenbreite pro Widget in der Guild-Konfiguration',

    async up(db) {
        const [vorhanden] = await db.query(
            "SHOW COLUMNS FROM guild_widget_config LIKE 'size'"
        );
        if (vorhanden) return;

        await db.query(`
            ALTER TABLE guild_widget_config
            ADD COLUMN size TINYINT UNSIGNED DEFAULT NULL
                COMMENT 'Override Spaltenbreite 1-12 (NULL = Vorgabe des Bereichs)'
            AFTER position
        `);
    },

    async down(db) {
        await db.query('ALTER TABLE guild_widget_config DROP COLUMN size');
    }
};
