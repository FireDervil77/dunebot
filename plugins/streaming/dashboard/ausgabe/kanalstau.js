'use strict';

/**
 * Streaming - der Stau im Bearbeiten-Eimer eines Kanals.
 *
 * # Warum es das gibt
 *
 * Gemessen am 2026-09-07 ueber vier Streamabende (Baustelle 102). Kanal
 * `1541361923570929735`, drei Ziele darin:
 *
 * ```
 * 17:59:49  Ziel 5  posten       fertig
 * 18:00:04  Ziel 5  bearbeiten   fertig      <- geht
 * 18:23:34  Ziel 3  bearbeiten   fertig      <- letzter Erfolg
 * 18:29:04  Ziel 3  bearbeiten   aufgegeben  <- ab hier nie wieder
 * 18:33:04  Ziel 5  bearbeiten   aufgegeben
 * 18:33:04  Ziel 6  bearbeiten   fertig      (anderer Kanal, unbeeindruckt)
 * ```
 *
 * Rund 28 Minuten laeuft derselbe Kanal einwandfrei, dann faellt er fuer
 * **beide** Ziele darin im selben Fenster aus und erholt sich bis zum
 * Streamende nicht mehr. `posten` gelingt die ganze Zeit weiter - es liegt bei
 * Discord in einem anderen Eimer als `PATCH .../messages/{id}`.
 *
 * # Warum Wiederholen hier schadet
 *
 * Die 25-Sekunden-Frist des Bots bricht nur das **Warten** ab, nicht die
 * Anfrage: Die steht weiter in der Schlange. Jeder aufgegebene Auftrag hat
 * also fuenf Anfragen hineingelegt, die niemand mehr abholt. Zwei Ziele, alle
 * fuenf Minuten, fuenf Versuche - es geht mehr hinein als heraus.
 *
 * Deshalb ist die richtige Antwort auf eine Frist hier **nicht** ein weiterer
 * Versuch, sondern eine Pause.
 *
 * # Was ausgesetzt wird und was nicht
 *
 * Ausgesetzt wird nur `bearbeiten` - die laufende Zuschauerzahl. Ihr
 * Ausbleiben kostet einen veralteten Text waehrend des Streams.
 *
 * **`aufraeumen` laeuft weiter**, auch bei Stau. Es ist ein Einzelschuss am
 * Streamende, und sein Ausbleiben ist der einzige Schaden, den der Betreiber
 * hinterher noch sieht: eine Ankuendigung, die fuer immer auf "ist live"
 * steht. Ein Auftrag alle paar Minuten staut nichts - fuenfzig tun es.
 *
 * # Warum im Speicher und nicht in der Datenbank
 *
 * Der Stau ist ein Zustand des laufenden Vorgangs, kein Nachweis. Ein
 * Neustart soll ihn vergessen: Danach ist die Schlange im Bot ohnehin leer,
 * und die Sperre waere eine Behauptung ueber eine Welt, die es nicht mehr
 * gibt. Was bleiben soll, steht im Ausgang - jeder ausgesetzte Auftrag
 * hinterlaesst dort seine Zeile mit Grund.
 *
 * @module streaming/dashboard/ausgabe/kanalstau
 */

/**
 * Wie viele Fristen in Folge einen Kanal sperren.
 *
 * Acht, nicht fuenf: Ein einzelner Auftrag schoepft mit seinen fuenf
 * Versuchen die Fuenf schon aus. Bei acht ist sicher, dass es nicht der eine
 * haengende Aufruf war, sondern der Kanal.
 */
const SCHWELLE = 8;

/**
 * Wie lange eine Sperre haelt, bevor wieder einer durchdarf.
 *
 * Zehn Minuten sind zwei Bearbeitungstakte. Laenger waere bequemer fuer den
 * Eimer, aber dann bliebe der Text eines kurz gestauten Kanals unnoetig lange
 * stehen. Nach Ablauf geht **ein** Auftrag durch (halb offen); scheitert der,
 * ist sofort wieder zu, weil der Zaehler auf der Schwelle stehen bleibt.
 */
const DAUER_MS = 10 * 60_000;

/** @type {Map<string, {fristen: number, gesperrtBis: number, seit: number}>} */
const kanaele = new Map();

/**
 * Ist dieser Fehler eine ueberschrittene Frist?
 *
 * Nur Fristen zaehlen. Ein "Nachricht nicht gefunden" oder ein fehlendes
 * Recht sagt nichts ueber den Eimer aus - und wuerde einen gesunden Kanal
 * sperren.
 *
 * @param {string|null} fehler Fehlertext
 * @returns {boolean} true bei einer Frist
 */
function istFrist(fehler) {
    const text = String(fehler || '');
    return /Frist von \d+ ms ueberschritten/i.test(text) || /timed out/i.test(text);
}

/**
 * Steht dieser Kanal gerade unter Sperre?
 *
 * @param {string} kanalId Kanalkennung
 * @returns {boolean} true, wenn ausgesetzt werden soll
 */
function gestaut(kanalId) {
    const stand = kanaele.get(String(kanalId));
    if (!stand) return false;
    return Date.now() < stand.gesperrtBis;
}

/**
 * Wie lange die Sperre noch haelt - fuer den Text im Ausgang.
 *
 * @param {string} kanalId Kanalkennung
 * @returns {number} Sekunden, 0 wenn frei
 */
function restSekunden(kanalId) {
    const stand = kanaele.get(String(kanalId));
    if (!stand) return 0;
    return Math.max(0, Math.ceil((stand.gesperrtBis - Date.now()) / 1000));
}

/**
 * Einen Fehlversuch melden.
 *
 * @param {string} kanalId Kanalkennung
 * @param {string|null} fehler Fehlertext des Versuchs
 * @returns {boolean} true, wenn dieser Versuch die Sperre ausgeloest hat
 */
function fehlversuch(kanalId, fehler) {
    if (!kanalId || !istFrist(fehler)) return false;

    const id = String(kanalId);
    const stand = kanaele.get(id) || { fristen: 0, gesperrtBis: 0, seit: 0 };
    stand.fristen += 1;

    if (stand.fristen < SCHWELLE) {
        kanaele.set(id, stand);
        return false;
    }

    const warOffen = Date.now() >= stand.gesperrtBis;
    stand.gesperrtBis = Date.now() + DAUER_MS;
    if (warOffen) stand.seit = Date.now();
    kanaele.set(id, stand);
    return warOffen;
}

/**
 * Einen Erfolg melden - der Kanal ist wieder frei.
 *
 * @param {string} kanalId Kanalkennung
 * @returns {void}
 */
function erfolg(kanalId) {
    if (!kanalId) return;
    kanaele.delete(String(kanalId));
}

/**
 * Was gerade gesperrt ist. Fuer Wartung und Wachskripte.
 *
 * @returns {Array<{kanal_id: string, fristen: number, rest_s: number}>} Stand
 */
function stand() {
    const jetzt = Date.now();
    return [...kanaele.entries()]
        .filter(([, s]) => jetzt < s.gesperrtBis)
        .map(([kanal_id, s]) => ({
            kanal_id, fristen: s.fristen, rest_s: Math.ceil((s.gesperrtBis - jetzt) / 1000)
        }));
}

/**
 * Alles vergessen. Nur fuer Tests und den Neustart.
 *
 * @returns {void}
 */
function leeren() {
    kanaele.clear();
}

module.exports = { SCHWELLE, DAUER_MS, istFrist, gestaut, restSekunden, fehlversuch, erfolg, stand, leeren };
