'use strict';

module.exports = {
    description: 'backup-und-cronjob-tabellen',

    async up(db) {
        // ── gameserver_backups ────────────────────────────────────────────────
        await db.query(`
            CREATE TABLE IF NOT EXISTS gameserver_backups (
                id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                server_id    INT UNSIGNED NOT NULL,
                guild_id     VARCHAR(20)  NOT NULL,
                name         VARCHAR(128) NOT NULL,
                size_bytes   BIGINT       DEFAULT 0,
                status       ENUM('pending','running','completed','failed','restoring') DEFAULT 'pending',
                note         TEXT         NULL,
                created_by   VARCHAR(20)  NOT NULL,
                created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP    NULL,
                error_message TEXT        NULL,
                INDEX idx_server  (server_id),
                INDEX idx_guild   (guild_id),
                INDEX idx_status  (status),
                FOREIGN KEY (server_id) REFERENCES gameservers(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // ── gameserver_cronjobs ───────────────────────────────────────────────
        await db.query(`
            CREATE TABLE IF NOT EXISTS gameserver_cronjobs (
                id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                server_id   INT UNSIGNED NOT NULL,
                guild_id    VARCHAR(20)  NOT NULL,
                name        VARCHAR(128) NOT NULL,
                cron_expr   VARCHAR(64)  NOT NULL COMMENT '5-stellige Cron-Expression',
                action      ENUM('start','stop','restart','backup','command') NOT NULL,
                command     TEXT         NULL COMMENT 'Nur wenn action=command',
                enabled     BOOLEAN      DEFAULT TRUE,
                last_run_at TIMESTAMP    NULL,
                next_run_at TIMESTAMP    NULL,
                last_status ENUM('pending','success','failed') DEFAULT 'pending',
                created_by  VARCHAR(20)  NOT NULL,
                created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
                updated_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_server  (server_id),
                INDEX idx_guild   (guild_id),
                INDEX idx_enabled (enabled),
                FOREIGN KEY (server_id) REFERENCES gameservers(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS gameserver_cronjobs');
        await db.query('DROP TABLE IF EXISTS gameserver_backups');
    }
};
