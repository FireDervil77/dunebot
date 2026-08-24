'use strict';

/**
 * Twitch-Adapter.
 *
 * **Die einzige Datei im Plugin, die Twitch-Vokabular kennen darf.** Alles
 * dahinter spricht das Hausvokabular aus
 * docs/streamer-plugin/01-Schichten-und-Vertraege.md: ging_live, beendet,
 * geaendert, widerrufen. Wer Twitch-Begriffe durch den Kern zieht, bekommt
 * YouTube nie hinein und Kick schon gar nicht.
 *
 * Alle Angaben hier sind am 2026-08-23 in der Twitch-Doku nachgeschlagen,
 * nicht aus dem Gedaechtnis:
 *
 *   - Signatur: HMAC-SHA256 ueber Message-Id + Timestamp + roher Koerper,
 *     Praefix `sha256=`, zeitsicherer Vergleich
 *     <https://dev.twitch.tv/docs/eventsub/handling-webhook-events/>
 *   - Bestaetigung: 200 mit dem `challenge` als **Rohtext**
 *   - Abos: App-Token zwingend fuer Webhook-Transport, Kosten 1 ohne
 *     Nutzerfreigabe, Vorgabe 10 000 je Anwendung, hoechstens 3 Abos mit
 *     gleichem Typ und gleicher Bedingung
 *     <https://dev.twitch.tv/docs/eventsub/manage-subscriptions/>
 *
 * @module streaming/dashboard/plattformen/twitch
 */

const crypto = require('crypto');
const { ServiceManager } = require('dunebot-core');
const { zugangsdaten } = require('../../shared/models');

const HELIX = 'https://api.twitch.tv/helix';
const IDAPI = 'https://id.twitch.tv/oauth2';

/** Wie alt eine Zustellung hoechstens sein darf. Unsere Festlegung, keine Twitch-Vorgabe. */
const HOECHSTALTER_MS = 10 * 60 * 1000;

/**
 * Welche Ereignisse dieser Adapter abonniert.
 *
 * Steht hier und nicht im Kern: Es sind Twitch-Woerter. Kick und YouTube
 * bringen ihre eigenen mit, und der Kern darf keines davon kennen.
 * `channel.update` kostet 0.
 */
const EREIGNISSE = ['stream.online', 'stream.offline', 'channel.update'];

/** App-Token im Speicher - es ist jederzeit neu beschaffbar und gehoert nicht in die Datenbank. */
let token = { wert: null, gueltigBis: 0 };

/**
 * App-Token holen oder erneuern.
 *
 * @returns {Promise<string>} Zugangstoken
 * @throws {Error} wenn keine Zugangsdaten hinterlegt sind
 */
