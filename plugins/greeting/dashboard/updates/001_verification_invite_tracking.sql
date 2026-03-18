-- Greeting Plugin: Verification Flow (4.3) + Invite-Tracking (4.4)
-- Adds verification columns to greeting_settings and creates invite_mappings table

ALTER TABLE greeting_settings 
    ADD COLUMN verification_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER boost_embed,
    ADD COLUMN verification_channel VARCHAR(255) DEFAULT NULL COMMENT 'Channel where verification button/captcha is posted' AFTER verification_enabled,
    ADD COLUMN verification_role_id VARCHAR(255) DEFAULT NULL COMMENT 'Role given after verification' AFTER verification_channel,
    ADD COLUMN verification_type ENUM('button','captcha') NOT NULL DEFAULT 'button' AFTER verification_role_id,
    ADD COLUMN verification_message TEXT DEFAULT NULL COMMENT 'Custom verification message/embed' AFTER verification_type,
    ADD COLUMN verification_remove_role_id VARCHAR(255) DEFAULT NULL COMMENT 'Unverified role removed after verification' AFTER verification_message;

CREATE TABLE IF NOT EXISTS greeting_invite_mappings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    guild_id VARCHAR(255) NOT NULL,
    invite_code VARCHAR(50) NOT NULL,
    label VARCHAR(100) DEFAULT NULL COMMENT 'Friendly name for this invite',
    welcome_content TEXT DEFAULT NULL,
    welcome_embed JSON DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_guild_invite (guild_id, invite_code),
    INDEX idx_guild (guild_id),
    FOREIGN KEY (guild_id) REFERENCES guilds(_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
