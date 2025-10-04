-- Template Plugin Datenbank-Schema
-- 
-- Diese Datei wird automatisch beim Plugin-Enable ausgeführt.
-- Tabellen sollten mit IF NOT EXISTS erstellt werden.

-- Beispiel: Guild-spezifische Einstellungen
CREATE TABLE IF NOT EXISTS template_guilds (
    guild_id VARCHAR(20) NOT NULL PRIMARY KEY,
    settings JSON NOT NULL DEFAULT '{}',
    active BOOLEAN NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    disabled_at TIMESTAMP NULL,
    
    INDEX idx_active (active),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Beispiel: User-Daten
CREATE TABLE IF NOT EXISTS template_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL,
    user_id VARCHAR(20) NOT NULL,
    points INT NOT NULL DEFAULT 0,
    level INT NOT NULL DEFAULT 1,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_guild_user (guild_id, user_id),
    INDEX idx_guild_points (guild_id, points DESC),
    INDEX idx_last_activity (last_activity),
    
    FOREIGN KEY (guild_id) REFERENCES template_guilds(guild_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Beispiel: Activity-Log
CREATE TABLE IF NOT EXISTS template_activity_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL,
    user_id VARCHAR(20) NOT NULL,
    action VARCHAR(50) NOT NULL,
    details JSON,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_guild_timestamp (guild_id, timestamp DESC),
    INDEX idx_user_timestamp (user_id, timestamp DESC),
    INDEX idx_action (action),
    
    FOREIGN KEY (guild_id) REFERENCES template_guilds(guild_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Beispiel: Trigger für updated_at
DELIMITER //
CREATE TRIGGER IF NOT EXISTS template_guilds_updated_at
BEFORE UPDATE ON template_guilds
FOR EACH ROW
BEGIN
    SET NEW.updated_at = CURRENT_TIMESTAMP;
END//
DELIMITER ;
