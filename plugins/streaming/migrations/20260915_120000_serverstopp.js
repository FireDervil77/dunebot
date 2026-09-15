'use strict';

/**
 * Zusatz „Streamserver": Server stoppen, wenn der letzte Streamer offline ist.
 *
 * Baustelle 118, Bauplan `docs/streamer-plugin/17-Streamserver.md`.
 *
 * **`server_id` ist KEIN Fremdschluessel.** Die Zahl kommt vom Anbieter in
 * `ServersteuerungRegistry` (heute das Gameserver-Plugin). Ein Fremdschluessel
 * auf `gameservers` waere eine Beziehung ueber die Plugin-Grenze, und
 * `gameservers.guild_id` hat eine andere Kollation als die Streaming-Tabellen.
 * Faellt ein Server weg, bricht ein faelliger Auftrag mit Begruendung ab.
 *
 * **Die Auswahl steht in einer eigenen Tabelle**, nicht als JSON-Spalte: So
 * beantwortet eine Abfrage "in welchen Einstellungen steht dieser Streamer?",
 * und genau das fragt jedes Streamende.
 *
 * **Vorgaben mit Absicht:** `aktiv = 0` und `modus = 'melden'`. Ohne bewusste
 * Entscheidung des Betreibers wird nichts gestoppt.
 */

module.exports = {
    name: '20260915_120000_serverstopp',
    description: 'streaming_serverstopp + streaming_serverstopp_streamer (Zusatz Streamserver)',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS streaming_serverstopp (
                guild_id      VARCHAR(32)  COLLATE utf8mb4_unicode_ci NOT NULL,
                server_id     INT UNSIGNED NOT NULL,
                aktiv         TINYINT(1)   NOT NULL DEFAULT 0,
                modus         VARCHAR(8)   NOT NULL DEFAULT 'melden',
                nachlauf_min  SMALLINT     NOT NULL DEFAULT 15,
                geaendert_von VARCHAR(32)  DEFAULT NULL,
                geaendert_am  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                           ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (guild_id, server_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS streaming_serverstopp_streamer (
                guild_id      VARCHAR(32)  COLLATE utf8mb4_unicode_ci NOT NULL,
                server_id     INT UNSIGNED NOT NULL,
                streamer_id   INT          NOT NULL,
                PRIMARY KEY (guild_id, server_id, streamer_id),
                KEY idx_streamer (streamer_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS streaming_serverstopp_streamer');
        await db.query('DROP TABLE IF EXISTS streaming_serverstopp');
    }
};
