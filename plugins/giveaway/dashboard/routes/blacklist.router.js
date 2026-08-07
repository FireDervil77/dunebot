/**
 * Giveaway - Sperrliste
 *
 * Wer hier steht, kann an keiner Verlosung der Guild teilnehmen.
 *
 * @module giveaway/routes/blacklist
 */

const express = require('express');
const router = express.Router();
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { angemeldeterNutzer, ueberBot } = require('./_shared');

router.post('/', requirePermission('GIVEAWAY.MANAGE'), async (req, res) => {
    const { user_id, reason } = req.body;

    if (!user_id) {
        return res.status(400).json({ success: false, error: 'Eine Mitglieds-ID ist erforderlich' });
    }

    return ueberBot(res, 'giveaway:blacklistAction', {
        action: 'add',
        guildId: res.locals.guildId,
        userId: String(user_id).trim(),
        reason: reason ? String(reason).substring(0, 256) : null,
        addedBy: angemeldeterNutzer(req, res)
    }, 'Der Eintrag konnte nicht angelegt werden');
});

router.delete('/:userId', requirePermission('GIVEAWAY.MANAGE'), async (req, res) => {
    return ueberBot(res, 'giveaway:blacklistAction', {
        action: 'remove',
        guildId: res.locals.guildId,
        userId: req.params.userId
    }, 'Der Eintrag konnte nicht entfernt werden');
});

module.exports = router;
