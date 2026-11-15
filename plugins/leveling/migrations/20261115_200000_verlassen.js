'use strict';

/**
 * Leveling: XP beim Verlassen nach einer Frist löschen (LV-1i Teil 2, K382, 2026-11-15).
 *
 * Die Spalte `level_einstellungen.verlassen` (behalten/löschen) gab es seit
 * LV-1a, gelesen hat sie niemand. Jetzt:
 *
 *   verlassen_tage   so viele Tage nach dem Verlassen gehen XP, Verlauf und
 *                    Zähler (0 = in der nächsten Nacht). Vorgabe 30: Wer aus
 *                    Versehen geht oder kurz gekickt wird, verliert nichts.
 *   level_verlassen  wer wann gegangen ist, solange die Guild „löschen“
 *                    gewählt hat. Der Bot trägt beim Verlassen ein und
 *                    streicht beim Wiederkommen; der Nachtlauf
 *                    `leveling:verlassen` löscht nach der Frist.
 */
module.exports = {
    description: 'Leveling: Frist beim Verlassen (verlassen_tage, level_verlassen)',

    async up(db) {
        const spalten = await db.query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'level_einstellungen' AND COLUMN_NAME = 'verlassen_tage'");
        if (!spalten.length) {
            await db.query("ALTER TABLE level_einstellungen ADD COLUMN verlassen_tage INT NOT NULL DEFAULT 30 AFTER verlassen");
        }
        await db.query(`
            CREATE TABLE IF NOT EXISTS level_verlassen (
                guild_id     VARCHAR(20) NOT NULL,
                mitglied_id  VARCHAR(20) NOT NULL,
                am           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                PRIMARY KEY (guild_id, mitglied_id),
                KEY idx_am (am),
                KEY idx_mitglied (mitglied_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS level_verlassen');
        await db.query('ALTER TABLE level_einstellungen DROP COLUMN verlassen_tage');
    }
};
