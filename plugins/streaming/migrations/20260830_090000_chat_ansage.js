'use strict';

/**
 * Die Live-Ansage im Twitch-Chat (Stufe 13c).
 *
 * Hintergrund: `docs/streamer-plugin/14-Rechte-neu-denken.md`, Abschnitt 17.
 *
 * ## Was hier entsteht
 *
 * 13a schloss den Chat an und hoerte zu. Mit 13c bekommt der Bot eine Stimme,
 * und ihr erstes Wort ist die Ansage beim Streamstart: Der Chat erfaehrt, dass
 * es losgeht. Zwei Spalten tragen das - ein Schalter und ein Text.
 *
 * ## Warum am Streamer und nicht an einem Ziel
 *
 * Dieselbe Ueberlegung wie bei `heim_guild_id`: Ein Ziel gehoert einer Guild,
 * davon gibt es viele je Kanal. Die Ansage geht in **einen** Chat - den des
 * Kanals. Stuende sie am Ziel, koennten zwei Guilds zwei verschiedene Ansagen
 * in denselben fremden Chat schreiben.
 *
 * ## AUS ist die Vorgabe, und das ist keine Vorsicht, sondern Pflicht
 *
 * Der Bot schreibt unter dem **Namen des Streamers** (entschieden 2026-08-29).
 * Ein Text, der ohne Zutun in seinem Namen erscheint, waere eine Aussage, die
 * er nie getroffen hat. Deshalb steht der Schalter auf 0, und deshalb ist der
 * Schluessel dazu ohnehin einer, den nur er erteilen kann
 * (`user:write:chat`).
 *
 * ## Warum der Text hier steht und nicht bei den Guild-Vorlagen
 *
 * `streaming_templates` haelt die Vorlagen der Guild fuer ihre Discord-
 * Ankuendigungen - viele Guilds, ein Streamer. Hier ist es umgekehrt: ein
 * Kanal, ein Text. Die Vorlage der Guild in den fremden Chat zu schreiben
 * hiesse, dass die Serverleitung die Worte des Streamers waehlt.
 */

module.exports = {
    description: 'Live-Ansage im Twitch-Chat: Schalter und Text am Streamer',

    async up(db) {
        // **Nicht destrukturieren.** `db.query()` liefert die Zeilen direkt;
        // `const [x] = await db.query(...)` griffe die erste ZEILE, die
        // Waechterabfrage liefe ins Leere und das ALTER liefe trotzdem
        // (`scripts/check-migrationen.js`).
        const spalten = await db.query(`
            SELECT COLUMN_NAME FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'streaming_streamers'
               AND COLUMN_NAME IN ('chat_ansage_an', 'chat_ansage_text')
        `);
        const da = new Set(spalten.map(z => z.COLUMN_NAME));

        if (!da.has('chat_ansage_an')) {
            await db.query(`
                ALTER TABLE streaming_streamers
                  ADD COLUMN chat_ansage_an TINYINT(1) NOT NULL DEFAULT 0
            `);
        }

        // 500 Zeichen ist die Grenze von Twitch, nicht unsere Wahl. Ein
        // laengeres Feld wuerde Texte annehmen, die beim Senden abgeschnitten
        // werden - und der Streamer saehe erst im Chat, dass sein Satz auf
        // halber Strecke endet.
        if (!da.has('chat_ansage_text')) {
            await db.query(`
                ALTER TABLE streaming_streamers
                  ADD COLUMN chat_ansage_text VARCHAR(500) DEFAULT NULL
            `);
        }
    },

    async down(db) {
        // **Die Spalten bleiben.** Ein Rueckbau des Codes ist kein Grund, den
        // Text zu loeschen, den jemand fuer seinen eigenen Chat geschrieben
        // hat. Dieselbe Regel wie bei `heim_guild_id` und `abo_rolle_id`.
        void db;
    }
};
