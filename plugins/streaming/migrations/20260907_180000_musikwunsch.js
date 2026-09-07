'use strict';

/**
 * Musikwunsch aus dem Twitch-Chat (Punkt 3 aus `docs/musikwunsch/README.md`).
 *
 * ## Warum die Warteschlange hier liegt und nicht bei `music`
 *
 * Abgeleitet aus `!los`, nicht erfunden: `streaming_lose` liegt ebenfalls hier,
 * obwohl die Verlosung dem giveaway-Plugin gehoert. Die Regel dahinter ist,
 * dass die Abhaengigkeit **vom** Streaming-Plugin **zum** thematischen Plugin
 * zeigt - `music` darf den Namen `streaming` nicht kennen.
 *
 * Die Verbindung ist `datei_id` - eine Zahl, sonst nichts. **Kein
 * Fremdschluessel, kein JOIN nach `music_files`:** Die beiden Schemata werden
 * getrennt installiert, und `streaming_*` ist `utf8mb4_general_ci`, waehrend
 * die Kern- und music-Tabellen `utf8mb4_unicode_ci` fuehren. Ein JOIN ueber
 * eine Zeichenkette dazwischen wirft - gemessen am 2026-09-07, deshalb gibt es
 * `20260907_160000_lose_kollation.js`. `guild_id` traegt die Kollation des
 * Kerns von Anfang an, damit dieselbe Nachbesserung hier nicht noetig wird.
 *
 * Der Preis fuer den fehlenden Fremdschluessel sind verwaiste Zeilen, wenn eine
 * Datei geloescht wird. Die faengt der Leser ab: `MusicFiles.fuerStream()`
 * liefert sie nicht mehr, und der Player ueberspringt, was er nicht bekommt.
 *
 * ## Was hier NICHT gespeichert wird
 *
 * **Die Voteskip-Stimmen.** Sie leben im Arbeitsspeicher, wie die Abkuehlung
 * (`kern/befehle.js`). Zwei Gruende: Stimmen fuer den laufenden Titel sind so
 * kurzlebig wie eine Abkuehlung, und um Doppelabstimmung zu verhindern muesste
 * die Absenderkennung mitgeschrieben werden - genau das vermeidet der
 * Befehlsbaukasten bewusst (`20260905_100000_befehle.js`: keine Spalte fuer den
 * Absender). Ein Neustart verwirft die Stimmen des laufenden Titels; das ist
 * der richtige Preis.
 *
 * **`gewuenscht_von` ist die Ausnahme, und zwar eine gewollte.** Der
 * Anzeigename steht in der Liste - dieselbe Anforderung, die beim Discord-Weg
 * schon offensteht ("live gewuenscht von 5445..." statt eines Namens). Er wird
 * mit der Zeile verworfen und nicht laenger aufbewahrt; es gibt keinen
 * Verlauf, der ihn ueberdauert.
 */

module.exports = {
    name: '20260907_180000_musikwunsch',
    description: 'Musikwunsch: streaming_music_queue + streaming_music_state',

    async up(db) {
        // **Nicht destrukturieren.** `db.query()` liefert die Zeilen direkt -
        // `const [x] = await db.query(...)` griffe die erste ZEILE, und die
        // Waechterabfrage liefe ins Leere, waehrend die Migration Erfolg meldet.
        await db.query(`
            CREATE TABLE IF NOT EXISTS streaming_music_queue (
                id              BIGINT AUTO_INCREMENT PRIMARY KEY,
                guild_id        VARCHAR(32)  COLLATE utf8mb4_unicode_ci NOT NULL,
                streamer_id     INT          DEFAULT NULL,
                datei_id        INT          NOT NULL,
                titel           VARCHAR(255) NOT NULL,
                dauer_sek       INT          DEFAULT NULL,
                position        INT          NOT NULL,
                gewuenscht_von  VARCHAR(128) DEFAULT NULL,
                angelegt_am     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                KEY idx_guild_position (guild_id, position),
                KEY idx_datei (datei_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
        `);

        // Eine Zeile je Guild. `guild_id` ist der Schluessel, weil ein Streamer
        // einen Kanal sendet - zwei gleichzeitige Stream-Warteschlangen einer
        // Guild waeren nicht "noch nicht gebaut", sondern sinnlos.
        //
        // `schluessel` ist das Geheimnis in der OBS-Adresse. Es steht im
        // Klartext, anders als die SFTP-Passwoerter: Der Streamer muss es
        // wiedersehen koennen, wenn er OBS neu einrichtet - wie ein Stream-Key.
        // Der Schutz ist, dass es neu erzeugbar ist, nicht dass es unlesbar ist.
        //
        // `player_gesehen` beantwortet "laeuft die Browserquelle ueberhaupt?".
        // Ohne die Spalte zeigte die Seite eine Warteschlange, ohne sagen zu
        // koennen, ob sie jemand abspielt.
        await db.query(`
            CREATE TABLE IF NOT EXISTS streaming_music_state (
                guild_id        VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
                aktiv           TINYINT(1)  NOT NULL DEFAULT 0,
                aktuelle_id     BIGINT      DEFAULT NULL,
                begonnen_am     DATETIME    DEFAULT NULL,
                player_gesehen  DATETIME    DEFAULT NULL,
                schluessel      CHAR(64)    DEFAULT NULL,
                geaendert_am    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                            ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_schluessel (schluessel)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
        `);
    },

    async down(db) {
        await db.query('DROP TABLE IF EXISTS streaming_music_queue');
        await db.query('DROP TABLE IF EXISTS streaming_music_state');
    }
};
