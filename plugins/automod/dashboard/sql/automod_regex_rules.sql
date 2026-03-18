-- AutoMod Regex Rules
-- Custom Regex-Pattern als Filter (mit Validierung und ReDoS-Schutz)

CREATE TABLE IF NOT EXISTS automod_regex_rules (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL COMMENT 'Beschreibender Name der Regel',
    pattern TEXT NOT NULL COMMENT 'Regex-Pattern (validiert vor Speicherung)',
    action ENUM('DELETE', 'WARN', 'STRIKE') DEFAULT 'STRIKE' COMMENT 'Aktion bei Match',
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_guild (guild_id),
    INDEX idx_guild_enabled (guild_id, enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Benutzerdefinierte Regex-Filter pro Guild';
