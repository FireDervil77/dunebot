'use strict';

/**
 * Die Backup-Aufbewahrung zieht vom Cronjob in die Servereinstellungen um.
 *
 * Am 2026-08-10 hing sie zuerst am einzelnen Backup-Cronjob. Das greift zu
 * kurz: wer den Job loescht oder abschaltet, verliert auch die Aufbewahrung —
 * und die Backups von damals liegen weiter da. Der Wunsch war ausdruecklich,
 * das in den Einstellungen durchsetzbar zu machen.
 *
 * Neue Ordnung:
 *   - `gameservers.backup_keep` / `backup_keep_days` gelten fuer den Server.
 *   - Die gleichnamigen Spalten am Cronjob werden NULL-faehig und heissen
 *     jetzt "abweichend von der Servereinstellung". NULL = erben.
 *
 * Die Umstellung uebernimmt vorhandene Cronjob-Werte auf den Server, damit
 * niemand seine gerade gesetzte Grenze verliert.
 */
module.exports = {
    async up(db) {
        const spalten = await db.query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gameservers'
        `);
        const hat = (name) => spalten.some(s => s.COLUMN_NAME === name);

        if (!hat('backup_keep')) {
            await db.query(`
                ALTER TABLE gameservers
                ADD COLUMN backup_keep SMALLINT UNSIGNED NOT NULL DEFAULT 0
                    COMMENT 'Automatische Backups: wie viele behalten, 0 = unbegrenzt'
            `);
        }
        if (!hat('backup_keep_days')) {
            await db.query(`
                ALTER TABLE gameservers
                ADD COLUMN backup_keep_days SMALLINT UNSIGNED NOT NULL DEFAULT 0
                    COMMENT 'Automatische Backups: Hoechstalter in Tagen, 0 = unbegrenzt'
            `);
        }

        // Vorhandene Cronjob-Grenzen auf den Server heben. Bei mehreren
        // Backup-Jobs je Server gewinnt die *strengste* Angabe — sie war
        // offensichtlich gewollt, und die lockerere haette sie ohnehin nie
        // ueberstimmt.
        await db.query(`
            UPDATE gameservers gs
            JOIN (
                SELECT server_id,
                       MIN(NULLIF(backup_keep, 0))      AS keep,
                       MIN(NULLIF(backup_keep_days, 0)) AS keep_days
                FROM gameserver_cronjobs
                WHERE action = 'backup'
                GROUP BY server_id
            ) j ON j.server_id = gs.id
            SET gs.backup_keep      = COALESCE(j.keep, gs.backup_keep),
                gs.backup_keep_days = COALESCE(j.keep_days, gs.backup_keep_days)
        `);

        // Am Cronjob heisst 0 ab jetzt "ausdruecklich unbegrenzt" und NULL
        // "erbt vom Server". Alles, was bisher 0 war, war nie eine Ansage —
        // es war die Vorgabe. Also auf NULL.
        await db.query(`
            ALTER TABLE gameserver_cronjobs
            MODIFY COLUMN backup_keep SMALLINT UNSIGNED NULL DEFAULT NULL
                COMMENT 'Abweichend vom Server; NULL = Servereinstellung'
        `);
        await db.query(`
            ALTER TABLE gameserver_cronjobs
            MODIFY COLUMN backup_keep_days SMALLINT UNSIGNED NULL DEFAULT NULL
                COMMENT 'Abweichend vom Server; NULL = Servereinstellung'
        `);
        await db.query(`
            UPDATE gameserver_cronjobs
            SET backup_keep = NULL, backup_keep_days = NULL
            WHERE backup_keep = 0 AND backup_keep_days = 0
        `);
    },

    async down(db) {
        await db.query(`
            UPDATE gameserver_cronjobs
            SET backup_keep = 0 WHERE backup_keep IS NULL
        `);
        await db.query(`
            UPDATE gameserver_cronjobs
            SET backup_keep_days = 0 WHERE backup_keep_days IS NULL
        `);
        await db.query(`
            ALTER TABLE gameserver_cronjobs
            MODIFY COLUMN backup_keep SMALLINT UNSIGNED NOT NULL DEFAULT 0
        `);
        await db.query(`
            ALTER TABLE gameserver_cronjobs
            MODIFY COLUMN backup_keep_days SMALLINT UNSIGNED NOT NULL DEFAULT 0
        `);
        await db.query('ALTER TABLE gameservers DROP COLUMN backup_keep');
        await db.query('ALTER TABLE gameservers DROP COLUMN backup_keep_days');
    }
};
