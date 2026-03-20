'use strict';

/**
 * Greeting Plugin: Verification Flow + Invite-Tracking
 * Migriert von: plugins/greeting/dashboard/updates/001_verification_invite_tracking.sql
 */
module.exports = {
    description: 'Verification-Spalten + Invite-Mapping Tabelle',

    async up(db) {
        // Verification-Spalten zu greeting_settings hinzufügen
        const cols = [
            { name: 'verification_enabled', def: "TINYINT(1) NOT NULL DEFAULT 0 AFTER boost_embed" },
            { name: 'verification_channel', def: "VARCHAR(255) DEFAULT NULL COMMENT 'Channel where verification button/captcha is posted' AFTER verification_enabled" },
            { name: 'verification_role_id', def: "VARCHAR(255) DEFAULT NULL COMMENT 'Role given after verification' AFTER verification_channel" },
            { name: 'verification_type', def: "ENUM('button','captcha') NOT NULL DEFAULT 'button' AFTER verification_role_id" },
            { name: 'verification_message', def: "TEXT DEFAULT NULL COMMENT 'Custom verification message/embed' AFTER verification_type" },
            { name: 'verification_remove_role_id', def: "VARCHAR(255) DEFAULT NULL COMMENT 'Unverified role removed after verification' AFTER verification_message" },
        ];

        for (const col of cols) {
            const [existing] = await db.query(
                `SELECT COUNT(*) as cnt FROM information_schema.columns 
                 WHERE table_schema = DATABASE() AND table_name = 'greeting_settings' AND column_name = ?`,
                [col.name]
            );
            if (existing[0]?.cnt === 0 || existing?.cnt === 0) {
                await db.query(`ALTER TABLE greeting_settings ADD COLUMN ${col.name} ${col.def}`);
            }
        }

        // Invite-Mappings Tabelle
        await db.query(`
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
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS greeting_invite_mappings');
        const cols = ['verification_remove_role_id', 'verification_message', 'verification_type',
                      'verification_role_id', 'verification_channel', 'verification_enabled'];
        for (const col of cols) {
            await db.query(`ALTER TABLE greeting_settings DROP COLUMN IF EXISTS ${col}`);
        }
    }
};
