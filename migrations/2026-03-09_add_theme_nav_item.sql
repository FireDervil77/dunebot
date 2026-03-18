-- Migration: Theme-Nav-Item für alle bestehenden Guilds eintragen
-- Datum: 09.03.2026
--
-- Fügt den "Theme-Auswahl"-Menüpunkt unter Einstellungen → Theme
-- für alle Guilds ein, die bereits Core-Navigation haben.

INSERT INTO guild_nav_items
    (plugin, guildId, title, url, icon, sort_order, parent, type, capability, target, visible)
SELECT
    'core',
    existing.guildId,
    'NAV.THEME',
    CONCAT('/guild/', existing.guildId, '/settings/theme'),
    'fa-solid fa-palette',
    20,
    CONCAT('/guild/', existing.guildId, '/settings'),
    'main',
    'CORE.SETTINGS.EDIT',
    '_self',
    1
FROM (
    SELECT DISTINCT guildId
    FROM guild_nav_items
    WHERE plugin = 'core'
) AS existing
WHERE NOT EXISTS (
    SELECT 1
    FROM guild_nav_items
    WHERE plugin = 'core'
      AND guildId = existing.guildId
      AND url = CONCAT('/guild/', existing.guildId, '/settings/theme')
);
