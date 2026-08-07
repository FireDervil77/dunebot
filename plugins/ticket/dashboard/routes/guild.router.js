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
