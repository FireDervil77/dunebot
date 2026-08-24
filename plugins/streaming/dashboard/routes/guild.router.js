'use strict';

/**
 * Streaming - Seitenrouten
 *
 *   /            -> Weiterleitung auf /streamer
 *   /streamer    Beobachtete Kanaele
 *   /ziele       Wohin die Ankuendigung geht
 *   /vorlagen    Der Text darueber
 *   /zustand     Was laeuft, was klemmt
 *   /betrieb     Abos, Kontingent, Zugangsdaten (nur Betreiber)
 *
 * **Stand Stufe 1:** Die Seiten lesen echte Daten und zeigen sie an. Eintragen
 * und Aendern kommt mit Stufe 5 - bis dahin sagen die Seiten das ausdruecklich,
 * statt Knoepfe anzubieten, die nichts tun.
 *
 * Ausnahme sind die Zugangsdaten unter /betrieb: Sie sind die Voraussetzung
 * fuer alles Weitere und lassen sich deshalb schon jetzt setzen.
 *
 * @module streaming/dashboard/routes/guild
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { CheckAdmin } = require('../../../../apps/dashboard/middlewares/admin.middleware');
const {
    makeTranslator, renderView, renderFehler,
    getZielkanaele, getSprachkanaele, getRollen, vorWieLange
} = require('./_shared');
const modelle = require('../../shared/models');
const abos = require('../kern/abos');

// =====================================================
// Einstieg
// =====================================================
router.get('/', requirePermission('STREAMING.VIEW'), (req, res) => {
    res.redirect(`/guild/${res.locals.guildId}/plugins/streaming/streamer`);
});

// =====================================================
// Beobachtete Kanaele
// =====================================================
router.get('/streamer', requirePermission('STREAMING.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const [streamer, anzahl] = await Promise.all([
            modelle.streamerDerGuild(guildId),
            modelle.anzahlStreamer(guildId)
        ]);

        const grenze = Number(require('../../config.json').STREAMER_JE_GUILD || 25);
        const [zielkanaele, rollen] = await Promise.all([getZielkanaele(guildId), getRollen(guildId)]);

        await renderView(res, 'guild/streaming-streamer', {
            tr, guildId, streamer, anzahl, grenze, vorWieLange,
            zielkanaele, rollen,
            meldung: req.query.ok || null,
            fehler: req.query.fehler || null
        });
    } catch (error) {
        return renderFehler(res, error, 'Die Streamer-Liste konnte nicht geladen werden');
    }
});

// =====================================================
// Kanal eintragen
// =====================================================
router.post('/streamer', requirePermission('STREAMING.STREAMERS.MANAGE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const zurueck = `/guild/${guildId}/plugins/streaming/streamer`;

    try {
        const eingabe = String(req.body.kanal || '').trim();
        const channelId = String(req.body.channel_id || '').trim();
        const rolleId = String(req.body.rolle_id || '').trim() || null;
        const veroeffentlichen = req.body.veroeffentlichen ? 1 : 0;

        if (!eingabe)   return res.redirect(`${zurueck}?fehler=kanal_fehlt`);
        if (!channelId) return res.redirect(`${zurueck}?fehler=ziel_fehlt`);

        // Mengengrenze: zaehlt EIGENE beobachtete Kanaele, nicht Abos. Ein
        // Kanal, den zehn andere Guilds schon beobachten, kostet nichts extra.
        const grenze = Number(require('../../config.json').STREAMER_JE_GUILD || 25);
        if (await modelle.anzahlStreamer(guildId) >= grenze) {
            return res.redirect(`${zurueck}?fehler=grenze`);
        }

        // Auf der Plattform nachsehen. Ein eingetippter Name ist eine
        // Behauptung — hier wird sie geprueft, mehr nicht: Niemand meldet sich
        // an, der Streamer erfaehrt nichts davon.
        const kanal = await abos.ADAPTER.twitch.aufloesen(eingabe);
        if (!kanal) return res.redirect(`${zurueck}?fehler=unbekannt`);

        const streamer = await abos.streamerSichern('twitch', kanal);
        const schonBeobachtet = await abos.nutzerZaehlen(streamer.id) > 0;

        const ergebnisse = await abos.abosSichern(streamer.id, 'twitch', kanal.kanal_id);
        const gescheitert = ergebnisse.filter(e => e.ok === false);

        // Ziel dieser Guild anlegen (oder wiederbeleben)
        await ServiceManager.get('dbService').query(
            `INSERT INTO streaming_targets (guild_id, streamer_id, channel_id, rolle_id, veroeffentlichen, angelegt_von)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE rolle_id = VALUES(rolle_id),
                                     veroeffentlichen = VALUES(veroeffentlichen), aktiv = 1`,
            [guildId, streamer.id, channelId, rolleId, veroeffentlichen,
             req.session?.user?.info?.id || null]);

        if (gescheitert.length) {
            Logger.warn(`[Streaming] ${kanal.login} eingetragen, aber ${gescheitert.length} Abo(s) scheiterten`);
            return res.redirect(`${zurueck}?fehler=abo`);
        }

        Logger.success(`[Streaming] ${kanal.login} fuer Guild ${guildId} eingetragen`);
        return res.redirect(`${zurueck}?ok=${schonBeobachtet ? 'geteilt' : 'neu'}`);
    } catch (error) {
        Logger.error('[Streaming] Eintragen fehlgeschlagen:', error);
        return res.redirect(`${zurueck}?fehler=technisch`);
    }
});

// =====================================================
// Kanal entfernen
// =====================================================
router.post('/streamer/:id/entfernen', requirePermission('STREAMING.STREAMERS.MANAGE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const zurueck = `/guild/${guildId}/plugins/streaming/streamer`;

    try {
        const streamerId = Number(req.params.id);
        if (!Number.isInteger(streamerId)) return res.redirect(`${zurueck}?fehler=technisch`);

        // Nur die Ziele DIESER Guild. Der Streamer bleibt - er gehoert
        // anderen Guilds mit.
        await ServiceManager.get('dbService').query(
            'DELETE FROM streaming_targets WHERE guild_id = ? AND streamer_id = ?', [guildId, streamerId]);

        // Beobachtet ihn danach niemand mehr, muss das Abo weg: sonst laeuft
        // das gemeinsame Kontingent langsam voll.
        const ergebnis = await abos.abosAufraeumen(streamerId);

        Logger.info(`[Streaming] Streamer ${streamerId} aus Guild ${guildId} entfernt` +
            (ergebnis.behalten ? ' (Abo bleibt, andere Guilds beobachten weiter)' : ''));
        return res.redirect(`${zurueck}?ok=entfernt`);
    } catch (error) {
        Logger.error('[Streaming] Entfernen fehlgeschlagen:', error);
        return res.redirect(`${zurueck}?fehler=technisch`);
    }
});

// =====================================================
// Ziele
// =====================================================
router.get('/ziele', requirePermission('STREAMING.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const [ziele, zielkanaele, sprachkanaele, rollen] = await Promise.all([
            modelle.zieleDerGuild(guildId),
            getZielkanaele(guildId),
            getSprachkanaele(guildId),
            getRollen(guildId)
        ]);

        await renderView(res, 'guild/streaming-ziele', {
            tr, guildId, ziele, zielkanaele, sprachkanaele, rollen
        });
    } catch (error) {
        return renderFehler(res, error, 'Die Ziele konnten nicht geladen werden');
    }
});

// =====================================================
// Vorlagen
// =====================================================
router.get('/vorlagen', requirePermission('STREAMING.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const ziele = await modelle.zieleDerGuild(guildId);

        // Die Platzhalter stehen hier und nicht in der Ansicht: Sie sind
        // Vertrag zwischen Vorlage und Ausgabe, nicht Beiwerk der Seite.
        const platzhalter = [
            { name: '{streamer}',  bedeutung: 'Anzeigename des Kanals' },
            { name: '{titel}',     bedeutung: 'Titel der Sendung' },
            { name: '{kategorie}', bedeutung: 'Spiel oder Kategorie' },
            { name: '{url}',       bedeutung: 'Adresse des Streams' },
            { name: '{zuschauer}', bedeutung: 'Zuschauerzahl' },
            { name: '{rolle}',     bedeutung: 'Erwaehnung der eingestellten Rolle' },
            { name: '{plattform}', bedeutung: 'Twitch, Kick oder YouTube' },
            { name: '{dauer}',     bedeutung: 'nur in der Rueckschau nach dem Stream' }
        ];

        await renderView(res, 'guild/streaming-vorlagen', { tr, guildId, ziele, platzhalter });
    } catch (error) {
        return renderFehler(res, error, 'Die Vorlagen konnten nicht geladen werden');
    }
});

// =====================================================
// Zustand
// =====================================================
router.get('/zustand', requirePermission('STREAMING.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const [zustand, streamer] = await Promise.all([
            modelle.zustandDerGuild(guildId),
            modelle.streamerDerGuild(guildId)
        ]);

        await renderView(res, 'guild/streaming-zustand', {
            tr, guildId, zustand, streamer,
            ampel: ampelFarbe(zustand),
            vorWieLange
        });
    } catch (error) {
        return renderFehler(res, error, 'Der Zustand konnte nicht geladen werden');
    }
});

/**
 * Die Ampel wird gerechnet, nicht gesetzt.
 *
 * Bewusst eine reine Funktion ohne Datenbank: So laesst sich jeder Fall
 * durchspielen, ohne eine Anlage zu betreiben - `scripts/check-streaming-*`
 * setzt hier an.
 *
 * @param {Object} z Zustandszahlen
 * @returns {string} 'gruen' | 'gelb' | 'rot'
 */
