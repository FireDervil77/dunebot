'use strict';

module.exports = {
    description: 'add_notification_category_and_admin_channel_config',

    async up(db) {
        // 1. Kategorie-Spalte für Notifications
        await db.query(`
            ALTER TABLE notifications
            ADD COLUMN IF NOT EXISTS category ENUM('announcement','changelog','status','maintenance','other')
            DEFAULT 'announcement' AFTER type
        `);

        // 2. Admin-Settings Tabelle für globale Konfigurationen (Channel-Mappings etc.)
        await db.query(`
            CREATE TABLE IF NOT EXISTS admin_settings (
                \`key\` VARCHAR(100) NOT NULL PRIMARY KEY,
                \`value\` TEXT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    },

    async down(db) {
        await db.query(`ALTER TABLE notifications DROP COLUMN IF EXISTS category`);
        await db.query(`DROP TABLE IF EXISTS admin_settings`);
    }
};
