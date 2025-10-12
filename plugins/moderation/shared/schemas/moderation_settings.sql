-- Moderation Settings Table
-- Speichert Guild-spezifische Moderation-Einstellungen

CREATE TABLE IF NOT EXISTS moderation_settings (
    guild_id VARCHAR(255) PRIMARY KEY,
    modlog_channel VARCHAR(255) DEFAULT NULL COMMENT 'Channel-ID für Moderation-Logs',
    max_warn_limit INT DEFAULT 5 COMMENT 'Maximale Anzahl an Warnungen vor Aktion',
    max_warn_action ENUM('TIMEOUT', 'KICK', 'BAN') DEFAULT 'KICK' COMMENT 'Aktion nach max. Warnungen',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
