-- AutoMod Strikes Tabelle
-- Zählt aktuelle Strikes pro Member pro Guild
CREATE TABLE IF NOT EXISTS automod_strikes (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL COMMENT 'Discord Guild ID',
    member_id VARCHAR(20) NOT NULL COMMENT 'Discord Member ID',
    strikes TINYINT UNSIGNED DEFAULT 0 COMMENT 'Aktuelle Anzahl Strikes (wird bei Aktion zurückgesetzt)',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Erster Strike',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Letzter Strike',
    
    UNIQUE KEY unique_member (guild_id, member_id),
    INDEX idx_guild_member (guild_id, member_id),
    INDEX idx_strikes (strikes) COMMENT 'Für Queries nach High-Strike-Usern'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Strike-Counter pro Member (wird bei Bestrafung zurückgesetzt)';
