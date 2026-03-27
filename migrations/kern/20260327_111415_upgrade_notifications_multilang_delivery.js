'use strict';

module.exports = {
    description: 'upgrade_notifications_multilang_delivery',

    async up(db) {
        // Prüfe ob alte Spalten noch existieren (title VARCHAR statt title_translations)
        const [columns] = await db.query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications'
        `);
        const colNames = (Array.isArray(columns) ? columns : [columns]).map(c => c.COLUMN_NAME);

        // 1. Alte Spalten → neue JSON-Spalten migrieren
        if (colNames.includes('title') && !colNames.includes('title_translations')) {
            await db.query(`ALTER TABLE notifications ADD COLUMN title_translations LONGTEXT NULL AFTER id`);
            await db.query(`UPDATE notifications SET title_translations = JSON_OBJECT('de-DE', title, 'en-GB', title) WHERE title_translations IS NULL`);
            await db.query(`ALTER TABLE notifications DROP COLUMN title`);
        }
        if (colNames.includes('message') && !colNames.includes('message_translations')) {
            await db.query(`ALTER TABLE notifications ADD COLUMN message_translations LONGTEXT NULL AFTER title_translations`);
            await db.query(`UPDATE notifications SET message_translations = JSON_OBJECT('de-DE', message, 'en-GB', message) WHERE message_translations IS NULL`);
            await db.query(`ALTER TABLE notifications DROP COLUMN message`);
        }
        if (colNames.includes('action_text') && !colNames.includes('action_text_translations')) {
            await db.query(`ALTER TABLE notifications ADD COLUMN action_text_translations LONGTEXT NULL AFTER message_translations`);
            await db.query(`UPDATE notifications SET action_text_translations = JSON_OBJECT('de-DE', COALESCE(action_text, 'Mehr erfahren'), 'en-GB', COALESCE(action_text, 'Learn more')) WHERE action_text_translations IS NULL`);
            await db.query(`ALTER TABLE notifications DROP COLUMN action_text`);
        }

        // 2. Neue Spalten hinzufügen (idempotent)
        if (!colNames.includes('title_translations')) {
            await db.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title_translations LONGTEXT NULL AFTER id`);
        }
        if (!colNames.includes('message_translations')) {
            await db.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS message_translations LONGTEXT NULL AFTER title_translations`);
        }
        if (!colNames.includes('action_text_translations')) {
            await db.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_text_translations LONGTEXT NULL AFTER message_translations`);
        }
        if (!colNames.includes('delivery_method')) {
            await db.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS delivery_method VARCHAR(255) DEFAULT '["dashboard"]' AFTER action_url`);
            await db.query(`CREATE INDEX IF NOT EXISTS idx_delivery_method ON notifications (delivery_method(50))`);
        }
        if (!colNames.includes('target_guild_ids')) {
            await db.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS target_guild_ids TEXT NULL AFTER delivery_method`);
        }
        if (!colNames.includes('discord_channel_id')) {
            await db.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS discord_channel_id VARCHAR(255) NULL AFTER target_guild_ids`);
        }
        if (!colNames.includes('sent_to_discord')) {
            await db.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS sent_to_discord TINYINT(1) NOT NULL DEFAULT 0 AFTER discord_channel_id`);
            await db.query(`CREATE INDEX IF NOT EXISTS idx_sent_to_discord ON notifications (sent_to_discord)`);
        }
        if (!colNames.includes('discord_message_ids')) {
            await db.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS discord_message_ids TEXT NULL AFTER sent_to_discord`);
        }
    },

    async down(db) {
        // Rollback: Neue Spalten entfernen, alte wiederherstellen
        await db.query(`ALTER TABLE notifications DROP COLUMN IF EXISTS delivery_method`);
        await db.query(`ALTER TABLE notifications DROP COLUMN IF EXISTS target_guild_ids`);
        await db.query(`ALTER TABLE notifications DROP COLUMN IF EXISTS discord_channel_id`);
        await db.query(`ALTER TABLE notifications DROP COLUMN IF EXISTS sent_to_discord`);
        await db.query(`ALTER TABLE notifications DROP COLUMN IF EXISTS discord_message_ids`);
    }
};
