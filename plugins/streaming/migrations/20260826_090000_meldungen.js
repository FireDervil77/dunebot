'use strict';

/*
 * Hinweis zum Dateinamen: Er traegt "20260826", angelegt wurde die Migration
 * aber am **2026-08-25**. Der Tagesstempel war um einen Tag versetzt; das fiel
 * erst auf, als die Uhrzeiten des Servers gegen die Papiere gehalten wurden.
 *
 * Der Name bleibt trotzdem stehen: Er ist der Schluessel in der Tabelle
 * `migrations` und die Migration ist dort bereits verbucht. Ein Umbenennen
 * liesse sie als "neu" erscheinen und wuerde sie ein zweites Mal ausfuehren.
 */

/**
 * Merken, welche Stoerung bereits gemeldet wurde.
 *
 * Ohne diese Spalte gibt es nur zwei Moeglichkeiten, und beide sind schlecht:
 * Entweder meldet der taegliche Lauf dieselbe widerrufene Abo-Zeile jeden Tag
 * erneut - dann gewoehnt man sich das Wegklicken an und uebersieht die naechste
 * echte Meldung. Oder er meldet gar nicht, und die Stoerung bleibt still.
 *
 * `gemeldet_am` wird beim Erfolg gesetzt und **beim Wiederherstellen geleert**:
 * Geht dasselbe Abo spaeter noch einmal kaputt, ist das eine neue Stoerung und
 * gehoert wieder gemeldet.
 */
module.exports = {
    description: 'Merker, welche Abo-Stoerung schon gemeldet wurde',

    async up(db) {
        const da = await db.query(`
            SELECT COLUMN_NAME FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'streaming_subscriptions'
               AND COLUMN_NAME = 'gemeldet_am'
        `);
        if (!da.length) {
            await db.query(`
                ALTER TABLE streaming_subscriptions
                  ADD COLUMN gemeldet_am DATETIME DEFAULT NULL
                      COMMENT 'wann die Stoerung gemeldet wurde - NULL heisst offen'
            `);
        }
    },

    async down(db) {
        const da = await db.query(`
            SELECT COLUMN_NAME FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'streaming_subscriptions'
               AND COLUMN_NAME = 'gemeldet_am'
        `);
        if (da.length) await db.query('ALTER TABLE streaming_subscriptions DROP COLUMN gemeldet_am');
    }
};