async function appToken() {
    if (token.wert && Date.now() < token.gueltigBis - 60_000) return token.wert;

    const daten = await zugangsdaten('TWITCH');
    if (!daten.clientId || !daten.clientSecret) {
        throw new Error('Keine Twitch-Zugangsdaten hinterlegt (Streaming > Betrieb)');
    }

    const antwort = await fetch(`${IDAPI}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: daten.clientId,
            client_secret: daten.clientSecret,
            grant_type: 'client_credentials'
        })
    });

    if (!antwort.ok) {
        throw new Error(`Twitch-Token abgelehnt (${antwort.status}): ${await antwort.text()}`);
    }

    const json = await antwort.json();
    token = { wert: json.access_token, gueltigBis: Date.now() + (json.expires_in || 3600) * 1000 };
    ServiceManager.get('Logger').info('[Streaming/Twitch] App-Token erneuert');
    return token.wert;
}

/**
 * Aufruf gegen Helix, mit Kopfzeilen und Fehlertext.
 *
 * @param {string} pfad Pfad ab /helix
 * @param {Object} [optionen] fetch-Optionen
 * @returns {Promise<Object>} { ok, status, json, headers }
 */
async function helix(pfad, optionen = {}) {
    const daten = await zugangsdaten('TWITCH');
    const antwort = await fetch(`${HELIX}${pfad}`, {
        ...optionen,
        headers: {
            'Client-Id': daten.clientId,
            Authorization: `Bearer ${await appToken()}`,
            'Content-Type': 'application/json',
            ...(optionen.headers || {})
        }
    });

    let json = null;
    const text = await antwort.text();
    if (text) { try { json = JSON.parse(text); } catch { json = { rohtext: text }; } }

    return { ok: antwort.ok, status: antwort.status, json, headers: antwort.headers };
}

/**
 * Kanalname zu Kanal-Datensatz.
 *
 * Abonniert wird auf die numerische ID, nicht auf den Namen: Ein umbenannter
 * Kanal bleibt derselbe Datensatz.
 *
 * @param {string} eingabe Kanalname oder Adresse
 * @returns {Promise<Object|null>} { kanal_id, login, anzeigename, avatar } oder null
 */
async function aufloesen(eingabe) {
    // twitch.tv/name, @name, name - alles landet beim Namen
    const login = String(eingabe || '')
        .trim()
        .replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '')
        .replace(/^@/, '')
        .split(/[/?#]/)[0]
        .toLowerCase();

    if (!/^[a-z0-9_]{3,25}$/.test(login)) return null;

    const { ok, json } = await helix(`/users?login=${encodeURIComponent(login)}`);
    if (!ok || !json?.data?.length) return null;

    const u = json.data[0];
    return { kanal_id: u.id, login: u.login, anzeigename: u.display_name, avatar: u.profile_image_url };
}

/**
 * Abonnements anlegen.
 *
 * @param {string} kanalId Numerische Twitch-ID
 * @param {Array<string>} ereignisse z. B. ['stream.online']
 * @param {string} rueckrufAdresse Vollstaendige HTTPS-Adresse
 * @param {string} geheimnis Geheimnis dieses Abos
 * @returns {Promise<Array>} je Ereignis ein Ergebnis
 */
async function abonnieren(kanalId, ereignisse, rueckrufAdresse, geheimnis) {
    const ergebnisse = [];

    for (const typ of ereignisse) {
        const { ok, status, json } = await helix('/eventsub/subscriptions', {
            method: 'POST',
            body: JSON.stringify({
                type: typ,
                version: '1',
                condition: { broadcaster_user_id: String(kanalId) },
                transport: { method: 'webhook', callback: rueckrufAdresse, secret: geheimnis }
            })
        });

        const abo = json?.data?.[0];
        ergebnisse.push({
            ereignis: typ,
            ok,
            status,
            anbieter_abo_id: abo?.id || null,
            zustand: abo?.status || null,
            kosten: abo?.cost ?? 1,
            // Der Fehlertext von Twitch ist brauchbar - er wird nicht gedeutet,
            // sondern durchgereicht und angezeigt.
            fehler: ok ? null : (json?.message || `HTTP ${status}`)
        });
    }

    return ergebnisse;
}

/**
 * Abonnement abbestellen.
 *
 * @param {string} aboId Abo-Kennung bei Twitch
 * @returns {Promise<boolean>} true, wenn weg (auch wenn es schon weg war)
 */
async function abbestellen(aboId) {
    const { ok, status } = await helix(`/eventsub/subscriptions?id=${encodeURIComponent(aboId)}`, {
        method: 'DELETE'
    });
    // 404 heisst: gibt es nicht mehr. Das ist das Ziel, kein Fehler.
    return ok || status === 404;
}

/**
 * Alle Abos dieser Anwendung - Grundlage des Abgleichs.
 *
 * @returns {Promise<{abos: Array, kosten: number, grenze: number}>} Bestand
 */
async function abosAuflisten() {
    const abos = [];
    let cursor = null;
    let kosten = 0;
    let grenze = 0;

    do {
        const pfad = '/eventsub/subscriptions' + (cursor ? `?after=${encodeURIComponent(cursor)}` : '');
        const { ok, json } = await helix(pfad);
        if (!ok) break;

        abos.push(...(json.data || []));
        kosten = json.total_cost ?? kosten;
        grenze = json.max_total_cost ?? grenze;
        cursor = json.pagination?.cursor || null;
    } while (cursor);

    return { abos, kosten, grenze };
}

/**
 * Anreichern: Titel, Kategorie, Zuschauer, Vorschaubild.
 *
 * `stream.online` bringt davon nichts mit. Bewusst **stapelweise** - Helix
 * nimmt bis zu 100 Kanaele je Anfrage, und eine Schleife "je Guild eine
 * Abfrage" ist bei 200 Guilds sofort tot (800 Punkte je Minute, ein Eimer
 * fuer alles).
 *
 * @param {Array<string>} kanalIds Numerische IDs
 * @returns {Promise<Map<string, Object>>} kanalId -> Angaben
 */
async function anreichern(kanalIds) {
    const ergebnis = new Map();
    const ids = [...new Set(kanalIds.map(String))].filter(Boolean);

    for (let i = 0; i < ids.length; i += 100) {
        const teil = ids.slice(i, i + 100);
        const abfrage = teil.map(id => `user_id=${encodeURIComponent(id)}`).join('&');
        const { ok, json } = await helix(`/streams?${abfrage}&first=100`);
        if (!ok) continue;

        for (const s of json.data || []) {
            ergebnis.set(String(s.user_id), {
                sendung_id: s.id,
                // Der Kanalname kann sich aendern. Twitch gibt alte Namen
                // spaeter wieder frei - ein veralteter Link zeigt dann ins
                // Leere oder, schlimmer, auf einen fremden Kanal.
                login: s.user_login || null,
                anzeigename: s.user_name || null,
                titel: s.title || null,
                kategorie: s.game_name || null,
                zuschauer: typeof s.viewer_count === 'number' ? s.viewer_count : null,
                // Die Platzhalter im Adressmuster muessen ersetzt werden -
                // sonst laedt Discord eine 404-Grafik.
                vorschaubild: (s.thumbnail_url || '')
                    .replace('{width}', '1280').replace('{height}', '720') || null,
                begonnen_am: s.started_at || null
            });
        }
    }

    return ergebnis;
}

// =====================================================
// Eingehende Zustellungen
// =====================================================

/**
 * Signatur pruefen.
 *
 * @param {Object} headers Kopfzeilen der Anfrage
 * @param {Buffer} roherKoerper Unveraenderter Koerper
 * @param {string} geheimnis Geheimnis des Abos
 * @returns {boolean} true, wenn gueltig
 */
function signaturPruefen(headers, roherKoerper, geheimnis) {
    const id = headers['twitch-eventsub-message-id'];
    const zeit = headers['twitch-eventsub-message-timestamp'];
    const signatur = headers['twitch-eventsub-message-signature'];
    if (!id || !zeit || !signatur || !geheimnis) return false;

    const erwartet = 'sha256=' + crypto
        .createHmac('sha256', geheimnis)
        .update(Buffer.concat([Buffer.from(id, 'utf8'), Buffer.from(zeit, 'utf8'), roherKoerper]))
        .digest('hex');

    // Laengen zuerst: timingSafeEqual wirft bei ungleicher Laenge, und ein
    // Absturz ist keine Ablehnung.
    const a = Buffer.from(erwartet, 'utf8');
    const b = Buffer.from(String(signatur), 'utf8');
    if (a.length !== b.length) return false;

    return crypto.timingSafeEqual(a, b);
}

/**
 * Ist die Zustellung zu alt? Schutz gegen Wiedereinspielung.
 *
 * Die zehn Minuten sind **unsere** Festlegung - die Doku nennt kein Fenster.
 *
 * @param {Object} headers Kopfzeilen
 * @returns {boolean} true, wenn zu alt oder ohne Zeitstempel
 */
function zuAlt(headers) {
    const zeit = Date.parse(headers['twitch-eventsub-message-timestamp'] || '');
    if (Number.isNaN(zeit)) return true;
    return Math.abs(Date.now() - zeit) > HOECHSTALTER_MS;
}

/**
 * Welche der drei Nachrichtenarten ist das?
 *
 * @param {Object} headers Kopfzeilen
 * @returns {string} 'bestaetigung' | 'ereignis' | 'widerruf' | 'unbekannt'
 */
function einordnen(headers) {
    switch (headers['twitch-eventsub-message-type']) {
        case 'webhook_callback_verification': return 'bestaetigung';
        case 'notification':                  return 'ereignis';
        case 'revocation':                    return 'widerruf';
        default:                              return 'unbekannt';
    }
}

/**
 * Woran erkennen wir, zu welchem Abo eine Zustellung gehoert?
 *
 * Der Eingang braucht das, um das Geheimnis nachzuschlagen - er soll dafuer
 * aber nicht in Twitchs Koerper greifen muessen.
 *
 * @param {Object} koerper Geparster Koerper
 * @returns {{aboId: string|null, kanalId: string|null, ereignis: string|null}} Kennung
 */
function kennung(koerper) {
    return {
        aboId: koerper?.subscription?.id || null,
        kanalId: koerper?.subscription?.condition?.broadcaster_user_id
            ? String(koerper.subscription.condition.broadcaster_user_id) : null,
        ereignis: koerper?.subscription?.type || null
    };
}

/**
 * Eindeutige Kennung der Zustellung - Grundlage der Dublettenerkennung.
 *
 * @param {Object} headers Kopfzeilen
 * @returns {string|null} Kennung
 */
function nachrichtId(headers) {
    return headers['twitch-eventsub-message-id'] || null;
}

/**
 * Um welches Ereignis geht es? Aus Kopfzeile oder Koerper.
 *
 * @param {Object} headers Kopfzeilen
 * @param {Object} [koerper] Koerper
 * @returns {string|null} Ereignistyp
 */
function ereignisTyp(headers = {}, koerper = null) {
    return headers['twitch-eventsub-subscription-type'] || koerper?.subscription?.type || null;
}

/**
 * Grund eines Widerrufs, im Klartext.
 *
 * @param {Object} koerper Koerper
 * @returns {string} Grund
 */
function widerrufsGrund(koerper) {
    return koerper?.subscription?.status || 'unbekannt';
}

/**
 * Twitch-Ereignis in Hausvokabular uebersetzen.
 *
 * @param {Object} headers Kopfzeilen
 * @param {Object} koerper Geparster Koerper
 * @returns {Object|null} Hausereignis oder null
 */
function uebersetzen(headers, koerper) {
    const typ = ereignisTyp(headers, koerper);
    const e = koerper?.event || {};
    const kanal = e.broadcaster_user_id || koerper?.subscription?.condition?.broadcaster_user_id;
    if (!kanal) return null;

    const gemeinsam = { plattform: 'twitch', kanal_id: String(kanal), login: e.broadcaster_user_login || null };

    switch (typ) {
        case 'stream.online':
            return {
                ...gemeinsam,
                art: 'ging_live',
                // Die Feldnamen sind an der Doku-Uebersicht abgelesen und beim
                // ersten echten Ereignis nachzumessen - hier wird nichts
                // erfunden, fehlende Werte bleiben null.
                sendung_id: e.id ? String(e.id) : null,
                begonnen_am: e.started_at || null
            };

        case 'stream.offline':
            return { ...gemeinsam, art: 'beendet', beendet_am: new Date().toISOString() };

        case 'channel.update':
            return {
                ...gemeinsam,
                art: 'geaendert',
                titel: e.title || null,
                kategorie: e.category_name || null
            };

        default:
            return null;
    }
}

module.exports = {
    name: 'twitch',
    HOECHSTALTER_MS,
    EREIGNISSE,
    kennung,
    nachrichtId,
    ereignisTyp,
    widerrufsGrund,
    appToken,
    aufloesen,
    abonnieren,
    abbestellen,
    abosAuflisten,
    anreichern,
    signaturPruefen,
    zuAlt,
    einordnen,
    uebersetzen
};
