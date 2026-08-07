/**
 * Ticket - Einstellungen speichern
 *
 * @module ticket/routes/settings
 */

const express = require('express');
const router = express.Router();
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { TicketSettings } = require('../../shared/models');
const { fehler } = require('./_shared');

router.put('/', requirePermission('TICKET.SETTINGS.EDIT'), async (req, res) => {
    const { log_channel, ticket_limit, embed_color_create, embed_color_close } = req.body;

    try {
        const updates = {};
        if (log_channel !== undefined) updates.log_channel = log_channel || null;
        if (ticket_limit !== undefined) updates.ticket_limit = parseInt(ticket_limit, 10) || 50;
        if (embed_color_create !== undefined) updates.embed_color_create = embed_color_create || '#068ADD';
        if (embed_color_close !== undefined) updates.embed_color_close = embed_color_close || '#068ADD';

        await TicketSettings.updateSettings(res.locals.guildId, updates);
        res.json({ success: true });
    } catch (error) {
        fehler(res, error, 'Die Einstellungen konnten nicht gespeichert werden');
    }
});

module.exports = router;
