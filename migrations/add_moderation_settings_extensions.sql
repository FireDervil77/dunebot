-- Erweiterung der moderation_settings Tabelle
-- Fügt Modlog Event Filter und DM Notification Optionen hinzu

ALTER TABLE moderation_settings
ADD COLUMN IF NOT EXISTS modlog_events JSON DEFAULT '["WARN","KICK","BAN","TIMEOUT","UNTIMEOUT","SOFTBAN","UNBAN"]' COMMENT 'Welche Events sollen geloggt werden',
ADD COLUMN IF NOT EXISTS dm_on_warn TINYINT(1) DEFAULT 1 COMMENT 'User per DM bei Warning benachrichtigen',
ADD COLUMN IF NOT EXISTS dm_on_kick TINYINT(1) DEFAULT 1 COMMENT 'User per DM bei Kick benachrichtigen',
ADD COLUMN IF NOT EXISTS dm_on_ban TINYINT(1) DEFAULT 1 COMMENT 'User per DM bei Ban benachrichtigen',
ADD COLUMN IF NOT EXISTS dm_on_timeout TINYINT(1) DEFAULT 1 COMMENT 'User per DM bei Timeout benachrichtigen';
