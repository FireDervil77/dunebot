'use strict';

/**
 * Nachrichtenvorlagen je Guild (G-08, K382, 2026-11-14, F-G10 Punkt 2 A).
 *
 * `guild_vorlagen`: eine Zeile je Guild und Anlass. Der Anlass beginnt mit dem
 * Namen des Plugins, dem er gehört (`greeting:willkommen`). Welche Anlässe es
 * gibt, erklärt jedes Plugin in seiner package.json unter `vorlagen`.
 *
 * `inhalt` ist die Vorlage in der einen Form des Kerns (siehe
 * `packages/dunebot-sdk/lib/Vorlage.js`): Ausgabeform (Text, Embed,
 * Components V2) und dieselben Felder für alle Formen. Geprüft wird beim
 * Speichern, nicht hier.
 *
 * Keine Discord-ID eines Mitglieds. Geht mit der Guild
 * (`plugins/core/package.json` `guildInhalte`).
 */
module.exports = {
    description: 'Nachrichtenvorlagen je Guild und Anlass (G-08)',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS guild_vorlagen (
                guild_id      VARCHAR(20)  NOT NULL,
                anlass        VARCHAR(80)  NOT NULL,
                inhalt        LONGTEXT     CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(inhalt)),
                geaendert_am  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
                PRIMARY KEY (guild_id, anlass)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS guild_vorlagen');
    }
};
