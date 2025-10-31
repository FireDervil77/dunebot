-- ============================================================================
-- PERMISSIONS SYSTEM - Seed Permission Definitions
-- ============================================================================
-- Erstellt: 30. Oktober 2025
-- Beschreibung: Alle verfügbaren Permissions im System
-- ============================================================================

-- ============================================================================
-- DASHBOARD CORE PERMISSIONS
-- ============================================================================
INSERT INTO permission_definitions (permission_key, category, name_translation_key, description_translation_key, is_dangerous, plugin_name, sort_order) VALUES
('dashboard.settings.edit', 'dashboard', 'PERMISSIONS.DASHBOARD_SETTINGS_EDIT', 'PERMISSIONS.DASHBOARD_SETTINGS_EDIT_DESC', TRUE, 'core', 10),
('dashboard.settings.view', 'dashboard', 'PERMISSIONS.DASHBOARD_SETTINGS_VIEW', 'PERMISSIONS.DASHBOARD_SETTINGS_VIEW_DESC', FALSE, 'core', 11);

-- ============================================================================
-- PERMISSIONS MANAGEMENT
-- ============================================================================
INSERT INTO permission_definitions (permission_key, category, name_translation_key, description_translation_key, is_dangerous, plugin_name, sort_order) VALUES
('permissions.users.view', 'permissions', 'PERMISSIONS.USERS_VIEW', 'PERMISSIONS.USERS_VIEW_DESC', FALSE, 'core', 20),
('permissions.users.invite', 'permissions', 'PERMISSIONS.USERS_INVITE', 'PERMISSIONS.USERS_INVITE_DESC', FALSE, 'core', 21),
('permissions.users.edit', 'permissions', 'PERMISSIONS.USERS_EDIT', 'PERMISSIONS.USERS_EDIT_DESC', TRUE, 'core', 22),
('permissions.users.remove', 'permissions', 'PERMISSIONS.USERS_REMOVE', 'PERMISSIONS.USERS_REMOVE_DESC', TRUE, 'core', 23),
('permissions.groups.view', 'permissions', 'PERMISSIONS.GROUPS_VIEW', 'PERMISSIONS.GROUPS_VIEW_DESC', FALSE, 'core', 30),
('permissions.groups.create', 'permissions', 'PERMISSIONS.GROUPS_CREATE', 'PERMISSIONS.GROUPS_CREATE_DESC', FALSE, 'core', 31),
('permissions.groups.edit', 'permissions', 'PERMISSIONS.GROUPS_EDIT', 'PERMISSIONS.GROUPS_EDIT_DESC', TRUE, 'core', 32),
('permissions.groups.delete', 'permissions', 'PERMISSIONS.GROUPS_DELETE', 'PERMISSIONS.GROUPS_DELETE_DESC', TRUE, 'core', 33),
('permissions.assign', 'permissions', 'PERMISSIONS.ASSIGN', 'PERMISSIONS.ASSIGN_DESC', TRUE, 'core', 40);

