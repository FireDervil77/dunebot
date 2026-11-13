'use strict';

/**
 * Aufbewahrung (G-05, K382, 2026-11-14).
 *
 * Was wie lange bleibt, erklärt jedes Plugin in seiner `package.json` unter
 * `aufbewahrung` (Wächter `check-aufbewahrung.js`). Hier steht nur, was davon
 * abweicht, und was der nächtliche Lauf getan hat.
 *
 * `aufbewahrung_fristen`: eine Zeile je Frist (`plugin`, `name`), angelegt
 *   beim ersten Lauf oder wenn der Betreiber die Obergrenze setzt.
 *   `hoechstens_tage` NULL = die Obergrenze aus der Erklärung gilt. Dazu der
 *   letzte Lauf je Frist für /admin/aufbewahrung. Keine Guild, keine
 *   Discord-ID: Die Tabelle gehört dem Betreiber.
 * `aufbewahrung_tage`: was eine Guild für eine Frist eingestellt hat (nur bei
 *   Fristen mit `guild: true`). Ohne Zeile gilt die Vorgabe. Geht mit der
 *   Guild (`plugins/core/package.json` `guildInhalte`).
 */
module.exports = {
    description: 'Aufbewahrung: Obergrenzen, Einstellung je Guild, letzter Lauf (G-05)',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS aufbewahrung_fristen (
                plugin             VARCHAR(32)  NOT NULL,
                name               VARCHAR(64)  NOT NULL,
                hoechstens_tage    SMALLINT UNSIGNED DEFAULT NULL,
                geaendert_am       DATETIME(3)  DEFAULT NULL,
                letzter_lauf       DATETIME(3)  DEFAULT NULL,
                zuletzt_geloescht  INT UNSIGNED NOT NULL DEFAULT 0,
                geloescht_gesamt   BIGINT UNSIGNED NOT NULL DEFAULT 0,
                letzter_fehler     VARCHAR(512) DEFAULT NULL,
                PRIMARY KEY (plugin, name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS aufbewahrung_tage (
                guild_id      VARCHAR(20)  NOT NULL,
                plugin        VARCHAR(32)  NOT NULL,
                name          VARCHAR(64)  NOT NULL,
                tage          SMALLINT UNSIGNED NOT NULL,
                geaendert_am  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                PRIMARY KEY (guild_id, plugin, name),
                KEY idx_frist (plugin, name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS aufbewahrung_tage');
        await db.query('DROP TABLE IF EXISTS aufbewahrung_fristen');
    }
};
