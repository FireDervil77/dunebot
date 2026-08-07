/**
 * Giveaway - Verlosungen anlegen und steuern
 *
 * Alle Vorgaenge laufen ueber IPC beim Bot: der haelt die Zeitgeber, schreibt
 * die Discord-Nachricht und zieht die Gewinner.
 *
 * @module giveaway/routes/giveaways
 */

const express = require('express');
const router = express.Router();
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { angemeldeterNutzer, ueberBot } = require('./_shared');

/** Ganzzahl aus dem Rumpf, oder null. */
const zahlOderNull = (w) => {
    const n = parseInt(w, 10);
    return Number.isNaN(n) ? null : n;
};

// =====================================================
// Anlegen
// =====================================================
router.post('/create', requirePermission('GIVEAWAY.CREATE'), async (req, res) => {
    const { channel_id, prize, duration, winner_count, host_id,
            allowed_roles, scheduled_start, claim_duration, requirements } = req.body;

    if (!channel_id || !prize || !duration) {
        return res.status(400).json({ success: false, error: 'Kanal, Preis und Dauer sind erforderlich' });
    }

    const nutzer = angemeldeterNutzer(req, res);

    return ueberBot(res, 'giveaway:createGiveaway', {
        guildId: res.locals.guildId,
        channelId: channel_id,
        prize: String(prize).substring(0, 256),
        duration: parseInt(duration, 10),
        winnerCount: parseInt(winner_count, 10) || 1,
        createdBy: nutzer,
        hostedBy: host_id || nutzer,
        allowedRoles: Array.isArray(allowed_roles) ? allowed_roles : null,
        scheduledStart: scheduled_start || null,
        claimDurationMs: zahlOderNull(claim_duration),
        requirements: Array.isArray(requirements) ? requirements : []
    }, 'Die Verlosung konnte nicht angelegt werden');
});

// =====================================================
// Steuern
// =====================================================

/** Ein Handler fuer beenden, pausieren, fortsetzen und neu ziehen. */
function vorgang(ereignis, fehlertext) {
    return async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) {
            return res.status(400).json({ success: false, error: 'Ungueltige ID' });
        }
        return ueberBot(res, ereignis, { giveawayId: id }, fehlertext);
    };
}

router.post('/:id/end',    requirePermission('GIVEAWAY.MANAGE'), vorgang('giveaway:endGiveaway',    'Die Verlosung konnte nicht beendet werden'));
router.post('/:id/pause',  requirePermission('GIVEAWAY.MANAGE'), vorgang('giveaway:pauseGiveaway',  'Die Verlosung konnte nicht pausiert werden'));
router.post('/:id/resume', requirePermission('GIVEAWAY.MANAGE'), vorgang('giveaway:resumeGiveaway', 'Die Verlosung konnte nicht fortgesetzt werden'));
router.post('/:id/reroll', requirePermission('GIVEAWAY.MANAGE'), vorgang('giveaway:rerollGiveaway', 'Es konnte kein neuer Gewinner gezogen werden'));

router.delete('/:id', requirePermission('GIVEAWAY.DELETE'), vorgang('giveaway:deleteGiveaway', 'Die Verlosung konnte nicht geloescht werden'));

module.exports = router;
