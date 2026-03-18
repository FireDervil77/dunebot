-- AutoMod Raid Events
-- Audit-Trail für Raid-Schutz-Ereignisse

CREATE TABLE IF NOT EXISTS automod_raid_events (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL,
    event_type ENUM('JOIN_SPIKE', 'YOUNG_ACCOUNT', 'RAID_DETECTED', 'LOCKDOWN_ACTIVATED', 'LOCKDOWN_DEACTIVATED', 'SUSPICIOUS_INVITE') NOT NULL,
    user_id VARCHAR(20) DEFAULT NULL,
    user_tag VARCHAR(100) DEFAULT NULL,
    account_created_at TIMESTAMP NULL DEFAULT NULL,
    invite_code VARCHAR(50) DEFAULT NULL,
    action_taken VARCHAR(50) DEFAULT NULL,
    metadata JSON DEFAULT NULL COMMENT 'Zusätzliche Event-Daten',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_guild (guild_id),
    INDEX idx_guild_type (guild_id, event_type),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AutoMod Raid-Event-Log';
