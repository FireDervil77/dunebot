-- =====================================================
-- Tabelle: dunemap_storm_timer
-- Coriolis Storm Timer pro Guild
-- =====================================================

CREATE TABLE IF NOT EXISTS dunemap_storm_timer (
    guild_id VARCHAR(20) NOT NULL PRIMARY KEY COMMENT 'Discord Guild ID',
    start_time BIGINT NOT NULL COMMENT 'Storm Start-Zeit (Unix Timestamp)',
    duration BIGINT NOT NULL COMMENT 'Storm Dauer in Sekunden',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Erstellungszeitpunkt',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Letztes Update',
    created_by VARCHAR(20) NOT NULL COMMENT 'Discord User ID des Erstellers',
    
    INDEX idx_guild_time (guild_id, start_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Coriolis Storm Timer';
