-- Migration: Plugin Badge System
-- Datum: 2025-10-14
-- Beschreibung: Fügt Badge-Spalten zur guild_plugins Tabelle hinzu

ALTER TABLE guild_plugins 
ADD COLUMN badge_status VARCHAR(20) DEFAULT NULL 
    COMMENT 'Badge-Status: new, beta, updated, deprecated',
ADD COLUMN badge_until DATE DEFAULT NULL 
    COMMENT 'Badge sichtbar bis Datum (NULL = permanent)',
ADD COLUMN is_featured BOOLEAN DEFAULT 0
    COMMENT 'Featured Plugin (Highlight im Dashboard)',
ADD INDEX idx_badge (badge_status, badge_until),
ADD INDEX idx_featured (is_featured);

-- Kommentar: Badges werden automatisch gesetzt beim ersten Enable eines Plugins
