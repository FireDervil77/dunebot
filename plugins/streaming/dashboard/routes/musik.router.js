'use strict';

/**
 * Musikwunsch - die Seite fuer den Streamer.
 *
 * **Ohne diese Seite ist der Player unerreichbar.** Der Schluessel steht nur
 * in der Datenbank; hier ist die einzige Stelle, an der er sichtbar wird und
 * an der man ihn neu erzeugen kann. Sie ist deshalb nicht die Kuer zum Player,
 * sondern seine Bedingung.
 *
 * `STREAMING.CHAT.MANAGE`, nicht `STREAMING.VIEW`: Wer die OBS-Adresse sieht,
 * kann die Bibliothek dieser Guild abspielen - das ist naeher am Verwalten des
 * Chatbots als am Zusehen.
 *
 * @module streaming/routes/musik
 */

const express = require('express');
const router = express.Router({ mergeParams: true });

const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { makeTranslator, renderView, renderFehler } = require('./_shared');
const musik = require('../../shared/musikwunsch');
const musikende = require('../kern/musikende');
const musikendeEntscheidung = require('../kern/musikendeEntscheidung');
const modelle = require('../../shared/models');

/**
 * Der letzte Auftrag „Musik am Streamende" als eine Zeile.
 *
 * @param {Object|null} a Zeile aus `musikende.letzter`
 * @param {string} zeitzone IANA-Zeitzone der Guild
 * @param {Function} tr Uebersetzung der Anfrage
 * @returns {string|null} Klartext
 */
function streamendeZeile(a, zeitzone, tr) {
    if (!a) return null;
    const zeit = (d) => new Date(d).toLocaleString('de-DE', {
        timeZone: zeitzone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });
    if (a.zustand === 'offen') return tr('streaming:MUSIK.WARTET_BIS', { zeit: zeit(a.faellig_ab) });
    return `${zeit(a.erledigt_am || a.faellig_ab)} — ${a.fehlertext || a.zustand}`;
}

/**
 * Die Adresse, die der Streamer in OBS eintraegt.
 *
 * **Aus der Anfrage gebaut, nicht aus einer Einstellung.** Eine `BASE_URL` in
 * der Konfiguration ist genau dann falsch, wenn sie einmal nicht gepflegt
 * wurde - und dann kopiert jemand eine Adresse, die ins Leere zeigt, ohne dass
 * es jemandem auffaellt. Was im Browser des Streamers steht, stimmt.
 *
 * @param {Object} req Anfrage
 * @param {string} schluessel Der Geheimschluessel
 * @returns {string} Vollstaendige Adresse
 */
function playerAdresse(req, schluessel) {
    // `x-forwarded-proto` steht vorn, weil Apache davor haengt: `req.protocol`
    // ist dahinter http, auch wenn der Streamer https im Browser hat.
    const protokoll = req.get('x-forwarded-proto') || req.protocol;
    return `${protokoll}://${req.get('host')}/stream/player/${schluessel}`;
}

/**
 * Wann hat sich der Player zuletzt gemeldet?
 *
 * @param {Date|string|null} gesehen Zeitpunkt
 * @returns {{verbunden: boolean, sekunden: number|null}} Stand
 */
function playerStand(gesehen) {
    if (!gesehen) return { verbunden: false, sekunden: null };

    const sekunden = Math.round((Date.now() - new Date(gesehen).getTime()) / 1000);

    // Die Seite meldet sich alle 5 s. 20 s Nachsicht decken einen
    // Szenenwechsel ab, ohne dass eine geschlossene Quelle minutenlang als
    // "verbunden" dasteht.
    return { verbunden: sekunden <= 20, sekunden };
}

