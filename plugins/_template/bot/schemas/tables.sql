-- Template Plugin Datenbank-Schema
-- Diese Datei wird automatisch beim Aktivieren des Plugins ausgeführt

-- Beispiel-Tabelle für Template-Plugin Daten
CREATE TABLE IF NOT EXISTS template_data (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL,
    user_id VARCHAR(20) NOT NULL,
    data_type VARCHAR(50) NOT NULL,
    data_value TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_guild_id (guild_id),
    INDEX idx_user_id (user_id),
    INDEX idx_data_type (data_type),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Beispiel-Tabelle für Plugin-Statistiken
CREATE TABLE IF NOT EXISTS template_stats (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL UNIQUE,
    total_uses INT DEFAULT 0,
    last_used TIMESTAMP NULL,
    settings JSON,
    
    INDEX idx_guild_id (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Beispiel-Tabelle für Benutzer-Präferenzen
CREATE TABLE IF NOT EXISTS template_user_preferences (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL,
    user_id VARCHAR(20) NOT NULL,
    preference_key VARCHAR(100) NOT NULL,
    preference_value TEXT,
    
    UNIQUE KEY unique_preference (guild_id, user_id, preference_key),
    INDEX idx_guild_user (guild_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
