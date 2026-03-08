-- ============================================================================
-- Guild Users - Dashboard-Zugriffe pro Guild
-- Teil des zentralen Permissions-Systems
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
