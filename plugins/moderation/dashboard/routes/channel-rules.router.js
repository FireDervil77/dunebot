/**
 * Moderation - Kanalregeln
 *
 * Je Kanal abweichende Grenzwerte, oder den Kanal ganz vom AutoMod ausnehmen.
 *
 * @module moderation/routes/channel-rules
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { fehler } = require('./_shared');

router.get('/', requirePermission('MODERATION.VIEW'), async (req, res) => {
    try {
        const regeln = await ServiceManager.get('dbService').query(
            'SELECT * FROM moderation_channel_rules WHERE guild_id = ? ORDER BY created_at DESC',
            [res.locals.guildId]
        );
        res.json({ success: true, channelRules: regeln });
    } catch (error) {
        fehler(res, error, 'Kanalregeln konnten nicht geladen werden');
    }
});

router.post('/', requirePermission('MODERATION.CHANNEL.RULES.MANAGE'), async (req, res) => {
    const { channel_id, max_warn_limit, max_warn_action, automod_exempt, notes } = req.body;
    if (!channel_id) return res.status(400).json({ success: false, error: 'channel_id ist erforderlich' });

    try {
        await ServiceManager.get('dbService').query(`
            INSERT INTO moderation_channel_rules
                (guild_id, channel_id, max_warn_limit, max_warn_action, automod_exempt, notes)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                max_warn_limit  = VALUES(max_warn_limit),
                max_warn_action = VALUES(max_warn_action),
                automod_exempt  = VALUES(automod_exempt),
                notes           = VALUES(notes),
                updated_at      = NOW()
        `, [
            res.locals.guildId,
            channel_id,
            max_warn_limit ? parseInt(max_warn_limit, 10) : null,
            max_warn_action || null,
            automod_exempt ? 1 : 0,
            notes ? String(notes).substring(0, 500) : null
        ]);
        res.json({ success: true });
    } catch (error) {
        fehler(res, error, 'Kanalregel konnte nicht gespeichert werden');
    }
});

router.delete('/:ruleId', requirePermission('MODERATION.CHANNEL.RULES.MANAGE'), async (req, res) => {
    const id = parseInt(req.params.ruleId, 10);
    if (Number.isNaN(id)) return res.status(400).json({ success: false, error: 'Ungueltige ID' });

    try {
        await ServiceManager.get('dbService').query(
            'DELETE FROM moderation_channel_rules WHERE id = ? AND guild_id = ?',
            [id, res.locals.guildId]
        );
        res.json({ success: true });
    } catch (error) {
        fehler(res, error, 'Kanalregel konnte nicht entfernt werden');
    }
});

module.exports = router;
