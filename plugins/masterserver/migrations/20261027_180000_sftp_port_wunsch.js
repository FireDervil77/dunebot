'use strict';

/**
 * SFTP-Port am Rootserver (2026-10-27).
 *
 * Seit der Daemon SFTP nach dem Wunsch des Dashboards schaltet (sftp.Steuerung),
 * lässt sich auch der Port dort wählen. NULL = Vorgabe 2022. `sftp_port` bleibt
 * der gemeldete, wirklich lauschende Port — dieser hier ist der Wunsch.
 */
module.exports = {
    description: 'masterserver-sftp-port-wunsch',

    async up(db) {
        // Name als Text: dbService.query ist execute, kein Platzhalter hinter SHOW … LIKE.
        const [da] = await db.query("SHOW COLUMNS FROM rootserver LIKE 'sftp_port_wunsch'");
        if (da) return;
        await db.query(`ALTER TABLE rootserver ADD COLUMN sftp_port_wunsch INT NULL DEFAULT NULL
            COMMENT 'Wunsch: SFTP-Port, NULL = 2022' AFTER sftp_gewuenscht`);
    },

    async down(db) {
        await db.query('ALTER TABLE rootserver DROP COLUMN IF EXISTS sftp_port_wunsch');
    }
};
