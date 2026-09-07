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
 * @typedef {Object} Bedingungsart
 * @property {string} art Schluessel, wie er in `giveaway_requirements.type` steht
 * @property {string} label Klartext fuer die Oberflaeche
 * @property {string} eingabe 'keine' | 'zahl' | 'text' - was der Betreiber eintraegt
 * @property {string} [hinweis] Was die Bedingung bedeutet
 */

/**
 * @typedef {Object} Losquelle
 * @property {string} label Klartext fuer die Oberflaeche, z. B. 'Twitch-Chat'
 * @property {Function} lose async (giveaway) => Los[] - die Lose dieser Verlosung
 * @property {Function} nennung (los) => string - wie der Gewinner genannt wird
 * @property {Function} [verkuenden] async (giveaway, los) => void - eigener Ansageweg
 * @property {Function} [verfuegbar] async (guildId) => boolean - fuer die Oberflaeche
 * @property {Function} [bedingungen] () => Bedingungsart[] - was dieser Weg pruefen kann
 * @property {Function} [pruefen] async (bedingungen, kontext) => {ok, grund}
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

// ---------------------------------------------------------------------------
// Die Gegenrichtung: wer haelt ueberhaupt Verlosungen?
// ---------------------------------------------------------------------------

/**
 * Bis hierher ging es nur um die Ziehung: Das Verlosungs-Plugin fragt, wer ihm
 * Lose liefert. Der Weg **hinein** braucht die andere Richtung - `!los` im
 * Twitch-Chat muss wissen, welche Verlosung gerade offen ist.
 *
 * Der naheliegende Weg waere gewesen, dass das Streaming-Plugin `giveaways`
 * abfragt. Das waere eine fremde Tabelle: Ihr Aufbau gehoert einem anderen
 * Plugin, ihre Kollation muss nicht zur eigenen passen, und ohne das Plugin
 * gibt es sie gar nicht.
 *
 * Stattdessen traegt das Verlosungs-Plugin **sich selbst** hier ein. Damit
 * beantwortet die Registry nebenbei die Frage, die dieses ganze Vorhaben
 * ausgeloest hat: **Ist das andere Plugin da?** Ist es geladen, steht der
 * Dienst hier. Ist es das nicht, steht hier nichts - und das ist die Antwort,
 * ohne dass jemand einen Namen raten muss.
 *
 * Ob es fuer **diese Guild** eingeschaltet ist, weiss der Dienst selbst am
 * besten; er prueft es in `offeneVerlosung`.
 */

/**
 * @typedef {Object} Verlosungsdienst
 * @property {Function} offeneVerlosung async (guildId) => {id, preis, endet_am}|null
 */

/** @type {Verlosungsdienst|null} */
let dienstEintrag = null;

/**
 * Den Verlosungsdienst eintragen.
 *
 * @param {Verlosungsdienst} dienst Der Dienst
 * @returns {boolean} true, wenn eingetragen
 */
function dienstSetzen(dienst) {
    if (typeof dienst?.offeneVerlosung !== 'function') {
        throw new Error('LosquellenRegistry: Verlosungsdienst ohne "offeneVerlosung"');
    }
    dienstEintrag = dienst;
    return true;
}

/**
 * Den Dienst wieder herausnehmen - beim Abschalten des Plugins.
 *
 * **Ohne das waere der Eintrag eine Behauptung.** Er sagt "es gibt hier
 * Verlosungen"; bleibt er nach dem Abschalten stehen, fragt das Streaming-
 * Plugin weiter nach und bekommt jedes Mal `null` - also dieselbe Antwort wie
 * bei einer Guild ohne laufende Verlosung. Der Unterschied zwischen "gerade
 * keine" und "gibt es hier gar nicht" waere weg, und der Zuschauer bekaeme im
 * Chat den falschen Satz.
 *
 * @returns {boolean} true, wenn etwas entfernt wurde
 */
function dienstEntfernen() {
    const hatte = dienstEintrag !== null;
    dienstEintrag = null;
    return hatte;
}

/**
 * @returns {Verlosungsdienst|null} der Dienst, oder null wenn es keinen gibt
 */
function dienst() {
    return dienstEintrag;
}

/**
 * Alle Bedingungen, die eingetragene Quellen pruefen koennen.
 *
 * **Das Verlosungs-Plugin fragt hier nach, statt sie zu kennen.** Bis zum
 * 2026-09-07 hatte der Stream-Weg genau eine Bedingung, und die stand als
 * eigene Spalte `stream_nur_abonnenten` in `giveaways` - also im *falschen*
 * Plugin. Die zweite haette eine zweite Spalte gebraucht, und spaetestens
 * dort haette `giveaway` wissen muessen, was ein Twitch-Abonnent ist.
 *
 * Der Katalog kommt deshalb von der Quelle. Das Verlosungs-Plugin zeigt ihn
 * an, speichert den gewaehlten Schluessel und gibt ihn beim Pruefen zurueck -
 * verstehen muss es ihn nie.
 *
 * @returns {Array<Object>} Bedingungsarten, jede mit ihrer Quelle
 */
function bedingungsarten() {
    const alle = [];
    for (const [name, quelle] of quellen.entries()) {
        if (typeof quelle.bedingungen !== 'function') continue;
        for (const art of quelle.bedingungen() || []) {
            alle.push({ ...art, quelle: name });
        }
    }
    return alle;
}

/**
 * Alles vergessen. Nur fuer Tests.
 *
 * @returns {void}
 */
function leeren() {
    quellen.clear();
    dienstEintrag = null;
}

module.exports = {
    register, unregister, get, list, nennung, leeren, NAME_MUSTER, EIGEN,
    bedingungsarten, dienstSetzen, dienstEntfernen, dienst
};
