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

/** Groesste Beschreibung, die Discord in einem Embed annimmt. */
const DISCORD_EMBED_MAX = 4096;

/**
 * Wandelt die HTML-Beschreibung in Discord-Markdown.
 *
 * Vorher wurden hier schlicht ALLE Tags entfernt (`.replace(/<[^>]+>/g, '')`).
 * Das kostete nicht nur die Auszeichnung — es zog auch Bloecke zusammen: Fuer
 * </p> und </li> kam kein Zeilenumbruch nach, also lief eine Liste aus fuenf
 * Punkten als ein einziger Satz durch. Genau so kamen die Ankuendigungen in
 * Discord an.
 *
 * Der Bot verschickt die Beschreibung in einem Embed (EmbedBuilder in
 * apps/bot/ipc/SEND_NOTIFICATION.js), und Embeds verstehen Markdown. Also wird
 * umgewandelt statt weggeworfen.
 *
 * @param {string} html
 * @returns {string} Discord-Markdown
 */
function htmlZuDiscordMarkdown(html) {
    if (!html || typeof html !== 'string') return '';

    // Umbrueche werden zunaechst nur VORGEMERKT.
    //
    // Der Grund: In HTML ist ein Zeilenumbruch im Quelltext bedeutungslos —
    // der Editor bricht lange Absaetze um, ohne dass das etwas heissen soll.
    // Ein echter Umbruch steht in <br> oder ergibt sich aus einem Block. Wer
    // beides gleich behandelt, zerreisst jeden umbrochenen Absatz.
    //
    // Also: echte Umbrueche als Platzhalter merken, danach den Quelltext-
    // Weissraum zusammenziehen, und erst zum Schluss die Platzhalter einsetzen.
    const ZEILE = '@@FB_ZEILE@@';
    const ABSATZ = '@@FB_ABSATZ@@';

    let text = html;
    text = text.replace(/<br\s*\/?>/gi, ZEILE);
    text = text.replace(/<\/(p|div)>/gi, ABSATZ);
    text = text.replace(/<li[^>]*>/gi, ZEILE + '- ').replace(/<\/li>/gi, '');
    text = text.replace(/<\/(ul|ol)>/gi, ABSATZ);

    // Ueberschriften: Discord kennt # bis ###
    text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, i) => `${ABSATZ}# ${i.trim()}${ABSATZ}`);
    text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, i) => `${ABSATZ}## ${i.trim()}${ABSATZ}`);
    text = text.replace(/<h[3-6][^>]*>([\s\S]*?)<\/h[3-6]>/gi, (_, i) => `${ABSATZ}### ${i.trim()}${ABSATZ}`);

    // Auszeichnung
    text = text.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, i) => `**${i.trim()}**`);
    text = text.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, i) => `*${i.trim()}*`);
    text = text.replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, (_, i) => `__${i.trim()}__`);
    text = text.replace(/<(s|del|strike)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, i) => `~~${i.trim()}~~`);
    text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, i) => `\`${i.trim()}\``);
    text = text.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, i) => `${ZEILE}> ${i.trim()}${ABSATZ}`);

    // Links: [Text](Adresse) — ohne Text bleibt die Adresse allein stehen
    text = text.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
        (_, url, beschriftung) => {
            const t = beschriftung.replace(/<[^>]+>/g, '').trim();
            return t ? `[${t}](${url})` : url;
        });

    // Was jetzt noch an Tags uebrig ist, traegt keine Bedeutung mehr
    text = text.replace(/<[^>]+>/g, '');

    // Entities aufloesen (unveraendert aus der frueheren Fassung)
    text = text
        .replace(/&auml;/g, 'ä').replace(/&ouml;/g, 'ö').replace(/&uuml;/g, 'ü')
        .replace(/&Auml;/g, 'Ä').replace(/&Ouml;/g, 'Ö').replace(/&Uuml;/g, 'Ü')
        .replace(/&szlig;/g, 'ß')
        .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&hellip;/g, '…')
        .replace(/&eacute;/g, 'é').replace(/&laquo;/g, '«').replace(/&raquo;/g, '»')
        .replace(/&bdquo;/g, '„').replace(/&ldquo;/g, '"').replace(/&rdquo;/g, '"')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

    // Weissraum aus dem Quelltext (auch die dort gesetzten Umbrueche) zu je
    // einem Leerzeichen zusammenziehen — er trug nie Bedeutung.
    text = text.replace(/\s+/g, ' ');

    // Jetzt die vorgemerkten Umbrueche einsetzen
    text = text.split(ABSATZ).map(t => t.trim()).filter(Boolean).join('\n\n');
    text = text.split(ZEILE).map(t => t.trim()).join('\n');

    // Aufraeumen: hoechstens eine Leerzeile, keine leeren Zeilen am Rand
    text = text.split('\n').map(z => z.replace(/[ \t]+$/, '')).join('\n');
    text = text.replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '').trim();

    return kuerzeFuerDiscord(text);
}

