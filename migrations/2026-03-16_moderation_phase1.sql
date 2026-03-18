-- Migration: Moderation Phase 1 Updates
-- 1. Case-ID zu moderation_logs hinzufügen (Guild-spezifisch)
-- 2. moderation_settings um neue Felder erweitern

-- Case-Nummer: pro Guild auto-increment via Trigger
ALTER TABLE moderation_logs 
    ADD COLUMN case_number INT DEFAULT NULL COMMENT 'Guild-spezifische Case-Nummer' AFTER id;

ALTER TABLE moderation_logs 
    ADD INDEX idx_guild_case (guild_id, case_number);

-- moderation_settings um DM-Felder und default_reason erweitern (falls nicht vorhanden)
-- Prüfe ob Spalten fehlen und füge sie hinzu
ALTER TABLE moderation_settings 
    ADD COLUMN IF NOT EXISTS modlog_events JSON DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS dm_on_warn TINYINT DEFAULT 1,
    ADD COLUMN IF NOT EXISTS dm_on_kick TINYINT DEFAULT 1,
    ADD COLUMN IF NOT EXISTS dm_on_ban TINYINT DEFAULT 1,
    ADD COLUMN IF NOT EXISTS dm_on_timeout TINYINT DEFAULT 1,
    ADD COLUMN IF NOT EXISTS default_reason TEXT DEFAULT NULL;
