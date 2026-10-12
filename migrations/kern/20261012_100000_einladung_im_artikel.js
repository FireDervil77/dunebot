'use strict';

/**
 * Der Artikel „Bot einladen" verweist auf `/invite` statt auf eine Adresse, die
 * es nie gab (Betreiber, 2026-10-12: „die Adresse dunebot.de/invite gibt es gar
 * nicht").
 *
 * Der Verweis `https://dunebot.de/invite` stammt aus `documentation/
 * getting-started/bot-einladen.md` und zog am 2026-10-11 mit dem Bestand in die
 * Wissensdatenbank ein. Die Adresse `/invite` entsteht im selben Stand
 * (`routes/frontend.router.js`); die Migration läuft beim selben Neustart, der
 * sie einschaltet — der Verweis zeigt also nie auf etwas, das es noch nicht gibt.
 *
 * Ersetzt wird genau diese eine Adresse, in jedem Artikel und jeder Sprache.
 * Alles andere am Text bleibt, auch was der Betreiber seit dem Einspielen
 * geändert hat. Gemessen am 2026-10-12: ein Artikel (`getting-started/
 * bot-einladen`).
 *
 * NICHT angefasst: zwei Verweise auf `dashboard.dunebot.de` (Artikel
 * `dashboard/uebersicht` und `getting-started/erste-schritte`). Was dort
 * stehen soll, ist Inhalt und Sache des Betreibers.
 */

const ALT = 'https://dunebot.de/invite';
const NEU = '/invite';

async function gibtEs(db) {
    // **Nicht destrukturieren** — `db.query()` liefert die Zeilen direkt.
    const t = await db.query(
        `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kb_articles'`);
    return t.length > 0;
}

module.exports = {
    description: 'Wissensdatenbank: der Verweis auf dunebot.de/invite zeigt auf /invite',
    ALT, NEU,

    async up(db) {
        if (!(await gibtEs(db))) return;
        await db.query(
            `UPDATE kb_articles SET content_translations = REPLACE(content_translations, ?, ?)
              WHERE content_translations LIKE ?`, [ALT, NEU, `%${ALT}%`]);
    },

    async down(db) {
        if (!(await gibtEs(db))) return;
        // Nur der Verweis in runden Klammern — „/invite" kann auch anderswo im Text stehen.
        await db.query(
            `UPDATE kb_articles SET content_translations = REPLACE(content_translations, ?, ?)
              WHERE content_translations LIKE ?`, [`](${NEU})`, `](${ALT})`, `%](${NEU})%`]);
    },
};
