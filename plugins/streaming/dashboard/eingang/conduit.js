'use strict';

/**
 * Der zweite Eingang: die Conduit-Verbindung zu Twitch (Stufe 13a).
 *
 * **Warum nicht der Webhook, den es schon gibt.** Jede Chatnachricht kaeme
 * sonst als einzelner HTTP-Aufruf durch den Webhook-Mount, der bewusst **vor**
 * den Sicherheits-Middlewares haengt. Was fuer ein `stream.online` alle paar
 * Stunden richtig ist, ist fuer einen Nachrichtenstrom die falsche Tuer.
 *
 * **Warum im Dashboard und nicht im Bot** (entschieden 2026-08-28, abweichend
 * vom Papier vom 2026-08-23). Zwei Fakten kamen dazwischen:
 *
 *   1. **Der Bot kann Twitch gar nicht fragen.** In `apps/bot/.env` stehen
 *      weder `TWITCH_CLIENT_ID`/`_SECRET` noch `TOKEN_ENCRYPTION_KEY` —
 *      nachgesehen, nicht vermutet. Er haette den Shard nur ueber einen Umweg
 *      setzen koennen.
 *   2. **Dieser Umweg laege in einem 10-Sekunden-Fenster.** Twitch: *„you have
 *      10 seconds from the time you receive the Welcome message to associate
 *      it with a shard."* Am 2026-08-27 haben IPC-Handler bis zu 1200 s
 *      gebraucht (Baustelle 82). Ein Fenster von 10 s ist kein Ort fuer einen
 *      Zwischenschritt, dessen Dauer wir nicht garantieren koennen.
 *
 * Hier liegt beides im selben Vorgang: Die Welcome-Nachricht kommt an, und der
 * PATCH geht ohne Umweg raus.
 *
 * **Was diese Datei NICHT tut:** Sie bestellt keine Abonnements und schreibt
 * keine Chatnachrichten weg. Sie stellt die Leitung her und haelt sie. Was mit
 * ankommenden Nachrichten geschieht, ist eine eigene Entscheidung (auch eine
 * datenschutzrechtliche) und wird nicht nebenbei mitgebaut.
 *
 * @module streaming/dashboard/eingang/conduit
 */

const WebSocket = require('ws');
const { ServiceManager } = require('dunebot-core');
const twitch = require('../plattformen/twitch');

/** Twitchs Einstiegsadresse fuer EventSub ueber WebSocket. */
const EINSTIEG = 'wss://eventsub.wss.twitch.tv/ws';

/**
 * Wir betreiben genau **einen** Shard.
 *
 * Shards sind Twitchs Antwort auf Lastverteilung; sie werden gebraucht, wenn
 * ein Vorgang den Strom nicht mehr schafft. Mit drei beobachteten Kanaelen ist
 * das nicht der Fall, und ein zweiter Shard ohne Verbindung waere ein Loch:
 * Twitch verteilt per Kanal-Hash, also gingen die Ereignisse der halben Kanaele
 * ins Leere. **Mehr Shards erst, wenn einer nachweislich nicht reicht.**
 */
const SHARDS = 1;

/** Zuschlag auf Twitchs Keepalive-Frist, bevor wir die Leitung fuer tot halten. */
const KEEPALIVE_ZUSCHLAG_MS = 10_000;

/** Wartezeiten zwischen Verbindungsversuchen. Danach bleibt es bei der letzten. */
const WARTEN_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000];

/** @type {WebSocket|null} */
let draht = null;
/** @type {NodeJS.Timeout|null} */
let wache = null;
/** @type {NodeJS.Timeout|null} */
let neuerVersuch = null;
let fehlversuche = 0;
let beendet = false;

/** Was von aussen sichtbar ist. Nur Messwerte, keine Vermutungen. */
const stand = {
    conduitId: null,
    sitzungId: null,
    verbunden: false,
    shardZustand: null,
    seit: null,
    letzteNachricht: null,
    ereignisse: 0,
    fehler: null
};

/** @returns {Object} Logger */
const log = () => ServiceManager.get('Logger');
/** @returns {Object} Datenbankdienst */
const db = () => ServiceManager.get('dbService');

/**
 * Der aktuelle Stand der Leitung.
 *
 * **Absichtlich eine Kopie.** Wer den Stand anzeigt, soll ihn nicht aus
 * Versehen veraendern koennen.
 *
 * @returns {Object} Stand
 */
