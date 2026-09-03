'use strict';

/**
 * Abschnittsbeschriftungen in der Seitenleiste (P1).
 *
 * Hintergrund: `docs/streamer-plugin/16-Panel-Neuschnitt.md`, Abschnitt P1.
 *
 * ## Warum es diese Spalte gibt
 *
 * `partials/guild/sidebar.ejs` kann **genau zwei Ebenen** — eine Gruppe und
 * ihre `dropdown-item`s. Ein Plugin mit vielen Punkten muss sie deshalb flach
 * nebeneinanderlegen, auch wenn sie sachlich in Gruppen zerfallen. Beim
 * Streaming-Plugin standen sieben Punkte auf einer Ebene, und die Trennung
 * zwischen "was der Server verfolgt" und "was mir als Streamer gehoert" war
 * nirgends zu sehen.
 *
 * Die Vorlage (Wize.Bot) loest dasselbe Problem **nicht** mit einer dritten
 * Ebene, sondern mit Beschriftungen: "CONTENT & INTERACTIONS", "ANALYTICS &
 * USERS". Das sind keine Menuepunkte, sondern Zwischenueberschriften. Bootstrap
 * kann das seit jeher — `dropdown-header`.
 *
 * ## Warum ein Feld am Punkt und keine Beschriftungs-Items
 *
 * Der naheliegende Weg waere gewesen, Pseudo-Eintraege ohne URL einzufuegen.
 * Der teure Teil daran ist nicht das Einfuegen, sondern alles danach:
 *
 *   - Ein Pseudo-Eintrag muesste durch `_filterByPermissions` laufen, obwohl
 *     er kein Recht hat.
 *   - Er muesste **von selbst verschwinden**, wenn alle Punkte darunter wegen
 *     fehlender Rechte unsichtbar sind — sonst steht eine Ueberschrift ueber
 *     nichts.
 *   - Er muesste bei `_istAktiv` und der Sortierung uebersprungen werden.
 *
 * Mit einem Feld am Punkt kostet das alles nichts: Kein Punkt, keine
 * Ueberschrift. Die Rechtefilterung laeuft ohnehin vorher.
 *
 * ## Warum keine der beiden vorhandenen Spalten
 *
 * `guild_nav_items` hat bereits zwei Felder, die wie eine Abkuerzung aussahen:
 *
 *     meta LONGTEXT      steht in der Tabelle, wird aber NIE geschrieben —
 *                        das INSERT in NavigationManager listet 14 Spalten,
 *                        `meta` ist nicht dabei
 *     classes VARCHAR    wird geschrieben, aber `sidebar.ejs` rendert es
 *                        nirgends
 *
 * `meta` zu beleben hiesse, JSON zu schreiben und bei jedem Seitenaufbau zu
 * parsen — fuer ein Wort. `classes` zu benutzen hiesse, einen Abschnittsnamen
 * in ein CSS-Klassenfeld zu schreiben; die erste Person, die dort eine echte
 * Klasse braucht, faende einen Abschnittsnamen vor. Eine eigene Spalte ist
 * ehrlicher und nicht teurer.
 *
 * ## Additiv, mit Absicht
 *
 * `NULL` heisst "kein Abschnitt", und das ist der Normalfall. Alle dreizehn
 * Plugins bekommen genau das, was sie heute haben; nur wer das Feld setzt,
 * bekommt Zwischenueberschriften. Ein Rollout, der nichts umstellt.
 */

module.exports = {
    description: 'Abschnittsbeschriftungen: Spalte `abschnitt` an guild_nav_items',

    async up(db) {
        // **Nicht destrukturieren.** `db.query()` liefert hier die Zeilen
        // direkt; `const [x] = await db.query(...)` griffe die erste ZEILE —
        // bei vorhandener Spalte waere `x.length` dann die Feldzahl dieser
        // Zeile und die Waechterabfrage liefe ins Leere. 22 Altdateien tragen
        // den Fehler und sind eingefroren (`scripts/check-migrationen.js`).
        const vorhanden = await db.query(`
            SELECT COLUMN_NAME FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'guild_nav_items'
               AND COLUMN_NAME = 'abschnitt'
        `);

        if (!vorhanden.length) {
            // `IF NOT EXISTS` kennt MySQL bei ADD COLUMN nicht durchgaengig —
            // deshalb die Abfrage von Hand statt eines Fehlers, der wie ein
            // kaputter Umzug aussieht.
            //
            // 64 Zeichen: Der Wert ist eine Ueberschrift von zwei bis drei
            // Woertern, oder ein Uebersetzungsschluessel wie
            // `streaming:NAV.ABSCHNITT.VERFOLGUNG`. Beides passt bequem.
            await db.query(`
                ALTER TABLE guild_nav_items
                  ADD COLUMN abschnitt VARCHAR(64) DEFAULT NULL AFTER parent
            `);
        }
    },

    async down(db) {
        // **Die Spalte bleibt.** Sie zu entfernen hiesse, jedem Plugin seine
        // Gliederung zu nehmen — und ein Rueckbau des Codes ist kein Grund,
        // eine Einstellung zu loeschen. Dieselbe Regel wie bei
        // `heim_guild_id` und `abo_rolle_id`.
        //
        // Die Spalte ist folgenlos, solange niemand sie liest: Eine
        // Seitenleiste ohne die Gruppierung rendert die Punkte flach, so wie
        // vorher.
        void db;
    }
};
