-- =============================================
-- Addon Ratings Tabelle
-- Speichert User-Bewertungen für Addons
-- =============================================

CREATE TABLE IF NOT EXISTS addon_ratings (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    
    -- Referenzen
    addon_id INT UNSIGNED NOT NULL COMMENT 'FK zu addon_marketplace',
    user_id VARCHAR(20) NOT NULL COMMENT 'Discord User-ID des Bewerters',
    
    -- Rating
    rating INT NOT NULL COMMENT 'Bewertung: 1-5 Sterne',
    review TEXT NULL COMMENT 'Optionale Text-Bewertung',
    
    -- Hilfreich-Counter
    helpful_count INT DEFAULT 0 COMMENT 'Wie viele User fanden diese Bewertung hilfreich?',
    
    -- Nutzungs-Verification
    usage_hours DECIMAL(10,2) DEFAULT 0.00 COMMENT 'Wie lange hat User das Addon genutzt? (für Anti-Spam)',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Indizes
    INDEX idx_addon (addon_id),
    INDEX idx_user (user_id),
    INDEX idx_rating (rating),
    INDEX idx_helpful (helpful_count DESC),
    
    -- Constraints
    UNIQUE KEY unique_addon_user (addon_id, user_id) COMMENT 'Ein User kann ein Addon nur einmal bewerten',
    CONSTRAINT check_rating_range CHECK (rating >= 1 AND rating <= 5),
    
    -- Foreign Keys
    FOREIGN KEY (addon_id) REFERENCES addon_marketplace(id) ON DELETE CASCADE
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='User-Bewertungen für Addons';
