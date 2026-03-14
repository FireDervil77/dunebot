-- =====================================================
-- Masterserver Plugin - RootServer Quotas Table
-- =====================================================
-- Quota-Konfiguration pro Rootserver
-- Kann entweder ein Profil nutzen oder Custom-Werte haben
-- Berechnet verfügbare Ressourcen automatisch
-- =====================================================

CREATE TABLE IF NOT EXISTS rootserver_quotas (
    -- Primary Key
    id INT AUTO_INCREMENT PRIMARY KEY,
    
    -- Rootserver Reference
    rootserver_id INT NOT NULL COMMENT 'Referenz zu rootserver.id',
    
    -- Profile (optional - NULL = Custom Quota)
    profile_id INT NULL COMMENT 'Referenz zu quota_profiles.id (NULL = Custom)',
    
    -- Custom Quota Values (überschreiben Profil wenn gesetzt)
    custom_ram_mb INT NULL COMMENT 'Custom RAM-Limit (überschreibt Profil)',
    custom_cpu_cores INT NULL COMMENT 'Custom CPU-Limit (überschreibt Profil)',
    custom_disk_gb INT NULL COMMENT 'Custom Disk-Limit (überschreibt Profil)',
    custom_max_gameservers INT NULL COMMENT 'Custom Gameserver-Limit (überschreibt Profil)',
    
    -- Reservierte Ressourcen (für OS/Daemon)
    reserved_ram_mb INT NOT NULL DEFAULT 2048 COMMENT 'Reservierter RAM für System (MB)',
    reserved_cpu_cores INT NOT NULL DEFAULT 1 COMMENT 'Reservierte CPU Cores für System',
    reserved_disk_gb INT NOT NULL DEFAULT 50 COMMENT 'Reservierter Disk Space für System (GB)',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Erstellungsdatum',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Letzte Änderung',
    
    -- Foreign Keys
    UNIQUE KEY idx_rootserver (rootserver_id),
    FOREIGN KEY (rootserver_id) REFERENCES rootserver(id) ON DELETE CASCADE,
    FOREIGN KEY (profile_id) REFERENCES quota_profiles(id) ON DELETE SET NULL,
    
    -- Constraints
    CHECK (reserved_ram_mb >= 0),
    CHECK (reserved_cpu_cores >= 0),
    CHECK (reserved_disk_gb >= 0)
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Quota-Konfiguration pro Rootserver';
