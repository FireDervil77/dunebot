'use strict';

/**
 * Zeitplan-Register (G-06, K382, 2026-11-13).
 *
 * Eine Zeile je eingetragener Aufgabe (`plugin:aufgabe`), kein Verlauf: der
 * letzte Lauf, seine Dauer, der letzte Fehler und Zähler. Sichtbar unter
 * /admin/zeitplan. Der Verlauf steht im Log des Dashboards.
 *
 * `naechster_lauf` merkt sich, wann die Aufgabe das nächste Mal dran wäre.
 * Liegt er beim Start in der Vergangenheit, war das Dashboard zu der Zeit aus,
 * und der Lauf wird einmal nachgeholt (wenn die Aufgabe das will und ihr Takt
 * gleich geblieben ist). `zustand = 'laeuft'` beim Start heißt: Der Lauf wurde
 * durch den Neustart abgebrochen.
 *
 * Keine Discord-ID, keine Guild: Die Tabelle gehört dem Betreiber.
 */
module.exports = {
    description: 'Zeitplan-Register: Stand je Aufgabe (G-06)',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS zeitplan_laeufe (
                name              VARCHAR(96)  NOT NULL PRIMARY KEY,
                plugin            VARCHAR(32)  NOT NULL,
                takt              VARCHAR(64)  NOT NULL,
                nachholen         TINYINT(1)   NOT NULL DEFAULT 1,
                zustand           VARCHAR(16)  NOT NULL DEFAULT 'bereit',
                laeufe            INT UNSIGNED NOT NULL DEFAULT 0,
                fehler            INT UNSIGNED NOT NULL DEFAULT 0,
                uebersprungen     INT UNSIGNED NOT NULL DEFAULT 0,
                letzter_start     DATETIME(3)  DEFAULT NULL,
                letzter_anlass    VARCHAR(16)  DEFAULT NULL,
                letzte_dauer_ms   INT UNSIGNED DEFAULT NULL,
                letztes_ergebnis  VARCHAR(512) DEFAULT NULL,
                letzter_erfolg_am DATETIME(3)  DEFAULT NULL,
                letzter_fehler    VARCHAR(512) DEFAULT NULL,
                letzter_fehler_am DATETIME(3)  DEFAULT NULL,
                naechster_lauf    DATETIME(3)  DEFAULT NULL,
                eingetragen_am    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                KEY idx_plugin (plugin)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS zeitplan_laeufe');
    }
};
