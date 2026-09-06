'use strict';

/**
 * Mitmachen (P9) - was Zuschauer aus dem Chat heraus ausloesen koennen.
 *
 * ## Was hier steht, und was ausdruecklich nicht
 *
 * **Gebaut: Clip und Umfrage.** Beide gehoeren Twitch - ein Clip liegt auf
 * Twitchs Servern, eine Umfrage laeuft in Twitchs Oberflaeche. Wir loesen aus
 * und lesen den Stand; gespeichert wird davon nichts. Dieselbe Entscheidung
 * wie bei der Statistik (2026-09-03: „per Request, also dann wenn man sie
 * braucht").
 *
 * **Nicht gebaut: Verlosung und Musikwunsch.** Nicht vergessen, sondern
 * gemessen und zurueckgestellt (2026-09-05):
 *
 *     GiveawayManager.addEntry(giveawayId, userId)   sieht nach reinen Kennungen aus
 *       └─ checkRequirements()  Zeile 2:  guild.members.fetch(userId)
 *                              Zeile 3:  if (!member) return 'member_not_found'
 *       └─ _updateEmbedActive() schreibt in eine Discord-Nachricht
 *       laeuft im Bot-Vorgang (this.client), nicht im Dashboard
 *
 * Ein Twitch-Zuschauer ohne Discord-Konto scheitert dort **nicht an einer
 * Regel, sondern an der Verrohrung** - in der zweiten Zeile, bevor irgendeine
 * Bedingung geprueft wird. Das ist dieselbe Form wie bei P8 (automods
 * 472-Zeilen-Funktion ueber dem Discord-Nachrichtenobjekt): Es fehlt die
 * Stelle, an der man „diese Person, dieses Los" ohne Discord sagen koennte.
 * Beides ist eine eigene Stufe, kein Anbau an diese Datei.
 *
 * ## ⚠ Aus der Dokumentation gebaut, in Produktion noch nicht gelaufen
 *
 * Die Helix-Aufrufe stehen so in Twitchs Referenz. Ob sie im Ernstfall genau
 * so antworten, zeigt der erste echte Aufruf - am 2026-09-05 hat eine fehlende
 * Spalte den ersten echten `!uptime` zerlegt, waehrend 44 Pruefungen gruen
 * meldeten. Was hier steht, ist deshalb gemessen an der Dokumentation, nicht
 * am Betrieb.
 *
 * @module streaming/kern/mitmachen
 */

const { ServiceManager } = require('dunebot-core');
const { ZUSTAND, deuten } = require('./auskunft');

/**
 * Die zwei Zusagen, die diese Seite braucht.
 *
 * **Der Name steht hier UND in `dashboard/index.js`** - dort wird die Zusage
 * angeboten, hier wird sie erwartet. Zwei Stellen sind einer zu viel, aber die
 * Alternative waere, dass die Registry das Plugin kennt. Deshalb misst
 * `scripts/check-streaming-mitmachen.js`, dass beide dasselbe sagen; genau so
 * haengt `meinkanal.SCHREIB_ZUSAGE` seit Stufe 13c.
 */
const ZUSAGEN = {
    clip:     { zusage: 'clip',     scope: 'clips:edit' },
    umfragen: { zusage: 'umfragen', scope: 'channel:manage:polls' }
};

/** Wie viele fruehere Umfragen die Seite zeigt. */
const RUECKBLICK = 5;

/** @returns {Object} Protokoll */
function log() {
    return ServiceManager.get('Logger');
}

/**
 * Kanal, Inhaber und ein Weg zu seinem Schluessel.
 *
 * **Einmal je Seitenaufruf**, nicht je Frage. `kanalInhaber` geht in die
 * Datenbank, und die Seite stellt zwei Fragen an Twitch.
 *
 * @param {string} guildId Discord-Guild-ID
 * @returns {Promise<{kanal: Object|null, zeile: Object|null, inhaber: string|null, mitSchluessel: Function}>} Zugang
 */
