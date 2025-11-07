-- Moderation Logs Table
-- Speichert alle Moderation-Aktionen für Audit-Zwecke

CREATE TABLE IF NOT EXISTS moderation_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(255) NOT NULL,
    member_id VARCHAR(255) NOT NULL COMMENT 'Betroffener User',
    admin_id VARCHAR(255) NOT NULL COMMENT 'Moderator der die Aktion ausgeführt hat',
    admin_tag VARCHAR(255) NOT NULL COMMENT 'Moderator Username#Discriminator',
    type ENUM(
        'PURGE',
        'WARN',
        'TIMEOUT',
        'UNTIMEOUT',
        'KICK',
        'SOFTBAN',
        'BAN',
        'UNBAN',
        'VMUTE',
        'VUNMUTE',
        'DEAFEN',
        'UNDEAFEN',
        'DISCONNECT',
        'MOVE'
    ) NOT NULL,
    reason TEXT DEFAULT NULL,
    deleted TINYINT(1) DEFAULT 0 COMMENT 'Soft-Delete Flag',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_guild_member (guild_id, member_id),
    INDEX idx_guild_type (guild_id, type),
    INDEX idx_deleted (deleted),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
