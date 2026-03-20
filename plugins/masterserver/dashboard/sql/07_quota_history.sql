-- =====================================================
-- Masterserver Plugin - Quota History Table
-- =====================================================
-- Audit-Trail für alle Quota-Änderungen
-- Tracked wer, wann, was geändert hat
-- Wichtig für Compliance und Debugging
-- =====================================================

CREATE TABLE IF NOT EXISTS quota_history (
    -- Primary Key
    id INT AUTO_INCREMENT PRIMARY KEY,
    
    -- Entity Reference
    entity_type ENUM('rootserver', 'gameserver', 'profile') NOT NULL COMMENT 'Typ der Entität',
    entity_id INT NOT NULL COMMENT 'ID der Entität (rootserver_id, gameserver_id, profile_id)',
    
    -- Change Details
    field_name VARCHAR(50) NOT NULL COMMENT 'Geändertes Feld (z.B. "allocated_ram_mb")',
    old_value VARCHAR(100) DEFAULT NULL COMMENT 'Alter Wert',
    new_value VARCHAR(100) NOT NULL COMMENT 'Neuer Wert',
    
    -- Context
    changed_by_user_id VARCHAR(30) DEFAULT NULL COMMENT 'Discord User ID des Änderers',
    change_reason TEXT DEFAULT NULL COMMENT 'Grund der Änderung',
    
    -- Additional Data (JSON)
    metadata JSON DEFAULT NULL COMMENT 'Zusätzliche Metadaten (z.B. IP, Request-ID)',
    
    -- Timestamp
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Zeitpunkt der Änderung',
    
    -- Indexes
    INDEX idx_entity (entity_type, entity_id, created_at),
    INDEX idx_user (changed_by_user_id),
    INDEX idx_field (field_name),
    INDEX idx_created (created_at)
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Audit-Trail für Quota-Änderungen';