router.get('/', requirePermission('STREAMING.CHAT.MANAGE'), async (req, res) => {
    const tr = makeTranslator(req, res);
    const guildId = res.locals.guildId;

    try {
        const zustand = await musik.zustand(guildId);
        const [laeuft, offen, ablage] = await Promise.all([
            musik.aktueller(guildId),
            musik.warteschlange(guildId, { nurOffene: true, grenze: 25 }),
            musik.ablage(guildId)
        ]);

        // **Wie viele Dateien ueberhaupt freigegeben sind.** Ohne diese Zahl
        // sieht eine leere Warteschlange genauso aus wie eine leere Ablage -
        // und der Streamer sucht den Fehler beim Player, waehrend er nur den
        // Freigabeschalter nicht gesetzt hat.
        let freigegeben = null;
        if (ablage) {
            try {
                freigegeben = (await ablage.suchen(guildId, null)).length;
            } catch {
                freigegeben = null;
            }
        }

        const [streamende, streamendeLetzter, zeitzone] = await Promise.all([
            musikende.einstellung(guildId),
            musikende.letzter(guildId),
            modelle.zeitzone(guildId)
        ]);

        return await renderView(res, 'guild/streaming-musik', {
            tr, guildId,
            streamende,
            streamendeZuletzt: streamendeZeile(streamendeLetzter, zeitzone, tr),
            nachlaufGrenzen: { min: musikendeEntscheidung.NACHLAUF_MIN, max: musikendeEntscheidung.NACHLAUF_MAX },
            adresse: playerAdresse(req, zustand.schluessel),
            aktiv: Boolean(zustand.aktiv),
            endlos: Boolean(zustand.endlos),
            player: playerStand(zustand.player_gesehen),
            laeuft, offen, freigegeben,
            hatAblage: Boolean(ablage),
            noetigeStimmen: musik.NOETIGE_STIMMEN,
            meldung: req.query.ok || null,
            fehler: req.query.fehler || null
        });
    } catch (error) {
        return renderFehler(res, error, 'Die Musikseite konnte nicht geladen werden');
    }
});

/**
 * Den Schluessel neu erzeugen.
 *
 * Danach spielt eine offene Browserquelle nicht mehr weiter - deshalb sagt die
 * Seite davor, was passiert, statt es hinterher zu erklaeren.
 */
router.post('/schluessel', requirePermission('STREAMING.CHAT.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const basis = `/guild/${guildId}/plugins/streaming/musik`;
    const tr = makeTranslator(req, res);

    try {
        await musik.schluesselNeu(guildId);
        ServiceManager.get('Logger').info(
            `[Streaming] Player-Schluessel neu erzeugt (Guild ${guildId})`);
        return res.redirect(`${basis}?ok=${encodeURIComponent(tr('streaming:MUSIK.R_ADRESSE_NEU'))}`);
    } catch (error) {
        ServiceManager.get('Logger').error('[Streaming] Schluessel nicht erneuerbar:', error);
        return res.redirect(`${basis}?fehler=${encodeURIComponent(tr('streaming:MUSIK.R_ADRESSE_FEHLER'))}`);
    }
});

/** Wiedergabe anhalten oder fortsetzen - derselbe Schalter wie `!pause`/`!play`. */
router.post('/abspielen', requirePermission('STREAMING.CHAT.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const basis = `/guild/${guildId}/plugins/streaming/musik`;
    const tr = makeTranslator(req, res);

    try {
        const an = req.body?.an === '1';
        await musik.abspielen(guildId, an);
        return res.redirect(`${basis}?ok=${encodeURIComponent(tr(an ? 'streaming:MUSIK.R_LAEUFT' : 'streaming:MUSIK.R_ANGEHALTEN'))}`);
    } catch (error) {
        ServiceManager.get('Logger').error('[Streaming] Wiedergabe nicht schaltbar:', error);
        return res.redirect(`${basis}?fehler=${encodeURIComponent(tr('streaming:MUSIK.R_FEHLER'))}`);
    }
});

/** Wiedergabe beenden - haelt an UND setzt zurueck, wie `!stop`. */
router.post('/beenden', requirePermission('STREAMING.CHAT.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const basis = `/guild/${guildId}/plugins/streaming/musik`;
    const tr = makeTranslator(req, res);

    try {
        await musik.beenden(guildId);
        return res.redirect(`${basis}?ok=${encodeURIComponent(tr('streaming:MUSIK.R_BEENDET'))}`);
    } catch (error) {
        ServiceManager.get('Logger').error('[Streaming] Wiedergabe nicht beendbar:', error);
        return res.redirect(`${basis}?fehler=${encodeURIComponent(tr('streaming:MUSIK.R_FEHLER'))}`);
    }
});

/**
 * Den Endlosmodus schalten.
 *
 * Bewusst **nur hier und nicht im Chat**: Ob ungefragt Musik laeuft, ist eine
 * Entscheidung des Streamers ueber seinen Stream, kein Griff, den ein
 * Moderator zwischendurch tut.
 */
