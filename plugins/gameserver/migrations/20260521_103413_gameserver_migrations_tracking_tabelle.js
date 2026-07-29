'use strict';

/**
 * Gameserver-Migrationen Tracking-Tabelle
 * 
 * Speichert den Status laufender Server-Umzüge zwischen RootServern
 * (nicht zu verwechseln mit DB-Schema-Migrationen!)
 * 
 * @author FireDervil & GitHub Copilot
 * @date 2026-05-21
 */

module.exports = {
    description: 'gameserver_migrations_tracking_tabelle',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS gameserver_migrations (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                server_id INT UNSIGNED NOT NULL,
                source_rootserver_id INT NOT NULL,
                target_rootserver_id INT NOT NULL,
                initiated_by VARCHAR(20) NOT NULL COMMENT 'Discord User ID',
                status ENUM(
                    'pending',
                    'validating',
                    'stopping_server',
                    'backing_up',
                    'transferring',
                    'restoring',
                    'updating_db',
                    'completed',
                    'failed',
                    'rolled_back'
                ) DEFAULT 'pending',
                progress_percent TINYINT UNSIGNED DEFAULT 0,
                current_step VARCHAR(100) NULL COMMENT 'Aktuelle Phase für UI-Anzeige',
                error_message TEXT NULL,
                backup_path VARCHAR(500) NULL COMMENT 'Temporärer Backup-Pfad auf Quell-Daemon',
                backup_size_bytes BIGINT UNSIGNED NULL,
                backup_checksum VARCHAR(64) NULL COMMENT 'SHA256 Checksum',
                old_ports JSON NULL COMMENT 'Alte Port-Zuweisungen (für Rollback)',
                new_ports JSON NULL COMMENT 'Neue Port-Zuweisungen auf Ziel-Server',
                started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME NULL,
                INDEX idx_server (server_id),
                INDEX idx_status (status),
                INDEX idx_started (started_at),
                FOREIGN KEY (server_id) REFERENCES gameservers(id) ON DELETE CASCADE,
                FOREIGN KEY (source_rootserver_id) REFERENCES rootserver(id) ON DELETE RESTRICT,
                FOREIGN KEY (target_rootserver_id) REFERENCES rootserver(id) ON DELETE RESTRICT
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            COMMENT='Tracking-Tabelle für laufende Gameserver-Migrationen zwischen RootServern'
        `);
    },

    async down(db) {
        await db.query(`DROP TABLE IF EXISTS gameserver_migrations`);
    }
};
