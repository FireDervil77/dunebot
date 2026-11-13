'use strict';

/**
 * Fachereignisse: der Vertrag (G-01, docs/plugins/gemeinsam/konzept.md).
 *
 * Eine geschlossene Liste aller Namen, die ein Plugin melden kann
 * (`liste.json`). Jedes Plugin erklärt in seiner `package.json`, was es sendet
 * und hört: `"ereignisse": { "sendet": [...], "hoert": [...] }`. Der Kern
 * erklärt seine `kern.*`-Namen in `plugins/core/package.json`.
 * `scripts/check-ereignisse.js` hält Liste, Erklärungen und Code beisammen.
 *
 * Hier steht nur das Lesen. Melden und Hören kommen mit G-02 (Ereignisbuch,
 * Zusteller) und heißen dann `Ereignisse.melde('name', …)` und
 * `Ereignisse.hoere('name', …)`. Nur diese Schreibweise zählt der Wächter.
 */
const liste = require('./liste.json');

const NACH_NAME = new Map(liste.ereignisse.map(e => [e.name, e]));

/** Der Absender `kern` erklärt sich in diesem Plugin. */
const KERN_PLUGIN = 'core';

/** `*` passt auf alles, `ticket.*` auf alle Namen, die mit `ticket.` beginnen. */
function passt(muster, name) {
    if (muster === '*') return true;
    if (muster.endsWith('.*')) return name.startsWith(muster.slice(0, -1));
    return muster === name;
}

/** Feldart ohne das `?` für „darf fehlen“. */
const feldart = (art) => String(art).replace(/\?$/, '');

/**
 * Die Schutzklasse, die aus Akteur, Betroffenem und Feldern folgt. Steht in
 * der Liste ausdrücklich, damit Logging und Löschen sie ohne Rechnen lesen;
 * der Wächter verlangt, dass beide gleich sind.
 */
function schutzAus(eintrag) {
    const arten = Object.values(eintrag.felder || {}).map(feldart);
    if (arten.includes('text')) return 'inhalt';
    if (eintrag.akteur !== 'system' || eintrag.betroffen === 'mitglied'
        || arten.some(a => a === 'mitglied' || a === 'mitglieder' || a === 'konto')) return 'personenbezogen';
    return 'allgemein';
}

module.exports = {
    fassung: liste.fassung,
    liste,
    KERN_PLUGIN,
    eintrag: (name) => NACH_NAME.get(name) || null,
    kennt: (name) => NACH_NAME.has(name),
    passt,
    feldart,
    schutzAus,
};
