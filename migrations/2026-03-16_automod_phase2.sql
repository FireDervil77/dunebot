-- Migration: AutoMod Phase 2 Updates
-- 1. automod_settings um Keyword-Listen erweitern
-- 2. Neue Tabellen: escalation_config, exemptions, regex_rules, raid_events

-- automod_settings erweitern
ALTER TABLE automod_settings 
    ADD COLUMN IF NOT EXISTS active_keyword_lists JSON DEFAULT NULL COMMENT 'Aktivierte Keyword-Listen (z.B. ["de_insults","en_slurs"])';

-- Neue Tabellen
CREATE TABLE IF NOT EXISTS automod_escalation_config (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL,
    threshold INT UNSIGNED NOT NULL,
    action ENUM('TIMEOUT', 'KICK', 'BAN') NOT NULL,
    duration INT UNSIGNED DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_guild_threshold (guild_id, threshold),
    INDEX idx_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS automod_exemptions (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL,
    type ENUM('role', 'channel') NOT NULL,
    target_id VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_guild_type_target (guild_id, type, target_id),
    INDEX idx_guild (guild_id),
    INDEX idx_guild_type (guild_id, type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
