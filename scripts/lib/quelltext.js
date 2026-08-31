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
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        // Zeilenkommentare, auch angehaengte. Das `[^:]` haelt `https://` heraus;
        // das Zeichen davor wird wieder eingesetzt, damit keine Luecke entsteht.
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

module.exports = { ohneKommentare };
