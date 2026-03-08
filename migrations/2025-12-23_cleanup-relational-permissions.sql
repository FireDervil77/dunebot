-- ========================================
-- Cleanup: Relationale Permission-ZUORDNUNGS-Tabelle entfernen
-- Datum: 2025-12-23
-- Autor: FireDervil + GitHub Copilot
-- Grund: System nutzt JSON in guild_groups.permissions, nicht relationale Zuordnung
-- ========================================

-- WICHTIG: permission_definitions BLEIBT! 
-- Es ist die Registry/Metadata für UI (Namen, Beschreibungen, Kategorien)
-- Nur die ZUORDNUNGS-Tabelle group_permissions wird entfernt!

-- 1. Drop View (nutzt group_permissions)
DROP VIEW IF EXISTS `v_group_permissions_detailed`;

-- 2. Drop group_permissions Tabelle (Zuordnung Gruppe ↔ Permission via IDs)
-- Foreign Keys werden automatisch entfernt durch DROP TABLE
DROP TABLE IF EXISTS `group_permissions`;

-- 3. Entferne permissions_migrated Flag (nicht mehr nötig)
ALTER TABLE `guild_groups` 
  DROP COLUMN IF EXISTS `permissions_migrated`;

-- 4. Backup der alten refactor-migration umbenennen
-- Manual: migrations/refactor-permission-system.sql → migrations/archiv/

COMMIT;

-- ========================================
-- Verifikation
-- ========================================
-- Zeige verbleibende Permission-Tabellen:
-- SHOW TABLES LIKE '%permission%';
-- 
-- Erwartet:
-- ✅ permission_definitions (bleibt! UI-Metadata)
-- ✅ guild_users (mit direct_permissions JSON)
-- ✅ guild_groups (mit permissions JSON)
-- ✅ v_guild_user_permissions (VIEW nutzt JSON)
-- ✅ v_guild_groups_summary (VIEW nutzt JSON)
-- ❌ group_permissions (gelöscht! War nur Zuordnung)
-- ❌ v_group_permissions_detailed (gelöscht! Nutzte group_permissions)
