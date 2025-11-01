-- Blocked IPs Table für Exploit-Blocker
-- Speichert permanent geblockte IPs persistent in der Datenbank

CREATE TABLE IF NOT EXISTS `blocked_ips` (
    `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `ip` VARCHAR(45) NOT NULL UNIQUE COMMENT 'IP-Adresse (IPv4 oder IPv6)',
    `first_attempt` DATETIME NOT NULL COMMENT 'Erster Exploit-Versuch',
    `blocked_at` DATETIME NOT NULL COMMENT 'Zeitpunkt des permanenten Blocks',
    `attempt_count` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Anzahl der Exploit-Versuche',
    `last_attempt` DATETIME NULL COMMENT 'Letzter Exploit-Versuch (auch nach Block)',
    `last_path` VARCHAR(500) NULL COMMENT 'Letzter angefragter Pfad',
    `reason` VARCHAR(100) NOT NULL DEFAULT 'Exploit attempts' COMMENT 'Block-Grund',
    `is_whitelisted` BOOLEAN DEFAULT FALSE COMMENT 'Whitelist-Override (für False Positives)',
    `notes` TEXT NULL COMMENT 'Admin-Notizen',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX `idx_ip` (`ip`),
    INDEX `idx_blocked_at` (`blocked_at`),
    INDEX `idx_is_whitelisted` (`is_whitelisted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Permanent geblockte IPs durch Exploit-Blocker';