router.post('/endlos', requirePermission('STREAMING.CHAT.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const basis = `/guild/${guildId}/plugins/streaming/musik`;
    const tr = makeTranslator(req, res);

    try {
        const an = req.body?.an === '1';
        await musik.endlosSchalten(guildId, an);
        return res.redirect(`${basis}?ok=${encodeURIComponent(
            tr(an ? 'streaming:MUSIK.R_ENDLOS_AN' : 'streaming:MUSIK.R_ENDLOS_AUS'))}`);
    } catch (error) {
        ServiceManager.get('Logger').error('[Streaming] Endlosmodus nicht schaltbar:', error);
        return res.redirect(`${basis}?fehler=${encodeURIComponent(tr('streaming:MUSIK.R_FEHLER'))}`);
    }
});

/**
 * Musik am Streamende: an/aus und Nachlauf (Baustelle 128).
 *
 * Dasselbe Recht wie der Knopf „Beenden" daneben - die Einstellung tut spaeter
 * nichts anderes als ihn.
 */
router.post('/streamende', requirePermission('STREAMING.CHAT.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const basis = `/guild/${guildId}/plugins/streaming/musik`;
    const tr = makeTranslator(req, res);

    const pruefung = musikendeEntscheidung.eingabePruefen(req.body || {});
    if (!pruefung.ok) {
        return res.redirect(`${basis}?fehler=${encodeURIComponent(
            tr('streaming:MUSIK.R_NACHLAUF', { min: musikendeEntscheidung.NACHLAUF_MIN, max: musikendeEntscheidung.NACHLAUF_MAX }))}`);
    }

    try {
        await musikende.speichern(guildId, pruefung.werte);
        return res.redirect(`${basis}?ok=${encodeURIComponent(pruefung.werte.an
            ? tr('streaming:MUSIK.R_ENDE_AN', { n: pruefung.werte.nachlaufMin })
            : tr('streaming:MUSIK.R_ENDE_AUS'))}`);
    } catch (error) {
        ServiceManager.get('Logger').error('[Streaming] Musikende nicht speicherbar:', error);
        return res.redirect(`${basis}?fehler=${encodeURIComponent(tr('streaming:MUSIK.R_FEHLER'))}`);
    }
});

/** Die ganze freigegebene Ablage einreihen, gemischt. */
router.post('/einreihen', requirePermission('STREAMING.CHAT.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const basis = `/guild/${guildId}/plugins/streaming/musik`;
    const tr = makeTranslator(req, res);

    try {
        const e = await musik.ablageEinreihen(guildId);
        if (e.ok) {
            return res.redirect(`${basis}?ok=${encodeURIComponent(
                tr('streaming:MUSIK.R_EINGEREIHT', { n: e.anzahl }))}`);
        }
        // Jeder Grund bekommt seinen Satz: "hat nicht geklappt" liesse offen,
        // ob das Plugin fehlt oder nur keine Datei freigegeben ist.
        return res.redirect(`${basis}?fehler=${encodeURIComponent(
            e.grund === 'nichts_frei'
                ? tr('streaming:MUSIK.R_NICHTS_FREI')
                : tr('streaming:MUSIK.R_KEIN_PLUGIN'))}`);
    } catch (error) {
        ServiceManager.get('Logger').error('[Streaming] Ablage nicht einreihbar:', error);
        return res.redirect(`${basis}?fehler=${encodeURIComponent(tr('streaming:MUSIK.R_FEHLER'))}`);
    }
});

/** Die Warteschlange leeren - derselbe Weg wie `!clear`. */
router.post('/leeren', requirePermission('STREAMING.CHAT.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const basis = `/guild/${guildId}/plugins/streaming/musik`;
    const tr = makeTranslator(req, res);

    try {
        const weg = await musik.leeren(guildId);
        return res.redirect(`${basis}?ok=${encodeURIComponent(tr('streaming:MUSIK.R_GELEERT', { n: weg }))}`);
    } catch (error) {
        ServiceManager.get('Logger').error('[Streaming] Warteschlange nicht leerbar:', error);
        return res.redirect(`${basis}?fehler=${encodeURIComponent(tr('streaming:MUSIK.R_FEHLER'))}`);
    }
});

module.exports = router;
