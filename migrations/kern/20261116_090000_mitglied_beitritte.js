'use strict';

/**
 * Beitritte mit erkannter Einladung (G-16, K382, 2026-11-16).
 *
 * `mitglied_beitritte`: eine Zeile je Guild und Mitglied, der letzte Beitritt.
 * Wer wieder beitritt, überschreibt seine Zeile. Geschrieben nur im Bot über
 * `Einladungen` im SDK (`dunebot-sdk/lib/Einladungen.js`), beim Beitritt
 * (Kern-Ereignis `guildMemberAdd`) und beim Verlassen (`verlassen_am`).
 *
 *   art         einladung, vanity, oauth (Bot über OAuth) oder unbekannt
 *   einladung   Code der Einladung, bei vanity der Vanity-Code
 *   einlader_id wer die Einladung angelegt hat; '0' nach „Meine Daten löschen“
 *               des Einladers (anonymisiert)
 *   sicherheit  eindeutig, mehrdeutig oder unbekannt
 *
 * Wozu: Abschiedstext von greeting (`{inviter:*}`), `{invites}` (wie viele
 * über Einladungen dieses Mitglieds kamen und noch da sind), später Logging
 * §3.6 und Clan (Rekrutierung).
 *
 * Mitglied löscht seine Daten: seine Zeilen gehen, als Einlader wird er '0'
 * (`plugins/core/package.json` `mitgliedInhalte`). Guild geht: Zeilen gehen
 * (`guildInhalte`). Frist `core:beitritte` ab `verlassen_am`; wer noch da ist,
 * bleibt.
 */
module.exports = {
    description: 'Beitritte mit erkannter Einladung (G-16)',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS mitglied_beitritte (
                guild_id        VARCHAR(20)  NOT NULL,
                mitglied_id     VARCHAR(20)  NOT NULL,
                art             VARCHAR(16)  NOT NULL,
                einladung       VARCHAR(32)  NULL,
                einlader_id     VARCHAR(20)  NULL,
                sicherheit      VARCHAR(16)  NOT NULL,
                beigetreten_am  DATETIME(3)  NOT NULL,
                verlassen_am    DATETIME(3)  NULL,
                PRIMARY KEY (guild_id, mitglied_id),
                KEY idx_einlader (guild_id, einlader_id),
                KEY idx_mitglied (mitglied_id),
                KEY idx_einlader_global (einlader_id),
                KEY idx_verlassen (verlassen_am)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS mitglied_beitritte');
    }
};
