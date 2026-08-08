'use strict';

/**
 * Die laufende Warteschlange ueberdauert jetzt einen Neustart.
 *
 * **Das dreht eine Entscheidung der Baseline um.** Dort steht ausdruecklich,
 * die laufende Warteschlange gehoere nicht in die Datenbank, weil sie an der
 * Sprachverbindung haengt und mit ihr zu Ende sei. Im Betrieb war das die
 * falsche Abwaegung: nach jedem Bot-Neustart und nach jedem Verbindungsabriss
 * war eine muehsam zusammengestellte Liste weg, und niemand baut sie ein
 * zweites Mal zusammen.
 *
 * Zwei Tabellen statt einer:
 *
 * - `music_sessions` haelt, was zur Sitzung gehoert - welcher Sprachkanal,
 *   wohin Ansagen gehen, Lautstaerke, Wiederholung, Klangfilter und wie weit
 *   der laufende Titel war.
 * - `music_queue` haelt die Titel. Der gerade laufende steht mit
 *   `position = -1` darin, die wartenden ab 0. So braucht es keine zweite
 *   Tabelle nur fuer den einen Titel, und die Reihenfolge bleibt an einer
 *   Stelle.
 *
 * `url` ist bewusst NULL-faehig: Titel aus Spotify tragen nur einen
 * Suchbegriff und bekommen ihre Adresse erst, wenn sie an der Reihe sind.
 */

module.exports = {
    description: 'Musik: laufende Warteschlange und Sitzung sichern',

    async up(db) {
        await db.query(`
            CREATE TABLE IF NOT EXISTS music_sessions (
                guild_id      VARCHAR(32)  NOT NULL PRIMARY KEY,
                voice_channel VARCHAR(32)  NOT NULL,
                text_channel  VARCHAR(32)  DEFAULT NULL,
                volume        SMALLINT     NOT NULL DEFAULT 50,
                repeat_mode   VARCHAR(8)   NOT NULL DEFAULT 'aus',
                audio_filter  VARCHAR(32)  NOT NULL DEFAULT 'aus',
                autoplay      TINYINT(1)   NOT NULL DEFAULT 0,
                mode_247      TINYINT(1)   NOT NULL DEFAULT 0,
                position_sec  INT          NOT NULL DEFAULT 0,
                updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                           ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS music_queue (
                id           INT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
                guild_id     VARCHAR(32)   NOT NULL,
                position     SMALLINT      NOT NULL DEFAULT 0,
                title        VARCHAR(512)  NOT NULL,
                url          VARCHAR(1024) DEFAULT NULL,
                source       VARCHAR(32)   NOT NULL,
                duration_sec INT           DEFAULT NULL,
                thumbnail    VARCHAR(1024) DEFAULT NULL,
                artist       VARCHAR(255)  DEFAULT NULL,
                suchbegriff  VARCHAR(512)  DEFAULT NULL,
                herkunft_url VARCHAR(1024) DEFAULT NULL,
                requested_by VARCHAR(32)   DEFAULT NULL,
                INDEX idx_guild_pos (guild_id, position),
                CONSTRAINT fk_music_queue_session FOREIGN KEY (guild_id)
                    REFERENCES music_sessions (guild_id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    },

    async down(db) {
        // Umgekehrte Reihenfolge wegen des Fremdschluessels
        await db.query('DROP TABLE IF EXISTS music_queue');
        await db.query('DROP TABLE IF EXISTS music_sessions');
    }
};
