-- =====================================================
-- Masterserver Plugin - Server Registry
-- =====================================================
-- Central registry for all managed servers (gameservers, voice servers, etc.)
-- Each server is controlled by a daemon and belongs to a guild
-- Sub-plugins (gameserver, voiceserver) can extend this with specific configs
-- =====================================================

CREATE TABLE IF NOT EXISTS server_registry (
    -- Primary Key
    id INT AUTO_INCREMENT PRIMARY KEY,
    
    -- Unique Identifiers
    server_id VARCHAR(36) UNIQUE NOT NULL COMMENT 'UUID for this server instance',
    guild_id VARCHAR(30) NOT NULL COMMENT 'Discord Guild ID owning this server',
    daemon_id VARCHAR(36) NOT NULL COMMENT 'Daemon UUID managing this server',
    
    -- Server Info
    server_name VARCHAR(100) NOT NULL COMMENT 'Display name for the server',
    server_type VARCHAR(50) NOT NULL COMMENT 'Server type (minecraft, teamspeak, generic, etc.)',
    plugin_name VARCHAR(100) DEFAULT NULL COMMENT 'Responsible sub-plugin (e.g. "gameserver")',
    
    -- Status
    status ENUM('online', 'offline', 'starting', 'stopping', 'error') DEFAULT 'offline' COMMENT 'Current server status',
    
    -- Configuration (flexible for sub-plugins)
    config JSON DEFAULT NULL COMMENT 'Server-specific configuration (plugin-dependent)',
    
    -- Control Commands
    start_command TEXT DEFAULT NULL COMMENT 'Command to start the server (e.g. "sudo systemctl start minecraft")',
    stop_command TEXT DEFAULT NULL COMMENT 'Command to stop the server',
    restart_command TEXT DEFAULT NULL COMMENT 'Command to restart the server',
    status_command TEXT DEFAULT NULL COMMENT 'Command to check server status',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Server registration timestamp',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Last update timestamp',
    last_start TIMESTAMP NULL DEFAULT NULL COMMENT 'Last successful start timestamp',
    last_stop TIMESTAMP NULL DEFAULT NULL COMMENT 'Last successful stop timestamp',
    
    -- Indexes
    INDEX idx_guild (guild_id),
    INDEX idx_daemon (daemon_id),
    INDEX idx_server_type (server_type),
    INDEX idx_status (status),
    INDEX idx_plugin (plugin_name),
    
    -- Foreign Key Constraints (Server löschen wenn RootServer gelöscht wird)
    FOREIGN KEY (daemon_id) REFERENCES rootserver(daemon_id) ON DELETE CASCADE
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Central registry for all managed servers';
