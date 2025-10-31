-- Migration-Tracking für Plugin-Schema-Updates
-- Verhindert doppelte Ausführung von SQL-Dateien
-- Ermöglicht saubere Updates und Fresh-Installs

CREATE TABLE IF NOT EXISTS plugin_migrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    
    -- Plugin-Identifikation
    plugin_name VARCHAR(100) NOT NULL,
    guild_id VARCHAR(50) DEFAULT NULL, -- NULL = global migration
    
    -- Migration-Identifikation
    migration_file VARCHAR(255) NOT NULL, -- z.B. "001_create_permissions_table.sql"
    migration_version VARCHAR(20) NOT NULL, -- z.B. "1.2.0"
    migration_type ENUM('schema', 'data', 'update') DEFAULT 'schema',
    
    -- Execution-Tracking
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    execution_time_ms INT DEFAULT 0,
    success BOOLEAN DEFAULT TRUE,
    error_log TEXT DEFAULT NULL,
    
    -- Rollback-Support
    rollback_file VARCHAR(255) DEFAULT NULL, -- Optional: down-Migration
    rolled_back_at TIMESTAMP NULL DEFAULT NULL,
    
    -- Indexes für Performance
    INDEX idx_plugin_guild (plugin_name, guild_id),
    INDEX idx_migration_file (plugin_name, migration_file),
    UNIQUE KEY unique_migration (plugin_name, guild_id, migration_file)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Kommentar hinzufügen
ALTER TABLE plugin_migrations COMMENT = 'Tracking-Tabelle für Plugin-Schema-Migrationen (verhindert doppelte Ausführung)';
