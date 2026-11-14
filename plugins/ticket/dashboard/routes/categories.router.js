/**
 * Ticket - Kategorien
 *
 * Eine Kategorie ist eine Ticket-Art: eigene Schaltflaeche, eigenes Formular,
 * eigenes Team.
 *
 * @module ticket/routes/categories
 */

const express = require('express');
const router = express.Router();
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { TicketCategories } = require('../../shared/models');
const { fehler, makeTranslator } = require('./_shared');
const { csrfProtection } = require('../../../../apps/dashboard/middlewares/security/csrf-protection.middleware');
const { Vorlage } = require('dunebot-sdk');
const { EROEFFNUNG } = require('../../shared/eroeffnung');

/** Felder, die von aussen gesetzt werden duerfen. */
const FELDER = [
    'name', 'description', 'parent_id', 'channel_style',
    'staff_roles', 'member_roles', 'button_label', 'button_emoji', 'button_color',
    'max_open_per_user', 'is_active', 'form_fields'
];

/**
 * Einen Feldwert in die Form bringen, die das Model erwartet.
 *
 * @param {string} feld Feldname
 * @param {*} wert Rohwert aus dem Rumpf
 * @returns {*} Aufbereiteter Wert
 */
function aufbereiten(feld, wert) {
    if (feld === 'max_open_per_user') return parseInt(wert, 10) || 1;
    if (feld === 'is_active') return wert ? 1 : 0;
    if (feld === 'staff_roles' || feld === 'member_roles') return Array.isArray(wert) ? wert : [];
    if (feld === 'form_fields') return Array.isArray(wert) ? wert : null;
    return wert || null;
}

// Lesen reicht mit TICKET.VIEW - bis zum 2026-08-07 verlangte diese Route
// CATEGORIES.MANAGE, also Schreibrechte fuers blosse Anzeigen.
router.get('/', requirePermission('TICKET.VIEW'), async (req, res) => {
    try {
        const kategorien = await TicketCategories.getAll(res.locals.guildId);
        res.json({ success: true, categories: kategorien });
    } catch (error) {
        fehler(res, error, 'Die Kategorien konnten nicht geladen werden');
    }
});

router.post('/', requirePermission('TICKET.CATEGORIES.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';

    if (!name) {
        return res.status(400).json({ success: false, error: 'Ein Name ist erforderlich' });
    }

    try {
        const vorhanden = await TicketCategories.getByName(guildId, name);
        if (vorhanden) {
            return res.status(409).json({ success: false, error: 'Diese Kategorie gibt es bereits' });
        }

        const id = await TicketCategories.create(guildId, {
            name,
            description: req.body.description || null,
            parent_id: req.body.parent_id || null,
            channel_style: req.body.channel_style || 'NUMBER',
            staff_roles: aufbereiten('staff_roles', req.body.staff_roles),
            member_roles: aufbereiten('member_roles', req.body.member_roles),
            button_label: req.body.button_label || 'Ticket erstellen',
            button_emoji: req.body.button_emoji || '🎫',
            button_color: req.body.button_color || 'PRIMARY',
            max_open_per_user: aufbereiten('max_open_per_user', req.body.max_open_per_user),
            form_fields: aufbereiten('form_fields', req.body.form_fields)
        });

        res.json({ success: true, id });
    } catch (error) {
        fehler(res, error, 'Die Kategorie konnte nicht angelegt werden');
    }
});

router.put('/:id', requirePermission('TICKET.CATEGORIES.MANAGE'), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ success: false, error: 'Ungueltige ID' });

    const updates = {};
    for (const feld of FELDER) {
        if (req.body[feld] !== undefined) updates[feld] = aufbereiten(feld, req.body[feld]);
    }

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ success: false, error: 'Nichts zu aendern' });
    }

    try {
        const erfolg = await TicketCategories.update(id, res.locals.guildId, updates);
        if (!erfolg) return res.status(404).json({ success: false, error: 'Kategorie nicht gefunden' });
        res.json({ success: true });
    } catch (error) {
        fehler(res, error, 'Die Kategorie konnte nicht geaendert werden');
    }
});

router.delete('/:id', requirePermission('TICKET.CATEGORIES.MANAGE'), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ success: false, error: 'Ungueltige ID' });

    try {
        const erfolg = await TicketCategories.delete(id, res.locals.guildId);
        if (!erfolg) return res.status(404).json({ success: false, error: 'Kategorie nicht gefunden' });
        res.json({ success: true });
    } catch (error) {
        fehler(res, error, 'Die Kategorie konnte nicht geloescht werden');
    }
});

/**
 * Eröffnungsnachricht einer Kategorie speichern (K389, 2026-11-14). Die
 * Vorlage geht in die Kern-Tabelle `guild_vorlagen`, Stelle = ID der
 * Kategorie; `standard` ist die für Tickets ohne Kategorie. Leer gespeichert
 * gilt wieder die Vorgabe.
 */
router.put('/:id/nachricht', csrfProtection, requirePermission('TICKET.CATEGORIES.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);
    const id = req.params.id === 'standard' ? null : parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ success: false, error: 'Ungueltige ID' });

    try {
        if (id !== null && !(await TicketCategories.getById(id, guildId))) {
            return res.status(404).json({ success: false, error: tr('ticket:VORLAGEN.NICHT_GEFUNDEN') });
        }
        const stelle = id === null ? '' : String(id);
        await Vorlage.speichere(guildId, EROEFFNUNG, req.body?.vorlage, stelle);
        res.json({ success: true, message: tr('ticket:VORLAGEN.GESPEICHERT') });
    } catch (error) {
        if (error instanceof Vorlage.Eingabefehler) {
            return res.status(400).json({ success: false, error: Vorlage.alsText(tr, 'FEHLER', error) });
        }
        fehler(res, error, 'Die Eröffnungsnachricht konnte nicht gespeichert werden');
    }
});

module.exports = router;
