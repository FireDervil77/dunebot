/**
 * AutoMod - Ausnahmen (Rollen und Channels)
 *
 * @module automod/routes/exemptions
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { AutoModExemptions } = require('../../shared/models');

router.get('/', requirePermission('AUTOMOD.WHITELIST.MANAGE'), async (req, res) => {
    try {
        const exemptions = await AutoModExemptions.getAll(res.locals.guildId);
        res.json({ success: true, exemptions });
    } catch (error) {
        ServiceManager.get('Logger').error('[AutoMod] Ausnahmen laden fehlgeschlagen:', error);
        res.status(500).json({ success: false, message: 'Ausnahmen konnten nicht geladen werden' });
    }
});

router.post('/', requirePermission('AUTOMOD.WHITELIST.MANAGE'), async (req, res) => {
    const { type, target_id } = req.body;

    if (!type || !target_id || !['role', 'channel'].includes(type)) {
        return res.status(400).json({
            success: false,
            message: 'Ungueltige Angaben (type muss role oder channel sein, target_id ist erforderlich)'
        });
    }

    try {
        const id = await AutoModExemptions.add(res.locals.guildId, type, target_id);
        res.json({ success: true, id });
    } catch (error) {
        ServiceManager.get('Logger').error('[AutoMod] Ausnahme anlegen fehlgeschlagen:', error);
        res.status(500).json({ success: false, message: 'Ausnahme konnte nicht angelegt werden' });
    }
});

router.delete('/:id', requirePermission('AUTOMOD.WHITELIST.MANAGE'), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ success: false, message: 'Ungueltige ID' });

    try {
        const success = await AutoModExemptions.remove(id, res.locals.guildId);
        res.json({ success });
    } catch (error) {
        ServiceManager.get('Logger').error('[AutoMod] Ausnahme entfernen fehlgeschlagen:', error);
        res.status(500).json({ success: false, message: 'Ausnahme konnte nicht entfernt werden' });
    }
});

module.exports = router;
