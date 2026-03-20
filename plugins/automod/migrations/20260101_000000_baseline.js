'use strict';

/**
 * BASELINE MIGRATION — AutoMod Plugin
 * Enthält alle bestehenden AutoMod-Tabellen (8 Tabellen).
 */
module.exports = {
    description: 'Baseline: AutoMod Plugin (settings, strikes, escalation, exemptions, logs, compound_rules, raid_events, regex_rules)',
    baseline: true,

    async up(db) {

        await db.query(`
            CREATE TABLE IF NOT EXISTS automod_settings (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                guild_id VARCHAR(20) NOT NULL UNIQUE COMMENT 'Discord Guild ID',
                log_channel VARCHAR(20) DEFAULT NULL,
                log_embed_color VARCHAR(7) DEFAULT '#FF0000',
                dm_embed_color VARCHAR(7) DEFAULT '#FFA500',
                max_strikes TINYINT UNSIGNED DEFAULT 10,
                action ENUM('TIMEOUT', 'KICK', 'BAN') DEFAULT 'TIMEOUT',
                debug_mode BOOLEAN DEFAULT FALSE,
                anti_attachments BOOLEAN DEFAULT FALSE,
                anti_invites BOOLEAN DEFAULT FALSE,
                anti_links BOOLEAN DEFAULT FALSE,
                anti_spam BOOLEAN DEFAULT FALSE,
                anti_ghostping BOOLEAN DEFAULT FALSE,
                anti_massmention BOOLEAN DEFAULT FALSE,
                anti_massmention_threshold TINYINT UNSIGNED DEFAULT 5,
                max_lines SMALLINT UNSIGNED DEFAULT 0,
                max_mentions TINYINT UNSIGNED DEFAULT 0,
                max_role_mentions TINYINT UNSIGNED DEFAULT 0,
                whitelisted_channels JSON DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_guild (guild_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS automod_strikes (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                guild_id VARCHAR(20) NOT NULL,
                member_id VARCHAR(20) NOT NULL,
                strikes TINYINT UNSIGNED DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY unique_member (guild_id, member_id),
                INDEX idx_guild_member (guild_id, member_id),
                INDEX idx_strikes (strikes)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS automod_escalation_config (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                guild_id VARCHAR(20) NOT NULL,
                threshold INT UNSIGNED NOT NULL,
                action ENUM('TIMEOUT', 'KICK', 'BAN') NOT NULL,
                duration INT UNSIGNED DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uk_guild_threshold (guild_id, threshold),
                INDEX idx_guild (guild_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS automod_exemptions (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                guild_id VARCHAR(20) NOT NULL,
                type ENUM('role', 'channel') NOT NULL,
                target_id VARCHAR(20) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uk_guild_type_target (guild_id, type, target_id),
                INDEX idx_guild (guild_id),
                INDEX idx_guild_type (guild_id, type)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS automod_logs (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                guild_id VARCHAR(20) NOT NULL,
                member_id VARCHAR(20) NOT NULL,
                message_content TEXT NOT NULL,
                violation_reasons TEXT NOT NULL,
                strikes_given TINYINT UNSIGNED DEFAULT 1,
                logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_guild (guild_id),
                INDEX idx_member (member_id),
                INDEX idx_logged_at (logged_at),
                INDEX idx_guild_member_time (guild_id, member_id, logged_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS automod_compound_rules (
                id INT AUTO_INCREMENT PRIMARY KEY,
                guild_id VARCHAR(255) NOT NULL,
                name VARCHAR(100) NOT NULL,
                description VARCHAR(500) DEFAULT NULL,
                conditions JSON NOT NULL,
                logic ENUM('AND', 'OR') NOT NULL DEFAULT 'AND',
                action ENUM('DELETE', 'WARN', 'STRIKE', 'TIMEOUT', 'KICK', 'BAN') NOT NULL DEFAULT 'STRIKE',
                duration INT DEFAULT NULL,
                enabled TINYINT(1) NOT NULL DEFAULT 1,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_guild_enabled (guild_id, enabled)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS automod_raid_events (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                guild_id VARCHAR(20) NOT NULL,
                event_type ENUM('JOIN_SPIKE', 'YOUNG_ACCOUNT', 'RAID_DETECTED', 'LOCKDOWN_ACTIVATED', 'LOCKDOWN_DEACTIVATED', 'SUSPICIOUS_INVITE') NOT NULL,
                user_id VARCHAR(20) DEFAULT NULL,
                user_tag VARCHAR(100) DEFAULT NULL,
                account_created_at TIMESTAMP NULL DEFAULT NULL,
                invite_code VARCHAR(50) DEFAULT NULL,
                action_taken VARCHAR(50) DEFAULT NULL,
                metadata JSON DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_guild (guild_id),
                INDEX idx_guild_type (guild_id, event_type),
                INDEX idx_created (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS automod_regex_rules (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                guild_id VARCHAR(20) NOT NULL,
                name VARCHAR(100) NOT NULL,
                pattern TEXT NOT NULL,
                action ENUM('DELETE', 'WARN', 'STRIKE') DEFAULT 'STRIKE',
                enabled BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_guild (guild_id),
                INDEX idx_guild_enabled (guild_id, enabled)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    }
};
