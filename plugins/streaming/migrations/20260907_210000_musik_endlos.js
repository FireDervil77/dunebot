'use strict';

/**
 * Endlosmodus: weiterspielen, wenn niemand etwas wuenscht.
 *
 * Frage des Betreibers am 2026-09-07: "und wenn die warteschlange von allen 6
 * songs die den haken haben oder hatten leer ist? kann ich da keinen endlos
 * modus oder so einstellen?"
 *
 * Er trifft den Normalfall. Ein Stream, in dem nur Musik laeuft, wenn gerade
 * jemand `!request` tippt, ist die meiste Zeit still - und die Warteschlange
 * ist nach sechs Titeln leer, auch wenn die Ablage sechs Titel hat.
 *
 * **Vorgabe 0, anders als bei `aktiv`.** Das ist kein Widerspruch zur
 * Vorgaengermigration, sondern derselbe Massstab: `aktiv` beantwortet "soll
 * ueberhaupt gespielt werden, was gewuenscht wurde?" - dazu Nein zu sagen
 * hiesse, dass nichts funktioniert. `endlos` beantwortet "soll auch UNGEFRAGT
 * gespielt werden?", und das ist eine zusaetzliche Entscheidung des Streamers.
 * Eine Anlage, die nach dem Einschalten des Plugins von selbst Musik in einen
 * Stream schickt, waere aufdringlich.
 */

module.exports = {
    name: '20260907_210000_musik_endlos',
    description: 'streaming_music_state.endlos',

    async up(db) {
        // **Nicht destrukturieren.** `db.query()` liefert die Zeilen direkt -
        // `const [x] = await ...` griffe die erste ZEILE, und die Waechterabfrage
        // liefe ins Leere, waehrend die Migration Erfolg meldet.
        const spalten = await db.query(`
            SELECT COLUMN_NAME FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'streaming_music_state'
               AND COLUMN_NAME = 'endlos'
        `);

        if (spalten?.length) return;

        // Gibt es die Tabelle noch nicht, ist die erste Migration nicht
        // gelaufen - dann ist hier nichts zu tun und sie legt die Spalte an.
        const tabellen = await db.query(`
            SELECT TABLE_NAME FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'streaming_music_state'
        `);
        if (!tabellen?.length) return;

        await db.query(`
            ALTER TABLE streaming_music_state
            ADD COLUMN endlos TINYINT(1) NOT NULL DEFAULT 0 AFTER aktiv
        `);
    },

    async down(db) {
        await db.query('ALTER TABLE streaming_music_state DROP COLUMN endlos');
    }
};
