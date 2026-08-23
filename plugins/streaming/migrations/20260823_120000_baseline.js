'use strict';

/**
 * Streaming - Grundbestand.
 *
 * Sieben Tabellen, und die Trennung zwischen ihnen ist die eigentliche
 * Entscheidung: **der Streamer ist global, das Ziel gehoert der Guild.**
 *
 * Wenn 200 Server denselben Kanal beobachten, darf es trotzdem nur EIN
 * Abonnement bei der Plattform geben - Twitch erlaubt hoechstens drei mit
 * gleichem Typ und gleicher Bedingung. Ein Abo je Guild ist technisch
 * unmoeglich, nicht nur verschwenderisch.
 *
 * `streaming_events` ist der Posteingang: Was ankommt, wird zuerst hier
 * abgelegt, dann wird geantwortet, und erst danach verarbeitet. Der
 * eindeutige Schluessel auf der Nachrichtenkennung IST die
 * Dublettenerkennung - kein Zwischenspeicher, der einen Neustart nicht
 * ueberlebt.
 *
 * `streaming_outbox` ist das Gegenstueck nach aussen: Ein grosser Streamer
 * geht live, 300 Guilds wollen gleichzeitig posten, und Discord laesst 50
 * Anfragen je Sekunde zu. Das braucht eine Warteschlange, die einen Neustart
 * ueberlebt - also eine Tabelle, kein Objekt im Speicher.
 *
 * Die Papiere dazu: docs/streamer-plugin/01-Schichten-und-Vertraege.md
 */

