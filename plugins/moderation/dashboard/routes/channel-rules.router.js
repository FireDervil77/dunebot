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

/**
 * Kanalregel anlegen oder aendern.
 *
 * `automod_exempt` ist am 2026-08-09 entfallen. Das Feld hat nie gewirkt -
 * kein Bot-Prozess hat diese Tabelle je gelesen -, und Kanalausnahmen stehen
 * jetzt an einer Stelle, auf der Ausnahmeseite von AutoMod. Vorhandene
 * Eintraege sind dorthin uebernommen worden.
 *
 * `max_warn_limit` und `max_warn_action` bleiben. Auch sie werden bisher von
 * niemandem ausgewertet - das ist aber keine Ausnahme-Frage, sondern eine
 * eigene, nie gebaute Funktion der Moderation und als eigener Punkt vermerkt.
 */
router.post('/', requirePermission('MODERATION.CHANNEL.RULES.MANAGE'), async (req, res) => {
    const { channel_id, max_warn_limit, max_warn_action, notes } = req.body;
    if (!channel_id) return res.status(400).json({ success: false, error: 'channel_id ist erforderlich' });

    try {
        await ServiceManager.get('dbService').query(`
            INSERT INTO moderation_channel_rules
                (guild_id, channel_id, max_warn_limit, max_warn_action, notes)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                max_warn_limit  = VALUES(max_warn_limit),
                max_warn_action = VALUES(max_warn_action),
                notes           = VALUES(notes),
                updated_at      = NOW()
        `, [
            res.locals.guildId,
            channel_id,
            max_warn_limit ? parseInt(max_warn_limit, 10) : null,
            max_warn_action || null,
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
