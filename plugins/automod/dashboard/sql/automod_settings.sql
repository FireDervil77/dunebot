-- AutoMod Settings Tabelle
-- Speichert alle AutoMod-Konfigurationen pro Guild
CREATE TABLE IF NOT EXISTS automod_settings (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL UNIQUE COMMENT 'Discord Guild ID',
    
    -- Logging & Bestrafung
    log_channel VARCHAR(20) DEFAULT NULL COMMENT 'Channel-ID für Violation-Logs',
    log_embed_color VARCHAR(7) DEFAULT '#FF0000' COMMENT 'Hex-Farbe für Log-Embeds',
    dm_embed_color VARCHAR(7) DEFAULT '#FFA500' COMMENT 'Hex-Farbe für User-DM-Embeds',
    max_strikes TINYINT UNSIGNED DEFAULT 10 COMMENT 'Anzahl Strikes bevor Aktion ausgeführt wird',
    action ENUM('TIMEOUT', 'KICK', 'BAN') DEFAULT 'TIMEOUT' COMMENT 'Bestrafungsaktion bei Max Strikes',
    debug_mode BOOLEAN DEFAULT FALSE COMMENT 'Prüft auch Admin/Mod-Nachrichten (für Tests)',
    
    -- Anti-Features (Content-Filter)
    anti_attachments BOOLEAN DEFAULT FALSE COMMENT 'Blockiert Dateianhänge',
    anti_invites BOOLEAN DEFAULT FALSE COMMENT 'Blockiert Discord-Invite-Links',
    anti_links BOOLEAN DEFAULT FALSE COMMENT 'Blockiert alle URLs',
    anti_spam BOOLEAN DEFAULT FALSE COMMENT 'Erkennt identische Nachrichten',
    anti_ghostping BOOLEAN DEFAULT FALSE COMMENT 'Loggt gelöschte Mentions (keine Strikes)',
    anti_massmention BOOLEAN DEFAULT FALSE COMMENT 'Verhindert Mass-Mentions',
    anti_massmention_threshold TINYINT UNSIGNED DEFAULT 5 COMMENT 'Anzahl Mentions ab der Mass-Mention gilt',
    max_lines SMALLINT UNSIGNED DEFAULT 0 COMMENT 'Max Zeilenanzahl (0 = deaktiviert)',
    max_mentions TINYINT UNSIGNED DEFAULT 0 COMMENT 'Max User-Mentions pro Nachricht (0 = unbegrenzt)',
    max_role_mentions TINYINT UNSIGNED DEFAULT 0 COMMENT 'Max Rollen-Mentions pro Nachricht (0 = unbegrenzt)',
    
    -- Whitelist (JSON Array von Channel-IDs)
    whitelisted_channels JSON DEFAULT NULL COMMENT 'Array von Channel-IDs die ignoriert werden',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AutoMod Konfiguration pro Guild';
