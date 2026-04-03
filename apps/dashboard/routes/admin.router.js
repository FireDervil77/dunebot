/**
 * Admin Router — Zentraler Admin-Bereich
 * 
 * Admin-Routen (ehemals SuperAdmin-Plugin).
 * Alle Routen unter /admin/* (ohne Guild-Kontext).
 * Zugriff nur für Bot-Owner (admin.middleware.js).
 *
 * @author FireBot Team
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { Router } = require('express');
const { ServiceManager } = require('dunebot-core');

const router = Router();

// ================================================================
// MIDDLEWARE: Guild-Layout für alle Admin-Routen setzen
// (Schutz gegen Frontend-Router, der res.locals.layout = frontend setzt)
// ================================================================
router.use((req, res, next) => {
    const themeManager = ServiceManager.get('themeManager');
    res.locals.layout = themeManager.getLayout('guild');
    next();
});

// ================================================================
// HELPER: Global Stats
// ================================================================

async function getGlobalStats(dbService) {
    const Logger = ServiceManager.get('Logger');
    const stats = {};

    const guilds = await dbService.query('SELECT COUNT(*) as count FROM guilds');
    stats.guilds = guilds[0]?.count || 0;

    const users = await dbService.query('SELECT COUNT(*) as count FROM users');
    stats.users = users[0]?.count || 0;

    const news = await dbService.query('SELECT COUNT(*) as count FROM news');
    stats.news = news[0]?.count || 0;

    const notifications = await dbService.query('SELECT COUNT(*) as count FROM notifications');
    stats.notifications = notifications[0]?.count || 0;

    try {
        stats.topGuilds = await dbService.query(`
            SELECT _id, guild_name, guild_id, created_at
            FROM guilds ORDER BY created_at DESC LIMIT 10
        `);
    } catch (_) { stats.topGuilds = []; }

    try {
        const newsResults = await dbService.query(`
            SELECT _id, title_translations, author, status, date, created_at
            FROM news ORDER BY date DESC LIMIT 10
        `);
        stats.recentNews = newsResults.map(n => {
            let title = 'Kein Titel';
            if (n.title_translations) {
                try {
                    const t = typeof n.title_translations === 'string'
                        ? JSON.parse(n.title_translations) : n.title_translations;
                    title = t['de-DE'] || t['en-GB'] || 'Kein Titel';
                } catch (_) {}
            }
            return { ...n, title };
        });
    } catch (err) {
        Logger.error('[Admin] Fehler beim Laden der News:', err);
        stats.recentNews = [];
    }

    try {
        const pluginStats = await dbService.query(`
            SELECT plugin_name, COUNT(DISTINCT guild_id) as guild_count
            FROM guild_plugins WHERE is_enabled = 1
            GROUP BY plugin_name
        `);
        const totalGuilds = (await dbService.query(
            'SELECT COUNT(DISTINCT guild_id) as count FROM guild_plugins WHERE is_enabled = 1'
        ))[0]?.count || 0;

        stats.pluginStats = Object.fromEntries(
            pluginStats.map(r => [r.plugin_name, r.guild_count])
        );
        stats.pluginStats = pluginStats
            .map(({ plugin_name: name, guild_count: count }) => ({
                name, count,
                percentage: totalGuilds > 0 ? Math.round((count / totalGuilds) * 100) : 0
            }))
            .sort((a, b) => b.count - a.count);
    } catch (err) {
        Logger.error('[Admin] Fehler beim Laden der Plugin-Statistiken:', err);
        stats.pluginStats = [];
    }

    return stats;
}

// ================================================================
// DASHBOARD (Übersicht)
// ================================================================

router.get('/', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    const dbService = ServiceManager.get('dbService');

    try {
        const stats = await getGlobalStats(dbService);
        await themeManager.renderView(res, 'admin/dashboard', {
            title: 'Admin Dashboard',
            activeMenu: '/admin',
            stats
        });
    } catch (error) {
        ServiceManager.get('Logger').error('[Admin] Fehler beim Dashboard:', error);
        res.status(500).render('error', { message: 'Fehler beim Laden des Dashboards', error });
    }
});

// ================================================================
// STATISTIKEN
// ================================================================

router.get('/stats', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    const dbService = ServiceManager.get('dbService');

    try {
        const stats = await getGlobalStats(dbService);
        await themeManager.renderView(res, 'admin/stats', {
            title: 'System Statistiken',
            activeMenu: '/admin/stats',
            stats,
            topGuilds: stats.topGuilds || [],
            recentNews: stats.recentNews || [],
            pluginStats: stats.pluginStats || []
        });
    } catch (error) {
        Logger.error('[Admin] Fehler bei /stats:', error);
        res.status(500).render('error', { message: 'Fehler beim Laden der Statistiken', error });
    }
});

// ================================================================
// USER FEEDBACK VERWALTUNG
// ================================================================

router.get('/feedback', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    const dbService = ServiceManager.get('dbService');

    try {
        const feedbackList = await dbService.query(
            'SELECT * FROM user_feedback ORDER BY created_at DESC'
        );
        await themeManager.renderView(res, 'admin/feedback-management', {
            title: 'User Feedback Verwaltung',
            activeMenu: '/admin/feedback',
            feedbackList: feedbackList || []
        });
    } catch (error) {
        Logger.error('[Admin] Fehler beim Laden des User Feedbacks:', error);
        res.status(500).render('error', { message: 'Fehler beim Laden des User Feedbacks', error });
    }
});

router.post('/feedback/:id/update', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const { status, priority, admin_notes, admin_response } = req.body;

    try {
        const updates = [];
        const values = [];

        if (status) { updates.push('status = ?'); values.push(status); }
        if (priority) { updates.push('priority = ?'); values.push(priority); }
        if (admin_notes !== undefined) { updates.push('admin_notes = ?'); values.push(admin_notes); }
        if (admin_response !== undefined) { updates.push('admin_response = ?'); values.push(admin_response); }

        if (status === 'resolved' || status === 'implemented') {
            updates.push('resolved_at = NOW()');
            updates.push('resolved_by = ?');
            values.push(req.session.user?.info?.username || 'Admin');
        }

        values.push(req.params.id);
        await dbService.query(
            `UPDATE user_feedback SET ${updates.join(', ')} WHERE id = ?`,
            values
        );
        res.json({ success: true, message: 'Feedback erfolgreich aktualisiert' });
    } catch (error) {
        Logger.error('[Admin] Fehler beim Aktualisieren des Feedbacks:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

router.delete('/feedback/:id', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    try {
        await dbService.query('DELETE FROM user_feedback WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Feedback erfolgreich gelöscht' });
    } catch (error) {
        Logger.error('[Admin] Fehler beim Löschen des Feedbacks:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ================================================================
// PLUGIN BADGE MANAGEMENT
// ================================================================

router.get('/plugin-badges', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    const dbService = ServiceManager.get('dbService');

    try {
        const badges = await dbService.getAllPluginBadges();
        const pluginsDir = path.join(__dirname, '../../../plugins');
        const availablePlugins = fs.readdirSync(pluginsDir, { withFileTypes: true })
            .filter(d => d.isDirectory() && d.name !== 'node_modules' && !d.name.startsWith('.'))
            .map(d => d.name)
            .sort();

        await themeManager.renderView(res, 'admin/plugin-badges', {
            title: 'Plugin Badge Management',
            activeMenu: '/admin/plugin-badges',
            badges,
            availablePlugins
        });
    } catch (error) {
        Logger.error('[Admin] Fehler beim Laden der Plugin-Badges:', error);
        res.status(500).send('Fehler beim Laden der Plugin-Badges');
    }
});

router.post('/plugin-badges', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const { pluginName, badgeStatus, badgeUntil, isFeatured } = req.body;

    try {
        if (!pluginName || !badgeStatus) {
            return res.status(400).json({ success: false, message: 'Plugin-Name und Badge-Status sind erforderlich' });
        }
        await dbService.setPluginBadge(pluginName, badgeStatus, badgeUntil || null, isFeatured === '1' || isFeatured === true);
        res.json({ success: true, message: `Badge für Plugin "${pluginName}" erfolgreich gesetzt` });
    } catch (error) {
        Logger.error('[Admin] Fehler beim Setzen des Plugin-Badges:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

router.delete('/plugin-badges/:pluginName', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    try {
        await dbService.removePluginBadge(req.params.pluginName);
        res.json({ success: true, message: `Badge für Plugin "${req.params.pluginName}" erfolgreich entfernt` });
    } catch (error) {
        Logger.error('[Admin] Fehler beim Entfernen des Plugin-Badges:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ================================================================
// TOAST-HISTORY
// ================================================================

router.get('/toast-history', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    await themeManager.renderView(res, 'admin/toast-history', {
        title: 'Toast-Event History',
        activeMenu: '/admin/toast-history'
    });
});

// ================================================================
// DONATIONS & ADDONS (migriert aus SuperAdmin → Kern)
// ================================================================

const donationsRouter = require('./admin/donations.router');
router.use('/donations', donationsRouter);

const addonsRouter = require('./admin/addons.router');
router.use('/addons', addonsRouter);

const themesRouter = require('./admin/themes.router');
router.use('/themes', themesRouter);

const docsRouter = require('./admin/docs.router');
router.use('/docs', docsRouter);

const contentRouter = require('./admin/content.router');
router.use('/content', contentRouter);

module.exports = router;
