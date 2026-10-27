'use strict';

/**
 * Datenbanken der Spiele (Stufe 11 S3, 2026-10-27).
 *
 * Je Zeile eine Datenbank im Container fb-datenbank des Rootservers. Den Namen
 * (`s<server>_<nr>`) bildet der Daemon; hier steht, was er geantwortet hat.
 *
 * Das Kennwort liegt verschlüsselt (Entscheidung D4 = a, 2026-10-27): Die
 * Platzhalter `{{db:password}}` (S5) müssen es in die Spielkonfiguration
 * schreiben können — ein Hash ginge dafür nicht. Dieselbe Verschlüsselung wie
 * die Zugänge der Plattformen (helpers/utils.encrypt, TOKEN_ENCRYPTION_KEY).
 *
 * KEIN Fremdschlüssel auf gameservers: Ein CASCADE löschte die Zeile mit dem
 * Server, die Datenbank im Container bliebe stehen und niemand wüsste mehr von
 * ihr. Ein RESTRICT ließe das Löschen des Servers scheitern. Das Löschen mit
 * dem Server räumt beides ab (S4); bis dahin findet `db.liste` Reste.
 */
module.exports = {
    description: 'gameserver-datenbanken',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS gameserver_datenbanken (
                id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
                server_id     INT UNSIGNED NOT NULL,
                guild_id      VARCHAR(20)  NOT NULL COMMENT 'Wie bei den Inhalten: Filter ohne JOIN',
                nr            TINYINT UNSIGNED NOT NULL COMMENT 'laufende Nummer je Server, 1-99',
                name          VARCHAR(32)  NOT NULL COMMENT 'vom Daemon: s<server>_<nr>, Datenbank und Konto',
                kennwort_ver  TEXT         NOT NULL COMMENT 'verschluesselt (utils.encrypt), nie im Klartext',
                bytes         BIGINT UNSIGNED NULL DEFAULT NULL COMMENT 'zuletzt gemessene Groesse, NULL = nie gemessen',
                groesse_am    DATETIME     NULL DEFAULT NULL,
                created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uq_server_nr (server_id, nr),
                UNIQUE KEY uq_name (name),
                KEY idx_guild (guild_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
              COMMENT='Datenbanken der Spiele im Container fb-datenbank (Stufe 11)'
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS gameserver_datenbanken');
    }
};
