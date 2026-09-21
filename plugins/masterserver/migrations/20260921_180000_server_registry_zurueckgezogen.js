'use strict';

/**
 * `server_registry` wird zurückgezogen (Baustelle 146).
 *
 * ── Der Befund ───────────────────────────────────────────────────────────────
 *
 * Die Tabelle hatte **null Zeilen**, und im ganzen Repo gab es **kein einziges
 * `INSERT INTO server_registry`** — gemessen am 2026-09-21. Jedes `UPDATE` dorthin
 * traf 0 Zeilen, seit jeher. Das betraf vier Dinge, die alle wie gemessen aussahen:
 *
 *   · `status`, `last_heartbeat`        vom Herzschlag geschrieben, nie angekommen
 *   · `cpu_percent`, `ram_used_mb`,
 *     `ram_total_mb`                    eigens per Migration angelegt (2026-04-03)
 *   · `current_players`                 dito
 *
 * Und zwei sichtbare Folgen, die niemand mit der Tabelle verbunden hat:
 *
 *   · Die Kachel „Gameserver" auf der Masterserver-Übersicht stand auf **0**,
 *     weil `RootServer.getStats()` sie von hier zählte (gemessen: 0 statt 2).
 *   · Die Rootserver-Detailseite zeigte CPU und RAM je Gameserver leer, ebenso
 *     die Ressourcen-Seite.
 *
 * **Ein `UPDATE`, das 0 Zeilen trifft, ist in MySQL kein Fehler** — keine
 * Warnung, nichts im Protokoll. Dieselbe Bauart wie `gameserver_quotas` am
 * 2026-08-02: *„null Zeilen, kein einziges INSERT im gesamten Repo, die
 * Ressourcen-Seite summierte dauerhaft 0."* Fünf Wochen später dieselbe Falle.
 *
 * ── Warum zurückziehen und nicht wiederbeleben ──────────────────────────────
 *
 * Betreiber am 2026-09-21: *„wir müssen solche Altlasten und umständlichen
 * Doppelbauten einfach irgendwann loslassen. so lange das nix beschädigt."*
 *
 * Wiederbeleben hätte bedeutet: ein `INSERT … ON DUPLICATE KEY` im Herzschlag,
 * und danach die Frage, **wann eine Zeile wieder verschwindet** — sonst wächst
 * die Tabelle um jeden Server, den es einmal gab. Dazu eine zweite Wahrheit über
 * denselben Server, mit `varchar(36)` gegen `int` als Verbindung.
 *
 * `gameservers` hat eine Zeile je Server, sie verschwindet mit dem Server, und
 * dort stehen schon Messungen desselben Daemons über dieselbe Leitung:
 * `bereitschaft_*` (seit 2026-09-08) und `platz_*` (seit heute).
 *
 * ── Dass nichts beschädigt wird, ist gemessen, nicht gehofft ────────────────
 *
 *   · **Null Zeilen** → beim Löschen geht kein Datum verloren.
 *   · **Kein Fremdschlüssel zeigt auf die Tabelle** (nur einer von ihr weg, auf
 *     `rootserver.daemon_id`). Nichts hängt daran.
 *   · **Keine View** benutzt sie (`information_schema.VIEWS` durchsucht).
 *   · **Kein Trigger** auf ihr (die zwei Trigger der Anlage hängen an
 *     `guild_user_groups`).
 *   · **Der Daemon kennt sie nicht** — `grep server_registry` über alle
 *     `.go`-Dateien: kein Treffer. Achtung, die Verwechslung liegt nahe: Der
 *     Daemon bekommt beim Anmelden eine Liste namens `serverRegistry`, die aber
 *     aus `gameservers` gebaut wird (`IPMServer.js:503`). Gleicher Name, andere
 *     Sache.
 *   · Alle vier Leser im Dashboard sind in derselben Runde umgestellt.
 */
module.exports = {
    description: 'server_registry zurückgezogen — Live-Messwerte nach gameservers (B146)',

    async up(db) {
        // ── 1. Die Messwerte bekommen ihren Platz in `gameservers` ───────────
        const [da] = await db.query(
            `SELECT COUNT(*) AS n
               FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'gameservers'
                AND COLUMN_NAME = 'cpu_percent'`
        );

        if (!da || Number(da.n) === 0) {
            // `current_players` und `max_players` stehen schon in `gameservers` —
            // die wandern nicht mit, sie sind längst dort.
            await db.query(`
                ALTER TABLE gameservers
                    ADD COLUMN cpu_percent DECIMAL(5,2) NULL DEFAULT NULL
                        COMMENT 'Letzte Messung des Daemons, in Prozent eines Kerns',
                    ADD COLUMN ram_used_mb INT NULL DEFAULT NULL
                        COMMENT 'Letzte Messung des Daemons',
                    ADD COLUMN ram_total_mb INT NULL DEFAULT NULL
                        COMMENT 'Grenze, die der Container kennt (aus dem Daemon)',
                    ADD COLUMN last_heartbeat DATETIME NULL DEFAULT NULL
                        COMMENT 'Wann der Herzschlag zuletzt Messwerte zu diesem Server brachte'
            `);
        }

        // ── 2. Die Tabelle weg ───────────────────────────────────────────────
        //
        // Ohne Sicherung, und das ist hier kein Leichtsinn: Sie hat null Zeilen.
        // Was es nicht gibt, kann man nicht retten — und eine leere Kopie
        // anzulegen wäre genau der „umständliche Doppelbau", um den es geht.
        await db.query('DROP TABLE IF EXISTS server_registry');
    },

    async down(db) {
        // Die Tabelle in der Form der Baseline plus der Spalten, die sie am
        // 2026-04-03 und am 2026-09-21 dazubekam — LEER, denn leer war sie.
        await db.query(`
            CREATE TABLE IF NOT EXISTS server_registry (
                id INT AUTO_INCREMENT PRIMARY KEY,
                server_id VARCHAR(36) NOT NULL UNIQUE,
                guild_id VARCHAR(30) NOT NULL,
                daemon_id VARCHAR(36) NOT NULL,
                server_name VARCHAR(100) NOT NULL,
                server_type VARCHAR(50) NOT NULL,
                plugin_name VARCHAR(100) DEFAULT NULL,
                status ENUM('online','offline','starting','stopping','error') DEFAULT 'offline',
                current_players INT DEFAULT 0,
                last_heartbeat TIMESTAMP NULL DEFAULT NULL,
                config LONGTEXT DEFAULT NULL,
                start_command TEXT DEFAULT NULL,
                stop_command TEXT DEFAULT NULL,
                restart_command TEXT DEFAULT NULL,
                status_command TEXT DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                last_start TIMESTAMP NULL DEFAULT NULL,
                last_stop TIMESTAMP NULL DEFAULT NULL,
                cpu_percent DECIMAL(5,2) DEFAULT NULL,
                ram_used_mb INT DEFAULT NULL,
                ram_total_mb INT DEFAULT NULL,
                INDEX idx_daemon (daemon_id),
                INDEX idx_guild (guild_id),
                CONSTRAINT fk_registry_rootserver FOREIGN KEY (daemon_id)
                    REFERENCES rootserver (daemon_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        const [da] = await db.query(
            `SELECT COUNT(*) AS n
               FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'gameservers'
                AND COLUMN_NAME = 'cpu_percent'`
        );
        if (da && Number(da.n) > 0) {
            await db.query(`
                ALTER TABLE gameservers
                    DROP COLUMN cpu_percent,
                    DROP COLUMN ram_used_mb,
                    DROP COLUMN ram_total_mb,
                    DROP COLUMN last_heartbeat
            `);
        }
    }
};
