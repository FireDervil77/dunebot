-- ============================================================================
-- Permission Definitions - Alle verfügbaren Permissions (System-Tabelle)
-- Plugins registrieren ihre Permissions hier beim Enable
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
