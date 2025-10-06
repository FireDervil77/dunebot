/**
 * SuperAdmin Dashboard Plugin - Hybrid (Routes + Widgets)
 * Navigation + vollständige Routen + Dashboard-Widgets
 * 
 * @author FireDervil
 */

const path = require('path');
const express = require('express');
const fs = require('fs');

const { DashboardPlugin } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');
const { getLocalizedNews, getLocalizedNewsList, prepareNewsForDB } = require('../../../apps/dashboard/helpers/newsHelper');

class SuperAdminDashboardPlugin extends DashboardPlugin {
    constructor(app) {
        super({
            name: 'superadmin',
            displayName: 'SuperAdmin Panel',
            description: 'Globale Verwaltung - Nur für Bot-Owner',
            version: '1.0.0',
            author: 'DuneBot Team',
            icon: 'fa-solid fa-shield-halved',
            baseDir: __dirname,
            requiresOwner: true
        });
        
        this.app = app;

        // WICHTIG: _getGlobalStats ist async und wird bei Bedarf aufgerufen (nicht hier!)
        // this._getGlobalStats(); ❌ Würde Promise zurückgeben ohne await
     
        this.guildRouter = express.Router();
    }

    /**
     * Globale Statistiken sammeln
     */
    async _getGlobalStats(dbService) {
        const Logger = ServiceManager.get('Logger');
        const stats = {};

        // Anzahl Guilds
        const guilds = await dbService.query('SELECT COUNT(*) as count FROM guilds');
        stats.guilds = guilds[0]?.count || 0;

        // Anzahl User
        const users = await dbService.query('SELECT COUNT(*) as count FROM users');
        stats.users = users[0]?.count || 0;

        // Anzahl News
        const news = await dbService.query('SELECT COUNT(*) as count FROM news');
        stats.news = news[0]?.count || 0;

        // Anzahl Notifications
        const notifications = await dbService.query('SELECT COUNT(*) as count FROM notifications');
        stats.notifications = notifications[0]?.count || 0;

        // Top Guilds nach created_at
        try {
            stats.topGuilds = await dbService.query(`
                SELECT _id, guild_name, guild_id, created_at
                FROM guilds 
                ORDER BY created_at DESC
                LIMIT 10
            `);
        } catch (err) {
            stats.topGuilds = [];
        }

        // Recent News
        try {
            stats.recentNews = await dbService.query(`
                SELECT _id, title, author, status, date, created_at
                FROM news 
                ORDER BY date DESC
                LIMIT 10
            `);
        } catch (err) {
            stats.recentNews = [];
        }

        // Plugin Statistiken
        try {
            const pluginConfigs = await dbService.query(`
                SELECT guild_id, config_value 
                FROM configs 
                WHERE config_key = 'ENABLED_PLUGINS' AND context = 'shared' AND plugin_name = 'core'
            `);
            
            const pluginCounts = {};
            let totalGuildsWithPlugins = 0;
            
            pluginConfigs.forEach(row => {
                try {
                    const enabledPlugins = typeof row.config_value === 'string' 
                        ? JSON.parse(row.config_value) 
                        : row.config_value;
                    
                    if (Array.isArray(enabledPlugins) && enabledPlugins.length > 0) {
                        totalGuildsWithPlugins++;
                        enabledPlugins.forEach(pluginName => {
                            pluginCounts[pluginName] = (pluginCounts[pluginName] || 0) + 1;
                        });
                    }
                } catch (err) {
                    // Ignoriere fehlerhafte JSON-Einträge
                }
            });
            
            stats.pluginStats = Object.entries(pluginCounts)
                .map(([name, count]) => ({
                    name,
                    count,
                    percentage: totalGuildsWithPlugins > 0 
                        ? Math.round((count / totalGuildsWithPlugins) * 100) 
                        : 0
                }))
                .sort((a, b) => b.count - a.count);
            
        } catch (err) {
            Logger.error('[SuperAdmin] Fehler beim Laden der Plugin-Statistiken:', err);
            stats.pluginStats = [];
        }

        return stats;
    }

    /**
     * Plugin aktivieren (Global für Dashboard)
     */
    async onEnable() {
        const Logger = ServiceManager.get('Logger');
        Logger.info('[SuperAdmin] Aktiviere Dashboard-Plugin global...');

        this._setupRoutes();
        
        Logger.success('[SuperAdmin] Dashboard-Plugin global aktiviert (Routen registriert)');
        return true;
    }


