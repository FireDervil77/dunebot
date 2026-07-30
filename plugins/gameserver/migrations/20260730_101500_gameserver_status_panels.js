'use strict';

/**
 * Discord-Status-Panels je Gameserver (E4).
 *
 * Ein Panel ist eine Discord-Nachricht, die das Dashboard aktuell hält. Der
 * Eintrag hier ist gleichzeitig die Einwilligung: Ohne Zeile geht kein Push an
 * den Bot, und der Bot erfährt vom Server nichts. Deshalb pro Server und Kanal
 * ein Eintrag statt einer Guild-Einstellung "zeige alle Server" – welche Server
 * öffentlich sichtbar sind, ist eine Entscheidung und keine Vorgabe.
 *
 * `last_hash` und `last_pushed_at` sind die beiden Bremsen gegen Discords
 * Rate-Limits: kein Edit ohne Änderung, und nie zwei Edits näher als
 * `min_interval_s` beieinander.
 */
module.exports = {
    description: 'gameserver-status-panels',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS gameserver_status_panels (
                id             INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                guild_id       VARCHAR(20)  NOT NULL,
                server_id      INT UNSIGNED NOT NULL,
                channel_id     VARCHAR(20)  NOT NULL,
                message_id     VARCHAR(20)  NULL COMMENT 'NULL = noch nicht gepostet',
                enabled        BOOLEAN      NOT NULL DEFAULT TRUE,
                min_interval_s INT UNSIGNED NOT NULL DEFAULT 60
                               COMMENT 'Mindestabstand zwischen zwei Discord-Edits',
                show_players   BOOLEAN      NOT NULL DEFAULT FALSE
                               COMMENT 'Spielernamen sind personenbezogen - Default aus',
                show_controls  BOOLEAN      NOT NULL DEFAULT TRUE
                               COMMENT 'Start/Stop/Neu laden als Buttons',
                last_hash      VARCHAR(64)  NULL COMMENT 'Hash der angezeigten Felder',
                last_pushed_at DATETIME     NULL,
                last_error     TEXT         NULL COMMENT 'Warum der letzte Push scheiterte',
                created_by     VARCHAR(20)  NULL COMMENT 'Discord-User-ID',
                created_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
                updated_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                -- Ein Server darf in mehreren Kanaelen haengen (z.B. oeffentlich
                -- ohne Namen, intern mit), aber nicht zweimal im selben Kanal.
                UNIQUE KEY uniq_server_channel (server_id, channel_id),
                INDEX idx_guild   (guild_id),
                INDEX idx_enabled (enabled),
                FOREIGN KEY (server_id) REFERENCES gameservers(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS gameserver_status_panels');
    }
};
