'use strict';

const bcrypt = require('bcrypt');

/**
 * SFTP-Passwörter als bcrypt-Hash statt im Klartext.
 *
 * `gameservers.sftp_password` enthielt das Passwort lesbar — in der Datenbank,
 * in jedem Backup, und über die Detailseite auch im ausgelieferten HTML. Wer
 * eines davon zu sehen bekam, hatte damit Dateizugriff auf den Gameserver.
 *
 * Das Dashboard braucht den Klartext nicht: Es erzeugt das Passwort, zeigt es
 * einmal an und schickt den Hash zum Daemon, der beim Anmelden per bcrypt
 * vergleicht. Ab hier ist das Passwort nach dem Erzeugen nirgends mehr
 * abrufbar — wer es verliert, setzt ein neues.
 *
 * Vorhandene Passwörter bleiben gültig: Sie werden hier gehasht, nicht
 * verworfen. Sonst müsste jeder Kunde seine SFTP-Verbindung neu einrichten.
 */
module.exports = {
    description: 'SFTP-Passwörter als bcrypt-Hash (Klartext-Spalte entfällt)',

    async up(db) {
        const [hashSpalte] = await db.query(
            "SHOW COLUMNS FROM gameservers LIKE 'sftp_password_hash'"
        );

        if (!hashSpalte) {
            await db.query(`
                ALTER TABLE gameservers
                ADD COLUMN sftp_password_hash VARCHAR(72) DEFAULT NULL
                    COMMENT 'bcrypt-Hash des SFTP-Passworts, niemals Klartext'
                AFTER sftp_username
            `);
        }

        const [klartextSpalte] = await db.query(
            "SHOW COLUMNS FROM gameservers LIKE 'sftp_password'"
        );
        if (!klartextSpalte) return; // bereits migriert

        // Vorhandene Klartexte übernehmen. bcrypt braucht pro Eintrag spürbar
        // Zeit, deshalb nacheinander und nicht in einem einzigen UPDATE.
        const zeilen = await db.query(`
            SELECT id, sftp_password
            FROM gameservers
            WHERE sftp_password IS NOT NULL
              AND sftp_password != ''
              AND sftp_password_hash IS NULL
        `);

        for (const zeile of zeilen) {
            const hash = await bcrypt.hash(zeile.sftp_password, 10);
            await db.query(
                'UPDATE gameservers SET sftp_password_hash = ? WHERE id = ?',
                [hash, zeile.id]
            );
        }

        await db.query('ALTER TABLE gameservers DROP COLUMN sftp_password');
    },

    /**
     * Der Rückweg kann den Klartext nicht wiederherstellen — das ist der Sinn
     * der Sache. Er legt die Spalte leer wieder an; die betroffenen Zugänge
     * brauchen dann ein neues Passwort.
     */
    async down(db) {
        const [klartextSpalte] = await db.query(
            "SHOW COLUMNS FROM gameservers LIKE 'sftp_password'"
        );
        if (!klartextSpalte) {
            await db.query(`
                ALTER TABLE gameservers
                ADD COLUMN sftp_password VARCHAR(255) DEFAULT NULL
                AFTER sftp_username
            `);
        }

        await db.query('ALTER TABLE gameservers DROP COLUMN sftp_password_hash');
    }
};