async function kanalUndSchluessel(guildId) {
    const heimguild = require('./heimguild');
    const kanaele = await heimguild.kanaeleDerGuild(guildId);

    /** @returns {null} Es gibt nichts zu fragen */
    const nichts = async () => null;
    if (!kanaele.length) return { kanal: null, zeile: null, inhaber: null, mitSchluessel: nichts };

    // Heute gibt es genau einen Heim-Kanal je Guild - dieselbe Annahme wie
    // `heimKanalId` im Router, und sie steht dort schon so.
    const zeile = kanaele[0];
    const kanal = {
        id: zeile.id,
        kanal_id: String(zeile.kanal_id),
        login: zeile.login,
        name: zeile.anzeigename || zeile.login
    };

    const inhaber = await require('./abonnenten').kanalInhaber(zeile);
    if (!inhaber) return { kanal, zeile, inhaber: null, mitSchluessel: nichts };

    return { kanal, zeile, inhaber, mitSchluessel: schluesselWeg(inhaber) };
}

/**
 * Eine Abfrage mit dem Schluessel des Kanalinhabers.
 *
 * `mitZugang` entschluesselt, erneuert bei 401 und vermerkt einen Widerruf.
 * `null` heisst: gar keine Zusage mehr.
 *
 * @param {string} inhaber Discord-Benutzer, dem der Kanal gehoert
 * @returns {Function} Ruft `tun(zugang)` auf
 */
function schluesselWeg(inhaber) {
    const Verbindungsspeicher = require('../../../../apps/dashboard/helpers/Verbindungsspeicher');
    return (tun) => Verbindungsspeicher.mitZugang({ userId: inhaber, plattform: 'twitch' }, tun);
}

/**
 * Alles, was die Seite zeigt.
 *
 * @param {string} guildId Discord-Guild-ID
 * @returns {Promise<Object>} Bericht
 */
async function zustand(guildId) {
    const bericht = {
        geholt_am: new Date(),
        kanal: null,
        zusagen: {},
        befehle: {},
        // 'partner' | 'affiliate' | 'normal' | null (nicht feststellbar)
        kanalArt: null,
        umfragen: { zustand: ZUSTAND.KEIN_KANAL, laufend: null, frueher: [] }
    };

    const { kanal, inhaber, mitSchluessel } = await kanalUndSchluessel(guildId);
    bericht.kanal = kanal;

    // **Die Zusagen zuerst, und ohne Twitch zu fragen.** Sie stehen an unserem
    // eigenen Schluessel; sie ueber einen fehlgeschlagenen Aufruf zu erraten
    // waere langsamer und unschaerfer - ein Netzfehler saehe aus wie ein
    // Widerruf.
    const zusagen = require('./zusagen');
    const staende = await zusagen.staendeFuer(
        inhaber, Object.values(ZUSAGEN).map(z => z.scope));

    for (const [name, z] of Object.entries(ZUSAGEN)) {
        bericht.zusagen[name] = { ...z, ...(staende[z.scope] || { zustand: zusagen.STAND.UNBEKANNT, grund: null }) };
    }

    // **Der Zustand der zwei Befehle** - sie werden auf „Meine Befehle"
    // eingerichtet, nicht hier. Diese Seite zeigt nur, ob sie an sind: Ein
    // zweiter Schalter fuer dieselbe Zeile waere eine zweite Wahrheit, und
    // welcher gilt, entschiede die Reihenfolge des Klickens.
    bericht.befehle = await befehlsstand(guildId, kanal ? kanal.id : null);

    if (!kanal) return bericht;
    if (!inhaber) {
        bericht.umfragen = { zustand: ZUSTAND.ABGELEHNT, laufend: null, frueher: [] };
        return bericht;
    }

    const twitch = require('../plattformen/twitch');

    // **Die Kanalart zuerst, und ausdruecklich VOR der Zusagenschranke.**
    // `broadcaster_type` ist oeffentlich und braucht keinen Scope - gerade wer
    // die Umfragen-Zusage NICHT erteilt hat, soll lesen koennen, ob sie ihm
    // ueberhaupt etwas naetzte. Ein Fehlschlag hier laesst `null` stehen, und
    // die Seite faellt auf den allgemeinen Satz zurueck.
    const art = await mitSchluessel(z => twitch.kanalArtLesen(kanal.kanal_id, z))
        .catch(err => { log().error('[Streaming/Mitmachen] Kanalart', err); return null; });
    bericht.kanalArt = art?.ok ? art.art : null;

    // **Ohne Zusage wird nicht gefragt.** Ein Aufruf, von dem wir wissen, dass
    // er mit 401 endet, kostet Kontingent und traegt zur Antwort nichts bei -
    // und `mitZugang` wuerde dabei einen Widerruf vermerken, den es nie gab.
    if (bericht.zusagen.umfragen.zustand !== zusagen.STAND.JA) {
        bericht.umfragen = { zustand: ZUSTAND.ABGELEHNT, laufend: null, frueher: [] };
        return bericht;
    }
    const ergebnis = await mitSchluessel(
        z => twitch.umfragenLesen(kanal.kanal_id, z, RUECKBLICK))
        .catch(err => { log().error('[Streaming/Mitmachen] Umfragen', err); return null; });

    bericht.umfragen = deuten(ergebnis, (e) => {
        const laufend = e.umfragen.find(u => u.laeuft) || null;
        return {
            laufend,
            frueher: e.umfragen.filter(u => u !== laufend)
        };
    }, { laufend: null, frueher: [] });

    return bericht;
}

