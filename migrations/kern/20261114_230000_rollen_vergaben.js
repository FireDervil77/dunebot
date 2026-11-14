'use strict';

/**
 * Buch der Rollenvergabe (G-07, F-G12, K382, 2026-11-14).
 *
 * `rollen_vergaben`: ein Eintrag je Guild, Mitglied, Rolle und Besitzer. Der
 * Besitzer ist das System, das die Rolle gab (`streaming:live`,
 * `greeting:autorolle`, `discord:rollenmenue`, `kern:unterstuetzer` …),
 * `bezug` sagt optional woher (Menü-, Ziel-ID). Geschrieben wird nur über
 * `Rollen` im SDK, und nur im Bot (`dunebot-sdk/lib/Rollen.js`).
 *
 * Mitglied löscht seine Daten: Einträge gehen, die Rolle in Discord bleibt
 * (`plugins/core/package.json` `mitgliedInhalte`). Guild geht: Einträge gehen
 * (`guildInhalte`). Keine Frist: Das Buch folgt Discord (Kern-Ereignisse und
 * `core:rollen-abgleich`).
 *
 * `streaming_role_grants` geht in einer Migration des streaming-Plugins darin
 * auf (`plugins/streaming/migrations/20261114_230000_rollenbuch_in_den_kern.js`).
 */
module.exports = {
    description: 'Buch der Rollenvergabe mit Besitzer (G-07)',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS rollen_vergaben (
                guild_id     VARCHAR(20)  NOT NULL,
                mitglied_id  VARCHAR(20)  NOT NULL,
                rolle_id     VARCHAR(20)  NOT NULL,
                besitzer     VARCHAR(73)  NOT NULL,
                bezug        VARCHAR(64)  NULL,
                seit         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (guild_id, mitglied_id, rolle_id, besitzer),
                KEY idx_rolle (guild_id, rolle_id),
                KEY idx_besitzer (guild_id, besitzer),
                KEY idx_mitglied (mitglied_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS rollen_vergaben');
    }
};
