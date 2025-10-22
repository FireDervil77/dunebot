-- Guild Staff Members Table
-- Erweitert Discord-Permissions mit Custom Dashboard-Zugriffen

CREATE TABLE IF NOT EXISTS `guild_staff` (
    `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `guild_id` VARCHAR(20) NOT NULL COMMENT 'Discord Guild ID',
    `user_id` VARCHAR(20) NOT NULL COMMENT 'Discord User ID',
    `role` ENUM('admin', 'manager', 'moderator', 'viewer') NOT NULL DEFAULT 'viewer' COMMENT 'Dashboard-Rolle',
    `can_manage_settings` BOOLEAN DEFAULT FALSE COMMENT 'Darf Guild-Einstellungen ändern',
    `can_manage_plugins` BOOLEAN DEFAULT FALSE COMMENT 'Darf Plugins aktivieren/deaktivieren',
    `can_view_logs` BOOLEAN DEFAULT TRUE COMMENT 'Darf Logs einsehen',
    `granted_by` VARCHAR(20) NOT NULL COMMENT 'User ID der die Permission erteilt hat',
    `granted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Zeitpunkt der Erteilung',
    `expires_at` DATETIME NULL COMMENT 'Optional: Ablaufdatum der Permission',
    `notes` TEXT NULL COMMENT 'Optional: Notizen zur Permission',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY `guild_user` (`guild_id`, `user_id`),
    INDEX `idx_guild_id` (`guild_id`),
    INDEX `idx_user_id` (`user_id`),
    INDEX `idx_role` (`role`),
    INDEX `idx_expires_at` (`expires_at`),
    
    FOREIGN KEY (`guild_id`) REFERENCES `guilds`(`_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci 
COMMENT='Custom Dashboard-Permissions für Guild-Mitglieder (zusätzlich zu Discord-Roles)';

-- Beispiel-Daten INSERT:
-- INSERT INTO guild_staff (guild_id, user_id, role, can_manage_settings, can_manage_plugins, granted_by)
-- VALUES ('1234567890', '881195631698391050', 'admin', TRUE, TRUE, '544578232704565262');
