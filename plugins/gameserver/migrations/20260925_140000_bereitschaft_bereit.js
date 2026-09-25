'use strict';

/**
 * Hat fb-init „bereit" gesagt? — eine eigene Spalte (Baustelle 160).
 *
 * Bis 2026-09-25 rechnete das Panel „bereit" allein aus der Leiter: alle
 * verlangten Stufen erreicht. Kann fb-init eine Stufe nicht prüfen (etwa die
 * Abfrage, wenn fb-probe das Protokoll nicht spricht), meldet es trotzdem
 * `ready` — bei der Stufe darunter, mit Begründung. Das Panel wartete dann ewig
 * auf die Abfrage und sperrte „Neu starten" (Astro Colony 203).
 *
 * Entscheidung des Betreibers: Das letzte Wort hat fb-init, und was es nicht
 * prüfen konnte, wird ehrlich als „nicht geprüft" gezeigt.
 *
 * NULL heisst: die Meldung kam von einem Daemon, der die Art noch nicht
 * mitschickt — dann gilt die Leiter wie bisher.
 */
module.exports = {
    description: 'gameservers.bereitschaft_bereit — fb-init hat bereit gemeldet',

    async up(db) {
        await db.query(`
            ALTER TABLE gameservers
                ADD COLUMN IF NOT EXISTS bereitschaft_bereit TINYINT(1) DEFAULT NULL
                    COMMENT '1 = fb-init meldete ready (auch mit ungeprueften Stufen), 0 = andere Meldung, NULL = unbekannt'
                    AFTER bereitschaft_am
        `);
    },

    async down(db) {
        await db.query(`ALTER TABLE gameservers DROP COLUMN IF EXISTS bereitschaft_bereit`);
    }
};