    /**
     * Vollständige Routen für SuperAdmin einrichten
     */
    _setupRoutes() {
        const Logger = ServiceManager.get('Logger');
        const themeManager = ServiceManager.get('themeManager');

        try {
            Logger.debug('[SuperAdmin] Starte Route-Setup für guildRouter...');
            
            // Middleware: Owner-Check für ALLE SuperAdmin-Routen
            this.guildRouter.use(this._checkOwner.bind(this));

            // === HAUPTSEITE (Dashboard-Übersicht) ===
            this.guildRouter.get('/', async (req, res) => {
                const guildId = res.locals.guildId;
                const dbService = ServiceManager.get('dbService');

                const stats = await this._getGlobalStats(dbService);

                // WICHTIG: Eigene SuperAdmin-View rendern, NICHT guild/dashboard!
                // guild/dashboard würde alle Widget-Filter aufrufen
                await themeManager.renderView(res, 'guild/superadmin-dashboard', {
                    title: 'SuperAdmin Dashboard',
                    activeMenu: `/guild/${guildId}/plugins/superadmin`,
                    guildId,
                    stats,
                    plugin: this
                });
            });

            // === NEWS VERWALTUNG ===
            // WICHTIG: Spezifische Routes ZUERST, dann allgemeine!
            
            // News erstellen (GET)
            this.guildRouter.get('/news/new', async (req, res) => {
                const guildId = res.locals.guildId;
                
                await themeManager.renderView(res, 'guild/news-edit', {
                    title: 'Neue News erstellen',
                    activeMenu: `/guild/${guildId}/plugins/superadmin/news`,
                    guildId,
                    news: null, // Neuer Eintrag
                    plugin: this
                });
            });

            // News bearbeiten (GET)
            this.guildRouter.get('/news/edit/:id', async (req, res) => {
                const guildId = res.locals.guildId;
                const dbService = ServiceManager.get('dbService');
                const userLocale = req.session.locale || res.locals.locale || 'de-DE';

                const rawNews = await dbService.query(`
                    SELECT * FROM news WHERE _id = ?
                `, [req.params.id]);

                if (!rawNews || rawNews.length === 0) {
                    return res.status(404).render('error', {
                        message: 'News-Eintrag nicht gefunden',
                        error: { status: 404 }
                    });
                }

                // News mit allen Übersetzungen für das Edit-Formular bereitstellen
                const news = rawNews[0];
                
                // Parse JSON-Felder für das Formular
                news.title_de = JSON.parse(news.title_translations)['de-DE'] || '';
                news.title_en = JSON.parse(news.title_translations)['en-GB'] || '';
                news.content_de = JSON.parse(news.content_translations)['de-DE'] || '';
                news.content_en = JSON.parse(news.content_translations)['en-GB'] || '';
                news.excerpt_de = JSON.parse(news.excerpt_translations)['de-DE'] || '';
                news.excerpt_en = JSON.parse(news.excerpt_translations)['en-GB'] || '';

                await themeManager.renderView(res, 'guild/news-edit', {
                    title: 'News bearbeiten',
                    activeMenu: `/guild/${guildId}/plugins/superadmin/news`,
                    guildId,
                    news,
                    plugin: this
                });
            });

            // News-Liste anzeigen (GET)
            this.guildRouter.get('/news', async (req, res) => {
                const guildId = res.locals.guildId;
                const dbService = ServiceManager.get('dbService');
                const userLocale = req.session.locale || res.locals.locale || 'de-DE';

                const rawNewsList = await dbService.query(`
                    SELECT * FROM news 
                    ORDER BY date DESC
                `);

                // News lokalisieren für die Liste
                const newsList = getLocalizedNewsList(rawNewsList, userLocale).map(news => ({
                    ...news,
                    formattedDate: new Date(news.date).toLocaleString(userLocale, {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    })
                }));

                await themeManager.renderView(res, 'guild/news', {
                    title: 'News Verwaltung',
                    activeMenu: `/guild/${guildId}/plugins/superadmin/news`,
                    guildId,
                    newsList,
                    plugin: this
                });
            });

            // News speichern (POST)
            // News speichern (POST) - Multi-Language Support
            this.guildRouter.post('/news/save', async (req, res) => {
                const dbService = ServiceManager.get('dbService');
                const Logger = ServiceManager.get('Logger');
                const {
                    newsId,
                    title_de, title_en,
                    excerpt_de, excerpt_en,
                    content_de, content_en,
                    slug, author, image_url, status, date
                } = req.body;

                try {
                    // Übersetzungen als JSON vorbereiten
                    const translations = {
                        title: {
                            'de-DE': title_de || '',
                            'en-GB': title_en || ''
                        },
                        content: {
                            'de-DE': content_de || '',
                            'en-GB': content_en || ''
                        },
                        excerpt: {
                            'de-DE': excerpt_de || '',
                            'en-GB': excerpt_en || ''
                        }
                    };

                    // Metadata
                    const metadata = {
                        slug,
                        author,
                        image_url,
                        status,
                        date
                    };

                    // prepareNewsForDB nutzen
                    const newsData = prepareNewsForDB(translations, metadata);

                    if (newsId) {
                        // Update existierender News-Eintrag
                        await dbService.query(`
                            UPDATE news 
                            SET title_translations = ?,
                                content_translations = ?,
                                excerpt_translations = ?,
                                slug = ?, author = ?, image_url = ?, 
                                status = ?, date = ?, updated_at = NOW()
                            WHERE _id = ?
                        `, [
                            newsData.title_translations,
                            newsData.content_translations,
                            newsData.excerpt_translations,
                            newsData.slug,
                            newsData.author,
                            newsData.image_url,
                            newsData.status,
                            newsData.date,
                            newsId
                        ]);
                        res.json({ success: true, message: 'News erfolgreich aktualisiert' });
                    } else {
                        // Neuer News-Eintrag
                        await dbService.query(`
                            INSERT INTO news 
                            (title_translations, content_translations, excerpt_translations,
                             slug, author, image_url, status, date, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
                        `, [
                            newsData.title_translations,
                            newsData.content_translations,
                            newsData.excerpt_translations,
                            newsData.slug,
                            newsData.author,
                            newsData.image_url,
                            newsData.status,
                            newsData.date
                        ]);
                        res.json({ success: true, message: 'News erfolgreich erstellt' });
                    }
                } catch (error) {
                    Logger.error('Fehler beim Speichern der News:', error);
                    res.status(500).json({ success: false, message: error.message });
                }
            });

            this.guildRouter.post('/news/delete/:id', async (req, res) => {
                const dbService = ServiceManager.get('dbService');
                try {
                    await dbService.query(`DELETE FROM news WHERE _id = ?`, [req.params.id]);
                    res.json({ success: true, message: 'News erfolgreich gelöscht' });
                } catch (error) {
                    Logger.error('Fehler beim Löschen der News:', error);
                    res.status(500).json({ success: false, message: error.message });
                }
            });

            // === NOTIFICATIONS ===
            this.guildRouter.get('/notifications', async (req, res) => {
                const guildId = res.locals.guildId;
                const dbService = ServiceManager.get('dbService');

                try {
                    Logger.debug('[SuperAdmin] /notifications Route aufgerufen');
                    
                    const guilds = await dbService.query(`SELECT _id as id, guild_name as name FROM guilds ORDER BY guild_name`);
                    
                    // Lade letzte 10 Notifications (ohne guild_id - ist global)
                    const recentNotifications = await dbService.query(`
                        SELECT * 
                        FROM notifications
                        ORDER BY created_at DESC
                        LIMIT 10
                    `);
                    
                    Logger.debug(`[SuperAdmin] ${guilds.length} Guilds, ${recentNotifications.length} Notifications geladen`);

                    await themeManager.renderView(res, 'guild/notifications', {
                        title: 'Globale Notifications',
                        activeMenu: `/guild/${guildId}/plugins/superadmin/notifications`,
                        guildId,
                        guilds,
                        recentNotifications,
                        plugin: this
                    });
                } catch (error) {
                    Logger.error('[SuperAdmin] Fehler bei /notifications:', error);
                    res.status(500).render('error', { message: 'Fehler beim Laden der Notifications', error });
                }
            });

            this.guildRouter.post('/notifications/send', async (req, res) => {
                const dbService = ServiceManager.get('dbService');
                const { title, message, type, action_url, action_text, expiry } = req.body;

                try {
                    // Notification ist GLOBAL für alle User
                    // Kein guild_id nötig, da die Tabelle keine guild_id Spalte hat
                    await dbService.query(`
                        INSERT INTO notifications 
                        (title, message, type, action_url, action_text, expiry, created_at, dismissed)
                        VALUES (?, ?, ?, ?, ?, ?, NOW(), 0)
                    `, [title, message, type || 'info', action_url || null, action_text || null, expiry || null]);

                    res.json({ success: true, message: 'Globale Notification erfolgreich erstellt' });
                } catch (error) {
                    Logger.error('Fehler beim Senden der Notification:', error);
                    res.status(500).json({ success: false, message: error.message });
                }
            });

            // === STATISTIKEN ===
            this.guildRouter.get('/stats', async (req, res) => {
                const guildId = res.locals.guildId;
                const dbService = ServiceManager.get('dbService');

                try {
                    Logger.debug('[SuperAdmin] /stats Route aufgerufen');
                    
                    const stats = await this._getGlobalStats(dbService);
                    
                    Logger.debug('[SuperAdmin] Stats geladen:', Object.keys(stats));

                    // View erwartet topGuilds, recentNews und pluginStats direkt
                    await themeManager.renderView(res, 'guild/stats', {
                        title: 'System Statistiken',
                        activeMenu: `/guild/${guildId}/plugins/superadmin/stats`,
                        guildId,
                        stats,
                        topGuilds: stats.topGuilds || [],
                        recentNews: stats.recentNews || [],
                        pluginStats: stats.pluginStats || [],
                        plugin: this
                    });
                } catch (error) {
                    Logger.error('[SuperAdmin] Fehler bei /stats:', error);
                    res.status(500).render('error', { message: 'Fehler beim Laden der Statistiken', error });
                }
            });

            Logger.info('[SuperAdmin] Routen eingerichtet für guildRouter');
            Logger.info(`[SuperAdmin] guildRouter enthält ${this.guildRouter.stack?.length || 0} routes/middleware`);
        } catch (error) {
            Logger.error('Fehler beim Einrichten der SuperAdmin Plugin Routen:', error);
            throw error;
        }
    }

