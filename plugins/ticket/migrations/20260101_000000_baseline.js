'use strict';

/**
 * BASELINE MIGRATION — Ticket Plugin
 * Enthält alle bestehenden Ticket-Tabellen (7 Tabellen).
 */
module.exports = {
    description: 'Baseline: Ticket Plugin (settings, categories, tickets, transcripts, feedback, tags, auto_responses)',
    baseline: true,

    async up(db) {

        await db.query(`
            CREATE TABLE IF NOT EXISTS ticket_settings (
                guild_id VARCHAR(20) NOT NULL PRIMARY KEY,
                log_channel VARCHAR(20) DEFAULT NULL,
                ticket_limit INT UNSIGNED DEFAULT 10,
                embed_color_create VARCHAR(7) DEFAULT '#068ADD',
                embed_color_close VARCHAR(7) DEFAULT '#068ADD',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS ticket_categories (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                guild_id VARCHAR(20) NOT NULL,
                name VARCHAR(100) NOT NULL,
                description TEXT DEFAULT NULL,
                parent_id VARCHAR(20) DEFAULT NULL,
                channel_style ENUM('NUMBER', 'NAME', 'ID') DEFAULT 'NUMBER',
                staff_roles JSON DEFAULT NULL,
                member_roles JSON DEFAULT NULL,
                open_msg_title VARCHAR(256) DEFAULT NULL,
                open_msg_description TEXT DEFAULT NULL,
                open_msg_footer VARCHAR(256) DEFAULT NULL,
                button_label VARCHAR(80) DEFAULT 'Ticket erstellen',
                button_emoji VARCHAR(50) DEFAULT '🎫',
                button_color ENUM('PRIMARY', 'SECONDARY', 'SUCCESS', 'DANGER') DEFAULT 'PRIMARY',
                max_open_per_user INT UNSIGNED DEFAULT 1,
                form_fields JSON DEFAULT NULL,
                is_active TINYINT(1) DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uk_guild_name (guild_id, name),
                INDEX idx_guild (guild_id),
                INDEX idx_guild_active (guild_id, is_active)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS tickets (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                guild_id VARCHAR(20) NOT NULL,
                category_id INT UNSIGNED DEFAULT NULL,
                channel_id VARCHAR(20) NOT NULL,
                ticket_id VARCHAR(20) NOT NULL,
                ticket_number INT UNSIGNED NOT NULL,
                created_by VARCHAR(20) NOT NULL,
                claimed_by VARCHAR(20) DEFAULT NULL,
                claimed_at TIMESTAMP NULL DEFAULT NULL,
                status ENUM('open', 'closed') DEFAULT 'open',
                close_reason TEXT DEFAULT NULL,
                closed_by VARCHAR(20) DEFAULT NULL,
                category_name VARCHAR(100) DEFAULT NULL,
                form_responses JSON DEFAULT NULL,
                opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                closed_at TIMESTAMP NULL DEFAULT NULL,
                reopened_by VARCHAR(20) DEFAULT NULL,
                reopened_at TIMESTAMP NULL DEFAULT NULL,
                reopen_count INT UNSIGNED DEFAULT 0,
                UNIQUE KEY uk_guild_ticket_id (guild_id, ticket_id),
                INDEX idx_guild (guild_id),
                INDEX idx_guild_status (guild_id, status),
                INDEX idx_guild_user (guild_id, created_by),
                INDEX idx_channel (channel_id),
                CONSTRAINT fk_ticket_category FOREIGN KEY (category_id)
                    REFERENCES ticket_categories(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS ticket_transcripts (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                ticket_id INT UNSIGNED NOT NULL,
                guild_id VARCHAR(20) NOT NULL,
                messages JSON NOT NULL,
                message_count INT UNSIGNED DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_ticket (ticket_id),
                INDEX idx_guild (guild_id),
                CONSTRAINT fk_transcript_ticket FOREIGN KEY (ticket_id)
                    REFERENCES tickets(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS ticket_feedback (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                guild_id VARCHAR(20) NOT NULL,
                ticket_id INT UNSIGNED NOT NULL,
                user_id VARCHAR(20) NOT NULL,
                rating TINYINT UNSIGNED NOT NULL,
                comment TEXT DEFAULT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY unique_ticket_feedback (ticket_id),
                KEY idx_guild (guild_id),
                CONSTRAINT fk_feedback_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS ticket_tags (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                guild_id VARCHAR(20) NOT NULL,
                name VARCHAR(50) NOT NULL,
                content TEXT NOT NULL,
                created_by VARCHAR(20) DEFAULT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY unique_guild_tag (guild_id, name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS ticket_auto_responses (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                guild_id VARCHAR(20) NOT NULL,
                keywords JSON NOT NULL,
                response TEXT NOT NULL,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_guild_active (guild_id, is_active)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    }
};
