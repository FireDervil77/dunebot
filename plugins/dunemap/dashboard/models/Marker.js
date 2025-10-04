/**
 * MySQL-Tabellendefinition für Marker
 * @author firedervil
 * @type {object}
 */
module.exports = {
  name: 'Marker',
  schema: `
        CREATE TABLE IF NOT EXISTS dunemap_markers (
            id INT AUTO_INCREMENT PRIMARY KEY,
            guild_id VARCHAR(255) NOT NULL,
            sector_x CHAR(1) NOT NULL,      -- A-I
            sector_y TINYINT NOT NULL,      -- 0-9
            marker_type VARCHAR(50) NOT NULL,
            placed_by VARCHAR(255) NOT NULL, -- Discord User ID
            placed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_guild_sector (guild_id, sector_x, sector_y),
            INDEX idx_guild_user (guild_id, placed_by),
            CONSTRAINT chk_sector_x CHECK (sector_x IN ('A','B','C','D','E','F','G','H','I')),
            CONSTRAINT chk_sector_y CHECK (sector_y BETWEEN 0 AND 9),
            CONSTRAINT chk_marker_type CHECK (marker_type IN (
                'titan', 'spice', 'stravidium', 'base', 'wrack',
                'aluminium', 'basalt', 'eisen', 'karbon', 'hoele',
                'hole', 'kontrollpunkt', 'taxi', 'test'
            ))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `,
  // Trigger separat, da DELIMITER nur in CLI funktioniert
  trigger: `
        DROP TRIGGER IF EXISTS check_marker_limit;
        CREATE TRIGGER check_marker_limit
        BEFORE INSERT ON dunemap_markers
        FOR EACH ROW
        BEGIN
            DECLARE marker_count INT;
            
            SELECT COUNT(*) INTO marker_count
            FROM dunemap_markers
            WHERE guild_id = NEW.guild_id
              AND sector_x = NEW.sector_x
              AND sector_y = NEW.sector_y;
            
            IF marker_count >= 4 THEN
                SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Maximal 4 Marker pro Koordinate erlaubt';
            END IF;
        END;
  `
};