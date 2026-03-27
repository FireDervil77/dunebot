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
const { NewsHelper, ChangelogHelper, NotificationHelper } = require('dunebot-sdk/utils');

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
// NEWS VERWALTUNG
// ================================================================

router.get('/news/new', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    await themeManager.renderView(res, 'admin/news-edit', {
        title: 'Neue News erstellen',
        activeMenu: '/admin/news',
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
        activeMenu: '/admin/news',
        news
    });
});

router.get('/news', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    const dbService = ServiceManager.get('dbService');
    const userLocale = req.session.locale || res.locals.locale || 'de-DE';

    const rawNewsList = await dbService.query('SELECT * FROM news ORDER BY date DESC');
    const newsList = NewsHelper.getLocalizedNewsList(rawNewsList, userLocale).map(news => ({
        ...news,
        formattedDate: new Date(news.date).toLocaleString(userLocale, {
            year: 'numeric', month: 'long', day: 'numeric'
        })
    }));

    await themeManager.renderView(res, 'admin/news', {
        title: 'News Verwaltung',
        activeMenu: '/admin/news',
        newsList
    });
});

router.post('/news/save', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const { newsId, title_de, title_en, excerpt_de, excerpt_en,
            content_de, content_en, slug, author, image_url, status, date,
            send_discord_post, send_dashboard_badge } = req.body;

    try {
        const translations = {
            'de-DE': { title: title_de || '', content: content_de || '', excerpt: excerpt_de || '' },
            'en-GB': { title: title_en || '', content: content_en || '', excerpt: excerpt_en || '' }
        };
        const metadata = { slug, author, image_url, status, date };
        const newsData = NewsHelper.prepareNewsForDB(translations, metadata);

        let savedNewsId = newsId;
        if (newsId) {
            await dbService.query(`
                UPDATE news SET title_translations=?, content_translations=?, excerpt_translations=?,
                slug=?, author=?, image_url=?, status=?, date=?, updated_at=NOW() WHERE _id=?
            `, [newsData.title_translations, newsData.content_translations, newsData.excerpt_translations,
                newsData.slug, newsData.author, newsData.image_url, newsData.status, newsData.date, newsId]);
        } else {
            const result = await dbService.query(`
                INSERT INTO news (title_translations, content_translations, excerpt_translations,
                slug, author, image_url, status, date, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,NOW(),NOW())
            `, [newsData.title_translations, newsData.content_translations, newsData.excerpt_translations,
                newsData.slug, newsData.author, newsData.image_url, newsData.status, newsData.date]);
            savedNewsId = result.insertId;
        }

        // ============================================================
        // VERÖFFENTLICHUNGS-AKTIONEN
        // ============================================================
        const wantDiscord = send_discord_post === '1';
        const wantBadge = send_dashboard_badge === '1';
        const newsActions = [];

        if (wantDiscord || wantBadge) {
            try {
                const baseUrl = process.env.DASHBOARD_BASE_URL || '';
                const newsUrl = `${baseUrl}/news/${slug || 'news'}`;

                const cleanExcerpt_de = (excerpt_de || title_de || '').replace(/<[^>]+>/g, '').trim();
                const cleanExcerpt_en = (excerpt_en || title_en || '').replace(/<[^>]+>/g, '').trim();

                const notifTranslations = {
                    title: { 'de-DE': `📰 ${title_de || 'Neue News'}`, 'en-GB': `📰 ${title_en || 'New Article'}` },
                    message: { 'de-DE': cleanExcerpt_de, 'en-GB': cleanExcerpt_en },
                    action_text: { 'de-DE': 'News lesen', 'en-GB': 'Read News' }
                };

                const methods = [];
                if (wantBadge) methods.push('dashboard');
                if (wantDiscord) methods.push('discord_category');
                const deliveryMethods = JSON.stringify(methods);

                let resolvedChannelId = null;
                const resolvedGuildId = process.env.CONTROL_GUILD_ID || null;
                if (wantDiscord) {
                    const [setting] = await dbService.query(
                        "SELECT `value` FROM admin_settings WHERE `key` = ?",
                        ['notification_channel_announcement']
                    );
                    if (setting) {
                        try { resolvedChannelId = JSON.parse(setting.value).channel_id || null; } catch {}
                    }
                }

                const notifMeta = {
                    type: 'info', action_url: newsUrl,
                    expiry: null, roles: null, dismissed: 0,
                    delivery_method: deliveryMethods,
                    category: 'announcement',
                    target_guild_ids: resolvedGuildId ? JSON.stringify([resolvedGuildId]) : null,
                    discord_channel_id: resolvedChannelId
                };
                const notifData = NotificationHelper.prepareNotificationForDB(notifTranslations, notifMeta);

                const notifResult = await dbService.query(`
                    INSERT INTO notifications
                    (title_translations, message_translations, action_text_translations,
                     type, category, action_url, expiry, roles, dismissed,
                     delivery_method, target_guild_ids, discord_channel_id,
                     created_at, updated_at)
                    VALUES (?,?,?,?,?,?,?,?,0,?,?,?,NOW(),NOW())
                `, [notifData.title_translations, notifData.message_translations,
                    notifData.action_text_translations, notifData.type,
                    notifMeta.category, notifData.action_url, notifData.expiry,
                    notifData.roles, notifMeta.delivery_method,
                    notifMeta.target_guild_ids, notifMeta.discord_channel_id]);

                // Discord-Post via IPC
                if (wantDiscord) {
                    const ipcServer = ServiceManager.get('ipcServer');
                    await ipcServer.broadcastOne('dashboard:SEND_NOTIFICATION', {
                        id: notifResult.insertId, ...notifData, ...notifMeta,
                        base_url: baseUrl
                    }, true);
                }

                if (wantDiscord) newsActions.push('📢 Discord-Post gesendet');
                if (wantBadge) newsActions.push('🔔 Dashboard-Badge erstellt');
                Logger.info(`[Admin] News-Aktionen für "${title_de}": ${newsActions.join(', ')}`);
            } catch (actionErr) {
                Logger.error('[Admin] News-Aktion fehlgeschlagen:', actionErr);
                newsActions.push('⚠️ Aktion fehlgeschlagen');
            }
        }

        let message = newsId ? 'News erfolgreich aktualisiert' : 'News erfolgreich erstellt';
        if (newsActions.length > 0) {
            message += ' | ' + newsActions.join(' | ');
        }
        res.json({ success: true, message });
    } catch (error) {
        Logger.error('[Admin] Fehler beim Speichern der News:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/news/delete/:id', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    try {
        await dbService.query('DELETE FROM news WHERE _id = ?', [req.params.id]);
        res.json({ success: true, message: 'News erfolgreich gelöscht' });
    } catch (error) {
        Logger.error('[Admin] Fehler beim Löschen der News:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ================================================================
// NOTIFICATIONS VERWALTUNG
// ================================================================

router.get('/notifications', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    const dbService = ServiceManager.get('dbService');
    const userLocale = req.session.locale || res.locals.locale || 'de-DE';

    try {
        const rawNotifications = await dbService.query(
            'SELECT * FROM notifications ORDER BY created_at DESC'
        );
        const notificationsList = NotificationHelper.getLocalizedNotificationList(rawNotifications, userLocale)
            .map(notif => ({
                ...notif,
                formattedDate: new Date(notif.created_at).toLocaleString(userLocale, {
                    year: 'numeric', month: 'long', day: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                })
            }));

        const toast = req.session.toast;
        delete req.session.toast;

        await themeManager.renderView(res, 'admin/notifications', {
            title: 'Globale Notifications',
            activeMenu: '/admin/notifications',
            notifications: notificationsList,
            currentLocale: userLocale,
            toast
        });
    } catch (error) {
        Logger.error('[Admin] Fehler bei /notifications:', error);
        res.status(500).render('error', { message: 'Fehler beim Laden der Notifications', error });
    }
});

router.get('/notifications/new', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    await themeManager.renderView(res, 'admin/notification-edit', {
        title: 'Neue Notification erstellen',
        activeMenu: '/admin/notifications',
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
        activeMenu: '/admin/notifications',
        notification
    });
});

router.post('/notifications/save', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const {
        notificationId, title_de, title_en, message_de, message_en,
        action_text_de, action_text_en, type, category, action_url, expiry, roles,
        delivery_method
    } = req.body;

    try {
        const translations = {
            title: { 'de-DE': title_de || '', 'en-GB': title_en || '' },
            message: { 'de-DE': message_de || '', 'en-GB': message_en || '' },
            action_text: { 'de-DE': action_text_de || 'Mehr erfahren', 'en-GB': action_text_en || 'Learn more' }
        };

        // delivery_method kommt als JSON-Array-String vom Frontend
        let deliveryMethods;
        try {
            deliveryMethods = JSON.parse(delivery_method);
            if (!Array.isArray(deliveryMethods)) deliveryMethods = [delivery_method || 'dashboard'];
        } catch (e) {
            deliveryMethods = [delivery_method || 'dashboard'];
        }
        const deliveryMethodStr = JSON.stringify(deliveryMethods);
        const needsDiscord = deliveryMethods.some(m => m !== 'dashboard');

        // Bei discord_category: Channel aus admin_settings per Kategorie auflösen
        let resolvedChannelId = null;
        let resolvedGuildId = null;
        if (deliveryMethods.includes('discord_category') && category) {
            const [setting] = await dbService.query(
                "SELECT `value` FROM admin_settings WHERE `key` = ?",
                [`notification_channel_${category}`]
            );
            if (setting) {
                try {
                    const cfg = JSON.parse(setting.value);
                    resolvedChannelId = cfg.channel_id || null;
                } catch {}
            }
            resolvedGuildId = process.env.CONTROL_GUILD_ID || null;
        }

        const metadata = {
            type: type || 'info', action_url: action_url || null,
            expiry: expiry || null, roles: roles || null, dismissed: 0,
            delivery_method: deliveryMethodStr,
            category: category || 'other',
            target_guild_ids: resolvedGuildId ? JSON.stringify([resolvedGuildId]) : null,
            discord_channel_id: resolvedChannelId
        };
        const notificationData = NotificationHelper.prepareNotificationForDB(translations, metadata);

        if (notificationId) {
            await dbService.query(`
                UPDATE notifications SET title_translations=?, message_translations=?,
                action_text_translations=?, type=?, category=?, action_url=?, expiry=?, roles=?,
                delivery_method=?, target_guild_ids=?, discord_channel_id=?, updated_at=NOW()
                WHERE id=?
            `, [notificationData.title_translations, notificationData.message_translations,
                notificationData.action_text_translations, notificationData.type,
                metadata.category, notificationData.action_url, notificationData.expiry, notificationData.roles,
                metadata.delivery_method, metadata.target_guild_ids, metadata.discord_channel_id,
                notificationId]);
            return res.json({ success: true, message: 'Notification erfolgreich aktualisiert' });
        } else {
            const result = await dbService.query(`
                INSERT INTO notifications
                (title_translations, message_translations, action_text_translations,
                 type, category, action_url, expiry, roles, dismissed,
                 delivery_method, target_guild_ids, discord_channel_id,
                 created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,0,?,?,?,NOW(),NOW())
            `, [notificationData.title_translations, notificationData.message_translations,
                notificationData.action_text_translations, notificationData.type,
                metadata.category, notificationData.action_url, notificationData.expiry, notificationData.roles,
                metadata.delivery_method, metadata.target_guild_ids, metadata.discord_channel_id]);

            if (needsDiscord) {
                const ipcServer = ServiceManager.get('ipcServer');
                try {
                    await ipcServer.broadcastOne('dashboard:SEND_NOTIFICATION', {
                        id: result.insertId, ...notificationData, ...metadata,
                        base_url: process.env.DASHBOARD_BASE_URL || ''
                    }, true);
                } catch (ipcError) {
                    Logger.error('[Admin] Fehler beim Senden der Notification an Bot:', ipcError);
                    return res.json({
                        success: false,
                        message: 'Notification gespeichert, aber Discord-Versand fehlgeschlagen: ' + ipcError.message
                    });
                }
            }
            return res.json({ success: true, message: 'Notification erfolgreich erstellt' });
        }
    } catch (error) {
        Logger.error('[Admin] Fehler beim Speichern der Notification:', error);
        res.status(500).json({ success: false, message: 'Fehler beim Speichern: ' + error.message });
    }
});

router.post('/notifications/delete/:id', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    try {
        await dbService.query('DELETE FROM notifications WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Notification erfolgreich gelöscht' });
    } catch (error) {
        Logger.error('[Admin] Fehler beim Löschen der Notification:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ================================================================
// NOTIFICATION CHANNEL-KONFIGURATION
// ================================================================

const NOTIFICATION_CATEGORIES = ['announcement', 'changelog', 'status', 'maintenance', 'other'];

// API: Channel-Config laden (für notification-edit.ejs AJAX)
router.get('/notifications/api/channel-config', async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    try {
        const rows = await dbService.query(
            "SELECT `key`, `value` FROM admin_settings WHERE `key` LIKE 'notification_channel_%'"
        );
        const config = {};
        for (const cat of NOTIFICATION_CATEGORIES) {
            const row = rows.find(r => r.key === `notification_channel_${cat}`);
            if (row) {
                try { config[cat] = JSON.parse(row.value); } catch { config[cat] = null; }
            }
        }
        res.json({ success: true, config });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET: Channel-Config Seite
router.get('/notifications/channels', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    const dbService = ServiceManager.get('dbService');
    try {
        const rows = await dbService.query(
            "SELECT `key`, `value` FROM admin_settings WHERE `key` LIKE 'notification_channel_%'"
        );
        const channelConfig = {};
        for (const cat of NOTIFICATION_CATEGORIES) {
            const row = rows.find(r => r.key === `notification_channel_${cat}`);
            channelConfig[cat] = row ? JSON.parse(row.value || '{}') : {};
        }
        await themeManager.renderView(res, 'admin/notification-channels', {
            title: 'Notification Channel-Konfiguration',
            activeMenu: '/admin/notifications',
            channelConfig,
            categories: NOTIFICATION_CATEGORIES,
            controlGuildId: process.env.CONTROL_GUILD_ID || ''
        });
    } catch (error) {
        res.status(500).render('error', { message: 'Fehler beim Laden der Channel-Config', error });
    }
});

// POST: Channel-Config speichern
router.post('/notifications/channels/save', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    try {
        for (const cat of NOTIFICATION_CATEGORIES) {
            const channelId = req.body[`channel_${cat}`] || '';
            const channelName = req.body[`channel_name_${cat}`] || '';
            const value = JSON.stringify({ channel_id: channelId, channel_name: channelName });
            await dbService.query(
                "INSERT INTO admin_settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = ?",
                [`notification_channel_${cat}`, value, value]
            );
        }
        Logger.info('[Admin] Notification Channel-Config aktualisiert');
        res.json({ success: true, message: 'Channel-Konfiguration gespeichert!' });
    } catch (error) {
        Logger.error('[Admin] Fehler beim Speichern der Channel-Config:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ================================================================
// CHANGELOGS VERWALTUNG
// ================================================================

router.get('/changelogs', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    const dbService = ServiceManager.get('dbService');
    const userLocale = req.session.locale || res.locals.locale || 'de-DE';

    const rawChangelogs = await dbService.query(
        'SELECT * FROM changelogs ORDER BY release_date DESC'
    );
    const changelogsList = ChangelogHelper.getLocalizedChangelogList(rawChangelogs, userLocale).map(c => ({
        ...c,
        formattedDate: new Date(c.release_date).toLocaleString(userLocale, {
            year: 'numeric', month: 'long', day: 'numeric'
        }),
        typeBadge: ChangelogHelper.getTypeBadge(c.type),
        componentBadge: ChangelogHelper.getComponentBadge(c.component)
    }));

    const toast = req.session.toast;
    delete req.session.toast;

    await themeManager.renderView(res, 'admin/changelogs', {
        title: 'Changelogs Verwaltung',
        activeMenu: '/admin/changelogs',
        changelogs: changelogsList,
        currentLocale: userLocale,
        toast
    });
});

router.get('/changelogs/new', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    await themeManager.renderView(res, 'admin/changelog-edit', {
        title: 'Neuen Changelog erstellen',
        activeMenu: '/admin/changelogs',
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
        activeMenu: '/admin/changelogs',
        changelog
    });
});

router.post('/changelogs/save', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const {
        changelogId, title_de, title_en, description_de, description_en,
        changes_de, changes_en, version, type, component, component_name,
        is_public, release_date, author_id, status, slug, author,
        create_news_draft, send_discord_announcement, send_dashboard_notification
    } = req.body;

    try {
        const translations = {
            title: { 'de-DE': title_de || '', 'en-GB': title_en || '' },
            description: { 'de-DE': description_de || '', 'en-GB': description_en || '' },
            changes: { 'de-DE': changes_de || '', 'en-GB': changes_en || '' }
        };
        const metadata = {
            version, type: type || 'minor', component: component || 'system',
            component_name: component_name || null,
            is_public: is_public !== undefined ? is_public : 1,
            release_date: release_date || new Date(),
            author_id: author_id || req.session.user?.id || '0',
            status: status || 'published',
            slug: slug || `v${version?.replace(/\./g, '-')}`,
            author: author || req.session.user?.info?.username || 'FireBot Team'
        };
        const changelogData = ChangelogHelper.prepareChangelogForDB(translations, metadata);

        let isNew = false;
        if (changelogId) {
            await dbService.query(`
                UPDATE changelogs SET title_translations=?, description_translations=?,
                changes_translations=?, version=?, type=?, component=?, component_name=?,
                is_public=?, release_date=?, author_id=?, status=?, slug=?, author=?, updated_at=NOW()
                WHERE id=?
            `, [changelogData.title_translations, changelogData.description_translations,
                changelogData.changes_translations, changelogData.version, changelogData.type,
                changelogData.component, changelogData.component_name, changelogData.is_public,
                changelogData.release_date, changelogData.author_id,
                metadata.status, metadata.slug, metadata.author, changelogId]);
        } else {
            isNew = true;
            await dbService.query(`
                INSERT INTO changelogs
                (title_translations, description_translations, changes_translations,
                 version, type, component, component_name, is_public, release_date, author_id,
                 status, slug, author, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())
            `, [changelogData.title_translations, changelogData.description_translations,
                changelogData.changes_translations, changelogData.version, changelogData.type,
                changelogData.component, changelogData.component_name, changelogData.is_public,
                changelogData.release_date, changelogData.author_id,
                metadata.status, metadata.slug, metadata.author]);
        }

        // ============================================================
        // RELEASE-AKTIONEN (nur bei neuem Changelog)
        // ============================================================
        const baseUrl = process.env.DASHBOARD_BASE_URL || '';
        const changelogUrl = `${baseUrl}/changelogs/v${version}`;
        const releaseActions = [];

        // 1) News-Draft erstellen
        if (create_news_draft === '1') {
            try {
                const newsTitle_de = `Update v${version} — ${title_de || 'Neues Update'}`;
                const newsTitle_en = `Update v${version} — ${title_en || 'New Update'}`;
                const newsContent_de = `<p>${description_de || ''}</p><p><a href="${changelogUrl}">📋 Vollständiger Changelog v${version}</a></p>`;
                const newsContent_en = `<p>${description_en || ''}</p><p><a href="${changelogUrl}">📋 Full Changelog v${version}</a></p>`;
                const newsExcerpt_de = description_de || `Update v${version} ist da!`;
                const newsExcerpt_en = description_en || `Update v${version} is here!`;

                const newsTranslations = {
                    'de-DE': { title: newsTitle_de, content: newsContent_de, excerpt: newsExcerpt_de },
                    'en-GB': { title: newsTitle_en, content: newsContent_en, excerpt: newsExcerpt_en }
                };
                const newsMetadata = {
                    slug: `update-v${version?.replace(/\./g, '-')}`,
                    author: metadata.author,
                    image_url: null,
                    status: 'draft',
                    date: new Date()
                };
                const newsData = NewsHelper.prepareNewsForDB(newsTranslations, newsMetadata);

                await dbService.query(`
                    INSERT INTO news (title_translations, content_translations, excerpt_translations,
                    slug, author, image_url, status, date, created_at, updated_at)
                    VALUES (?,?,?,?,?,?,?,?,NOW(),NOW())
                `, [newsData.title_translations, newsData.content_translations, newsData.excerpt_translations,
                    newsData.slug, newsData.author, newsData.image_url, newsData.status, newsData.date]);

                releaseActions.push('📰 News-Entwurf erstellt');
                Logger.info(`[Admin] Release-Aktion: News-Draft für v${version} erstellt`);
            } catch (newsErr) {
                Logger.error('[Admin] Release-Aktion News-Draft fehlgeschlagen:', newsErr);
                releaseActions.push('⚠️ News-Entwurf fehlgeschlagen');
            }
        }

        // 2) Discord-Post und/oder Dashboard-Benachrichtigung
        const wantDiscord = send_discord_announcement === '1';
        const wantDashboard = send_dashboard_notification === '1';

        if (wantDiscord || wantDashboard) {
            try {
                const announcementTitle_de = `📢 Update v${version} veröffentlicht!`;
                const announcementTitle_en = `📢 Update v${version} released!`;
                // HTML-Tags aus TinyMCE-Beschreibung entfernen für Discord
                const cleanDesc_de = (description_de || `Version ${version} ist jetzt verfügbar.`).replace(/<[^>]+>/g, '').trim();
                const cleanDesc_en = (description_en || `Version ${version} is now available.`).replace(/<[^>]+>/g, '').trim();

                const announcementTranslations = {
                    title: { 'de-DE': announcementTitle_de, 'en-GB': announcementTitle_en },
                    message: { 'de-DE': cleanDesc_de, 'en-GB': cleanDesc_en },
                    action_text: { 'de-DE': 'Changelog anzeigen', 'en-GB': 'View Changelog' }
                };

                // Delivery-Methods je nach Checkboxen zusammenbauen
                const methods = [];
                if (wantDashboard) methods.push('dashboard');
                if (wantDiscord) methods.push('discord_category');
                const deliveryMethods = JSON.stringify(methods);

                // Channel für 'announcement' Kategorie auflösen
                let resolvedChannelId = null;
                const resolvedGuildId = process.env.CONTROL_GUILD_ID || null;
                if (wantDiscord) {
                    const [setting] = await dbService.query(
                        "SELECT `value` FROM admin_settings WHERE `key` = ?",
                        ['notification_channel_announcement']
                    );
                    if (setting) {
                        try { resolvedChannelId = JSON.parse(setting.value).channel_id || null; } catch {}
                    }
                }

                const announcementMeta = {
                    type: 'info', action_url: changelogUrl,
                    expiry: null, roles: null, dismissed: 0,
                    delivery_method: deliveryMethods,
                    category: 'changelog',
                    target_guild_ids: resolvedGuildId ? JSON.stringify([resolvedGuildId]) : null,
                    discord_channel_id: resolvedChannelId
                };
                const notificationData = NotificationHelper.prepareNotificationForDB(announcementTranslations, announcementMeta);

                const result = await dbService.query(`
                    INSERT INTO notifications
                    (title_translations, message_translations, action_text_translations,
                     type, category, action_url, expiry, roles, dismissed,
                     delivery_method, target_guild_ids, discord_channel_id,
                     created_at, updated_at)
                    VALUES (?,?,?,?,?,?,?,?,0,?,?,?,NOW(),NOW())
                `, [notificationData.title_translations, notificationData.message_translations,
                    notificationData.action_text_translations, notificationData.type,
                    announcementMeta.category, notificationData.action_url, notificationData.expiry,
                    notificationData.roles, announcementMeta.delivery_method,
                    announcementMeta.target_guild_ids, announcementMeta.discord_channel_id]);

                // Discord-Post via IPC (nur wenn Discord gewünscht)
                if (wantDiscord) {
                    const ipcServer = ServiceManager.get('ipcServer');
                    await ipcServer.broadcastOne('dashboard:SEND_NOTIFICATION', {
                        id: result.insertId, ...notificationData, ...announcementMeta,
                        base_url: baseUrl
                    }, true);
                }

                const actionParts = [];
                if (wantDiscord) actionParts.push('📢 Discord-Post gesendet');
                if (wantDashboard) actionParts.push('🔔 Dashboard-Benachrichtigung erstellt');
                releaseActions.push(...actionParts);
                Logger.info(`[Admin] Release-Aktionen für v${version}: ${actionParts.join(', ')}`);
            } catch (announcementErr) {
                Logger.error('[Admin] Release-Aktion fehlgeschlagen:', announcementErr);
                releaseActions.push('⚠️ Ankündigung fehlgeschlagen');
            }
        }

        // Toast mit Release-Aktionen zusammenbauen
        let toastMsg = changelogId ? 'Changelog erfolgreich aktualisiert' : 'Changelog erfolgreich erstellt';
        if (releaseActions.length > 0) {
            toastMsg += ' | ' + releaseActions.join(' | ');
        }

        req.session.toast = { type: 'success', message: toastMsg };
        const backTo = req.get('Referer')?.includes('/admin/content') ? '/admin/content?tab=changelogs' : '/admin/changelogs';
        res.redirect(backTo);

    } catch (error) {
        Logger.error('[Admin] Fehler beim Speichern des Changelogs:', error);
        req.session.toast = { type: 'danger', message: 'Fehler beim Speichern: ' + error.message };
        const backTo = req.get('Referer')?.includes('/admin/content') ? '/admin/content?tab=changelogs' : '/admin/changelogs';
        res.redirect(backTo);
    }
});

router.post('/changelogs/delete/:id', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    try {
        await dbService.query('DELETE FROM changelogs WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Changelog erfolgreich gelöscht' });
    } catch (error) {
        Logger.error('[Admin] Fehler beim Löschen des Changelogs:', error);
        res.status(500).json({ success: false, message: error.message });
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
