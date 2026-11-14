/**
 * Ticket - Seitenrouten
 *
 * Bis zum 2026-08-07 eine Seite mit drei Tabs. Jetzt traegt jeder Bereich
 * eine eigene Adresse:
 *
 *   /              -> Weiterleitung auf /dashboard
 *   /dashboard     Uebersicht
 *   /tickets       Offene und geschlossene Tickets
 *   /kategorien    Ticket-Arten samt Formular und Schaltflaeche
 *   /kategorien/:id/nachricht  Eröffnungsnachricht einer Kategorie (K389),
 *                  `standard` = Tickets ohne Kategorie
 *   /bausteine     Textbausteine (Tags) - neu
 *   /settings      Grundeinstellungen (unter Kern-Einstellungen)
 *
 * @module ticket/routes/guild
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { TicketSettings, TicketCategories, Tickets, TicketTags } = require('../../shared/models');
const { makeTranslator, renderView, getGuildChannels, getGuildRoles, renderFehler } = require('./_shared');
const { Vorlage } = require('dunebot-sdk');
const Eroeffnung = require('../../shared/eroeffnung');

/** Skripte anmelden, die eine Seite braucht. */
function skripteAnmelden(handles) {
    const assetManager = ServiceManager.get('assetManager');
    if (!assetManager) return;
    handles.forEach(h => assetManager.enqueueScript(h));
}

// =====================================================
// Hauptmenue-Punkt -> Uebersicht
// =====================================================
router.get('/', requirePermission('TICKET.VIEW'), (req, res) => {
    res.redirect(`/guild/${res.locals.guildId}/plugins/ticket/dashboard`);
});

// =====================================================
// Uebersicht
// =====================================================
router.get('/dashboard', requirePermission('TICKET.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const [settings, kategorien, letzteTickets, offen, geschlossen, bausteine] = await Promise.all([
            TicketSettings.getSettings(guildId),
            TicketCategories.getAll(guildId),
            Tickets.getAll(guildId, { limit: 10 }),
            Tickets.getCount(guildId, 'open'),
            Tickets.getCount(guildId, 'closed'),
            TicketTags.getAll(guildId).catch(() => [])
        ]);

        await renderView(res, 'guild/ticket-dashboard', {
            tr, guildId, settings, kategorien, letzteTickets,
            anzahl: {
                offen,
                geschlossen,
                gesamt: offen + geschlossen,
                kategorien: kategorien.length,
                bausteine: bausteine.length
            }
        });
    } catch (error) {
        return renderFehler(res, error, 'Die Ticket-Uebersicht konnte nicht geladen werden');
    }
});

// =====================================================
// Tickets
// =====================================================
router.get('/tickets', requirePermission('TICKET.TICKETS.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    const zustand = ['open', 'closed'].includes(req.query.zustand) ? req.query.zustand : null;
    const seite = Math.max(1, parseInt(req.query.seite, 10) || 1);
    const proSeite = 50;

    try {
        const [tickets, offen, geschlossen] = await Promise.all([
            Tickets.getAll(guildId, { status: zustand, limit: proSeite, offset: (seite - 1) * proSeite }),
            Tickets.getCount(guildId, 'open'),
            Tickets.getCount(guildId, 'closed')
        ]);

        skripteAnmelden(['ticket-actions']);

        await renderView(res, 'guild/ticket-list', {
            tr, guildId, tickets, zustand,
            seiten: { aktuell: seite, proSeite },
            anzahl: { offen, geschlossen, gesamt: offen + geschlossen }
        });
    } catch (error) {
        return renderFehler(res, error, 'Die Tickets konnten nicht geladen werden');
    }
});

// =====================================================
// Kategorien
// =====================================================
router.get('/kategorien', requirePermission('TICKET.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const [kategorien, channels, roles] = await Promise.all([
            TicketCategories.getAll(guildId),
            getGuildChannels(guildId),
            getGuildRoles(guildId)
        ]);

        skripteAnmelden(['ticket-actions']);

        await renderView(res, 'guild/ticket-categories', { tr, guildId, kategorien, channels, roles });
    } catch (error) {
        return renderFehler(res, error, 'Die Kategorien konnten nicht geladen werden');
    }
});

// =====================================================
// Eröffnungsnachricht einer Kategorie (K389, 2026-11-14)
//
// Eigene Seite statt Feldern im Dialog der Kategorie: Der Kern-Teil
// „Nachricht“ (shared/vorlage) braucht Platz für Form, Felder und Vorschau.
// `standard` ist die Nachricht für Tickets ohne Kategorie (Stelle leer).
// Die Vorgabe ist die, die der Bot in der Sprache der Guild sendet.
// =====================================================
router.get('/kategorien/:id/nachricht', requirePermission('TICKET.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const stelle = req.params.id === 'standard' ? '' : String(parseInt(req.params.id, 10) || '');
        const kategorie = stelle ? await TicketCategories.getById(Number(stelle), guildId) : null;
        if (req.params.id !== 'standard' && !kategorie) {
            return renderFehler(res, new Error(tr('ticket:VORLAGEN.NICHT_GEFUNDEN')), tr('ticket:VORLAGEN.NICHT_GEFUNDEN'));
        }
        const konfig = await ServiceManager.get('dbService').getConfigs(guildId);
        const teil = await Vorlage.editor(guildId, Eroeffnung.EROEFFNUNG, Eroeffnung.vorgabe(Eroeffnung.texteAus(konfig?.LOCALE)), stelle);

        // Die Adresse trägt eine ID, ist also kein Menüpunkt: Kategorien leuchtet.
        await renderView(res, 'guild/ticket-eroeffnung', {
            tr, guildId, kategorie, stelle, teil,
            activeMenu: `/guild/${guildId}/plugins/ticket/kategorien`
        });
    } catch (error) {
        return renderFehler(res, error, 'Die Eröffnungsnachricht konnte nicht geladen werden');
    }
});

// =====================================================
// Textbausteine
//
// Neu am 2026-08-07. Der Bot legt sie ueber `/tag` an und liest sie dort auch
// wieder - im Dashboard gab es dafuer bis heute weder Route noch Ansicht.
// =====================================================
router.get('/bausteine', requirePermission('TICKET.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const bausteine = await TicketTags.getAll(guildId).catch(() => []);
        skripteAnmelden(['ticket-actions']);

        await renderView(res, 'guild/ticket-tags', { tr, guildId, bausteine });
    } catch (error) {
        return renderFehler(res, error, 'Die Textbausteine konnten nicht geladen werden');
    }
});

// =====================================================
// Grundeinstellungen (haengt unter den Kern-Einstellungen)
// =====================================================
router.get('/settings', requirePermission('TICKET.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const [settings, channels] = await Promise.all([
            TicketSettings.getSettings(guildId),
            getGuildChannels(guildId)
        ]);

        skripteAnmelden(['ticket-actions']);

        await renderView(res, 'guild/ticket-settings', { tr, guildId, settings, channels });
    } catch (error) {
        return renderFehler(res, error, 'Die Ticket-Einstellungen konnten nicht geladen werden');
    }
});

module.exports = router;
