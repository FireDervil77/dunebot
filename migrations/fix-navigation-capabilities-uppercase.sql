-- ════════════════════════════════════════════════════════════════
-- Migration: Navigation Capabilities auf UPPERCASE umstellen
-- Datum: 2025-11-02
-- ════════════════════════════════════════════════════════════════
--
-- Problem: Alle nav_items haben capability='manage_guild' (lowercase)
-- Lösung: Alte Items löschen, werden beim Dashboard-Neustart mit
--         korrekten UPPERCASE capabilities neu erstellt
--
-- ════════════════════════════════════════════════════════════════

-- Backup der alten Navigation (optional, zur Sicherheit)
CREATE TABLE IF NOT EXISTS guild_nav_items_backup_20251102 AS SELECT * FROM guild_nav_items;

-- Alte guild_nav_items mit lowercase capabilities löschen
DELETE FROM guild_nav_items WHERE capability = 'manage_guild';

-- Hinweis: Navigation wird beim nächsten Dashboard-Restart automatisch
-- neu erstellt mit korrekten UPPERCASE capabilities aus den Plugins!
