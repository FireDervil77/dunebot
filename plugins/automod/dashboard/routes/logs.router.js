/**
 * AutoMod - Protokoll
 *
 * Neu am 2026-08-07. Der Bot schreibt seit jeher in `automod_logs`,
 * `automod_strikes` und `automod_raid_events`. Im Dashboard gab es dafuer
 * bis heute keine einzige Route - die Daten lagen unsichtbar in der Datenbank
 * und die Berechtigung `AUTOMOD.LOGS.VIEW` bewachte nichts.
 *
 * @module automod/routes/logs
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { AutoModLogs, AutoModStrikes, AutoModRaidEvents } = require('../../shared/models');

/** Fehler einheitlich melden und protokollieren. */
function fehler(res, error, text) {
    ServiceManager.get('Logger').error(`[AutoMod] ${text}:`, error);
    res.status(500).json({ success: false, message: text });
}

/** Zeitraum aus der Anfrage lesen, auf 1 bis 90 Tage begrenzt. */
function leseZeitraum(req) {
    return Math.min(Math.max(parseInt(req.query.tage, 10) || 7, 1), 90);
}

// =====================================================
// Verstoesse
// =====================================================

router.get('/', requirePermission('AUTOMOD.LOGS.VIEW'), async (req, res) => {
    const grenze = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);

    try {
        const logs = await AutoModLogs.getRecentLogs(res.locals.guildId, grenze);
        res.json({ success: true, logs });
    } catch (error) {
        fehler(res, error, 'Das Protokoll konnte nicht geladen werden');
    }
});

router.get('/stats', requirePermission('AUTOMOD.LOGS.VIEW'), async (req, res) => {
    try {
        const statistik = await AutoModLogs.getStats(res.locals.guildId, leseZeitraum(req));
        res.json({ success: true, statistik });
    } catch (error) {
        fehler(res, error, 'Die Statistik konnte nicht geladen werden');
    }
});

router.get('/member/:memberId', requirePermission('AUTOMOD.LOGS.VIEW'), async (req, res) => {
    const grenze = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);

    try {
        const logs = await AutoModLogs.getMemberLogs(res.locals.guildId, req.params.memberId, grenze);
        res.json({ success: true, logs });
    } catch (error) {
        fehler(res, error, 'Die Eintraege des Mitglieds konnten nicht geladen werden');
    }
});

// =====================================================
// Strikes
// =====================================================

router.get('/strikes', requirePermission('AUTOMOD.LOGS.VIEW'), async (req, res) => {
    const grenze = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 200);

    try {
        const strikes = await AutoModStrikes.getTopStrikes(res.locals.guildId, grenze);
        res.json({ success: true, strikes });
    } catch (error) {
        fehler(res, error, 'Die Strikes konnten nicht geladen werden');
    }
});

/**
 * Strikes eines Mitglieds zuruecksetzen.
 *
 * Das greift in die Moderation ein, deshalb Schreibrechte - Lesen allein
 * reicht dafuer nicht.
 */
router.post('/strikes/:memberId/reset', requirePermission('AUTOMOD.SETTINGS.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');

    try {
        await AutoModStrikes.resetStrikes(res.locals.guildId, req.params.memberId);
        Logger.info(`[AutoMod] Strikes von ${req.params.memberId} in Guild ${res.locals.guildId} zurueckgesetzt`);
        res.json({ success: true });
    } catch (error) {
        fehler(res, error, 'Die Strikes konnten nicht zurueckgesetzt werden');
    }
});

// =====================================================
// Raid-Ereignisse
// =====================================================

router.get('/raid-events', requirePermission('AUTOMOD.LOGS.VIEW'), async (req, res) => {
    const grenze = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);

    try {
        const [ereignisse, statistik] = await Promise.all([
            AutoModRaidEvents.getRecentEvents(res.locals.guildId, grenze),
            AutoModRaidEvents.getEventStats(res.locals.guildId)
        ]);
        res.json({ success: true, ereignisse, statistik });
    } catch (error) {
        fehler(res, error, 'Die Raid-Ereignisse konnten nicht geladen werden');
    }
});

// =====================================================
// Aufraeumen
// =====================================================

/**
 * Alte Eintraege loeschen. `tage` gibt an, was behalten wird.
 *
 * Das Protokoll waechst sonst unbegrenzt - bisher gab es keinen Weg, es zu
 * beschneiden, weil es keine Oberflaeche dafuer gab.
 */
router.post('/cleanup', requirePermission('AUTOMOD.SETTINGS.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const tage = Math.min(Math.max(parseInt(req.body.tage, 10) || 30, 1), 365);

    try {
        const [logs, ereignisse] = await Promise.all([
            AutoModLogs.deleteOldLogs(guildId, tage),
            AutoModRaidEvents.cleanupOldEvents(guildId, tage)
        ]);

        Logger.info(`[AutoMod] Protokoll aufgeraeumt fuer Guild ${guildId}: ${logs} Verstoesse, ${ereignisse} Raid-Ereignisse geloescht`);
        res.json({ success: true, geloescht: { logs, ereignisse }, tage });
    } catch (error) {
        fehler(res, error, 'Das Protokoll konnte nicht aufgeraeumt werden');
    }
});

module.exports = router;
