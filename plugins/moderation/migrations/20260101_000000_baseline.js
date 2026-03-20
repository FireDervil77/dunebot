'use strict';

/**
 * BASELINE MIGRATION — Moderation Plugin
 * Enthält alle bestehenden Moderation-Tabellen (5 Tabellen).
 */
module.exports = {
    description: 'Baseline: Moderation Plugin (settings, logs, notes, channel_rules, protected_roles)',
    baseline: true,

    async up(db) {

        await db.query(`
            CREATE TABLE IF NOT EXISTS moderation_settings (
                guild_id VARCHAR(255) PRIMARY KEY,
                modlog_channel VARCHAR(255) DEFAULT NULL,
                max_warn_limit INT DEFAULT 5,
                max_warn_action ENUM('TIMEOUT', 'KICK', 'BAN') DEFAULT 'KICK',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_guild (guild_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS moderation_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                guild_id VARCHAR(255) NOT NULL,
                member_id VARCHAR(255) NOT NULL,
                admin_id VARCHAR(255) NOT NULL,
                admin_tag VARCHAR(255) NOT NULL,
                type ENUM('PURGE','WARN','TIMEOUT','UNTIMEOUT','KICK','SOFTBAN','BAN','UNBAN','VMUTE','VUNMUTE','DEAFEN','UNDEAFEN','DISCONNECT','MOVE') NOT NULL,
                reason TEXT DEFAULT NULL,
                deleted TINYINT(1) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_guild_member (guild_id, member_id),
                INDEX idx_guild_type (guild_id, type),
                INDEX idx_deleted (deleted),
                INDEX idx_created (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS moderation_notes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                guild_id VARCHAR(255) NOT NULL,
                user_id VARCHAR(255) NOT NULL,
                author_id VARCHAR(255) NOT NULL,
                note TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_guild_user (guild_id, user_id),
                INDEX idx_guild_author (guild_id, author_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS moderation_channel_rules (
                id INT AUTO_INCREMENT PRIMARY KEY,
                guild_id VARCHAR(255) NOT NULL,
                channel_id VARCHAR(255) NOT NULL,
                max_warn_limit INT DEFAULT NULL,
                max_warn_action ENUM('TIMEOUT', 'KICK', 'BAN') DEFAULT NULL,
                automod_exempt TINYINT(1) DEFAULT 0,
                notes TEXT DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uk_guild_channel (guild_id, channel_id),
                INDEX idx_guild (guild_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS moderation_protected_roles (
                id INT AUTO_INCREMENT PRIMARY KEY,
                guild_id VARCHAR(255) NOT NULL,
                role_id VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uk_guild_role (guild_id, role_id),
                INDEX idx_guild (guild_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    }
};
