-- ========================================
-- Permission System Refactor
-- Datum: 2025-11-03
-- Autor: FireDervil + GitHub Copilot
-- ========================================

-- 1. Erstelle group_permissions Tabelle (Zuordnung Gruppe ↔ Permission)
CREATE TABLE IF NOT EXISTS `group_permissions` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `group_id` INT(11) NOT NULL COMMENT 'FK zu guild_groups.id',
  `permission_id` INT(11) NOT NULL COMMENT 'FK zu permission_definitions.id',
  `assigned_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Wann wurde Permission zugewiesen',
  `assigned_by` VARCHAR(20) DEFAULT NULL COMMENT 'User-ID der den Permission zugewiesen hat (NULL = System)',
  `is_inherited` TINYINT(1) DEFAULT 0 COMMENT 'Kommt von Parent-Gruppe (für spätere Hierarchie)',
  `grant_option` TINYINT(1) DEFAULT 0 COMMENT 'Darf diese Permission weitergeben (für spätere Features)',
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Letzte Änderung',
  
  PRIMARY KEY (`id`),
  
  -- UNIQUE Constraint: Eine Permission darf pro Gruppe nur einmal existieren
  UNIQUE KEY `unique_group_permission` (`group_id`, `permission_id`),
  
  -- Foreign Keys mit CASCADE (wichtig für automatisches Cleanup!)
  CONSTRAINT `fk_gp_group` 
    FOREIGN KEY (`group_id`) 
    REFERENCES `guild_groups` (`id`) 
    ON DELETE CASCADE 
    ON UPDATE CASCADE,
    
  CONSTRAINT `fk_gp_permission` 
    FOREIGN KEY (`permission_id`) 
    REFERENCES `permission_definitions` (`id`) 
    ON DELETE CASCADE 
    ON UPDATE CASCADE,
  
  -- Performance-Indizes
  KEY `idx_group_id` (`group_id`),
  KEY `idx_permission_id` (`permission_id`),
  KEY `idx_assigned_at` (`assigned_at`),
  
  -- Composite Index für schnelle Permission-Checks
  -- z.B. "Hat Gruppe X Permission Y?"
  KEY `idx_group_permission_lookup` (`group_id`, `permission_id`),
  
  -- Index für Guild-weite Queries (über guild_groups.guild_id)
  -- wird automatisch über FK optimiert, aber explizit für Klarheit
  KEY `idx_assigned_by` (`assigned_by`)
  
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
ROW_FORMAT=DYNAMIC
COMMENT='Zuordnung von Permissions zu Gruppen - ersetzt JSON in guild_groups.permissions';

-- 2. Füge Spalte für Migration-Tracking hinzu
ALTER TABLE `guild_groups` 
  ADD COLUMN `permissions_migrated` TINYINT(1) DEFAULT 0 
  COMMENT 'Flag: JSON-Permissions wurden zu group_permissions migriert'
  AFTER `permissions`;

-- 3. Erstelle View für einfache Permission-Abfragen
-- Diese View macht JOINs überflüssig in den meisten Fällen
DROP VIEW IF EXISTS `v_group_permissions_detailed`;

CREATE VIEW `v_group_permissions_detailed` AS
SELECT 
  gp.id AS assignment_id,
  gp.group_id,
  gp.permission_id,
  gp.assigned_at,
  gp.assigned_by,
  gp.is_inherited,
  gp.grant_option,
  gp.updated_at,
  
  -- Gruppen-Info
  gg.guild_id,
  gg.name AS group_name,
  gg.slug AS group_slug,
  gg.is_default AS is_default_group,
  gg.priority AS group_priority,
  gg.color AS group_color,
  
  -- Permission-Info
  pd.permission_key,
  pd.name_translation_key AS permission_name_key,
  pd.description_translation_key AS permission_desc_key,
  pd.category AS permission_category,
  pd.plugin_name,
  pd.is_dangerous,
  pd.requires_permissions,
  pd.sort_order,
  pd.is_active,
  
  -- Composite Keys für schnelle Lookups
  CONCAT(gg.guild_id, ':', pd.permission_key) AS guild_permission_key,
  CONCAT(gp.group_id, ':', pd.permission_key) AS group_permission_key
  
FROM group_permissions gp
INNER JOIN guild_groups gg ON gp.group_id = gg.id
INNER JOIN permission_definitions pd ON gp.permission_id = pd.id

ORDER BY gg.guild_id, gg.priority DESC, pd.plugin_name, pd.permission_key;

-- Queries wie:
-- SELECT * FROM v_group_permissions_detailed WHERE guild_id = ? AND permission_key = ?
-- SELECT * FROM v_group_permissions_detailed WHERE group_id = ?
-- SELECT * FROM v_group_permissions_detailed WHERE plugin_name = ?
-- sind jetzt optimiert durch die Indexes auf den Base-Tables

COMMIT;
