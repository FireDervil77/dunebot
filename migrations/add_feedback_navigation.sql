-- Migration: Add Bug Report and Feature Request navigation for all guilds
-- Date: 2025-10-12
-- Description: Fügt Bug Report und Feature Request Navigation für alle bestehenden Guilds hinzu

-- Bug Report Navigation (vor Plugins, sort_order 25)
INSERT INTO nav_items 
    (plugin, guildId, title, url, icon, sort_order, parent, type, capability, target, visible, classes, position)
SELECT 
    'core' as plugin,
    guildId,
    'NAV.BUG_REPORT' as title,
    CONCAT('/guild/', guildId, '/bug-report') as url,
    'fa-solid fa-bug' as icon,
    25 as sort_order,
    NULL as parent,
    'main' as type,
    'manage_guild' as capability,
    '_self' as target,
    1 as visible,
    '' as classes,
    'normal' as position
FROM (
    SELECT DISTINCT guildId 
    FROM nav_items 
    WHERE plugin = 'core'
) as guilds
WHERE NOT EXISTS (
    SELECT 1 FROM nav_items 
    WHERE nav_items.guildId = guilds.guildId 
    AND nav_items.url LIKE CONCAT('%/guild/', guilds.guildId, '/bug-report%')
);

-- Feature Request Navigation (nach Bug Report, sort_order 26)
INSERT INTO nav_items 
    (plugin, guildId, title, url, icon, sort_order, parent, type, capability, target, visible, classes, position)
SELECT 
    'core' as plugin,
    guildId,
    'NAV.FEATURE_REQUEST' as title,
    CONCAT('/guild/', guildId, '/feature-request') as url,
    'fa-solid fa-lightbulb' as icon,
    26 as sort_order,
    NULL as parent,
    'main' as type,
    'manage_guild' as capability,
    '_self' as target,
    1 as visible,
    '' as classes,
    'normal' as position
FROM (
    SELECT DISTINCT guildId 
    FROM nav_items 
    WHERE plugin = 'core'
) as guilds
WHERE NOT EXISTS (
    SELECT 1 FROM nav_items 
    WHERE nav_items.guildId = guilds.guildId 
    AND nav_items.url LIKE CONCAT('%/guild/', guilds.guildId, '/feature-request%')
);

-- Verify insertion
SELECT 
    '=== INSERTED ITEMS ===' as status,
    COUNT(*) as total_items,
    SUM(CASE WHEN url LIKE '%bug-report' THEN 1 ELSE 0 END) as bug_reports,
    SUM(CASE WHEN url LIKE '%feature-request' THEN 1 ELSE 0 END) as feature_requests
FROM nav_items 
WHERE url LIKE '%bug-report' OR url LIKE '%feature-request';
