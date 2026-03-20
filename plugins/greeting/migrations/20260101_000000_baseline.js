'use strict';

/**
 * BASELINE MIGRATION — Greeting Plugin
 * Enthält die bestehende greeting_settings Tabelle.
 */
module.exports = {
    description: 'Baseline: Greeting Plugin (greeting_settings)',
    baseline: true,

    async up(db) {

        await db.query(`
            CREATE TABLE IF NOT EXISTS greeting_settings (
                id INT AUTO_INCREMENT PRIMARY KEY,
                guild_id VARCHAR(255) NOT NULL UNIQUE,
                autorole_id VARCHAR(255) DEFAULT NULL,
                welcome_enabled BOOLEAN DEFAULT FALSE,
                welcome_channel VARCHAR(255) DEFAULT NULL,
                welcome_content TEXT DEFAULT NULL,
                welcome_embed JSON DEFAULT NULL,
                farewell_enabled BOOLEAN DEFAULT FALSE,
                farewell_channel VARCHAR(255) DEFAULT NULL,
                farewell_content TEXT DEFAULT NULL,
                farewell_embed JSON DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_guild (guild_id),
                INDEX idx_welcome_enabled (welcome_enabled),
                INDEX idx_farewell_enabled (farewell_enabled),
                FOREIGN KEY (guild_id) REFERENCES guilds(_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    }
};
