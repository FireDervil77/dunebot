'use strict';

/**
 * `gameserver_backups.datenbanken` und `.wiederhergestellt` (Stufe 11 S6,
 * 2026-10-28).
 *
 *   datenbanken        JSON-Liste der Nummern, deren Dump im Archiv liegt
 *                      (`[1]`). NULL = vor S6 gesichert oder ohne Datenbank —
 *                      dann bringt die Wiederherstellung keine zurück.
 *   wiederhergestellt  Was die letzte Wiederherstellung sagte: Hinweise
 *                      (Datenbank nicht mehr da, nicht in der Sicherung) oder
 *                      ihr Fehler. Bis heute setzte ein Fehlschlag die Zeile
 *                      nur zurück auf „completed" und schrieb ins Log — wer
 *                      im Panel nachsah, sah nichts. Mit S6 gibt es einen
 *                      Fehler, den man sehen MUSS: Dateien zurück, Datenbank
 *                      leer.
 */
module.exports = {
    description: 'gameserver_backups.datenbanken/wiederhergestellt — Datenbank in der Sicherung (Stufe 11 S6)',

    async up(db) {
        const [dbs] = await db.query("SHOW COLUMNS FROM gameserver_backups LIKE 'datenbanken'");
        if (!dbs) {
            await db.query(`
                ALTER TABLE gameserver_backups
                  ADD COLUMN datenbanken VARCHAR(255) DEFAULT NULL
                  COMMENT 'JSON-Nummern der Datenbanken im Archiv (S6); NULL = keine'
                  AFTER size_bytes
            `);
        }
        const [wh] = await db.query("SHOW COLUMNS FROM gameserver_backups LIKE 'wiederhergestellt'");
        if (!wh) {
            await db.query(`
                ALTER TABLE gameserver_backups
                  ADD COLUMN wiederhergestellt TEXT DEFAULT NULL
                  COMMENT 'Was die letzte Wiederherstellung sagte (Hinweise oder Fehler)'
                  AFTER error_message
            `);
        }
    },

    async down(db) {
        for (const spalte of ['wiederhergestellt', 'datenbanken']) {
            const [da] = await db.query(`SHOW COLUMNS FROM gameserver_backups LIKE '${spalte}'`);
            if (da) await db.query(`ALTER TABLE gameserver_backups DROP COLUMN ${spalte}`);
        }
    }
};
