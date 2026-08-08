'use strict';

/**
 * moderation_logs hatte weder Primaerschluessel noch AUTO_INCREMENT.
 *
 * Folge: `createLog()` scheiterte bei **jeder** Moderationsaktion an
 * `ER_NO_DEFAULT_FOR_FIELD: Field 'id' doesn't have a default value`. Die
 * Tabelle stand bei 0 Zeilen - es gab nie einen Fall, nie eine Fallnummer und
 * nie einen Eintrag im Dashboard-Protokoll.
 *
 * Gleiche Ursache wie bei automod_logs: die Tabelle kam aus einem Import, bei
 * dem die nachgestellten Schluessel fehlten, und die Baseline legt mit
 * `CREATE TABLE IF NOT EXISTS` nichts mehr an, was schon da ist.
 */
module.exports = {
    description: 'moderation_logs: fehlenden Primaerschluessel und AUTO_INCREMENT nachtragen',

    async up(db) {
        const vorhanden = await db.query(
            `SELECT COUNT(*) AS anzahl FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'moderation_logs'`
        );
        if (!Number(vorhanden[0]?.anzahl)) return;

        // Erst der Schluessel - ohne ihn nimmt MariaDB kein AUTO_INCREMENT an.
        const pk = await db.query(
            `SELECT COUNT(*) AS anzahl FROM information_schema.TABLE_CONSTRAINTS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'moderation_logs'
               AND CONSTRAINT_TYPE = 'PRIMARY KEY'`
        );
        if (!Number(pk[0]?.anzahl)) {
            await db.query('ALTER TABLE moderation_logs ADD PRIMARY KEY (id)');
        }

        const spalte = await db.query(
            `SELECT EXTRA FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'moderation_logs'
               AND COLUMN_NAME = 'id'`
        );
        if (!String(spalte[0]?.EXTRA || '').includes('auto_increment')) {
            await db.query('ALTER TABLE moderation_logs MODIFY id INT NOT NULL AUTO_INCREMENT');
        }
    },

    /** Bewusst leer - der alte Zustand war eine unbeschreibbare Tabelle. */
    async down() {
        // absichtlich nichts
    }
};
