'use strict';

/**
 * Registrierungsstelle fuer die Steuerung von Servern, die ein anderes Plugin
 * betreibt.
 *
 * # Warum es das gibt
 *
 * Der Zusatz „Streamserver" im Streaming-Plugin stoppt einen Gameserver, wenn
 * der letzte ausgewaehlte Streamer offline ist (Baustelle 118, Bauplan
 * `docs/streamer-plugin/17-Streamserver.md`). Der naheliegende Weg waere ein
 * `require` auf `plugins/gameserver/dashboard/helpers/ServerStopp` gewesen.
 *
 * **Dieselbe Regel wie bei `MusikablageRegistry`: wer ohne den anderen
 * weiterlaufen muss, kennt ihn nicht.** Der Gameserver laeuft seit jeher ohne
 * Twitch. Also traegt `gameserver` hier ein, was er anbietet, ohne zu wissen,
 * wer es benutzt - und `streaming` fragt nach, ohne `gameserver` zu `require`n.
 * Fehlt das Gameserver-Plugin, fehlt der Eintrag, und der Zusatz sagt es.
 *
 * # Was ein Anbieter zusagt
 *
 * - **`spieler` ist `null`, wenn die Zahl unbekannt ist** - auch wenn sie zu alt
 *   ist. Eine gescheiterte oder veraltete Abfrage ist keine Auskunft „niemand
 *   da". Wer das hier als 0 liefert, laesst Server mit Spielern stoppen.
 * - **`stoppen` benutzt den Stoppweg des Anbieters**, keinen eigenen. Beim
 *   Gameserver ist das `ServerStopp.stoppe` (Baustelle 119).
 *
 * Geprueft wird der Vertrag beim Eintragen, nicht beim Benutzen: Ein Anbieter
 * ohne `stoppen` fiele sonst erst auf, wenn ein Server stehen bleibt, der gehen
 * sollte - und dann sucht niemand mehr in einer Registrierung.
 *
 * @module dunebot-sdk/ServersteuerungRegistry
 */

/**
 * @typedef {Object} ServerZustand
 * @property {number} id Kennung im Namensraum des Anbieters
 * @property {string} name Anzeigename
 * @property {string} status Zustand, z. B. 'online', 'offline', 'stopping'
 * @property {number|null} spieler Spieler auf dem Server; null = unbekannt
 */

/**
 * @typedef {Object} Anbieter
 * @property {string} label Klartext fuer die Oberflaeche
 * @property {Function} server async (guildId) => ServerZustand[]
 * @property {Function} zustand async (guildId, serverId) => ServerZustand|null
 * @property {Function} stoppen async (guildId, serverId, {grund}) => {ok, grund?, eingereiht?}
 * @property {Function} [starten] async (guildId, serverId, {grund}) => {ok, grund?}
 */

/** Erlaubte Namen. Derselbe Zuschnitt wie bei der Musikablage. */
const NAME_MUSTER = /^[a-z][a-z0-9_-]{1,31}$/;

/** Was jeder Anbieter koennen muss. `starten` ist angeboten, nicht Pflicht. */
const PFLICHT = ['server', 'zustand', 'stoppen'];

/** @type {Map<string, Anbieter>} */
const anbieter = new Map();

/**
 * Einen Anbieter eintragen.
 *
 * @param {string} name Name, z. B. 'gameserver'
 * @param {Anbieter} eintrag Der Vertrag
 * @returns {boolean} true bei Erfolg
 * @throws {Error} bei unzulaessigem Namen oder unvollstaendigem Vertrag
 */
function register(name, eintrag) {
    if (!NAME_MUSTER.test(String(name || ''))) {
        throw new Error(`ServersteuerungRegistry: unzulaessiger Name "${name}" (erlaubt: ${NAME_MUSTER})`);
    }
    for (const feld of PFLICHT) {
        if (typeof eintrag?.[feld] !== 'function') {
            throw new Error(`ServersteuerungRegistry: "${name}" hat keine Funktion "${feld}"`);
        }
    }
    if (eintrag.starten !== undefined && typeof eintrag.starten !== 'function') {
        throw new Error(`ServersteuerungRegistry: "${name}" hat "starten", aber keine Funktion`);
    }
    anbieter.set(name, eintrag);
    return true;
}

/**
 * Einen Anbieter austragen.
 *
 * @param {string} name Name
 * @returns {boolean} true, wenn einer da war
 */
function unregister(name) {
    return anbieter.delete(name);
}

/**
 * Einen Anbieter holen.
 *
 * @param {string} name Name
 * @returns {Anbieter|null} Der Anbieter oder null
 */
function get(name) {
    return anbieter.get(name) || null;
}

/**
 * Alle eingetragenen Anbieter.
 *
 * @returns {Array<{name: string, anbieter: Anbieter}>} Liste
 */
function list() {
    return [...anbieter.entries()].map(([name, eintrag]) => ({ name, anbieter: eintrag }));
}

module.exports = { register, unregister, get, list, NAME_MUSTER };
