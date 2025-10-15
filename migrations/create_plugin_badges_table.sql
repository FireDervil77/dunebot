-- Migration: Globale Plugin Badge Tabelle
-- Datum: 2025-10-14
-- Beschreibung: Erstellt globale Badge-Verwaltung für Plugin-Releases

CREATE TABLE IF NOT EXISTS plugin_badges (
    id INT AUTO_INCREMENT PRIMARY KEY,
    plugin_name VARCHAR(50) NOT NULL UNIQUE,
    badge_status VARCHAR(20) NOT NULL 
        COMMENT 'Badge-Status: new, beta, updated, deprecated',
    badge_until DATE DEFAULT NULL 
        COMMENT 'Badge sichtbar bis Datum (NULL = permanent)',
    is_featured BOOLEAN DEFAULT 0
        COMMENT 'Featured Plugin (Highlight im Dashboard)',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_badge_status (badge_status, badge_until),
    INDEX idx_featured (is_featured)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Globale Plugin-Badges für Release-Management (SuperAdmin)';
