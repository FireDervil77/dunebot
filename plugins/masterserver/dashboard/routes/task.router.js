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

// ── Welcher Daemon kennt den Task? (2026-10-27) ─────────────────────────────
//
// Tasks liegen im Daemon der Maschine, auf der sie laufen. Bis hierher fragte
// jede Route „den ersten" Rootserver der Guild — bei zwei Maschinen war das
// zufällig der neueste, und die Tasks eines Servers auf der anderen Maschine
// gab es nicht. Aufgefallen, als die Übersicht ältesten-zuerst sortiert wurde:
// Das hätte den Fehler bloß auf die andere Maschine verschoben.

/** Der Daemon, auf dem dieser Gameserver läuft — oder null. */
async function daemonDesServers(guildId, serverId) {
    const [z] = await ServiceManager.get('dbService').query(
        `SELECT r.daemon_id FROM gameservers gs JOIN rootserver r ON r.id = gs.rootserver_id
          WHERE gs.id = ? AND gs.guild_id = ?`, [serverId, guildId]);
    return z?.daemon_id || null;
}

/**
 * Den Daemon suchen, der diesen Task kennt: alle verbundenen der Guild, der
 * Reihe nach. Gibt {daemonId, antwort} zurück oder wirft „Task nicht gefunden".
 */
async function daemonMitTask(guildId, taskId) {
    const ipmServer = ServiceManager.get('ipmServer');
    let letzterFehler = null;
    for (const rs of await RootServer.getByGuild(guildId)) {
        if (!rs.daemon_id || !ipmServer?.isDaemonOnline(rs.daemon_id)) continue;
        try {
            const antwort = await taskKommando(rs.daemon_id, 'task:get', { task_id: taskId });
            if (antwort?.task) return { daemonId: rs.daemon_id, antwort };
        } catch (fehler) {
            if (!/nicht gefunden|not found/i.test(fehler.message || '')) letzterFehler = fehler;
        }
    }
    if (letzterFehler) throw letzterFehler;
    throw new Error('Task nicht gefunden');
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
        const { antwort } = await daemonMitTask(guildId, taskId);

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
        const daemonId = await daemonDesServers(guildId, serverId);
        if (!daemonId) {
            return res.status(404).json({ success: false, error: 'Server nicht gefunden' });
        }

        const antwort = await taskKommando(daemonId, 'task:list', {
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
        const { daemonId } = await daemonMitTask(guildId, taskId);
        await taskKommando(daemonId, 'task:cancel', { task_id: taskId });

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