-- ============================================================================
-- GAMESERVER PLUGIN PERMISSIONS
-- ============================================================================
INSERT INTO permission_definitions (permission_key, category, name_translation_key, description_translation_key, is_dangerous, requires_permissions, plugin_name, sort_order) VALUES
('gameserver.view', 'gameserver', 'PERMISSIONS.GAMESERVER_VIEW', 'PERMISSIONS.GAMESERVER_VIEW_DESC', FALSE, NULL, 'gameserver', 100),
('gameserver.create', 'gameserver', 'PERMISSIONS.GAMESERVER_CREATE', 'PERMISSIONS.GAMESERVER_CREATE_DESC', FALSE, JSON_ARRAY('gameserver.view'), 'gameserver', 101),
('gameserver.start', 'gameserver', 'PERMISSIONS.GAMESERVER_START', 'PERMISSIONS.GAMESERVER_START_DESC', FALSE, JSON_ARRAY('gameserver.view'), 'gameserver', 110),
('gameserver.stop', 'gameserver', 'PERMISSIONS.GAMESERVER_STOP', 'PERMISSIONS.GAMESERVER_STOP_DESC', FALSE, JSON_ARRAY('gameserver.view'), 'gameserver', 111),
('gameserver.restart', 'gameserver', 'PERMISSIONS.GAMESERVER_RESTART', 'PERMISSIONS.GAMESERVER_RESTART_DESC', FALSE, JSON_ARRAY('gameserver.view'), 'gameserver', 112),
('gameserver.delete', 'gameserver', 'PERMISSIONS.GAMESERVER_DELETE', 'PERMISSIONS.GAMESERVER_DELETE_DESC', TRUE, JSON_ARRAY('gameserver.view'), 'gameserver', 120),
('gameserver.settings.view', 'gameserver', 'PERMISSIONS.GAMESERVER_SETTINGS_VIEW', 'PERMISSIONS.GAMESERVER_SETTINGS_VIEW_DESC', FALSE, JSON_ARRAY('gameserver.view'), 'gameserver', 130),
('gameserver.settings.edit', 'gameserver', 'PERMISSIONS.GAMESERVER_SETTINGS_EDIT', 'PERMISSIONS.GAMESERVER_SETTINGS_EDIT_DESC', TRUE, JSON_ARRAY('gameserver.view'), 'gameserver', 131);

-- Console Permissions
INSERT INTO permission_definitions (permission_key, category, name_translation_key, description_translation_key, is_dangerous, requires_permissions, plugin_name, sort_order) VALUES
('gameserver.console.view', 'gameserver', 'PERMISSIONS.GAMESERVER_CONSOLE_VIEW', 'PERMISSIONS.GAMESERVER_CONSOLE_VIEW_DESC', FALSE, JSON_ARRAY('gameserver.view'), 'gameserver', 140),
('gameserver.console.execute', 'gameserver', 'PERMISSIONS.GAMESERVER_CONSOLE_EXECUTE', 'PERMISSIONS.GAMESERVER_CONSOLE_EXECUTE_DESC', TRUE, JSON_ARRAY('gameserver.console.view'), 'gameserver', 141);

-- File Manager Permissions
INSERT INTO permission_definitions (permission_key, category, name_translation_key, description_translation_key, is_dangerous, requires_permissions, plugin_name, sort_order) VALUES
('gameserver.files.view', 'gameserver', 'PERMISSIONS.GAMESERVER_FILES_VIEW', 'PERMISSIONS.GAMESERVER_FILES_VIEW_DESC', FALSE, JSON_ARRAY('gameserver.view'), 'gameserver', 150),
('gameserver.files.upload', 'gameserver', 'PERMISSIONS.GAMESERVER_FILES_UPLOAD', 'PERMISSIONS.GAMESERVER_FILES_UPLOAD_DESC', FALSE, JSON_ARRAY('gameserver.files.view'), 'gameserver', 151),
('gameserver.files.edit', 'gameserver', 'PERMISSIONS.GAMESERVER_FILES_EDIT', 'PERMISSIONS.GAMESERVER_FILES_EDIT_DESC', TRUE, JSON_ARRAY('gameserver.files.view'), 'gameserver', 152),
('gameserver.files.delete', 'gameserver', 'PERMISSIONS.GAMESERVER_FILES_DELETE', 'PERMISSIONS.GAMESERVER_FILES_DELETE_DESC', TRUE, JSON_ARRAY('gameserver.files.view'), 'gameserver', 153),
('gameserver.files.download', 'gameserver', 'PERMISSIONS.GAMESERVER_FILES_DOWNLOAD', 'PERMISSIONS.GAMESERVER_FILES_DOWNLOAD_DESC', FALSE, JSON_ARRAY('gameserver.files.view'), 'gameserver', 154);

