'use strict';

/**
 * Der Befehlsbaukasten (Stufe 15).
 *
 * ## Die Rechtsfrage, die keine war
 *
 * Die Entwurfsseite trug bis zum 2026-09-05 eine Sperre: „Erst die
 * Rechtsfrage, dann der Baukasten — ein Befehlsauswerter liest Nachrichten
 * fremder Menschen."
 *
 * **Der Betreiber hat sie aufgeloest, und zwar zutreffend:** Zwischen Twitch
 * und dem Streamer besteht die Autorisierung bereits; wir bauen die nutzbare
 * Plattform darauf. Was die Sperre wirklich schuetzte, war das SPEICHERN — und
 * das passiert hier nicht. Der Auswerter sieht den Text im Arbeitsspeicher,
 * antwortet und vergisst ihn. In diese Tabelle kommt nur, was der STREAMER
 * selbst schreibt: sein Wort und seine Antwort.
 *
 * Deshalb gibt es hier auch keine Spalte fuer den Absender, keine fuer den
 * Nachrichtentext und keinen Verlauf. `benutzt_anzahl` ist eine Summe ohne
 * Person — sie beantwortet „lohnt dieser Befehl?", nicht „wer hat gefragt?".
 *
 * ## Warum an der Guild und nicht am Streamer
 *
 * Anders als die Live-Ansage (die in EINEN fremden Chat geht und deshalb am
 * Streamer haengt): Befehle richtet der Betreiber einer Guild fuer seinen
 * eigenen Kanal ein — die Heim-Guild. Ein Kanal hat genau eine
 * (`heim_guild_id`), also kann es keine zwei Guilds geben, die sich um
 * `!regeln` streiten.
 *
 * `streamer_id` steht trotzdem dabei und darf `NULL` sein: `NULL` heisst „gilt
 * fuer jeden Kanal dieser Guild". Solange eine Guild einen Heim-Kanal hat, ist
 * das dasselbe — aber es zwingt uns nicht, die Tabelle anzufassen, wenn es
 * einmal mehr werden.
 */

module.exports = {
    name: '20260905_100000_befehle',
    description: 'Befehlsbaukasten: streaming_commands',

    async up(db) {
        // **Nicht destrukturieren.** `db.query()` liefert die Zeilen direkt.
        const tabellen = await db.query(`
            SELECT TABLE_NAME FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'streaming_commands'
        `);
        if (tabellen.length) return;

        await db.query(`
            CREATE TABLE streaming_commands (
                id             INT AUTO_INCREMENT PRIMARY KEY,
                guild_id       VARCHAR(32) NOT NULL,
                streamer_id    INT DEFAULT NULL,

                -- Ohne das Praefix. Der Baukasten kennt genau ein Zeichen ('!'),
                -- und es steht im Auswerter, nicht in jeder Zeile.
                wort           VARCHAR(32) NOT NULL,

                -- 'eigen'  = Antwort steht in der Spalte antwort
                -- 'fertig' = eingebaut (!uptime, !spiel, !discord); die Zeile
                --            ist dann nur der Schalter, antwort bleibt leer
                art            VARCHAR(16) NOT NULL DEFAULT 'eigen',

                -- 500 Zeichen ist Twitchs Grenze, nicht unsere Wahl. Ein
                -- laengeres Feld naehme Texte an, die beim Senden abgeschnitten
                -- werden.
                antwort        VARCHAR(500) DEFAULT NULL,

                -- 'alle' | 'abonnent' | 'moderator' | 'inhaber'
                wer            VARCHAR(16) NOT NULL DEFAULT 'alle',

                -- Abkuehlung in Sekunden. Ohne sie macht ein einziger Zuschauer
                -- aus einem Befehl eine Textwand — und die Ratengrenze gilt je
                -- Konto ueber alle Kanaele.
                abkuehlung_s   INT NOT NULL DEFAULT 5,

                aktiv          TINYINT(1) NOT NULL DEFAULT 1,

                -- Summe ohne Person: beantwortet "lohnt der Befehl?", nicht
                -- "wer hat gefragt?".
                benutzt_anzahl INT NOT NULL DEFAULT 0,
                benutzt_am     DATETIME(3) DEFAULT NULL,

                angelegt_von   VARCHAR(32) DEFAULT NULL,
                angelegt_am    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                geaendert_am   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                   ON UPDATE CURRENT_TIMESTAMP(3),

                -- Ein Wort kann es je Guild und Kanal nur einmal geben. Ohne
                -- diesen Schluessel entstuenden zwei Zeilen fuer '!regeln', und
                -- welche antwortet, entschiede die Sortierung.
                UNIQUE KEY uniq_wort (guild_id, streamer_id, wort),
                KEY idx_guild (guild_id),
                KEY idx_streamer (streamer_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    },

    async down(db) {
        // **Die Tabelle bleibt.** Ein Rueckbau des Codes ist kein Grund, die
        // Befehle zu loeschen, die jemand fuer seinen Chat geschrieben hat —
        // dieselbe Regel wie bei `chat_ansage_text` und `heim_guild_id`.
        return;
    }
};