module.exports = {
    description: 'Streaming: Streamer, Ziele, Abos, Zustand, Posteingang, Ausgang, Nachrichten',

    async up(db) {
        // ---------------------------------------------------------------
        // GLOBAL - die geteilte Ressource
        // ---------------------------------------------------------------

        // Heute steht hier ein Kanalname. Spaeter haengt ein Konto daran
        // (`besitzer_id`) - deshalb ein eigener Datensatz und keine Zeile in
        // der Guild-Konfiguration. Das kostet jetzt nichts und erspart den
        // Umbau, bei dem man sonst das halbe Plugin anfasst.
        await db.query(`
            CREATE TABLE IF NOT EXISTS streaming_streamers (
                id            INT AUTO_INCREMENT PRIMARY KEY,
                plattform     VARCHAR(16)  NOT NULL,
                kanal_id      VARCHAR(64)  NOT NULL,
                login         VARCHAR(64)  NOT NULL,
                anzeigename   VARCHAR(128) DEFAULT NULL,
                avatar_url    VARCHAR(512) DEFAULT NULL,
                besitzer_id   VARCHAR(32)  DEFAULT NULL,
                angelegt_am   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                geprueft_am   DATETIME     DEFAULT NULL,
                UNIQUE KEY uniq_kanal (plattform, kanal_id),
                KEY idx_login (plattform, login)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // Ein Abo je Kanal und Ereignis. `geheimnis` ist je Abo eigen: ein
        // verlorenes Geheimnis kostet dann ein Abo, nicht alle.
        await db.query(`
            CREATE TABLE IF NOT EXISTS streaming_subscriptions (
                id                INT AUTO_INCREMENT PRIMARY KEY,
                streamer_id       INT          NOT NULL,
                ereignis          VARCHAR(48)  NOT NULL,
                anbieter_abo_id   VARCHAR(64)  DEFAULT NULL,
                geheimnis         VARCHAR(128) NOT NULL,
                zustand           VARCHAR(32)  NOT NULL DEFAULT 'angefragt',
                kosten            SMALLINT     NOT NULL DEFAULT 1,
                letzte_meldung_am DATETIME     DEFAULT NULL,
                fehlertext        VARCHAR(255) DEFAULT NULL,
                angelegt_am       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_abo (streamer_id, ereignis),
                CONSTRAINT fk_abo_streamer FOREIGN KEY (streamer_id)
                    REFERENCES streaming_streamers(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // Das Herz. Hieran haengen alle schwierigen Faelle: keine
        // Doppel-Pings nach einem Abriss, Aufraeumen nach Streamende,
        // Neustart ueberstehen. Wer das nachtraeglich einbaut, baut das
        // Plugin neu.
        await db.query(`
            CREATE TABLE IF NOT EXISTS streaming_state (
                streamer_id         INT          NOT NULL PRIMARY KEY,
                ist_live            TINYINT(1)   NOT NULL DEFAULT 0,
                sendung_id          VARCHAR(64)  DEFAULT NULL,
                begonnen_am         DATETIME     DEFAULT NULL,
                beendet_am          DATETIME     DEFAULT NULL,
                titel               VARCHAR(255) DEFAULT NULL,
                kategorie           VARCHAR(128) DEFAULT NULL,
                vorschaubild        VARCHAR(512) DEFAULT NULL,
                zuschauer           INT          DEFAULT NULL,
                zuletzt_gemeldet_am DATETIME     DEFAULT NULL,
                angereichert_am     DATETIME     DEFAULT NULL,
                CONSTRAINT fk_zustand_streamer FOREIGN KEY (streamer_id)
                    REFERENCES streaming_streamers(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // Posteingang. `uniq_msg` ist die Dublettenerkennung: Ein zweiter
        // Einfuegeversuch scheitert, und genau daran erkennt der Eingang die
        // Wiederholung. Twitch stellt ausdruecklich "mindestens einmal" zu.
        await db.query(`
            CREATE TABLE IF NOT EXISTS streaming_events (
                id              BIGINT AUTO_INCREMENT PRIMARY KEY,
                plattform       VARCHAR(16)  NOT NULL,
                anbieter_msg_id VARCHAR(128) NOT NULL,
                ereignis        VARCHAR(48)  DEFAULT NULL,
                empfangen_am    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                nutzlast        JSON         NOT NULL,
                zustand         VARCHAR(16)  NOT NULL DEFAULT 'neu',
                versuche        SMALLINT     NOT NULL DEFAULT 0,
                fehlertext      VARCHAR(512) DEFAULT NULL,
                verarbeitet_am  DATETIME(3)  DEFAULT NULL,
                UNIQUE KEY uniq_msg (plattform, anbieter_msg_id),
                KEY idx_offen (zustand, empfangen_am)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // ---------------------------------------------------------------
        // PRO GUILD - die Einrichtung
        // ---------------------------------------------------------------

        // `onair_channel` ist der Sprachkanal, den der Streamer selbst
        // angelegt hat und in dem er mit seinen Mitspielern sitzt. Der Bot
        // ueberwacht ihn NICHT - er verweist nur darauf.
        await db.query(`
            CREATE TABLE IF NOT EXISTS streaming_targets (
                id               INT AUTO_INCREMENT PRIMARY KEY,
                guild_id         VARCHAR(32)  NOT NULL,
                streamer_id      INT          NOT NULL,
                channel_id       VARCHAR(32)  NOT NULL,
                rolle_id         VARCHAR(32)  DEFAULT NULL,
                onair_channel    VARCHAR(32)  DEFAULT NULL,
                vorlage          TEXT         DEFAULT NULL,
                filter_spiel     VARCHAR(255) DEFAULT NULL,
                filter_titel     VARCHAR(255) DEFAULT NULL,
                aufraeumen       VARCHAR(16)  NOT NULL DEFAULT 'bearbeiten',
                eigenes_bild     VARCHAR(512) DEFAULT NULL,
                veroeffentlichen TINYINT(1)   NOT NULL DEFAULT 0,
                aktiv            TINYINT(1)   NOT NULL DEFAULT 1,
                angelegt_von     VARCHAR(32)  DEFAULT NULL,
                angelegt_am      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_ziel (guild_id, streamer_id, channel_id),
                KEY idx_guild (guild_id),
                CONSTRAINT fk_ziel_streamer FOREIGN KEY (streamer_id)
                    REFERENCES streaming_streamers(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // Ohne diese Tabelle gibt es kein Aufraeumen: Man kann eine Nachricht
        // nur bearbeiten, wenn man weiss, welche es war. `webhook_id` bleibt
        // vorerst leer - sie haelt den Platz fuer den zweiten Ausgabeweg
        // (eigener Name und Avatar, Stufe 9b) frei.
        await db.query(`
            CREATE TABLE IF NOT EXISTS streaming_messages (
                id           BIGINT AUTO_INCREMENT PRIMARY KEY,
                target_id    INT          NOT NULL,
                sendung_id   VARCHAR(64)  NOT NULL,
                channel_id   VARCHAR(32)  NOT NULL,
                message_id   VARCHAR(32)  DEFAULT NULL,
                webhook_id   VARCHAR(32)  DEFAULT NULL,
                gesendet_am  DATETIME     DEFAULT NULL,
                geaendert_am DATETIME     DEFAULT NULL,
                zustand      VARCHAR(16)  NOT NULL DEFAULT 'offen',
                UNIQUE KEY uniq_nachricht (target_id, sendung_id),
                CONSTRAINT fk_nachricht_ziel FOREIGN KEY (target_id)
                    REFERENCES streaming_targets(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // Ausgang. Entkoppelt die Antwort an die Plattform von der Arbeit
        // gegen Discord - und ueberlebt einen Neustart mitten im Schwall.
        await db.query(`
            CREATE TABLE IF NOT EXISTS streaming_outbox (
                id          BIGINT AUTO_INCREMENT PRIMARY KEY,
                target_id   INT          DEFAULT NULL,
                guild_id    VARCHAR(32)  NOT NULL,
                aktion      VARCHAR(24)  NOT NULL,
                nutzlast    JSON         NOT NULL,
                faellig_ab  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                versuche    SMALLINT     NOT NULL DEFAULT 0,
                zustand     VARCHAR(16)  NOT NULL DEFAULT 'offen',
                fehlertext  VARCHAR(512) DEFAULT NULL,
                angelegt_am DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                KEY idx_faellig (zustand, faellig_ab)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    },

    async down(db) {
        // Reihenfolge zaehlt wegen der Fremdschluessel.
        for (const tabelle of [
            'streaming_outbox',
            'streaming_messages',
            'streaming_targets',
            'streaming_events',
            'streaming_state',
            'streaming_subscriptions',
            'streaming_streamers'
        ]) {
            await db.query(`DROP TABLE IF EXISTS ${tabelle}`);
        }
    }
};
