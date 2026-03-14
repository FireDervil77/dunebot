/**
 * Migration 1.0.2: SFTP-Credentials für Gameserver
 *
 * Fügt SFTP-Zugangsdaten zur gameservers Tabelle hinzu:
 * - sftp_username: SFTP-Benutzername (z.B. gs-a1b2c3d4)
 * - sftp_password: SFTP-Passwort (Klartext für Anzeige im Dashboard)
 *
 * @author FireBot Team
 * @version 1.0.2
 * @date 2026-03-10
 */

module.exports = {
    version: '1.0.2',
    name: 'SFTP-Credentials für Gameserver',

    async up(dbService) {
        const Logger = require('dunebot-core').ServiceManager.get('Logger');
        Logger.info('[Plugin Migration 1.0.2] Füge SFTP-Credential Spalten hinzu...');

        try {
            const columnsCheck = await dbService.query(`
                SELECT COLUMN_NAME
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'gameservers'
                  AND COLUMN_NAME IN ('sftp_username', 'sftp_password')
            `);

            if (columnsCheck.length < 2) {
                await dbService.query(`
                    ALTER TABLE gameservers
                    ADD COLUMN IF NOT EXISTS sftp_username VARCHAR(64) DEFAULT NULL COMMENT 'SFTP-Benutzername' AFTER last_backup_at,
                    ADD COLUMN IF NOT EXISTS sftp_password VARCHAR(100) DEFAULT NULL COMMENT 'SFTP-Passwort' AFTER sftp_username
                `);
                Logger.success('[Plugin Migration 1.0.2] SFTP-Spalten erfolgreich hinzugefügt!');
            } else {
                Logger.info('[Plugin Migration 1.0.2] SFTP-Spalten existieren bereits.');
            }

            return { success: true };
        } catch (error) {
            Logger.error('[Plugin Migration 1.0.2] Migration fehlgeschlagen:', error);
            throw error;
        }
    },

    async down(dbService) {
        const Logger = require('dunebot-core').ServiceManager.get('Logger');
        Logger.info('[Plugin Migration 1.0.2] ROLLBACK - Entferne SFTP-Spalten...');

        try {
            await dbService.query(`
                ALTER TABLE gameservers
                DROP COLUMN IF EXISTS sftp_username,
                DROP COLUMN IF EXISTS sftp_password
            `);
            Logger.success('[Plugin Migration 1.0.2] Rollback erfolgreich!');
        } catch (error) {
            Logger.error('[Plugin Migration 1.0.2] Rollback fehlgeschlagen:', error);
            throw error;
        }
    }
};
