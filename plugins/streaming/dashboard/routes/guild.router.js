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
    getTextkanaele, getSprachkanaele, getRollen, vorWieLange
} = require('./_shared');
const modelle = require('../../shared/models');

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

        await renderView(res, 'guild/streaming-streamer', {
            tr, guildId, streamer, anzahl, grenze, vorWieLange
        });
    } catch (error) {
        return renderFehler(res, error, 'Die Streamer-Liste konnte nicht geladen werden');
    }
});

// =====================================================
// Ziele
// =====================================================
router.get('/ziele', requirePermission('STREAMING.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const [ziele, textkanaele, sprachkanaele, rollen] = await Promise.all([
            modelle.zieleDerGuild(guildId),
            getTextkanaele(guildId),
            getSprachkanaele(guildId),
            getRollen(guildId)
        ]);

        await renderView(res, 'guild/streaming-ziele', {
            tr, guildId, ziele, textkanaele, sprachkanaele, rollen
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
