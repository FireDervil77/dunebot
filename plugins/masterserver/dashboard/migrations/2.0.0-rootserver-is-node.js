/**
 * Migration 2.0.0 - RootServer ist der Node (daemon_instances → rootserver)
 *
 * ÄNDERUNGEN:
 * - `rootserver` übernimmt alle Verbindungs- und Status-Felder aus `daemon_instances`
 * - `system_user` wird entfernt (Docker-Modus, kein gs-User mehr)
 * - guild_id UNIQUE-Constraint entfernt (mehrere RootServer/Maschinen pro Guild möglich)
 * - daemon_id ist jetzt direkt in rootserver (kein FK zu daemon_instances mehr)
 * - server_registry.daemon_id FK → rootserver.daemon_id
 * - daemon_instances Tabelle wird gedroppt
 * - daemon_tokens.used_by_daemon_id bleibt (referenziert rootserver.daemon_id logisch)
 */

module.exports = {
    version: '2.0.0',
    description: 'RootServer = Node: daemon_instances in rootserver zusammenführen',

    async up(db) {
        // ── Schritt 1: Neue Felder in rootserver hinzufügen ──────────────────
        await db.query(`
            ALTER TABLE rootserver
                -- Daemon-Connection-Tracking (von daemon_instances)
                ADD COLUMN IF NOT EXISTS session_token TEXT DEFAULT NULL COMMENT 'Rotating session token' AFTER api_key,
                ADD COLUMN IF NOT EXISTS session_token_expires_at TIMESTAMP NULL DEFAULT NULL AFTER session_token,
                ADD COLUMN IF NOT EXISTS daemon_status ENUM('online','offline','error','maintenance') DEFAULT 'offline' COMMENT 'Live-Verbindungsstatus' AFTER install_status,
                ADD COLUMN IF NOT EXISTS daemon_version VARCHAR(20) DEFAULT NULL COMMENT 'Daemon-Version (z.B. 1.0.0)' AFTER daemon_status,
                ADD COLUMN IF NOT EXISTS os_info VARCHAR(255) DEFAULT NULL COMMENT 'Betriebssystem-Info' AFTER daemon_version,
                ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP NULL DEFAULT NULL COMMENT 'Letzter Heartbeat' AFTER os_info,
                ADD COLUMN IF NOT EXISTS last_ping_ms INT DEFAULT NULL COMMENT 'Letzte Ping-Latenz in ms' AFTER last_seen,
                ADD COLUMN IF NOT EXISTS missed_heartbeats INT DEFAULT 0 COMMENT 'Verpasste Heartbeats (Reset bei Erfolg)' AFTER last_ping_ms,
                ADD COLUMN IF NOT EXISTS total_commands INT DEFAULT 0 COMMENT 'Gesendete Commands (gesamt)' AFTER missed_heartbeats,
                ADD COLUMN IF NOT EXISTS total_uptime_seconds BIGINT DEFAULT 0 COMMENT 'Gesamte Uptime in Sekunden' AFTER total_commands,
                ADD COLUMN IF NOT EXISTS last_disconnect TIMESTAMP NULL DEFAULT NULL COMMENT 'Letzter Disconnect' AFTER total_uptime_seconds
        `);

        // ── Schritt 2: system_user NOT NULL → NULL (Übergang) ────────────────
        await db.query(`
            ALTER TABLE rootserver
                MODIFY COLUMN system_user VARCHAR(64) NULL DEFAULT NULL COMMENT '[DEPRECATED] Legacy gs-User, nicht mehr benutzt'
        `);

        // ── Schritt 3: Vorhandene daemon_instances Daten in rootserver kopieren
        // (Status, Version, last_seen etc. auf alle rootserver dieser daemon_id)
        await db.query(`
            UPDATE rootserver rs
            JOIN daemon_instances di ON rs.daemon_id = di.daemon_id
            SET
                rs.daemon_status  = di.status,
                rs.daemon_version = di.version,
                rs.os_info        = di.os_info,
                rs.last_seen      = di.last_heartbeat,
                rs.last_ping_ms   = di.last_ping_latency,
                rs.missed_heartbeats = di.missed_heartbeats,
                rs.total_commands = di.total_commands,
                rs.total_uptime_seconds = di.total_uptime_seconds,
                rs.last_disconnect = di.last_disconnect,
                rs.session_token  = di.session_token,
                rs.session_token_expires_at = di.session_token_expires_at
        `);

        // ── Schritt 4: server_registry FK von daemon_instances auf rootserver umbiegen
        // Erst alten FK droppen
        await db.query(`
            ALTER TABLE server_registry
                DROP FOREIGN KEY IF EXISTS server_registry_ibfk_1
        `).catch(() => {}); // Fehler ignorieren wenn FK anders heißt

        // Alle FKs auf daemon_instances finden und droppen
        const [fks] = await db.query(`
            SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_NAME = 'server_registry'
              AND REFERENCED_TABLE_NAME = 'daemon_instances'
              AND TABLE_SCHEMA = DATABASE()
        `);
        for (const fk of fks) {
            await db.query(`ALTER TABLE server_registry DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``);
        }

        // Neuen FK auf rootserver.daemon_id setzen
        await db.query(`
            ALTER TABLE server_registry
                ADD CONSTRAINT fk_registry_rootserver
                FOREIGN KEY (daemon_id) REFERENCES rootserver(daemon_id) ON DELETE CASCADE
        `);

        // ── Schritt 5: daemon_logs FK-Constraint entfernen (falls vorhanden) ─
        // daemon_logs.daemon_id wird jetzt logisch auf rootserver.daemon_id verweisen
        // (kein DB-Level FK nötig, da daemon_id in daemon_logs nullable ist)

        // ── Schritt 6: daemon_instances Tabelle droppen ───────────────────────
        // (CASCADE: rootserver hat keinen FK mehr dazu)
        await db.query(`DROP TABLE IF EXISTS daemon_instances`);

        // ── Schritt 7: guild_id UNIQUE-Constraint aus rootserver entfernen ────
        // (mehrere RootServer = mehrere Maschinen pro Guild)
        try {
            await db.query(`ALTER TABLE rootserver DROP INDEX unique_guild`);
        } catch (_) {}
        try {
            await db.query(`ALTER TABLE rootserver DROP INDEX idx_guild_unique`);
        } catch (_) {}

        console.log('[Migration 2.0.0] ✅ RootServer-is-Node Migration abgeschlossen');
    },

    async down(db) {
        // Rollback: daemon_instances wiederherstellen
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
                status ENUM('online','offline','error','maintenance') DEFAULT 'offline',
                version VARCHAR(20) DEFAULT NULL,
                os_info VARCHAR(255) DEFAULT NULL,
                last_heartbeat TIMESTAMP NULL DEFAULT NULL,
                last_ping_latency INT DEFAULT NULL,
                missed_heartbeats INT DEFAULT 0,
                total_commands INT DEFAULT 0,
                total_uptime_seconds BIGINT DEFAULT 0,
                last_disconnect TIMESTAMP NULL DEFAULT NULL,
                registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY unique_guild_daemon (guild_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // rootserver daemon_id Daten zurück in daemon_instances kopieren
        await db.query(`
            INSERT IGNORE INTO daemon_instances (daemon_id, guild_id, status, version)
            SELECT daemon_id, guild_id, daemon_status, daemon_version FROM rootserver
        `);

        console.log('[Migration 2.0.0 DOWN] Rollback abgeschlossen');
    }
};