function ampelFarbe(z) {
    if (z.kaputteAbos?.length > 0 || z.gescheitert > 0) return 'rot';
    if (z.offeneAuftraege > 0) return 'gelb';
    return 'gruen';
}

// =====================================================
// Betrieb - nur fuer den Betreiber
// =====================================================
router.get('/betrieb', CheckAdmin, async (req, res) => {
    const tr = makeTranslator(req, res);
    const guildId = res.locals.guildId;

    try {
        const daten = await modelle.zugangsdaten('TWITCH');

        await renderView(res, 'guild/streaming-betrieb', {
            tr, guildId,
            clientId: daten.clientId || '',
            secretQuelle: daten.quelle,
            gespeichert: req.query.ok === '1'
        });
    } catch (error) {
        return renderFehler(res, error, 'Die Betriebsseite konnte nicht geladen werden');
    }
});

router.post('/betrieb/zugangsdaten', CheckAdmin, async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;

    try {
        const clientId = String(req.body.client_id || '').trim();
        // Ein leeres Feld heisst "nicht anfassen", nicht "loeschen" - sonst
        // raeumt ein Speichern der Client-ID nebenbei das Geheimnis weg.
        const secret = String(req.body.client_secret || '').trim() || null;

        if (!clientId) {
            return res.redirect(`/guild/${guildId}/plugins/streaming/betrieb?fehler=id`);
        }

        await modelle.zugangsdatenSetzen('TWITCH', clientId, secret);
        Logger.info(`[Streaming] Twitch-Zugangsdaten gesetzt (Secret ${secret ? 'neu' : 'unveraendert'})`);

        return res.redirect(`/guild/${guildId}/plugins/streaming/betrieb?ok=1`);
    } catch (error) {
        return renderFehler(res, error, 'Die Zugangsdaten konnten nicht gespeichert werden');
    }
});

module.exports = router;
