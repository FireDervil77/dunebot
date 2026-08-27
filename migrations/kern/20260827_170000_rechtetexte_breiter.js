'use strict';

/**
 * Rechte mit langer Beschreibung liessen sich gar nicht anlegen.
 *
 * ## Der Befund
 *
 * Beim Dashboard-Start am 2026-08-27 stand im Protokoll:
 *
 *     Fehler beim Registrieren von Permission DISCORD.ROLEMENUS.MANAGE:
 *       Data too long for column 'description_translation_key' at row 1
 *
 * `PluginManager.registerPermissions` schreibt den **Beschreibungstext** aus
 * `permissions.json` in `description_translation_key` — die Spalte heisst
 * "translation_key", traegt aber Klartext. Sie war `varchar(100)`.
 *
 * Nachgemessen: Drei Rechte im ganzen Haus sind laenger.
 *
 *     112 Zeichen  AUTOMOD.KEYWORDS.MANAGE
 *     160 Zeichen  DISCORD.ROLEMENUS.MANAGE
 *     173 Zeichen  MUSIC.FILES.UPLOAD
 *
 * In `permission_definitions` stand danach nur `DISCORD.ROLEMENUS.VIEW`.
 * **`MANAGE` existierte nicht.**
 *
 * ## Warum das mehr ist als ein Schoenheitsfehler
 *
 * Ein Recht, das nicht in `permission_definitions` steht, laesst sich keiner
 * Gruppe zuteilen. `hasPermission` findet nichts und verweigert — die
 * Richtung ist also die harmlosere (gesperrt, nicht offen), aber die Funktion
 * dahinter ist fuer **jeden** unerreichbar. Die Rollenmenues aus Paket 2 kann
 * niemand verwalten, und niemand kaeme auf die Idee, die Ursache in einer
 * Spaltenbreite zu suchen.
 *
 * ## Warum breiter statt kuerzer
 *
 * Die Texte zu kuerzen waere in drei Zeilen erledigt gewesen — und beim
 * naechsten langen Text waere es wieder passiert. Eine Beschreibung soll
 * erklaeren duerfen, was ein gefaehrliches Recht anrichtet; genau dort wird
 * sie lang. Der Betreiber hat das am 2026-08-27 so entschieden.
 *
 * `name_translation_key` geht mit, obwohl heute kein Name zu lang ist: Zwei
 * Spalten mit derselben Aufgabe und unterschiedlicher Breite sind eine Falle,
 * die genau einmal zuschnappt.
 *
 * ## Zur Ausfuehrung
 *
 * Vorher nachgesehen (`SHOW CREATE TABLE`, nicht die Migration geglaubt):
 * beide Spalten `varchar(100)`, `name_translation_key NOT NULL`, 133 Zeilen.
 * Der Zeichensatz ist utf8mb4; 100 und 255 Zeichen liegen beide oberhalb der
 * 255-Byte-Grenze, das Laengenpraefix bleibt also bei 2 Byte und die
 * Aenderung kann in-place laufen. Bei 133 Zeilen ist das ohnehin sofort
 * vorbei.
 *
 * **Es gehen keine Daten verloren:** Eine Spalte zu verbreitern kann nichts
 * abschneiden. Der Rueckbau kann das sehr wohl, deshalb tut `down` nichts.
 */

module.exports = {
    description: 'Rechtetexte: name/description_translation_key auf varchar(255)',

    async up(db) {
        // Nachsehen statt annehmen: Ist die Aenderung schon drin, wird nichts
        // getan. `MODIFY COLUMN` waere zwar wiederholbar, aber ein Lauf, der
        // sichtbar nichts tut, ist besser als einer, der sicherheitshalber
        // schreibt.
        // **`db.query` liefert die Zeilen direkt** — es ist der DBService, nicht
        // eine rohe mysql2-Verbindung. `const [spalten] = await db.query(...)`
        // griffe die erste ZEILE statt der Liste; genau daran ist der erste
        // Lauf dieser Migration am 2026-08-27 gescheitert: `stand` blieb leer,
        // beide ALTER wurden uebersprungen, und der Lauf meldete Erfolg.
        // Gemessen, nicht geschlossen (siehe Baustelle 81).
        const spalten = await db.query(`
            SELECT COLUMN_NAME, CHARACTER_MAXIMUM_LENGTH AS laenge, IS_NULLABLE
              FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'permission_definitions'
               AND COLUMN_NAME IN ('name_translation_key', 'description_translation_key')
        `);

        const stand = new Map((spalten || [])
            .map(z => [z.COLUMN_NAME || z.column_name, z]));

        const name = stand.get('name_translation_key');
        if (name && Number(name.laenge) < 255) {
            // `NOT NULL` bleibt, wie es ist — eine Spalte nebenbei nullbar zu
            // machen waere eine zweite, unbeantragte Aenderung.
            await db.query(`
                ALTER TABLE permission_definitions
                MODIFY COLUMN name_translation_key VARCHAR(255) NOT NULL
            `);
        }

        const beschreibung = stand.get('description_translation_key');
        if (beschreibung && Number(beschreibung.laenge) < 255) {
            await db.query(`
                ALTER TABLE permission_definitions
                MODIFY COLUMN description_translation_key VARCHAR(255) DEFAULT NULL
            `);
        }
    },

    async down() {
        // **Bewusst leer.** Zurueck auf `varchar(100)` wuerde jede laengere
        // Beschreibung abschneiden — ein Rueckbau, der Daten zerstoert, ist
        // schlimmer als keiner.
    }
};
