-- ============================================================================
-- Migration: permission_definitions global machen (kein guild_id-Bezug mehr)
-- Datum: 2026-03-09
-- Grund: permission_definitions ist eine System-Tabelle mit globalem Scope.
--        Permissions werden einmal registriert und gelten für alle Guilds.
--        Der Guild-Bezug liegt nur in guild_groups.permissions (JSON).
-- ============================================================================

-- 1. Alle bestehenden Einträge auf NULL setzen
UPDATE permission_definitions SET guild_id = NULL;

-- 2. Duplikate entfernen (falls mehrere Guild-Kopien existieren)
--    Behalte den ältesten Eintrag pro permission_key
DELETE pd1 FROM permission_definitions pd1
    INNER JOIN permission_definitions pd2
    WHERE pd1.permission_key = pd2.permission_key AND pd1.id > pd2.id;

-- 3. UNIQUE Constraint auf permission_key setzen
ALTER TABLE permission_definitions
    ADD UNIQUE KEY IF NOT EXISTS uq_permission_key (permission_key);
