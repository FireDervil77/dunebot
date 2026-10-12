'use strict';

/**
 * Der Blog bekommt eine Herkunft je Beitrag (Betreiber, 2026-10-12).
 *
 * Bisher steht in `blog_posts` nur, was der Betreiber im Editor schreibt. Neu
 * kommen die Ankündigungen der Spielehersteller dazu, die der Kanal
 * `📡-game-updates` aus fremden Servern bezieht — der Bot liest sie dort und
 * legt je Meldung einen Beitrag an (Regel: `dunebot-core/lib/Spielemeldungen.js`).
 *
 * Die Blogseite trennt danach: links die eigenen Artikel, rechts die
 * Meldungen. Dafür braucht jeder Beitrag seine Herkunft, und eine Meldung die
 * Kennung der Discord-Nachricht — an ihr wird sie wiedererkannt (nie doppelt,
 * und eine geänderte Meldung zieht nach).
 *
 *   source             'own' (Vorgabe, also alle bisherigen) oder 'discord'
 *   source_message_id  Kennung der Nachricht in unserem Kanal, eindeutig
 *   source_channel_id  unser Kanal — der Bot holt je Kanal ab der jüngsten nach
 *   source_name        Absender, z. B. „Dune: Awakening #patch-notes"
 *   source_url         Verweis aufs Original (erste Adresse im Text, sonst die Nachricht)
 *   game               das Spiel, nach dem die Rubrik filtert
 *
 * Der Stand einer Meldung nutzt die vorhandene Spalte `status`: `published`,
 * `hidden` (vom Betreiber ausgeblendet), `removed` (Original gelöscht). Die
 * Seite zeigt wie bisher nur `published`.
 *
 * ── Läuft in zwei Prozessen ────────────────────────────────────────────────
 *
 * Kern-Migrationen fahren beim Start von Bot UND Dashboard. Jede Spalte wird
 * einzeln geprüft und ergänzt; kommt der zweite Prozess dazwischen, ist „gibt
 * es schon" kein Fehler. Gelesen wird der Bestand mit `SHOW COLUMNS`, nicht
 * aus `information_schema` — das sieht auch die Kopie, an der der Wächter prüft.
 */

const SPALTEN = [
    ['source', "VARCHAR(20) NOT NULL DEFAULT 'own'"],
    ['source_message_id', 'VARCHAR(32) DEFAULT NULL'],
    ['source_channel_id', 'VARCHAR(32) DEFAULT NULL'],
    ['source_name', 'VARCHAR(255) DEFAULT NULL'],
    ['source_url', 'VARCHAR(512) DEFAULT NULL'],
    ['game', 'VARCHAR(120) DEFAULT NULL'],
];
const SCHLUESSEL = [
    ['unique_source_message', 'UNIQUE KEY unique_source_message (source_message_id)'],
    ['idx_source_status_date', 'KEY idx_source_status_date (source, status, published_at)'],
];

/** 1060: Spalte gibt es schon, 1061: Schlüssel gibt es schon — der andere Prozess war schneller. */
const schonDa = (fehler) => fehler?.errno === 1060 || fehler?.errno === 1061;

module.exports = {
    description: 'Blog: Herkunft je Beitrag, damit Spielemeldungen aus Discord daneben stehen können',
    SPALTEN, SCHLUESSEL,

    async up(db) {
        // **Nicht destrukturieren** — `db.query()` liefert die Zeilen direkt.
        const spalten = new Set((await db.query('SHOW COLUMNS FROM blog_posts')).map(z => z.Field));
        for (const [name, art] of SPALTEN) {
            if (spalten.has(name)) continue;
            try { await db.query(`ALTER TABLE blog_posts ADD COLUMN ${name} ${art}`); }
            catch (fehler) { if (!schonDa(fehler)) throw fehler; }
        }
        const schluessel = new Set((await db.query('SHOW INDEX FROM blog_posts')).map(z => z.Key_name));
        for (const [name, art] of SCHLUESSEL) {
            if (schluessel.has(name)) continue;
            try { await db.query(`ALTER TABLE blog_posts ADD ${art}`); }
            catch (fehler) { if (!schonDa(fehler)) throw fehler; }
        }
    },

    async down(db) {
        // Erst die Meldungen, dann die Spalten — sonst stünden sie als eigene Beiträge da.
        await db.query("DELETE FROM blog_posts WHERE source = 'discord'");
        for (const [name] of SCHLUESSEL) await db.query(`ALTER TABLE blog_posts DROP KEY ${name}`);
        for (const [name] of SPALTEN) await db.query(`ALTER TABLE blog_posts DROP COLUMN ${name}`);
    },
};
