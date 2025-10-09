-- Plugin-Versions-Tracking und Auto-Update-System
-- Erstellt: 2025-10-09
-- @author FireDervil

CREATE TABLE IF NOT EXISTS plugin_versions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  
  -- Plugin & Guild
  plugin_name VARCHAR(50) NOT NULL,
  guild_id VARCHAR(20) NOT NULL,
  
  -- Versionen
  current_version VARCHAR(20) NOT NULL DEFAULT '0.0.0',
  available_version VARCHAR(20) NULL,
  
  -- Update-Zeitplan
  update_available_at TIMESTAMP NULL COMMENT 'Wann wurde Update erkannt',
  update_deadline_at TIMESTAMP NULL COMMENT 'Deadline für manuelles Update (+ Grace Days)',
  auto_update_at TIMESTAMP NULL COMMENT 'Wann wurde Auto-Update durchgeführt',
  
  -- Status
  update_status ENUM('up-to-date', 'available', 'pending', 'auto-updated', 'failed') DEFAULT 'up-to-date',
  last_check_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  -- Changelog & Fehler
  changelog JSON NULL COMMENT 'Array von Changelog-Einträgen für neue Version',
  error_log TEXT NULL COMMENT 'Fehler bei Migration',
  
  -- Indexes
  UNIQUE KEY unique_plugin_guild (plugin_name, guild_id),
  INDEX idx_deadline (update_deadline_at, update_status),
  INDEX idx_guild (guild_id),
  INDEX idx_status (update_status)
  
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Plugin-Versionierung und Update-Tracking (WordPress-Style)';
