'use strict';

/**
 * Status-Snapshot je Gameserver.
 *
 * Bisher gab es keine persistierte Wahrheit über den Live-Zustand: die
 * GameDig-Query lief nur im Browser der Detailseite, und gameservers.current_players
 * wurde ausschließlich aus Daemon-Stats gefüllt, die das Feld nie befüllen.
 * Der Snapshot ist ab jetzt die gemeinsame Quelle für Dashboard, Discord und API.
 *
 * Eigene Tabelle statt weiterer Spalten in gameservers: der Poller schreibt im
 * 10-300s-Takt, das soll die Haupttabelle nicht belasten.
 */
module.exports = {
    description: 'gameserver-status-snapshot',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS gameserver_status (
                server_id       INT UNSIGNED NOT NULL PRIMARY KEY,
                guild_id        VARCHAR(20)  NOT NULL,
                online          BOOLEAN      NOT NULL DEFAULT FALSE,
                players_current INT          NULL,
                players_max     INT          NULL,
                map             VARCHAR(100) NULL,
                version         VARCHAR(50)  NULL,
                ping_ms         INT          NULL,
                players_json    JSON         NULL COMMENT 'Normalisierte Spielerliste',
                extra_json      JSON         NULL COMMENT 'Spielspezifische Zusatzfelder/Badges',
                source          ENUM('query','rcon','merged','none') NOT NULL DEFAULT 'none',
                query_ok        BOOLEAN      NOT NULL DEFAULT FALSE,
                rcon_ok         BOOLEAN      NULL COMMENT 'NULL = noch nie versucht',
                last_error      TEXT         NULL,
                fail_count      INT          NOT NULL DEFAULT 0 COMMENT 'Für Backoff des Pollers',
                queried_at      DATETIME     NULL,
                updated_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_guild      (guild_id),
                INDEX idx_queried_at (queried_at),
                FOREIGN KEY (server_id) REFERENCES gameservers(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS gameserver_status');
    }
};
