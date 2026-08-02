'use strict';

/**
 * Ressourcen-Buchung bekommt eine einzige Wahrheit: `gameservers.allocated_*`.
 *
 * Bis heute gab es zwei Orte für dieselbe Zahl und keiner davon trug sie:
 *
 *   | Ort                              | schreibt        | liest                  |
 *   |----------------------------------|-----------------|------------------------|
 *   | gameservers.allocated_ram_mb …   | Anlege-Formular | IPMServer (Registry)   |
 *   | gameserver_quotas.allocated_* …  | niemand         | Ressourcen-Seite       |
 *
 * `gameserver_quotas` hatte im Produktionsbestand null Zeilen — kein einziges
 * INSERT im gesamten Repo. Die Ressourcen-Seite summierte also dauerhaft 0 und
 * meldete 0 % Auslastung, während sechs Gameserver liefen. `quota_history` wurde
 * nie beschrieben und nie gelesen.
 *
 * Beide Tabellen fallen weg. Alles, was Ressourcen bucht, steht ab jetzt in
 * `gameservers` — dort, wo der Anlege-Pfad ohnehin schreibt.
 *
 * Zwei Fehler in den Views werden dabei gleich mit behoben:
 *
 * 1. `rootserver_quotas_effective` hat `overallocate_ram_percent` und
 *    `overallocate_disk_percent` nie selektiert. Die Spalten existieren in
 *    `rootserver_quotas` (bis heute per ALTER TABLE bei jedem Dashboard-Start
 *    angelegt), die Overallocation-Maske schrieb sie auch — nur gelesen wurden
 *    sie nie, weil `RootServer.getQuota()` aus dieser View liest. Der eingegebene
 *    Wert war nach dem Neuladen der Seite wieder weg.
 *
 * 2. `rootserver_resource_summary` rechnete gegen `gameserver_quotas` und ohne
 *    Overallocation. Sie zählt jetzt `gameservers` und rechnet die
 *    Überallokation in die Gesamtkapazität ein.
 *
 * Einheiten: `gameservers.allocated_cpu_percent` zählt Prozent **eines Kerns**
 * (100 = 1 Kern, wie Docker NanoCPUs und cgroup `cpu.max` es verwenden),
 * `rootserver_quotas.*_cpu_cores` zählt Kerne. Die Summe wird deshalb durch 100
 * geteilt.
 *
 * Die Spalten selbst werden hier angelegt, statt sie weiter bei jedem Start per
 * ALTER TABLE nachzuziehen — dasselbe gilt für `rootserver_ips`.
 */
