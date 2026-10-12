'use strict';

/**
 * Die Artikel nennen die Adresse des Dashboards, die es gibt (Betreiber, 2026-10-12).
 *
 * Betreiber: „Erste Schritte beschreibt ebenfalls eine Adresse, die noch aus
 * alten Tagen stammt: dashboard.dunebot.de. […] Dashboard-Übersicht enthält
 * unter Zugang ebenfalls einen dashboard.dunebot.de-Link, der ja ebenfalls
 * nicht existiert, und zudem heißt der Bot ja nun FireBot."
 *
 * Zur Wahl standen eine eigene Adresse `dashboard.firenetworks.de` oder ein
 * Verweis auf die vorhandene. Genommen ist die vorhandene: `/guild` — dorthin
 * führt schon der Knopf „Dashboard" der Webseite (Anmeldung, dann
 * Serverauswahl). Eine zweite Adresse für dieselbe Sache bräuchte DNS,
 * Zertifikat und einen eigenen Eintrag im Webserver, und danach gäbe es zwei
 * Wege. (`/auth/`, vom Betreiber als Möglichkeit genannt, gibt es nicht —
 * gemessen 404; die Anmeldung liegt unter `/auth/login`, und `/guild` führt
 * dorthin und danach weiter.)
 *
 * ── Drei Ersetzungen, jede nur, wo der alte Wortlaut noch steht ─────────────
 *
 *   1. „Erste Schritte", Schritt 1 unter „Dashboard öffnen" — dazu der Knopf
 *      der Anmeldeseite: Er heißt „Mit Discord fortfahren", nicht „Mit Discord
 *      anmelden" (das ist die Überschrift der Seite).
 *   2. „Erste Schritte", Absatz „Server auswählen": Die Serverauswahl zeigt
 *      auch Server OHNE FireBot (mit „Bot hinzufügen") — der Absatz behauptete
 *      das Gegenteil. Regel aus `auth.controller.js`, `getServerSelector`.
 *   3. „Dashboard-Übersicht", Absatz „Zugang" — derselbe Irrtum, dieselbe Adresse.
 *
 * Danach, als Netz für alles Übrige: Wo der alte Verweis in irgendeinem
 * Artikel noch wörtlich steht (weil der Satz drumherum inzwischen anders
 * lautet), wird nur der Verweis getauscht.
 *
 * Der Betreiber bearbeitet die Artikel inzwischen selbst (`dashboard/uebersicht`
 * am 2026-10-12, 10:10). Deshalb wird nirgends ein ganzer Artikel geschrieben:
 * Ersetzt werden genau diese Sätze, alles andere bleibt, wie er es hinterlassen hat.
 *
 * Gemessen am 2026-10-12: „dunebot" steht danach in keinem Artikel mehr.
 */

const VERWEIS_ALT = '[dashboard.dunebot.de](https://dashboard.dunebot.de)';
const VERWEIS_NEU = '[firenetworks.de/guild](/guild)';

const SERVERAUSWAHL = 'Nach dem Login siehst du die Serverauswahl: alle Server, auf denen du Besitzer oder Administrator bist '
    + 'oder die Berechtigung **Server verwalten** hast, dazu Server, zu deren Dashboard dich jemand eingeladen hat. '
    + 'Ist FireBot dort schon aktiv, klicke auf **Verwalten**. Steht dort **Bot nicht in Guild**, lädst du ihn mit '
    + '**Bot hinzufügen** ein — siehe [Bot einladen](/kb/getting-started/bot-einladen).';

/** [alt, neu] — in dieser Reihenfolge; die letzte Zeile ist das Netz. */
const ERSETZUNGEN = [
    // 1. Erste Schritte → Dashboard öffnen
    ['1. Gehe zu **[dashboard.dunebot.de](https://dashboard.dunebot.de)**\n2. Klicke auf **Mit Discord anmelden**\n',
     '1. Gehe auf **[firenetworks.de](https://firenetworks.de)** und klicke auf **Dashboard** — oder direkt: **[firenetworks.de/guild](/guild)**\n2. Klicke auf **Mit Discord fortfahren**\n'],
    // 2. Erste Schritte → Server auswählen
    ['Nach dem Login siehst du eine Übersicht aller Server, auf denen FireBot aktiv ist und auf denen du Berechtigungen hast. '
        + 'Klicke auf den Server, den du konfigurieren möchtest.',
     SERVERAUSWAHL],
    // 3. Dashboard-Übersicht → Zugang
    ['Das Dashboard erreichst du über **[dashboard.dunebot.de](https://dashboard.dunebot.de)** mit deinem Discord-Account. '
        + 'Du siehst nur Server, auf denen FireBot aktiv ist und auf denen du entsprechende Berechtigungen hast.',
     'Das Dashboard erreichst du über **[firenetworks.de](https://firenetworks.de)** → **Dashboard** oder direkt über '
        + '**[firenetworks.de/guild](/guild)**. Du meldest dich mit deinem Discord-Account an. In der Serverauswahl stehen die Server, '
        + 'auf denen du Besitzer oder Administrator bist oder **Server verwalten** darfst; öffnen kannst du die, auf denen FireBot aktiv ist.'],
    // Netz: der Verweis allein, wo er sonst noch steht
    [VERWEIS_ALT, VERWEIS_NEU],
];

/** Alle Ersetzungen auf einen Text anwenden — rein, damit der Wächter sie nachrechnen kann. */
function ersetze(text) {
    let aus = String(text);
    for (const [alt, neu] of ERSETZUNGEN) aus = aus.split(alt).join(neu);
    return aus;
}

module.exports = {
    description: 'Wissensdatenbank: dashboard.dunebot.de wird zur vorhandenen Adresse /guild, die Serverauswahl ist richtig beschrieben',
    ERSETZUNGEN, ersetze,

    async up(db) {
        // **Nicht destrukturieren** — `db.query()` liefert die Zeilen direkt.
        const da = await db.query(
            `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kb_articles'`);
        if (!da.length) return;

        // In JavaScript ersetzen, nicht mit REPLACE() in SQL: Die Spalte ist JSON,
        // und die Sätze enthalten Zeilenumbrüche und Anführungszeichen, die dort
        // anders geschrieben stehen als im Text.
        const zeilen = await db.query(
            `SELECT id, content_translations FROM kb_articles
              WHERE content_translations LIKE '%dashboard.dunebot.de%'
                 OR content_translations LIKE '%Nach dem Login siehst du eine Übersicht aller Server%'`);
        for (const z of zeilen) {
            const inhalt = typeof z.content_translations === 'string' ? JSON.parse(z.content_translations) : (z.content_translations || {});
            let geaendert = false;
            for (const sprache of Object.keys(inhalt)) {
                const neu = ersetze(inhalt[sprache]);
                if (neu !== inhalt[sprache]) { inhalt[sprache] = neu; geaendert = true; }
            }
            if (geaendert) await db.query('UPDATE kb_articles SET content_translations = ? WHERE id = ?', [JSON.stringify(inhalt), z.id]);
        }
    },

    async down() {
        // Kein Rückweg: Die alte Adresse gab es nicht. Ein Artikel wird in der Verwaltung geändert.
    },
};
