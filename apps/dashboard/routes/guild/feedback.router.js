/**
 * Kern-Feedback-Router
 * Routes: /guild/:guildId/feedback/*
 *
 * Ersetzt das Core-Plugin für Bug-Report und Feature-Request Routen.
 *
 * @author FireDervil
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { ServiceManager } = require('dunebot-core');

// GET /feedback/bug-report
router.get('/bug-report', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');
    const guildId = res.locals.guildId;

    const bugs = await dbService.query(`
        SELECT * FROM user_feedback
        WHERE guild_id = ? AND type = 'bug'
        ORDER BY created_at DESC
    `, [guildId]).catch(err => {
        Logger.error('[KernFeedback] Fehler beim Laden der Bug Reports:', err);
        return [];
    });

    await themeManager.renderView(res, 'guild/bug-report', {
        title: 'Bug Report',
        activeMenu: `/guild/${guildId}/feedback/bug-report`,
        guildId,
        bugs: bugs || []
    });
});

// GET /feedback/feature-request
router.get('/feature-request', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');
    const guildId = res.locals.guildId;

    const features = await dbService.query(`
        SELECT * FROM user_feedback
        WHERE guild_id = ? AND type = 'feature'
        ORDER BY upvotes DESC, created_at DESC
    `, [guildId]).catch(err => {
        Logger.error('[KernFeedback] Fehler beim Laden der Feature Requests:', err);
        return [];
    });

    await themeManager.renderView(res, 'guild/feature-request', {
        title: 'Feature Request',
        activeMenu: `/guild/${guildId}/feedback/feature-request`,
        guildId,
        features: features || []
    });
});

// GET /feedback/my-feedback
router.get('/my-feedback', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');
    const guildId = res.locals.guildId;
    const userId = req.session.user.info.id;

    const feedbacks = await dbService.query(`
        SELECT uf.*, 
               (SELECT 1 FROM user_feedback_votes WHERE feedback_id = uf.id AND user_id = ? LIMIT 1) as user_voted
        FROM user_feedback uf
        WHERE uf.guild_id = ? AND uf.user_id = ?
        ORDER BY uf.created_at DESC
    `, [userId, guildId, userId]).catch(err => {
        Logger.error('[KernFeedback] Fehler beim Laden von My Feedback:', err);
        return [];
    });

    await themeManager.renderView(res, 'guild/my-feedback', {
        title: 'Mein Feedback',
        activeMenu: `/guild/${guildId}/feedback/my-feedback`,
        guildId,
        feedbacks: feedbacks || []
    });
});

// GET /feedback/toast-history
router.get('/toast-history', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    const guildId = res.locals.guildId;

    await themeManager.renderView(res, 'guild/toast-history', {
        title: 'Toast Benachrichtigungen',
        activeMenu: `/guild/${guildId}/feedback/toast-history`,
        guildId
    });
});

// POST /feedback/bug-report
router.post('/bug-report', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const userId = req.session.user.info.id;
    const userTag = req.session.user.info.username || 'Unknown';
    const { title, description, category } = req.body;

    if (!title || !description) {
        return res.status(400).json({ success: false, message: 'Titel und Beschreibung erforderlich' });
    }

    try {
        await dbService.query(`
            INSERT INTO user_feedback (guild_id, user_id, user_tag, type, title, description, category, status)
            VALUES (?, ?, ?, 'bug', ?, ?, ?, 'open')
        `, [guildId, userId, userTag, title, description, category || null]);

        res.json({ success: true, message: 'Bug Report erfolgreich erstellt!' });
    } catch (error) {
        Logger.error('[KernFeedback] Fehler beim Erstellen des Bug Reports:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /feedback/feature-request
router.post('/feature-request', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const userId = req.session.user.info.id;
    const userTag = req.session.user.info.username || 'Unknown';
    const { title, description, category } = req.body;

    if (!title || !description) {
        return res.status(400).json({ success: false, message: 'Titel und Beschreibung erforderlich' });
    }

    try {
        await dbService.query(`
            INSERT INTO user_feedback (guild_id, user_id, user_tag, type, title, description, category, status)
            VALUES (?, ?, ?, 'feature', ?, ?, ?, 'open')
        `, [guildId, userId, userTag, title, description, category || null]);

        res.json({ success: true, message: 'Feature Request erfolgreich erstellt!' });
    } catch (error) {
        Logger.error('[KernFeedback] Fehler beim Erstellen des Feature Requests:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /feedback/feature-request/:id/upvote
router.post('/feature-request/:id/upvote', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const feedbackId = req.params.id;
    const userId = req.session.user.info.id;

    if (!feedbackId || isNaN(parseInt(feedbackId))) {
        return res.status(400).json({ success: false, message: 'Ungültige Feedback-ID' });
    }

    try {
        const existing = await dbService.query(
            'SELECT id FROM user_feedback_votes WHERE feedback_id = ? AND user_id = ?',
            [feedbackId, userId]
        );

        if (existing && existing.length > 0) {
            await dbService.query('DELETE FROM user_feedback_votes WHERE feedback_id = ? AND user_id = ?', [feedbackId, userId]);
            await dbService.query('UPDATE user_feedback SET upvotes = upvotes - 1 WHERE id = ?', [feedbackId]);
            res.json({ success: true, action: 'removed' });
        } else {
            await dbService.query('INSERT INTO user_feedback_votes (feedback_id, user_id) VALUES (?, ?)', [feedbackId, userId]);
            await dbService.query('UPDATE user_feedback SET upvotes = upvotes + 1 WHERE id = ?', [feedbackId]);
            res.json({ success: true, action: 'added' });
        }
    } catch (error) {
        Logger.error('[KernFeedback] Fehler beim Upvote:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