/**
 * Sind `!clip` und `!umfrage` eingerichtet, und fuer wen?
 *
 * **Gelesen, nicht angenommen.** Ein „steht ja im Code" waere falsch, sobald
 * der Streamer den Befehl abwaehlt - und genau dann fragt er sich, warum
 * nichts passiert.
 *
 * @param {string} guildId Discord-Guild-ID
 * @param {number|null} streamerId Kanal
 * @returns {Promise<Object<string, Object|null>>} Je Wort eine Zeile oder null
 */
async function befehlsstand(guildId, streamerId) {
    const worte = Object.keys(require('./befehle').FERTIG)
        .filter(w => require('./befehle').FERTIG[w].zusage);

    const zeilen = await ServiceManager.get('dbService').query(
        `SELECT wort, aktiv, wer, abkuehlung_s
           FROM streaming_commands
          WHERE guild_id = ? AND art = 'fertig'
            AND (streamer_id = ? OR streamer_id IS NULL)
          ORDER BY streamer_id IS NULL ASC`, [guildId, streamerId]);

    const stand = {};
    for (const wort of worte) {
        const zeile = zeilen.find(z => z.wort === wort) || null;
        stand[wort] = zeile ? { ...zeile, aktiv: Boolean(zeile.aktiv) } : null;
    }
    return stand;
}

// =====================================================
// Handlungen
// =====================================================

/**
 * Einen Clip schneiden - der Weg, den `!clip` geht.
 *
 * Nimmt die **Streamer-Zeile**, nicht eine Guild: Der Befehl kommt aus dem
 * Chat und hat sie schon in der Hand; ueber die Guild zu gehen hiesse, sie ein
 * zweites Mal zu suchen.
 *
 * @param {Object} streamer Zeile aus `streaming_streamers`
 * @returns {Promise<{ok: boolean, url: string|null, abgelehnt: boolean, grund: string|null}>} Ergebnis
 */
async function clipSchneiden(streamer) {
    const twitch = require('../plattformen/twitch');
    const inhaber = await require('./abonnenten').kanalInhaber(streamer);
    if (!inhaber) return { ok: false, url: null, abgelehnt: true, grund: 'kein verknuepfter Kanalinhaber' };

    const ergebnis = await schluesselWeg(inhaber)(
        (zugang) => twitch.clipErstellen(streamer.kanal_id, zugang));

    if (!ergebnis) return { ok: false, url: null, abgelehnt: true, grund: 'keine Zusage mehr' };
    return {
        ok: Boolean(ergebnis.ok),
        url: ergebnis.url || null,
        abgelehnt: Boolean(ergebnis.abgelehnt),
        grund: ergebnis.grund || null
    };
}

