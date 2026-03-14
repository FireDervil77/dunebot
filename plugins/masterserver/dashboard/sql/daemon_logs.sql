-- =====================================================
-- Masterserver Plugin - Daemon Audit Logs
-- =====================================================
-- Comprehensive audit trail for daemon events
-- Tracks registration, disconnects, commands, errors, etc.
-- Used for debugging, security audits, and compliance
-- =====================================================

CREATE TABLE IF NOT EXISTS daemon_logs (
    -- Primary Key
    id INT AUTO_INCREMENT PRIMARY KEY,
    
    -- Context
    guild_id VARCHAR(20) NOT NULL COMMENT 'Discord Guild ID',
    daemon_id VARCHAR(36) DEFAULT NULL COMMENT 'Daemon UUID (NULL for guild-level events)',
    server_id VARCHAR(36) DEFAULT NULL COMMENT 'Server UUID (NULL for daemon-level events)',
    
    -- Event Classification
    event_type ENUM('register', 'disconnect', 'command', 'error', 'status_change', 'heartbeat_lost', 'reconnect') NOT NULL COMMENT 'Type of event',
    level ENUM('debug', 'info', 'warn', 'error') DEFAULT 'info' COMMENT 'Log severity level',
    action VARCHAR(50) DEFAULT NULL COMMENT 'Specific action (e.g. "start", "stop", "restart")',
    
    -- User Context (who triggered this?)
    user_id VARCHAR(20) DEFAULT NULL COMMENT 'Discord User ID who triggered the action (NULL for system events)',
    
    -- Event Details
    message TEXT DEFAULT NULL COMMENT 'Human-readable log message',
    metadata JSON DEFAULT NULL COMMENT 'Additional structured data (error details, command payload, etc.)',
    
    -- Timestamp
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Event timestamp',
    
    -- Indexes
    INDEX idx_guild (guild_id),
    INDEX idx_daemon (daemon_id),
    INDEX idx_server (server_id),
    INDEX idx_event_type (event_type),
    INDEX idx_level (level),
    INDEX idx_created (created_at),
    INDEX idx_user (user_id)
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Audit trail for all daemon-related events';
