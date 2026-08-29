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
 * ## Was ein Anbieter mitbringen kann, wenn der Benutzer etwas einstellen soll
 *
 * ```js
 * VerbindungsRegistry.register('twitch', {
 *     …,
 *     // Ein Abschnitt im Profil, der am Nachweis haengt (Stufe 13a).
 *     einstellungen: {
 *         titel: 'Mein Kanal',
 *         hinweis: 'Gilt fuer deinen Twitch-Kanal, unabhaengig von Discord.',
 *         // Wird nur fuer den Inhaber des Nachweises gerufen.
 *         // Rueckgabe: Liste von { label, zustand, text, hinweis?, tat? }
 *         async lesen({ userId, kontoId, kontoName }) { … }
 *     }
 * });
 * ```
 *
 * **Warum das ins Profil gehoert und nicht ins Plugin-Menue** (entschieden
 * 2026-08-28): Chat-Einstellungen gehoeren dem Kanalinhaber (F-18). Laegen sie
 * hinter einem Guild-Recht, entschiede die Serverleitung darueber, ob jemand
 * den Bot in **seinem eigenen** Chat regeln darf - und bei einem Streamer in
 * zwei Guilds waere gar nicht bestimmbar, wessen Recht zaehlt. Im Profil ist
 * die Tuer der Nachweis selbst, den niemand sonst vergeben oder entziehen
 * kann. Es gilt dieselbe Linie wie oben: Speicher in den Kern, Seite ins
 * Profil, Wissen ueber die Plattform ins Plugin.
 *
 * **`zustand` ist dreiwertig, und das ist der Kern der Sache.** `'ja'`,
 * `'nein'` und `'unbekannt'`. Wer nicht fragen konnte, muss `'unbekannt'`
 * melden - nie `'nein'`. Ein Streamer, dem die Seite "der Bot ist nicht in
 * deinem Chat" sagt, weil gerade eine Schnittstelle klemmte, sucht den Fehler
 * bei sich und tippt `/mod` ein zweites Mal.
 *
 * **Es gibt bewusst kein freies `schreiben()`.** Stufe 13a schloss an und
 * hoerte zu; der Bot sagte noch nichts. Ein Schalter fuer eine Faehigkeit, die
 * es nicht gibt, waere genau das leere Versprechen, gegen das diese Registry
 * gebaut wurde. Er kommt mit der Faehigkeit, nicht davor.
 *
 * **Seit Stufe 14 gibt es `wahl` - genau eine benannte Auswahl.** Sie kam mit
 * ihrer Faehigkeit: Der Kanalinhaber bestimmt, in welcher Guild sein Chatbot
 * verwaltet wird, und diese Wahl schaltet dort sichtbar einen Menuepunkt frei.
 *
 * Warum eine benannte Auswahl und kein freies Schreiben: Ein `schreiben()`
 * muesste beliebige Formulare eines Plugins im Profil darstellen - der Kern
 * kennt die Plattform aber nicht und soll sie nicht kennenlernen. Eine
 * Auswahlliste mit Beschriftung kann er darstellen, ohne etwas zu verstehen.
 *
 * ```js
 * wahl: {
 *     name: 'heim_guild',
 *     label: 'Chatbot verwalten in',
 *     hinweis: 'Nur dort erscheint der Chatbot-Bereich.',
 *     leerText: 'nirgends - Chatbot aus',
 *     async moeglich({ userId, kontoId }) { return [{ wert, text, aktiv }]; },
 *     async setzen({ userId, kontoId }, wert) { return { ok: true }; }
 * }
 * ```
 *
 * **`setzen` prueft selbst.** Der Kern reicht nur durch, wer angemeldet ist -
 * ob dieser Mensch das darf, weiss allein das Plugin (bei Twitch: ob sein
 * Nachweis auf genau diesen Kanal zeigt). Eine Pruefung im Kern waere eine
 * zweite, die irgendwann von der ersten abweicht.
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
    const einstellungen = pruefeEinstellungen(name, beschreibung);

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
        pruefen: beschreibung.pruefen || null,
        einstellungen
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
            scopes,
            // **Gehoert diese Zusage der Anlage statt einem Menschen?**
            // (Stufe 13a) Ein Bot-Konto stimmt einmal zu, und zwar vom
            // Betreiber ausgeloest. Im Profil eines Benutzers hat so eine
            // Zusage nichts verloren: Sie waere dort ein Knopf, der sein
            // eigenes Konto zum Chatbot machen wuerde.
            nurAnlage: wert.nurAnlage === true
        };
    }
    return geprueft;
}

