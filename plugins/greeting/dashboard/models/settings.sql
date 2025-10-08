-- plugins/greeting/dashboard/models/settings.sql
CREATE TABLE IF NOT EXISTS greeting_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(255) NOT NULL UNIQUE,
    
    autorole_id VARCHAR(255) DEFAULT NULL COMMENT 'Discord Role ID',
    
    welcome_enabled BOOLEAN DEFAULT FALSE,
    welcome_channel VARCHAR(255) DEFAULT NULL COMMENT 'Discord Channel ID',
    welcome_content TEXT DEFAULT NULL,
    welcome_embed JSON DEFAULT NULL COMMENT 'Discord Embed Object',
    
    farewell_enabled BOOLEAN DEFAULT FALSE,
    farewell_channel VARCHAR(255) DEFAULT NULL COMMENT 'Discord Channel ID',
    farewell_content TEXT DEFAULT NULL,
    farewell_embed JSON DEFAULT NULL COMMENT 'Discord Embed Object',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_guild (guild_id),
    INDEX idx_welcome_enabled (welcome_enabled),
    INDEX idx_farewell_enabled (farewell_enabled),
    
    FOREIGN KEY (guild_id) REFERENCES guilds(_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;