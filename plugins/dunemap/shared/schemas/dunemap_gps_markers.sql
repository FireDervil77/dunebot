-- GPS-basierte Marker für interaktive Leaflet-Karte
-- Separate Tabelle von dunemap_markers (die Dune-Sektoren verwendet)

CREATE TABLE IF NOT EXISTS dunemap_gps_markers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    latitude DECIMAL(10, 7) NOT NULL,
    longitude DECIMAL(10, 7) NOT NULL,
    icon VARCHAR(100) DEFAULT 'fa-solid fa-location-dot',
    color VARCHAR(7) DEFAULT '#ff6b6b',
    category VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_guild (guild_id),
    INDEX idx_category (guild_id, category),
    INDEX idx_coordinates (latitude, longitude)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
