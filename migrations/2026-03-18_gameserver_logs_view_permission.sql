-- Migration: GAMESERVER.LOGS.VIEW Permission in permission_definitions eintragen
-- Datum: 2026-03-18
-- Zweck: Die Permission wurde in permissions.json definiert aber fehlt ggf. noch
--        in der DB (wenn das Plugin vor Hinzufügen dieser Permission aktiviert wurde)
--
-- Hinweis: Administrator-Gruppen bekommen alle Permissions aus permission_definitions
-- dynamisch (via GuildManager.js). Nach Ausführen dieser Migration greift die
-- Permission für Administratoren sofort.
-- Für andere Gruppen: Plugin im Dashboard deaktivieren + neu aktivieren.

INSERT INTO `permission_definitions`
    (`permission_key`, `name_translation_key`, `description_translation_key`, `category`, `is_dangerous`, `requires_permissions`, `plugin_name`)
VALUES
    (
        'GAMESERVER.LOGS.VIEW',
        'Logs anzeigen',
        'Berechtigung um Server-Logs zu sehen',
        'gameserver',
        0,
        '["GAMESERVER.VIEW"]',
        'gameserver'
    )
ON DUPLICATE KEY UPDATE
    `name_translation_key`        = VALUES(`name_translation_key`),
    `description_translation_key` = VALUES(`description_translation_key`),
    `plugin_name`                 = VALUES(`plugin_name`),
    `is_active`                   = 1;

-- Administrator-Gruppen per JSON-Update aktualisieren (bestehende Guilds)
-- JSON_SET setzt den Key nur wenn er noch nicht existiert (JSON_CONTAINS prüft vorher)
UPDATE `guild_groups`
SET `permissions` = JSON_SET(
        COALESCE(`permissions`, '{}'),
        '$."GAMESERVER.LOGS.VIEW"',
        TRUE
    ),
    `updated_at` = NOW()
WHERE `slug` = 'administrator'
  AND (
      `permissions` IS NULL
      OR NOT JSON_CONTAINS(COALESCE(`permissions`, '{}'), 'true', '$."GAMESERVER.LOGS.VIEW"')
  );
