'use strict';

/**
 * `rootserver.daemon_port` fällt weg (2026-11-03).
 *
 * Der Wert stammt aus der Zeit, als das Dashboard selbst auf 9340 lauschte. Seit dem
 * Busbahnhof verbindet sich der Daemon ausgehend zu 9341, auf der Maschine gibt es für
 * die Leitung keinen Port. Formular und Detailseite zeigten trotzdem „Standard: 9340
 * (WebSocket)", gelesen hat den Wert niemand, weder Dashboard noch Daemon. Die Ports,
 * auf denen der Daemon wirklich lauscht, meldet er selbst (`abruf_port`, `sftp_port`).
 */
module.exports = {
    description: 'masterserver-rootserver-ohne-daemon-port',

    async up(db) {
        // Name als Text: dbService.query ist execute, kein Platzhalter hinter SHOW … LIKE.
        const [spalte] = await db.query("SHOW COLUMNS FROM rootserver LIKE 'daemon_port'");
        if (spalte) await db.query('ALTER TABLE rootserver DROP COLUMN daemon_port');
    },

    async down(db) {
        const [spalte] = await db.query("SHOW COLUMNS FROM rootserver LIKE 'daemon_port'");
        if (!spalte) {
            await db.query(`ALTER TABLE rootserver ADD COLUMN daemon_port INT(11) NOT NULL DEFAULT 8080
                COMMENT 'WebSocket port for IPM communication' AFTER fqdn`);
        }
    }
};
