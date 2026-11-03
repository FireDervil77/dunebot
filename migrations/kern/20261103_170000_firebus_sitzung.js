'use strict';

/**
 * FireBus Etappe 4, Paket 5: die Sitzungsnummer des Dashboards.
 *
 * Jeder Start würfelt eine Sitzung für die Innenhaut, ihre Nummer muss größer sein als
 * die letzte, sonst weisen die Daemons sie als ältere ab. Die Uhr allein reicht dafür
 * nicht, sie kann zurückspringen. Eine Zeile, `helpers/Innenhaut.js` schreibt sie.
 */
module.exports = {
    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS firebus_sitzung (
                id      TINYINT UNSIGNED NOT NULL,
                nummer  BIGINT UNSIGNED NOT NULL,
                PRIMARY KEY (id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS firebus_sitzung');
    }
};
