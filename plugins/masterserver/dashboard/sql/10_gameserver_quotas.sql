-- =====================================================
-- Masterserver Plugin - GameServer Quotas Table
-- =====================================================
-- Ressourcen-Allokationen pro Gameserver
-- Wird von verfügbaren Rootserver-Ressourcen abgezogen
-- Tracked auch aktuelle Nutzung (vom Daemon aktualisiert)
-- =====================================================

CREATE TABLE IF NOT EXISTS gameserver_quotas (
    -- Primary Key
    id INT AUTO_INCREMENT PRIMARY KEY,
    
    -- Gameserver Reference
    gameserver_id INT NOT NULL COMMENT 'Referenz zu gameservers.id',
    rootserver_id INT NOT NULL COMMENT 'Referenz zu rootserver.id',
    
    -- Allokierte Ressourcen (beim Erstellen festgelegt)
    allocated_ram_mb INT NOT NULL DEFAULT 2048 COMMENT 'Allokierter RAM in MB',
    allocated_cpu_cores INT NOT NULL DEFAULT 1 COMMENT 'Allokierte CPU Cores',
    allocated_disk_gb INT NOT NULL DEFAULT 10 COMMENT 'Allokierter Disk Space in GB',
    
    -- Aktuelle Nutzung (vom Daemon geschrieben)
    current_ram_usage_mb INT DEFAULT 0 COMMENT 'Aktuelle RAM-Nutzung in MB',
    current_cpu_usage_percent DECIMAL(5,2) DEFAULT 0.00 COMMENT 'Aktuelle CPU-Nutzung in %',
    current_disk_usage_gb DECIMAL(10,2) DEFAULT 0.00 COMMENT 'Aktuelle Disk-Nutzung in GB',
    
    -- Status Tracking
    last_usage_update TIMESTAMP NULL DEFAULT NULL COMMENT 'Letztes Nutzungs-Update vom Daemon',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Erstellungsdatum',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Letzte Änderung',
    
    -- Foreign Keys & Indexes
    UNIQUE KEY idx_gameserver (gameserver_id),
    INDEX idx_rootserver (rootserver_id),
    FOREIGN KEY (rootserver_id) REFERENCES rootserver(id) ON DELETE CASCADE,
    
    -- Constraints
    CHECK (allocated_ram_mb > 0),
    CHECK (allocated_cpu_cores > 0),
    CHECK (allocated_disk_gb > 0),
    CHECK (current_ram_usage_mb >= 0),
    CHECK (current_cpu_usage_percent >= 0 AND current_cpu_usage_percent <= 100),
    CHECK (current_disk_usage_gb >= 0)
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Ressourcen-Allokationen pro Gameserver';
