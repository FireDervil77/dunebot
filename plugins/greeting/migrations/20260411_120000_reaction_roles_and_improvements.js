/**
 * Migration: Reaction Roles + Verification Improvements
 * 
 * - Adds 'reaction' to verification_type ENUM
 * - Adds verification_emoji and verification_message_id columns
 * - Creates greeting_reaction_panels table
 * - Creates greeting_reaction_roles table
 */
module.exports = {
    async up(db) {
        // 1. Erweitere verification_type ENUM um 'reaction'
        await db.query(`
            ALTER TABLE greeting_settings 
            MODIFY COLUMN verification_type ENUM('button','captcha','reaction') NOT NULL DEFAULT 'button'
        `);

        // 2. Neue Spalten für Reaction-Verification
        await db.query(`
            ALTER TABLE greeting_settings 
            ADD COLUMN IF NOT EXISTS verification_emoji VARCHAR(100) DEFAULT '✅' 
            COMMENT 'Emoji for reaction verification'
        `);
        await db.query(`
            ALTER TABLE greeting_settings 
            ADD COLUMN IF NOT EXISTS verification_message_id VARCHAR(255) DEFAULT NULL 
            COMMENT 'Discord message ID of the verification panel'
        `);

        // 3. Reaction Role Panels
        await db.query(`
            CREATE TABLE IF NOT EXISTS greeting_reaction_panels (
                id INT AUTO_INCREMENT PRIMARY KEY,
                guild_id VARCHAR(255) NOT NULL,
                channel_id VARCHAR(255) DEFAULT NULL,
                message_id VARCHAR(255) DEFAULT NULL COMMENT 'Discord message ID after sending',
                title VARCHAR(255) DEFAULT 'Reaction Roles',
                description TEXT DEFAULT NULL,
                color VARCHAR(10) DEFAULT '#5865f2',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_guild (guild_id),
                INDEX idx_message (message_id),
                FOREIGN KEY (guild_id) REFERENCES guilds(_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 4. Reaction Role Mappings (emoji → role)
        await db.query(`
            CREATE TABLE IF NOT EXISTS greeting_reaction_roles (
                id INT AUTO_INCREMENT PRIMARY KEY,
                panel_id INT NOT NULL,
                emoji VARCHAR(100) NOT NULL,
                role_id VARCHAR(255) NOT NULL,
                description VARCHAR(255) DEFAULT NULL,
                UNIQUE KEY uk_panel_emoji (panel_id, emoji),
                FOREIGN KEY (panel_id) REFERENCES greeting_reaction_panels(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS greeting_reaction_roles');
        await db.query('DROP TABLE IF EXISTS greeting_reaction_panels');
        await db.query('ALTER TABLE greeting_settings DROP COLUMN IF EXISTS verification_emoji');
        await db.query('ALTER TABLE greeting_settings DROP COLUMN IF EXISTS verification_message_id');
        await db.query(`
            ALTER TABLE greeting_settings 
            MODIFY COLUMN verification_type ENUM('button','captcha') NOT NULL DEFAULT 'button'
        `);
    }
};
