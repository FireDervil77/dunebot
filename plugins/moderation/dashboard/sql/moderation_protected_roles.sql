-- Geschützte Rollen
-- Rollen die NICHT von Moderationsaktionen betroffen sein können (Staff-Schutz)

CREATE TABLE IF NOT EXISTS moderation_protected_roles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(255) NOT NULL,
    role_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_guild_role (guild_id, role_id),
    INDEX idx_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