/**
 * Kuerzt auf die Laenge, die Discord in einem Embed annimmt.
 *
 * Eigene Funktion, weil sie auch auf zusammengesetzten Text angewandt werden
 * muss. Den fertigen Text ein zweites Mal durch htmlZuDiscordMarkdown zu
 * schicken waere falsch: Dort werden Umbrueche aus dem Quelltext zu
 * Leerzeichen zusammengezogen — sinnvoll bei HTML, aber es macht aus dem
 * bereits umgewandelten Markdown wieder einen einzigen Absatz.
 *
 * @param {string} text
 * @returns {string}
 */
function kuerzeFuerDiscord(text) {
    if (!text) return '';
    if (text.length <= DISCORD_EMBED_MAX) return text;

    // Zu lange Beschreibungen weist Discord ZURUECK — die Ankuendigung ginge
    // dann gar nicht raus. Lieber sichtbar gekuerzt als stillschweigend nicht
    // gesendet. Abgeschnitten wird an einem Zeilenende, damit kein halber
    // Eintrag stehen bleibt.
    const hinweis = '\n\n… (gekürzt — vollständig im Changelog)';
    let gekuerzt = text.slice(0, DISCORD_EMBED_MAX - hinweis.length);
    const letzterUmbruch = gekuerzt.lastIndexOf('\n');
    if (letzterUmbruch > DISCORD_EMBED_MAX / 2) {
        gekuerzt = gekuerzt.slice(0, letzterUmbruch);
    }
    return gekuerzt.trimEnd() + hinweis;
}

/** Zeichen fuer die vier Eintragsarten in Discord. */
const DISCORD_SYMBOLE = {
    fix:     '🐛',
    feature: '✨',
    change:  '🔧',
    removed: '🗑️'
};

/**
 * Rendert die Aenderungsliste eines Changelogs als Discord-Markdown.
 *
 * Bisher ging nur die BESCHREIBUNG nach Discord — die eigentliche Liste der
 * Aenderungen blieb im Dashboard. Wer die Ankuendigung las, sah einen
 * Einleitungstext und sonst nichts, obwohl der Changelog selbst nach Gruppen,
 * Untergruppen und Art der Aenderung gegliedert ist.
 *
 * Die Gliederung wird eine Ebene nach unten gereicht: Aus `#` wird `##`, aus
 * `##` wird `###`. Die oberste Ebene bleibt dem Titel der Ankuendigung.
 *
 * @param {string} changesText - Reintext im Changelog-Format
 * @returns {string} Discord-Markdown, leer wenn nichts zu zeigen ist
 */
