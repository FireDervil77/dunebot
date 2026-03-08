-- ============================================================================
-- Guild Groups - Benutzergruppen pro Guild
-- Teil des zentralen Permissions-Systems
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

    -- Metadata (member_count wird via Trigger aktualisiert)
    member_count INT DEFAULT 0,
    priority INT DEFAULT 0,                          -- Sortierung (höher = wichtiger)

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY unique_guild_slug (guild_id, slug),
    INDEX idx_guild (guild_id),
    INDEX idx_is_default (is_default),
    INDEX idx_priority (priority),

    FOREIGN KEY (guild_id) REFERENCES guilds(_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
