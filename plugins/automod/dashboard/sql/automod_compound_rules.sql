CREATE TABLE IF NOT EXISTS automod_compound_rules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(255) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(500) DEFAULT NULL,
    conditions JSON NOT NULL COMMENT 'Array: [{type, operator, value}]',
    logic ENUM('AND', 'OR') NOT NULL DEFAULT 'AND',
    action ENUM('DELETE', 'WARN', 'STRIKE', 'TIMEOUT', 'KICK', 'BAN') NOT NULL DEFAULT 'STRIKE',
    duration INT DEFAULT NULL COMMENT 'Timeout-Dauer in Minuten (nur bei TIMEOUT)',
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_guild_enabled (guild_id, enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