    /**
     * Dashboard-Widgets registrieren
     */
    _registerWidgets() {
        const Logger = ServiceManager.get('Logger');
        const pluginManager = ServiceManager.get('pluginManager');
        const themeManager = ServiceManager.get('themeManager');

        // Priorität 20 = Nach Core-Plugin (Priorität 10)
        pluginManager.hooks.addFilter('guild_dashboard_widgets', async (widgets, options) => {
            const { guildId, guild, user } = options;

            // WICHTIG: Prüfe Control-Guild UND Owner-Status
            const controlGuildId = process.env.CONTROL_GUILD_ID;
            
            // Wenn nicht Control-Guild ODER nicht Owner: Core-Widgets unverändert zurückgeben
            if (String(guildId) !== String(controlGuildId)) {
                Logger.debug(`[SuperAdmin] Guild ${guildId} ist nicht die Control-Guild, keine SuperAdmin-Widgets`);
                return widgets;
            }

            if (!await this._isOwner(user, guildId)) {
                Logger.debug(`[SuperAdmin] User ist kein Owner, keine SuperAdmin-Widgets`);
                return widgets;
            }

            const dbService = ServiceManager.get('dbService');
            
            Logger.debug(`[SuperAdmin] Füge SuperAdmin-Widgets zu den ${widgets.length} bestehenden Core-Widgets hinzu`);

            // Widget 1: Globale Statistiken
            widgets.push({
                id: 'superadmin-stats',
                title: 'System Stats',
                size: 4,
                icon: 'fa-solid fa-chart-line',
                cardClass: 'card-primary',
                content: await themeManager.renderWidgetPartial('superadmin-stats', {
                    stats: await this._getGlobalStats(dbService),
                    guildId
                })
            });

            // Widget 2: News Verwaltung
            const newsList = await dbService.query(`
                SELECT _id, title, slug, status, date
                FROM news 
                ORDER BY date DESC
                LIMIT 5
            `);

            widgets.push({
                id: 'superadmin-news',
                title: 'News verwalten',
                size: 4,
                icon: 'fa-solid fa-newspaper',
                cardClass: 'card-info',
                actions: [
                    {
                        id: 'create-news',
                        icon: 'fas fa-plus',
                        attributes: {
                            'data-bs-toggle': 'modal',
                            'data-bs-target': '#newsModal'
                        }
                    }
                ],
                content: await themeManager.renderWidgetPartial('superadmin-news', {
                    newsList,
                    guildId
                })
            });

            // Widget 3: Notifications senden
            const guilds = await dbService.query(`
                SELECT _id as id, guild_name as name 
                FROM guilds 
                ORDER BY guild_name
            `);

            widgets.push({
                id: 'superadmin-notifications',
                title: 'Notifications senden',
                size: 4,
                icon: 'fa-solid fa-bell',
                cardClass: 'card-warning',
                content: await themeManager.renderWidgetPartial('superadmin-notifications', {
                    guilds,
                    guildId
                })
            });

            Logger.debug(`[SuperAdmin] Insgesamt ${widgets.length} Widgets (Core + SuperAdmin) zurückgegeben`);
            return widgets;
        }, 20); // Priorität 20 = Nach Core (10)

        Logger.debug('SuperAdmin Widgets registriert mit Priorität 20');
    }

