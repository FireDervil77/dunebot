-- Gameserver Crash Logs
-- Speichert detaillierte Crash-Informationen für Gameserver

CREATE TABLE IF NOT EXISTS gameserver_crash_logs (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    server_id INT UNSIGNED NOT NULL,
    daemon_id VARCHAR(100) NOT NULL,
    error_message TEXT NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_server_id (server_id),
    INDEX idx_daemon_id (daemon_id),
    INDEX idx_timestamp (timestamp),
    
    FOREIGN KEY (server_id) REFERENCES gameservers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
