/**
 * Ticket - Textbausteine
 *
 * Neu am 2026-08-07. Der Bot legt Bausteine ueber `/tag` an und ruft sie dort
 * auch wieder ab - im Dashboard gab es dafuer bis heute weder Route noch
 * Ansicht. Das Model lag fertig da und wurde von keiner Seite genutzt.
 *
 * @module ticket/routes/tags
 */

const express = require('express');
const router = express.Router();
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { TicketTags } = require('../../shared/models');
const { angemeldeterNutzer, fehler } = require('./_shared');

/** Bausteinnamen sind kleingeschrieben und ohne Leerzeichen - wie im Bot. */
const normalisiere = (name) => String(name || '').trim().toLowerCase();

router.get('/', requirePermission('TICKET.VIEW'), async (req, res) => {
    try {
        const bausteine = await TicketTags.getAll(res.locals.guildId);
        res.json({ success: true, tags: bausteine });
    } catch (error) {
        fehler(res, error, 'Die Textbausteine konnten nicht geladen werden');
    }
});

router.post('/', requirePermission('TICKET.SETTINGS.EDIT'), async (req, res) => {
    const guildId = res.locals.guildId;
    const name = normalisiere(req.body.name);
    const inhalt = typeof req.body.content === 'string' ? req.body.content.trim() : '';

    if (!name || !inhalt) {
        return res.status(400).json({ success: false, error: 'Name und Inhalt sind erforderlich' });
    }
    if (/\s/.test(name)) {
        return res.status(400).json({ success: false, error: 'Der Name darf keine Leerzeichen enthalten' });
    }

    try {
        const vorhanden = await TicketTags.getByName(guildId, name);
        if (vorhanden) {
            return res.status(409).json({ success: false, error: 'Diesen Baustein gibt es bereits' });
        }

        await TicketTags.create(guildId, name, inhalt, angemeldeterNutzer(req, res));
        res.json({ success: true });
    } catch (error) {
        fehler(res, error, 'Der Textbaustein konnte nicht angelegt werden');
    }
});

router.put('/:name', requirePermission('TICKET.SETTINGS.EDIT'), async (req, res) => {
    const name = normalisiere(req.params.name);
    const inhalt = typeof req.body.content === 'string' ? req.body.content.trim() : '';

    if (!inhalt) {
        return res.status(400).json({ success: false, error: 'Ein Inhalt ist erforderlich' });
    }

    try {
        await TicketTags.update(res.locals.guildId, name, inhalt);
        res.json({ success: true });
    } catch (error) {
        fehler(res, error, 'Der Textbaustein konnte nicht geaendert werden');
    }
});

router.delete('/:id', requirePermission('TICKET.SETTINGS.EDIT'), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ success: false, error: 'Ungueltige ID' });

    try {
        await TicketTags.deleteById(id, res.locals.guildId);
        res.json({ success: true });
    } catch (error) {
        fehler(res, error, 'Der Textbaustein konnte nicht geloescht werden');
    }
});

module.exports = router;
