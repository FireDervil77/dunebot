/**
 * Masterserver Plugin - Task API Routes
 * 
 * REST API für Task-Queue-Abfragen
 * - Task-Status abrufen
 * - Task-History
 * - Task-Logs
 * 
 * @module masterserver/routes/task
 * @author FireBot Team
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');

// =====================================================
// GET /api/tasks/:taskId
// Abrufen eines einzelnen Tasks mit vollständigen Details
// =====================================================
router.get('/:taskId', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipmServer = ServiceManager.get('ipmServer');
    const { taskId } = req.params;
    const guildId = res.locals.guildId;

    try {
        // ✅ Daemon der Guild holen
        
        const _rs = (await require("../models/RootServer").getByGuild(guildId))[0]; const daemon = _rs ? { ..._rs, status: _rs.daemon_status } : null;
        
        if (!daemon) {
            return res.status(404).json({
                success: false,
                error: 'No daemon configured for this guild'
            });
        }

        // ✅ Task-Daten vom Daemon via IPM abrufen
        const taskData = await ipmServer.request(daemon.daemon_id, 'task:get', { 
            task_id: taskId 
        });

        if (!taskData || !taskData.success) {
            return res.status(404).json({
                success: false,
                error: 'Task not found'
            });
        }

        res.json({
            success: true,
            task: taskData.task
        });

    } catch (error) {
        Logger.error('[Masterserver API] Task GET Error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
});

// =====================================================
// GET /api/tasks/server/:serverId
// Alle Tasks eines Servers abrufen
// =====================================================
router.get('/server/:serverId', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipmServer = ServiceManager.get('ipmServer');
    const { serverId } = req.params;
    const guildId = res.locals.guildId;
    const { limit = 20, status } = req.query;

    try {
        
        const _rs = (await require("../models/RootServer").getByGuild(guildId))[0]; const daemon = _rs ? { ..._rs, status: _rs.daemon_status } : null;
        
        if (!daemon) {
            return res.status(404).json({
                success: false,
                error: 'No daemon configured for this guild'
            });
        }

        // ✅ Tasks vom Daemon abrufen
        const tasksData = await ipmServer.request(daemon.daemon_id, 'task:list', { 
            server_id: serverId,
            limit: parseInt(limit),
            status: status || null
        });

        if (!tasksData || !tasksData.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch tasks from daemon'
            });
        }

        res.json({
            success: true,
            tasks: tasksData.tasks || [],
            count: tasksData.count || 0
        });

    } catch (error) {
        Logger.error('[Masterserver API] Task List Error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
});

// =====================================================
// POST /api/tasks/:taskId/cancel
// Task abbrechen
// =====================================================
router.post('/:taskId/cancel', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipmServer = ServiceManager.get('ipmServer');
    const { taskId } = req.params;
    const guildId = res.locals.guildId;

    try {
        
        const _rs = (await require("../models/RootServer").getByGuild(guildId))[0]; const daemon = _rs ? { ..._rs, status: _rs.daemon_status } : null;
        
        if (!daemon) {
            return res.status(404).json({
                success: false,
                error: 'No daemon configured for this guild'
            });
        }

        // ✅ Task-Abbruch via IPM senden
        const result = await ipmServer.request(daemon.daemon_id, 'task:cancel', { 
            task_id: taskId 
        });

        if (!result || !result.success) {
            return res.status(400).json({
                success: false,
                error: result?.error || 'Failed to cancel task'
            });
        }

        res.json({
            success: true,
            message: 'Task cancelled successfully'
        });

    } catch (error) {
        Logger.error('[Masterserver API] Task Cancel Error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
});

module.exports = router;
