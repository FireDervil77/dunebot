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

/**
 * Ereignisse fuer Abonnenten-Rollen (Stufe 12b).
 *
 * **Getrennt von `EREIGNISSE`, weil sie etwas anderes kosten:** Diese drei
 * verlangen `channel:read:subscriptions` vom Kanalinhaber. Ein Kanal ohne
 * diese Zusage bekommt sie nicht — und soll deshalb auch nicht so tun, als
 * fehle etwas.
 *
 * **`channel.subscribe` allein genuegt nicht.** Es meldet nur das erste
 * Abonnement. Wer verlaengert, loest `channel.subscription.message` aus; wer
 * beschenkt wird, `channel.subscription.gift` fuer den Schenkenden UND
 * `channel.subscribe` fuer den Beschenkten. Das Ende meldet
 * `channel.subscription.end` — es ist das wichtigste der drei, denn ohne es
 * bleibt eine Rolle fuer immer.
 */
const EREIGNISSE_ABO = ['channel.subscribe', 'channel.subscription.end', 'channel.subscription.message'];

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
 * Zustand eines Abos ins Hausvokabular.
 *
 * Die Uebersetzung gehoert hierher und nirgendwo sonst: `enabled` und
 * `authorization_revoked` sind Twitch-Woerter. Wer sie im Kern vergleicht, hat
 * Twitch im Kern - und Kick bringt andere mit.
 *
 * Unbekanntes wird **nicht** stillschweigend auf "fehler" gelegt: Ein neuer
 * Zustand bei Twitch waere sonst ein Fehler, den es nicht gibt. Er kommt als
 * `null` zurueck, und der Aufrufer laesst die Zeile in Ruhe und protokolliert.
 *
 * @param {string} status Zustand bei Twitch
 * @returns {string|null} 'bestaetigt' | 'angefragt' | 'fehler' | 'widerrufen' | null
 */
function zustandUebersetzen(status) {
    switch (status) {
        case 'enabled':
            return 'bestaetigt';
        case 'webhook_callback_verification_pending':
            return 'angefragt';
        case 'webhook_callback_verification_failed':
        case 'notification_failures_exceeded':
            return 'fehler';
        case 'authorization_revoked':
        case 'moderator_removed':
        case 'user_removed':
        case 'version_removed':
        case 'chat_user_banned':
            return 'widerrufen';
        default:
            return null;
    }
}

/**
 * Alle Abos dieser Anwendung - Grundlage des Abgleichs.
 *
 * Gibt **uebersetzte** Zeilen zurueck, keine Rohdaten: Sonst muesste der Kern
 * `condition.broadcaster_user_id` lesen und haette damit Twitch-Vokabular.
 *
 * `unbekannt` traegt den Rohzustand, falls die Uebersetzung ihn nicht kennt -
 * damit im Protokoll steht, was Twitch wirklich gesagt hat.
 *
 * @returns {Promise<{abos: Array, kosten: number, grenze: number, vollstaendig: boolean}>} Bestand
 */
