/**
 * SuperAdmin Dashboard Plugin
 * Nur für Bot-Owner zugänglich - Globale Verwaltung
 * 
 * @author FireDervil
 */

const path = require('path');
const express = require('express');
const fs = require('fs');

const { DashboardPlugin } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

class SuperAdminDashboardPlugin extends DashboardPlugin {
    constructor(app) {
        super({
            name: 'superadmin',
            displayName: 'SuperAdmin Panel',
            description: 'Globale Verwaltung - Nur für Bot-Owner',
            version: '1.0.0',
            author: 'FireDervil',
            icon: 'fa-solid fa-shield-halved',
            baseDir: __dirname,
            requiresOwner: true // WICHTIG: Nur für Owner!
        });
        
        this.app = app;
        this.guildRouter = express.Router();
    }

    /**
     * Plugin aktivieren
     */
    async enable() {
        const Logger = ServiceManager.get('Logger');
        Logger.info('Aktiviere SuperAdmin Dashboard-Plugin...');

        // Routen einrichten
        this._setupRoutes();
        this._registerHooks();
        
        Logger.success('SuperAdmin Dashboard-Plugin aktiviert');
        return true;
    }

    /**
     * Routen für SuperAdmin einrichten
     */
    _setupRoutes() {
        const Logger = ServiceManager.get('Logger');
        const themeManager = ServiceManager.get('themeManager');

        try {
            // Middleware: Owner-Check für ALLE SuperAdmin-Routen
            this.guildRouter.use(this._checkOwner.bind(this));

            // === HAUPTSEITE ===
            this.guildRouter.get('/', async (req, res) => {
                const guildId = res.locals.guildId;
                const dbService = ServiceManager.get('dbService');

                // Globale Statistiken laden
                const stats = await this._getGlobalStats(dbService);

                await themeManager.renderView(res, 'guild/dashboard', {
                    title: 'SuperAdmin Dashboard',
                    activeMenu: `/guild/${guildId}/plugins/superadmin`,
                    guildId,
                    stats,
                    plugin: this
                });
            });

            // === NEWS VERWALTUNG ===
            this.guildRouter.get('/news', async (req, res) => {
                const guildId = res.locals.guildId;
                const dbService = ServiceManager.get('dbService');

                // Alle News laden
                const newsList = await dbService.query(`
                    SELECT _id, title, slug, author, excerpt, 
                           status, date, created_at, updated_at
                    FROM news 
                    ORDER BY date DESC
                `);

                await themeManager.renderView(res, 'guild/news', {
                    title: 'News Verwaltung',
                    activeMenu: `/guild/${guildId}/plugins/superadmin/news`,
                    guildId,
                    newsList,
                    plugin: this
                });
            });

            // News erstellen
            this.guildRouter.get('/news/create', async (req, res) => {
                const guildId = res.locals.guildId;
                
                await themeManager.renderView(res, 'guild/news-edit', {
                    title: 'News erstellen',
                    activeMenu: `/guild/${guildId}/plugins/superadmin/news`,
                    guildId,
                    news: null,
                    plugin: this
                });
            });

            // News bearbeiten
            this.guildRouter.get('/news/edit/:id', async (req, res) => {
                const guildId = res.locals.guildId;
                const dbService = ServiceManager.get('dbService');

                const newsItem = await dbService.query(`
                    SELECT * FROM news WHERE _id = ?
                `, [req.params.id]);

                if (!newsItem?.length) {
                    return res.status(404).send('News nicht gefunden');
                }

                await themeManager.renderView(res, 'guild/news-edit', {
                    title: 'News bearbeiten',
                    activeMenu: `/guild/${guildId}/plugins/superadmin/news`,
                    guildId,
                    news: newsItem[0],
                    plugin: this
                });
            });

            // News speichern (POST)
            this.guildRouter.post('/news/save', async (req, res) => {
                const dbService = ServiceManager.get('dbService');
                const { title, slug, author, excerpt, news_text, image_url, status, date } = req.body;

                try {
                    if (req.body._id) {
                        // Update
                        await dbService.query(`
                            UPDATE news 
                            SET title = ?, slug = ?, author = ?, excerpt = ?,
                                news_text = ?, image_url = ?, status = ?, date = ?,
                                updated_at = NOW()
                            WHERE _id = ?
                        `, [title, slug, author, excerpt, news_text, image_url, status, date, req.body._id]);
                    } else {
                        // Create
                        await dbService.query(`
                            INSERT INTO news 
                            (title, slug, author, excerpt, news_text, image_url, status, date, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
                        `, [title, slug, author, excerpt, news_text, image_url, status, date]);
                    }

                    res.redirect(`/guild/${res.locals.guildId}/plugins/superadmin/news`);
                } catch (error) {
                    Logger.error('Fehler beim Speichern der News:', error);
                    res.status(500).send('Fehler beim Speichern');
                }
            });

            // News löschen
            this.guildRouter.post('/news/delete/:id', async (req, res) => {
                const dbService = ServiceManager.get('dbService');

                try {
                    await dbService.query(`DELETE FROM news WHERE _id = ?`, [req.params.id]);
                    res.redirect(`/guild/${res.locals.guildId}/plugins/superadmin/news`);
                } catch (error) {
                    Logger.error('Fehler beim Löschen der News:', error);
                    res.status(500).send('Fehler beim Löschen');
                }
            });

            // === NOTIFICATIONS ===
            this.guildRouter.get('/notifications', async (req, res) => {
                const guildId = res.locals.guildId;
                const dbService = ServiceManager.get('dbService');

                // Alle Guilds für Dropdown holen
                const guilds = await dbService.query(`SELECT _id as id, guild_name as name FROM guilds ORDER BY guild_name`);

                // Letzte 10 Notifications holen
                const recentNotifications = await dbService.query(`
                    SELECT * FROM notifications 
                    ORDER BY created_at DESC 
                    LIMIT 10
                `);

                await themeManager.renderView(res, 'guild/notifications', {
                    title: 'Globale Notifications',
                    activeMenu: `/guild/${guildId}/plugins/superadmin/notifications`,
                    guildId,
                    guilds,
                    recentNotifications,
                    plugin: this
                });
            });

            // Notification senden (POST)
            this.guildRouter.post('/notifications/send', async (req, res) => {
                const dbService = ServiceManager.get('dbService');
                const { title, message, type, target, target_guild_id } = req.body;

                try {
                    let guilds = [];
                    
                    if (target === 'all') {
                        // Alle Guilds
                        guilds = await dbService.query(`SELECT _id FROM guilds`);
                    } else if (target === 'specific' && target_guild_id) {
                        // Spezifische Guild
                        guilds = [{ _id: target_guild_id }];
                    }

                    // Notification für jede Guild erstellen
                    for (const guild of guilds) {
                        await dbService.query(`
                            INSERT INTO notifications 
                            (guild_id, title, message, type, created_at)
                            VALUES (?, ?, ?, ?, NOW())
                        `, [guild._id, title, message, type]);
                    }

                    res.redirect(`/guild/${res.locals.guildId}/plugins/superadmin/notifications`);
                } catch (error) {
                    Logger.error('Fehler beim Senden der Notification:', error);
                    res.status(500).send('Fehler beim Senden');
                }
            });

            // === SYSTEM STATS ===
            this.guildRouter.get('/stats', async (req, res) => {
                const guildId = res.locals.guildId;
                const dbService = ServiceManager.get('dbService');

                const stats = await this._getGlobalStats(dbService);

                // Top 10 Guilds nach Beitrittsdatum (neueste zuerst)
                const topGuilds = await dbService.query(`
                    SELECT guild_name as name, joined_at 
                    FROM guilds 
                    WHERE is_active_guild = 1
                    ORDER BY joined_at DESC 
                    LIMIT 10
                `);

                // Letzte News
                const recentNews = await dbService.query(`
                    SELECT title, status, date 
                    FROM news 
                    ORDER BY date DESC 
                    LIMIT 10
                `);

                // Plugin Statistiken - aus configs-Tabelle
                // Da ENABLED_PLUGINS ein JSON-Array ist, zählen wir die Guild-Configs
                const pluginConfigsRaw = await dbService.query(`
                    SELECT config_value, guild_id
                    FROM configs 
                    WHERE plugin_name = 'core' 
                    AND config_key = 'ENABLED_PLUGINS'
                    AND guild_id != ''
                `);

                // Plugin-Statistiken aus den Configs aggregieren
                const pluginStats = [];
                const pluginCounts = {};
                const totalGuilds = pluginConfigsRaw.length;

                pluginConfigsRaw.forEach(row => {
                    try {
                        const enabledPlugins = JSON.parse(row.config_value || '[]');
                        enabledPlugins.forEach(pluginName => {
                            pluginCounts[pluginName] = (pluginCounts[pluginName] || 0) + 1;
                        });
                    } catch (e) {
                        // Ignoriere Parse-Fehler
                    }
                });

                // In Array umwandeln und sortieren
                Object.entries(pluginCounts).forEach(([name, count]) => {
                    pluginStats.push({
                        name,
                        count,
                        percentage: totalGuilds > 0 ? ((count / totalGuilds) * 100).toFixed(2) : 0
                    });
                });
                pluginStats.sort((a, b) => b.count - a.count);

                await themeManager.renderView(res, 'guild/stats', {
                    title: 'System Statistiken',
                    activeMenu: `/guild/${guildId}/plugins/superadmin/stats`,
                    guildId,
                    stats,
                    topGuilds,
                    recentNews,
                    pluginStats,
                    plugin: this
                });
            });

            Logger.debug('SuperAdmin Plugin Routen eingerichtet');
        } catch (error) {
            Logger.error('Fehler beim Einrichten der SuperAdmin Plugin Routen:', error);
            throw error;
        }
    }

