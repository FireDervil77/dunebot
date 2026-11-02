'use strict';

/**
 * FireBus, Etappe 3: Meldungen der Fahrkartenkontrolle (Linie V, F9).
 *
 * `helpers/FireBusKontrolle.js` schreibt je Stunde, Daemon, Name und Grund eine Zeile
 * und hebt sie 30 Tage auf. Nutzlasten stehen hier nie.
 */
module.exports = {
    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS firebus_kontrolle (
                stunde     DATETIME NOT NULL,
                daemon_id  VARCHAR(64) NOT NULL,
                name       VARCHAR(80) NOT NULL,
                grund      ENUM('unbekannt', 'richtung', 'groesse', 'tempo') NOT NULL,
                anzahl     BIGINT UNSIGNED NOT NULL DEFAULT 0,
                zuletzt    DATETIME NOT NULL,
                PRIMARY KEY (stunde, daemon_id, name, grund),
                KEY idx_zuletzt (zuletzt)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS firebus_kontrolle');
    }
};
