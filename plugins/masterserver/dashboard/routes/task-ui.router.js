/**
 * Masterserver Plugin - Task Management Routes
 * 
 * UI-Routen für Task-Verwaltung
 * - Task-Details-Seite
 * - Task-Übersicht
 * 
 * @module masterserver/routes/task-ui
 * @author FireBot Team
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');

// Helper: themeManager.renderView() wrapper
const renderView = async (res, viewPath, data) => {
    const themeManager = ServiceManager.get('themeManager');
    return await themeManager.renderView(res, viewPath, data);
};

// =====================================================
// Route: Task-Details-Seite
// GET /guild/:guildId/plugins/masterserver/tasks/:taskId
// =====================================================
router.get('/:taskId', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const { taskId } = req.params;
    const guildId = res.locals.guildId;

    try {
        res.locals.pluginName = 'masterserver';
        req.params.pluginName = 'masterserver';

        await renderView(res, 'guild/masterserver-task-details', {
            title: 'Task-Details',
            activeMenu: `/guild/${guildId}/plugins/masterserver/tasks`,
            taskId,
            guildId
        });

    } catch (error) {
        Logger.error('[Masterserver] Task Details Error:', error);
        res.status(500).render('error', { 
            message: 'Fehler beim Laden der Task-Details',
            error: error 
        });
    }
});

module.exports = router;
