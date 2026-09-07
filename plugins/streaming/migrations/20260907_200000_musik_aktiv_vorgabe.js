'use strict';

/**
 * Die Wiedergabe faengt an, statt angehalten zu sein.
 *
 * `20260907_180000_musikwunsch.js` hat `aktiv` mit `DEFAULT 0` angelegt. Das
 * war falsch herum gedacht und faellt erst beim ersten echten Lauf auf: Ein
 * Zuschauer wuenscht sich etwas, es landet in der Warteschlange - und es
 * passiert nichts, weil `naechster()` bei `aktiv = 0` gar nicht erst sucht.
 * Der Streamer muesste `!play` tippen, ohne dass ihm jemand sagt, warum.
 *
 * **Spielen ist der Normalfall, Anhalten die Ausnahme.** `!pause` ist der
 * bewusste Griff; die Vorgabe darf nicht der Zustand sein, in dem nichts
 * funktioniert.
 *
 * Die bestehenden Zeilen werden mitgenommen - aber **nur die, die noch nie
 * gelaufen sind** (`aktuelle_id IS NULL`). Eine Guild, die bewusst `!pause`
 * getippt hat, faengt sonst beim naechsten Neustart von selbst wieder an zu
 * spielen, und niemand versteht warum.
 */

module.exports = {
    name: '20260907_200000_musik_aktiv_vorgabe',
    description: 'streaming_music_state.aktiv: Vorgabe 1 statt 0',

    async up(db) {
        // **Nicht destrukturieren.** `db.query()` liefert die Zeilen direkt.
        const spalten = await db.query(`
            SELECT COLUMN_DEFAULT AS vorgabe
              FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'streaming_music_state'
               AND COLUMN_NAME = 'aktiv'
        `);

        // Gibt es die Tabelle nicht, ist die erste Migration noch nicht
        // gelaufen - dann legt sie die Spalte gleich richtig an, sobald sie
        // laeuft. Hier ist nichts zu tun.
        if (!spalten?.[0]) return;

        if (String(spalten[0].vorgabe) !== '1') {
            await db.query(`
                ALTER TABLE streaming_music_state
                MODIFY COLUMN aktiv TINYINT(1) NOT NULL DEFAULT 1
            `);
        }

        await db.query(`
            UPDATE streaming_music_state
               SET aktiv = 1
             WHERE aktiv = 0 AND aktuelle_id IS NULL
        `);
    },

    async down(db) {
        await db.query(`
            ALTER TABLE streaming_music_state
            MODIFY COLUMN aktiv TINYINT(1) NOT NULL DEFAULT 0
        `);
    }
};
