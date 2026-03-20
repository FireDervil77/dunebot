'use strict';

/**
 * BASELINE MIGRATION — Giveaway Plugin
 * Enthält alle bestehenden Giveaway-Tabellen (6 Tabellen).
 */
module.exports = {
    description: 'Baseline: Giveaway Plugin (giveaways, entries, winners, requirements, templates, blacklist)',
    baseline: true,

    async up(db) {

        await db.query(`
            CREATE TABLE IF NOT EXISTS giveaways (
                id INT AUTO_INCREMENT PRIMARY KEY,
                guild_id VARCHAR(20) NOT NULL,
                channel_id VARCHAR(20) NOT NULL,
                message_id VARCHAR(20) NULL,
                title VARCHAR(255) NOT NULL DEFAULT 'Giveaway',
                description TEXT NULL,
                prize VARCHAR(255) NOT NULL,
                winner_count INT NOT NULL DEFAULT 1,
                starts_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                ends_at TIMESTAMP NOT NULL,
                ended_at TIMESTAMP NULL,
                status ENUM('active','paused','ended','cancelled') NOT NULL DEFAULT 'active',
                created_by VARCHAR(20) NOT NULL,
                hosted_by VARCHAR(20) NULL,
                embed_color VARCHAR(7) NOT NULL DEFAULT '#f59e0b',
                button_emoji VARCHAR(50) CHARACTER SET utf8mb4 NOT NULL DEFAULT 'gift',
                allowed_roles JSON NULL,
                metadata JSON NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_guild_status (guild_id, status),
                INDEX idx_ends_at (ends_at),
                INDEX idx_message (message_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS giveaway_entries (
                id INT AUTO_INCREMENT PRIMARY KEY,
                giveaway_id INT NOT NULL,
                user_id VARCHAR(20) NOT NULL,
                entry_count INT NOT NULL DEFAULT 1,
                entered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_entry (giveaway_id, user_id),
                CONSTRAINT fk_entry_giveaway FOREIGN KEY (giveaway_id)
                    REFERENCES giveaways(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS giveaway_winners (
                id INT AUTO_INCREMENT PRIMARY KEY,
                giveaway_id INT NOT NULL,
                user_id VARCHAR(20) NOT NULL,
                won_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                claimed_at TIMESTAMP NULL,
                CONSTRAINT fk_winner_giveaway FOREIGN KEY (giveaway_id)
                    REFERENCES giveaways(id) ON DELETE CASCADE,
                INDEX idx_giveaway_winners (giveaway_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS giveaway_requirements (
                id INT AUTO_INCREMENT PRIMARY KEY,
                giveaway_id INT NOT NULL,
                type ENUM('role','min_account_age','min_server_age') NOT NULL,
                value VARCHAR(255) NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT fk_req_giveaway FOREIGN KEY (giveaway_id)
                    REFERENCES giveaways(id) ON DELETE CASCADE,
                INDEX idx_req_giveaway (giveaway_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS giveaway_templates (
                id INT AUTO_INCREMENT PRIMARY KEY,
                guild_id VARCHAR(20) NOT NULL,
                name VARCHAR(100) NOT NULL,
                config JSON NOT NULL,
                created_by VARCHAR(20) NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY unique_template (guild_id, name),
                INDEX idx_template_guild (guild_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS giveaway_blacklist (
                id INT AUTO_INCREMENT PRIMARY KEY,
                guild_id VARCHAR(20) NOT NULL,
                user_id VARCHAR(20) NOT NULL,
                reason TEXT NULL,
                blocked_by VARCHAR(20) NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_blacklist (guild_id, user_id),
                INDEX idx_blacklist_guild (guild_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    }
};
