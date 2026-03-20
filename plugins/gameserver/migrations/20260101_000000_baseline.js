'use strict';

/**
 * BASELINE MIGRATION — Gameserver Plugin
 * Enthält alle bestehenden Gameserver-Tabellen (8 Tabellen).
 * Abhängig von: masterserver (rootserver-Tabelle für Foreign Keys)
 */
module.exports = {
    description: 'Baseline: Gameserver Plugin (addon_marketplace, ratings, comments, favorites, versions, gameservers, crash_logs, image_builds)',
    baseline: true,

    async up(db) {

        await db.query(`
            CREATE TABLE IF NOT EXISTS addon_marketplace (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                slug VARCHAR(50) NOT NULL UNIQUE,
                description TEXT,
                author_user_id VARCHAR(20) NOT NULL,
                visibility ENUM('official', 'public', 'unlisted', 'private') DEFAULT 'public',
                status ENUM('draft', 'pending_review', 'approved', 'rejected') DEFAULT 'draft',
                trust_level ENUM('unverified', 'verified', 'trusted', 'official') DEFAULT 'unverified',
                game_data JSON NOT NULL,
                category ENUM('fps', 'survival', 'sandbox', 'mmorpg', 'racing', 'strategy', 'horror', 'scifi', 'other') DEFAULT 'other',
                tags JSON,
                version VARCHAR(20) DEFAULT '1.0.0',
                steam_app_id INT NULL,
                steam_server_app_id INT NULL,
                image_url VARCHAR(255) NULL,
                image_hash VARCHAR(64) NULL,
                install_count INT DEFAULT 0,
                rating_avg DECIMAL(3,2) DEFAULT 0.00,
                rating_count INT DEFAULT 0,
                icon_url VARCHAR(255),
                banner_url VARCHAR(255),
                screenshots JSON,
                changelog TEXT,
                guild_id VARCHAR(20) NULL,
                is_fork BOOLEAN DEFAULT FALSE,
                forked_from INT UNSIGNED NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                published_at TIMESTAMP NULL,
                INDEX idx_author (author_user_id),
                INDEX idx_visibility (visibility),
                INDEX idx_status (status),
                INDEX idx_category (category),
                INDEX idx_rating (rating_avg DESC),
                INDEX idx_trust_level (trust_level),
                INDEX idx_steam_app (steam_app_id),
                INDEX idx_guild (guild_id),
                CONSTRAINT check_private_guild CHECK (visibility != 'private' OR guild_id IS NOT NULL),
                CONSTRAINT check_rating_range CHECK (rating_avg >= 0.00 AND rating_avg <= 5.00),
                FOREIGN KEY (forked_from) REFERENCES addon_marketplace(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS addon_ratings (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                addon_id INT UNSIGNED NOT NULL,
                user_id VARCHAR(20) NOT NULL,
                rating INT NOT NULL,
                review TEXT NULL,
                helpful_count INT DEFAULT 0,
                usage_hours DECIMAL(10,2) DEFAULT 0.00,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_addon (addon_id),
                INDEX idx_user (user_id),
                INDEX idx_rating (rating),
                INDEX idx_helpful (helpful_count DESC),
                UNIQUE KEY unique_addon_user (addon_id, user_id),
                CONSTRAINT check_rating_range CHECK (rating >= 1 AND rating <= 5),
                FOREIGN KEY (addon_id) REFERENCES addon_marketplace(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS addon_comments (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                addon_id INT UNSIGNED NOT NULL,
                user_id VARCHAR(20) NOT NULL,
                parent_id INT UNSIGNED NULL,
                comment TEXT NOT NULL,
                is_deleted BOOLEAN DEFAULT FALSE,
                deleted_by VARCHAR(20) NULL,
                deleted_at TIMESTAMP NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_addon (addon_id),
                INDEX idx_user (user_id),
                INDEX idx_parent (parent_id),
                INDEX idx_created (created_at DESC),
                FOREIGN KEY (addon_id) REFERENCES addon_marketplace(id) ON DELETE CASCADE,
                FOREIGN KEY (parent_id) REFERENCES addon_comments(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS addon_favorites (
                user_id VARCHAR(20) NOT NULL,
                addon_id INT UNSIGNED NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, addon_id),
                INDEX idx_user (user_id),
                INDEX idx_addon (addon_id),
                FOREIGN KEY (addon_id) REFERENCES addon_marketplace(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS addon_versions (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                addon_id INT UNSIGNED NOT NULL,
                version VARCHAR(20) NOT NULL,
                game_data JSON NOT NULL,
                changelog TEXT,
                is_latest BOOLEAN DEFAULT FALSE,
                published_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_addon (addon_id),
                INDEX idx_version (version),
                INDEX idx_latest (is_latest),
                UNIQUE KEY unique_addon_version (addon_id, version),
                FOREIGN KEY (addon_id) REFERENCES addon_marketplace(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS gameservers (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                guild_id VARCHAR(20) NOT NULL,
                user_id VARCHAR(20) NOT NULL,
                addon_marketplace_id INT UNSIGNED NOT NULL,
                template_name VARCHAR(50) NULL,
                name VARCHAR(100) NOT NULL,
                rootserver_id INT DEFAULT NULL,
                install_path VARCHAR(255) NULL,
                install_progress INT DEFAULT 0,
                status ENUM('installing', 'installed', 'starting', 'online', 'stopping', 'offline', 'error', 'updating') DEFAULT 'installing',
                last_status_update DATETIME NULL,
                error_message TEXT NULL,
                addon_version VARCHAR(20) NOT NULL,
                update_available BOOLEAN DEFAULT FALSE,
                latest_version VARCHAR(20) NULL,
                frozen_game_data JSON NOT NULL,
                env_variables JSON NOT NULL,
                ports JSON NOT NULL,
                launch_params TEXT NULL,
                pid INT NULL,
                current_players INT DEFAULT 0,
                max_players INT,
                current_map VARCHAR(100) NULL,
                total_uptime_seconds BIGINT DEFAULT 0,
                total_players_connected BIGINT DEFAULT 0,
                last_started_at DATETIME NULL,
                last_stopped_at DATETIME NULL,
                auto_restart BOOLEAN DEFAULT TRUE,
                auto_update BOOLEAN DEFAULT FALSE,
                last_backup_at DATETIME NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_guild (guild_id),
                INDEX idx_user (user_id),
                INDEX idx_addon (addon_marketplace_id),
                INDEX idx_status (status),
                INDEX idx_rootserver (rootserver_id),
                INDEX idx_update_available (update_available),
                FOREIGN KEY (guild_id) REFERENCES guilds(_id) ON DELETE CASCADE,
                FOREIGN KEY (addon_marketplace_id) REFERENCES addon_marketplace(id) ON DELETE RESTRICT,
                FOREIGN KEY (rootserver_id) REFERENCES rootserver(id) ON DELETE SET NULL ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS gameserver_crash_logs (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                server_id INT UNSIGNED NOT NULL,
                daemon_id VARCHAR(100) NOT NULL,
                error_message TEXT NOT NULL,
                timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_server_id (server_id),
                INDEX idx_daemon_id (daemon_id),
                INDEX idx_timestamp (timestamp),
                FOREIGN KEY (server_id) REFERENCES gameservers(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS addon_image_builds (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                session_id VARCHAR(36) UNIQUE NOT NULL,
                admin_user_id VARCHAR(20) NOT NULL,
                status ENUM('preparing', 'building', 'testing', 'snapshotting', 'completed', 'failed') DEFAULT 'preparing',
                container_id VARCHAR(64) NULL,
                vnc_port INT NULL,
                ssh_port INT NULL,
                web_terminal_url VARCHAR(255) NULL,
                detected_config JSON NULL,
                image_url VARCHAR(255) NULL,
                image_hash VARCHAR(64) NULL,
                game_data JSON NULL,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP NULL,
                INDEX idx_admin (admin_user_id),
                INDEX idx_status (status),
                INDEX idx_session (session_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    }
};
