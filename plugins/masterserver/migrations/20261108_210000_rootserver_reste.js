'use strict';

/**
 * Bestand der Maschine nach dem Aufräumen beim Verbinden (K313, 2026-11-08).
 *
 * Der Daemon (ab 1.1.21) räumt beim Verbinden weg, was keinem Server dieser
 * Maschine gehört — Volumes, Laufzeitordner, Sicherungen, Freigaben — und
 * meldet danach als `reste.befund`, was er hat, was er entfernte und was blieb.
 * scripts/check-reste.js vergleicht das mit der Datenbank.
 *
 *   reste_befund  JSON wie gemeldet {am, volumes, sicherungen, werkbank,
 *                 entfernt, geblieben}; NULL = noch nie gemeldet
 *   reste_am      wann das Dashboard ihn bekam
 */
module.exports = {
    description: 'masterserver-rootserver-reste',

    async up(db) {
        await db.query(`ALTER TABLE rootserver
            ADD COLUMN IF NOT EXISTS reste_befund LONGTEXT DEFAULT NULL
                COMMENT 'Befund: Bestand nach dem Aufraeumen beim Verbinden (reste.befund), JSON',
            ADD COLUMN IF NOT EXISTS reste_am DATETIME DEFAULT NULL
                COMMENT 'Wann reste.befund zuletzt kam'`);
    },

    async down(db) {
        await db.query(`ALTER TABLE rootserver
            DROP COLUMN IF EXISTS reste_befund,
            DROP COLUMN IF EXISTS reste_am`);
    }
};
