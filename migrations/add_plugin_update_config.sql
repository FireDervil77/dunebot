-- SuperAdmin Config: Plugin Auto-Update Einstellungen
-- Erstellt: 2025-10-09
-- @author FireDervil

-- Prüfen ob superadmin_config existiert, sonst erstellen
CREATE TABLE IF NOT EXISTS superadmin_config (
  config_key VARCHAR(100) PRIMARY KEY,
  config_value TEXT NOT NULL,
  config_type ENUM('string', 'number', 'boolean', 'json') DEFAULT 'string',
  description TEXT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Plugin Auto-Update Einstellungen hinzufügen
INSERT INTO superadmin_config (config_key, config_value, config_type, description)
VALUES 
  (
    'plugin_auto_update_enabled', 
    'true', 
    'boolean', 
    'Globale Aktivierung von automatischen Plugin-Updates nach Ablauf der Frist'
  ),
  (
    'plugin_update_grace_days', 
    '5', 
    'number', 
    'Anzahl Tage, die User Zeit haben Plugins manuell zu aktualisieren bevor Auto-Update greift'
  )
ON DUPLICATE KEY UPDATE 
  config_value = VALUES(config_value),
  description = VALUES(description);