async function abosAuflisten() {
    const abos = [];
    let cursor = null;
    let kosten = 0;
    let grenze = 0;
    let vollstaendig = true;

    do {
        const pfad = '/eventsub/subscriptions' + (cursor ? `?after=${encodeURIComponent(cursor)}` : '');
        const { ok, json } = await helix(pfad);

        // Ein Abbruch mitten in der Blaetterung ist gefaehrlich: Die halbe
        // Liste sieht aus wie "die Haelfte der Abos ist weg" - und ein
        // Abgleich, der darauf handelt, bestellt sie ab. Deshalb ein Merker,
        // und der Aufrufer bricht ab, statt aufzuraeumen.
        if (!ok) { vollstaendig = false; break; }

        for (const a of json.data || []) {
            abos.push({
                anbieter_abo_id: a.id,
                ereignis:        a.type,
                kanal_id:        a.condition?.broadcaster_user_id || null,
                zustand:         zustandUebersetzen(a.status),
                unbekannt:       zustandUebersetzen(a.status) === null ? a.status : null,
                kosten:          a.cost ?? 0,
                rueckruf:        a.transport?.callback || null
            });
        }

        kosten = json.total_cost ?? kosten;
        grenze = json.max_total_cost ?? grenze;
        cursor = json.pagination?.cursor || null;
    } while (cursor);

    return { abos, kosten, grenze, vollstaendig };
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
 * @returns {Promise<{angaben: Map<string, Object>, vollstaendig: boolean}>} Angaben je kanalId, und ob alle Stapel durchkamen
 */
async function anreichern(kanalIds) {
    const ergebnis = new Map();
    let vollstaendig = true;
    const ids = [...new Set(kanalIds.map(String))].filter(Boolean);

    for (let i = 0; i < ids.length; i += 100) {
        const teil = ids.slice(i, i + 100);
        const abfrage = teil.map(id => `user_id=${encodeURIComponent(id)}`).join('&');
        const { ok, json } = await helix(`/streams?${abfrage}&first=100`);

        // **Ein gescheiterter Stapel ist nicht dasselbe wie "niemand ist
        // live".** Der Aufrufer liest ein fehlendes Ergebnis als "Stream
        // vorbei" und setzt den Zustand zurueck — bei einem Netzwerkfehler
        // waeren das ALLE laufenden Streams auf einmal, samt Rueckschau
        // mitten in der Sendung. Deshalb wird der Fehlschlag gemeldet, nicht
        // uebersprungen.
        if (!ok) { vollstaendig = false; continue; }

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

    return { angaben: ergebnis, vollstaendig };
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

        // **Abonnements (Stufe 12b).** `channel.subscribe` meldet das erste
        // Abonnement, `channel.subscription.message` jede Verlaengerung — fuer
        // die Rolle sind beide dasselbe: "diese Person ist Abonnent". Die
        // Unterscheidung braucht erst 12c, wenn daraus eine Meldung im Chat
        // werden soll.
        case 'channel.subscribe':
        case 'channel.subscription.message':
            return { ...gemeinsam, art: 'abonniert', abonnent: abonnentAus(koerper) };

        case 'channel.subscription.end':
            return { ...gemeinsam, art: 'abo_beendet', abonnent: abonnentAus(koerper) };

        default:
            return null;
    }
}

// =====================================================
// Kontoverknuepfung
// =====================================================
//
// **Warum hier und nicht im Kern:** Der Kern kennt keine Plattform. Er
// schickt den Benutzer weg und nimmt ihn wieder entgegen; WOHIN und WAS
// dabei zurueckkommt, weiss nur der Adapter. Genau dafuer gibt es
// `VerbindungsRegistry` — dieselbe Bauform wie `WebhookRegistry`.
//
// **Kein Scope.** `GET /helix/users` liefert mit einem Benutzertoken die
// eigenen Daten auch ohne jede Berechtigung; nur die E-Mail-Adresse braeuchte
// `user:read:email`, und die wollen wir nicht. Wer verknuepft, gibt uns damit
// **nichts** ausser dem Nachweis, dass ihm das Konto gehoert.
//
// Der leere `scope`-Wert ist Absicht und zulaessig — nachgesehen am
// 2026-08-26 im Twitch-Entwicklerforum, wo ein Moderator die Frage
// "Authorization Code Flow with a blank scope attribute?" mit "Yes"
// beantwortet (discuss.dev.twitch.com/t/…/17270). Der Parameter selbst gilt
// als erforderlich, sein Wert darf leer sein. **Nicht "aufraeumen":** Ihn
// wegzulassen ist etwas anderes, als ihn leer zu lassen.
//
// Offener Punkt: Twitchs Abo-Kontingent rechnet ein Abo mit 0 statt 1, wenn
// "that user has authorized your application (i.e., you have an OAuth scope
// for that user)". Ob eine Zustimmung OHNE Scope dafuer zaehlt, sagt die
// Dokumentation nicht. Erst messen, wenn es zaehlt — nicht vorsorglich
// Berechtigungen erfragen, die niemand braucht.

/**
 * Wohin der Benutzer zum Verknuepfen geschickt wird.
 *
 * @param {Object} opt { state, rueckrufUrl }
 * @returns {Promise<string|null>} Adresse oder null ohne Zugangsdaten
 */
async function verknuepfungsUrl({ state, rueckrufUrl, scopes = [] }) {
    const daten = await zugangsdaten('TWITCH');
    if (!daten.clientId) return null;

    return `${IDAPI}/authorize?` + new URLSearchParams({
        client_id: daten.clientId,
        redirect_uri: rueckrufUrl,
        response_type: 'code',
        // Leer bei der reinen Verknuepfung, gefuellt bei einer Zusage. Beides
        // ist derselbe Weg — der Unterschied ist genau diese Zeile.
        scope: (scopes || []).join(' '),
        state
    }).toString();
}

/**
 * Den Autorisierungscode gegen Schluessel tauschen.
 *
 * Gemeinsamer Rumpf mit `verknuepfteIdentitaet`, aber eine andere Zusage nach
 * aussen: Hier bleiben die Schluessel erhalten und wandern verschluesselt in
 * `user_connection_grants`.
 *
 * @param {Object} opt { code, rueckrufUrl }
 * @returns {Promise<Object|null>} { kontoId, kontoName, zugang, erneuerung, laeuftAbSek, scopes }
 */
async function tauschen({ code, rueckrufUrl }) {
    const Logger = ServiceManager.get('Logger');
    const daten = await zugangsdaten('TWITCH');
    if (!daten.clientId || !daten.clientSecret) return null;

    const tausch = await fetch(`${IDAPI}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: daten.clientId,
            client_secret: daten.clientSecret,
            code,
            grant_type: 'authorization_code',
            redirect_uri: rueckrufUrl
        })
    });
    if (!tausch.ok) {
        Logger.warn(`[Streaming/Twitch] Code abgelehnt (${tausch.status})`);
        return null;
    }

    const antwort = await tausch.json();
    if (!antwort.access_token) return null;

    const konto = await werBinIch(daten.clientId, antwort.access_token);
    if (!konto) return null;

    return {
        ...konto,
        zugang: antwort.access_token,
        erneuerung: antwort.refresh_token || null,
        laeuftAbSek: Number(antwort.expires_in) || null,
        scopes: Array.isArray(antwort.scope) ? antwort.scope : String(antwort.scope || '').split(' ').filter(Boolean)
    };
}

/**
 * Einen neuen Zugang aus der Erneuerung holen.
 *
 * **Twitch gibt oft einen NEUEN Erneuerungsschluessel zurueck.** Wer den alten
 * behaelt, bemerkt es nicht sofort - es funktioniert weiter, bis es das nicht
 * mehr tut. Deshalb wird er hier immer mitgegeben, und der Speicher schreibt
 * ihn weg.
 *
 * @param {Object} opt { erneuerung }
 * @returns {Promise<Object|null>} { zugang, erneuerung, laeuftAbSek, scopes }
 */
async function erneuern({ erneuerung }) {
    const Logger = ServiceManager.get('Logger');
    const daten = await zugangsdaten('TWITCH');
    if (!daten.clientId || !daten.clientSecret || !erneuerung) return null;

    const antwort = await fetch(`${IDAPI}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: daten.clientId,
            client_secret: daten.clientSecret,
            grant_type: 'refresh_token',
            refresh_token: erneuerung
        })
    });
    if (!antwort.ok) {
        // 400 heisst hier fast immer: Der Benutzer hat sein Passwort geaendert
        // oder uns getrennt. Kein Grund, es gleich noch einmal zu versuchen -
        // ein Erneuerungsschluessel stirbt ohnehin nach 50 Zugaengen.
        Logger.warn(`[Streaming/Twitch] Erneuern abgelehnt (${antwort.status})`);
        return null;
    }

    const daten2 = await antwort.json();
    if (!daten2.access_token) return null;

    return {
        zugang: daten2.access_token,
        erneuerung: daten2.refresh_token || erneuerung,
        laeuftAbSek: Number(daten2.expires_in) || null,
        scopes: Array.isArray(daten2.scope) ? daten2.scope : String(daten2.scope || '').split(' ').filter(Boolean)
    };
}