module.exports = {
    description: 'Ressourcen-Buchung auf gameservers.allocated_* vereinheitlichen',

    async up(db) {
        // ── Overallocation-Spalten dauerhaft ins Schema ──────────────────────
        // Standen bisher nur im Startup-Code von dashboard/index.js.
        for (const spalte of [
            ['overallocate_ram_percent',  "INT NOT NULL DEFAULT 0 COMMENT 'RAM-Überallokation in % (0 = keine)'"],
            ['overallocate_disk_percent', "INT NOT NULL DEFAULT 0 COMMENT 'Disk-Überallokation in % (0 = keine)'"],
        ]) {
            const [vorhanden] = await db.query(`
                SELECT COLUMN_NAME FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'rootserver_quotas'
                  AND COLUMN_NAME = ?
            `, [spalte[0]]);
            if (!vorhanden) {
                await db.query(`ALTER TABLE rootserver_quotas ADD COLUMN ${spalte[0]} ${spalte[1]}`);
            }
        }

        // ── rootserver_ips: gehört ins Schema, nicht in den Startup ──────────
        await db.query(`
            CREATE TABLE IF NOT EXISTS rootserver_ips (
                id INT AUTO_INCREMENT PRIMARY KEY,
                rootserver_id INT NOT NULL,
                ip_address VARCHAR(45) NOT NULL,
                label VARCHAR(100) NULL COMMENT 'Optionaler Name z.B. "Game-IP", "Admin-IP"',
                is_primary TINYINT(1) NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT NOW(),
                UNIQUE KEY unique_ip_per_rs (rootserver_id, ip_address),
                FOREIGN KEY (rootserver_id) REFERENCES rootserver(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // ── View 1: effektive Quota eines RootServers, jetzt mit Overallocation ─
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
                rq.overallocate_ram_percent,
                rq.overallocate_disk_percent,
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

        // ── View 2: Auslastung, gezählt aus gameservers ──────────────────────
        // Gesamtkapazität = effektiv * (1 + Überallokation), abzüglich Reserve.
        // Verfügbar = Gesamt - Reserve - bereits vergeben.
        await db.query(`
            CREATE OR REPLACE VIEW rootserver_resource_summary AS
            SELECT
                rs.id AS rootserver_id,
                rs.name AS rootserver_name,
                rs.guild_id,
                FLOOR(rqe.effective_ram_mb  * (1 + COALESCE(rqe.overallocate_ram_percent, 0)  / 100)) AS total_ram_mb,
                rqe.effective_cpu_cores AS total_cpu_cores,
                FLOOR(rqe.effective_disk_gb * (1 + COALESCE(rqe.overallocate_disk_percent, 0) / 100)) AS total_disk_gb,
                rqe.reserved_ram_mb,
                rqe.reserved_cpu_cores,
                rqe.reserved_disk_gb,
                rqe.overallocate_ram_percent,
                rqe.overallocate_disk_percent,
                COALESCE(SUM(gs.allocated_ram_mb), 0)            AS allocated_ram_mb,
                COALESCE(SUM(gs.allocated_cpu_percent), 0) / 100 AS allocated_cpu_cores,
                COALESCE(SUM(gs.allocated_disk_gb), 0)           AS allocated_disk_gb,
                FLOOR(rqe.effective_ram_mb * (1 + COALESCE(rqe.overallocate_ram_percent, 0) / 100))
                    - rqe.reserved_ram_mb - COALESCE(SUM(gs.allocated_ram_mb), 0)            AS available_ram_mb,
                rqe.effective_cpu_cores
                    - rqe.reserved_cpu_cores - COALESCE(SUM(gs.allocated_cpu_percent), 0) / 100 AS available_cpu_cores,
                FLOOR(rqe.effective_disk_gb * (1 + COALESCE(rqe.overallocate_disk_percent, 0) / 100))
                    - rqe.reserved_disk_gb - COALESCE(SUM(gs.allocated_disk_gb), 0)          AS available_disk_gb,
                ROUND(COALESCE(SUM(gs.allocated_ram_mb), 0) / NULLIF(
                    FLOOR(rqe.effective_ram_mb * (1 + COALESCE(rqe.overallocate_ram_percent, 0) / 100))
                    - rqe.reserved_ram_mb, 0) * 100, 2) AS ram_usage_percent,
                ROUND(COALESCE(SUM(gs.allocated_cpu_percent), 0) / 100 / NULLIF(
                    rqe.effective_cpu_cores - rqe.reserved_cpu_cores, 0) * 100, 2) AS cpu_usage_percent,
                ROUND(COALESCE(SUM(gs.allocated_disk_gb), 0) / NULLIF(
                    FLOOR(rqe.effective_disk_gb * (1 + COALESCE(rqe.overallocate_disk_percent, 0) / 100))
                    - rqe.reserved_disk_gb, 0) * 100, 2) AS disk_usage_percent,
                COUNT(gs.id) AS gameserver_count,
                rqe.effective_max_gameservers AS max_gameservers,
                rqe.profile_name,
                rqe.profile_display_name
            FROM rootserver rs
            LEFT JOIN rootserver_quotas_effective rqe ON rs.id = rqe.rootserver_id
            LEFT JOIN gameservers gs ON rs.id = gs.rootserver_id
            GROUP BY rs.id, rs.name, rs.guild_id,
                     rqe.effective_ram_mb, rqe.effective_cpu_cores, rqe.effective_disk_gb,
                     rqe.reserved_ram_mb, rqe.reserved_cpu_cores, rqe.reserved_disk_gb,
                     rqe.overallocate_ram_percent, rqe.overallocate_disk_percent,
                     rqe.effective_max_gameservers, rqe.profile_name, rqe.profile_display_name
        `);

        // ── Die beiden toten Tabellen ───────────────────────────────────────
        // Beide waren im Produktionsbestand leer; es geht nichts verloren.
        await db.query('DROP TABLE IF EXISTS gameserver_quotas');
        await db.query('DROP TABLE IF EXISTS quota_history');
    },

    async down(db) {
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
                INDEX idx_gameserver (gameserver_id),
                INDEX idx_rootserver (rootserver_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS quota_history (
                id INT AUTO_INCREMENT PRIMARY KEY,
                rootserver_id INT NOT NULL,
                changed_by VARCHAR(30) DEFAULT NULL,
                change_type VARCHAR(50) DEFAULT NULL,
                old_value TEXT DEFAULT NULL,
                new_value TEXT DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_rootserver (rootserver_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // Views auf den Stand der Baseline zurückdrehen (ohne Overallocation,
        // gezählt aus gameserver_quotas).
        await db.query(`
            CREATE OR REPLACE VIEW rootserver_quotas_effective AS
            SELECT
                rq.id AS quota_id, rq.rootserver_id, rq.profile_id,
                COALESCE(rq.custom_ram_mb, qp.ram_mb) AS effective_ram_mb,
                COALESCE(rq.custom_cpu_cores, qp.cpu_cores) AS effective_cpu_cores,
                COALESCE(rq.custom_disk_gb, qp.disk_gb) AS effective_disk_gb,
                COALESCE(rq.custom_max_gameservers, qp.max_gameservers) AS effective_max_gameservers,
                rq.reserved_ram_mb, rq.reserved_cpu_cores, rq.reserved_disk_gb,
                rq.custom_ram_mb, rq.custom_cpu_cores, rq.custom_disk_gb, rq.custom_max_gameservers,
                qp.ram_mb AS profile_ram_mb, qp.cpu_cores AS profile_cpu_cores,
                qp.disk_gb AS profile_disk_gb, qp.max_gameservers AS profile_max_gameservers,
                qp.name AS profile_name, qp.display_name AS profile_display_name,
                qp.description AS profile_description,
                rq.created_at, rq.updated_at
            FROM rootserver_quotas rq
            LEFT JOIN quota_profiles qp ON rq.profile_id = qp.id
        `);
        await db.query(`
            CREATE OR REPLACE VIEW rootserver_resource_summary AS
            SELECT
                rs.id AS rootserver_id, rs.name AS rootserver_name, rs.guild_id,
                rqe.effective_ram_mb AS total_ram_mb,
                rqe.effective_cpu_cores AS total_cpu_cores,
                rqe.effective_disk_gb AS total_disk_gb,
                rqe.reserved_ram_mb, rqe.reserved_cpu_cores, rqe.reserved_disk_gb,
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
                rqe.profile_name, rqe.profile_display_name
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