function changelogZuDiscordMarkdown(changesText) {
    if (!changesText) return '';

    let baum;
    try {
        baum = ChangelogHelper.parseHierarchicalChangelog(String(changesText));
    } catch (_) {
        return '';
    }
    if (!Array.isArray(baum) || baum.length === 0) return '';

    const zeilen = [];
    for (const gruppe of baum) {
        if (gruppe.title) zeilen.push(`## ${gruppe.title}`);

        for (const untergruppe of gruppe.children || []) {
            // "Allgemein" ist erfunden, wenn Eintraege direkt unter einer
            // Gruppe stehen — die Ueberschrift hat niemand geschrieben.
            if (untergruppe.title && !untergruppe.synthetic) {
                zeilen.push(`### ${untergruppe.title}`);
            }
            if (untergruppe.description) {
                zeilen.push(untergruppe.description.replace(/<br\s*\/?>/gi, '\n'));
            }

            for (const eintrag of untergruppe.items || []) {
                const symbol = DISCORD_SYMBOLE[eintrag.type] || '•';
                // Der Text darf HTML enthalten (der Parser laesst es stehen)
                const text = htmlZuDiscordMarkdown(eintrag.text || '');
                if (text) zeilen.push(`${symbol} ${text}`);
            }
        }
    }

    return zeilen.join('\n').replace(/\n{3,}/g, '\n\n').trim();
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

    // Blog Posts
    const rawBlogPosts = await dbService.query('SELECT * FROM blog_posts ORDER BY published_at DESC, created_at DESC');
    const blogPosts = rawBlogPosts.map(p => {
        const titles = typeof p.title_translations === 'string' ? JSON.parse(p.title_translations) : (p.title_translations || {});
        const excerpts = typeof p.excerpt_translations === 'string' ? JSON.parse(p.excerpt_translations) : (p.excerpt_translations || {});
        return {
            ...p,
            title: titles[userLocale] || titles['de-DE'] || '',
            excerpt: excerpts[userLocale] || excerpts['de-DE'] || '',
            formattedDate: p.published_at
                ? new Date(p.published_at).toLocaleString(userLocale, { year: 'numeric', month: 'long', day: 'numeric' })
                : '—'
        };
    });

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

    return { newsList, blogPosts, changelogsList, notifications, channelConfig };
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

        // Analyse & Cookies: Einstellungen und Umfang des Nachweises.
        const AnalyticsConsent = require('../../helpers/AnalyticsConsent');
        const analytics = await AnalyticsConsent.ladeEinstellungen(dbService);

        let consentAnzahl = 0, consentLetzter = null;
        try {
            const [nachweis] = await dbService.query(
                'SELECT COUNT(*) AS anzahl, MAX(erteilt_am) AS letzter FROM consent_log'
            );
            consentAnzahl  = nachweis?.anzahl || 0;
            consentLetzter = nachweis?.letzter || null;
        } catch (_) {
            // Tabelle gibt es erst nach der Migration - kein Grund, den Hub zu verweigern.
        }

        await themeManager.renderView(res, 'admin/content', {
            title: 'Content Management',
            activeMenu: '/admin/content',
            activeTab,
            currentLocale: userLocale,
            newsList: data.newsList,
            blogPosts: data.blogPosts,
            changelogsList: data.changelogsList,
            notifications: data.notifications,
            channelConfig: data.channelConfig,
            categories: CONTENT_CATEGORIES,
            controlGuildId: process.env.CONTROL_GUILD_ID || '',
            analytics,
            consentAnzahl,
            consentLetzter
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
// ANALYSE & COOKIES: Einstellungen speichern
// ================================================================

router.post('/analytics/save', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const AnalyticsConsent = require('../../helpers/AnalyticsConsent');

    try {
        const { gtmId, aktiv, version, kategorien } = req.body;
        const id = String(gtmId || '').trim();

        // Eine falsche ID erzeugt keinen Fehler - es passiert einfach nichts.
        // Deshalb wird sie hier geprueft und nicht erst im Browser des Besuchers.
        if (id && !AnalyticsConsent.istGtmId(id)) {
            return res.status(400).json({
                success: false,
                message: 'Das sieht nicht nach einer GTM-Container-ID aus (erwartet: GTM-XXXXXXX).'
            });
        }

        // Ohne ID kann nichts aktiv sein - sonst stuende im Adminbereich "aktiv",
        // waehrend auf der Seite nichts passiert.
        const wirklichAktiv = Boolean(aktiv) && Boolean(id);

        await AnalyticsConsent.speichereEinstellungen(dbService, {
            gtmId: id,
            aktiv: wirklichAktiv,
            version,
            kategorien
        });

        Logger.info(`[Content] Analyse-Einstellungen gespeichert (GTM: ${id || 'keine'}, aktiv: ${wirklichAktiv}, Fassung: ${Number(version) || 1})`);

        return res.json({
            success: true,
            message: aktiv && !id
                ? 'Gespeichert – ohne Container-ID bleibt die Einbindung allerdings aus.'
                : 'Gespeichert.'
        });
    } catch (error) {
        Logger.error('[Content] Fehler beim Speichern der Analyse-Einstellungen:', error);
        return res.status(500).json({ success: false, message: error.message });
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
                // Die oeffentliche Route heisst /news-details/:slug, nicht
                // /news/:slug. Der Knopf unter jeder Discord-Ankuendigung
                // fuehrte deshalb auf eine Seite, die es nicht gibt.
                const newsUrl = `${baseUrl}/news-details/${slug || ''}`;

                const cleanExcerpt_de = htmlZuDiscordMarkdown(excerpt_de || title_de || '');
                const cleanExcerpt_en = htmlZuDiscordMarkdown(excerpt_en || title_en || '');

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

/**
 * POST /admin/content/changelogs/preview
 *
 * Zerlegt einen Änderungstext mit **demselben** Parser, den auch die öffentliche
 * Seite benutzt, und gibt die Struktur zurück.
 *
 * Vorher hatte die Vorschau eine eigene Kopie des Parsers im Browser. Zwei
 * Kopien driften auseinander: Die Kopie kannte die Schreibweise `!: Text` nicht,
 * zeigte deshalb weniger an als die Website – und wer das sah, hielt seinen Text
 * für fehlerhaft, obwohl er es nicht war.
 *
 * Reines Lesen: nimmt Text entgegen, gibt Struktur zurück, speichert nichts.
 */
router.post('/changelogs/preview', async (req, res) => {
    const Logger = ServiceManager.get('Logger');

    try {
        const { changes_de = '', changes_en = '' } = req.body || {};

        return res.json({
            success: true,
            de: ChangelogHelper.parseHierarchicalChangelog(String(changes_de)),
            en: ChangelogHelper.parseHierarchicalChangelog(String(changes_en)),
        });

    } catch (error) {
        Logger.error('[Changelog] Vorschau fehlgeschlagen:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
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
                // Beschreibung UND Aenderungsliste. Bis hierher ging nur die
                // Beschreibung raus — die Ankuendigung nannte also, dass es ein
                // Update gibt, aber nicht, was darin steht.
                //
                // Passt nicht alles in ein Embed, kuerzt htmlZuDiscordMarkdown
                // am Ende sichtbar und verweist auf den Changelog; der Knopf
                // darunter fuehrt ohnehin dorthin.
                const mitAenderungen = (beschreibung, aenderungen) => {
                    const teile = [beschreibung, changelogZuDiscordMarkdown(aenderungen)]
                        .map(t => (t || '').trim())
                        .filter(Boolean);
                    // NUR kuerzen — beide Teile sind bereits umgewandelt.
                    return kuerzeFuerDiscord(teile.join('\n\n'));
                };

                const cleanDesc_de = mitAenderungen(
                    htmlZuDiscordMarkdown(description_de || `Version ${version} ist jetzt verfügbar.`),
                    changes_de
                );
                const cleanDesc_en = mitAenderungen(
                    htmlZuDiscordMarkdown(description_en || `Version ${version} is now available.`),
                    changes_en
                );

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

        // Der haeufigste Fall verdient eine Meldung, mit der man etwas anfangen
        // kann. "Duplicate entry 'v2-2-5' for key 'idx_slug'" sagt einem Menschen
        // nicht, WAS er aendern soll — und die Ursache ist meist gar nicht die
        // Version, sondern ein Slug, der nicht zu ihr passt. Genau so ist es
        // beim Eintrag 2.2.4 passiert: Er trug den Slug v2-2-5 und blockierte
        // damit den naechsten Changelog.
        let meldung = 'Fehler beim Speichern: ' + error.message;
        if (error?.code === 'ER_DUP_ENTRY') {
            const kurzname = slug || `v${(version || '').replace(/\./g, '-')}`;
            meldung = `Es gibt bereits einen Changelog mit dem Kurznamen „${kurzname}". `
                    + 'Vergib im Reiter „Einstellungen" einen anderen Kurznamen — '
                    + 'oder pruefe, ob dieser Changelog schon angelegt wurde.';
        }

        req.session.toast = { type: 'danger', message: meldung };
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

// ================================================================
// BLOG: Create / Edit Views
// ================================================================

router.get('/blog/new', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    await themeManager.renderView(res, 'admin/blog-edit', {
        title: 'Neuen Blog-Post erstellen',
        activeMenu: '/admin/content',
        backUrl: '/admin/content?tab=blog',
        post: null
    });
});

router.get('/blog/edit/:id', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    const dbService = ServiceManager.get('dbService');

    const [post] = await dbService.query('SELECT * FROM blog_posts WHERE id = ?', [req.params.id]);
    if (!post) {
        return res.status(404).render('error', { message: 'Blog-Post nicht gefunden', error: { status: 404 } });
    }

    const titles = typeof post.title_translations === 'string' ? JSON.parse(post.title_translations) : (post.title_translations || {});
    const contents = typeof post.content_translations === 'string' ? JSON.parse(post.content_translations) : (post.content_translations || {});
    const excerpts = typeof post.excerpt_translations === 'string' ? JSON.parse(post.excerpt_translations) : (post.excerpt_translations || {});

    post.title_de = titles['de-DE'] || '';
    post.title_en = titles['en-GB'] || '';
    post.content_de = contents['de-DE'] || '';
    post.content_en = contents['en-GB'] || '';
    post.excerpt_de = excerpts['de-DE'] || '';
    post.excerpt_en = excerpts['en-GB'] || '';

    await themeManager.renderView(res, 'admin/blog-edit', {
        title: 'Blog-Post bearbeiten',
        activeMenu: '/admin/content',
        backUrl: '/admin/content?tab=blog',
        post
    });
});

// ================================================================
// BLOG: Save (Create / Update)
// ================================================================

router.post('/blog/save', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const { postId, title_de, title_en, excerpt_de, excerpt_en,
            content_de, content_en, slug, author, image_url, category, tags, status, published_at } = req.body;

    try {
        const titleTranslations = JSON.stringify({ 'de-DE': title_de || '', 'en-GB': title_en || '' });
        const contentTranslations = JSON.stringify({ 'de-DE': content_de || '', 'en-GB': content_en || '' });
        const excerptTranslations = JSON.stringify({ 'de-DE': excerpt_de || '', 'en-GB': excerpt_en || '' });

        // Slug auto-generieren falls leer
        const finalSlug = slug || (title_de || 'post').toLowerCase()
            .replace(/[äÄ]/g, 'ae').replace(/[öÖ]/g, 'oe').replace(/[üÜ]/g, 'ue').replace(/ß/g, 'ss')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

        if (postId) {
            await dbService.query(`
                UPDATE blog_posts SET title_translations=?, content_translations=?, excerpt_translations=?,
                slug=?, author=?, image_url=?, category=?, tags=?, status=?, published_at=?, updated_at=NOW()
                WHERE id=?
            `, [titleTranslations, contentTranslations, excerptTranslations,
                finalSlug, author || 'Admin', image_url || null, category || 'gaming',
                tags || null, status || 'draft', published_at || null, postId]);
        } else {
            await dbService.query(`
                INSERT INTO blog_posts (title_translations, content_translations, excerpt_translations,
                slug, author, image_url, category, tags, status, published_at, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,NOW(),NOW())
            `, [titleTranslations, contentTranslations, excerptTranslations,
                finalSlug, author || 'Admin', image_url || null, category || 'gaming',
                tags || null, status || 'draft', published_at || null]);
        }

        res.json({ success: true, message: postId ? 'Blog-Post aktualisiert' : 'Blog-Post erstellt' });
    } catch (error) {
        Logger.error('[Content] Fehler beim Speichern des Blog-Posts:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ================================================================
// BLOG: Delete
// ================================================================

router.post('/blog/delete/:id', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    try {
        await dbService.query('DELETE FROM blog_posts WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Blog-Post erfolgreich gelöscht' });
    } catch (error) {
        Logger.error('[Content] Fehler beim Löschen des Blog-Posts:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
