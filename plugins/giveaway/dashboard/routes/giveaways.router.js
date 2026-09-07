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
            allowed_roles, scheduled_start, claim_duration, requirements,
            teilnahme } = req.body;

    if (!channel_id || !prize || !duration) {
        return res.status(400).json({ success: false, error: 'Kanal, Preis und Dauer sind erforderlich' });
    }

    const nutzer = angemeldeterNutzer(req, res);

    // **Der Stream-Weg nur, wenn es ihn gibt.** Im Dialog ist das Feld schon
    // ausgegraut; das hier haelt es auch dann, wenn jemand die Anfrage selbst
    // zusammensetzt. Ein unbekannter Wert faellt auf 'discord' zurueck und
    // nicht auf 'beide' - im Zweifel bleibt es beim Bisherigen.
    const { ServiceManager } = require('dunebot-core');
    const streamMoeglich = ServiceManager.has('pluginManager')
        && await ServiceManager.get('pluginManager')
            .isPluginEnabledForGuild('streaming', res.locals.guildId);

    const weg = ['stream', 'beide'].includes(teilnahme) && streamMoeglich ? teilnahme : 'discord';

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
        teilnahme: weg,

        // **Eine Stream-Bedingung ohne Stream-Weg waere eine Einstellung ohne
        // Wirkung.** Sie faellt hier weg, statt in der Datenbank zu stehen und
        // nie zu greifen - das waere genau die halbe Auskunft, die schlimmer
        // ist als keine.
        requirements: (Array.isArray(requirements) ? requirements : [])
            .filter(r => r.weg !== 'stream' || weg !== 'discord')
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
