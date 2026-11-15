'use strict';

/**
 * Messprobe Nachrichtenmenge (G-18, K382, 2026-11-15).
 *
 * Leveling und Logging speichern je Nachricht. Wie viele Nachrichten in
 * unseren Guilds anfallen, hat bisher niemand gemessen. Der Bot zählt sieben
 * Tage lang je Guild und Stunde, nur Anzahlen, kein Inhalt, keine Mitglieds-ID
 * (`apps/bot/helpers/Messprobe.js`). Ausgewertet wird mit
 * `node scripts/messprobe-auswerten.js`.
 *
 * Spalten:
 *   stunde            Beginn der Stunde in UTC
 *   menschen, bots    neue Nachrichten (Webhooks zählen als Bot)
 *   inhalt_bytes      Länge des Textes in UTF-8-Bytes, Summe (für die
 *                     Speicherrechnung im Logging)
 *   anhaenge          Anzahl der Anhänge
 *   mitglied_minuten  verschiedene Paare (Mitglied, Minute) unter den
 *                     Menschen = Schreibzugriffe von Leveling bei 60 s Takt
 *   bearbeitet        Bearbeitungen mit neuem Bearbeitungszeitpunkt
 *   geloescht         gelöschte Nachrichten, einzeln und gesammelt
 *
 * Guild geht: Zeilen gehen (`plugins/core/package.json` `guildInhalte`).
 * Die Tabelle fällt mit dem Zähler wieder weg, sobald G-18 ausgewertet ist.
 */
module.exports = {
    description: 'Messprobe Nachrichtenmenge je Guild und Stunde (G-18)',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS messprobe_nachrichten (
                guild_id          VARCHAR(20)     NOT NULL,
                stunde            DATETIME        NOT NULL,
                menschen          INT UNSIGNED    NOT NULL DEFAULT 0,
                bots              INT UNSIGNED    NOT NULL DEFAULT 0,
                inhalt_bytes      BIGINT UNSIGNED NOT NULL DEFAULT 0,
                anhaenge          INT UNSIGNED    NOT NULL DEFAULT 0,
                mitglied_minuten  INT UNSIGNED    NOT NULL DEFAULT 0,
                bearbeitet        INT UNSIGNED    NOT NULL DEFAULT 0,
                geloescht         INT UNSIGNED    NOT NULL DEFAULT 0,
                PRIMARY KEY (guild_id, stunde)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS messprobe_nachrichten');
    }
};
