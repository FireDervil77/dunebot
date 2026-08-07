/**
 * AutoMod - Eskalationsstufen
 *
 * Je Strike-Schwelle eine Aktion. Die hoechste erreichte Stufe gewinnt.
 *
 * @module automod/routes/escalation
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { AutoModEscalation } = require('../../shared/models');

const AKTIONEN = ['TIMEOUT', 'KICK', 'BAN'];

/** Fehler einheitlich melden und protokollieren. */
function fehler(res, error, text) {
    ServiceManager.get('Logger').error(`[AutoMod] ${text}:`, error);
    res.status(500).json({ success: false, message: text });
}

// Lesen reicht mit AUTOMOD.VIEW - bis zum 2026-08-07 verlangte diese Route
// SETTINGS.EDIT, also Schreibrechte fuers blosse Anzeigen.
router.get('/', requirePermission('AUTOMOD.VIEW'), async (req, res) => {
    try {
        const config = await AutoModEscalation.getConfig(res.locals.guildId);
        res.json({ success: true, config });
    } catch (error) {
        fehler(res, error, 'Eskalationsstufen konnten nicht geladen werden');
    }
});

router.post('/', requirePermission('AUTOMOD.SETTINGS.EDIT'), async (req, res) => {
    const { threshold, action, duration } = req.body;

    if (!action || !AKTIONEN.includes(action)) {
        return res.status(400).json({ success: false, message: 'Aktion muss TIMEOUT, KICK oder BAN sein' });
    }

    const schwelle = parseInt(threshold, 10);
    if (Number.isNaN(schwelle) || schwelle < 1) {
        return res.status(400).json({ success: false, message: 'Die Schwelle muss eine positive Zahl sein' });
    }

    try {
        const id = await AutoModEscalation.addLevel(
            res.locals.guildId,
            schwelle,
            action,
            action === 'TIMEOUT' ? (parseInt(duration, 10) || 10) : null
        );
        res.json({ success: true, id });
    } catch (error) {
        fehler(res, error, 'Eskalationsstufe konnte nicht angelegt werden');
    }
});

router.put('/:id', requirePermission('AUTOMOD.SETTINGS.EDIT'), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ success: false, message: 'Ungueltige ID' });

    const { threshold, action, duration } = req.body;
    const updates = {};
    if (threshold !== undefined) updates.threshold = parseInt(threshold, 10);
    if (action !== undefined && AKTIONEN.includes(action)) updates.action = action;
    if (duration !== undefined) updates.duration = parseInt(duration, 10) || null;

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ success: false, message: 'Nichts zu aendern' });
    }

    try {
        const success = await AutoModEscalation.updateLevel(id, res.locals.guildId, updates);
        res.json({ success });
    } catch (error) {
        fehler(res, error, 'Eskalationsstufe konnte nicht geaendert werden');
    }
});

router.delete('/:id', requirePermission('AUTOMOD.SETTINGS.EDIT'), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ success: false, message: 'Ungueltige ID' });

    try {
        const success = await AutoModEscalation.deleteLevel(id, res.locals.guildId);
        res.json({ success });
    } catch (error) {
        fehler(res, error, 'Eskalationsstufe konnte nicht geloescht werden');
    }
});

router.post('/defaults', requirePermission('AUTOMOD.SETTINGS.EDIT'), async (req, res) => {
    try {
        await AutoModEscalation.createDefaults(res.locals.guildId);
        const config = await AutoModEscalation.getConfig(res.locals.guildId);
        res.json({ success: true, config });
    } catch (error) {
        fehler(res, error, 'Standard-Eskalation konnte nicht angelegt werden');
    }
});

module.exports = router;
