'use strict';

/**
 * Welche Zusage hat der Kanalinhaber erteilt?
 *
 * ## Warum das eine eigene Datei ist
 *
 * Die Frage stand bis zum 2026-09-05 genau einmal im Plugin, in
 * `meinkanal.darfSchreiben` - fuer genau einen Scope. Mit P9 kommen zwei
 * weitere dazu (`clips:edit`, `channel:manage:polls`), und eine zweite Kopie
 * derselben zehn Zeilen waere eine zweite Wahrheit ueber dieselbe Sache: Wer
 * die eine spaeter aendert, sieht die andere nicht.
 *
 * Es ist deshalb **kein neuer Mechanismus, sondern ein herausgezogener** -
 * `meinkanal.darfSchreiben` ruft jetzt hier an und behaelt nur seinen eigenen
 * Satz fuer den Fall „gar kein Konto verknuepft".
 *
 * ## Am Schluessel nachgesehen, nicht an der Absicht
 *
 * Die Spalte `scopes` traegt, was Twitch zuletzt bestaetigt hat - die
 * stuendliche Pflichtpruefung schreibt sie fort. Ein eigenes
 * „hat zugestimmt"-Kaestchen daneben wuerde behaupten, was der Schluessel
 * laengst widerlegt hat.
 *
 * ## Dreiwertig, nicht zweiwertig
 *
 * `unbekannt` ist der Grund, warum es diese Form gibt. Wer nicht nachsehen
 * konnte, darf nicht `nein` sagen: Das schickte den Streamer in einen Dialog,
 * den er laengst durchlaufen hat - und beim zweiten Mal stuende dieselbe
 * Zusage noch einmal da, als haette die erste nicht gezaehlt.
 *
 * @module streaming/kern/zusagen
 */

const Verbindungsspeicher = require('../../../../apps/dashboard/helpers/Verbindungsspeicher');

/** Die drei Antworten, und mehr gibt es nicht. */
const STAND = {
    JA:        'ja',
    NEIN:      'nein',
    UNBEKANNT: 'unbekannt'
};

/**
 * Mehrere Scopes auf einmal - **mit einem einzigen Lesevorgang.**
 *
 * Die Mitmachen-Seite fragt zwei, die Chatbot-Seite einen. Je Frage einmal in
 * die Datenbank zu gehen waere dieselbe Zeile zweimal gelesen; und die zweite
 * Lesung koennte theoretisch eine andere Antwort geben als die erste, was auf
 * einer Seite besonders schlecht aussieht.
 *
 * @param {string|null} userId Discord-Benutzer, dem der Kanal gehoert
 * @param {Array<string>} scopes Welche Berechtigungen gefragt sind
 * @param {string} [plattform] Anbieter
 * @returns {Promise<Object<string, {zustand: string, grund: string|null}>>} Je Scope eine Auskunft
 */
async function staendeFuer(userId, scopes, plattform = 'twitch') {
    const gefragt = (scopes || []).filter(Boolean);

    /**
     * @param {string} zustand Einer aus STAND
     * @param {string|null} grund Erklaerung
     * @returns {Object} Alle gefragten Scopes mit derselben Antwort
     */
    const alle = (zustand, grund) => Object.fromEntries(
        gefragt.map(s => [s, { zustand, grund }]));

    if (!userId) return alle(STAND.NEIN, null);

    let zusage;
    try {
        zusage = await Verbindungsspeicher.zusageLesen(userId, plattform);
    } catch (err) {
        // **Melden statt ausweichen.** Ein Fehler beim Nachsehen ist kein
        // „nicht erteilt" - er ist eine Stoerung, und sie gehoert benannt.
        return alle(STAND.UNBEKANNT,
            `Die Berechtigungen sind gerade nicht lesbar (${err.message}).`);
    }

    if (!zusage) return alle(STAND.NEIN, null);

    const erteilt = new Set(String(zusage.scopes || '').split(' ').filter(Boolean));
    return Object.fromEntries(gefragt.map(s => [s, {
        zustand: erteilt.has(s) ? STAND.JA : STAND.NEIN,
        grund: null
    }]));
}

/**
 * Ein einzelner Scope.
 *
 * @param {string|null} userId Discord-Benutzer
 * @param {string} scope Berechtigung
 * @param {string} [plattform] Anbieter
 * @returns {Promise<{zustand: string, grund: string|null}>} Auskunft
 */
async function standFuer(userId, scope, plattform = 'twitch') {
    const staende = await staendeFuer(userId, [scope], plattform);
    return staende[scope] || { zustand: STAND.UNBEKANNT, grund: null };
}

module.exports = { STAND, standFuer, staendeFuer };
