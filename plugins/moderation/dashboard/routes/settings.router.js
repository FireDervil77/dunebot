/**
 * Moderation - Einstellungen speichern
 *
 * Bis zum 2026-08-07 gab es dafuer zwei Routen mit wortgleichem SQL:
 * `POST /save` und `PUT /` (im Code als "Legacy" bezeichnet). Aufgerufen wurde
 * nur `POST /save`, und zwar von genau einer View. Beide sind hier zu einer
 * zusammengefasst; `POST /` bleibt als zweiter Weg bestehen, damit ein
 * klassisches Formular ohne JavaScript ebenfalls durchkommt.
 *
 * @module moderation/routes/settings
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { makeTranslator } = require('./_shared');

/** Checkbox-Werte kommen je nach Formular als '1', 'on' oder true. */
const zuBool = (w) => w === '1' || w === 1 || w === true || w === 'true' || w === 'on';

/**
 * Die angehakten Protokoll-Ereignisse aus dem Rumpf lesen.
 *
 * Je nach Absender heisst das Feld `modlog_events` oder `modlog_events[]`, und
 * bei genau einem Haken kommt ein Einzelwert statt einer Liste.
 *
 * @param {Object} rumpf req.body
 * @returns {Array<string>} Ereignisse
 */
function leseEreignisse(rumpf) {
    const roh = rumpf.modlog_events ?? rumpf['modlog_events[]'];
    if (roh === undefined || roh === null) return [];
    if (Array.isArray(roh)) return roh;
    if (typeof roh === 'string') {
        // Kann auch als JSON-Text ankommen
        try {
            const gelesen = JSON.parse(roh);
            if (Array.isArray(gelesen)) return gelesen;
        } catch { /* kein JSON, dann Einzelwert */ }
        return [roh];
    }
    return [];
}

/**
 * Einstellungen schreiben.
 *
 * @param {string} guildId Discord-Guild-ID
 * @param {Object} b req.body
 */
async function speichern(guildId, b) {
    const dbService = ServiceManager.get('dbService');

    await dbService.query(`
        INSERT INTO moderation_settings
            (guild_id, modlog_channel, max_warn_limit, max_warn_action, modlog_events,
             dm_on_warn, dm_on_kick, dm_on_ban, dm_on_timeout, default_reason,
             dm_embed_description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
            modlog_channel       = VALUES(modlog_channel),
            max_warn_limit       = VALUES(max_warn_limit),
            max_warn_action      = VALUES(max_warn_action),
            modlog_events        = VALUES(modlog_events),
            dm_on_warn           = VALUES(dm_on_warn),
            dm_on_kick           = VALUES(dm_on_kick),
            dm_on_ban            = VALUES(dm_on_ban),
            dm_on_timeout        = VALUES(dm_on_timeout),
            default_reason       = VALUES(default_reason),
            dm_embed_description = VALUES(dm_embed_description),
            updated_at           = NOW()
    `, [
        guildId,
        b.log_channel || null,
        parseInt(b.maxwarn_count, 10) || 5,
        ['TIMEOUT', 'KICK', 'BAN'].includes(b.maxwarn_action) ? b.maxwarn_action : 'KICK',
        JSON.stringify(leseEreignisse(b)),
        zuBool(b.dm_on_warn) ? 1 : 0,
        zuBool(b.dm_on_kick) ? 1 : 0,
        zuBool(b.dm_on_ban) ? 1 : 0,
        zuBool(b.dm_on_timeout) ? 1 : 0,
        b.default_reason || null,
        b.dm_embed_description || null
    ]);
}

/** Ein Handler fuer beide Wege. */
async function behandeln(req, res) {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        await speichern(guildId, req.body);
        Logger.info(`[Moderation] Einstellungen gespeichert fuer Guild ${guildId}`);
        res.json({ success: true, message: tr('moderation:MESSAGES.SETTINGS_SAVED') });
    } catch (error) {
        Logger.error('[Moderation] Fehler beim Speichern der Einstellungen:', error);
        res.status(500).json({ success: false, error: tr('moderation:MESSAGES.SETTINGS_ERROR') });
    }
}

router.put('/', requirePermission('MODERATION.SETTINGS.EDIT'), behandeln);
router.post('/', requirePermission('MODERATION.SETTINGS.EDIT'), behandeln);

module.exports = router;
