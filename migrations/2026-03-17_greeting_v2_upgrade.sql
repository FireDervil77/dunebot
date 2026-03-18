-- Greeting Plugin v2.0 Upgrade
-- Adds: Multi-AutoRole, DM Welcome, Boost Messages, Welcome Image

-- Multi-AutoRole (JSON array replaces single autorole_id)
ALTER TABLE greeting_settings
    ADD COLUMN autorole_ids JSON DEFAULT NULL COMMENT 'Array of Discord Role IDs'
    AFTER autorole_id;

-- Migrate existing autorole_id to autorole_ids array
UPDATE greeting_settings
    SET autorole_ids = JSON_ARRAY(autorole_id)
    WHERE autorole_id IS NOT NULL AND autorole_id != '';

-- DM Welcome
ALTER TABLE greeting_settings
    ADD COLUMN dm_welcome_enabled BOOLEAN DEFAULT FALSE AFTER welcome_embed,
    ADD COLUMN dm_welcome_content TEXT DEFAULT NULL AFTER dm_welcome_enabled,
    ADD COLUMN dm_welcome_embed JSON DEFAULT NULL AFTER dm_welcome_content;

-- Welcome Image
ALTER TABLE greeting_settings
    ADD COLUMN welcome_image_enabled BOOLEAN DEFAULT FALSE AFTER dm_welcome_embed,
    ADD COLUMN welcome_image_bg VARCHAR(50) DEFAULT 'default' AFTER welcome_image_enabled,
    ADD COLUMN welcome_image_text VARCHAR(255) DEFAULT NULL AFTER welcome_image_bg,
    ADD COLUMN welcome_image_color VARCHAR(7) DEFAULT '#5865f2' AFTER welcome_image_text;

-- Boost Messages
ALTER TABLE greeting_settings
    ADD COLUMN boost_enabled BOOLEAN DEFAULT FALSE AFTER farewell_embed,
    ADD COLUMN boost_channel VARCHAR(255) DEFAULT NULL AFTER boost_enabled,
    ADD COLUMN boost_content TEXT DEFAULT NULL AFTER boost_channel,
    ADD COLUMN boost_embed JSON DEFAULT NULL AFTER boost_content;
