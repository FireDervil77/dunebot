/**
 * Textregel: was ein Text- oder Passwortwert erfüllen muss.
 *
 * Gebraucht seit dem 2026-10-25 (Stufe 9 S4). Der Windrose-Einladungscode
 * braucht mindestens 6 Zeichen aus 0–9, a–z, A–Z — ein falscher Code fiel bis
 * dahin erst beim Start auf, als Absturz des Spiels. Im Paket ist es
 * `pattern` (Regel, die der Wert GANZ erfüllen muss) mit `pattern_hint` (die
 * Regel in Worten), dazu das ältere `min_length`, das bis dahin nur im Schema
 * stand und von niemandem geprüft wurde.
 *
 * Ein leerer Wert wird nicht geprüft: Ob einer da sein muss, sagt `required`.
 *
 * Die Regel steht nur hier. Werkbank, Serverseite, Anlegen und Speichern fragen
 * dieses Modul; der Browser prüft mit derselben Rechnung vor
 * (`assets/js/textregel.js`, verglichen von `scripts/check-textregel.js`).
 *
 * @module helpers/Textregel
 */

'use strict';

const TYPEN = ['text', 'password'];

/** Trägt die Einstellung eine Regel, die hier geprüft wird? */
function hatRegel(einstellung) {
    if (!TYPEN.includes(einstellung?.type)) return false;
    return !!einstellung.pattern || Number.isInteger(einstellung.min_length);
}

/** Die Regel in Worten — der Hinweis des Pakets, sonst der Ausdruck selbst. */
function hinweis(einstellung) {
    if (!hatRegel(einstellung)) return null;
    const h = einstellung.pattern_hint;
    if (h && (h.de || h.en)) return h.de || h.en;
    const teile = [];
    if (Number.isInteger(einstellung.min_length)) teile.push(`mindestens ${einstellung.min_length} Zeichen`);
    if (einstellung.pattern) teile.push(`Regel: ${einstellung.pattern}`);
    return teile.join(' · ');
}

/**
 * Was die Ansicht braucht, um am Feld vorzuprüfen — oder null.
 * Der Browser rechnet damit dasselbe wie `fehlerDesWerts`.
 */
function fuerAnzeige(einstellung) {
    if (!hatRegel(einstellung)) return null;
    const h = einstellung.pattern_hint;
    return {
        muster:      einstellung.pattern || null,
        mindestens:  Number.isInteger(einstellung.min_length) ? einstellung.min_length : null,
        hinweis:     hinweis(einstellung),
        // Hat das Paket die Regel in Worten gefasst? Dann sagt die Meldung
        // diese Worte statt „mindestens 6 Zeichen, es sind 4".
        beschrieben: !!(h && (h.de || h.en)),
    };
}

/**
 * Die Rechnung selbst, auf der Form von `fuerAnzeige`. Der Browser hat sie
 * Zeile für Zeile gleich (`assets/js/textregel.js`); check-textregel.js
 * vergleicht beide an derselben Tabelle.
 */
function fehlerNachRegel(regel, wert) {
    if (!regel) return null;
    const text = wert === undefined || wert === null ? '' : String(wert);
    if (text === '') return null;
    if (regel.mindestens !== null && text.length < regel.mindestens) {
        return regel.beschrieben
            ? `erfüllt die Vorgabe nicht — ${regel.hinweis}`
            : `mindestens ${regel.mindestens} Zeichen, es sind ${text.length}`;
    }
    if (regel.muster) {
        let ausdruck;
        try {
            ausdruck = new RegExp(`^(?:${regel.muster})$`);
        } catch {
            return 'die Prüfregel im Paket ist kein gültiger Ausdruck';
        }
        if (!ausdruck.test(text)) return `erfüllt die Vorgabe nicht — ${regel.hinweis}`;
    }
    return null;
}

/**
 * Was an einem Wert nicht stimmt — in einem Satz, oder null.
 *
 * Der Wert selbst steht nie im Satz: Bei einem Passwort landete er sonst in
 * Meldungen und Logs. Eine kaputte Prüfregel im Paket ist ein Fehler des
 * Pakets; sie wird gemeldet, statt jeden Wert still durchzulassen.
 */
function fehlerDesWerts(einstellung, wert) {
    return fehlerNachRegel(fuerAnzeige(einstellung), wert);
}

/**
 * Der erste Fehler unter allen Text- und Passwortwerten eines Pakets — für
 * Anlegen (Dashboard und Discord), wo alle Werte auf einmal kommen.
 */
function fehlerInWerten(paket, werte) {
    for (const e of paket?.settings || []) {
        if (!hatRegel(e) || !werte || !(e.key in werte)) continue;
        const fehler = fehlerDesWerts(e, werte[e.key]);
        if (fehler) return `„${(e.name && (e.name.de || e.name.en)) || e.key}": ${fehler}`;
    }
    return null;
}

module.exports = { TYPEN, hatRegel, hinweis, fuerAnzeige, fehlerNachRegel, fehlerDesWerts, fehlerInWerten };
