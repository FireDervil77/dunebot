'use strict';

/**
 * SFTP für externe Programme: Wunsch und Befund am Rootserver (2026-10-27).
 *
 * Wie Datenbank und FastDL: `sftp_gewuenscht` setzt das Formular (Absicht, geht
 * an den Wizard), `sftp_moeglich`/`sftp_grund` setzt ausschliesslich die
 * Anmeldung des Daemons. Vorgabe AUS — ein Passwort-Login nach außen gibt es
 * nur auf Wunsch (Betreiber).
 */
const SPALTEN = [
    ['sftp_gewuenscht', "TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Absicht: SFTP fuer externe Programme anbieten'"],
    ['sftp_moeglich', "TINYINT(1) NULL DEFAULT NULL COMMENT 'Befund: laeuft der SFTP-Server und ist er gewuenscht'"],
    ['sftp_grund', "VARCHAR(255) NULL DEFAULT NULL COMMENT 'Befund in Worten'"],
];

module.exports = {
    description: 'masterserver-sftp-wunsch',

    async up(db) {
        for (const [name, art] of SPALTEN) {
            // Name als Text: dbService.query ist execute, und MariaDB nimmt hinter
            // SHOW … LIKE keinen Platzhalter (2026-10-27). Konstanten aus dieser Datei.
            const [da] = await db.query(`SHOW COLUMNS FROM rootserver LIKE '${name}'`);
            if (da) continue;
            await db.query(`ALTER TABLE rootserver ADD COLUMN ${name} ${art}`);
        }
    },

    async down(db) {
        for (const [name] of [...SPALTEN].reverse()) {
            await db.query(`ALTER TABLE rootserver DROP COLUMN IF EXISTS ${name}`);
        }
    }
};
