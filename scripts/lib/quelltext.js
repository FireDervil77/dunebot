'use strict';
/**
 * Quelltext von seiner Prosa trennen.
 *
 * ── Warum es das gibt (Baustelle 89, 2026-08-30) ────────────────────────────
 *
 * Waechter pruefen mit regulaeren Ausdruecken ueber den DATEIINHALT. Der ist
 * aber nicht der Code: Er enthaelt die Kommentare, und dieses Haus schreibt
 * lange. Also trifft der Ausdruck die BESCHREIBUNG der Sache statt der Sache.
 * Dreimal an einem Vormittag falscher Alarm — und die gefaehrlichere Richtung
 * ist die andere: Ein Treffer im Kommentar kann eine Pruefung gruen halten,
 * waehrend der Code sie verletzt.
 *
 * ── Warum HIER und nicht je Waechter (2026-08-31) ───────────────────────────
 *
 * Es gab vier Fassungen in sieben Skripten, und sie verhielten sich
 * verschieden: zwei warfen nur Zeilen weg, die MIT `//` beginnen, und liessen
 * damit jeden angehaengten Kommentar stehen. Eine kannte den `://`-Schutz, drei
 * nicht. Vier Wahrheiten ueber dieselbe Frage sind drei zu viel.
 *
 * ── Was er ausdruecklich NICHT kann ─────────────────────────────────────────
 *
 * Er ist kein Parser und will keiner sein. `//` innerhalb einer Zeichenkette
 * ueberlebt ihn nur, wenn ein `:` davorsteht (`https://` also ja, `'a//b'`
 * nein). Er gehoert dorthin, wo nach CODE gesucht wird — nie dorthin, wo nach
 * Text gesucht wird. Wer pruefen will, ob ein Kommentar DA ist, braucht den
 * rohen Inhalt.
 */

/**
 * @param {string} quelltext Roher Dateiinhalt (JavaScript)
 * @returns {string} derselbe Text, Kommentare durch Leerraum ersetzt
 */
function ohneKommentare(quelltext) {
    return String(quelltext)
        // Blockkommentare zuerst — sonst zerlegt die Zeilenregel ihre Innereien.
        //
        // **Das vorangestellte Zeichen ist der Punkt.** Bis zum 2026-09-16 stand
        // hier `/\*[\s\S]*?\*\//g` ohne Vorbedingung. In `apps/dashboard/app.js`
        // riss das 11.799 Zeichen echten Code heraus: Die CSP-Zeile
        // `"https://*.google-analytics.com"` enthaelt in `//*` ein `/*` und
        // eroeffnete einen Kommentar, den erst `type: '*/*'` sechzig Zeilen
        // spaeter wieder schloss. Jede Pruefung auf Code dazwischen meldete
        // gruen, weil sie ins Leere lief — die gefaehrlichere Richtung.
        //
        // Ein echter Blockkommentar steht am Zeilenanfang oder hinter
        // Leerraum/Klammer/Komma. Innerhalb einer Zeichenkette steht vor dem
        // `/*` dagegen ein `/` oder `*`. Das reicht als Unterscheidung, ohne
        // einen Parser zu bauen.
        .replace(/(^|[\s(,;{=])\/\*[\s\S]*?\*\//g, '$1 ')
        // Zeilenkommentare, auch angehaengte. Das `[^:]` haelt `https://` heraus;
        // das Zeichen davor wird wieder eingesetzt, damit keine Luecke entsteht.
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Dasselbe fuer eine EJS-Ansicht.
 *
 * Ansichten tragen zwei Sorten Prosa: den EJS-Kommentar `<%# … %>` ganz oben
 * (dort steht bei uns der Kopf mit `@context`) und gewoehnliche
 * JavaScript-Kommentare innerhalb der `<% … %>`-Bloecke. Wer in einer Ansicht
 * nach Code sucht — „steht hier wirklich `guild.iconURL`?" — trifft sonst die
 * Zeile, die erklaert, dass man es gerade NICHT benutzen soll.
 *
 * Angelegt am 2026-09-16 beim Bau der Willkommensseite, als check-waechter-prosa
 * genau diese Stelle anmerkte.
 *
 * @param {string} inhalt Roher Inhalt einer .ejs-Datei
 * @returns {string} derselbe Text ohne Kommentare
 */
function ohneKommentareEjs(inhalt) {
    return ohneKommentare(String(inhalt).replace(/<%#[\s\S]*?%>/g, ' '));
}

/**
 * Dasselbe fuer Shell-Skripte und Dockerfiles (2026-09-24).
 *
 * Entfernt nur GANZE Kommentarzeilen (erstes Zeichen ausser Leerraum ist `#`).
 * Ein angehaengter Kommentar bleibt stehen: `#` ist in Shell auch Teil von
 * Code (`$#`, `${x#y}`, `'#'`), und eine Regel, die das unterscheidet, waere
 * ein Parser. Die Zeilen bleiben als Leerzeilen erhalten, damit Zeilennummern
 * stimmen.
 *
 * @param {string} inhalt Roher Dateiinhalt (sh/bash/Dockerfile)
 * @returns {string}
 */
function ohneKommentareShell(inhalt) {
    return String(inhalt).split('\n').map(z => (/^\s*#/.test(z) ? '' : z)).join('\n');
}

module.exports = { ohneKommentare, ohneKommentareEjs, ohneKommentareShell };
