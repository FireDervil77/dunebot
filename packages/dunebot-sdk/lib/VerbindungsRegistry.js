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
 * **Die Verknuepfung selbst speichert keine Zugangsschluessel.** Sie stellt
 * fest, WER jemand auf der Plattform ist; abgelegt wird nur dieser Nachweis.
 *
 * **Zusagen sind die eigene Entscheidung daneben** (seit 2026-08-26). Braucht
 * eine Funktion dauerhaften Zugriff im Namen des Benutzers, fragt sie eine
 * benannte *Zusage* an - nie einzelne Scopes aus der Adresszeile. Ein Anbieter
 * erklaert, welche Zusagen es bei ihm gibt und was sie kosten; der Benutzer
 * sieht und erteilt sie einzeln. Das Ergebnis liegt in
 * `user_connection_grants`, haengt per Fremdschluessel am Nachweis und faellt
 * mit ihm.
 *
 * **Warum benannte Zusagen und keine Scope-Liste:** Kaeme die Liste aus der
 * Anfrage, koennte jeder Link jede Berechtigung erfragen - der Benutzer saehe
 * einen Twitch-Dialog, der nach Moderationsrechten fragt, und haette keinen
 * Grund zu misstrauen. Der Name waehlt aus einer Liste, die im Quelltext des
 * Plugins steht. Dieselbe Ueberlegung wie bei `sicheresZiel` im Router.
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
 * ## Was ein Anbieter zusaetzlich mitbringen muss, wenn er Zusagen anbietet
 *
 * ```js
 * VerbindungsRegistry.register('twitch', {
 *     …,
 *     // Benannte Zusagen. Der Name steht im Link, die Scopes nie.
 *     zusagen: {
 *         'abo-rollen': { label: 'Abonnenten lesen', scopes: ['channel:read:subscriptions'] }
 *     },
 *
 *     // Wie `identitaet`, gibt aber zusaetzlich die Schluessel zurueck.
 *     // { kontoId, kontoName, zugang, erneuerung, laeuftAbSek, scopes }
 *     async tauschen({ code, rueckrufUrl }) { … },
 *
 *     // Neuen Zugang aus der Erneuerung. Gleiche Rueckgabe ohne kontoId.
 *     async erneuern({ erneuerung }) { … },
 *
 *     // PFLICHT bei Twitch: stuendlich pruefen. { gueltig, scopes, kontoId }
 *     async pruefen({ zugang }) { … }
 * });
 * ```
 *
 * **Alle drei oder keine.** Ein Anbieter mit `zusagen`, aber ohne `pruefen`,
 * wuerde Schluessel sammeln, die niemand nachhaelt - und bei Twitch waere das
 * ein Verstoss gegen die Auflage, Token stuendlich zu pruefen. Deshalb weist
 * `register` das ab, statt es beim ersten Benutzer auffallen zu lassen.
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
    // Zusagen sind freiwillig - aber wer sie anbietet, muss sie auch pflegen
    // koennen. Ein Anbieter, der Schluessel einsammelt und weder erneuern noch
    // pruefen kann, faellt sonst erst Wochen spaeter auf: dann naemlich, wenn
    // der erste Token ablaeuft und niemand zustaendig ist.
    const zusagen = pruefeZusagen(name, beschreibung);

    anbieter.set(name, {
        name,
        label: beschreibung.label || name,
        symbol: beschreibung.symbol || 'fa-solid fa-link',
        farbe: beschreibung.farbe || null,
        hinweis: beschreibung.hinweis || null,
        autorisierUrl: beschreibung.autorisierUrl,
        identitaet: beschreibung.identitaet,
        zusagen,
        tauschen: beschreibung.tauschen || null,
        erneuern: beschreibung.erneuern || null,
        pruefen: beschreibung.pruefen || null
    });
    return true;
}

/**
 * Die Zusagen eines Anbieters pruefen und in eine feste Form bringen.
 *
 * @param {string} name Anbieter
 * @param {Object} beschreibung Rohe Angaben
 * @returns {Object} gepruefte Zusagen, leer wenn keine angeboten werden
 */
function pruefeZusagen(name, beschreibung) {
    const roh = beschreibung.zusagen;
    if (!roh || typeof roh !== 'object' || !Object.keys(roh).length) {
        // Kein Angebot, keine Pflicht. So sieht ein reiner Nachweis-Anbieter
        // aus - und so sah Twitch bis zum 2026-08-26 aus.
        return {};
    }

    for (const pflicht of ['tauschen', 'erneuern', 'pruefen']) {
        if (typeof beschreibung[pflicht] !== 'function') {
            throw new Error(`VerbindungsRegistry: "${name}" bietet Zusagen an, hat aber kein ${pflicht}()`);
        }
    }

    const geprueft = {};
    for (const [schluessel, wert] of Object.entries(roh)) {
        if (!NAME_MUSTER.test(String(schluessel))) {
            throw new Error(`VerbindungsRegistry: "${name}" hat eine Zusage mit unzulaessigem Namen "${schluessel}"`);
        }
        const scopes = Array.isArray(wert?.scopes) ? wert.scopes.filter(Boolean).map(String) : [];
        if (!scopes.length) {
            // Eine Zusage ohne Scopes fragt nach nichts. Sie wuerde einen
            // Dialog zeigen, der nichts bewirkt - und danach glaubt der
            // Benutzer, er haette etwas erlaubt.
            throw new Error(`VerbindungsRegistry: Zusage "${schluessel}" von "${name}" nennt keine Scopes`);
        }
        geprueft[schluessel] = {
            name: schluessel,
            label: wert.label || schluessel,
            hinweis: wert.hinweis || null,
            scopes
        };
    }
    return geprueft;
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

/**
 * Die Scopes einer benannten Zusage - oder null, wenn es sie nicht gibt.
 *
 * Der einzige Weg von einem Namen zu Scopes. Wer hier null bekommt, hat einen
 * Namen erfunden; dann wird abgebrochen und nicht etwa "ohne Scopes"
 * weitergemacht.
 *
 * @param {string} name Anbieter
 * @param {string} zusage Name der Zusage
 * @returns {Array<string>|null} Scopes oder null
 */
function scopesVon(name, zusage) {
    const a = anbieter.get(name);
    const z = a?.zusagen?.[String(zusage || '')];
    return z ? [...z.scopes] : null;
}

module.exports = { register, unregister, get, list, scopesVon, NAME_MUSTER };
