-- AutoMod Exemptions
-- Rollen und Channels die von AutoMod-Filtern ausgenommen sind

CREATE TABLE IF NOT EXISTS automod_exemptions (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL,
    type ENUM('role', 'channel') NOT NULL COMMENT 'Art der Ausnahme',
    target_id VARCHAR(20) NOT NULL COMMENT 'Rollen-ID oder Channel-ID',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_guild_type_target (guild_id, type, target_id),
    INDEX idx_guild (guild_id),
    INDEX idx_guild_type (guild_id, type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AutoMod Ausnahmen für Rollen und Channels';
