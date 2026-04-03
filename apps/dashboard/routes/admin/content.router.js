/**
 * Content Router — Unified Content Management
 *
 * Vereint News, Changelogs und Benachrichtigungen
 * in einem einzigen Admin-Bereich unter /admin/content.
 * Alle CRUD-Operationen (save/delete) + Hub + Edit-Views.
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

/**
 * Entfernt HTML-Tags und dekodiert HTML-Entities (inkl. Umlaute)
 */
function stripHtmlForDiscord(html) {
    if (!html || typeof html !== 'string') return '';
    return html
        .replace(/<[^>]+>/g, '')
        .replace(/&auml;/g, 'ä').replace(/&ouml;/g, 'ö').replace(/&uuml;/g, 'ü')
        .replace(/&Auml;/g, 'Ä').replace(/&Ouml;/g, 'Ö').replace(/&Uuml;/g, 'Ü')
        .replace(/&szlig;/g, 'ß')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .trim();
}

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

    // All notifications (inkl. Ankündigungen)
    const rawNotifications = await dbService.query('SELECT * FROM notifications ORDER BY created_at DESC');
    const notifications = NotificationHelper.getLocalizedNotificationList(rawNotifications, userLocale);

    // Channel-Config
    const rows = await dbService.query(
        "SELECT `key`, `value` FROM admin_settings WHERE `key` LIKE 'notification_channel_%'"
    );
    const channelConfig = {};
    for (const cat of CONTENT_CATEGORIES) {
        const row = rows.find(r => r.key === `notification_channel_${cat}`);
        channelConfig[cat] = row ? (() => { try { return JSON.parse(row.value); } catch { return {}; } })() : {};
    }

    return { newsList, changelogsList, notifications, channelConfig };
}

// ================================================================
// HUB: Content Overview (Tab-basiert)
// ================================================================

router.get('/', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    const dbService = ServiceManager.get('dbService');
    const userLocale = req.session.locale || res.locals.locale || 'de-DE';
    const activeTab = req.query.tab === 'announcements' ? 'notifications' : (req.query.tab || 'news');

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
// ANNOUNCEMENTS: Redirect → Notifications (backward compat)
// ================================================================

router.get('/announcements/new', (req, res) => {
    res.redirect('/admin/content/notifications/new');
});

router.get('/announcements/edit/:id', (req, res) => {
    res.redirect('/admin/content/notifications/edit/' + req.params.id);
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

// ================================================================
// NEWS: Save (Create / Update)
// ================================================================

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

                const cleanExcerpt_de = stripHtmlForDiscord(excerpt_de || title_de || '');
                const cleanExcerpt_en = stripHtmlForDiscord(excerpt_en || title_en || '');

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
                Logger.info(`[Content] News-Aktionen für "${title_de}": ${newsActions.join(', ')}`);
            } catch (actionErr) {
                Logger.error('[Content] News-Aktion fehlgeschlagen:', actionErr);
                newsActions.push('⚠️ Aktion fehlgeschlagen');
            }
        }

        let message = newsId ? 'News erfolgreich aktualisiert' : 'News erfolgreich erstellt';
        if (newsActions.length > 0) {
            message += ' | ' + newsActions.join(' | ');
        }
        res.json({ success: true, message });
    } catch (error) {
        Logger.error('[Content] Fehler beim Speichern der News:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ================================================================
// NEWS: Delete
// ================================================================

router.post('/news/delete/:id', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    try {
        await dbService.query('DELETE FROM news WHERE _id = ?', [req.params.id]);
        res.json({ success: true, message: 'News erfolgreich gelöscht' });
    } catch (error) {
        Logger.error('[Content] Fehler beim Löschen der News:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ================================================================
// NOTIFICATIONS: Save (Create / Update)
// ================================================================

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
                    Logger.error('[Content] Fehler beim Senden der Notification an Bot:', ipcError);
                    return res.json({
                        success: false,
                        message: 'Notification gespeichert, aber Discord-Versand fehlgeschlagen: ' + ipcError.message
                    });
                }
            }
            return res.json({ success: true, message: 'Notification erfolgreich erstellt' });
        }
    } catch (error) {
        Logger.error('[Content] Fehler beim Speichern der Notification:', error);
        res.status(500).json({ success: false, message: 'Fehler beim Speichern: ' + error.message });
    }
});

// ================================================================
// NOTIFICATIONS: Delete
// ================================================================

router.post('/notifications/delete/:id', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    try {
        await dbService.query('DELETE FROM notifications WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Notification erfolgreich gelöscht' });
    } catch (error) {
        Logger.error('[Content] Fehler beim Löschen der Notification:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ================================================================
// NOTIFICATIONS: API Channel-Config laden (für notification-edit.ejs AJAX)
// ================================================================

router.get('/notifications/api/channel-config', async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    try {
        const rows = await dbService.query(
            "SELECT `key`, `value` FROM admin_settings WHERE `key` LIKE 'notification_channel_%'"
        );
        const config = {};
        for (const cat of CONTENT_CATEGORIES) {
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

// ================================================================
// CHANGELOGS: Save (Create / Update)
// ================================================================

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
                Logger.info(`[Content] Release-Aktion: News-Draft für v${version} erstellt`);
            } catch (newsErr) {
                Logger.error('[Content] Release-Aktion News-Draft fehlgeschlagen:', newsErr);
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
                const cleanDesc_de = stripHtmlForDiscord(description_de || `Version ${version} ist jetzt verfügbar.`);
                const cleanDesc_en = stripHtmlForDiscord(description_en || `Version ${version} is now available.`);

                const announcementTranslations = {
                    title: { 'de-DE': announcementTitle_de, 'en-GB': announcementTitle_en },
                    message: { 'de-DE': cleanDesc_de, 'en-GB': cleanDesc_en },
                    action_text: { 'de-DE': 'Changelog anzeigen', 'en-GB': 'View Changelog' }
                };

                const methods = [];
                if (wantDashboard) methods.push('dashboard');
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
                Logger.info(`[Content] Release-Aktionen für v${version}: ${actionParts.join(', ')}`);
            } catch (announcementErr) {
                Logger.error('[Content] Release-Aktion fehlgeschlagen:', announcementErr);
                releaseActions.push('⚠️ Ankündigung fehlgeschlagen');
            }
        }

        let toastMsg = changelogId ? 'Changelog erfolgreich aktualisiert' : 'Changelog erfolgreich erstellt';
        if (releaseActions.length > 0) {
            toastMsg += ' | ' + releaseActions.join(' | ');
        }

        req.session.toast = { type: 'success', message: toastMsg };
        res.redirect('/admin/content?tab=changelogs');

    } catch (error) {
        Logger.error('[Content] Fehler beim Speichern des Changelogs:', error);
        req.session.toast = { type: 'danger', message: 'Fehler beim Speichern: ' + error.message };
        res.redirect('/admin/content?tab=changelogs');
    }
});

// ================================================================
// CHANGELOGS: Delete
// ================================================================

router.post('/changelogs/delete/:id', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    try {
        await dbService.query('DELETE FROM changelogs WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Changelog erfolgreich gelöscht' });
    } catch (error) {
        Logger.error('[Content] Fehler beim Löschen des Changelogs:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