    /**
     * Middleware: Prüft ob User der Bot-Owner ist UND in der Control Guild
     */
    async _checkOwner(req, res, next) {
        const Logger = ServiceManager.get('Logger');
        const user = res.locals.user || req.session?.user;
        const guildId = res.locals.guildId;

        // Owner-ID aus Config laden
        const config = this._loadConfig();
        const ownerId = config.BOT_OWNER_ID;
        
        // Control Guild aus ENV laden
        const controlGuildId = process.env.CONTROL_GUILD_ID;

        // DEBUG: Log alle relevanten Werte
        Logger.debug(`[SuperAdmin Auth] User ID: ${user?.info?.id} (Type: ${typeof user?.info?.id})`);
        Logger.debug(`[SuperAdmin Auth] Owner ID: ${ownerId} (Type: ${typeof ownerId})`);
        Logger.debug(`[SuperAdmin Auth] Guild ID: ${guildId} (Type: ${typeof guildId})`);
        Logger.debug(`[SuperAdmin Auth] Control Guild: ${controlGuildId} (Type: ${typeof controlGuildId})`);
        Logger.debug(`[SuperAdmin Auth] User Object:`, user);

        // Prüfe Owner-ID (String-Vergleich für Sicherheit)
        if (!user || !user.info || String(user.info.id) !== String(ownerId)) {
            Logger.warn(`Unauthorized SuperAdmin access attempt by user ${user?.info?.id}`);
            return res.status(403).render('error', {
                message: '🔒 Zugriff verweigert! Nur der Bot-Owner kann diesen Bereich nutzen.',
                error: { status: 403 }
            });
        }

        // Prüfe Control Guild (String-Vergleich)
        if (controlGuildId && String(guildId) !== String(controlGuildId)) {
            Logger.warn(`SuperAdmin access attempt in non-control guild ${guildId} by owner`);
            return res.status(403).render('error', {
                message: '🔒 SuperAdmin ist nur in der Control Guild verfügbar.',
                error: { status: 403 }
            });
        }

        next();
    }

