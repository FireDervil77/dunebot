'use strict';

/**
 * Registrierungsstelle fuer Kontoverknuepfungen (Twitch, Kick, YouTube, …).
 *
 * **Warum eine Registry und nicht drei Seiten in drei Plugins:** Widerruf,
 * Loeschung und Auskunft muessen an einer Stelle passieren. Laege jede
 * Verknuepfung bei ihrem Plugin, haette ein geloeschtes Konto irgendwo noch
 * einen Eintrag - und niemand wuesste, wo. Deshalb gehoert der Speicher in
 * den Kern (`user_connections`), die Seite ins Profil, und das Wissen ueber
 * die Plattform ins Plugin.
 *
 * **Der Kern kennt keine Plattform.** Er weiss nur, dass es welche gibt. Wer
 * Twitch anbieten will, traegt sich hier ein - genau wie bei
 * `WebhookRegistry`. Eintragen ist eine Handlung, kein Versprechen: Was nicht
 * eingetragen ist, erscheint auch nicht auf der Seite. Eine Zeile "Kick
 * (demnaechst)" waere ein leeres Versprechen, und davon hat dieses Projekt
 * genug (siehe Baustelle 73).
 *
 * **Diese Stelle speichert keine Zugangsschluessel.** Sie stellt fest, WER
 * jemand auf der Plattform ist; abgelegt wird nur dieser Nachweis. Braucht
 * eine Funktion spaeter dauerhaften Zugriff im Namen des Benutzers, ist das
 * eine eigene Entscheidung - nicht die stille Folge einer Verknuepfung.
 *
 * ## Was ein Anbieter mitbringen muss
 *
 * ```js
 * VerbindungsRegistry.register('twitch', {
 *     label:  'Twitch',
 *     symbol: 'fa-brands fa-twitch',
 *     farbe:  '#9146FF',
 *
 *     // Wohin der Benutzer geschickt wird. `state` MUSS durchgereicht werden.
 *     async autorisierUrl({ state, rueckrufUrl }) { return 'https://…'; },
 *
 *     // Der Rueckruf bringt einen `code`. Daraus wird die Identitaet.
 *     // Rueckgabe: { kontoId, kontoName } - oder null, wenn es nicht klappte.
 *     async identitaet({ code, rueckrufUrl }) { return { kontoId, kontoName }; }
 * });
 * ```
 *
 * Beides sind Funktionen des Plugins. Der Kern ruft sie auf und schreibt das
 * Ergebnis weg; er baut selbst keine URL und kennt kein Geheimnis.
 *
 * @module dunebot-sdk/VerbindungsRegistry
 */

/** @type {Map<string, Object>} */
const anbieter = new Map();

/** Name: klein, Ziffern, Bindestrich - nichts, was einen Pfad verlassen kann. */
const NAME_MUSTER = /^[a-z0-9-]{2,32}$/;

/**
 * Einen Anbieter eintragen.
 *
 * @param {string} name Kuerzel, z. B. 'twitch' - steht im Pfad des Rueckrufs
 * @param {Object} beschreibung Siehe Modulkopf
 * @returns {boolean} true, wenn eingetragen
 */
function register(name, beschreibung) {
    if (!NAME_MUSTER.test(String(name || ''))) {
        throw new Error(`VerbindungsRegistry: unzulaessiger Name "${name}" (erlaubt: ${NAME_MUSTER})`);
    }
    if (!beschreibung || typeof beschreibung !== 'object') {
        throw new Error(`VerbindungsRegistry: Beschreibung fuer "${name}" fehlt`);
    }
    for (const pflicht of ['autorisierUrl', 'identitaet']) {
        if (typeof beschreibung[pflicht] !== 'function') {
            // Frueh und laut scheitern. Ein Anbieter, dem eine der beiden
            // Funktionen fehlt, wuerde sonst erst auffallen, wenn ein Benutzer
            // auf "Verbinden" klickt - und dort sieht ein Fehlschlag aus wie
            // "die Plattform will gerade nicht".
            throw new Error(`VerbindungsRegistry: "${name}" hat kein ${pflicht}()`);
        }
    }
    anbieter.set(name, {
        name,
        label: beschreibung.label || name,
        symbol: beschreibung.symbol || 'fa-solid fa-link',
        farbe: beschreibung.farbe || null,
        hinweis: beschreibung.hinweis || null,
        autorisierUrl: beschreibung.autorisierUrl,
        identitaet: beschreibung.identitaet
    });
    return true;
}

/**
 * Eintrag entfernen - beim Abschalten eines Plugins.
 *
 * **Die Verknuepfungen bleiben.** Ein abgeschaltetes Plugin ist kein Widerruf:
 * Der Benutzer hat seine Zugehoerigkeit belegt, und das bleibt wahr, auch
 * wenn gerade niemand danach fragt. Loeschen darf nur er selbst.
 *
 * @param {string} name Kuerzel
 * @returns {boolean} true, wenn etwas entfernt wurde
 */
function unregister(name) {
    return anbieter.delete(name);
}

/**
 * @param {string} name Kuerzel
 * @returns {Object|null} Anbieter oder null
 */
function get(name) {
    return anbieter.get(name) || null;
}

/**
 * @returns {Array<Object>} eingetragene Anbieter, fuer die Profilseite
 */
function list() {
    return [...anbieter.values()];
}

module.exports = { register, unregister, get, list, NAME_MUSTER };