function zustand() {
    return { ...stand };
}

/**
 * Die Wache stellen: Bleibt Twitch zu lange still, gilt die Leitung als tot.
 *
 * **Ohne sie merkt niemand etwas.** Eine TCP-Verbindung kann offen aussehen und
 * nichts mehr liefern; `close` kommt dann nie. Twitch schickt eigens
 * `session_keepalive`, damit man das unterscheiden kann — wer nicht darauf
 * achtet, haelt eine tote Leitung fuer eine ruhige.
 *
 * @param {number} sekunden Twitchs `keepalive_timeout_seconds`
 * @returns {void}
 */
function wacheStellen(sekunden) {
    if (wache) clearTimeout(wache);
    const frist = (Number(sekunden) || 10) * 1000 + KEEPALIVE_ZUSCHLAG_MS;
    wache = setTimeout(() => {
        log().warn(`[Streaming/Conduit] ${frist} ms nichts gehoert — Leitung gilt als tot, neu aufbauen`);
        stand.fehler = 'Keepalive ausgeblieben';
        neuAufbauen();
    }, frist);
}

/**
 * Die Verbindung schliessen und neu aufbauen, mit wachsender Wartezeit.
 *
 * @param {string} [adresse] Abweichende Adresse (bei `session_reconnect`)
 * @returns {void}
 */
function neuAufbauen(adresse = EINSTIEG) {
    if (beendet) return;
    if (wache) { clearTimeout(wache); wache = null; }
    if (draht) {
        // Zuhoerer abraeumen, sonst loest das eigene `close` einen zweiten
        // Neuaufbau aus und die Versuche verdoppeln sich bei jedem Abriss.
        draht.removeAllListeners();
        try { draht.close(); } catch { /* schon zu */ }
        draht = null;
    }
    stand.verbunden = false;

    const warten = WARTEN_MS[Math.min(fehlversuche, WARTEN_MS.length - 1)];
    fehlversuche++;
    if (neuerVersuch) clearTimeout(neuerVersuch);
    neuerVersuch = setTimeout(() => verbinden(adresse), warten);
}

/**
 * Eine Nachricht von Twitch verarbeiten.
 *
 * @param {Object} nachricht Geparste Nachricht
 * @returns {Promise<void>}
 */
async function verarbeiten(nachricht) {
    const art = nachricht?.metadata?.message_type;
    const nutz = nachricht?.payload || {};

    // Jede Nachricht ist ein Lebenszeichen, nicht nur `session_keepalive`.
    if (nutz.session?.keepalive_timeout_seconds) {
        wacheStellen(nutz.session.keepalive_timeout_seconds);
    } else if (art === 'session_keepalive' || art === 'notification') {
        wacheStellen(stand.keepalive || 10);
    }

    switch (art) {
        case 'session_welcome': {
            stand.sitzungId = nutz.session?.id || null;
            stand.keepalive = nutz.session?.keepalive_timeout_seconds || 10;
            stand.verbunden = true;
            stand.seit = new Date();
            fehlversuche = 0;

            // **Ab hier laeuft eine Uhr von 10 Sekunden.** Deshalb steht
            // zwischen Empfang und PATCH nichts als dieser Aufruf.
            const gesetzt = await twitch.shardSetzen(stand.conduitId, 0, stand.sitzungId);
            stand.shardZustand = gesetzt.zustand;
            stand.fehler = gesetzt.fehler;

            if (gesetzt.ok) {
                log().success(`[Streaming/Conduit] verbunden, Shard 0 gesetzt (${gesetzt.zustand || 'ok'})`);
            } else {
                // **Kein stiller Rueckfall.** Ohne Shard liefert der Conduit
                // nichts, und die Verbindung saehe trotzdem gesund aus.
                log().error(`[Streaming/Conduit] Shard NICHT gesetzt: ${gesetzt.fehler}`);
            }
            break;
        }

        case 'session_reconnect': {
            // Twitch bittet um Umzug. Die alte Leitung bleibt bis zum Welcome
            // der neuen bestehen - deshalb hier kein Schliessen von Hand.
            const ziel = nutz.session?.reconnect_url || EINSTIEG;
            log().info('[Streaming/Conduit] Twitch bittet um Umzug');
            fehlversuche = 0;
            neuAufbauen(ziel);
            break;
        }

        case 'notification': {
            stand.ereignisse++;
            stand.letzteNachricht = new Date();
            // Noch bestellt niemand Abonnements auf diesen Conduit, also kann
            // hier nichts ankommen. Kaeme doch etwas, ist das eine Auskunft
            // wert - und keine stille Verwerfung.
            log().debug(`[Streaming/Conduit] Ereignis: ${nutz.subscription?.type || 'unbekannt'}`);
            break;
        }

        case 'revocation': {
            log().warn(`[Streaming/Conduit] Twitch hat ein Abo widerrufen: `
                     + `${nutz.subscription?.type} (${nutz.subscription?.status})`);
            break;
        }

        default:
            log().debug(`[Streaming/Conduit] unbeachtete Art: ${art}`);
    }
}

