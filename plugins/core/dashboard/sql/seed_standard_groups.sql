-- ============================================================================
-- PERMISSIONS SYSTEM - Seed Standard-Gruppen (Template)
-- ============================================================================
-- Erstellt: 30. Oktober 2025
-- Beschreibung: Standard-Gruppen die bei Guild-Setup automatisch erstellt werden
-- HINWEIS: Diese Daten werden NICHT direkt eingefügt, sondern via Script
--          bei Guild-Setup verwendet (siehe PermissionManager.seedDefaultGroups)
-- ============================================================================

-- Diese SQL-Datei dient als Dokumentation für die Standard-Gruppen.
-- Die tatsächliche Erstellung erfolgt via Node.js Code!

/*

STANDARD-GRUPPEN (Pro Guild):

1. ADMINISTRATOR (Admin)
   - Vollzugriff auf alles
   - Kann nicht gelöscht werden (is_protected = true)
   - Farbe: #dc3545 (Rot)
   - Icon: fa-shield-alt
   - Permissions: Alle (wildcard "*" oder explizit alle)

2. MODERATOR (Moderatoren)
   - Server-Management
   - Moderation
   - Logs ansehen
   - Farbe: #007bff (Blau)
   - Icon: fa-user-shield

3. SUPPORT (Support-Team)
   - Server ansehen
   - Console lesen
   - Logs ansehen
   - Farbe: #28a745 (Grün)
   - Icon: fa-headset

4. VIEWER (Standard-User)
   - Nur ansehen
   - Keine Aktionen
   - is_default = true (wird automatisch zugewiesen)
   - Farbe: #6c757d (Grau)
   - Icon: fa-eye

*/

-- ============================================================================
-- Beispiel INSERT (wird via Node.js ausgeführt, nicht direkt hier!)
-- ============================================================================

/*
-- Administrator-Gruppe
INSERT INTO guild_groups (guild_id, name, slug, description, color, icon, is_default, is_protected, priority, permissions)
VALUES (
    :guild_id,
    'Administrator',
    'administrator',
    'Vollzugriff auf alle Dashboard-Funktionen',
    '#dc3545',
    'fa-shield-alt',
    FALSE,
    TRUE,  -- Geschützt (nicht löschbar)
    100,   -- Höchste Priorität
    JSON_OBJECT(
        'wildcard', TRUE,  -- Alle Permissions
        -- Oder explizit:
        'dashboard.settings.edit', TRUE,
        'permissions.users.view', TRUE,
        'permissions.users.invite', TRUE,
        'permissions.users.remove', TRUE,
        'permissions.groups.create', TRUE,
        'permissions.groups.edit', TRUE,
        'permissions.groups.delete', TRUE,
        'permissions.assign', TRUE,
        'gameserver.view', TRUE,
        'gameserver.create', TRUE,
        'gameserver.start', TRUE,
        'gameserver.stop', TRUE,
        'gameserver.restart', TRUE,
        'gameserver.delete', TRUE,
        'gameserver.console.view', TRUE,
        'gameserver.console.execute', TRUE,
        'gameserver.files.view', TRUE,
        'gameserver.files.upload', TRUE,
        'gameserver.files.delete', TRUE,
        'gameserver.settings.edit', TRUE,
        'moderation.view', TRUE,
        'moderation.ban', TRUE,
        'moderation.kick', TRUE,
        'moderation.warn', TRUE,
        'moderation.settings.edit', TRUE
    )
);

-- Moderator-Gruppe
INSERT INTO guild_groups (guild_id, name, slug, description, color, icon, is_default, is_protected, priority, permissions)
VALUES (
    :guild_id,
    'Moderatoren',
    'moderators',
    'Server-Management und Moderation',
    '#007bff',
    'fa-user-shield',
    FALSE,
    FALSE,
    50,
    JSON_OBJECT(
        'gameserver.view', TRUE,
        'gameserver.start', TRUE,
        'gameserver.stop', TRUE,
        'gameserver.restart', TRUE,
        'gameserver.console.view', TRUE,
        'gameserver.console.execute', TRUE,
        'gameserver.files.view', TRUE,
        'moderation.view', TRUE,
        'moderation.ban', TRUE,
        'moderation.kick', TRUE,
        'moderation.warn', TRUE,
        'permissions.users.view', TRUE
    )
);

-- Support-Gruppe
INSERT INTO guild_groups (guild_id, name, slug, description, color, icon, is_default, is_protected, priority, permissions)
VALUES (
    :guild_id,
    'Support',
    'support',
    'Ansehen und Logs lesen',
    '#28a745',
    'fa-headset',
    FALSE,
    FALSE,
    25,
    JSON_OBJECT(
        'gameserver.view', TRUE,
        'gameserver.console.view', TRUE,
        'gameserver.files.view', TRUE,
        'moderation.view', TRUE,
        'permissions.users.view', TRUE
    )
);

-- Viewer-Gruppe (Standard)
INSERT INTO guild_groups (guild_id, name, slug, description, color, icon, is_default, is_protected, priority, permissions)
VALUES (
    :guild_id,
    'Viewer',
    'viewer',
    'Standard-Benutzer (nur Ansicht)',
    '#6c757d',
    'fa-eye',
    TRUE,  -- Wird automatisch neuen Usern zugewiesen
    FALSE,
    0,
    JSON_OBJECT(
        'gameserver.view', TRUE,
        'moderation.view', TRUE
    )
);
*/

-- ============================================================================
-- ENDE
-- ============================================================================
