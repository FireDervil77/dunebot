-- =============================================
-- Gameservers Tabelle
-- Speichert alle erstellten Gameserver-Instanzen
-- =============================================

CREATE TABLE IF NOT EXISTS gameservers (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    
    -- Ownership
    guild_id VARCHAR(20) NOT NULL COMMENT 'Discord Guild-ID',
    user_id VARCHAR(20) NOT NULL COMMENT 'Discord User-ID des Erstellers',
    
    -- Addon-Referenz
    addon_marketplace_id INT UNSIGNED NOT NULL COMMENT 'FK zu addon_marketplace',
    template_name VARCHAR(50) NULL COMMENT 'Welches Template wurde gewählt? (z.B. "competitive")',
    
    -- Server-Info
    name VARCHAR(100) NOT NULL COMMENT 'Server-Name (User-definiert)',
    
    -- Installation (Referenz zu Masterserver)
    daemon_server_id VARCHAR(36) NOT NULL COMMENT 'FK zu masterserver.daemon_servers.server_id',
    install_path VARCHAR(255) NULL COMMENT 'Pfad auf dem Server (z.B. /gameservers/cs2-server-001)',
    install_progress INT DEFAULT 0 COMMENT 'Installations-Fortschritt 0-100%',
    
    -- Status
    status ENUM('installing', 'installed', 'starting', 'online', 'stopping', 'offline', 'error', 'updating') DEFAULT 'installing',
    last_status_update DATETIME NULL COMMENT 'Wann wurde der Status zuletzt geändert?',
    error_message TEXT NULL COMMENT 'Fehlermeldung bei status=error',
    
    -- Versionierung & Updates
    addon_version VARCHAR(20) NOT NULL COMMENT 'Addon-Version bei Erstellung',
    update_available BOOLEAN DEFAULT FALSE COMMENT 'Ist ein Update verfügbar?',
    latest_version VARCHAR(20) NULL COMMENT 'Neueste verfügbare Version',
    
    -- Frozen Config (Snapshot bei Erstellung)
    frozen_game_data JSON NOT NULL COMMENT 'Snapshot der game_data bei Erstellung (für Reproduzierbarkeit)',
    
    -- Runtime-Konfiguration
    env_variables JSON NOT NULL COMMENT 'Environment-Variables (aus game_data.variables + User-Input)',
    ports JSON NOT NULL COMMENT 'Zugewiesene Ports: {"game": 27015, "query": 27016, "rcon": 27017}',
    launch_params TEXT NULL COMMENT 'Start-Command mit aufgelösten Variablen',
    
    -- Runtime-Info
    pid INT NULL COMMENT 'Process-ID (wenn online)',
    current_players INT DEFAULT 0 COMMENT 'Aktuelle Spieler-Anzahl',
    max_players INT COMMENT 'Maximale Spieler-Anzahl',
    current_map VARCHAR(100) NULL COMMENT 'Aktuelle Map',
    
    -- Statistiken
    total_uptime_seconds BIGINT DEFAULT 0 COMMENT 'Gesamte Uptime in Sekunden',
    total_players_connected BIGINT DEFAULT 0 COMMENT 'Gesamtanzahl Spieler, die jemals connected haben',
    last_started_at DATETIME NULL COMMENT 'Wann wurde der Server zuletzt gestartet?',
    last_stopped_at DATETIME NULL COMMENT 'Wann wurde der Server zuletzt gestoppt?',
    
    -- Backup & Maintenance
    auto_restart BOOLEAN DEFAULT TRUE COMMENT 'Auto-Restart bei Crash?',
    auto_update BOOLEAN DEFAULT FALSE COMMENT 'Auto-Update wenn neue Version verfügbar?',
    last_backup_at DATETIME NULL COMMENT 'Wann wurde das letzte Backup erstellt?',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Indizes
    INDEX idx_guild (guild_id),
    INDEX idx_user (user_id),
    INDEX idx_addon (addon_marketplace_id),
    INDEX idx_status (status),
    INDEX idx_daemon_server (daemon_server_id),
    INDEX idx_update_available (update_available),
    
    -- Foreign Keys
    FOREIGN KEY (guild_id) REFERENCES guilds(_id) ON DELETE CASCADE,
    FOREIGN KEY (addon_marketplace_id) REFERENCES addon_marketplace(id) ON DELETE RESTRICT,
    FOREIGN KEY (daemon_server_id) REFERENCES daemon_servers(server_id) ON DELETE RESTRICT
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Erstellte Gameserver-Instanzen';
