'use strict';

/**
 * Mitglieder gestalten ihre Karte mit (Leveling LV-2b, K382, 2026-11-15).
 *
 * `guild_bildkarten` bekommt zwei Freigaben je Nutzung, Vorgabe aus:
 *   mitglied_schablone  Mitglieder dürfen die Schablone ihrer Karte wählen
 *   mitglied_farbe      Mitglieder dürfen die Akzentfarbe ihrer Karte wählen
 *
 * `mitglied_bildkarten`: die Wahl eines Mitglieds, eine Zeile je Guild,
 * Mitglied und Nutzung (Plugin und erklärte Karte). `vorlage` NULL = wie die
 * Guild, `akzent` NULL = Farbe der Guild. Ein Bild wählen Mitglieder nie.
 * Geschrieben nur über `Bildkarte.speichereWahl` (Profilseite, `/levels
 * style`); gelesen in `Bildkarte.zeichneNutzung`, und nur, solange die Guild
 * es freigibt.
 *
 * Mitglied löscht seine Daten: Zeilen gehen (`plugins/core/package.json`
 * `mitgliedInhalte`). Guild geht: Zeilen gehen (`guildInhalte`). Keine Frist.
 *
 * Spalten über INFORMATION_SCHEMA, damit die Migration auch ein zweites Mal
 * durchläuft.
 */
module.exports = {
    description: 'Bildkarten: Freigaben für Mitglieder und mitglied_bildkarten (LV-2b)',

    async up(db) {
        const spalten = new Set((await db.query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'guild_bildkarten'"
        ) || []).map((z) => z.COLUMN_NAME));
        if (!spalten.has('mitglied_schablone')) {
            await db.query('ALTER TABLE guild_bildkarten ADD COLUMN mitglied_schablone TINYINT(1) NOT NULL DEFAULT 0 AFTER werte');
        }
        if (!spalten.has('mitglied_farbe')) {
            await db.query('ALTER TABLE guild_bildkarten ADD COLUMN mitglied_farbe TINYINT(1) NOT NULL DEFAULT 0 AFTER mitglied_schablone');
        }
        await db.query(`
            CREATE TABLE IF NOT EXISTS mitglied_bildkarten (
                guild_id      VARCHAR(20)  NOT NULL,
                mitglied_id   VARCHAR(20)  NOT NULL,
                plugin        VARCHAR(32)  NOT NULL,
                karte         VARCHAR(81)  NOT NULL,
                vorlage       VARCHAR(81)  NULL,
                akzent        CHAR(7)      NULL,
                geaendert_am  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
                PRIMARY KEY (guild_id, mitglied_id, plugin, karte),
                KEY idx_mitglied (mitglied_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS mitglied_bildkarten');
        await db.query('ALTER TABLE guild_bildkarten DROP COLUMN mitglied_farbe, DROP COLUMN mitglied_schablone');
    }
};