/**
 * Verbinden.
 *
 * @param {string} [adresse] Adresse
 * @returns {void}
 */
function verbinden(adresse = EINSTIEG) {
    if (beendet) return;

    draht = new WebSocket(adresse);

    draht.on('open', () => log().debug(`[Streaming/Conduit] Leitung offen (${adresse})`));

    draht.on('message', (roh) => {
        let nachricht = null;
        try { nachricht = JSON.parse(roh.toString()); }
        catch (err) {
            log().warn('[Streaming/Conduit] unlesbare Nachricht verworfen:', err.message);
            return;
        }
        // Der Fehler eines Handlers darf die Leitung nicht mitnehmen.
        verarbeiten(nachricht).catch(err =>
            log().error('[Streaming/Conduit] Fehler beim Verarbeiten', err));
    });

    draht.on('close', (code, grund) => {
        stand.verbunden = false;
        if (beendet) return;
        log().warn(`[Streaming/Conduit] Leitung zu (${code} ${grund || ''}) — neu aufbauen`);
        neuAufbauen();
    });

    draht.on('error', (err) => {
        stand.fehler = err.message;
        log().error('[Streaming/Conduit] Leitungsfehler', err);
        // `close` folgt auf `error`; der Neuaufbau haengt dort, damit er nicht
        // zweimal ausgeloest wird.
    });
}

/**
 * Den Eingang starten.
 *
 * **Reisst das Dashboard nicht mit.** Ohne Zugangsdaten oder bei einem
 * abgelehnten Conduit bleibt der Chat aus - alles andere am Streaming-Plugin
 * laeuft weiter. Der Grund steht im Protokoll und im Stand.
 *
 * @returns {Promise<boolean>} true, wenn die Leitung aufgebaut wird
 */
async function starten() {
    beendet = false;

    let conduit;
    try {
        conduit = await twitch.conduitSichern(SHARDS);
    } catch (err) {
        stand.fehler = err.message;
        log().error('[Streaming/Conduit] Conduit nicht erreichbar', err);
        return false;
    }

    if (!conduit.ok) {
        stand.fehler = conduit.fehler;
        log().error(`[Streaming/Conduit] Conduit nicht verfuegbar: ${conduit.fehler}`);
        return false;
    }

    stand.conduitId = conduit.conduitId;
    stand.fehler = null;
    log().info(`[Streaming/Conduit] Conduit ${conduit.conduitId} `
             + `(${conduit.neu ? 'neu angelegt' : 'vorhanden'}, ${conduit.shards} Shard(s))`);

    // Merken, damit die Abo-Bestellung ihn kennt, ohne Twitch zu fragen.
    try {
        await db().setConfig('streaming', 'CONDUIT_ID', conduit.conduitId, 'shared', '', true);
    } catch (err) {
        // Nicht schlimm: `conduitSichern` findet ihn beim naechsten Start wieder.
        log().warn('[Streaming/Conduit] CONDUIT_ID nicht gespeichert:', err.message);
    }

    verbinden();
    return true;
}

/**
 * Den Eingang beenden - fuer Abschalten des Plugins und fuer Tests.
 *
 * @returns {void}
 */
function beenden() {
    beendet = true;
    if (wache) { clearTimeout(wache); wache = null; }
    if (neuerVersuch) { clearTimeout(neuerVersuch); neuerVersuch = null; }
    if (draht) {
        draht.removeAllListeners();
        try { draht.close(); } catch { /* schon zu */ }
        draht = null;
    }
    stand.verbunden = false;
}

module.exports = { starten, beenden, zustand, EINSTIEG, SHARDS, WARTEN_MS };
