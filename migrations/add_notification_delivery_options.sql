-- Migration: Add delivery options to notifications table
-- Adds fields for controlling how notifications are delivered (Dashboard, Discord Channel, DM to admins)

ALTER TABLE notifications
ADD COLUMN delivery_method ENUM('dashboard', 'discord_channel', 'discord_dm', 'all') 
    NOT NULL DEFAULT 'dashboard'
    COMMENT 'How the notification should be delivered'
    AFTER action_url;

ALTER TABLE notifications
ADD COLUMN target_guild_ids TEXT NULL
    COMMENT 'JSON array of guild IDs to send notification to (null = all guilds)'
    AFTER delivery_method;

ALTER TABLE notifications
ADD COLUMN discord_channel_id VARCHAR(255) NULL
    COMMENT 'Discord channel ID for discord_channel delivery method'
    AFTER target_guild_ids;

ALTER TABLE notifications
ADD COLUMN sent_to_discord TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Flag if notification was sent to Discord'
    AFTER discord_channel_id;

ALTER TABLE notifications
ADD COLUMN discord_message_ids TEXT NULL
    COMMENT 'JSON object with guild_id => message_id mapping for sent Discord messages'
    AFTER sent_to_discord;

-- Add index for faster queries on delivery method
CREATE INDEX idx_delivery_method ON notifications(delivery_method);
CREATE INDEX idx_sent_to_discord ON notifications(sent_to_discord);
