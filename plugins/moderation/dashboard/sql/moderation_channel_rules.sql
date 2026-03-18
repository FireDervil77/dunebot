-- Channel-spezifische Regeln
-- Erlaubt Overrides pro Channel (z.B. Meme-Channel lockerer, Hauptchannel strenger)

CREATE TABLE IF NOT EXISTS moderation_channel_rules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(255) NOT NULL,
    channel_id VARCHAR(255) NOT NULL,
    max_warn_limit INT DEFAULT NULL COMMENT 'Override für max_warn_limit (NULL = Guild-Default)',
    max_warn_action ENUM('TIMEOUT', 'KICK', 'BAN') DEFAULT NULL COMMENT 'Override für max_warn_action',
    automod_exempt TINYINT(1) DEFAULT 0 COMMENT 'AutoMod in diesem Channel deaktivieren',
    notes TEXT DEFAULT NULL COMMENT 'Beschreibung der Channel-Regeln',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_guild_channel (guild_id, channel_id),
    INDEX idx_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
