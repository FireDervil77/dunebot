'use strict';

/**
 * Registrierungsstelle fuer zusaetzliche Lose einer Verlosung.
 *
 * # Warum es das gibt
 *
 * Eine Verlosung soll auch aus dem Twitch-Chat heraus mitspielbar sein. Der
 * naheliegende Weg waere gewesen, dass das Verlosungs-Plugin die Lose des
 * Streaming-Plugins holt - also `giveaway` den Namen `streaming` kennt. Genau
 * das ist die falsche Richtung: `giveaway` erfuellt seine Aufgabe seit jeher
 * ohne Twitch und muss es weiter tun, auch wenn es das Streaming-Plugin auf
 * einer Anlage gar nicht gibt.
 *
 * Deshalb liegt die Stelle hier und nicht in einem der beiden Plugins.
 * **Das abhaengige Plugin traegt sich ein, das thematische fragt nur nach.**
 * Keines der beiden `require`t das andere.
 *
 * Der Gegenentwurf steht im Bestand und zeigt, warum:
 * `plugins/gameserver/dashboard/routes/servers.js` holt sich
 * `masterserver/dashboard/models/RootServer` per hartem `require` - dreimal,
 * ungeprueft. Fehlte masterserver, floege die Route beim Laden.
 *
 * # Was eine Quelle liefert
 *
 * Lose, keine Kennungen. Der Unterschied entscheidet:
 * `giveaway_entries.user_id` haelt Discord-Kennungen, und in `<@id>` gerendert
 * ergibt eine Twitch-Kennung eine kaputte Erwaehnung, in einer Direktnachricht
 * einen Fehlschlag. Beides stuerzt nicht ab - es wird leise falsch. Ein Los
 * traegt deshalb **seine Herkunft mit**, und jede Ausgabestelle fragt das Los
 * statt die Kennung.
 *
 * @module dunebot-sdk/LosquellenRegistry
 */

/**
 * @typedef {Object} Los
 * @property {string} quelle Herkunft ('discord' oder der Name einer Quelle)
 * @property {string} kennung Kennung im Namensraum der Quelle
 * @property {string|null} name Anzeigename, soweit die Quelle einen kennt
 * @property {number} anzahl Wie viele Lose diese Person haelt
 */

/**
 * @typedef {Object} Losquelle
 * @property {string} label Klartext fuer die Oberflaeche, z. B. 'Twitch-Chat'
 * @property {Function} lose async (giveaway) => Los[] - die Lose dieser Verlosung
 * @property {Function} nennung (los) => string - wie der Gewinner genannt wird
 * @property {Function} [verkuenden] async (giveaway, los) => void - eigener Ansageweg
 * @property {Function} [verfuegbar] async (guildId) => boolean - fuer die Oberflaeche
 */

/** @type {Map<string, Losquelle>} */
const quellen = new Map();

/** Name: klein, Ziffern, Bindestrich. 'discord' ist vergeben. */
const NAME_MUSTER = /^[a-z0-9-]{2,32}$/;

/** Die Herkunft der Lose, die das Verlosungs-Plugin selbst haelt. */
const EIGEN = 'discord';

/**
 * Eine Losquelle eintragen.
 *
 * @param {string} name Name der Quelle, z. B. 'streaming'
 * @param {Losquelle} quelle Die Quelle
 * @returns {boolean} true, wenn eingetragen
 */
function register(name, quelle) {
    if (!NAME_MUSTER.test(String(name || ''))) {
        throw new Error(`LosquellenRegistry: unzulaessiger Name "${name}" (erlaubt: ${NAME_MUSTER})`);
    }
    if (name === EIGEN) {
        throw new Error(`LosquellenRegistry: "${EIGEN}" ist die eigene Herkunft der Verlosung und nicht eintragbar`);
    }
    for (const feld of ['lose', 'nennung']) {
        if (typeof quelle?.[feld] !== 'function') {
            throw new Error(`LosquellenRegistry: "${name}" hat keine Funktion "${feld}"`);
        }
    }
    quellen.set(name, quelle);
    return true;
}

/**
 * Eintrag entfernen - beim Abschalten eines Plugins.
 *
 * @param {string} name Name
 * @returns {boolean} true, wenn etwas entfernt wurde
 */
function unregister(name) {
    return quellen.delete(name);
}

/**
 * @param {string} name Name
 * @returns {Losquelle|null} Quelle oder null
 */
function get(name) {
    return quellen.get(name) || null;
}

/**
 * @returns {Array<{name: string, quelle: Losquelle}>} alle eingetragenen Quellen
 */
function list() {
    return [...quellen.entries()].map(([name, quelle]) => ({ name, quelle }));
}

/**
 * Wie ein Gewinner genannt wird.
 *
 * **Die einzige Stelle, an der aus einem Los ein Text wird.** Ohne sie steht
 * an drei Stellen in `GiveawayManager` ein `<@${id}>`, und die dritte wird
 * beim naechsten Umbau vergessen.
 *
 * Eine unbekannte Quelle - Plugin abgeschaltet, seit die Verlosung lief -
 * ergibt den Anzeigenamen oder die Kennung. Nie ein `<@…>`: Eine Erwaehnung,
 * die auf eine fremde Kennung zeigt, trifft im schlechtesten Fall ein
 * unbeteiligtes Mitglied.
 *
 * @param {Los} los Das Los
 * @returns {string} Klartext fuer die Ansage
 */
function nennung(los) {
    if (!los) return '?';
    if (los.quelle === EIGEN) return `<@${los.kennung}>`;

    const quelle = quellen.get(los.quelle);
    if (quelle) return quelle.nennung(los);
    return los.name || String(los.kennung);
}

/**
 * Alles vergessen. Nur fuer Tests.
 *
 * @returns {void}
 */
function leeren() {
    quellen.clear();
}

module.exports = { register, unregister, get, list, nennung, leeren, NAME_MUSTER, EIGEN };
