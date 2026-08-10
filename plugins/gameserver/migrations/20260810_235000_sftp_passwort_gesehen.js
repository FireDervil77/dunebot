'use strict';

/**
 * Haelt fest, ob das SFTP-Passwort jemals angezeigt wurde.
 *
 * Beim Anlegen eines Gameservers wird ein Passwort erzeugt, **nur als Hash**
 * abgelegt und der Klartext verworfen (`_setzeSftpPasswort`, Aufruf in Stufe 3).
 * Das ist richtig so — nur behauptete die Uebersicht danach "Gesetzt", was wie
 * "du hast es" aussieht. Tatsaechlich hat es nie jemand zu Gesicht bekommen,
 * und der einzige Weg dorthin ist "Zuruecksetzen".
 *
 * Mit dieser Spalte laesst sich der Unterschied sagen: vergeben-aber-nie-gezeigt
 * gegen einmal-gezeigt.
 */
module.exports = {
    async up(db) {
        const spalten = await db.query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gameservers'
        `);
        if (spalten.some(s => s.COLUMN_NAME === 'sftp_password_seen_at')) return;

        await db.query(`
            ALTER TABLE gameservers
            ADD COLUMN sftp_password_seen_at TIMESTAMP NULL
                COMMENT 'Wann der Klartext zuletzt angezeigt wurde; NULL = nie'
        `);

        // Bestandsserver: das Passwort wurde beim Anlegen erzeugt und verworfen.
        // NULL ist damit fuer alle die richtige Antwort — es bleibt, wie es ist.
    },

    async down(db) {
        await db.query('ALTER TABLE gameservers DROP COLUMN sftp_password_seen_at');
    }
};