/**
 * Den Stand der laufenden Umfrage - der Weg, den `!umfrage` geht.
 *
 * @param {Object} streamer Zeile aus `streaming_streamers`
 * @returns {Promise<{ok: boolean, umfrage: Object|null, grund: string|null}>} Ergebnis
 */
async function umfrageStand(streamer) {
    const twitch = require('../plattformen/twitch');
    const inhaber = await require('./abonnenten').kanalInhaber(streamer);
    if (!inhaber) return { ok: false, umfrage: null, grund: 'kein verknuepfter Kanalinhaber' };

    const ergebnis = await schluesselWeg(inhaber)(
        (zugang) => twitch.umfragenLesen(streamer.kanal_id, zugang, 1));

    if (!ergebnis) return { ok: false, umfrage: null, grund: 'keine Zusage mehr' };
    if (!ergebnis.ok) return { ok: false, umfrage: null, grund: ergebnis.grund || 'Twitch hat abgelehnt' };

    // **Die neueste ist nicht zwingend die laufende.** Twitch gibt die letzten
    // zurueck, sortiert nach Beginn; ist die letzte beendet, laeuft keine.
    const laufend = (ergebnis.umfragen || []).find(u => u.laeuft) || null;
    return { ok: true, umfrage: laufend, grund: null };
}

/**
 * Eine Umfrage starten.
 *
 * @param {string} guildId Discord-Guild-ID
 * @param {Object} felder Frage, Antworten, Dauer, Punkte
 * @returns {Promise<{ok: boolean, grund: string|null}>} Ergebnis
 */
async function umfrageStarten(guildId, felder) {
    const frage = String(felder.frage || '').trim();
    if (!frage) return { ok: false, grund: 'frage' };

    // **Die Antworten kommen als Feld aus dem Formular** und duerfen Luecken
    // haben: Wer die dritte Zeile leer laesst und die vierte fuellt, meint
    // drei Antworten, nicht vier.
    const antworten = (Array.isArray(felder.antworten) ? felder.antworten : [felder.antworten])
        .map(t => String(t || '').trim())
        .filter(Boolean);
    if (antworten.length < 2) return { ok: false, grund: 'antworten' };

    const { kanal, mitSchluessel } = await kanalUndSchluessel(guildId);
    if (!kanal) return { ok: false, grund: 'kein_kanal' };

    const twitch = require('../plattformen/twitch');
    const ergebnis = await mitSchluessel(z => twitch.umfrageStarten(kanal.kanal_id, z, {
        frage,
        antworten,
        dauer_s: Number(felder.dauer_s),
        punkteProStimme: Number(felder.punkteProStimme)
    }));

    if (!ergebnis) return { ok: false, grund: 'keine Zusage mehr' };
    return ergebnis.ok ? { ok: true, grund: null }
                       : { ok: false, grund: ergebnis.grund || 'Twitch hat abgelehnt' };
}

/**
 * Eine laufende Umfrage beenden.
 *
 * @param {string} guildId Discord-Guild-ID
 * @param {string} umfrageId Welche
 * @param {boolean} verbergen true = archivieren statt Ergebnis zeigen
 * @returns {Promise<{ok: boolean, grund: string|null}>} Ergebnis
 */
async function umfrageBeenden(guildId, umfrageId, verbergen) {
    if (!String(umfrageId || '').trim()) return { ok: false, grund: 'keine Umfrage benannt' };

    const { kanal, mitSchluessel } = await kanalUndSchluessel(guildId);
    if (!kanal) return { ok: false, grund: 'kein_kanal' };

    const twitch = require('../plattformen/twitch');
    const ergebnis = await mitSchluessel(
        z => twitch.umfrageBeenden(kanal.kanal_id, z, String(umfrageId), Boolean(verbergen)));

    if (!ergebnis) return { ok: false, grund: 'keine Zusage mehr' };
    return ergebnis.ok ? { ok: true, grund: null }
                       : { ok: false, grund: ergebnis.grund || 'Twitch hat abgelehnt' };
}

module.exports = {
    ZUSTAND, ZUSAGEN, RUECKBLICK,
    zustand, befehlsstand,
    clipSchneiden, umfrageStand,
    umfrageStarten, umfrageBeenden
};
