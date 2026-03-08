-- ============================================================================
-- Guild User Groups - User <=> Gruppen Zuordnung (Many-to-Many)
-- Teil des zentralen Permissions-Systems
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
