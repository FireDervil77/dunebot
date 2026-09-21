'use strict';

/**
 * CPU wird nur noch von **laufenden** Servern belegt (Baustelle 54).
 *
 * Befund des Betreibers vom 2026-08-17: „Wenn ich einen Server mit voller CPU
 * erstelle und einen zweiten anlegen will, habe ich keine CPU mehr — obwohl der
 * erste aus ist." Bestätigt: `rootserver_resource_summary` summiert
 * `allocated_cpu_percent` über **alle** Server, ohne Statusfilter, und
 * `checkResourceAvailability` weist die Neuanlage daraufhin ab.
 *
 * Entschieden am 2026-09-21: **allein bei der CPU** wird nur gezählt, was läuft.
 *
 * ── Warum nur die CPU ────────────────────────────────────────────────────────
 *
 * Die drei Ressourcen verhalten sich nicht gleich:
 *
 *   | | belegt ein ausgeschalteter Server? | überbuchbar? |
 *   |---|---|---|
 *   | Platte | ja — die Spieldateien liegen da | nein, voll ist voll |
 *   | RAM    | nein | gefährlich — Überbuchung endet im OOM-Killer |
 *   | CPU    | nein | ja, harmlos — der Scheduler teilt |
 *
 * Wer pauschal „nur laufende Server zählen" umsetzt, macht die Plattenrechnung
 * kaputt und lädt beim RAM einen OOM ein. Deshalb bleiben `allocated_ram_mb`
 * und `allocated_disk_gb` unangetastet.
 *
 * ── Warum neue Spalten statt geänderter Bedeutung ───────────────────────────
 *
 * Die bestehenden `allocated_cpu_cores` / `available_cpu_cores` behalten ihre
 * Bedeutung: **gebucht insgesamt**. Das ist die Zahl, die die Ressourcen-Seite
 * braucht, um „du hast 6 von 8 Kernen verplant" zu sagen. Daneben treten
 * `*_running`: das, was eine Neuanlage wirklich blockiert. Zwei Namen für zwei
 * Fragen — nicht zwei Wahrheiten für dieselbe.
 *
 * ── Welche Zustände als „läuft" gelten ──────────────────────────────────────
 *
 * ENUM in `gameservers.status`: installing, installed, starting, online,
 * stopping, offline, error, updating.
 *
 *   belegt CPU:      installing, starting, online, stopping, updating
 *   belegt nicht:    installed, offline, error
 *
 * `installing` und `updating` zählen mit, weil dort ein Container läuft —
 * SteamCMD verbraucht CPU unter demselben Limit wie das Spiel. `error` zählt
 * **nicht**: ein Server im Fehlerzustand läuft nicht, und ihn mitzuzählen würde
 * eine Neuanlage wegen eines kaputten Nachbarn blockieren. Das ist eine
 * Entscheidung, keine Messung — wenn ein Container im Fehlerzustand doch weiter
 * CPU zieht, gehört `error` in die Liste.
 */
module.exports = {
    description: 'CPU-Buchung zählt nur laufende Server (B54) — neue Spalten in rootserver_resource_summary',

    async up(db) {
        // Der Ausdruck steht zweimal in der View (Summe und Restbetrag). Ihn als
        // Konstante zu führen ist hier die einzige Möglichkeit, ihn nicht
        // auseinanderdriften zu lassen — eine View kennt kein WITH auf sich
        // selbst, und MySQL lässt einen Alias in derselben SELECT-Liste nicht
        // wiederverwenden.
        const LAUFEND = `COALESCE(SUM(CASE WHEN gs.status IN ('installing','starting','online','stopping','updating')
                                          THEN gs.allocated_cpu_percent ELSE 0 END), 0) / 100`;

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
                ${LAUFEND}                                       AS allocated_cpu_cores_running,
                FLOOR(rqe.effective_ram_mb * (1 + COALESCE(rqe.overallocate_ram_percent, 0) / 100))
                    - rqe.reserved_ram_mb - COALESCE(SUM(gs.allocated_ram_mb), 0)            AS available_ram_mb,
                rqe.effective_cpu_cores
                    - rqe.reserved_cpu_cores - COALESCE(SUM(gs.allocated_cpu_percent), 0) / 100 AS available_cpu_cores,
                rqe.effective_cpu_cores
                    - rqe.reserved_cpu_cores - ${LAUFEND}                                     AS available_cpu_cores_running,
                FLOOR(rqe.effective_disk_gb * (1 + COALESCE(rqe.overallocate_disk_percent, 0) / 100))
                    - rqe.reserved_disk_gb - COALESCE(SUM(gs.allocated_disk_gb), 0)          AS available_disk_gb,
                ROUND(COALESCE(SUM(gs.allocated_ram_mb), 0)
                    / NULLIF(FLOOR(rqe.effective_ram_mb * (1 + COALESCE(rqe.overallocate_ram_percent, 0) / 100))
                             - rqe.reserved_ram_mb, 0) * 100, 2) AS ram_usage_percent,
                ROUND(COALESCE(SUM(gs.allocated_cpu_percent), 0) / 100
                    / NULLIF(rqe.effective_cpu_cores - rqe.reserved_cpu_cores, 0) * 100, 2) AS cpu_usage_percent,
                ROUND(${LAUFEND}
                    / NULLIF(rqe.effective_cpu_cores - rqe.reserved_cpu_cores, 0) * 100, 2) AS cpu_usage_percent_running,
                ROUND(COALESCE(SUM(gs.allocated_disk_gb), 0)
                    / NULLIF(FLOOR(rqe.effective_disk_gb * (1 + COALESCE(rqe.overallocate_disk_percent, 0) / 100))
                             - rqe.reserved_disk_gb, 0) * 100, 2) AS disk_usage_percent,
                COUNT(gs.id) AS gameserver_count,
                COALESCE(SUM(CASE WHEN gs.status IN ('installing','starting','online','stopping','updating')
                                  THEN 1 ELSE 0 END), 0) AS gameserver_count_running,
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
    },

    async down(db) {
        // Zurück auf den Stand von 20260802_101500 — dieselbe View ohne die
        // drei `*_running`-Spalten.
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
                ROUND(COALESCE(SUM(gs.allocated_ram_mb), 0)
                    / NULLIF(FLOOR(rqe.effective_ram_mb * (1 + COALESCE(rqe.overallocate_ram_percent, 0) / 100))
                             - rqe.reserved_ram_mb, 0) * 100, 2) AS ram_usage_percent,
                ROUND(COALESCE(SUM(gs.allocated_cpu_percent), 0) / 100
                    / NULLIF(rqe.effective_cpu_cores - rqe.reserved_cpu_cores, 0) * 100, 2) AS cpu_usage_percent,
                ROUND(COALESCE(SUM(gs.allocated_disk_gb), 0)
                    / NULLIF(FLOOR(rqe.effective_disk_gb * (1 + COALESCE(rqe.overallocate_disk_percent, 0) / 100))
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
    }
};