/**
 * Die Pflichtpruefung: gilt dieser Schluessel noch?
 *
 * Twitch verlangt sie **beim Start und danach stuendlich**, mit Audits und
 * angedrohtem Entzug des API-Schluessels. `/oauth2/validate` antwortet mit
 * 401, sobald der Benutzer widerrufen oder sein Passwort geaendert hat — das
 * erfahren wir auf keinem anderen Weg.
 *
 * @param {Object} opt { zugang }
 * @returns {Promise<{gueltig: boolean, scopes: Array<string>, kontoId: string|null}>} Ergebnis
 */
async function pruefen({ zugang }) {
    const antwort = await fetch(`${IDAPI}/validate`, {
        headers: { Authorization: `OAuth ${zugang}` }
    });

    if (!antwort.ok) return { gueltig: false, scopes: [], kontoId: null };

    const d = await antwort.json();
    return {
        gueltig: true,
        scopes: Array.isArray(d.scopes) ? d.scopes : [],
        kontoId: d.user_id ? String(d.user_id) : null
    };
}

/**
 * Die Abonnenten eines Kanals lesen.
 *
 * **Braucht den Nutzer-Token des Kanalinhabers**, nicht unseren App-Token:
 * `channel:read:subscriptions` ist eine Auskunft ueber SEINEN Kanal, und
 * Twitch gibt sie nur ihm. Das ist der Unterschied zum Anlegen eines
 * EventSub-Abos, das mit App-Token laeuft — beides in derselben Stufe, und
 * genau hier verwechselt man es.
 *
 * Der Aufrufer uebergibt deshalb keinen Token, sondern bekommt einen: Der
 * Speicher reicht ihn durch `mitZugang` herein und faengt die Ablehnung ab.
 *
 * @param {string} kanalId Numerische Kanalkennung
 * @param {string} zugang Nutzer-Token des Kanalinhabers
 * @returns {Promise<{ok: boolean, abgelehnt: boolean, abonnenten: Array<Object>}>} Ergebnis
 */
