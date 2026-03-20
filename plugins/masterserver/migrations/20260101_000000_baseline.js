'use strict';

/**
 * BASELINE MIGRATION — Masterserver Plugin
 * Enthält alle bestehenden Masterserver-Tabellen (9 Tabellen + 2 Views).
 */
module.exports = {
    description: 'Baseline: Masterserver Plugin (rootserver, daemon_tokens, daemon_instances, daemon_logs, server_registry, quota_profiles, quota_history, rootserver_quotas, gameserver_quotas, port_allocations + 2 Views)',
    baseline: true,

    async up(db) {

        await db.query(`
            CREATE TABLE IF NOT EXISTS rootserver (
                id INT AUTO_INCREMENT PRIMARY KEY,
                guild_id VARCHAR(30) NOT NULL,
                owner_user_id VARCHAR(30) DEFAULT NULL,
                daemon_id VARCHAR(36) UNIQUE NOT NULL,
                name VARCHAR(100) NOT NULL,
                description TEXT DEFAULT NULL,
                host VARCHAR(255) NOT NULL,
                hostname VARCHAR(255) DEFAULT NULL,
                daemon_port INT NOT NULL DEFAULT 9340,
                port_range_start INT DEFAULT NULL,
                port_range_end INT DEFAULT NULL,
                datacenter VARCHAR(100) DEFAULT NULL,
                country_code CHAR(2) DEFAULT NULL,
                base_directory VARCHAR(512) NOT NULL DEFAULT '/opt/firebot',
                install_status ENUM('pending','installing','completed','failed') DEFAULT 'pending',
                install_log TEXT DEFAULT NULL,
                api_key VARCHAR(255) NOT NULL,
                session_token TEXT DEFAULT NULL,
                session_token_expires_at TIMESTAMP NULL DEFAULT NULL,
                daemon_status ENUM('online','offline','error','maintenance') DEFAULT 'offline',
                daemon_version VARCHAR(20) DEFAULT NULL,
                os_info VARCHAR(255) DEFAULT NULL,
                last_seen TIMESTAMP NULL DEFAULT NULL,
                last_ping_ms INT DEFAULT NULL,
                missed_heartbeats INT DEFAULT 0,
                total_commands INT DEFAULT 0,
                total_uptime_seconds BIGINT DEFAULT 0,
                last_disconnect TIMESTAMP NULL DEFAULT NULL,
                cpu_cores INT DEFAULT NULL,
                cpu_threads INT DEFAULT NULL,
                cpu_model VARCHAR(255) DEFAULT NULL,
                ram_total_gb DECIMAL(10,2) DEFAULT NULL,
                disk_total_gb DECIMAL(10,2) DEFAULT NULL,
                ram_limit_gb DECIMAL(10,2) DEFAULT NULL,
                disk_limit_gb DECIMAL(10,2) DEFAULT NULL,
                cpu_limit_percent INT DEFAULT NULL,
                cpu_usage_percent DECIMAL(5,2) DEFAULT 0.00,
                ram_usage_gb DECIMAL(10,2) DEFAULT 0.00,
                disk_usage_gb DECIMAL(10,2) DEFAULT 0.00,
                last_stats_update TIMESTAMP NULL DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_guild (guild_id),
                INDEX idx_owner (owner_user_id),
                INDEX idx_daemon (daemon_id),
                INDEX idx_status (daemon_status),
                INDEX idx_install (install_status),
                INDEX idx_country (country_code),
                INDEX idx_dc (datacenter)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS daemon_tokens (
                id INT AUTO_INCREMENT PRIMARY KEY,
                token_hash VARCHAR(255) UNIQUE NOT NULL,
                guild_id VARCHAR(30) NOT NULL,
                created_by VARCHAR(20) DEFAULT NULL,
                description VARCHAR(255) DEFAULT NULL,
                expires_at TIMESTAMP NOT NULL,
                used TINYINT(1) DEFAULT 0,
                used_at TIMESTAMP NULL DEFAULT NULL,
                used_by_daemon_id VARCHAR(36) DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_guild (guild_id),
                INDEX idx_expires (expires_at),
                INDEX idx_used (used),
                INDEX idx_token_hash (token_hash)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS daemon_instances (
                id INT AUTO_INCREMENT PRIMARY KEY,
                daemon_id VARCHAR(36) UNIQUE NOT NULL,
                guild_id VARCHAR(30) NOT NULL,
                display_name VARCHAR(100) DEFAULT NULL,
                host_ip VARCHAR(45) DEFAULT NULL,
                host_port INT DEFAULT NULL,
                session_token TEXT DEFAULT NULL,
                session_token_expires_at TIMESTAMP NULL DEFAULT NULL,
                status ENUM('online', 'offline', 'error', 'maintenance') DEFAULT 'offline',
                version VARCHAR(20) DEFAULT NULL,
                os_info VARCHAR(255) DEFAULT NULL,
                last_heartbeat TIMESTAMP NULL DEFAULT NULL,
                last_ping_latency INT DEFAULT NULL,
                missed_heartbeats INT DEFAULT 0,
                total_commands INT DEFAULT 0,
                total_uptime_seconds BIGINT DEFAULT 0,
                registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                last_disconnect TIMESTAMP NULL DEFAULT NULL,
                UNIQUE KEY unique_guild_daemon (guild_id),
                INDEX idx_guild (guild_id),
                INDEX idx_status (status),
                INDEX idx_heartbeat (last_heartbeat),
                INDEX idx_daemon (daemon_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS daemon_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                guild_id VARCHAR(20) NOT NULL,
                daemon_id VARCHAR(36) DEFAULT NULL,
                server_id VARCHAR(36) DEFAULT NULL,
                event_type ENUM('register', 'disconnect', 'command', 'error', 'status_change', 'heartbeat_lost', 'reconnect') NOT NULL,
                level ENUM('debug', 'info', 'warn', 'error') DEFAULT 'info',
                action VARCHAR(50) DEFAULT NULL,
                user_id VARCHAR(20) DEFAULT NULL,
                message TEXT DEFAULT NULL,
                metadata JSON DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_guild (guild_id),
                INDEX idx_daemon (daemon_id),
                INDEX idx_server (server_id),
                INDEX idx_event_type (event_type),
                INDEX idx_level (level),
                INDEX idx_created (created_at),
                INDEX idx_user (user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS server_registry (
                id INT AUTO_INCREMENT PRIMARY KEY,
                server_id VARCHAR(36) UNIQUE NOT NULL,
                guild_id VARCHAR(30) NOT NULL,
                daemon_id VARCHAR(36) NOT NULL,
                server_name VARCHAR(100) NOT NULL,
                server_type VARCHAR(50) NOT NULL,
                plugin_name VARCHAR(100) DEFAULT NULL,
                status ENUM('online', 'offline', 'starting', 'stopping', 'error') DEFAULT 'offline',
                config JSON DEFAULT NULL,
                start_command TEXT DEFAULT NULL,
                stop_command TEXT DEFAULT NULL,
                restart_command TEXT DEFAULT NULL,
                status_command TEXT DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                last_start TIMESTAMP NULL DEFAULT NULL,
                last_stop TIMESTAMP NULL DEFAULT NULL,
                INDEX idx_guild (guild_id),
                INDEX idx_daemon (daemon_id),
                INDEX idx_server_type (server_type),
                INDEX idx_status (status),
                INDEX idx_plugin (plugin_name),
                FOREIGN KEY (daemon_id) REFERENCES rootserver(daemon_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS quota_profiles (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(50) NOT NULL,
                display_name VARCHAR(100) NOT NULL,
                description TEXT DEFAULT NULL,
                ram_mb INT NOT NULL,
                cpu_cores INT NOT NULL,
                disk_gb INT NOT NULL,
                max_gameservers INT DEFAULT NULL,
                is_default BOOLEAN DEFAULT FALSE,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY idx_name (name),
                CHECK (ram_mb > 0),
                CHECK (cpu_cores > 0),
                CHECK (disk_gb > 0)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS quota_history (
                id INT AUTO_INCREMENT PRIMARY KEY,
                entity_type ENUM('rootserver', 'gameserver', 'profile') NOT NULL,
                entity_id INT NOT NULL,
                field_name VARCHAR(50) NOT NULL,
                old_value VARCHAR(100) DEFAULT NULL,
                new_value VARCHAR(100) NOT NULL,
                changed_by_user_id VARCHAR(30) DEFAULT NULL,
                change_reason TEXT DEFAULT NULL,
                metadata JSON DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_entity (entity_type, entity_id, created_at),
                INDEX idx_user (changed_by_user_id),
                INDEX idx_field (field_name),
                INDEX idx_created (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS rootserver_quotas (
                id INT AUTO_INCREMENT PRIMARY KEY,
                rootserver_id INT NOT NULL,
                profile_id INT NULL,
                custom_ram_mb INT NULL,
                custom_cpu_cores INT NULL,
                custom_disk_gb INT NULL,
                custom_max_gameservers INT NULL,
                reserved_ram_mb INT NOT NULL DEFAULT 2048,
                reserved_cpu_cores INT NOT NULL DEFAULT 1,
                reserved_disk_gb INT NOT NULL DEFAULT 50,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY idx_rootserver (rootserver_id),
                FOREIGN KEY (rootserver_id) REFERENCES rootserver(id) ON DELETE CASCADE,
                FOREIGN KEY (profile_id) REFERENCES quota_profiles(id) ON DELETE SET NULL,
                CHECK (reserved_ram_mb >= 0),
                CHECK (reserved_cpu_cores >= 0),
                CHECK (reserved_disk_gb >= 0)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // View: rootserver_quotas_effective
        await db.query(`
            CREATE OR REPLACE VIEW rootserver_quotas_effective AS
            SELECT
                rq.id AS quota_id,
                rq.rootserver_id,
                rq.profile_id,
                COALESCE(rq.custom_ram_mb, qp.ram_mb) AS effective_ram_mb,
                COALESCE(rq.custom_cpu_cores, qp.cpu_cores) AS effective_cpu_cores,
                COALESCE(rq.custom_disk_gb, qp.disk_gb) AS effective_disk_gb,
                COALESCE(rq.custom_max_gameservers, qp.max_gameservers) AS effective_max_gameservers,
                rq.reserved_ram_mb,
                rq.reserved_cpu_cores,
                rq.reserved_disk_gb,
                rq.custom_ram_mb,
                rq.custom_cpu_cores,
                rq.custom_disk_gb,
                rq.custom_max_gameservers,
                qp.ram_mb AS profile_ram_mb,
                qp.cpu_cores AS profile_cpu_cores,
                qp.disk_gb AS profile_disk_gb,
                qp.max_gameservers AS profile_max_gameservers,
                qp.name AS profile_name,
                qp.display_name AS profile_display_name,
                qp.description AS profile_description,
                rq.created_at,
                rq.updated_at
            FROM rootserver_quotas rq
            LEFT JOIN quota_profiles qp ON rq.profile_id = qp.id
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS gameserver_quotas (
                id INT AUTO_INCREMENT PRIMARY KEY,
                gameserver_id INT NOT NULL,
                rootserver_id INT NOT NULL,
                allocated_ram_mb INT NOT NULL DEFAULT 2048,
                allocated_cpu_cores INT NOT NULL DEFAULT 1,
                allocated_disk_gb INT NOT NULL DEFAULT 10,
                current_ram_usage_mb INT DEFAULT 0,
                current_cpu_usage_percent DECIMAL(5,2) DEFAULT 0.00,
                current_disk_usage_gb DECIMAL(10,2) DEFAULT 0.00,
                last_usage_update TIMESTAMP NULL DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY idx_gameserver (gameserver_id),
                INDEX idx_rootserver (rootserver_id),
                FOREIGN KEY (rootserver_id) REFERENCES rootserver(id) ON DELETE CASCADE,
                CHECK (allocated_ram_mb > 0),
                CHECK (allocated_cpu_cores > 0),
                CHECK (allocated_disk_gb > 0),
                CHECK (current_ram_usage_mb >= 0),
                CHECK (current_cpu_usage_percent >= 0 AND current_cpu_usage_percent <= 100),
                CHECK (current_disk_usage_gb >= 0)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS port_allocations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                rootserver_id INT NOT NULL,
                ip VARCHAR(45) NOT NULL,
                ip_alias VARCHAR(255) DEFAULT NULL,
                port INT NOT NULL,
                server_id INT DEFAULT NULL,
                notes VARCHAR(256) DEFAULT NULL,
                assigned_at TIMESTAMP NULL DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uk_rootserver_ip_port (rootserver_id, ip, port),
                INDEX idx_rootserver (rootserver_id),
                INDEX idx_server (server_id),
                INDEX idx_available (rootserver_id, server_id),
                FOREIGN KEY (rootserver_id) REFERENCES rootserver(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // View: rootserver_resource_summary
        await db.query(`
            CREATE OR REPLACE VIEW rootserver_resource_summary AS
            SELECT
                rs.id AS rootserver_id,
                rs.name AS rootserver_name,
                rs.guild_id,
                rqe.effective_ram_mb AS total_ram_mb,
                rqe.effective_cpu_cores AS total_cpu_cores,
                rqe.effective_disk_gb AS total_disk_gb,
                rqe.reserved_ram_mb,
                rqe.reserved_cpu_cores,
                rqe.reserved_disk_gb,
                COALESCE(SUM(gq.allocated_ram_mb), 0) AS allocated_ram_mb,
                COALESCE(SUM(gq.allocated_cpu_cores), 0) AS allocated_cpu_cores,
                COALESCE(SUM(gq.allocated_disk_gb), 0) AS allocated_disk_gb,
                rqe.effective_ram_mb - rqe.reserved_ram_mb - COALESCE(SUM(gq.allocated_ram_mb), 0) AS available_ram_mb,
                rqe.effective_cpu_cores - rqe.reserved_cpu_cores - COALESCE(SUM(gq.allocated_cpu_cores), 0) AS available_cpu_cores,
                rqe.effective_disk_gb - rqe.reserved_disk_gb - COALESCE(SUM(gq.allocated_disk_gb), 0) AS available_disk_gb,
                ROUND((COALESCE(SUM(gq.allocated_ram_mb), 0) / (rqe.effective_ram_mb - rqe.reserved_ram_mb)) * 100, 2) AS ram_usage_percent,
                ROUND((COALESCE(SUM(gq.allocated_cpu_cores), 0) / (rqe.effective_cpu_cores - rqe.reserved_cpu_cores)) * 100, 2) AS cpu_usage_percent,
                ROUND((COALESCE(SUM(gq.allocated_disk_gb), 0) / (rqe.effective_disk_gb - rqe.reserved_disk_gb)) * 100, 2) AS disk_usage_percent,
                COUNT(gq.id) AS gameserver_count,
                rqe.effective_max_gameservers AS max_gameservers,
                rqe.profile_name,
                rqe.profile_display_name
            FROM rootserver rs
            LEFT JOIN rootserver_quotas_effective rqe ON rs.id = rqe.rootserver_id
            LEFT JOIN gameserver_quotas gq ON rs.id = gq.rootserver_id
            GROUP BY rs.id, rs.name, rs.guild_id,
                     rqe.effective_ram_mb, rqe.effective_cpu_cores, rqe.effective_disk_gb,
                     rqe.reserved_ram_mb, rqe.reserved_cpu_cores, rqe.reserved_disk_gb,
                     rqe.effective_max_gameservers, rqe.profile_name, rqe.profile_display_name
        `);
    }
};
