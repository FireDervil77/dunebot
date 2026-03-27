/**
 * Content Router — Unified Content Management
 *
 * Vereint News, Changelogs, Benachrichtigungen und Ankündigungen
 * in einem einzigen Admin-Bereich unter /admin/content.
 *
 * @route /admin/content
 */

'use strict';

const { Router } = require('express');
const { ServiceManager } = require('dunebot-core');
const { NewsHelper, ChangelogHelper, NotificationHelper } = require('dunebot-sdk/utils');

const router = Router();

// Erweiterte Kategorie-Liste (inkl. 'news')
const CONTENT_CATEGORIES = ['announcement', 'changelog', 'news', 'status', 'maintenance', 'other'];

// ================================================================
// HELPER: Alle Content-Daten für den Hub laden
// ================================================================

async function loadHubData(dbService, userLocale) {
    // News
    const rawNews = await dbService.query('SELECT * FROM news ORDER BY date DESC');
    const newsList = NewsHelper.getLocalizedNewsList(rawNews, userLocale).map(n => ({
        ...n,
        formattedDate: new Date(n.date).toLocaleString(userLocale, {
            year: 'numeric', month: 'long', day: 'numeric'
        })
    }));

    // Changelogs
    const rawChangelogs = await dbService.query('SELECT * FROM changelogs ORDER BY release_date DESC');
    const changelogsList = ChangelogHelper.getLocalizedChangelogList(rawChangelogs, userLocale).map(c => ({
        ...c,
        formattedDate: new Date(c.release_date).toLocaleString(userLocale, {
            year: 'numeric', month: 'long', day: 'numeric'
        }),
        typeBadge: ChangelogHelper.getTypeBadge(c.type),
        componentBadge: ChangelogHelper.getComponentBadge(c.component)
    }));

    // All notifications
    const rawNotifications = await dbService.query('SELECT * FROM notifications ORDER BY created_at DESC');
    const allNotifications = NotificationHelper.getLocalizedNotificationList(rawNotifications, userLocale);

    // Split: Benachrichtigungen vs. Ankündigungen
    const notifications = allNotifications.filter(n => n.category !== 'announcement');
    const announcements = allNotifications.filter(n => n.category === 'announcement');

    // Channel-Config
    const rows = await dbService.query(
        "SELECT `key`, `value` FROM admin_settings WHERE `key` LIKE 'notification_channel_%'"
    );
    const channelConfig = {};
    for (const cat of CONTENT_CATEGORIES) {
        const row = rows.find(r => r.key === `notification_channel_${cat}`);
        channelConfig[cat] = row ? (() => { try { return JSON.parse(row.value); } catch { return {}; } })() : {};
    }

    return { newsList, changelogsList, notifications, announcements, channelConfig };
}

// ================================================================
// HUB: Content Overview (Tab-basiert)
// ================================================================

router.get('/', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    const dbService = ServiceManager.get('dbService');
    const userLocale = req.session.locale || res.locals.locale || 'de-DE';
    const activeTab = req.query.tab || 'news';

    try {
        const data = await loadHubData(dbService, userLocale);

        await themeManager.renderView(res, 'admin/content', {
            title: 'Content Management',
            activeMenu: '/admin/content',
            activeTab,
            currentLocale: userLocale,
            newsList: data.newsList,
            changelogsList: data.changelogsList,
            notifications: data.notifications,
            announcements: data.announcements,
            channelConfig: data.channelConfig,
            categories: CONTENT_CATEGORIES,
            controlGuildId: process.env.CONTROL_GUILD_ID || ''
        });
    } catch (error) {
        Logger.error('[Content] Fehler beim Laden des Content Hub:', error);
        res.status(500).render('error', { message: 'Fehler beim Laden des Content Hub', error });
    }
});

// ================================================================
// NEWS: Create / Edit direkt rendern (bleiben im Content-Hub)
// ================================================================

router.get('/news/new', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    await themeManager.renderView(res, 'admin/news-edit', {
        title: 'Neue News erstellen',
        activeMenu: '/admin/content',
        backUrl: '/admin/content?tab=news',
        news: null
    });
});

router.get('/news/edit/:id', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    const dbService = ServiceManager.get('dbService');

    const rawNews = await dbService.query('SELECT * FROM news WHERE _id = ?', [req.params.id]);
    if (!rawNews || rawNews.length === 0) {
        return res.status(404).render('error', { message: 'News-Eintrag nicht gefunden', error: { status: 404 } });
    }

    const news = rawNews[0];
    news.title_de = JSON.parse(news.title_translations)['de-DE'] || '';
    news.title_en = JSON.parse(news.title_translations)['en-GB'] || '';
    news.content_de = JSON.parse(news.content_translations)['de-DE'] || '';
    news.content_en = JSON.parse(news.content_translations)['en-GB'] || '';
    news.excerpt_de = JSON.parse(news.excerpt_translations)['de-DE'] || '';
    news.excerpt_en = JSON.parse(news.excerpt_translations)['en-GB'] || '';

    await themeManager.renderView(res, 'admin/news-edit', {
        title: 'News bearbeiten',
        activeMenu: '/admin/content',
        backUrl: '/admin/content?tab=news',
        news
    });
});

// ================================================================
// CHANGELOGS: Create / Edit direkt rendern
// ================================================================

