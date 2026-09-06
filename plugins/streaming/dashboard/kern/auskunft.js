'use strict';

/**
 * Was eine Twitch-Abfrage einer Seite sagt - und wie sie es sagt.
 *
 * ## Warum das eine eigene Datei ist
 *
 * `ZUSTAND` und `deuten` entstanden am 2026-09-05 in `kern/statistik`. Einen
 * Tag spaeter braucht die Mitmachen-Seite genau dieselbe Unterscheidung, und
 * es gab drei Wege:
 *
 *   - kopieren     — zwei Wahrheiten, die auseinanderlaufen, sobald jemand
 *                    einen vierten Fall braucht
 *   - aus \`statistik\` importieren — dann besaesse die Statistik-Seite den
 *                    allgemeinen Begriff „Antwort einer Twitch-Abfrage", und
 *                    jeder Leser fragt sich, warum
 *   - herausziehen — diese Datei
 *
 * `statistik` gibt `ZUSTAND` weiterhin aus. Nicht aus Bequemlichkeit: Die
 * Ansicht und der Wächter greifen darauf zu, und ein Umzug soll keine
 * Aufrufer zerlegen, die von ihm nichts wissen.
 *
 * @module streaming/kern/auskunft
 */

/**
 * Ein Zustand je Quelle - und was er dem Streamer sagt.
 *
 * `abgelehnt` ist ausdruecklich NICHT `fehler`: Es heisst, dass die Zusage
 * fehlt oder widerrufen wurde, und das ist eine Entscheidung des Streamers,
 * keine Stoerung (17.5, Punkt 3). Ein Kanal, dem die Zusage fehlt, darf nicht
 * aussehen wie einer, bei dem gerade etwas kaputt ist - und erst recht nicht
 * wie einer mit dem Ergebnis null.
 */
const ZUSTAND = {
    OK:         'ok',
    ABGELEHNT:  'abgelehnt',
    FEHLER:     'fehler',
    KEIN_KANAL: 'kein_kanal'
};

/**
 * Ein Antwortpaket in einen Zustand plus Werte uebersetzen.
 *
 * Drei Faelle, und jeder liest sich anders auf der Seite:
 *
 *   `null`            gar keine Zusage mehr - der Streamer hat widerrufen
 *   `abgelehnt`       Twitch hat den Schluessel abgewiesen (401)
 *   `!ok`             etwas anderes ging schief
 *
 * @param {Object|null} ergebnis Was die Plattform lieferte
 * @param {Function} werte Wie die Nutzlast herausgezogen wird
 * @param {Object} leer Was bei Misserfolg dasteht
 * @returns {Object} `{ zustand, …werte }`
 */
function deuten(ergebnis, werte, leer) {
    if (!ergebnis) return { zustand: ZUSTAND.ABGELEHNT, ...leer };
    if (ergebnis.abgelehnt) return { zustand: ZUSTAND.ABGELEHNT, ...leer };
    if (!ergebnis.ok) return { zustand: ZUSTAND.FEHLER, ...leer };
    return { zustand: ZUSTAND.OK, ...werte(ergebnis) };
}

module.exports = { ZUSTAND, deuten };