async function abonnentenLesen(kanalId, zugang) {
    const daten = await zugangsdaten('TWITCH');
    if (!daten.clientId) return { ok: false, abgelehnt: false, abonnenten: [] };

    const abonnenten = [];
    let cursor = null;

    do {
        const abfrage = new URLSearchParams({ broadcaster_id: String(kanalId), first: '100' });
        if (cursor) abfrage.set('after', cursor);

        const antwort = await fetch(`${HELIX}/subscriptions?${abfrage}`, {
            headers: { 'Client-Id': daten.clientId, Authorization: `Bearer ${zugang}` }
        });

        // 401 wird NICHT als "keine Abonnenten" gelesen. Ein abgelaufener
        // Token saehe sonst aus wie ein Kanal, den niemand mehr abonniert hat
        // — und der Abgleich naehme allen die Rolle weg.
        if (antwort.status === 401) return { ok: false, abgelehnt: true, abonnenten: [] };
        if (!antwort.ok) return { ok: false, abgelehnt: false, abonnenten: [] };

        const d = await antwort.json();
        for (const a of d.data || []) {
            // **Der Kanalinhaber steht in seiner eigenen Liste — gemessen,
            // nicht vermutet.** Am 2026-08-26 an `firedervil` (37883778)
            // nachgesehen, roh und ungefiltert:
            //
            //     HTTP 200
            //     total laut Twitch:   0
            //     Eintraege in data:   1
            //       - 37883778 FireDervil tier 3000
            //
            // Twitch widerspricht sich also selbst: `total` zaehlt ihn nicht
            // mit, `data` liefert ihn aus. **Wer `data.length` zaehlt, bekommt
            // 1 statt 0** und gibt dem Streamer seine eigene Abonnenten-Rolle.
            //
            // Der Betreiber hatte denselben Gedanken unabhaengig: "man ist ja
            // sein eigener Abonnement, aber das zaehlt ja auch nicht". Twitchs
            // `total` gibt ihm recht — nur eben nicht `data`.
            if (String(a.user_id) === String(kanalId)) continue;
            abonnenten.push({
                kontoId: String(a.user_id),
                kontoName: a.user_name || a.user_login || null,
                stufe: a.tier || null,
                geschenkt: Boolean(a.is_gift)
            });
        }
        cursor = d.pagination?.cursor || null;
    } while (cursor);

    return { ok: true, abgelehnt: false, abonnenten };
}

