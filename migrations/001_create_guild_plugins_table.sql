-- Migration: Plugin System Redesign
-- Erstellt neue guild_plugins Tabelle für Plugin-Aktivierung
-- Ersetzt ENABLED_PLUGINS JSON-Array in configs Tabelle
-- 
-- Autor: FireDervil
-- Datum: 2025-10-07

-- Neue Tabelle: guild_plugins
CREATE TABLE IF NOT EXISTS guild_plugins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(255) NOT NULL COMMENT 'Discord Guild ID',
    plugin_name VARCHAR(100) NOT NULL COMMENT 'Plugin Name (z.B. core, dunemap)',
    is_enabled BOOLEAN DEFAULT 1 COMMENT 'Plugin aktiv/inaktiv',
    
    -- Version Tracking (für Updates)
    plugin_version VARCHAR(20) DEFAULT NULL COMMENT 'Installierte Plugin-Version (z.B. 1.2.0)',
    
    -- Audit Trail (Wer hat was wann gemacht?)
    enabled_at DATETIME DEFAULT NULL COMMENT 'Zeitpunkt der Aktivierung',
    enabled_by VARCHAR(255) DEFAULT NULL COMMENT 'User-ID: Wer hat aktiviert?',
    disabled_at DATETIME DEFAULT NULL COMMENT 'Zeitpunkt der Deaktivierung',
    disabled_by VARCHAR(255) DEFAULT NULL COMMENT 'User-ID: Wer hat deaktiviert?',
    
    -- Timestamps
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Constraints
    UNIQUE KEY unique_guild_plugin (guild_id, plugin_name),
    FOREIGN KEY (guild_id) REFERENCES guilds(_id) ON DELETE CASCADE,
    
    -- Indizes für Performance
    INDEX idx_guild_enabled (guild_id, is_enabled),
    INDEX idx_plugin (plugin_name),
    INDEX idx_enabled_by (enabled_by),
    INDEX idx_version (plugin_name, plugin_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Plugin-Aktivierung pro Guild (ersetzt configs.ENABLED_PLUGINS)';

-- Tabelle erfolgreich erstellt
SELECT 'guild_plugins Tabelle wurde erfolgreich erstellt!' AS Status;
