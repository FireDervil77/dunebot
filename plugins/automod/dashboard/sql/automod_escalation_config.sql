-- AutoMod Escalation Config
-- Konfigurierbare Eskalations-Stufen: z.B. 3 Strikes → TIMEOUT, 5 → KICK, 10 → BAN

CREATE TABLE IF NOT EXISTS automod_escalation_config (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL,
    threshold INT UNSIGNED NOT NULL COMMENT 'Anzahl Strikes ab der diese Stufe greift',
    action ENUM('TIMEOUT', 'KICK', 'BAN') NOT NULL COMMENT 'Aktion bei Erreichen des Thresholds',
    duration INT UNSIGNED DEFAULT NULL COMMENT 'Dauer in Sekunden (nur für TIMEOUT)',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_guild_threshold (guild_id, threshold),
    INDEX idx_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AutoMod Eskalations-Stufen pro Guild';
