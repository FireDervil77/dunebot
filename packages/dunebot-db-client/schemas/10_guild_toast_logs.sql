-- ============================================================================
-- Guild Toast Logs - Zentrales Toast-Logging für Guild-Control
-- ============================================================================
CREATE TABLE IF NOT EXISTS guild_toast_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,

    type ENUM('error', 'warning', 'info', 'success') NOT NULL,
    message TEXT NOT NULL,

    user_id VARCHAR(20) DEFAULT NULL,
    username VARCHAR(100) DEFAULT 'Anonymous',
    guild_id VARCHAR(20) DEFAULT NULL,

    url VARCHAR(500) DEFAULT NULL,
    user_agent TEXT DEFAULT NULL,
    session_id VARCHAR(128) DEFAULT NULL,

    source VARCHAR(50) DEFAULT 'guild.js',
    metadata JSON DEFAULT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_guild_user (guild_id, user_id),
    INDEX idx_type_created (type, created_at),
    INDEX idx_user_created (user_id, created_at),
    INDEX idx_guild_created (guild_id, created_at),
    INDEX idx_source (source),
    INDEX idx_critical_recent (type, guild_id, user_id, created_at),
    INDEX idx_cleanup (created_at)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Zentrales Toast-Logging für Guild-Control und Debugging'