    /**
     * Prüft ob User der Bot-Owner ist UND in der Control-Guild
     */
    async _isOwner(user, guildId) {
        const config = this._loadConfig();
        const ownerId = config.BOT_OWNER_ID;
        const controlGuildId = process.env.CONTROL_GUILD_ID;

        // Beide Bedingungen müssen erfüllt sein!
        const isOwner = user && String(user.info?.id) === String(ownerId);
        const isControlGuild = String(guildId) === String(controlGuildId);

        return isOwner && isControlGuild;
    }

    /**
     * Middleware: Owner-Check
     */
    async _checkOwner(req, res, next) {
        const user = res.locals.user || req.session?.user;
        const guildId = res.locals.guildId || req.params.guildId;

        if (!await this._isOwner(user, guildId)) {
            return res.status(403).json({ 
                success: false, 
                error: 'Nur für Bot-Owner!' 
            });
        }

        next();
    }

    /**
     * Config laden
     */
    _loadConfig() {
        const configPath = path.join(__dirname, '..', 'config.json');
        
        if (fs.existsSync(configPath)) {
            try {
                return JSON.parse(fs.readFileSync(configPath, 'utf8'));
            } catch (error) {
                return {};
            }
        }
        
        return {};
    }

    /**
     * Globale Statistiken laden
     */
    async _getGlobalStats(dbService) {
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

        // Top Guilds nach created_at
        try {
            stats.topGuilds = await dbService.query(`
                SELECT _id, guild_name, guild_id, created_at
                FROM guilds 
                ORDER BY created_at DESC
                LIMIT 10
            `);
        } catch (err) {
            stats.topGuilds = [];
        }

        // Recent News
        try {
            stats.recentNews = await dbService.query(`
                SELECT _id, title, author, status, date, created_at
                FROM news 
                ORDER BY date DESC
                LIMIT 10
            `);
        } catch (err) {
            stats.recentNews = [];
        }

        // Plugin Statistiken
        try {
            // Hole alle ENABLED_PLUGINS aus configs
            const pluginConfigs = await dbService.query(`
                SELECT guild_id, config_value 
                FROM configs 
                WHERE config_key = 'ENABLED_PLUGINS'
            `);
            
            // Zähle Plugin-Aktivierungen
            const pluginCounts = {};
            let totalGuildsWithPlugins = 0;
            
            pluginConfigs.forEach(row => {
                try {
                    const enabledPlugins = typeof row.config_value === 'string' 
                        ? JSON.parse(row.config_value) 
                        : row.config_value;
                    
                    if (Array.isArray(enabledPlugins) && enabledPlugins.length > 0) {
                        totalGuildsWithPlugins++;
                        enabledPlugins.forEach(pluginName => {
                            pluginCounts[pluginName] = (pluginCounts[pluginName] || 0) + 1;
                        });
                    }
                } catch (err) {
                    // Ignoriere fehlerhafte JSON-Einträge
                }
            });
            
            // Konvertiere zu Array mit Prozentsatz
            stats.pluginStats = Object.entries(pluginCounts)
                .map(([name, count]) => ({
                    name,
                    count,
                    percentage: totalGuildsWithPlugins > 0 
                        ? Math.round((count / totalGuildsWithPlugins) * 100) 
                        : 0
                }))
                .sort((a, b) => b.count - a.count); // Sortiere nach Anzahl absteigend
            
        } catch (err) {
            Logger.error('[SuperAdmin] Fehler beim Laden der Plugin-Statistiken:', err);
            stats.pluginStats = [];
        }

        return stats;
    }

