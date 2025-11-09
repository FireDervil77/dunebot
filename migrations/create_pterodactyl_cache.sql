-- Pterodactyl Egg Cache System
-- Erspart GitHub API Calls und speichert Egg-Metadaten

CREATE TABLE IF NOT EXISTS gameserver_pterodactyl_cache (
    id INT AUTO_INCREMENT PRIMARY KEY,
    
    -- Kategorisierung
    category VARCHAR(100) NOT NULL COMMENT 'z.B. games-steamcmd, minecraft, voice-servers',
    egg_name VARCHAR(255) NOT NULL COMMENT 'Eindeutiger Name, z.B. core_keeper oder valheim/valheim_vanilla',
    display_name VARCHAR(255) NOT NULL COMMENT 'Anzeigename für UI, z.B. Core Keeper',
    
    -- Download-Informationen
    download_url TEXT NOT NULL COMMENT 'Direkte URL zur egg-*.json Datei auf GitHub',
    
    -- Optional: Vollständiges Egg-JSON cachen
    json_data JSON DEFAULT NULL COMMENT 'Gecachtes Pterodactyl Egg JSON (optional, spart Download)',
    
    -- Metadaten
    source VARCHAR(50) DEFAULT 'pterodactyl' COMMENT 'Quelle: pterodactyl, custom, cubecoders, etc.',
    description TEXT DEFAULT NULL COMMENT 'Kurzbeschreibung des Eggs',
    author VARCHAR(255) DEFAULT NULL COMMENT 'Egg-Author',
    
    -- Verwaltung
    is_active BOOLEAN DEFAULT TRUE COMMENT 'Deaktivierte Eggs werden nicht angezeigt',
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Indizes für Performance
    INDEX idx_category (category),
    INDEX idx_active (is_active),
    INDEX idx_category_active (category, is_active),
    
    -- Eindeutigkeit
    UNIQUE KEY unique_egg (category, egg_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Cache für Pterodactyl Eggs (verhindert GitHub API Spam)';
