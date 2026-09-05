'use strict';

/**
 * Timer-Ansagen (P6) - was der Bot von sich aus wiederholt sagt.
 *
 * ## Warum das eine eigene Tabelle ist und nicht ein Feld mehr am Streamer
 *
 * Die Live-Ansage (`streaming_streamers.chat_ansage_text`) ist **eine** Zeile
 * zu **einem** Zeitpunkt: Du gehst live, sie geht hinaus. Eine Timer-Ansage
 * ist eine Menge - Discord, YouTube, Regeln, Spendenlink - und jede hat ihren
 * eigenen Takt. Ein zweites Textfeld am Streamer koennte davon genau eine.
 *
 * ## Was hier NICHT steht, und warum
 *
 * Kein Empfaenger, kein Verlauf, keine Chatzeile. Dieselbe Zusage wie beim
 * Befehlsbaukasten: Von den Nachrichten fremder Menschen bleibt nichts liegen.
 * `gesendet_anzahl` ist eine Summe ohne Person.
 *
 * **Auch kein `zuletzt_zeilen`.** Die Bedingung „nur wenn was los ist" misst
 * an einem Zaehler, der im Arbeitsspeicher des Conduits lebt und mit ihm
 * endet. Eine Datenbankspalte daneben behauptete Dauerhaftigkeit, die der
 * gemessene Wert nicht hat - nach einem Neustart stuende dort eine Zahl, die
 * sich auf einen Zaehler bezieht, den es nicht mehr gibt. Der Vergleichswert
 * liegt deshalb dort, wo auch der Zaehler liegt: im Speicher (`kern/ansagen`).
 * Dieselbe Entscheidung wie bei der Abkuehlung in `kern/befehle`.
 *
 * ## Die Kollation ist keine Formalie
 *
 * `guild_id` muss `utf8mb4_unicode_ci` sein wie `guilds._id` - sonst wirft
 * jeder Vergleich mit dem Kern „Illegal mix of collations". Am 2026-09-05 an
 * der echten Datenbank nachgemessen: `guilds._id`, `streaming_commands`,
 * `streaming_outbox`, `streaming_role_grants`, `streaming_streamers`,
 * `streaming_targets` tragen alle `utf8mb4_unicode_ci`. Siehe
 * `scripts/check-kollationen.js`.
 */

module.exports = {
    name: '20260905_170000_ansagen',
    description: 'Timer-Ansagen: streaming_announcements',

    async up(db) {
        // **Nicht destrukturieren.** `db.query()` liefert die Zeilen direkt;
        // `const [x] = ...` griffe die erste ZEILE und die Waechterabfrage
        // liefe ins Leere.
        const tabellen = await db.query(`
            SELECT TABLE_NAME FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'streaming_announcements'
        `);
        if (tabellen.length) return;

        await db.query(`
            CREATE TABLE streaming_announcements (
                id              INT AUTO_INCREMENT PRIMARY KEY,

                -- Die Heim-Guild. Hier wird die Ansage bedient, und nur hier.
                guild_id        VARCHAR(32) NOT NULL,

                -- Der Kanal, in dessen Chat sie geht. Nicht NULL: Eine Ansage
                -- ohne Kanal haette keinen Ort - anders als ein Befehl, der
                -- fuer jeden Kanal der Guild gelten kann.
                streamer_id     INT NOT NULL,

                -- 500 ist Twitchs Grenze, nicht unsere Vorsicht.
                text            VARCHAR(500) NOT NULL,

                -- In Minuten. Die Untergrenze steht im Modul, nicht hier:
                -- Eine Pruefung in der Anwendung kann sagen WARUM sie gilt.
                intervall_min   INT NOT NULL DEFAULT 25,

                -- „Nur wenn was los ist": So viele Chatzeilen muessen seit der
                -- letzten Ansage gekommen sein. 0 heisst „immer".
                mindest_zeilen  INT NOT NULL DEFAULT 0,

                aktiv           TINYINT(1) NOT NULL DEFAULT 1,

                -- Wird beim VORMERKEN gesetzt, nicht beim Erfolg. Sonst liefe
                -- eine Ansage, die Twitch ablehnt, im Minutentakt wieder an -
                -- dieselbe Regel wie bei der Abkuehlung der Befehle.
                zuletzt_am      DATETIME(3) DEFAULT NULL,

                -- Summe ohne Person.
                gesendet_anzahl INT NOT NULL DEFAULT 0,

                angelegt_von    VARCHAR(32) DEFAULT NULL,
                angelegt_am     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                geaendert_am    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                    ON UPDATE CURRENT_TIMESTAMP(3),

                KEY idx_guild (guild_id),
                KEY idx_streamer (streamer_id),

                -- Der Lauf sucht „aktiv und faellig". Ohne diesen Schluessel
                -- liest er jede Minute die ganze Tabelle.
                KEY idx_faellig (aktiv, zuletzt_am)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    },

    async down(db) {
        // **Die Tabelle bleibt.** Ein Rueckbau des Codes ist kein Grund, die
        // Ansagen zu loeschen, die jemand fuer seinen Chat geschrieben hat -
        // dieselbe Regel wie bei `streaming_commands` und `chat_ansage_text`.
        return;
    }
};
