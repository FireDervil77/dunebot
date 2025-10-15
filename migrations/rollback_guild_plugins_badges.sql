-- Rollback Migration: Plugin Badge System aus guild_plugins entfernen
-- Datum: 2025-10-14
-- Beschreibung: Entfernt Badge-Spalten aus guild_plugins (waren falsch platziert)

ALTER TABLE guild_plugins 
DROP INDEX idx_badge,
DROP INDEX idx_featured,
DROP COLUMN badge_status,
DROP COLUMN badge_until,
DROP COLUMN is_featured;

-- Grund: Badges sollen GLOBAL für alle Guilds sein, nicht guild-spezifisch
