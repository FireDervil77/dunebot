-- AutoMod Logs Tabelle
-- Speichert ALLE Violations für Audit-Trail (auch unter Strike-Threshold)
CREATE TABLE IF NOT EXISTS automod_logs (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL COMMENT 'Discord Guild ID',
    member_id VARCHAR(20) NOT NULL COMMENT 'Discord Member ID',
    message_content TEXT NOT NULL COMMENT 'Nachrichteninhalt (kann Emojis/Unicode enthalten)',
    violation_reasons TEXT NOT NULL COMMENT 'Comma-separated Violations (z.B. "SPAM,LINKS,MAX_LINES")',
    strikes_given TINYINT UNSIGNED DEFAULT 1 COMMENT 'Anzahl Strikes für diese Violation',
    logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Zeitstempel der Violation',
    
    INDEX idx_guild (guild_id) COMMENT 'Queries nach Guild',
    INDEX idx_member (member_id) COMMENT 'Member-spezifische History',
    INDEX idx_logged_at (logged_at) COMMENT 'Zeitbasierte Queries',
    INDEX idx_guild_member_time (guild_id, member_id, logged_at) COMMENT 'Composite für Member-History pro Guild'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Vollständige Violation-History für Audit-Trail';
