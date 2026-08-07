/**
 * Giveaway - Vorlagen
 *
 * @module giveaway/routes/templates
 */

const express = require('express');
const router = express.Router();
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { angemeldeterNutzer, ueberBot } = require('./_shared');

router.post('/', requirePermission('GIVEAWAY.MANAGE'), async (req, res) => {
    const { name, config } = req.body;

    if (!name || !config) {
        return res.status(400).json({ success: false, error: 'Name und Inhalt sind erforderlich' });
    }

    return ueberBot(res, 'giveaway:templateAction', {
        action: 'create',
        guildId: res.locals.guildId,
        name: String(name).substring(0, 100),
        config,
        createdBy: angemeldeterNutzer(req, res)
    }, 'Die Vorlage konnte nicht angelegt werden');
});

router.delete('/:templateId', requirePermission('GIVEAWAY.MANAGE'), async (req, res) => {
    const id = parseInt(req.params.templateId, 10);
    if (Number.isNaN(id)) {
        return res.status(400).json({ success: false, error: 'Ungueltige ID' });
    }

    return ueberBot(res, 'giveaway:templateAction', {
        action: 'delete',
        guildId: res.locals.guildId,
        templateId: id
    }, 'Die Vorlage konnte nicht geloescht werden');
});

module.exports = router;
