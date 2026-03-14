-- =============================================
-- Addon Comments Tabelle
-- Speichert Kommentare zu Addons (mit Reply-Support)
-- =============================================

CREATE TABLE IF NOT EXISTS addon_comments (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    
    -- Referenzen
    addon_id INT UNSIGNED NOT NULL COMMENT 'FK zu addon_marketplace',
    user_id VARCHAR(20) NOT NULL COMMENT 'Discord User-ID des Kommentators',
    
    -- Comment-System
    parent_id INT UNSIGNED NULL COMMENT 'Für Replies/Threads (NULL = Top-Level)',
    comment TEXT NOT NULL COMMENT 'Kommentar-Text',
    
    -- Moderation
    is_deleted BOOLEAN DEFAULT FALSE COMMENT 'Soft-Delete (für Moderation)',
    deleted_by VARCHAR(20) NULL COMMENT 'User-ID des Moderators',
    deleted_at TIMESTAMP NULL,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Indizes
    INDEX idx_addon (addon_id),
    INDEX idx_user (user_id),
    INDEX idx_parent (parent_id),
    INDEX idx_created (created_at DESC),
    
    -- Foreign Keys
    FOREIGN KEY (addon_id) REFERENCES addon_marketplace(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES addon_comments(id) ON DELETE CASCADE
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Kommentare zu Addons';
