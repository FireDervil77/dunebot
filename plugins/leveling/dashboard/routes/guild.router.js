'use strict';

/**
 * Leveling - Seiten (LV-1a, 2026-11-15).
 *
 *   /             → Weiterleitung auf /uebersicht
 *   /uebersicht   Regeln, die gerade gelten (Chat, Sprache, Belohnungen), und
 *                 die ersten zehn der Rangliste
 *
 * Die Einstellseiten (XP-Regeln, Stufen, Belohnungen, Nachrichten,
 * Ausschlüsse, Datenverwaltung) kommen mit LV-1i.
 *
 * @module leveling/routes/guild
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { Fortschritt } = require('dunebot-sdk');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const Regeln = require('../../shared/regeln');
const Belohnungen = require('../../shared/belohnungen');

function makeTranslator(req, res) {
    return (key, options = {}) => {
        if (typeof req.translate === 'function') return req.translate(key, options);
        const i18n = ServiceManager.get('i18n');
        return i18n?.i18next ? i18n.i18next.t(key, { ...options, lng: res.locals?.locale || 'de-DE' }) : key;
    };
}

/**
 * Namen der Mitglieder über den Bot. Ohne Antwort bleiben die IDs stehen,
 * und die Seite sagt es (`namenFehlen`).
 *
 * @returns {Promise<{namen: Object<string, string>, fehlen: boolean}>}
 */
async function namenVon(guildId, ids) {
    if (!ids.length) return { namen: {}, fehlen: false };
    try {
        const antworten = await ServiceManager.get('ipcServer').broadcast('dashboard:GET_GUILD_MEMBERS', { guildId, userIds: ids });
        const gut = (antworten || []).find((a) => a?.success && a.members);
        if (!gut) return { namen: {}, fehlen: true };
        const namen = {};
        for (const [id, m] of Object.entries(gut.members)) if (m?.displayName || m?.username) namen[id] = m.displayName || m.username;
        return { namen, fehlen: false };
    } catch (error) {
        ServiceManager.get('Logger').warn(`[Leveling] Namen nicht geladen: ${error.message}`);
        return { namen: {}, fehlen: true };
    }
}

/**
 * Rollennamen über den Bot (wie im discord-Plugin). Ohne Antwort bleiben die
 * IDs stehen, und die Seite sagt es.
 *
 * @returns {Promise<{namen: Object<string, string>, fehlen: boolean}>}
 */
async function rollenNamen(guildId, ids) {
    if (!ids.length) return { namen: {}, fehlen: false };
    try {
        const antworten = await ServiceManager.get('ipcServer').broadcast('dashboard:GET_GUILD_ROLES_DETAILED', { guildId });
        const gut = (antworten || []).map((a) => a?.data ?? a).find((a) => a?.success && Array.isArray(a.roles));
        if (!gut) return { namen: {}, fehlen: true };
        return { namen: Object.fromEntries(gut.roles.map((r) => [String(r.id), r.name])), fehlen: false };
    } catch (error) {
        ServiceManager.get('Logger').warn(`[Leveling] Rollennamen nicht geladen: ${error.message}`);
        return { namen: {}, fehlen: true };
    }
}

router.get('/', requirePermission('LEVELING.VIEW'), (req, res) => {
    res.redirect(`/guild/${res.locals.guildId}/plugins/leveling/uebersicht`);
});

router.get('/uebersicht', requirePermission('LEVELING.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);
    try {
        const [regeln, rangliste, stufen] = await Promise.all([
            Regeln.lade(guildId, { frisch: true }),
            Fortschritt.rangliste({ guildId, kennung: 'leveling:community', zeitraum: 'gesamt', seite: 1, proSeite: 10 }),
            Fortschritt.stufen({ guildId, kennung: 'leveling:community' }),
        ]);
        const { namen, fehlen } = await namenVon(guildId, rangliste.eintraege.map((e) => String(e.mitglied_id)));
        const belohnungen = regeln ? await Belohnungen.lade(guildId) : { belohnungen: [], vorherigeEntfernen: false };
        const rollen = await rollenNamen(guildId, belohnungen.belohnungen.map((b) => b.wert));
        await ServiceManager.get('themeManager').renderView(res, 'guild/leveling-uebersicht', {
            tr, guildId, regeln, rangliste, namen, namenFehlen: fehlen,
            stufenAnzahl: stufen.stufen.length, schablone: stufen.schablone,
            belohnungen, rollenNamen: rollen.namen, rollenNamenFehlen: rollen.fehlen,
        });
    } catch (error) {
        ServiceManager.get('Logger').error('[Leveling] Übersicht nicht geladen:', error);
        res.locals.layout = ServiceManager.get('themeManager')?.getLayout('guild');
        return res.status(500).render('error', {
            status: 500,
            message: 'Leveling',
            error: { status: 500, title: tr('leveling:FEHLER.SEITE'), message: tr('leveling:FEHLER.UEBERSICHT'), details: error.message }
        });
    }
});

module.exports = router;
