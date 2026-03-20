'use strict';

/**
 * BASELINE MIGRATION — Kern-System
 * 
 * Enthält ALLE bestehenden Kern-Tabellen (Models + Schemas 01-19).
 * 
 * - Bestehende DB: Wird nur registriert, nicht ausgeführt (baseline: true)
 * - Fresh Install: Wird ausgeführt und erstellt alle Tabellen
 */
module.exports = {
    description: 'Baseline: Alle bestehenden Kern-Tabellen, Triggers und Views',
    baseline: true,

    async up(db) {

        // ═══════════════════════════════════════════════════════
        // TEIL 1: Model-Tabellen (aus packages/dunebot-db-client/models/)
        // ═══════════════════════════════════════════════════════

        // guilds
        await db.query(`
            CREATE TABLE IF NOT EXISTS guilds (
                _id VARCHAR(255) NOT NULL PRIMARY KEY,
                guild_name VARCHAR(255) NOT NULL,
                owner_id VARCHAR(255) DEFAULT NULL,
                owner_name VARCHAR(255) DEFAULT NULL,
                joined_at DATETIME NOT NULL,
                left_at DATETIME DEFAULT NULL,
                is_active_guild TINYINT(1) DEFAULT 0,
                active_user_id VARCHAR(255) DEFAULT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_owner_active (owner_id, is_active_guild),
                INDEX idx_active_user (active_user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // users
        await db.query(`
            CREATE TABLE IF NOT EXISTS users (
                _id VARCHAR(255) NOT NULL PRIMARY KEY,
                locale VARCHAR(255) DEFAULT NULL,
                logged_in TINYINT(1) DEFAULT NULL,
                tokens LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // configs
        await db.query(`
            CREATE TABLE IF NOT EXISTS configs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                plugin_name VARCHAR(255) NOT NULL,
                config_key VARCHAR(255) NOT NULL,
                config_value TEXT NULL,
                context VARCHAR(255) NOT NULL DEFAULT 'shared',
                guild_id VARCHAR(255) DEFAULT '',
                is_global TINYINT(1) DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_plugin_context (plugin_name, config_key, context),
                INDEX idx_guild (guild_id),
                UNIQUE KEY unique_plugin_config (plugin_name, config_key, context, guild_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // news
        await db.query(`
            CREATE TABLE IF NOT EXISTS news (
                _id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                slug VARCHAR(255) NOT NULL,
                author VARCHAR(255) NOT NULL,
                news_text TEXT NOT NULL,
                excerpt TEXT DEFAULT NULL,
                image_url VARCHAR(255) DEFAULT NULL,
                date DATETIME NOT NULL,
                status VARCHAR(255) NOT NULL DEFAULT 'published',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // localizations
        await db.query(`
            CREATE TABLE IF NOT EXISTS localizations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                app VARCHAR(255) NOT NULL,
                plugin VARCHAR(255) NOT NULL,
                lang VARCHAR(255) NOT NULL,
                data LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
                lastModified DATETIME NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // states (OAuth2)
        await db.query(`
            CREATE TABLE IF NOT EXISTS states (
                id varchar(255) NOT NULL,
                value text DEFAULT NULL,
                created_at datetime NOT NULL DEFAULT current_timestamp()
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // guild_nav_items
        await db.query(`
            CREATE TABLE IF NOT EXISTS guild_nav_items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                plugin VARCHAR(255) DEFAULT NULL,
                guildId VARCHAR(255) DEFAULT NULL,
                title VARCHAR(255) DEFAULT NULL,
                url VARCHAR(255) DEFAULT NULL,
                icon VARCHAR(255) DEFAULT 'fa-puzzle-piece',
                sort_order INT DEFAULT 50,
                parent VARCHAR(255) DEFAULT NULL,
                type VARCHAR(255) NOT NULL DEFAULT 'main',
                capability VARCHAR(255) DEFAULT 'manage_guild',
                target VARCHAR(255) DEFAULT '_self',
                visible TINYINT(1) DEFAULT 1,
                classes VARCHAR(255) DEFAULT '',
                position VARCHAR(255) DEFAULT 'normal',
                meta LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
                requiresOwner TINYINT(1) DEFAULT 0,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // changelogs
        await db.query(`
            CREATE TABLE IF NOT EXISTS changelogs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                version VARCHAR(50) NOT NULL,
                title VARCHAR(255) NOT NULL,
                description LONGTEXT NOT NULL,
                type ENUM('major', 'minor', 'patch', 'hotfix') NOT NULL DEFAULT 'minor',
                component ENUM('bot', 'dashboard', 'system', 'plugin') NOT NULL DEFAULT 'system',
                component_name VARCHAR(255) NULL,
                changes JSON NOT NULL,
                is_public TINYINT(1) NOT NULL DEFAULT 1,
                release_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                author_id VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // notifications
        await db.query(`
            CREATE TABLE IF NOT EXISTS notifications (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                message TEXT NOT NULL,
                type ENUM('info', 'warning', 'error', 'success') DEFAULT 'info',
                expiry DATETIME DEFAULT NULL,
                roles TEXT NULL,
                dismissed TINYINT(1) NOT NULL DEFAULT 0,
                action_url VARCHAR(255) NULL,
                action_text VARCHAR(100) NULL DEFAULT 'Mehr erfahren',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // ═══════════════════════════════════════════════════════
        // TEIL 2: Kern-Schemas (aus packages/dunebot-db-client/schemas/)
        // ═══════════════════════════════════════════════════════

        // 01: guild_users
        await db.query(`
            CREATE TABLE IF NOT EXISTS guild_users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                guild_id VARCHAR(20) NOT NULL,
                user_id VARCHAR(20) NOT NULL,
                invited_by VARCHAR(20) NOT NULL,
                invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                status ENUM('pending', 'active', 'suspended') DEFAULT 'active',
                is_owner BOOLEAN DEFAULT FALSE,
                direct_permissions JSON DEFAULT NULL,
                last_login_at TIMESTAMP NULL,
                login_count INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY unique_guild_user (guild_id, user_id),
                INDEX idx_guild (guild_id),
                INDEX idx_user (user_id),
                INDEX idx_status (status),
                FOREIGN KEY (guild_id) REFERENCES guilds(_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 02: guild_groups
        await db.query(`
            CREATE TABLE IF NOT EXISTS guild_groups (
                id INT AUTO_INCREMENT PRIMARY KEY,
                guild_id VARCHAR(20) NOT NULL,
                name VARCHAR(100) NOT NULL,
                slug VARCHAR(100) NOT NULL,
                description TEXT,
                color VARCHAR(7) DEFAULT '#6c757d',
                icon VARCHAR(50) DEFAULT 'fa-users',
                is_default BOOLEAN DEFAULT FALSE,
                is_protected BOOLEAN DEFAULT FALSE,
                permissions JSON NOT NULL,
                member_count INT DEFAULT 0,
                priority INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY unique_guild_slug (guild_id, slug),
                INDEX idx_guild (guild_id),
                INDEX idx_is_default (is_default),
                INDEX idx_priority (priority),
                FOREIGN KEY (guild_id) REFERENCES guilds(_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 03: guild_user_groups
        await db.query(`
            CREATE TABLE IF NOT EXISTS guild_user_groups (
                id INT AUTO_INCREMENT PRIMARY KEY,
                guild_user_id INT NOT NULL,
                group_id INT NOT NULL,
                assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                assigned_by VARCHAR(20) NOT NULL,
                UNIQUE KEY unique_user_group (guild_user_id, group_id),
                INDEX idx_guild_user (guild_user_id),
                INDEX idx_group (group_id),
                FOREIGN KEY (guild_user_id) REFERENCES guild_users(id) ON DELETE CASCADE,
                FOREIGN KEY (group_id) REFERENCES guild_groups(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 04: permission_definitions
        await db.query(`
            CREATE TABLE IF NOT EXISTS permission_definitions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                permission_key VARCHAR(100) NOT NULL UNIQUE,
                category VARCHAR(50) NOT NULL,
                name_translation_key VARCHAR(100) NOT NULL,
                description_translation_key VARCHAR(100),
                is_dangerous BOOLEAN DEFAULT FALSE,
                requires_permissions JSON DEFAULT NULL,
                plugin_name VARCHAR(50),
                sort_order INT DEFAULT 0,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_category (category),
                INDEX idx_plugin (plugin_name),
                INDEX idx_is_active (is_active)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 05: permissions_triggers
        await db.query('DROP TRIGGER IF EXISTS trg_group_member_added');
        await db.query(`
            CREATE TRIGGER trg_group_member_added
            AFTER INSERT ON guild_user_groups
            FOR EACH ROW
            BEGIN
                UPDATE guild_groups SET member_count = member_count + 1 WHERE id = NEW.group_id;
            END
        `);
        await db.query('DROP TRIGGER IF EXISTS trg_group_member_removed');
        await db.query(`
            CREATE TRIGGER trg_group_member_removed
            AFTER DELETE ON guild_user_groups
            FOR EACH ROW
            BEGIN
                UPDATE guild_groups SET member_count = member_count - 1 WHERE id = OLD.group_id;
            END
        `);

        // 06: permissions_views
        await db.query(`
            CREATE OR REPLACE VIEW v_guild_user_permissions AS
            SELECT
                gu.id AS guild_user_id,
                gu.guild_id,
                gu.user_id,
                gu.is_owner,
                gu.status,
                gu.direct_permissions,
                gu.last_login_at,
                GROUP_CONCAT(gg.id) AS group_ids,
                GROUP_CONCAT(gg.name SEPARATOR ', ') AS group_names,
                GROUP_CONCAT(gg.slug SEPARATOR ', ') AS group_slugs
            FROM guild_users gu
            LEFT JOIN guild_user_groups gug ON gu.id = gug.guild_user_id
            LEFT JOIN guild_groups gg ON gug.group_id = gg.id
            GROUP BY gu.id, gu.guild_id, gu.user_id, gu.is_owner, gu.status, gu.direct_permissions, gu.last_login_at
        `);
        await db.query(`
            CREATE OR REPLACE VIEW v_guild_groups_summary AS
            SELECT
                gg.id, gg.guild_id, gg.name, gg.slug, gg.description,
                gg.color, gg.icon, gg.is_default, gg.is_protected,
                gg.priority, gg.permissions, gg.member_count,
                COUNT(gug.id) AS actual_member_count
            FROM guild_groups gg
            LEFT JOIN guild_user_groups gug ON gg.id = gug.group_id
            GROUP BY gg.id, gg.guild_id, gg.name, gg.slug, gg.description, gg.color,
                     gg.icon, gg.is_default, gg.is_protected, gg.priority, gg.permissions, gg.member_count
        `);

        // 07: user_configs
        await db.query(`
            CREATE TABLE IF NOT EXISTS user_configs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id VARCHAR(20) NOT NULL,
                plugin_name VARCHAR(50) NOT NULL,
                config_key VARCHAR(100) NOT NULL,
                config_value LONGTEXT,
                guild_id VARCHAR(20) DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY unique_user_config (user_id, plugin_name, config_key, guild_id),
                INDEX idx_user_plugin (user_id, plugin_name),
                INDEX idx_user_guild (user_id, guild_id),
                INDEX idx_plugin_key (plugin_name, config_key)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 08: user_feedback
        await db.query(`
            CREATE TABLE IF NOT EXISTS user_feedback (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                guild_id VARCHAR(20) NOT NULL,
                user_id VARCHAR(20) NOT NULL,
                type ENUM('bug', 'feature') NOT NULL,
                title VARCHAR(255) NOT NULL,
                description TEXT NOT NULL,
                category VARCHAR(50) DEFAULT NULL,
                priority ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
                status ENUM('open', 'in_progress', 'resolved', 'closed', 'wontfix') DEFAULT 'open',
                upvotes INT UNSIGNED DEFAULT 0,
                guild_only TINYINT(1) NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                INDEX idx_guild_type (guild_id, type),
                INDEX idx_status (status),
                INDEX idx_user (user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 09: user_feedback_votes
        await db.query(`
            CREATE TABLE IF NOT EXISTS user_feedback_votes (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                feedback_id INT UNSIGNED NOT NULL,
                user_id VARCHAR(20) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY unique_vote (feedback_id, user_id),
                FOREIGN KEY (feedback_id) REFERENCES user_feedback(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 10: guild_toast_logs
        await db.query(`
            CREATE TABLE IF NOT EXISTS guild_toast_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                type ENUM('error', 'warning', 'info', 'success') NOT NULL,
                message TEXT NOT NULL,
                user_id VARCHAR(20) DEFAULT NULL,
                username VARCHAR(100) DEFAULT 'Anonymous',
                guild_id VARCHAR(20) DEFAULT NULL,
                url VARCHAR(500) DEFAULT NULL,
                user_agent TEXT DEFAULT NULL,
                session_id VARCHAR(128) DEFAULT NULL,
                source VARCHAR(50) DEFAULT 'guild.js',
                metadata JSON DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_guild_user (guild_id, user_id),
                INDEX idx_type_created (type, created_at),
                INDEX idx_user_created (user_id, created_at),
                INDEX idx_guild_created (guild_id, created_at),
                INDEX idx_source (source),
                INDEX idx_critical_recent (type, guild_id, user_id, created_at),
                INDEX idx_cleanup (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 11: donations
        await db.query(`
            CREATE TABLE IF NOT EXISTS donations (
                id INT PRIMARY KEY AUTO_INCREMENT,
                user_id VARCHAR(20) NOT NULL,
                guild_id VARCHAR(20),
                amount DECIMAL(10,2) NOT NULL,
                currency VARCHAR(3) DEFAULT 'EUR',
                payment_provider ENUM('stripe', 'paypal', 'manual', 'other') DEFAULT 'stripe',
                payment_id VARCHAR(255),
                payment_status ENUM('pending', 'completed', 'failed', 'refunded', 'cancelled') DEFAULT 'pending',
                message TEXT,
                is_recurring TINYINT(1) DEFAULT 0,
                recurring_until DATE,
                anonymous TINYINT(1) DEFAULT 0,
                stripe_customer_id VARCHAR(255),
                metadata JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_user (user_id),
                INDEX idx_guild (guild_id),
                INDEX idx_status (payment_status),
                INDEX idx_provider (payment_provider),
                INDEX idx_recurring (is_recurring),
                INDEX idx_created (created_at),
                INDEX idx_payment_id (payment_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 12: supporter_badges
        await db.query(`
            CREATE TABLE IF NOT EXISTS supporter_badges (
                id INT PRIMARY KEY AUTO_INCREMENT,
                user_id VARCHAR(20) UNIQUE NOT NULL,
                badge_level ENUM('bronze', 'silver', 'gold', 'platinum') DEFAULT 'bronze',
                total_donated DECIMAL(10,2) DEFAULT 0.00,
                first_donation_at TIMESTAMP NULL,
                last_donation_at TIMESTAMP NULL,
                donation_count INT DEFAULT 0,
                is_recurring TINYINT(1) DEFAULT 0,
                recurring_amount DECIMAL(10,2) DEFAULT 0.00,
                badge_visible TINYINT(1) DEFAULT 1,
                is_active TINYINT(1) DEFAULT 1,
                discord_role_synced TINYINT(1) DEFAULT 0,
                last_role_sync TIMESTAMP NULL,
                stripe_customer_id VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_level (badge_level),
                INDEX idx_recurring (is_recurring),
                INDEX idx_visible (badge_visible),
                INDEX idx_active (is_active),
                INDEX idx_total (total_donated),
                INDEX idx_stripe_customer (stripe_customer_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 13: donation_stats view
        await db.query(`
            CREATE OR REPLACE VIEW donation_stats AS
            SELECT
                COUNT(DISTINCT user_id) AS total_supporters,
                COUNT(*) AS total_donations,
                SUM(CASE WHEN payment_status = 'completed' THEN amount ELSE 0 END) AS total_amount,
                SUM(CASE WHEN payment_status = 'completed' AND is_recurring = 1 THEN amount ELSE 0 END) AS recurring_amount,
                AVG(CASE WHEN payment_status = 'completed' THEN amount END) AS average_donation,
                COUNT(CASE WHEN payment_status = 'completed' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) AS donations_last_30_days,
                SUM(CASE WHEN payment_status = 'completed' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN amount ELSE 0 END) AS amount_last_30_days
            FROM donations
        `);

        // 14: guild_themes
        await db.query(`
            CREATE TABLE IF NOT EXISTS guild_themes (
                id INT NOT NULL AUTO_INCREMENT,
                guild_id VARCHAR(20) NOT NULL,
                theme_name VARCHAR(100) NOT NULL DEFAULT 'default',
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uq_guild_themes_guild (guild_id),
                CONSTRAINT fk_guild_themes_guild
                    FOREIGN KEY (guild_id) REFERENCES guilds(_id) ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 15: guild_widget_config
        await db.query(`
            CREATE TABLE IF NOT EXISTS guild_widget_config (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                guild_id VARCHAR(20) NOT NULL,
                widget_id VARCHAR(100) NOT NULL,
                area VARCHAR(100) DEFAULT NULL,
                position INT DEFAULT NULL,
                visible TINYINT(1) DEFAULT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uq_guild_widget (guild_id, widget_id),
                CONSTRAINT fk_gwc_guild FOREIGN KEY (guild_id)
                    REFERENCES guilds(_id) ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 16: guild_media
        await db.query(`
            CREATE TABLE IF NOT EXISTS guild_media (
                id INT NOT NULL AUTO_INCREMENT,
                guild_id VARCHAR(20) NOT NULL,
                uploaded_by VARCHAR(20) NOT NULL,
                filename VARCHAR(255) NOT NULL,
                stored_name VARCHAR(255) NOT NULL,
                mime_type VARCHAR(100) NOT NULL,
                file_size INT UNSIGNED NOT NULL,
                width INT UNSIGNED NULL,
                height INT UNSIGNED NULL,
                alt_text VARCHAR(255) NULL,
                title VARCHAR(255) NULL,
                folder VARCHAR(100) NOT NULL DEFAULT 'general',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_guild_media_guild (guild_id),
                KEY idx_guild_media_folder (guild_id, folder),
                KEY idx_guild_media_mime (guild_id, mime_type),
                CONSTRAINT fk_guild_media_guild
                    FOREIGN KEY (guild_id) REFERENCES guilds(_id) ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 17: frontpage_sections
        await db.query(`
            CREATE TABLE IF NOT EXISTS frontpage_sections (
                id INT NOT NULL AUTO_INCREMENT,
                section_type VARCHAR(50) NOT NULL,
                title VARCHAR(255) NOT NULL,
                position INT NOT NULL DEFAULT 0,
                visible TINYINT(1) NOT NULL DEFAULT 1,
                config JSON NULL,
                css_class VARCHAR(100) NOT NULL DEFAULT '',
                divider_before VARCHAR(50) NOT NULL DEFAULT 'auto',
                custom_html TEXT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_section_type (section_type),
                KEY idx_position (position)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 18: frontend_menu_items
        await db.query(`
            CREATE TABLE IF NOT EXISTS frontend_menu_items (
                id INT NOT NULL AUTO_INCREMENT,
                parent_id INT NULL,
                label VARCHAR(255) NOT NULL,
                url VARCHAR(500) NOT NULL DEFAULT '#',
                icon VARCHAR(100) NULL,
                target VARCHAR(20) NOT NULL DEFAULT '_self',
                position INT NOT NULL DEFAULT 0,
                visible TINYINT(1) NOT NULL DEFAULT 1,
                css_class VARCHAR(100) NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_parent (parent_id),
                KEY idx_position (position),
                CONSTRAINT fk_menu_parent
                    FOREIGN KEY (parent_id) REFERENCES frontend_menu_items(id) ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 19: frontend_footer
        await db.query(`
            CREATE TABLE IF NOT EXISTS frontend_footer_columns (
                id INT NOT NULL AUTO_INCREMENT,
                title VARCHAR(255) NOT NULL,
                col_width VARCHAR(20) NOT NULL DEFAULT 'col-lg-3',
                position INT NOT NULL DEFAULT 0,
                visible TINYINT(1) NOT NULL DEFAULT 1,
                column_type VARCHAR(30) NOT NULL DEFAULT 'links',
                content TEXT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_position (position)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS frontend_footer_links (
                id INT NOT NULL AUTO_INCREMENT,
                column_id INT NOT NULL,
                label VARCHAR(255) NOT NULL,
                url VARCHAR(500) NOT NULL DEFAULT '#',
                icon VARCHAR(100) NULL,
                target VARCHAR(20) NOT NULL DEFAULT '_self',
                position INT NOT NULL DEFAULT 0,
                visible TINYINT(1) NOT NULL DEFAULT 1,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_column (column_id),
                KEY idx_position (position),
                CONSTRAINT fk_footer_link_column
                    FOREIGN KEY (column_id) REFERENCES frontend_footer_columns(id) ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    }
};
