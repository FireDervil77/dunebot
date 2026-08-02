/**
 * Masterserver Plugin - Task API Routes
 *
 * REST-Zugang zur Task-Queue des Daemons.
 * - Task-Status abrufen
 * - Tasks eines Servers auflisten
 * - Task abbrechen
 *
 * Bis zum 2026-08-02 riefen alle drei Routen `ipmServer.request(...)` auf — eine
 * Methode, die der IPMServer nicht hat. Jeder Aufruf endete in einem TypeError
 * und einem 500er; die Task-Ansicht war damit vollständig tot. Die Gegenseite
 * war die ganze Zeit fertig: der Daemon beantwortet `task:get`, `task:list` und
 * `task:cancel` aus seiner SQLite-Queue.
 *
 * @module masterserver/routes/task
 * @author FireBot Team
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const RootServer = require('../models/RootServer');

/**
 * Ermittelt den Daemon, der die Tasks dieser Guild führt.
 * @returns {Promise<object|null>}
 */
async function daemonDerGuild(guildId) {
    const [rs] = await RootServer.getByGuild(guildId);
    return rs || null;
}

/**
 * Schickt ein Task-Kommando an den Daemon.
 *
 * `sendCommand` weist eine erfolglose Antwort per reject ab — der Aufrufer
 * bekommt die Fehlermeldung des Daemons also als Exception, nicht als
 * `{success:false}`.
 */
async function taskKommando(daemonId, kommando, payload) {
    const ipmServer = ServiceManager.get('ipmServer');
    if (!ipmServer) throw new Error('IPM-Server nicht verfügbar');
    if (!ipmServer.isDaemonOnline(daemonId)) throw new Error('Daemon ist offline');
    return ipmServer.sendCommand(daemonId, kommando, payload, 15000);
}

// =====================================================
// GET /api/tasks/:taskId
// Einzelnen Task mit vollständigen Details abrufen
// =====================================================
router.get('/:taskId', requirePermission('MASTERSERVER.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const { taskId } = req.params;
    const guildId = res.locals.guildId;

    try {
        const daemon = await daemonDerGuild(guildId);
        if (!daemon) {
            return res.status(404).json({ success: false, error: 'Kein Daemon für diese Guild konfiguriert' });
        }

        const antwort = await taskKommando(daemon.daemon_id, 'task:get', { task_id: taskId });

        res.json({ success: true, task: antwort.task || null });

    } catch (error) {
        Logger.error('[Masterserver API] Task GET Error:', error);
        // Der Daemon meldet einen unbekannten Task als Fehler — das ist ein 404,
        // kein Serverfehler.
        const unbekannt = /nicht gefunden|not found/i.test(error.message || '');
        res.status(unbekannt ? 404 : 500).json({
            success: false,
            error: unbekannt ? 'Task nicht gefunden' : 'Task konnte nicht abgerufen werden',
            message: error.message
        });
    }
});

// =====================================================
// GET /api/tasks/server/:serverId
// Alle Tasks eines Servers abrufen
// =====================================================
router.get('/server/:serverId', requirePermission('MASTERSERVER.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const { serverId } = req.params;
    const guildId = res.locals.guildId;
    const { limit = 20, status } = req.query;

    try {
        const daemon = await daemonDerGuild(guildId);
        if (!daemon) {
            return res.status(404).json({ success: false, error: 'Kein Daemon für diese Guild konfiguriert' });
        }

        const antwort = await taskKommando(daemon.daemon_id, 'task:list', {
            server_id: serverId,
            limit: parseInt(limit, 10) || 20,
            status: status || null
        });

        res.json({
            success: true,
            tasks: antwort.tasks || [],
            count: antwort.count || 0
        });

    } catch (error) {
        Logger.error('[Masterserver API] Task List Error:', error);
        res.status(500).json({
            success: false,
            error: 'Tasks konnten nicht geladen werden',
            message: error.message
        });
    }
});

// =====================================================
// POST /api/tasks/:taskId/cancel
// Task abbrechen
// =====================================================
router.post('/:taskId/cancel', requirePermission('MASTERSERVER.DAEMON.MANAGE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const { taskId } = req.params;
    const guildId = res.locals.guildId;

    try {
        const daemon = await daemonDerGuild(guildId);
        if (!daemon) {
            return res.status(404).json({ success: false, error: 'Kein Daemon für diese Guild konfiguriert' });
        }

        await taskKommando(daemon.daemon_id, 'task:cancel', { task_id: taskId });

        Logger.info(`[Masterserver] Task ${taskId} abgebrochen (Guild ${guildId})`);
        res.json({ success: true, message: 'Task abgebrochen' });

    } catch (error) {
        Logger.error('[Masterserver API] Task Cancel Error:', error);
        res.status(400).json({
            success: false,
            error: 'Task konnte nicht abgebrochen werden',
            message: error.message
        });
    }
});

module.exports = router;
