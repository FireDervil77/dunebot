-- ============================================================================
-- PERMISSIONS SYSTEM - Database Schema
-- ============================================================================
-- Erstellt: 30. Oktober 2025
-- Autor: FireDervil + GitHub Copilot
-- Beschreibung: Granulares Berechtigungssystem für Guild-basiertes Dashboard
-- ============================================================================

-- ============================================================================
-- 1. guild_users - Dashboard-Zugriffe pro Guild
-- ============================================================================
CREATE TABLE IF NOT EXISTS guild_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL,
    user_id VARCHAR(20) NOT NULL,                    -- Discord User ID
    invited_by VARCHAR(20) NOT NULL,                 -- Wer hat eingeladen?
    invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status ENUM('pending', 'active', 'suspended') DEFAULT 'active',
    is_owner BOOLEAN DEFAULT FALSE,                  -- Guild-Owner (unantastbar)
    
    -- Direkte Berechtigungen (optional, überschreibt Gruppen)
    direct_permissions JSON DEFAULT NULL,            -- { "gameserver.start": true, ... }
    
    -- Metadata
    last_login_at TIMESTAMP NULL,
    login_count INT DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_guild_user (guild_id, user_id),
    INDEX idx_guild (guild_id),
    INDEX idx_user (user_id),
    INDEX idx_status (status),
    
    FOREIGN KEY (guild_id) REFERENCES guilds(_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 2. guild_groups - Benutzergruppen pro Guild
-- ============================================================================
CREATE TABLE IF NOT EXISTS guild_groups (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,                      -- "Moderatoren", "Support", etc.
    slug VARCHAR(100) NOT NULL,                      -- "moderators", "support"
    description TEXT,
    color VARCHAR(7) DEFAULT '#6c757d',              -- Badge-Farbe (Hex)
    icon VARCHAR(50) DEFAULT 'fa-users',             -- FontAwesome Icon
    
    is_default BOOLEAN DEFAULT FALSE,                -- Standard-Gruppe für neue User?
    is_protected BOOLEAN DEFAULT FALSE,              -- Admin-Gruppe (nicht löschbar)
    
    permissions JSON NOT NULL,                       -- { "gameserver.start": true, ... }
    
    -- Metadata
    member_count INT DEFAULT 0,                      -- Cached count (updated via trigger)
    priority INT DEFAULT 0,                          -- Sortierung (höher = wichtiger)
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_guild_slug (guild_id, slug),
    INDEX idx_guild (guild_id),
    INDEX idx_is_default (is_default),
    INDEX idx_priority (priority),
    
    FOREIGN KEY (guild_id) REFERENCES guilds(_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 3. guild_user_groups - User ↔ Gruppen Zuordnung (Many-to-Many)
-- ============================================================================
CREATE TABLE IF NOT EXISTS guild_user_groups (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guild_user_id INT NOT NULL,                      -- Referenz zu guild_users.id
    group_id INT NOT NULL,                           -- Referenz zu guild_groups.id
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    assigned_by VARCHAR(20) NOT NULL,                -- Discord User ID (wer hat zugewiesen?)
    
    UNIQUE KEY unique_user_group (guild_user_id, group_id),
    INDEX idx_guild_user (guild_user_id),
    INDEX idx_group (group_id),
    
    FOREIGN KEY (guild_user_id) REFERENCES guild_users(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES guild_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 4. permission_definitions - Alle verfügbaren Permissions (System-Tabelle)
-- ============================================================================
CREATE TABLE IF NOT EXISTS permission_definitions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    permission_key VARCHAR(100) NOT NULL UNIQUE,     -- "gameserver.start"
    category VARCHAR(50) NOT NULL,                   -- "gameserver", "moderation", etc.
    
    -- Translations (i18n Keys)
    name_translation_key VARCHAR(100) NOT NULL,      -- "PERMISSIONS.GAMESERVER_START"
    description_translation_key VARCHAR(100),
    
    -- Metadata
    is_dangerous BOOLEAN DEFAULT FALSE,              -- Kritische Berechtigung? (Warnung in UI)
    requires_permissions JSON DEFAULT NULL,          -- Abhängigkeiten: ["gameserver.view"]
    plugin_name VARCHAR(50),                         -- Zu welchem Plugin gehört die Permission?
    
    sort_order INT DEFAULT 0,                        -- Sortierung in UI
    is_active BOOLEAN DEFAULT TRUE,                  -- Kann temporär deaktiviert werden
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_category (category),
    INDEX idx_plugin (plugin_name),
    INDEX idx_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- TRIGGERS: Update member_count in guild_groups
-- ============================================================================
DELIMITER $$

-- Trigger: Increment member_count when user is added to group
CREATE TRIGGER IF NOT EXISTS trg_group_member_added
AFTER INSERT ON guild_user_groups
FOR EACH ROW
BEGIN
    UPDATE guild_groups 
    SET member_count = member_count + 1 
    WHERE id = NEW.group_id;
END$$

-- Trigger: Decrement member_count when user is removed from group
CREATE TRIGGER IF NOT EXISTS trg_group_member_removed
AFTER DELETE ON guild_user_groups
FOR EACH ROW
BEGIN
    UPDATE guild_groups 
    SET member_count = member_count - 1 
    WHERE id = OLD.group_id;
END$$

DELIMITER ;

-- ============================================================================
-- VIEWS: Convenience Views für häufige Queries
-- ============================================================================

-- View: User mit ihren Gruppen und aggregierten Permissions
CREATE OR REPLACE VIEW v_guild_user_permissions AS
SELECT 
    gu.id AS guild_user_id,
    gu.guild_id,
    gu.user_id,
    gu.is_owner,
    gu.status,
    gu.direct_permissions,
    gu.last_login_at,
    GROUP_CONCAT(gg.id) AS group_ids,
    GROUP_CONCAT(gg.name SEPARATOR ', ') AS group_names,
    GROUP_CONCAT(gg.slug SEPARATOR ', ') AS group_slugs
FROM guild_users gu
LEFT JOIN guild_user_groups gug ON gu.id = gug.guild_user_id
LEFT JOIN guild_groups gg ON gug.group_id = gg.id
GROUP BY gu.id, gu.guild_id, gu.user_id, gu.is_owner, gu.status, gu.direct_permissions, gu.last_login_at;

-- View: Gruppen mit Member-Anzahl
CREATE OR REPLACE VIEW v_guild_groups_summary AS
SELECT 
    gg.id,
    gg.guild_id,
    gg.name,
    gg.slug,
    gg.description,
    gg.color,
    gg.icon,
    gg.is_default,
    gg.is_protected,
    gg.priority,
    gg.permissions,
    gg.member_count,
    COUNT(gug.id) AS actual_member_count
FROM guild_groups gg
LEFT JOIN guild_user_groups gug ON gg.id = gug.group_id
GROUP BY gg.id, gg.guild_id, gg.name, gg.slug, gg.description, gg.color, gg.icon, gg.is_default, gg.is_protected, gg.priority, gg.permissions, gg.member_count;

-- ============================================================================
-- ENDE
-- ============================================================================
