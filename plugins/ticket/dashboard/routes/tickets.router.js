/**
 * Ticket - Tickets lesen
 *
 * @module ticket/routes/tickets
 */

const express = require('express');
const router = express.Router();
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { Tickets } = require('../../shared/models');
const { fehler } = require('./_shared');

router.get('/', requirePermission('TICKET.TICKETS.VIEW'), async (req, res) => {
    const zustand = ['open', 'closed'].includes(req.query.status) ? req.query.status : null;
    const grenze = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const versatz = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    try {
        const tickets = await Tickets.getAll(res.locals.guildId, { status: zustand, limit: grenze, offset: versatz });
        res.json({ success: true, tickets });
    } catch (error) {
        fehler(res, error, 'Die Tickets konnten nicht geladen werden');
    }
});

router.get('/:ticketId/transcript', requirePermission('TICKET.TICKETS.VIEW'), async (req, res) => {
    const id = parseInt(req.params.ticketId, 10);
    if (Number.isNaN(id)) return res.status(400).json({ success: false, error: 'Ungueltige ID' });

    try {
        const transkript = await Tickets.getTranscript(id);
        if (!transkript) return res.status(404).json({ success: false, error: 'Transkript nicht gefunden' });
        res.json({ success: true, transcript: transkript });
    } catch (error) {
        fehler(res, error, 'Das Transkript konnte nicht geladen werden');
    }
});

module.exports = router;
