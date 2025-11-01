-- User-Configs Tabelle für user-spezifische Einstellungen
-- Verwaltet Präferenzen wie dismissed notifications, theme, language, etc.
-- 
-- @author firedervil
-- @created 2025-10-13

CREATE TABLE IF NOT EXISTS user_configs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(20) NOT NULL COMMENT 'Discord User ID',
    plugin_name VARCHAR(50) NOT NULL COMMENT 'Plugin-Namespace (core, moderation, dunemap, etc.)',
    config_key VARCHAR(100) NOT NULL COMMENT 'Config-Schlüssel (DISMISSED_NOTIFICATIONS, USER_THEME, USER_LOCALE, etc.)',
    config_value LONGTEXT COMMENT 'Config-Wert (JSON oder String)',
    guild_id VARCHAR(20) DEFAULT NULL COMMENT 'Guild-spezifisch oder NULL = global',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Unique Constraint: Ein User kann pro Plugin/Key/Guild nur einen Wert haben
    UNIQUE KEY unique_user_config (user_id, plugin_name, config_key, guild_id),
    
    -- Performance-Indizes
    INDEX idx_user_plugin (user_id, plugin_name),
    INDEX idx_user_guild (user_id, guild_id),
    INDEX idx_plugin_key (plugin_name, config_key)
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='User-spezifische Konfigurationen und Präferenzen';
