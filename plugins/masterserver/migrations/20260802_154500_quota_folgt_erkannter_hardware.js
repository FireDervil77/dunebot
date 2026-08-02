'use strict';

/**
 * Die Kapazität eines RootServers folgt der erkannten Hardware.
 *
 * Bisher schrieb `ensureQuota()` die vom Daemon gemeldeten Werte einmalig nach
 * `rootserver_quotas.custom_*` — und dort blieben sie stehen. Wer RAM nachrüstet,
 * dessen Dashboard rechnete weiter mit dem alten Stand; der Daemon meldet zwar
 * korrekt 64 GB, die Quota kannte nur die 32 vom Tag der Einrichtung.
 *
 * Zugleich hiess die Spalte "custom", enthielt aber nichts, was jemand
 * eingestellt hatte. Es war nicht unterscheidbar, ob ein Wert bewusst gesetzt
 * oder automatisch übernommen wurde.
 *
 * Ab jetzt gilt die Reihenfolge:
 *
 *   1. `custom_*`          — nur was jemand ausdrücklich abweichend festlegt
 *   2. erkannte Hardware   — was der Daemon meldet (der Normalfall)
 *   3. Profilwert          — Rückfall, solange kein Daemon verbunden war
 *
 * Damit muss niemand Zahlen eintragen, um die Ressourcenverwaltung zu benutzen:
 * Sobald der Daemon einmal verbunden war, stimmt die Kapazität von selbst und
 * bleibt aktuell.
 *
 * Die Reserven (`reserved_*`) und die Überallokation bleiben unberührt — das ist
 * echte Nutzereingabe und soll nicht von der Hardware überschrieben werden.
 */
module.exports = {
    description: 'Quota folgt der vom Daemon erkannten Hardware statt eingefrorener Werte',

    async up(db) {
        // ── Automatisch übernommene Werte wieder freigeben ───────────────────
        // Nur dort, wo `custom_*` exakt dem entspricht, was `ensureQuota()` aus
        // den Hardware-Daten gerechnet hätte. Wer eigene Zahlen eingetragen hat,
        // behält sie: Eine Abweichung von auch nur einem MB gilt als Absicht.
        const [{ betroffen }] = await db.query(`
            SELECT COUNT(*) AS betroffen
            FROM rootserver_quotas rq
            JOIN rootserver rs ON rs.id = rq.rootserver_id
            WHERE rq.custom_ram_mb    = ROUND(rs.ram_total_gb * 1024)
              AND rq.custom_cpu_cores = rs.cpu_cores
              AND rq.custom_disk_gb   = ROUND(rs.disk_total_gb)
        `);

        await db.query(`
            UPDATE rootserver_quotas rq
            JOIN rootserver rs ON rs.id = rq.rootserver_id
            SET rq.custom_ram_mb    = NULL,
                rq.custom_cpu_cores = NULL,
                rq.custom_disk_gb   = NULL
            WHERE rq.custom_ram_mb    = ROUND(rs.ram_total_gb * 1024)
              AND rq.custom_cpu_cores = rs.cpu_cores
              AND rq.custom_disk_gb   = ROUND(rs.disk_total_gb)
        `);

        // ── View: Hardware als zweite Stufe ──────────────────────────────────
        // `rootserver_quotas_effective` kannte bisher nur custom und Profil. Die
        // Hardware steht in `rootserver`, deshalb kommt der Join dazu.
        await db.query(`
            CREATE OR REPLACE VIEW rootserver_quotas_effective AS
            SELECT
                rq.id AS quota_id,
                rq.rootserver_id,
                rq.profile_id,
                COALESCE(rq.custom_ram_mb,    ROUND(rs.ram_total_gb * 1024), qp.ram_mb)    AS effective_ram_mb,
                COALESCE(rq.custom_cpu_cores, rs.cpu_cores,                  qp.cpu_cores) AS effective_cpu_cores,
                COALESCE(rq.custom_disk_gb,   ROUND(rs.disk_total_gb),       qp.disk_gb)   AS effective_disk_gb,
                COALESCE(rq.custom_max_gameservers, qp.max_gameservers) AS effective_max_gameservers,
                -- Woher der Wert stammt, damit die Oberfläche es benennen kann
                CASE
                    WHEN rq.custom_ram_mb IS NOT NULL      THEN 'eingestellt'
                    WHEN rs.ram_total_gb  IS NOT NULL      THEN 'erkannt'
                    ELSE 'profil'
                END AS ram_herkunft,
                CASE
                    WHEN rq.custom_cpu_cores IS NOT NULL   THEN 'eingestellt'
                    WHEN rs.cpu_cores        IS NOT NULL   THEN 'erkannt'
                    ELSE 'profil'
                END AS cpu_herkunft,
                CASE
                    WHEN rq.custom_disk_gb IS NOT NULL     THEN 'eingestellt'
                    WHEN rs.disk_total_gb  IS NOT NULL     THEN 'erkannt'
                    ELSE 'profil'
                END AS disk_herkunft,
                rs.last_stats_update AS hardware_stand,
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
            LEFT JOIN rootserver rs     ON rs.id = rq.rootserver_id
            LEFT JOIN quota_profiles qp ON rq.profile_id = qp.id
        `);

        return { hinweis: `${betroffen} Quota(s) folgen jetzt der erkannten Hardware` };
    },

    async down(db) {
        // Werte wieder festschreiben, damit der alte View-Stand rechnen kann
        await db.query(`
            UPDATE rootserver_quotas rq
            JOIN rootserver rs ON rs.id = rq.rootserver_id
            SET rq.custom_ram_mb    = COALESCE(rq.custom_ram_mb,    ROUND(rs.ram_total_gb * 1024)),
                rq.custom_cpu_cores = COALESCE(rq.custom_cpu_cores, rs.cpu_cores),
                rq.custom_disk_gb   = COALESCE(rq.custom_disk_gb,   ROUND(rs.disk_total_gb))
        `);

        await db.query(`
            CREATE OR REPLACE VIEW rootserver_quotas_effective AS
            SELECT
                rq.id AS quota_id, rq.rootserver_id, rq.profile_id,
                COALESCE(rq.custom_ram_mb, qp.ram_mb) AS effective_ram_mb,
                COALESCE(rq.custom_cpu_cores, qp.cpu_cores) AS effective_cpu_cores,
                COALESCE(rq.custom_disk_gb, qp.disk_gb) AS effective_disk_gb,
                COALESCE(rq.custom_max_gameservers, qp.max_gameservers) AS effective_max_gameservers,
                rq.reserved_ram_mb, rq.reserved_cpu_cores, rq.reserved_disk_gb,
                rq.overallocate_ram_percent, rq.overallocate_disk_percent,
                rq.custom_ram_mb, rq.custom_cpu_cores, rq.custom_disk_gb, rq.custom_max_gameservers,
                qp.ram_mb AS profile_ram_mb, qp.cpu_cores AS profile_cpu_cores,
                qp.disk_gb AS profile_disk_gb, qp.max_gameservers AS profile_max_gameservers,
                qp.name AS profile_name, qp.display_name AS profile_display_name,
                qp.description AS profile_description,
                rq.created_at, rq.updated_at
            FROM rootserver_quotas rq
            LEFT JOIN quota_profiles qp ON rq.profile_id = qp.id
        `);
    }
};
