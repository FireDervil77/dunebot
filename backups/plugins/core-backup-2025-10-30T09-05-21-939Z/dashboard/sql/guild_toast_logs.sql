-- Guild Toast Logs Tabelle für zentrales Toast-Logging
-- Ersetzt Session-basiertes Toast-Logging durch persistente DB-Lösung
-- Integriert sich in das zentrale Guild-Control-System
-- 
-- @author firedervil
-- @created 2025-10-15

CREATE TABLE IF NOT EXISTS guild_toast_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    
    -- Toast-Identifikation
    type ENUM('error', 'warning', 'info', 'success') NOT NULL COMMENT 'Toast-Typ',
    message TEXT NOT NULL COMMENT 'Toast-Nachricht',
    
    -- User & Guild Context
    user_id VARCHAR(20) DEFAULT NULL COMMENT 'Discord User ID (NULL für anonyme Toasts)',
    username VARCHAR(100) DEFAULT 'Anonymous' COMMENT 'Discord Username (Snapshot)',
    guild_id VARCHAR(20) DEFAULT NULL COMMENT 'Discord Guild ID (NULL für globale Toasts)',
    
    -- Request Context
    url VARCHAR(500) DEFAULT NULL COMMENT 'Aktuelle URL beim Toast',
    user_agent TEXT DEFAULT NULL COMMENT 'Browser User-Agent',
    session_id VARCHAR(128) DEFAULT NULL COMMENT 'Session-ID für Debugging',
    
    -- Metadata & Debugging
    source VARCHAR(50) DEFAULT 'guild.js' COMMENT 'Toast-Quelle (guild.js, plugin-name, etc.)',
    metadata JSON DEFAULT NULL COMMENT 'Zusätzliche Debug-Informationen',
    
    -- Zeitstempel
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Toast-Zeitpunkt',
    
    -- Performance-Indizes für schnelle Abfragen
    INDEX idx_guild_user (guild_id, user_id),
    INDEX idx_type_created (type, created_at),
    INDEX idx_user_created (user_id, created_at),
    INDEX idx_guild_created (guild_id, created_at),
    INDEX idx_source (source),
    
    -- Composite Index für häufige Abfragen (Top-Nav Notification)
    INDEX idx_critical_recent (type, guild_id, user_id, created_at),
    
    -- Cleanup-Index für automatische Bereinigung
    INDEX idx_cleanup (created_at)
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci 
COMMENT='Zentrales Toast-Logging für Guild-Control und Debugging';

-- Automatische Cleanup-Regel (Optional, über Event Scheduler)
-- Löscht Toasts älter als 30 Tage automatisch
-- 
-- DELIMITER $$
-- CREATE EVENT IF NOT EXISTS cleanup_guild_toast_logs
-- ON SCHEDULE EVERY 1 DAY
-- DO
-- BEGIN
--     DELETE FROM guild_toast_logs 
--     WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
--     LIMIT 1000;
-- END$$
-- DELIMITER ;