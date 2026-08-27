'use strict';

/**
 * Melder (Stufe 12c) — Raids, Geschenk-Abos, Bits, Follows, Abonnements.
 *
 * Hintergrund in `docs/streamer-plugin/12-Anmeldung-und-Chat.md`, Abschnitt 3.
 * Dieselben Token wie 12a/12b, nur mehr Ereignisse — der billigste offene
 * Zuwachs.
 *
 * ## Was hier dazukommt
 *
 * `streaming_targets.melder_channel_id` — wohin die Meldungen gehen. **Leer
 * heisst: in den Ankuendigungskanal** (Entscheidung des Betreibers am
 * 2026-08-27). Der Einwand dagegen bleibt im Papier stehen: Ein Follow-Schub
 * schiebt die Live-Ankuendigung aus dem Blick. Entschaerft wird er nicht hier,
 * sondern auf der Ziele-Seite — sie sagt beim Anschalten, in welchen Kanal
 * gemeldet wird.
 *
 * `streaming_targets.melder_arten` — welche Meldungen diese Guild will, als
 * Liste mit Komma: `raid,geschenkt,bits,follow,abonniert,verlaengert`.
 *
 * ## Warum eine Liste in einer Spalte und keine eigene Tabelle
 *
 * Weil es eine **Einstellung** ist, kein Bestand. Sie wird als Ganzes
 * geschrieben, als Ganzes gelesen und nie einzeln abgefragt oder verknuepft.
 * Eine Tabelle mit sechs moeglichen Zeilen je Ziel waere hier kein Gewinn an
 * Ordnung, sondern ein Join mehr auf jedem Weg.
 *
 * Der Preis ist benannt: Kommt eine siebte Art dazu, aendert sich kein Schema,
 * aber auch keine Datenbank haelt uns von einem Tippfehler ab. Das tut
 * `kern/melder.js` — dort steht die Liste der gueltigen Namen, und
 * `scripts/check-streaming-melder.js` haelt sie mit den Ereignissen des
 * Adapters zusammen.
 *
 * ## Leer heisst aus
 *
 * Beide Spalten sind `NULL`, und `melder_arten = NULL` heisst "keine
 * Meldungen". Ein bestehendes Ziel aendert sein Verhalten durch diesen Umzug
 * also nicht — es wird nichts angeschaltet, was niemand angeschaltet hat.
 */

module.exports = {
    description: 'Melder: melder_channel_id und melder_arten am Ziel',

    async up(db) {
        // `IF NOT EXISTS` kennt MySQL bei ADD COLUMN nicht durchgaengig —
        // deshalb von Hand nachgesehen, statt einen Fehler zu erzeugen, der
        // wie ein kaputter Umzug aussieht. Dasselbe Muster wie bei
        // `abo_rolle_id` am 2026-08-26.
        const [vorhanden] = await db.query(`
            SELECT COLUMN_NAME FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'streaming_targets'
               AND COLUMN_NAME IN ('melder_channel_id', 'melder_arten')
        `);
        const zeilen = Array.isArray(vorhanden) ? vorhanden : [];
        const namen = new Set(zeilen.map(z => z.COLUMN_NAME || z.column_name));

        if (!namen.has('melder_channel_id')) {
            await db.query(`
                ALTER TABLE streaming_targets
                  ADD COLUMN melder_channel_id VARCHAR(32) DEFAULT NULL AFTER onair_channel
            `);
        }

        if (!namen.has('melder_arten')) {
            await db.query(`
                ALTER TABLE streaming_targets
                  ADD COLUMN melder_arten VARCHAR(255) DEFAULT NULL AFTER melder_channel_id
            `);
        }
    },

    async down(db) {
        // Die Spalten bleiben. Sie zu entfernen wuerde die Einstellung jeder
        // Guild verlieren, und ein Rueckbau ist kein Grund dafuer — dieselbe
        // Begruendung wie bei `abo_rolle_id`.
    }
};
