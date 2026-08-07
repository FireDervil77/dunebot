'use strict';

/**
 * Grundgeruest des Musik-Plugins.
 *
 * Die laufende Warteschlange liegt bewusst NICHT in der Datenbank: sie haengt
 * an der Sprachverbindung des Bots und ist mit ihr zu Ende. Persistent sind
 * nur die Dinge, die einen Neustart ueberdauern sollen - Einstellungen,
 * Verlauf und gespeicherte Wiedergabelisten.
 */

module.exports = {
    description: 'Musik-Plugin: Einstellungen, Verlauf und Wiedergabelisten',

    async up(db) {
        // --- Einstellungen je Guild ---
        await db.query(`
            CREATE TABLE IF NOT EXISTS music_settings (
                guild_id            VARCHAR(32)  NOT NULL PRIMARY KEY,
                dj_role_id          VARCHAR(32)  DEFAULT NULL,
                default_volume      TINYINT      NOT NULL DEFAULT 50,
                -- 0 heisst unbegrenzt
                max_queue_size      SMALLINT     NOT NULL DEFAULT 0,
                max_track_seconds   INT          NOT NULL DEFAULT 0,
                allowed_voice       TEXT         DEFAULT NULL,
                announce_channel    VARCHAR(32)  DEFAULT NULL,
                announce_now_playing TINYINT(1)  NOT NULL DEFAULT 1,
                leave_when_empty    TINYINT(1)   NOT NULL DEFAULT 1,
                leave_after_seconds SMALLINT     NOT NULL DEFAULT 120,
                allow_youtube       TINYINT(1)   NOT NULL DEFAULT 1,
                allow_soundcloud    TINYINT(1)   NOT NULL DEFAULT 1,
                allow_spotify       TINYINT(1)   NOT NULL DEFAULT 1,
                allow_direct        TINYINT(1)   NOT NULL DEFAULT 1,
                -- Dauerbetrieb: der Bot bleibt auch ohne Zuhoerer im Kanal
                mode_247            TINYINT(1)   NOT NULL DEFAULT 0,
                mode_247_channel    VARCHAR(32)  DEFAULT NULL,
                -- Weiterspielen, wenn die Warteschlange leer laeuft
                autoplay            TINYINT(1)   NOT NULL DEFAULT 0,
                -- Klangfilter: aus, bassboost, nightcore, vaporwave, ...
                audio_filter        VARCHAR(32)  NOT NULL DEFAULT 'aus',
                -- Tonqualitaet: 0 niedrig, 1 mittel, 2 hoch
                audio_quality       TINYINT      NOT NULL DEFAULT 2,
                -- Ueberspringen per Abstimmung, wenn keine DJ-Rolle greift
                vote_skip_enabled   TINYINT(1)   NOT NULL DEFAULT 1,
                vote_skip_percent   TINYINT      NOT NULL DEFAULT 50,
                embed_color         VARCHAR(9)   NOT NULL DEFAULT '#1DB954',
                created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                                 ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // --- Was tatsaechlich gelaufen ist ---
        await db.query(`
            CREATE TABLE IF NOT EXISTS music_history (
                id            INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
                guild_id      VARCHAR(32)  NOT NULL,
                title         VARCHAR(512) NOT NULL,
                url           VARCHAR(1024) NOT NULL,
                source        VARCHAR(32)  NOT NULL,
                duration_sec  INT          DEFAULT NULL,
                thumbnail     VARCHAR(1024) DEFAULT NULL,
                requested_by  VARCHAR(32)  DEFAULT NULL,
                voice_channel VARCHAR(32)  DEFAULT NULL,
                played_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_guild_zeit (guild_id, played_at),
                INDEX idx_guild_quelle (guild_id, source)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // --- Gespeicherte Wiedergabelisten ---
        await db.query(`
            CREATE TABLE IF NOT EXISTS music_playlists (
                id          INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
                guild_id    VARCHAR(32)  NOT NULL,
                name        VARCHAR(128) NOT NULL,
                description VARCHAR(512) DEFAULT NULL,
                created_by  VARCHAR(32)  DEFAULT NULL,
                created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                         ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_guild_name (guild_id, name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS music_playlist_tracks (
                id           INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
                playlist_id  INT          NOT NULL,
                title        VARCHAR(512) NOT NULL,
                url          VARCHAR(1024) NOT NULL,
                source       VARCHAR(32)  NOT NULL,
                duration_sec INT          DEFAULT NULL,
                thumbnail    VARCHAR(1024) DEFAULT NULL,
                position     SMALLINT     NOT NULL DEFAULT 0,
                added_by     VARCHAR(32)  DEFAULT NULL,
                created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_liste (playlist_id, position),
                CONSTRAINT fk_music_playlist FOREIGN KEY (playlist_id)
                    REFERENCES music_playlists (id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    },

    async down(db) {
        // Umgekehrte Reihenfolge wegen des Fremdschluessels
        await db.query('DROP TABLE IF EXISTS music_playlist_tracks');
        await db.query('DROP TABLE IF EXISTS music_playlists');
        await db.query('DROP TABLE IF EXISTS music_history');
        await db.query('DROP TABLE IF EXISTS music_settings');
    }
};