    /**
     * Guild-spezifische Aktivierung
     * SuperAdmin sollte NUR für die CONTROL_GUILD aktiviert werden!
     */
    async onGuildEnable(guildId) {
        const Logger = ServiceManager.get('Logger');
        const navigationManager = ServiceManager.get('navigationManager');
        const controlGuildId = process.env.CONTROL_GUILD_ID;
        
        // Prüfe ob es die Control-Guild ist
        if (String(guildId) !== String(controlGuildId)) {
            Logger.debug(`[SuperAdmin] Guild ${guildId} ist nicht Control-Guild (${controlGuildId}) - überspringe SuperAdmin-Aktivierung`);
            return; // Silent return statt Error
        }
        
        Logger.debug(`[SuperAdmin] Registriere Navigation für Control-Guild ${guildId}`);
        
        // Navigation registrieren
        const navItems = [
            {
                title: 'SuperAdmin',
                path: `/guild/${guildId}/plugins/superadmin`,
                icon: 'fa-solid fa-shield-halved',
                order: 90,  // Ganz am Ende der Navigation (nach Core: 10-40)
                type: 'main',
                visible: true
            },
            {
                title: 'News',
                path: `/guild/${guildId}/plugins/superadmin/news`,
                icon: 'fa-solid fa-newspaper',
                order: 91,  // Untermenü-Reihenfolge
                parent: `/guild/${guildId}/plugins/superadmin`,
                type: 'main',
                visible: true
            },
            {
                title: 'Notifications',
                path: `/guild/${guildId}/plugins/superadmin/notifications`,
                icon: 'fa-solid fa-bell',
                order: 92,  // Untermenü-Reihenfolge
                parent: `/guild/${guildId}/plugins/superadmin`,
                type: 'main',
                visible: true
            },
            {
                title: 'Statistiken',
                path: `/guild/${guildId}/plugins/superadmin/stats`,
                icon: 'fa-solid fa-chart-line',
                order: 93,  // Untermenü-Reihenfolge
                parent: `/guild/${guildId}/plugins/superadmin`,
                type: 'main',
                visible: true
            },
            {
                title: 'Übersetzungen',
                path: `/guild/${guildId}/locales`,
                icon: 'fa-solid fa-language',
                order: 94,  // Untermenü-Reihenfolge
                parent: `/guild/${guildId}/plugins/superadmin`,
                type: 'main',
                visible: true
            }
        ];

        await navigationManager.registerNavigation(this.name, guildId, navItems);
        Logger.debug(`[SuperAdmin] Navigation + Routen für Control-Guild ${guildId} aktiviert`);
    }

    /**
     * Plugin deaktivieren (Global für Dashboard)
     */
    async disable() {
        const Logger = ServiceManager.get('Logger');
        Logger.info('[SuperAdmin] Deaktiviere Dashboard-Plugin global...');
        
        // Routen werden automatisch durch PluginManager entfernt
        
        Logger.success('[SuperAdmin] Dashboard-Plugin global deaktiviert');
        return true;
    }

    /**
     * Guild-spezifische Deaktivierung
     */
    async onGuildDisable(guildId) {
        const logger = ServiceManager.get('Logger');
        const navigationManager = ServiceManager.get('navigationManager');
        
        try {
            // Entferne SuperAdmin Navigation (removeNavigation, nicht unregisterNavigation!)
            await navigationManager.removeNavigation(this.name, guildId);
            
            // Configs löschen
            await dbService.query(
                'DELETE FROM configs WHERE plugin_name = ? AND guild_id = ?',
                [this.name, guildId]
            );

            logger.info(`[SuperAdmin] Plugin für Guild ${guildId} deaktiviert`);
        } catch (error) {
            logger.error(`[SuperAdmin] Fehler beim Deaktivieren für Guild ${guildId}:`, error);
        }
    }
}

module.exports = SuperAdminDashboardPlugin;
