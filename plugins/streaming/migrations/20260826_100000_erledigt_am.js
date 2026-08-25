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
 * Wann ein Auftrag wirklich ausgefuehrt wurde.
 *
 * **Warum das fehlte und was es gekostet hat:** Am 2026-08-24 kam die
 * Rueckschau eines echten Streams rund drei Stunden zu spaet. Die Tabelle
 * wusste, wann der Auftrag angelegt und wann er faellig war - aber nicht, wann
 * er lief. Damit liess sich nicht einmal feststellen, OB er verspaetet war;
 * es blieb der Umweg ueber Discord-Zeitstempel und ein Bot-Protokoll, das
 * inzwischen rotiert war.
 *
 * Ein Ausgang, der `zustand = 'fertig'` sagt, aber nicht wann, beantwortet die
 * einzige Frage nicht, die man im Nachhinein stellt.
 */
module.exports = {
    description: 'Zeitpunkt der Ausfuehrung je Auftrag - macht Verzug nachweisbar',

    async up(db) {
        const da = await db.query(`
            SELECT COLUMN_NAME FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'streaming_outbox'
               AND COLUMN_NAME = 'erledigt_am'
        `);
        if (!da.length) {
            await db.query(`
                ALTER TABLE streaming_outbox
                  ADD COLUMN erledigt_am DATETIME(3) DEFAULT NULL
                      COMMENT 'wann wirklich ausgefuehrt - gegen faellig_ab ergibt das den Verzug'
            `);
        }
    },

    async down(db) {
        const da = await db.query(`
            SELECT COLUMN_NAME FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'streaming_outbox'
               AND COLUMN_NAME = 'erledigt_am'
        `);
        if (da.length) await db.query('ALTER TABLE streaming_outbox DROP COLUMN erledigt_am');
    }
};
