/**
 * Moderation - Faelle
 *
 * Jede Verwarnung, jeder Kick, jeder Bann landet mit einer Fallnummer in
 * `moderation_logs`.
 *
 * @module moderation/routes/logs
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { fehler } = require('./_shared');

router.get('/', requirePermission('MODERATION.LOGS.VIEW'), async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;

    const seite = Math.max(1, parseInt(req.query.page, 10) || 1);
    const grenze = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const versatz = (seite - 1) * grenze;
    const art = req.query.type || null;

    try {
        const bedingung = art ? 'WHERE guild_id = ? AND type = ?' : 'WHERE guild_id = ?';
        const werte = art ? [guildId, art] : [guildId];

        const [faelle, zaehlung] = await Promise.all([
            dbService.query(
                `SELECT * FROM moderation_logs ${bedingung} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
                [...werte, grenze, versatz]
            ),
            dbService.query(`SELECT COUNT(*) AS total FROM moderation_logs ${bedingung}`, werte)
        ]);

        const gesamt = zaehlung[0]?.total || 0;
        res.json({
            success: true,
            logs: faelle,
            pagination: { page: seite, limit: grenze, total: gesamt, totalPages: Math.ceil(gesamt / grenze) }
        });
    } catch (error) {
        fehler(res, error, 'Faelle konnten nicht geladen werden');
    }
});

module.exports = router;
