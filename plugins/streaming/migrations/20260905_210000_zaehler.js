'use strict';

/**
 * Zaehler - der dritte Teil der eigenen Platzhalter.
 *
 * ## Warum sie in `streaming_variables` wohnen und nicht in einer eigenen Tabelle
 *
 * Ein Zaehler ist im Text dasselbe wie ein Textbaustein: ein Name in
 * geschweiften Klammern, der zu etwas wird. Zwei Tabellen hiessen zwei
 * Abfragen je Chatnachricht, zwei Namensraeume - und die Frage, was passiert,
 * wenn jemand einen Baustein und einen Zaehler gleich nennt. Der vorhandene
 * eindeutige Schluessel (guild_id, streamer_id, name) beantwortet sie
 * kostenlos: Es kann ihn nur einmal geben.
 *
 * ## Warum `art` erst jetzt kommt
 *
 * Sie stand bewusst nicht in der Bausteintabelle vom selben Tag: Eine Spalte,
 * die heute immer denselben Wert traegt, ist vorbereiteter toter Platz - man
 * verlaesst sich darauf, und beim ersten echten Einsatz stellt sich heraus,
 * dass sie nie stimmte. Jetzt gibt es einen zweiten Wert, also gibt es die
 * Spalte.
 *
 * ## Warum die Zahl eine eigene Spalte ist
 *
 * `wert` ist Text. Eine Zahl darin abzulegen hiesse, bei jedem Hochzaehlen
 * `CAST(wert AS SIGNED) + 1` zu rechnen - und beim ersten nicht-numerischen
 * Inhalt still eine 1 zu erzeugen. `zahl INT` kann nur Zahlen sein, und das
 * Hochzaehlen ist ein `zahl = zahl + 1`, das die Datenbank atomar erledigt.
 *
 * ## Und warum am Befehl steht, WAS hochzaehlt
 *
 * Nicht im Text (`{tode+}`), sondern als Feld am Befehl. Ein Platzhalter, der
 * beim Lesen etwas veraendert, ist eine Falle: Er zaehlt auch dann hoch, wenn
 * ihn jemand nur in der Vorschau ansieht oder wenn `!befehle` die Liste
 * aufzaehlt. Am Befehl steht es sichtbar, ist im Panel einstellbar, und ein
 * Befehl, der nur anzeigen soll, laesst das Feld leer.
 */

module.exports = {
    name: '20260905_210000_zaehler',
    description: 'Zaehler: art + zahl in streaming_variables, zaehler_name am Befehl',

    /**
     * @param {Object} db Datenbankdienst
     * @returns {Promise<void>}
     */
    async up(db) {
        // **Nicht destrukturieren.** `db.query()` liefert die Zeilen direkt.
        const spalten = await db.query(`
            SELECT COLUMN_NAME FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'streaming_variables'
        `);
        const hat = new Set(spalten.map(s => s.COLUMN_NAME));

        if (!hat.has('art')) {
            await db.query(`
                ALTER TABLE streaming_variables
                  ADD COLUMN art VARCHAR(16) NOT NULL DEFAULT 'text' AFTER name
            `);
        }

        if (!hat.has('zahl')) {
            await db.query(`
                ALTER TABLE streaming_variables
                  ADD COLUMN zahl INT NOT NULL DEFAULT 0 AFTER wert
            `);
        }

        // `wert` darf jetzt leer sein: Ein Zaehler hat keinen Text.
        //
        // Die Spalte war NOT NULL ohne Vorgabe - ein Zaehler haette sich nicht
        // anlegen lassen, und die Fehlermeldung von MariaDB haette niemand mit
        // dieser Migration in Verbindung gebracht.
        await db.query(`
            ALTER TABLE streaming_variables
              MODIFY COLUMN wert VARCHAR(500) NOT NULL DEFAULT ''
        `);

        const befehlsSpalten = await db.query(`
            SELECT COLUMN_NAME FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'streaming_commands'
        `);
        if (!befehlsSpalten.some(s => s.COLUMN_NAME === 'zaehler_name')) {
            await db.query(`
                ALTER TABLE streaming_commands
                  ADD COLUMN zaehler_name VARCHAR(32) DEFAULT NULL AFTER antwort
            `);
        }
    },

    /**
     * @param {Object} db Datenbankdienst
     * @returns {Promise<void>}
     */
    async down(db) {
        // **Die Spalten bleiben.** Sie zu entfernen wuerfe die Zaehlerstaende
        // weg - dieselbe Regel wie bei den Tabellen: Ein Rueckbau des Codes
        // ist kein Grund, die Zahlen zu loeschen, die jemand ueber Monate
        // gesammelt hat.
        return;
    }
};
