'use strict';

/**
 * SFTP-Port je RootServer.
 *
 * Das Dashboard zeigt dem Kunden Host, Port und Benutzer zum Eintragen in
 * seinen SFTP-Client an. Der Port stand dabei fest im Code (`server.sftp_port =
 * 2022`), während der Daemon ihn über `sftp.address` in der daemon.yaml frei
 * konfigurierbar hat. Wer ihn dort ändert, bekam eine Anzeige, an der niemand
 * antwortet — und keinen Hinweis darauf, warum.
 *
 * Der Daemon meldet den Port jetzt bei jeder Anmeldung, so wie schon den
 * Fingerabdruck des Host-Keys. Gelesen wird er aus dem laufenden Listener, nicht
 * aus der Konfiguration: Nur der weiß, worauf wirklich gelauscht wird.
 *
 * NULL heißt: Daemon zu alt oder SFTP dort abgeschaltet. Die Anzeige fällt dann
 * auf 2022 zurück — den Wert, der bis hierher fest im Code stand.
 */
module.exports = {
    description: 'SFTP-Port je RootServer, vom Daemon gemeldet',

    async up(db) {
        const [vorhanden] = await db.query(
            "SHOW COLUMNS FROM rootserver LIKE 'sftp_port'"
        );
        if (vorhanden) return;

        await db.query(`
            ALTER TABLE rootserver
            ADD COLUMN sftp_port SMALLINT UNSIGNED DEFAULT NULL
                COMMENT 'Port des SFTP-Servers, vom Daemon gemeldet'
            AFTER sftp_fingerprint
        `);
    },

    async down(db) {
        await db.query('ALTER TABLE rootserver DROP COLUMN sftp_port');
    }
};
