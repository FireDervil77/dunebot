-- =============================================
-- Addon Versions Tabelle
-- Speichert Version-History für Addons
-- =============================================

CREATE TABLE IF NOT EXISTS addon_versions (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    
    -- Referenzen
    addon_id INT UNSIGNED NOT NULL COMMENT 'FK zu addon_marketplace',
    
    -- Version-Info
    version VARCHAR(20) NOT NULL COMMENT 'Version-String (SemVer)',
    game_data JSON NOT NULL COMMENT 'Snapshot der game_data.json für diese Version',
    changelog TEXT COMMENT 'Changelog für diese Version',
    
    -- Status
    is_latest BOOLEAN DEFAULT FALSE COMMENT 'Ist dies die aktuellste Version?',
    
    -- Timestamps
    published_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Indizes
    INDEX idx_addon (addon_id),
    INDEX idx_version (version),
    INDEX idx_latest (is_latest),
    
    -- Constraints
    UNIQUE KEY unique_addon_version (addon_id, version) COMMENT 'Jede Version nur einmal pro Addon',
    
    -- Foreign Keys
    FOREIGN KEY (addon_id) REFERENCES addon_marketplace(id) ON DELETE CASCADE
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Version-History für Addons';
