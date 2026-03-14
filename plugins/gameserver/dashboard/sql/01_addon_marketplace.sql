-- =============================================
-- Addon Marketplace Tabelle
-- Speichert alle verfügbaren Game-Addons (wie Pterodactyl Eggs)
-- =============================================

CREATE TABLE IF NOT EXISTS addon_marketplace (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    
    -- Addon-Identifikation
    name VARCHAR(100) NOT NULL COMMENT 'Anzeige-Name des Addons (z.B. "Counter-Strike 2")',
    slug VARCHAR(50) NOT NULL UNIQUE COMMENT 'URL-freundlicher Identifier (z.B. "cs2")',
    description TEXT COMMENT 'Beschreibung des Addons',
    
    -- Autor
    author_user_id VARCHAR(20) NOT NULL COMMENT 'Discord User-ID des Erstellers',
    
    -- Visibility & Trust
    visibility ENUM('official', 'public', 'unlisted', 'private') DEFAULT 'public' COMMENT 'Sichtbarkeit des Addons',
    status ENUM('draft', 'pending_review', 'approved', 'rejected') DEFAULT 'draft' COMMENT 'Approval-Status',
    trust_level ENUM('unverified', 'verified', 'trusted', 'official') DEFAULT 'unverified' COMMENT 'Trust-Level des Autors',
    
    -- Game-Daten (komplette Egg-Struktur als JSON)
    game_data JSON NOT NULL COMMENT 'Komplette game_data.json (variables, startup, config, installation)',
    
    -- Metadaten
    category ENUM('fps', 'survival', 'sandbox', 'mmorpg', 'racing', 'strategy', 'horror', 'scifi', 'other') DEFAULT 'other',
    tags JSON COMMENT 'Tags: ["steam", "workshop", "mods", "pvp"]',
    version VARCHAR(20) DEFAULT '1.0.0' COMMENT 'Addon-Version (SemVer)',
    
    -- Steam-Integration
    steam_app_id INT NULL COMMENT 'Steam App-ID (falls Steam-Game)',
    steam_server_app_id INT NULL COMMENT 'Steam Dedicated Server App-ID',
    
    -- Custom-Image-Support (für Non-Steam-Games)
    image_url VARCHAR(255) NULL COMMENT 'Docker-Image oder Snapshot-URL',
    image_hash VARCHAR(64) NULL COMMENT 'SHA256-Hash für Integrität',
    
    -- Statistiken
    install_count INT DEFAULT 0 COMMENT 'Anzahl der Installationen',
    rating_avg DECIMAL(3,2) DEFAULT 0.00 COMMENT 'Durchschnitts-Rating (0.00-5.00)',
    rating_count INT DEFAULT 0 COMMENT 'Anzahl der Bewertungen',
    
    -- Assets
    icon_url VARCHAR(255) COMMENT 'URL zum Addon-Icon',
    banner_url VARCHAR(255) COMMENT 'URL zum Banner-Bild',
    screenshots JSON COMMENT 'Array von Screenshot-URLs',
    
    -- Changelog
    changelog TEXT COMMENT 'Changelog für aktuelle Version',
    
    -- Guild-spezifisch (für private Addons)
    guild_id VARCHAR(20) NULL COMMENT 'Wenn private: nur diese Guild kann sehen',
    
    -- Fork-System
    is_fork BOOLEAN DEFAULT FALSE COMMENT 'Ist dieses Addon ein Fork?',
    forked_from INT UNSIGNED NULL COMMENT 'Original Addon-ID (falls Fork)',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    published_at TIMESTAMP NULL COMMENT 'Wann wurde Addon approved/veröffentlicht?',
    
    -- Indizes
    INDEX idx_author (author_user_id),
    INDEX idx_visibility (visibility),
    INDEX idx_status (status),
    INDEX idx_category (category),
    INDEX idx_rating (rating_avg DESC),
    INDEX idx_trust_level (trust_level),
    INDEX idx_steam_app (steam_app_id),
    INDEX idx_guild (guild_id),
    
    -- Constraints
    CONSTRAINT check_private_guild CHECK (visibility != 'private' OR guild_id IS NOT NULL),
    CONSTRAINT check_rating_range CHECK (rating_avg >= 0.00 AND rating_avg <= 5.00),
    
    -- Foreign Keys
    FOREIGN KEY (forked_from) REFERENCES addon_marketplace(id) ON DELETE SET NULL
    
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Addon-Marketplace für Gameserver-Konfigurationen';