/**
 * Den Einstellungs-Abschnitt eines Anbieters pruefen und in eine feste Form
 * bringen.
 *
 * **Freiwillig, aber nicht halb.** Wer einen Abschnitt anbietet, muss sagen
 * wie er heisst und woher sein Inhalt kommt. Ein Abschnitt ohne `lesen()`
 * waere eine Ueberschrift ohne Inhalt - und die Seite haette keine
 * Moeglichkeit, das von "gerade nichts zu zeigen" zu unterscheiden.
 *
 * @param {string} name Anbieter
 * @param {Object} beschreibung Rohe Angaben
 * @returns {Object|null} geprueft, oder null wenn keiner angeboten wird
 */
function pruefeEinstellungen(name, beschreibung) {
    const roh = beschreibung.einstellungen;
    if (roh === undefined || roh === null) return null;

    if (typeof roh !== 'object' || Array.isArray(roh)) {
        throw new Error(`VerbindungsRegistry: "${name}" hat einstellungen, die kein Objekt sind`);
    }
    if (typeof roh.lesen !== 'function') {
        throw new Error(`VerbindungsRegistry: "${name}" bietet einstellungen an, hat aber kein lesen()`);
    }
    if (!roh.titel || typeof roh.titel !== 'string') {
        throw new Error(`VerbindungsRegistry: einstellungen von "${name}" haben keinen titel`);
    }

    return {
        titel: roh.titel,
        hinweis: roh.hinweis || null,
        lesen: roh.lesen,
        wahl: pruefeWahl(name, roh.wahl)
    };
}

/**
 * Die eine benannte Auswahl eines Abschnitts pruefen (Stufe 14).
 *
 * **Halb angebotene Auswahl gibt es nicht.** Wer `moeglich` mitbringt, aber
 * kein `setzen`, baut ein Auswahlfeld, das nichts speichert - und wer `setzen`
 * ohne `moeglich` anbietet, ein Formular ohne Inhalt. Beides ist genau die
 * Attrappe, gegen die dieser Vertrag geschrieben ist, und beides faellt ohne
 * Pruefung erst dem Nutzer auf.
 *
 * @param {string} name Anbieter
 * @param {Object} [roh] Rohe Angaben
 * @returns {Object|null} gepruefte Auswahl oder null
 */
function pruefeWahl(name, roh) {
    if (roh === undefined || roh === null) return null;

    if (typeof roh !== 'object' || Array.isArray(roh)) {
        throw new Error(`VerbindungsRegistry: wahl von "${name}" ist kein Objekt`);
    }
    for (const feld of ['moeglich', 'setzen']) {
        if (typeof roh[feld] !== 'function') {
            throw new Error(`VerbindungsRegistry: wahl von "${name}" hat kein ${feld}()`);
        }
    }
    if (!roh.name || typeof roh.name !== 'string') {
        throw new Error(`VerbindungsRegistry: wahl von "${name}" hat keinen name`);
    }
    if (!roh.label || typeof roh.label !== 'string') {
        throw new Error(`VerbindungsRegistry: wahl von "${name}" hat kein label`);
    }

    return {
        name: roh.name,
        label: roh.label,
        hinweis: roh.hinweis || null,
        leerText: roh.leerText || '— keine —',
        moeglich: roh.moeglich,
        setzen: roh.setzen
    };
}

/** Die drei erlaubten Zustaende einer Zeile. Alles andere gilt als unbekannt. */
const ZUSTAENDE = ['ja', 'nein', 'unbekannt'];

/**
 * Den Abschnitt eines Anbieters fuer einen Benutzer holen.
 *
 * **Diese Funktion faellt nie durch.** Sie wird beim Aufbau einer Seite
 * gerufen, die auch ohne sie ihren Zweck erfuellt - das Profil zeigt
 * Verknuepfungen, ob der Chatbot nun erreichbar ist oder nicht. Ein Anbieter,
 * dessen Schnittstelle klemmt, darf die Seite nicht mitnehmen.
 *
 * **Aber sie schweigt auch nicht.** Was schiefging, steht als `'unbekannt'` mit
 * Grund in der Liste und im Protokoll. Der Rueckfall auf `'nein'` waere die
 * halbe Auskunft, die schlimmer ist als keine.
 *
 * @param {string} name Anbieter
 * @param {Object} ctx `{ userId, kontoId, kontoName }`
 * @param {Object} [logger] Etwas mit `.warn`; fehlt es, wird nur zurueckgegeben
 * @returns {Promise<Array<Object>>} Zeilen, ggf. leer
 */
