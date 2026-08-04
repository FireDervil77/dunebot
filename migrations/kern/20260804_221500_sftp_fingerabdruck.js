'use strict';

/**
 * Fingerabdruck des SFTP-Host-Keys je RootServer.
 *
 * Jeder SFTP-Client fragt beim ersten Verbinden „SHA256:… — diesem Host
 * vertrauen?". Ohne Vergleichswert klickt man das weg und hofft. Der Daemon
 * meldet den Wert bei der Anmeldung, das Dashboard zeigt ihn neben Host, Port,
 * Benutzer und Passwort — damit wird aus der Rückfrage eine echte Prüfung.
 *
 * NULL heißt: Daemon zu alt oder SFTP abgeschaltet.
 */
module.exports = {
    description: 'SFTP-Host-Key-Fingerabdruck je RootServer',

    async up(db) {
        const [vorhanden] = await db.query(
            "SHOW COLUMNS FROM rootserver LIKE 'sftp_fingerprint'"
        );
        if (vorhanden) return;

        await db.query(`
            ALTER TABLE rootserver
            ADD COLUMN sftp_fingerprint VARCHAR(80) DEFAULT NULL
                COMMENT 'SHA256-Fingerabdruck des SFTP-Host-Keys, vom Daemon gemeldet'
            AFTER daemon_version
        `);
    },

    async down(db) {
        await db.query('ALTER TABLE rootserver DROP COLUMN sftp_fingerprint');
    }
};
