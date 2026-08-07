/**
 * Moderation - geschuetzte Rollen
 *
 * Wer eine dieser Rollen traegt, laesst sich ueber die Moderationsbefehle
 * nicht verwarnen, kicken oder bannen.
 *
 * @module moderation/routes/protected-roles
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { fehler } = require('./_shared');

router.get('/', requirePermission('MODERATION.VIEW'), async (req, res) => {
    try {
        const rollen = await ServiceManager.get('dbService').query(
            'SELECT * FROM moderation_protected_roles WHERE guild_id = ? ORDER BY created_at DESC',
            [res.locals.guildId]
        );
        res.json({ success: true, protectedRoles: rollen });
    } catch (error) {
        fehler(res, error, 'Geschuetzte Rollen konnten nicht geladen werden');
    }
});

router.post('/', requirePermission('MODERATION.PROTECTED.ROLES.MANAGE'), async (req, res) => {
    const { role_id } = req.body;
    if (!role_id) return res.status(400).json({ success: false, error: 'role_id ist erforderlich' });

    try {
        await ServiceManager.get('dbService').query(
            'INSERT IGNORE INTO moderation_protected_roles (guild_id, role_id) VALUES (?, ?)',
            [res.locals.guildId, role_id]
        );
        res.json({ success: true });
    } catch (error) {
        fehler(res, error, 'Geschuetzte Rolle konnte nicht hinzugefuegt werden');
    }
});

router.delete('/:roleId', requirePermission('MODERATION.PROTECTED.ROLES.MANAGE'), async (req, res) => {
    try {
        await ServiceManager.get('dbService').query(
            'DELETE FROM moderation_protected_roles WHERE guild_id = ? AND role_id = ?',
            [res.locals.guildId, req.params.roleId]
        );
        res.json({ success: true });
    } catch (error) {
        fehler(res, error, 'Geschuetzte Rolle konnte nicht entfernt werden');
    }
});

module.exports = router;