async function einstellungenLesen(name, ctx, logger = null) {
    const a = anbieter.get(name);
    if (!a || !a.einstellungen) return [];

    let roh;
    try {
        roh = await a.einstellungen.lesen(ctx);
    } catch (error) {
        if (logger && typeof logger.warn === 'function') {
            logger.warn(`[VerbindungsRegistry] einstellungen.lesen von "${name}" gescheitert:`, error.message);
        }
        return [{
            label: a.einstellungen.titel,
            zustand: 'unbekannt',
            text: 'Konnte gerade nicht abgefragt werden.',
            hinweis: error.message || null,
            tat: null
        }];
    }

    if (!Array.isArray(roh)) return [];

    // Jede Zeile in die feste Form bringen. Ein Anbieter, der `zustand`
    // vergisst oder etwas Eigenes hineinschreibt, bekommt `'unbekannt'` -
    // nicht `'nein'`, aus demselben Grund wie oben.
    return roh.filter(Boolean).map(z => ({
        label: String(z.label || ''),
        zustand: ZUSTAENDE.includes(z.zustand) ? z.zustand : 'unbekannt',
        text: z.text ? String(z.text) : null,
        hinweis: z.hinweis ? String(z.hinweis) : null,
        tat: z.tat ? String(z.tat) : null
    })).filter(z => z.label);
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

/**
 * Die Auswahl eines Anbieters fuer einen Benutzer holen (Stufe 14).
 *
 * **Faellt nie durch**, aus demselben Grund wie `einstellungenLesen`: Sie wird
 * beim Aufbau des Profils gerufen, und das Profil erfuellt seinen Zweck auch
 * ohne sie. Was klemmt, kommt als leere Liste mit `grund` zurueck - dann
 * erscheint statt eines Auswahlfeldes ein Satz, der sagt, was nicht ging.
 *
 * **Kein Rueckfall auf "keine Auswahl vorhanden".** Eine leere Liste ohne
 * Grund saehe aus wie "du kannst nirgends waehlen" - dieselbe halbe Auskunft,
 * gegen die `zustand: 'unbekannt'` gebaut wurde.
 *
 * @param {string} name Anbieter
 * @param {Object} ctx `{ userId, kontoId, kontoName }`
 * @param {Object} [logger] Etwas mit `.warn`
 * @returns {Promise<Object|null>} `{ name, label, hinweis, leerText, optionen, grund }` oder null
 */
async function einstellungenWahlLesen(name, ctx, logger = null) {
    const a = anbieter.get(name);
    const w = a && a.einstellungen && a.einstellungen.wahl;
    if (!w) return null;

    const huelle = {
        name: w.name, label: w.label, hinweis: w.hinweis,
        leerText: w.leerText, optionen: [], grund: null
    };

    let roh;
    try {
        roh = await w.moeglich(ctx);
    } catch (error) {
        if (logger && typeof logger.warn === 'function') {
            logger.warn(`[VerbindungsRegistry] wahl.moeglich von "${name}" gescheitert:`, error.message);
        }
        huelle.grund = error.message || 'Die Auswahl konnte gerade nicht geladen werden.';
        return huelle;
    }

    huelle.optionen = (Array.isArray(roh) ? roh : []).filter(Boolean).map(o => ({
        wert: String(o.wert ?? ''),
        text: String(o.text ?? o.wert ?? ''),
        aktiv: !!o.aktiv
    })).filter(o => o.text);

    return huelle;
}

/**
 * Die Auswahl setzen (Stufe 14).
 *
 * **Diese Funktion faellt sehr wohl durch** - anders als das Lesen. Ein
 * Speichern, das im Stillen nichts tut, ist die schlimmste Sorte Attrappe:
 * Der Nutzer sieht "gespeichert" und glaubt, es gelte.
 *
 * **Der Kern prueft nicht, ob der Benutzer darf.** Er reicht `ctx` durch; ob
 * dieser Mensch diese Wahl treffen darf, weiss allein das Plugin - bei Twitch
 * etwa, ob sein Nachweis auf genau diesen Kanal zeigt. Eine zweite Pruefung
 * hier wuerde irgendwann von der ersten abweichen, und dann glaubt man der
 * falschen.
 *
 * @param {string} name Anbieter
 * @param {Object} ctx `{ userId, kontoId, kontoName }`
 * @param {string} wert Der gewaehlte Wert, leer zum Abschalten
 * @returns {Promise<{ok: boolean, grund?: string}>} Ergebnis
 */
async function einstellungenWahlSetzen(name, ctx, wert) {
    const a = anbieter.get(name);
    const w = a && a.einstellungen && a.einstellungen.wahl;
    if (!w) return { ok: false, grund: `"${name}" bietet keine Auswahl an.` };

    const ergebnis = await w.setzen(ctx, String(wert ?? ''));

    // Ein Plugin, das gar nichts zurueckgibt, hat nicht "erfolgreich"
    // gearbeitet - es hat sich nicht geaeussert. Das ist ein Fehler im
    // Plugin und soll auch so aussehen.
    if (!ergebnis || typeof ergebnis !== 'object') {
        return { ok: false, grund: `"${name}" hat auf das Setzen nicht geantwortet.` };
    }
    return { ok: !!ergebnis.ok, grund: ergebnis.grund || null };
}

module.exports = {
    register, unregister, get, list, scopesVon,
    einstellungenLesen, einstellungenWahlLesen, einstellungenWahlSetzen,
    NAME_MUSTER
};
