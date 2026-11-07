'use strict';

/**
 * OAuth-Rücksprünge: Der `state` gehört der Sitzung (Kassensturz K034, Betreiber 2026-11-07).
 *
 * Ein Weg für alle, die zu einem Anbieter hinschicken und von dort
 * zurückkommen: die Discord-Anmeldung, die Bot-Einladung und die
 * Kontoverknüpfungen (Twitch, Kick, YouTube …). Vorbild war die Einladung
 * (2026-09-16), die es als einzige schon richtig machte:
 *
 *   an die Sitzung gebunden  Ein Rücksprung aus einem anderen Browser findet
 *                            keinen Vorgang. Ohne das kann ein Fremder einen
 *                            Rücksprung mit SEINEM Code unterschieben und das
 *                            Opfer in sein Konto einloggen oder sein Twitch an
 *                            das Konto des Opfers hängen (Login-CSRF).
 *   befristet                je Zweck eine Frist
 *   einmal                   `pruefe` verbraucht den Vorgang, gültig oder nicht
 *   fester Zeitvergleich     `crypto.timingSafeEqual`
 *   Daten auf dem Server     Ziel, Zusage, Anlage stehen in der Sitzung, nicht
 *                            in der Adresse — der Rücksprung kann sie nicht
 *                            verändern
 *
 * Bis dahin (gemessen 2026-11-07): Die Anmeldung schickte gar keinen `state`
 * und prüfte keinen. `CheckAuth` legte für jeden Aufruf ohne Anmeldung eine
 * Zeile in der Tabelle `states` an, die niemand las — 739 seit dem
 * 2026-08-06, keine je verbraucht. Die Verknüpfungen hatten einen
 * Datenbank-State, gebunden an niemanden. Die Tabelle ist mit der Migration
 * `20261107_120000_states_entfernen` weg.
 *
 * Die Sitzungen liegen in MySQL (`session.middleware.js`), ein Vorgang
 * übersteht also einen Neustart des Dashboards.
 *
 * Geprüft von `scripts/check-ruecksprung.js`.
 */

const crypto = require('crypto');

/** Wo in der Sitzung die Vorgänge liegen, je Zweck einer. */
const SCHLUESSEL = 'ruecksprung';

/** Ein Zweck steht vorne im `state`, getrennt durch `:`. */
const ZWECK = /^[a-z][a-z0-9.-]{0,40}$/;

/**
 * Einen Vorgang beginnen und den `state` dafür liefern.
 *
 * Mit `teilen` behält eine Sitzung ihr Kennzeichen, solange es frisch ist: Die
 * Serverauswahl baut den Einladungslink in einer Schleife über alle Guilds,
 * und die Anmeldeseite kann zweimal offen sein. Ein neues Kennzeichen je
 * Aufruf machte jeden früheren Link ungültig. Die Daten sind die des letzten
 * Aufrufs.
 *
 * @param {Object} req Express-Anfrage, braucht `req.session`
 * @param {string} zweck z. B. `anmeldung`, `einladung`, `verbindung.twitch`
 * @param {{daten?: Object, fristMs: number, teilen?: boolean}} optionen
 * @returns {string} `zweck:kennzeichen`
 */
function beginne(req, zweck, { daten = {}, fristMs, teilen = false } = {}) {
    if (!ZWECK.test(String(zweck))) throw new Error(`Rücksprung: ungültiger Zweck „${zweck}"`);
    if (!req?.session) throw new Error('Rücksprung: keine Sitzung');
    if (!(Number(fristMs) > 0)) throw new Error('Rücksprung: Frist fehlt');

    const ablage = req.session[SCHLUESSEL] || (req.session[SCHLUESSEL] = {});
    const alt = ablage[zweck];
    const frisch = teilen && alt?.kennzeichen && Date.now() - Number(alt.zeit || 0) < fristMs;
    const kennzeichen = frisch ? alt.kennzeichen : crypto.randomBytes(16).toString('hex');

    ablage[zweck] = { kennzeichen, zeit: Date.now(), fristMs: Number(fristMs), daten };
    return `${zweck}:${kennzeichen}`;
}

/**
 * Der Zweck aus einem `state`, ohne etwas zu prüfen oder zu verbrauchen.
 *
 * @param {string} state
 * @returns {string|null}
 */
function zweckVon(state) {
    const wert = String(state || '');
    const ab = wert.indexOf(':');
    if (ab < 1) return null;
    const zweck = wert.slice(0, ab);
    return ZWECK.test(zweck) ? zweck : null;
}

/**
 * Einen Rücksprung prüfen und den Vorgang verbrauchen.
 *
 * Verbraucht wird immer, auch wenn die Prüfung scheitert: Ein zweiter Versuch
 * mit demselben Wert findet nichts mehr.
 *
 * @param {Object} req Express-Anfrage
 * @param {string} zweck erwarteter Zweck
 * @param {string} state roher Wert aus der Adresse
 * @returns {{gueltig: boolean, grund: string, daten: Object|null}}
 */
function pruefe(req, zweck, state) {
    const ablage = req?.session?.[SCHLUESSEL];
    const vorgang = ablage?.[zweck];
    if (ablage && zweck in ablage) delete ablage[zweck];

    const nein = (grund) => ({ gueltig: false, grund, daten: null });
    const wert = String(state || '');
    if (!wert.startsWith(`${zweck}:`)) return nein(wert ? 'fremder_zweck' : 'ohne_state');
    if (!vorgang?.kennzeichen) return nein('kein_vorgang');
    if (!gleich(vorgang.kennzeichen, wert.slice(zweck.length + 1))) return nein('kennzeichen_falsch');
    if (Date.now() - Number(vorgang.zeit || 0) > Number(vorgang.fristMs || 0)) return nein('abgelaufen');
    return { gueltig: true, grund: 'ok', daten: vorgang.daten || {} };
}

/**
 * Ein Ziel auf unserer eigenen Seite — oder null.
 *
 * Ein Ziel aus der Adresszeile ungeprüft zu übernehmen, wäre eine offene
 * Weiterleitung: ein Link, der bei uns beginnt und woanders endet. Erlaubt
 * ist deshalb nur ein Pfad, der mit genau einem `/` beginnt. Kein `\`, denn
 * Browser lesen ihn als `/` (`/\fremd.de` ist `//fremd.de`), kein Leerraum,
 * nichts unter `/auth/` (sonst endet eine Anmeldung in der nächsten oder im
 * Abmelden).
 *
 * @param {*} wert
 * @returns {string|null}
 */
function eigenesZiel(wert) {
    const z = String(wert ?? '');
    if (!z.startsWith('/') || z.length > 512) return null;
    if (z.startsWith('//') || /[\\\s\u0000-\u001f\u007f]/.test(z)) return null;
    if (/^\/auth(\/|\?|$)/i.test(z)) return null;
    return z;
}

/**
 * Zwei Zeichenketten in fester Zeit vergleichen.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function gleich(a, b) {
    const links = Buffer.from(String(a));
    const rechts = Buffer.from(String(b));
    if (links.length !== rechts.length) return false;
    return crypto.timingSafeEqual(links, rechts);
}

module.exports = { beginne, pruefe, zweckVon, eigenesZiel, SCHLUESSEL };
