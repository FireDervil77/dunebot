'use strict';

/**
 * Ticket - die Eröffnungsnachricht als Vorlage (K389, 2026-11-14).
 *
 * Anlass `ticket:eroeffnung`, je Kategorie eine (Stelle = ID der Kategorie,
 * leer = Tickets ohne Kategorie). Die Vorgabe steht hier einmal für Bot,
 * Dashboard und Migration: die drei Texte aus der Sprachdatei des Bots
 * (`HANDLER.OPEN_EMBED_*`) und davor die Erwähnung des Mitglieds, wie bis
 * 2026-11-14 (da stand der Titel in der Autorzeile, jetzt als Überschrift).
 *
 * @module ticket/shared/eroeffnung
 */

const fs = require('fs');
const path = require('path');

const EROEFFNUNG = 'ticket:eroeffnung';
const SPRACHEN = path.join(__dirname, '..', 'bot', 'locales');
const STANDARD_SPRACHE = 'de-DE';

/**
 * Die drei Texte der Vorgabe in der Sprachdatei des Bots. Als Konstante, weil
 * diese Datei Bot und Dashboard laden: `check-sprachdateien` kann einer Datei
 * in `shared/` nicht ansehen, welche Sprachdatei gilt. Dass es die Schlüssel
 * in beiden Sprachen gibt, prüft `scripts/check-vorlagen.js` (Lauf 17).
 */
const SCHLUESSEL = Object.freeze({
    titel: 'ticket:HANDLER.OPEN_EMBED_TITLE',
    beschreibung: 'ticket:HANDLER.OPEN_EMBED_DESC',
    fusszeile: 'ticket:HANDLER.OPEN_EMBED_FOOTER',
});

/**
 * Die Vorgabe der Eröffnungsnachricht.
 * @param {(schluessel: string) => string} t Übersetzer für `ticket:HANDLER.*`
 * @returns {Object} Vorlage
 */
function vorgabe(t) {
    return {
        form: 'embed',
        text: '{member:mention}',
        titel: t(SCHLUESSEL.titel),
        beschreibung: t(SCHLUESSEL.beschreibung),
        fusszeile: t(SCHLUESSEL.fusszeile),
    };
}

/** sprache → Inhalt der Sprachdatei (einmal je Prozess) */
const gelesen = new Map();

/**
 * Übersetzer aus der Sprachdatei des Bots, für Dashboard und Migration (dort
 * gibt es kein `guild.getT`). Unbekannte Sprache: Deutsch, wie der Bot.
 * @param {string} [sprache] z. B. `de-DE`
 * @returns {(schluessel: string) => string}
 */
function texteAus(sprache) {
    let s = /^[a-z]{2}-[A-Z]{2}$/.test(String(sprache || '')) ? sprache : STANDARD_SPRACHE;
    if (!fs.existsSync(path.join(SPRACHEN, `${s}.json`))) s = STANDARD_SPRACHE;
    if (!gelesen.has(s)) gelesen.set(s, JSON.parse(fs.readFileSync(path.join(SPRACHEN, `${s}.json`), 'utf8')));
    const j = gelesen.get(s);
    return (schluessel) => {
        const teile = String(schluessel).replace(/^ticket:/, '').split('.');
        let w = j;
        for (const t of teile) w = w && typeof w === 'object' ? w[t] : undefined;
        return typeof w === 'string' ? w : schluessel;
    };
}

module.exports = { EROEFFNUNG, SCHLUESSEL, vorgabe, texteAus };
