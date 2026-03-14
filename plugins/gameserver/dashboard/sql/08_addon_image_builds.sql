-- =============================================
-- Addon Image Builds Tabelle
-- Speichert Image-Builder-Sessions (für Non-Steam-Games)
-- Nur für Superadmins (Phase 3)
-- =============================================

CREATE TABLE IF NOT EXISTS addon_image_builds (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    
    -- Session-Info
    session_id VARCHAR(36) UNIQUE NOT NULL COMMENT 'UUID für Session-Tracking',
    admin_user_id VARCHAR(20) NOT NULL COMMENT 'Discord User-ID des Superadmins',
    
    -- Build-Status
    status ENUM('preparing', 'building', 'testing', 'snapshotting', 'completed', 'failed') DEFAULT 'preparing',
    
    -- Container-Info
    container_id VARCHAR(64) NULL COMMENT 'Container-ID (falls genutzt)',
    vnc_port INT NULL COMMENT 'VNC-Port für Remote-Zugriff',
    ssh_port INT NULL COMMENT 'SSH-Port für Terminal-Zugriff',
    web_terminal_url VARCHAR(255) NULL COMMENT 'URL zum Web-Terminal',
    
    -- Auto-Detection-Ergebnisse
    detected_config JSON NULL COMMENT 'Auto-detected: Ports, Binaries, Config-Files',
    
    -- Ergebnis
    image_url VARCHAR(255) NULL COMMENT 'URL zum fertigen Image',
    image_hash VARCHAR(64) NULL COMMENT 'SHA256-Hash des Images',
    game_data JSON NULL COMMENT 'Generierte game_data.json',
    
    -- Metadata
    notes TEXT COMMENT 'Admin-Notizen zum Build',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL COMMENT 'Wann wurde der Build abgeschlossen?',
    
    -- Indizes
    INDEX idx_admin (admin_user_id),
    INDEX idx_status (status),
    INDEX idx_session (session_id)
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Image-Builder-Sessions für Custom-Game-Images';