/**
 * Aus einem Abo-Ereignis die beteiligte Person herausziehen.
 *
 * **Beim Verschenken ist es nicht der Schenkende.** `channel.subscribe` traegt
 * bei einem Geschenk `is_gift: true` und im `user_id` den **Beschenkten** —
 * und der soll die Rolle bekommen. Wer hier den Schenkenden nimmt, gibt die
 * Rolle einer Person, die selbst gar nicht abonniert hat.
 *
 * @param {Object} koerper Zustellung
 * @returns {{kontoId: string, kontoName: string|null, stufe: string|null, geschenkt: boolean}|null} Person
 */
function abonnentAus(koerper) {
    const e = koerper?.event;
    if (!e || !e.user_id) return null;
    return {
        kontoId: String(e.user_id),
        kontoName: e.user_name || e.user_login || null,
        stufe: e.tier || null,
        geschenkt: Boolean(e.is_gift)
    };
}

/**
 * "Wer bist du" — gemeinsam genutzt von `identitaet` und `tauschen`.
 *
 * @param {string} clientId Client-ID
 * @param {string} benutzerToken Zugang
 * @returns {Promise<{kontoId: string, kontoName: string}|null>} Identitaet
 */
async function werBinIch(clientId, benutzerToken) {
    const Logger = ServiceManager.get('Logger');
    const wer = await fetch(`${HELIX}/users`, {
        headers: { 'Client-Id': clientId, Authorization: `Bearer ${benutzerToken}` }
    });
    if (!wer.ok) {
        Logger.warn(`[Streaming/Twitch] Identitaet nicht lesbar (${wer.status})`);
        return null;
    }
    const [konto] = (await wer.json()).data || [];
    if (!konto || !konto.id) return null;
    return { kontoId: String(konto.id), kontoName: konto.display_name || konto.login };
}

/**
 * Aus dem Rueckruf-Code die Identitaet feststellen.
 *
 * **Der Benutzertoken wird nicht zurueckgegeben und nirgends abgelegt.** Er
 * lebt genau so lange wie dieser Aufruf. Gebraucht wird er nur, um Twitch
 * einmal zu fragen "wer bist du" — die Antwort ist der Nachweis, der Token
 * nicht.
 *
 * @param {Object} opt { code, rueckrufUrl }
 * @returns {Promise<{kontoId: string, kontoName: string}|null>} Identitaet
 */
async function verknuepfteIdentitaet({ code, rueckrufUrl }) {
    const Logger = ServiceManager.get('Logger');
    const daten = await zugangsdaten('TWITCH');
    if (!daten.clientId || !daten.clientSecret) {
        Logger.warn('[Streaming/Twitch] Verknuepfung ohne hinterlegte Zugangsdaten');
        return null;
    }

    const tausch = await fetch(`${IDAPI}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: daten.clientId,
            client_secret: daten.clientSecret,
            code,
            grant_type: 'authorization_code',
            redirect_uri: rueckrufUrl
        })
    });
    if (!tausch.ok) {
        Logger.warn(`[Streaming/Twitch] Code abgelehnt (${tausch.status}): ${await tausch.text()}`);
        return null;
    }
    const { access_token: benutzerToken } = await tausch.json();
    if (!benutzerToken) return null;

    const wer = await fetch(`${HELIX}/users`, {
        headers: { 'Client-Id': daten.clientId, Authorization: `Bearer ${benutzerToken}` }
    });
    if (!wer.ok) {
        Logger.warn(`[Streaming/Twitch] Identitaet nicht lesbar (${wer.status})`);
        return null;
    }
    const [konto] = (await wer.json()).data || [];
    if (!konto || !konto.id) return null;

    return { kontoId: String(konto.id), kontoName: konto.display_name || konto.login };
}

module.exports = {
    name: 'twitch',
    tauschen, erneuern, pruefen,
    EREIGNISSE_ABO, abonnentenLesen, abonnentAus,
    HOECHSTALTER_MS,
    EREIGNISSE,
    verknuepfungsUrl,
    verknuepfteIdentitaet,
    kennung,
    nachrichtId,
    ereignisTyp,
    widerrufsGrund,
    appToken,
    aufloesen,
    abonnieren,
    abbestellen,
    abosAuflisten,
    zustandUebersetzen,
    anreichern,
    signaturPruefen,
    zuAlt,
    einordnen,
    uebersetzen
};