router.get('/changelogs/new', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    await themeManager.renderView(res, 'admin/changelog-edit', {
        title: 'Neuen Changelog erstellen',
        activeMenu: '/admin/content',
        backUrl: '/admin/content?tab=changelogs',
        changelog: null
    });
});

router.get('/changelogs/edit/:id', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    const dbService = ServiceManager.get('dbService');

    const rawChangelog = await dbService.query('SELECT * FROM changelogs WHERE id = ?', [req.params.id]);
    if (!rawChangelog || rawChangelog.length === 0) {
        return res.status(404).render('error', { message: 'Changelog nicht gefunden', error: { status: 404 } });
    }

    const changelog = rawChangelog[0];
    changelog.title_de = JSON.parse(changelog.title_translations)['de-DE'] || '';
    changelog.title_en = JSON.parse(changelog.title_translations)['en-GB'] || '';
    changelog.description_de = JSON.parse(changelog.description_translations)['de-DE'] || '';
    changelog.description_en = JSON.parse(changelog.description_translations)['en-GB'] || '';
    changelog.changes_de = JSON.parse(changelog.changes_translations)['de-DE'] || '';
    changelog.changes_en = JSON.parse(changelog.changes_translations)['en-GB'] || '';

    await themeManager.renderView(res, 'admin/changelog-edit', {
        title: 'Changelog bearbeiten',
        activeMenu: '/admin/content',
        backUrl: '/admin/content?tab=changelogs',
        changelog
    });
});

// ================================================================
// NOTIFICATIONS: Create / Edit direkt rendern
// ================================================================

router.get('/notifications/new', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    await themeManager.renderView(res, 'admin/notification-edit', {
        title: 'Neue Benachrichtigung erstellen',
        activeMenu: '/admin/content',
        backUrl: '/admin/content?tab=notifications',
        contentTab: 'notifications',
        notification: null
    });
});

router.get('/notifications/edit/:id', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    const dbService = ServiceManager.get('dbService');

    const rawNotification = await dbService.query(
        'SELECT * FROM notifications WHERE id = ?', [req.params.id]
    );
    if (!rawNotification || rawNotification.length === 0) {
        return res.status(404).render('error', { message: 'Notification nicht gefunden', error: { status: 404 } });
    }

    const notification = rawNotification[0];
    notification.title_de = JSON.parse(notification.title_translations)['de-DE'] || '';
    notification.title_en = JSON.parse(notification.title_translations)['en-GB'] || '';
    notification.message_de = JSON.parse(notification.message_translations)['de-DE'] || '';
    notification.message_en = JSON.parse(notification.message_translations)['en-GB'] || '';
    notification.action_text_de = JSON.parse(notification.action_text_translations)['de-DE'] || 'Mehr erfahren';
    notification.action_text_en = JSON.parse(notification.action_text_translations)['en-GB'] || 'Learn more';

    await themeManager.renderView(res, 'admin/notification-edit', {
        title: 'Notification bearbeiten',
        activeMenu: '/admin/content',
        backUrl: '/admin/content?tab=notifications',
        contentTab: 'notifications',
        notification
    });
});

// ================================================================
// ANNOUNCEMENTS: Ankündigungen = Notifications mit category=announcement
// ================================================================

router.get('/announcements/new', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    await themeManager.renderView(res, 'admin/notification-edit', {
        title: 'Neue Ankündigung erstellen',
        activeMenu: '/admin/content',
        backUrl: '/admin/content?tab=announcements',
        contentTab: 'announcements',
        notification: null
    });
});

router.get('/announcements/edit/:id', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    const dbService = ServiceManager.get('dbService');

    const rawNotification = await dbService.query(
        'SELECT * FROM notifications WHERE id = ?', [req.params.id]
    );
    if (!rawNotification || rawNotification.length === 0) {
        return res.status(404).render('error', { message: 'Ankündigung nicht gefunden', error: { status: 404 } });
    }

    const notification = rawNotification[0];
    notification.title_de = JSON.parse(notification.title_translations)['de-DE'] || '';
    notification.title_en = JSON.parse(notification.title_translations)['en-GB'] || '';
    notification.message_de = JSON.parse(notification.message_translations)['de-DE'] || '';
    notification.message_en = JSON.parse(notification.message_translations)['en-GB'] || '';
    notification.action_text_de = JSON.parse(notification.action_text_translations)['de-DE'] || 'Mehr erfahren';
    notification.action_text_en = JSON.parse(notification.action_text_translations)['en-GB'] || 'Learn more';

    await themeManager.renderView(res, 'admin/notification-edit', {
        title: 'Ankündigung bearbeiten',
        activeMenu: '/admin/content',
        backUrl: '/admin/content?tab=announcements',
        contentTab: 'announcements',
        notification
    });
});

// ================================================================
// SETTINGS: Channel-Config speichern (direkt auf Content-Hub)
// ================================================================

router.post('/settings/channels/save', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        for (const cat of CONTENT_CATEGORIES) {
            const channelId = req.body[`channel_${cat}`] || '';
            const channelName = req.body[`channel_name_${cat}`] || '';
            const value = JSON.stringify({ channel_id: channelId, channel_name: channelName });
            await dbService.query(
                "INSERT INTO admin_settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = ?",
                [`notification_channel_${cat}`, value, value]
            );
        }
        Logger.info('[Content] Channel-Konfiguration gespeichert');
        res.json({ success: true, message: 'Channel-Konfiguration gespeichert!' });
    } catch (error) {
        Logger.error('[Content] Fehler beim Speichern der Channel-Config:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
