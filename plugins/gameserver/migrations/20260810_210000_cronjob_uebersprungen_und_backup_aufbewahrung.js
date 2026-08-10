'use strict';

/**
 * Zwei Ergaenzungen an den Cronjobs (Baustellen 7 und 7.1).
 *
 * 1. `last_status` kennt nur pending/success/failed. Ein Job, der bewusst nicht
 *    lief — weil der Server gestoppt ist oder der Daemon offline —, wurde bisher
 *    als `failed` verbucht. Das ist eine Falschmeldung: es ist nichts kaputt.
 *    Neu: `skipped`, dazu `last_message` mit dem Grund im Klartext.
 *
 * 2. Automatische Backups liefen ohne Aufbewahrungsgrenze und fuellten die
 *    Zielplatte. `backup_keep` haelt fest, wie viele Backups eines Cronjobs
 *    stehen bleiben; `backup_keep_days` wirft zusaetzlich nach Alter weg.
 *    0 heisst jeweils "unbegrenzt" — der bisherige Zustand, damit die
 *    Umstellung nichts still wegraeumt.
 *
 * Der Vorgabewert fuer neue Cronjobs steht bewusst NICHT hier auf einer Zahl:
 * bestehende Jobs sollen ihr Verhalten nicht durch eine Migration aendern. Die
 * Oberflaeche schlaegt bei neuen Jobs 7 vor.
 */
module.exports = {
    async up(db) {
        // ── 1. Uebersprungen als eigener Status ──────────────────────────────
        await db.query(`
            ALTER TABLE gameserver_cronjobs
            MODIFY COLUMN last_status
                ENUM('pending','success','failed','skipped') DEFAULT 'pending'
        `);

        const spalten = await db.query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gameserver_cronjobs'
        `);
        const hat = (name) => spalten.some(s => s.COLUMN_NAME === name);

        if (!hat('last_message')) {
            await db.query(`
                ALTER TABLE gameserver_cronjobs
                ADD COLUMN last_message VARCHAR(255) NULL
                    COMMENT 'Grund der letzten Ausfuehrung im Klartext'
                    AFTER last_status
            `);
        }

        // ── 2. Aufbewahrung fuer Backup-Cronjobs ─────────────────────────────
        if (!hat('backup_keep')) {
            await db.query(`
                ALTER TABLE gameserver_cronjobs
                ADD COLUMN backup_keep SMALLINT UNSIGNED NOT NULL DEFAULT 0
                    COMMENT 'Nur action=backup: wie viele behalten, 0 = unbegrenzt'
                    AFTER command
            `);
        }
        if (!hat('backup_keep_days')) {
            await db.query(`
                ALTER TABLE gameserver_cronjobs
                ADD COLUMN backup_keep_days SMALLINT UNSIGNED NOT NULL DEFAULT 0
                    COMMENT 'Nur action=backup: Hoechstalter in Tagen, 0 = unbegrenzt'
                    AFTER backup_keep
            `);
        }

        // Aufgeraeumte Backups sollen als solche erkennbar bleiben, statt
        // einfach zu verschwinden — sonst sieht es nach Datenverlust aus.
        const backupSpalten = await db.query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gameserver_backups'
        `);
        if (!backupSpalten.some(s => s.COLUMN_NAME === 'pruned_at')) {
            await db.query(`
                ALTER TABLE gameserver_backups
                ADD COLUMN pruned_at TIMESTAMP NULL
                    COMMENT 'Von der Aufbewahrungsgrenze entfernt'
                    AFTER completed_at
            `);
        }
    },

    async down(db) {
        await db.query(`
            ALTER TABLE gameserver_cronjobs
            MODIFY COLUMN last_status ENUM('pending','success','failed') DEFAULT 'pending'
        `);
        await db.query('ALTER TABLE gameserver_cronjobs DROP COLUMN last_message');
        await db.query('ALTER TABLE gameserver_cronjobs DROP COLUMN backup_keep');
        await db.query('ALTER TABLE gameserver_cronjobs DROP COLUMN backup_keep_days');
        await db.query('ALTER TABLE gameserver_backups DROP COLUMN pruned_at');
    }
};