    /**
     * Config laden
     */
    _loadConfig() {
        const Logger = ServiceManager.get('Logger');
        const configPath = path.join(__dirname, '..', 'config.json'); // Ein Verzeichnis höher!
        
        Logger.debug(`[SuperAdmin] Lade Config von: ${configPath}`);
        
        if (fs.existsSync(configPath)) {
            try {
                const configContent = fs.readFileSync(configPath, 'utf8');
                const config = JSON.parse(configContent);
                Logger.debug('[SuperAdmin] Config geladen:', config);
                return config;
            } catch (error) {
                Logger.error('[SuperAdmin] Fehler beim Parsen der config.json:', error);
                return {};
            }
        }
        
        Logger.warn(`[SuperAdmin] config.json nicht gefunden: ${configPath}`);
        return {};
    }

    /**
     * Globale Statistiken laden
     */
    async _getGlobalStats(dbService) {
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

        return stats;
    }

    /**
     * Hooks registrieren
     */
    _registerHooks() {
        const pluginManager = ServiceManager.get('pluginManager');

        // Filter: Navigation nur für Owner anzeigen
        pluginManager.hooks.addFilter('guild_navigation_items', async (items, guildId) => {
            const Logger = ServiceManager.get('Logger');
            
            try {
                // Prüfe ob SuperAdmin-Navigation bereits vorhanden ist
                const hasSuperAdminNav = items.some(item => item.url && item.url.includes('/plugins/superadmin'));
                
                if (!hasSuperAdminNav) {
                    Logger.debug(`[SuperAdmin] Keine SuperAdmin-Navigation gefunden für Guild ${guildId}`);
                }
                
                return items;
            } catch (error) {
                Logger.error('[SuperAdmin] Fehler im Navigation-Filter:', error);
                return items;
            }
        });
    }

