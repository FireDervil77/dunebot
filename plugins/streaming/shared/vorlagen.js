'use strict';

/**
 * Streaming - was in einer Vorlage stehen darf und welche gilt.
 *
 * Eigene Datei, weil diese Regeln an drei Stellen gebraucht werden: der Router
 * prueft damit die Eingabe, die Ausgabe waehlt damit die Vorlage, und das
 * Pruefskript spielt sie ohne Datenbank durch. Laege das im Router, koennte
 * man es nur mit einer laufenden Anlage pruefen - und genau solche Regeln
 * werden dann nie geprueft.
 *
 * **Keine Datenbank, kein Discord, kein Express.** Werte herein, Urteil heraus.
 *
 * @module streaming/shared/vorlagen
 */

/**
 * Die gueltigen Platzhalter.
 *
 * Das ist ein **Vertrag** mit `dashboard/ausgabe/nachricht.js`: Was hier steht,
 * muss dort gefuellt werden. Ein Platzhalter, den nur diese Liste kennt,
 * erscheint woertlich in der Ankuendigung - und das sieht man erst im Discord.
 */
const PLATZHALTER = [
    { name: '{streamer}',  bedeutung: 'Anzeigename des Kanals' },
    { name: '{titel}',     bedeutung: 'Titel der Sendung' },
    { name: '{kategorie}', bedeutung: 'Spiel oder Kategorie' },
    { name: '{url}',       bedeutung: 'Adresse des Streams' },
    { name: '{zuschauer}', bedeutung: 'Zuschauerzahl' },
    { name: '{rolle}',     bedeutung: 'Erwaehnung der eingestellten Rolle' },
    { name: '{plattform}', bedeutung: 'Twitch, Kick oder YouTube' },
    { name: '{dauer}',     bedeutung: 'nur in der Rueckschau nach dem Stream' }
];

/** Discord nimmt 2000 Zeichen. Wir bleiben darunter, weil Platzhalter wachsen. */
const VORLAGE_MAX = 1000;

/** Was gilt, solange niemand etwas eingestellt hat. */
const VORGABE_LIVE       = '{rolle} {streamer} ist jetzt live!';
const VORGABE_RUECKSCHAU = '{streamer} war live — {dauer}.';

/**
 * Eine Vorlage pruefen, bevor sie gespeichert wird.
 *
 * Zwei Faelle, die im Betrieb wehtun: ein Text, der die Grenze von Discord
 * sprengt (die Ankuendigung scheitert dann **jedes** Mal, nicht einmal), und
 * ein erfundener Platzhalter.
 *
 * Leer ist ausdruecklich in Ordnung - das heisst "nimm den Standard".
 *
 * @param {string} text Vorlage
 * @returns {string|null} 'zu_lang' | 'platzhalter' | null
 */
function pruefeVorlage(text) {
    const t = String(text || '');
    if (t.length > VORLAGE_MAX) return 'zu_lang';

    const bekannt = new Set(PLATZHALTER.map(p => p.name));
    const benutzt = t.match(/\{[a-z_]+\}/gi) || [];
    if (benutzt.some(b => !bekannt.has(b.toLowerCase()))) return 'platzhalter';

    return null;
}

/**
 * Welche Vorlage gilt: die des Ziels, sonst die der Guild, sonst die Vorgabe.
 *
 * Wichtig ist die Behandlung von Leerraum: Ein Feld, in dem nur ein Leerzeichen
 * steht, ist **keine** Vorlage. Ohne diese Pruefung entstuende eine leere
 * Ankuendigung - technisch erfolgreich, im Discord unsichtbar.
 *
 * @param {string|null} eigene Vorlage des Ziels
 * @param {string|null} derGuild Standard der Guild
 * @param {string} vorgabe Letzter Rueckfall
 * @returns {string} die geltende Vorlage
 */
function vorlageWaehlen(eigene, derGuild, vorgabe) {
    const brauchbar = (w) => typeof w === 'string' && w.trim().length > 0;
    if (brauchbar(eigene))   return eigene;
    if (brauchbar(derGuild)) return derGuild;
    return vorgabe;
}

module.exports = {
    PLATZHALTER,
    VORLAGE_MAX,
    VORGABE_LIVE,
    VORGABE_RUECKSCHAU,
    pruefeVorlage,
    vorlageWaehlen
};