-- ============================================================================
-- MODERATION PLUGIN PERMISSIONS
-- ============================================================================
INSERT INTO permission_definitions (permission_key, category, name_translation_key, description_translation_key, is_dangerous, requires_permissions, plugin_name, sort_order) VALUES
('moderation.view', 'moderation', 'PERMISSIONS.MODERATION_VIEW', 'PERMISSIONS.MODERATION_VIEW_DESC', FALSE, NULL, 'moderation', 200),
('moderation.ban', 'moderation', 'PERMISSIONS.MODERATION_BAN', 'PERMISSIONS.MODERATION_BAN_DESC', TRUE, JSON_ARRAY('moderation.view'), 'moderation', 210),
('moderation.kick', 'moderation', 'PERMISSIONS.MODERATION_KICK', 'PERMISSIONS.MODERATION_KICK_DESC', FALSE, JSON_ARRAY('moderation.view'), 'moderation', 211),
('moderation.warn', 'moderation', 'PERMISSIONS.MODERATION_WARN', 'PERMISSIONS.MODERATION_WARN_DESC', FALSE, JSON_ARRAY('moderation.view'), 'moderation', 212),
('moderation.mute', 'moderation', 'PERMISSIONS.MODERATION_MUTE', 'PERMISSIONS.MODERATION_MUTE_DESC', FALSE, JSON_ARRAY('moderation.view'), 'moderation', 213),
('moderation.settings.view', 'moderation', 'PERMISSIONS.MODERATION_SETTINGS_VIEW', 'PERMISSIONS.MODERATION_SETTINGS_VIEW_DESC', FALSE, JSON_ARRAY('moderation.view'), 'moderation', 220),
('moderation.settings.edit', 'moderation', 'PERMISSIONS.MODERATION_SETTINGS_EDIT', 'PERMISSIONS.MODERATION_SETTINGS_EDIT_DESC', TRUE, JSON_ARRAY('moderation.view'), 'moderation', 221);

-- ============================================================================
-- GREETING PLUGIN PERMISSIONS
-- ============================================================================
INSERT INTO permission_definitions (permission_key, category, name_translation_key, description_translation_key, is_dangerous, plugin_name, sort_order) VALUES
('greeting.settings.view', 'greeting', 'PERMISSIONS.GREETING_SETTINGS_VIEW', 'PERMISSIONS.GREETING_SETTINGS_VIEW_DESC', FALSE, 'greeting', 300),
('greeting.settings.edit', 'greeting', 'PERMISSIONS.GREETING_SETTINGS_EDIT', 'PERMISSIONS.GREETING_SETTINGS_EDIT_DESC', FALSE, 'greeting', 301);

-- ============================================================================
-- INFORMATION PLUGIN PERMISSIONS
-- ============================================================================
INSERT INTO permission_definitions (permission_key, category, name_translation_key, description_translation_key, is_dangerous, plugin_name, sort_order) VALUES
('information.settings.view', 'information', 'PERMISSIONS.INFORMATION_SETTINGS_VIEW', 'PERMISSIONS.INFORMATION_SETTINGS_VIEW_DESC', FALSE, 'information', 400),
('information.settings.edit', 'information', 'PERMISSIONS.INFORMATION_SETTINGS_EDIT', 'PERMISSIONS.INFORMATION_SETTINGS_EDIT_DESC', FALSE, 'information', 401);

-- ============================================================================
-- AUTOMOD PLUGIN PERMISSIONS
-- ============================================================================
INSERT INTO permission_definitions (permission_key, category, name_translation_key, description_translation_key, is_dangerous, plugin_name, sort_order) VALUES
('automod.settings.view', 'automod', 'PERMISSIONS.AUTOMOD_SETTINGS_VIEW', 'PERMISSIONS.AUTOMOD_SETTINGS_VIEW_DESC', FALSE, 'automod', 500),
('automod.settings.edit', 'automod', 'PERMISSIONS.AUTOMOD_SETTINGS_EDIT', 'PERMISSIONS.AUTOMOD_SETTINGS_EDIT_DESC', TRUE, 'automod', 501);

-- ============================================================================
-- SUPERADMIN (nur für Guild-Owner)
-- ============================================================================
INSERT INTO permission_definitions (permission_key, category, name_translation_key, description_translation_key, is_dangerous, plugin_name, sort_order) VALUES
('superadmin.*', 'superadmin', 'PERMISSIONS.SUPERADMIN_ALL', 'PERMISSIONS.SUPERADMIN_ALL_DESC', TRUE, 'core', 1000);

-- ============================================================================
-- ENDE
-- ============================================================================
