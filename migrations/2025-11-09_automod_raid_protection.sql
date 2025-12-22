-- AutoMod: Raid Protection Feature
-- Date: 2025-11-09
-- Author: DuneBot Team

-- Erweitere automod_settings Tabelle um Raid-Protection-Felder
ALTER TABLE automod_settings
    -- Raid Protection Toggle
    ADD COLUMN raid_protection_enabled BOOLEAN DEFAULT FALSE COMMENT 'Raid-Schutz aktivieren',
    
    -- Join-Spam Detection
    ADD COLUMN raid_join_threshold TINYINT UNSIGNED DEFAULT 5 COMMENT 'X User in Y Sekunden = Raid',
    ADD COLUMN raid_join_timespan SMALLINT UNSIGNED DEFAULT 10 COMMENT 'Zeitfenster in Sekunden',
    
    -- Account-Age Filter
    ADD COLUMN raid_min_account_age_days TINYINT UNSIGNED DEFAULT 7 COMMENT 'Min. Account-Alter (Tage)',
    
    -- Actions
    ADD COLUMN raid_action ENUM('KICK', 'BAN') DEFAULT 'KICK' COMMENT 'Aktion bei Raid-Detection (Auto-Kick, Manual-Ban)',
    
    -- Lockdown
    ADD COLUMN raid_lockdown_enabled BOOLEAN DEFAULT FALSE COMMENT 'Server bei Raid sperren',
    ADD COLUMN raid_lockdown_active BOOLEAN DEFAULT FALSE COMMENT 'Lockdown aktiv (Runtime-State)',
    
    -- Notifications
    ADD COLUMN raid_alert_channel VARCHAR(20) DEFAULT NULL COMMENT 'Channel für Raid-Alerts',
    ADD COLUMN raid_alert_mention_mods BOOLEAN DEFAULT TRUE COMMENT '@Mods erwähnen bei Raid',
    
    -- Trusted Invites (JSON Array von Invite-Codes)
    ADD COLUMN raid_trusted_invites JSON DEFAULT NULL COMMENT 'Whitelist von erlaubten Invite-Codes';

-- Index für lockdown_active (schnelle Raids-Check)
CREATE INDEX idx_lockdown_active ON automod_settings(guild_id, raid_lockdown_active);

-- Neue Tabelle: Raid-Events Log (für Statistiken & Forensics)
CREATE TABLE IF NOT EXISTS automod_raid_events (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL COMMENT 'Discord Guild ID',
    event_type ENUM('JOIN_SPIKE', 'YOUNG_ACCOUNT', 'RAID_DETECTED', 'LOCKDOWN_ACTIVATED', 'LOCKDOWN_DEACTIVATED') NOT NULL,
    user_id VARCHAR(20) DEFAULT NULL COMMENT 'Discord User ID (wenn user-spezifisch)',
    user_tag VARCHAR(100) DEFAULT NULL COMMENT 'Username#Discriminator',
    account_created_at TIMESTAMP NULL DEFAULT NULL COMMENT 'Account-Erstellungsdatum',
    invite_code VARCHAR(50) DEFAULT NULL COMMENT 'Verwendeter Invite-Code',
    action_taken VARCHAR(50) DEFAULT NULL COMMENT 'Durchgeführte Aktion (KICKED, BANNED, WHITELISTED)',
    metadata JSON DEFAULT NULL COMMENT 'Zusätzliche Event-Daten',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_guild (guild_id),
    INDEX idx_event_type (event_type),
    INDEX idx_created_at (created_at),
    FOREIGN KEY (guild_id) REFERENCES guilds(_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AutoMod Raid-Event Logs';

-- Default-Werte für bestehende Guilds setzen
UPDATE automod_settings 
SET 
    raid_protection_enabled = FALSE,
    raid_join_threshold = 5,
    raid_join_timespan = 10,
    raid_min_account_age_days = 7,
    raid_action = 'KICK',
    raid_lockdown_enabled = FALSE,
    raid_lockdown_active = FALSE,
    raid_alert_mention_mods = TRUE,
    raid_trusted_invites = JSON_ARRAY()
WHERE guild_id IS NOT NULL;
