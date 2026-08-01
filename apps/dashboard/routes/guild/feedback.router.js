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

/**
 * Baut die Sichtbarkeitsbedingung für eine Feedback-Abfrage.
 *
 * Normale Guilds sehen alles Guild-übergreifende plus ihre eigenen Einträge.
 * Die Kontroll-Guild sieht zusätzlich die Einträge, die andere Guilds auf sich
 * selbst beschränkt haben — ohne das liesse sich ein vertraulicher Bug-Report
 * nirgends bearbeiten.
 */
function sichtbarkeit(guildId) {
    const controlGuildId = process.env.CONTROL_GUILD_ID;

    if (controlGuildId && String(guildId) === String(controlGuildId)) {
        return { bedingung: '', werte: [] };
    }

    return { bedingung: 'AND (uf.guild_only = 0 OR uf.guild_id = ?)', werte: [guildId] };
}

function istKontrollGuild(guildId) {
    const controlGuildId = process.env.CONTROL_GUILD_ID;
    return Boolean(controlGuildId) && String(guildId) === String(controlGuildId);
}

// GET /feedback/bug-report
router.get('/bug-report', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');
    const guildId = res.locals.guildId;
    const sicht = sichtbarkeit(guildId);

    let bugs = [];
    let ladeFehler = null;

    try {
        bugs = await dbService.query(`
            SELECT uf.*, g.guild_name
            FROM user_feedback uf
            LEFT JOIN guilds g ON g._id = uf.guild_id
            WHERE uf.type = 'bug'
              ${sicht.bedingung}
            ORDER BY uf.created_at DESC
        `, sicht.werte);
    } catch (err) {
        // Kein stilles [] — sonst sieht ein Totalausfall aus wie "keine Einträge".
        Logger.error('[KernFeedback] Fehler beim Laden der Bug Reports:', err);
        ladeFehler = 'Die Bug Reports konnten nicht geladen werden.';
    }

    await themeManager.renderView(res, 'guild/bug-report', {
        title: 'Bug Report',
        activeMenu: `/guild/${guildId}/feedback/bug-report`,
        guildId,
        bugs: bugs || [],
        istKontrollGuild: istKontrollGuild(guildId),
        ladeFehler
    });
});

// GET /feedback/feature-request
router.get('/feature-request', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');
    const guildId = res.locals.guildId;
    const sicht = sichtbarkeit(guildId);

    let features = [];
    let ladeFehler = null;

    try {
        features = await dbService.query(`
            SELECT uf.*, g.guild_name
            FROM user_feedback uf
            LEFT JOIN guilds g ON g._id = uf.guild_id
            WHERE uf.type = 'feature'
              ${sicht.bedingung}
            ORDER BY uf.upvotes DESC, uf.created_at DESC
        `, sicht.werte);
    } catch (err) {
        Logger.error('[KernFeedback] Fehler beim Laden der Feature Requests:', err);
        ladeFehler = 'Die Feature Requests konnten nicht geladen werden.';
    }

    await themeManager.renderView(res, 'guild/feature-request', {
        title: 'Feature Request',
        activeMenu: `/guild/${guildId}/feedback/feature-request`,
        guildId,
        features: features || [],
        istKontrollGuild: istKontrollGuild(guildId),
        ladeFehler
    });
});

// GET /feedback/my-feedback
router.get('/my-feedback', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');
    const guildId = res.locals.guildId;
    const userId = req.session.user.info.id;

    let feedbacks = [];
    let ladeFehler = null;

    try {
        // Eigene Beiträge sind guild-übergreifend: wer aus Guild A meldet, findet
        // seinen Eintrag auch wieder, wenn er das Dashboard von Guild B aus öffnet.
        feedbacks = await dbService.query(`
            SELECT uf.*, g.guild_name,
                   (SELECT 1 FROM user_feedback_votes WHERE feedback_id = uf.id AND user_id = ? LIMIT 1) as user_voted
            FROM user_feedback uf
            LEFT JOIN guilds g ON g._id = uf.guild_id
            WHERE uf.user_id = ?
            ORDER BY uf.created_at DESC
        `, [userId, userId]);
    } catch (err) {
        Logger.error('[KernFeedback] Fehler beim Laden von My Feedback:', err);
        ladeFehler = 'Deine Beiträge konnten nicht geladen werden.';
    }

    await themeManager.renderView(res, 'guild/my-feedback', {
        title: 'Mein Feedback',
        activeMenu: `/guild/${guildId}/feedback/my-feedback`,
        guildId,
        feedbacks: feedbacks || [],
        ladeFehler
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
    const { title, description, category, guild_only } = req.body;

    if (!title || !description) {
        return res.status(400).json({ success: false, message: 'Titel und Beschreibung erforderlich' });
    }

    try {
        await dbService.query(`
            INSERT INTO user_feedback (guild_id, user_id, user_tag, type, title, description, category, status, guild_only)
            VALUES (?, ?, ?, 'bug', ?, ?, ?, 'open', ?)
        `, [guildId, userId, userTag, title, description, category || null, guild_only === 'on' || guild_only === '1' || guild_only === true ? 1 : 0]);

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
    const { title, description, category, guild_only } = req.body;

    if (!title || !description) {
        return res.status(400).json({ success: false, message: 'Titel und Beschreibung erforderlich' });
    }

    try {
        await dbService.query(`
            INSERT INTO user_feedback (guild_id, user_id, user_tag, type, title, description, category, status, guild_only)
            VALUES (?, ?, ?, 'feature', ?, ?, ?, 'open', ?)
        `, [guildId, userId, userTag, title, description, category || null, guild_only === 'on' || guild_only === '1' || guild_only === true ? 1 : 0]);

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
    const guildId = res.locals.guildId;

    if (!feedbackId || isNaN(parseInt(feedbackId))) {
        return res.status(400).json({ success: false, message: 'Ungültige Feedback-ID' });
    }

    try {
        // Ohne diese Prüfung liesse sich mit geratener ID ein Bug oder ein fremder,
        // guild-beschränkter Eintrag hochstimmen.
        const sicht = sichtbarkeit(guildId);
        const erlaubt = await dbService.query(`
            SELECT uf.id
            FROM user_feedback uf
            WHERE uf.id = ?
              AND uf.type = 'feature'
              ${sicht.bedingung}
            LIMIT 1
        `, [feedbackId, ...sicht.werte]);

        if (!erlaubt || erlaubt.length === 0) {
            return res.status(404).json({ success: false, message: 'Feature Request nicht gefunden' });
        }

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
