-- =============================================
-- Addon Favorites Tabelle
-- Speichert User-Favoriten für Addons
-- =============================================

CREATE TABLE IF NOT EXISTS addon_favorites (
    user_id VARCHAR(20) NOT NULL COMMENT 'Discord User-ID',
    addon_id INT UNSIGNED NOT NULL COMMENT 'FK zu addon_marketplace',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Primary Key (Composite)
    PRIMARY KEY (user_id, addon_id),
    
    -- Indizes
    INDEX idx_user (user_id),
    INDEX idx_addon (addon_id),
    
    -- Foreign Keys
    FOREIGN KEY (addon_id) REFERENCES addon_marketplace(id) ON DELETE CASCADE
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='User-Favoriten für Addons';
