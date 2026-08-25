'use strict';

/**
 * FormAntwort - eine Route, zwei Wege.
 *
 * **Das Stueck, das im Haus fehlte.** Am 2026-08-25 fiel dem Betreiber auf, dass
 * keine einzige Speicherroute des Streaming-Plugins ueber die Toasts geht.
 * Nachgemessen: Streaming ist der einzige Ausreisser - alle anderen Plugins
 * antworten mit `res.json(...)` und lassen den Browser einen Toast zeigen.
 * Nachgesehen, warum: Es gibt **keinen gemeinsamen Helfer**. Jede Ansicht baut
 * ihr eigenes `fetch` und ihren eigenen Aufruf von `showToast`;
 * `discord-roles.ejs` definiert sogar ein eigenes `showToast` neben dem
 * globalen. Wer heute eine Speicherroute baut, hat die Wahl zwischen
 * Abschreiben und dem klassischen Weg - und der klassische ist der ehrlichere.
 *
 * Dieser Helfer beendet die Wahl: **dieselbe Route bedient beide Wege.**
 *
 *   - Kommt die Anfrage von `form-toast.js` (Kopfzeile `X-Form-Toast`), gibt es
 *     JSON, und der Browser zeigt einen Toast, ohne die Seite neu zu laden.
 *   - Kommt sie von einem gewoehnlichen Formular - kein JavaScript, alte
 *     Browser, abgeschaltete Skripte -, gibt es genau die Weiterleitung wie
 *     bisher.
 *
 * Das ist kein Zugestaendnis, sondern der Grund, warum man es so bauen darf:
 * Ohne diese Zweigleisigkeit muesste jede Umstellung auf Toasts die Bedienung
 * ohne JavaScript aufgeben, und niemand koennte hinterher sagen, wann das
 * passiert ist.
 *
 * **Der Text kommt vom Server.** Bisher standen die Meldungstexte in den
 * Ansichten, aufgeschluesselt nach `?ok=entfernt`. Fuer einen Toast muss der
 * Text mitkommen - also gehoert er dorthin, wo die Handlung entschieden wird.
 * Der Kurzschluessel bleibt trotzdem erhalten: Er steht weiter in der
 * Adresszeile, damit der klassische Weg unveraendert funktioniert und ein
 * Lesezeichen auf `?ok=gespeichert` nicht ins Leere zeigt.
 *
 * @module dunebot-sdk/FormAntwort
 */

/** Kopfzeile, mit der sich `form-toast.js` zu erkennen gibt. */
const KOPFZEILE = 'x-form-toast';

/**
 * Will der Aufrufer JSON?
 *
 * Bewusst eine **eigene** Kopfzeile und kein Schnueffeln an `Accept`: Browser
 * schicken bei einem gewoehnlichen Formular je nach Lage `Accept:
 * text/html,application/xhtml+xml,...`, manche Erweiterungen haengen
 * `application/json` an, und dann bekaeme ein normaler Klick ploetzlich JSON
 * statt einer Seite. Ein Merkmal, das nur wir setzen, kann nicht zufaellig
 * zutreffen.
 *
 * @param {Object} req Express-Anfrage
 * @returns {boolean} true, wenn JSON gewuenscht ist
 */
function willJson(req) {
    return Boolean(req?.headers?.[KOPFZEILE]);
}

/**
 * Erfolg melden.
 *
 * @param {Object} req Express-Anfrage
 * @param {Object} res Express-Antwort
 * @param {Object} angaben Beschreibung
 * @param {string} angaben.zurueck Pfad fuer die klassische Weiterleitung
 * @param {string} angaben.ok Kurzschluessel fuer die Adresszeile, z. B. 'gespeichert'
 * @param {string} angaben.text Klartext fuer den Toast
 * @param {string} [angaben.art='success'] 'success' | 'info' | 'warning'
 * @param {string} [angaben.geheZu] Adresse, auf die der Browser danach wechseln soll
 * @returns {*} Express-Antwort
 */
function antworte(req, res, { zurueck, ok, text, art = 'success', geheZu } = {}) {
    if (willJson(req)) {
        return res.json({ success: true, art, message: text || '', schluessel: ok || null, geheZu: geheZu || null });
    }

    // Der klassische Weg bleibt Zeichen fuer Zeichen der alte.
    const ziel = geheZu || zurueck;
    return res.redirect(ok ? `${ziel}?ok=${encodeURIComponent(ok)}` : ziel);
}

/**
 * Fehlschlag melden.
 *
 * **Der Statuscode bleibt 200.** Ein abgelehntes Formular ist kein
 * Serverfehler, und `form-toast.js` muesste sonst zwischen "der Server hat
 * geantwortet, aber Nein gesagt" und "der Server ist kaputt" unterscheiden -
 * beim zweiten faellt es bewusst auf den klassischen Weg zurueck. Wer hier
 * 4xx sendet, bekommt genau diesen Rueckfall bei jedem Tippfehler des Nutzers.
 *
 * @param {Object} req Express-Anfrage
 * @param {Object} res Express-Antwort
 * @param {Object} angaben Beschreibung
 * @param {string} angaben.zurueck Pfad fuer die klassische Weiterleitung
 * @param {string} angaben.fehler Kurzschluessel fuer die Adresszeile
 * @param {string} angaben.text Klartext fuer den Toast
 * @param {string} [angaben.art='error'] 'error' | 'warning'
 * @returns {*} Express-Antwort
 */
function antworteFehler(req, res, { zurueck, fehler, text, art = 'error' } = {}) {
    if (willJson(req)) {
        return res.json({ success: false, art, message: text || '', schluessel: fehler || null });
    }
    return res.redirect(fehler ? `${zurueck}?fehler=${encodeURIComponent(fehler)}` : zurueck);
}

module.exports = { antworte, antworteFehler, willJson, KOPFZEILE };
