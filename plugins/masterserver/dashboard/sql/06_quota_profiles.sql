-- =====================================================
-- Masterserver Plugin - Quota Profiles Table
-- =====================================================
-- Vordefinierte Quota-Profile (Templates) für Rootserver
-- Z.B. "Small", "Medium", "Large", "Enterprise"
-- Vereinfacht die Rootserver-Konfiguration
-- =====================================================

CREATE TABLE IF NOT EXISTS quota_profiles (
    -- Primary Key
    id INT AUTO_INCREMENT PRIMARY KEY,
    
    -- Profile Info
    name VARCHAR(50) NOT NULL COMMENT 'Interner Name (z.B. "small", "medium")',
    display_name VARCHAR(100) NOT NULL COMMENT 'Anzeigename (z.B. "Klein (8GB RAM, 2 CPU)")',
    description TEXT DEFAULT NULL COMMENT 'Beschreibung des Profils',
    
    -- Ressourcen-Limits
    ram_mb INT NOT NULL COMMENT 'RAM in MB',
    cpu_cores INT NOT NULL COMMENT 'CPU Cores',
    disk_gb INT NOT NULL COMMENT 'Disk Space in GB',
    
    -- Gameserver Limits
    max_gameservers INT DEFAULT NULL COMMENT 'Max. Anzahl Gameserver (NULL = unbegrenzt)',
    
    -- Status Flags
    is_default BOOLEAN DEFAULT FALSE COMMENT 'Ist dies das Standard-Profil?',
    is_active BOOLEAN DEFAULT TRUE COMMENT 'Ist das Profil aktiv/nutzbar?',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Erstellungsdatum',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Letzte Änderung',
    
    -- Constraints
    UNIQUE KEY idx_name (name),
    CHECK (ram_mb > 0),
    CHECK (cpu_cores > 0),
    CHECK (disk_gb > 0)
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Quota-Profile für Rootserver';
