/**
 * AutoMod - Regex-Regeln und Kombinations-Regeln
 *
 * Die Lese-Routen verlangten bis zum 2026-08-07 Schreibrechte
 * (`AUTOMOD.RULES.CREATE`), obwohl sie nur anzeigen. Jetzt reicht dafuer
 * `AUTOMOD.VIEW`; geschrieben wird weiterhin nur mit den RULES-Rechten.
 *
 * @module automod/routes/rules
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { AutoModRegexRules, AutoModCompoundRules } = require('../../shared/models');

const AKTIONEN_REGEX = ['DELETE', 'WARN', 'STRIKE'];

/** Fehler einheitlich melden und protokollieren. */
function fehler(res, error, text, status = 500) {
    ServiceManager.get('Logger').error(`[AutoMod] ${text}:`, error);
    res.status(status).json({ success: false, message: text });
}

// =====================================================
// Regex-Regeln
// =====================================================

router.get('/regex-rules', requirePermission('AUTOMOD.VIEW'), async (req, res) => {
    try {
        const rules = await AutoModRegexRules.getRules(res.locals.guildId);
        res.json({ success: true, rules });
    } catch (error) {
        fehler(res, error, 'Regex-Regeln konnten nicht geladen werden');
    }
});

router.post('/regex-rules', requirePermission('AUTOMOD.RULES.CREATE'), async (req, res) => {
    const { name, pattern, action } = req.body;

    if (!name || !pattern || !action) {
        return res.status(400).json({ success: false, message: 'Name, Muster und Aktion sind erforderlich' });
    }
    if (!AKTIONEN_REGEX.includes(action)) {
        return res.status(400).json({ success: false, message: 'Ungueltige Aktion (DELETE, WARN, STRIKE)' });
    }

    try {
        // Das Model prueft das Muster auf ReDoS-Anfaelligkeit und meldet den
        // Grund als result.error zurueck.
        const result = await AutoModRegexRules.addRule(res.locals.guildId, name, pattern, action);
        if (result.error) {
            return res.status(400).json({ success: false, message: result.error });
        }
        res.json({ success: true, id: result.id });
    } catch (error) {
        fehler(res, error, 'Regex-Regel konnte nicht angelegt werden');
    }
});

router.put('/regex-rules/:id', requirePermission('AUTOMOD.RULES.EDIT'), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ success: false, message: 'Ungueltige ID' });

    const { name, pattern, action, enabled } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (pattern !== undefined) updates.pattern = pattern;
    if (action !== undefined && AKTIONEN_REGEX.includes(action)) updates.action = action;
    if (enabled !== undefined) updates.enabled = enabled ? 1 : 0;

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ success: false, message: 'Nichts zu aendern' });
    }

    try {
        const result = await AutoModRegexRules.updateRule(id, res.locals.guildId, updates);
        if (result.error) {
            return res.status(400).json({ success: false, message: result.error });
        }
        res.json({ success: result.success });
    } catch (error) {
        fehler(res, error, 'Regex-Regel konnte nicht geaendert werden');
    }
});

router.delete('/regex-rules/:id', requirePermission('AUTOMOD.RULES.DELETE'), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ success: false, message: 'Ungueltige ID' });

    try {
        const success = await AutoModRegexRules.deleteRule(id, res.locals.guildId);
        res.json({ success });
    } catch (error) {
        fehler(res, error, 'Regex-Regel konnte nicht geloescht werden');
    }
});

// =====================================================
// Kombinations-Regeln
// =====================================================

router.get('/compound-rules', requirePermission('AUTOMOD.VIEW'), async (req, res) => {
    try {
        const rules = await AutoModCompoundRules.getRules(res.locals.guildId);
        res.json({ success: true, rules });
    } catch (error) {
        fehler(res, error, 'Kombinations-Regeln konnten nicht geladen werden');
    }
});

router.post('/compound-rules', requirePermission('AUTOMOD.RULES.CREATE'), async (req, res) => {
    const { name, description, conditions, logic, action, duration } = req.body;

    if (!name || !Array.isArray(conditions) || conditions.length === 0) {
        return res.status(400).json({ success: false, message: 'Name und mindestens eine Bedingung sind erforderlich' });
    }

    try {
        const id = await AutoModCompoundRules.createRule(res.locals.guildId, { name, description, conditions, logic, action, duration });
        const rule = await AutoModCompoundRules.getRule(id, res.locals.guildId);
        res.json({ success: true, rule });
    } catch (error) {
        fehler(res, error, error.message || 'Kombinations-Regel konnte nicht angelegt werden', 400);
    }
});

router.put('/compound-rules/:id', requirePermission('AUTOMOD.RULES.EDIT'), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ success: false, message: 'Ungueltige ID' });

    try {
        await AutoModCompoundRules.updateRule(id, res.locals.guildId, req.body);
        const rule = await AutoModCompoundRules.getRule(id, res.locals.guildId);
        res.json({ success: true, rule });
    } catch (error) {
        fehler(res, error, error.message || 'Kombinations-Regel konnte nicht geaendert werden', 400);
    }
});

router.delete('/compound-rules/:id', requirePermission('AUTOMOD.RULES.DELETE'), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ success: false, message: 'Ungueltige ID' });

    try {
        await AutoModCompoundRules.deleteRule(id, res.locals.guildId);
        res.json({ success: true });
    } catch (error) {
        fehler(res, error, 'Kombinations-Regel konnte nicht geloescht werden');
    }
});

module.exports = router;
