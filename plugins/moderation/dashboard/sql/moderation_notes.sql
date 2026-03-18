-- Mod-Notes
-- Interne Notizen von Moderatoren zu Usern (nur für Staff sichtbar)

CREATE TABLE IF NOT EXISTS moderation_notes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) NOT NULL COMMENT 'Betroffener User',
    author_id VARCHAR(255) NOT NULL COMMENT 'Moderator der die Notiz erstellt hat',
    note TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_guild_user (guild_id, user_id),
    INDEX idx_guild_author (guild_id, author_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