    /**
     * Plugin aktivieren (global, beim Dashboard-Start)
     */
    async onEnable(app, dbService) {
        const Logger = ServiceManager.get('Logger');
        Logger.info('[SuperAdmin] Plugin wird aktiviert...');

        // Routen einrichten
        this._setupRoutes();
        this._registerHooks();
        
        Logger.info('[SuperAdmin] Plugin erfolgreich aktiviert');
        return true;
    }

    /**
     * Guild-spezifische Aktivierung - Navigation dynamisch hinzufügen
     */
    async onGuildEnable(guildId) {
        const Logger = ServiceManager.get('Logger');
        const navigationManager = ServiceManager.get('navigationManager');

        try {
            Logger.debug('[SuperAdmin] Navigation wird für Guild ${guildId} registriert');
            
            // Navigation registrieren
            const navItems = [
                {
                    title: 'SuperAdmin',
                    url: `/guild/${guildId}/plugins/superadmin`,
                    icon: 'fa-solid fa-shield-halved',
                    order: 1,
                    type: navigationManager.menuTypes.MAIN,
                    visible: true,
                    guildId,
                    parent: null
                },
                {
                    title: 'News Verwaltung',
                    url: `/guild/${guildId}/plugins/superadmin/news`,
                    icon: 'fa-solid fa-newspaper',
                    order: 2,
                    type: navigationManager.menuTypes.MAIN,
                    visible: true,
                    guildId,
                    parent: `/guild/${guildId}/plugins/superadmin`
                },
                {
                    title: 'Notifications',
                    url: `/guild/${guildId}/plugins/superadmin/notifications`,
                    icon: 'fa-solid fa-bell',
                    order: 3,
                    type: navigationManager.menuTypes.MAIN,
                    visible: true,
                    guildId,
                    parent: `/guild/${guildId}/plugins/superadmin`
                },
                {
                    title: 'Statistiken',
                    url: `/guild/${guildId}/plugins/superadmin/stats`,
                    icon: 'fa-solid fa-chart-line',
                    order: 4,
                    type: navigationManager.menuTypes.MAIN,
                    visible: true,
                    guildId,
                    parent: `/guild/${guildId}/plugins/superadmin`
                }
            ];

            await navigationManager.registerNavigation(this.name, guildId, navItems);
            Logger.debug(`[SuperAdmin] Navigation erfolgreich für Guild ${guildId} registriert`);
        } catch (error) {
            Logger.error(`[SuperAdmin] Fehler beim Registrieren der Navigation für Guild ${guildId}:`, error);
            throw error;
        }
    }

    /**
     * Guild-spezifische Deaktivierung - Navigation entfernen
     */
    async onGuildDisable(guildId) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        try {
            Logger.debug(`[SuperAdmin] Navigation wird für Guild ${guildId} entfernt`);
            
            // Navigation aus der Datenbank entfernen
            await dbService.query(
                'DELETE FROM nav_items WHERE plugin = ? AND guildId = ?',
                [this.name, guildId]
            );
            
            Logger.debug(`[SuperAdmin] Navigation erfolgreich für Guild ${guildId} entfernt`);
        } catch (error) {
            Logger.error(`[SuperAdmin] Fehler beim Entfernen der Navigation für Guild ${guildId}:`, error);
            throw error;
        }
    }
}

module.exports = SuperAdminDashboardPlugin;
