const path = require('path');
const express = require('express');

const { DashboardPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');
const { uptime } = require('process');


class CoreDashboardPlugin extends DashboardPlugin {
  constructor(app) {
        super({
            name: 'core',
            displayName: 'Kern-Plugin',
            description: 'Grundlegende Funktionen für DuneBot',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'DuneBot Team',
            icon: 'fa-solid fa-cog',
            baseDir: __dirname
        });
        
        this.app = app;

        // Startup ausführen (Da core immer aktiv ist)
        // WARNING!!! This method is only for the core plugin!!!
        this._startup_core();
        // WARNING!!! This method is only for the core plugin!!!
    }

  /**
   * Plugin core immer aktivieren
   */
  async _startup_core() {
      const Logger = ServiceManager.get('Logger');
      Logger.info('Aktiviere Core Dashboard-Plugin...');
      
      // Router initialisieren
      this.guildRouter = express.Router();   // Guild-Bereich (früher dashboard/admin)
      this.apiRouter = express.Router();     // API-Bereich für AJAX-Calls

      // Routen einrichten
      this._setupRoutes();
      this._registerHooks();
      this._registerWidgets();
      this._registerShortcodes();
      
      Logger.success('Core Dashboard-Plugin aktiviert');
      return true;
    }

    /**
     * Plugin aktivieren
     */
    async enable() {
      const Logger = ServiceManager.get('Logger');
      Logger.info('Aktiviere Core Dashboard-Plugin...');

      this._registerHooks();
      this._registerWidgets();
      this._registerShortcodes();
      
      Logger.success('Core Dashboard-Plugin aktiviert');
      return true;
    }
  

    /**
     * Routen für das Core-Plugin einrichten
     * 
     * @private
     */
    _setupRoutes() {
      const Logger = ServiceManager.get('Logger');
      const themeManager = ServiceManager.get('themeManager');

        try {
            // API-Routen für AJAX-Calls
            const toastLoggerRouter = require('./routes/api/toast-logger');
            this.apiRouter.use('/toasts', toastLoggerRouter);
            Logger.debug('[Core] Toast-Logger API-Route registriert');

            // Notification Dismiss API
            this.apiRouter.post('/dismiss-notification', async (req, res) => {
                try {
                    const { notificationId } = req.body;
                    
                    // Validierung
                    if (!notificationId) {
                        return res.status(400).json({ 
                            success: false, 
                            message: 'Notification-ID erforderlich' 
                        });
                    }
                    
                    // User muss eingeloggt sein
                    if (!req.session?.user?.id) {
                        return res.status(401).json({ 
                            success: false, 
                            message: 'Nicht authentifiziert' 
                        });
                    }
                    
                    const userId = req.session.user.id;
                    
                    // Lade aktuelle dismissed IDs
                    const current = await req.userConfig.get('core', 'DISMISSED_NOTIFICATIONS');
                    const dismissed = Array.isArray(current) ? current : [];
                    
                    // Füge neue ID hinzu (wenn nicht schon vorhanden)
                    if (!dismissed.includes(parseInt(notificationId))) {
                        dismissed.push(parseInt(notificationId));
                        await req.userConfig.set('core', 'DISMISSED_NOTIFICATIONS', dismissed);
                        Logger.debug(`[Core] User ${userId} dismissed Notification #${notificationId}`);
                    }
                    
                    res.json({ 
                        success: true,
                        message: 'Notification erfolgreich ausgeblendet'
                    });
                } catch (error) {
                    Logger.error('[Core] Fehler beim Dismiss der Notification:', error);
                    res.status(500).json({ 
                        success: false, 
                        message: 'Serverfehler beim Ausblenden' 
                    });
                }
            });
            Logger.debug('[Core] Dismiss-Notification API-Route registriert');

            // Haupteinstellungen
            this.guildRouter.get('/settings', async (req, res) => {
                const guildId = res.locals.guildId;
                const dbService = ServiceManager.get('dbService');
                
                // Lade aktivierte Plugins für die Guild aus guild_plugins Tabelle MIT Badge-Info
                let enabledPlugins = [];
                try {
                    enabledPlugins = await dbService.getEnabledPluginsWithBadges(guildId);
                    Logger.debug(`[Core] Aktivierte Plugins für Guild ${guildId}:`, enabledPlugins);
                } catch (err) {
                    Logger.error('[Core] Fehler beim Laden der enabled Plugins:', err);
                    enabledPlugins = []; // Sicherstellen dass es ein Array ist
                }
                
                // View über ThemeManager rendern lassen
                await themeManager.renderView(res, 'guild/settings', {
                    title: 'Einstellungen',
                    activeMenu: `/guild/${guildId}/plugins/core/settings`,
                    guildId,
                    enabledPlugins: enabledPlugins || [], // Fallback auf leeres Array
                    plugin: this
                });
            });
            
            // Subnav: Allgemeine Einstellungen
            this.guildRouter.get('/settings/general', async (req, res) => {
                const guildId = res.locals.guildId;
                const dbService = ServiceManager.get('dbService');
                
                // WICHTIG: Plugin-Kontext setzen für i18n
                res.locals.pluginName = 'core';
                req.params.pluginName = 'core';
                
                // Defaults
                const settings = {
                    prefix: '!',
                    locale: 'de-DE',
                    theme: 'default',
                    slashCommands: true
                };
                
                try {
                    // Lade UPPERCASE Settings (Standard im System)
                    const configs = await dbService.query(`
                        SELECT config_key, config_value 
                        FROM configs 
                        WHERE plugin_name = 'core' 
                        AND guild_id = ? 
                        AND context = 'shared'
                        AND config_key IN ('PREFIX_COMMANDS_PREFIX', 'LOCALE', 'THEME', 'INTERACTIONS_SLASH')
                    `, [guildId]);
                    
                    // Mapping UPPERCASE -> lowercase für View
                    const keyMap = {
                        'PREFIX_COMMANDS_PREFIX': 'prefix',
                        'LOCALE': 'locale',
                        'THEME': 'theme',
                        'INTERACTIONS_SLASH': 'slashCommands'
                    };
                    
                    configs.forEach(row => {
                        const viewKey = keyMap[row.config_key];
                        if (viewKey) {
                            let value = row.config_value;
                            
                            // Boolean-Werte konvertieren
                            if (viewKey === 'slashCommands') {
                                value = value === '1' || value === 1 || value === true;
                            }
                            
                            settings[viewKey] = value;
                        }
                    });
                } catch (err) {
                    Logger.error('[Core] Fehler beim Laden der Settings:', err);
                }
                
                // Verfügbare Sprachen laden
                const i18n = ServiceManager.get('i18n');
                const languagesMeta = i18n.languagesMeta || [];
                
                await themeManager.renderView(res, 'guild/settings/general', {
                    title: 'Allgemeine Einstellungen',
                    activeMenu: `/guild/${guildId}/plugins/core/settings/general`,
                    guildId,
                    settings,
                    languagesMeta,
                    plugin: this
                });
            });
            
            // PUT: Allgemeine Einstellungen speichern (vorher POST, jetzt PUT wegen guild.js)
            this.guildRouter.put('/settings/general', async (req, res) => {
                const guildId = res.locals.guildId;
                const dbService = ServiceManager.get('dbService');
                const { prefix, locale, theme, slashCommands, verboseLogs, debugMode } = req.body;
                
                try {
                    // WICHTIG: UPPERCASE Keys verwenden (Standard im System!)
                    const settingsMap = {
                        'PREFIX_COMMANDS_PREFIX': prefix,
                        'LOCALE': locale,
                        'THEME': theme,
                        'INTERACTIONS_SLASH': slashCommands === 'on' ? 1 : 0
                    };
                    
                    Logger.debug('[Core Settings] Speichere Settings:', settingsMap);
                    
                    for (const [configKey, value] of Object.entries(settingsMap)) {
                        const configValue = typeof value === 'number' ? value.toString() : value;
                        
                        Logger.debug(`[Core Settings] UPDATE ${configKey} = ${configValue} für Guild ${guildId}`);
                        
                        const result = await dbService.query(`
                            INSERT INTO configs (plugin_name, config_key, config_value, context, guild_id, is_global)
                            VALUES ('core', ?, ?, 'shared', ?, 0)
                            ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)
                        `, [configKey, configValue, guildId]);
                        
                        Logger.debug(`[Core Settings] SQL-Result:`, result);
                    }
                    
                    // WICHTIG: Session-Locale löschen, damit sie beim nächsten Request neu geladen wird!
                    // Dies ermöglicht sofortige Sprachwechsel ohne Logout
                    delete req.session.locale;
                    
                    Logger.debug('[Core Settings] Session-Locale gelöscht für sofortigen Sprachwechsel');
                    
                    res.json({ 
                        success: true, 
                        message: 'Einstellungen erfolgreich gespeichert!' 
                    });
                } catch (error) {
                    Logger.error('[Core] Fehler beim Speichern der Settings:', error);
                    res.status(500).json({ 
                        success: false, 
                        message: error.message 
                    });
                }
            });
            
            // Subnav: Benutzer-Verwaltung
            this.guildRouter.get('/settings/users', async (req, res) => {
                const guildId = res.locals.guildId;
                await themeManager.renderView(res, 'guild/settings/users', {
                    title: 'Benutzer-Verwaltung',
                    activeMenu: `/guild/${guildId}/plugins/core/settings/users`,
                    guildId,
                    plugin: this
                });
            });
            
            // Subnav: Integrationen
            this.guildRouter.get('/settings/integrations', async (req, res) => {
                const guildId = res.locals.guildId;
                await themeManager.renderView(res, 'guild/settings/integrations', {
                    title: 'Integrationen',
                    activeMenu: `/guild/${guildId}/plugins/core/settings/integrations`,
                    guildId,
                    plugin: this
                });
            });

            // Toast-History Page (für alle User - zeigt nur eigene Toasts)
            this.guildRouter.get('/toast-history', async (req, res) => {
                const guildId = res.locals.guildId;
                await themeManager.renderView(res, 'guild/toast-history', {
                    title: 'Toast Benachrichtigungen',
                    activeMenu: `/guild/${guildId}/plugins/core/toast-history`,
                    guildId,
                    plugin: this
                });
            });

            // Bug Report Page
            this.guildRouter.get('/bug-report', async (req, res) => {
                const guildId = res.locals.guildId;
                const dbService = ServiceManager.get('dbService');
                
                // Lade alle Bug Reports für diese Guild
                const bugs = await dbService.query(`
                    SELECT * FROM user_feedback
                    WHERE guild_id = ? AND type = 'bug'
                    ORDER BY created_at DESC
                `, [guildId]);
                
                await themeManager.renderView(res, 'guild/bug-report', {
                    title: 'Bug Report',
                    activeMenu: `/guild/${guildId}/plugins/core/bug-report`,
                    guildId,
                    bugs: bugs || [],
                    plugin: this
                });
            });

                        // Feature Request Page
            this.guildRouter.get('/feature-request', async (req, res) => {
                const guildId = res.locals.guildId;
                const dbService = ServiceManager.get('dbService');
                
                // Lade alle Feature Requests für diese Guild
                const features = await dbService.query(`
                    SELECT * FROM user_feedback
                    WHERE guild_id = ? AND type = 'feature'
                    ORDER BY upvotes DESC, created_at DESC
                `, [guildId]);
                
                await themeManager.renderView(res, 'guild/feature-request', {
                    title: 'Feature Request',
                    activeMenu: `/guild/${guildId}/plugins/core/feature-request`,
                    guildId,
                    features: features || [],
                    plugin: this
                });
            });

            // POST: Bug Report erstellen
            this.guildRouter.post('/bug-report', async (req, res) => {
                const guildId = res.locals.guildId;
                const userId = req.session.user.info.id;
                const userTag = req.session.user.info.username || 'Unknown';
                const dbService = ServiceManager.get('dbService');
                const { title, description, category } = req.body;
                
                try {
                    await dbService.query(`
                        INSERT INTO user_feedback (guild_id, user_id, user_tag, type, title, description, category, status)
                        VALUES (?, ?, ?, 'bug', ?, ?, ?, 'open')
                    `, [guildId, userId, userTag, title, description, category || null]);
                    
                    res.json({ success: true, message: 'Bug Report erfolgreich erstellt!' });
                } catch (error) {
                    Logger.error('[Core] Fehler beim Erstellen des Bug Reports:', error);
                    res.status(500).json({ success: false, message: error.message });
                }
            });

            // POST: Feature Request erstellen
            this.guildRouter.post('/feature-request', async (req, res) => {
                const guildId = res.locals.guildId;
                const userId = req.session.user.info.id;
                const userTag = req.session.user.info.username || 'Unknown';
                const dbService = ServiceManager.get('dbService');
                const { title, description, category } = req.body;
                
                try {
                    await dbService.query(`
                        INSERT INTO user_feedback (guild_id, user_id, user_tag, type, title, description, category, status)
                        VALUES (?, ?, ?, 'feature', ?, ?, ?, 'open')
                    `, [guildId, userId, userTag, title, description, category || null]);
                    
                    res.json({ success: true, message: 'Feature Request erfolgreich erstellt!' });
                } catch (error) {
                    Logger.error('[Core] Fehler beim Erstellen des Feature Requests:', error);
                    res.status(500).json({ success: false, message: error.message });
                }
            });

            // POST: Upvote für Feature Request
            this.guildRouter.post('/feature-request/:id/upvote', async (req, res) => {
                const feedbackId = req.params.id;
                const userId = req.session.user.info.id;
                const dbService = ServiceManager.get('dbService');
                
                try {
                    // Prüfe ob User bereits upvoted hat
                    const existing = await dbService.query(`
                        SELECT id FROM user_feedback_votes WHERE feedback_id = ? AND user_id = ?
                    `, [feedbackId, userId]);
                    
                    if (existing && existing.length > 0) {
                        // Remove upvote
                        await dbService.query(`DELETE FROM user_feedback_votes WHERE feedback_id = ? AND user_id = ?`, [feedbackId, userId]);
                        await dbService.query(`UPDATE user_feedback SET upvotes = upvotes - 1 WHERE id = ?`, [feedbackId]);
                        res.json({ success: true, action: 'removed' });
                    } else {
                        // Add upvote
                        await dbService.query(`INSERT INTO user_feedback_votes (feedback_id, user_id) VALUES (?, ?)`, [feedbackId, userId]);
                        await dbService.query(`UPDATE user_feedback SET upvotes = upvotes + 1 WHERE id = ?`, [feedbackId]);
                        res.json({ success: true, action: 'added' });
                    }
                } catch (error) {
                    Logger.error('[Core] Fehler beim Upvote:', error);
                    res.status(500).json({ success: false, message: error.message });
                }
            });

            // === DONATION SYSTEM ===
            // Donation-Seite
            this.guildRouter.get('/donate', async (req, res) => {
                try {
                    const guildId = req.params.guildId;
                    const dbService = ServiceManager.get('dbService');
                    const userId = req.session?.user?.info?.id || null;
                    
                    // User Badge abrufen (falls vorhanden und eingeloggt)
                    let badges = [];
                    if (userId) {
                        const badgeResult = await dbService.query(
                            'SELECT * FROM supporter_badges WHERE user_id = ? AND is_active = 1',
                            [userId]
                        );
                        badges = Array.isArray(badgeResult) ? badgeResult : [];
                    }
                    
                    // Community Stats
                    const statsResult = await dbService.query(`
                        SELECT 
                            SUM(CASE WHEN payment_status = 'completed' THEN amount ELSE 0 END) as total_amount,
                            COUNT(DISTINCT user_id) as supporter_count
                        FROM donations
                    `);
                    const stats = Array.isArray(statsResult) ? statsResult : [];
                    
                    await themeManager.renderView(res, 'guild/donate', {
                        title: 'DuneBot unterstützen',
                        activeMenu: `/guild/${guildId}/plugins/core/donate`,
                        guildId,
                        userBadge: badges[0] || null,
                        communityStats: stats[0] || { total_amount: 0, supporter_count: 0 },
                        plugin: this
                    });
                } catch (error) {
                    Logger.error('[Core] Error loading donate page:', error);
                    res.status(500).render('error', { message: 'Fehler beim Laden der Seite' });
                }
            });
            
            // Success-Seite
            this.guildRouter.get('/donate/success', (req, res) => {
                res.render('guild/donate-success', {
                    guildId: req.params.guildId,
                    sessionId: req.query.session_id
                });
            });
            
            // Cancel-Seite
            this.guildRouter.get('/donate/cancel', (req, res) => {
                res.render('guild/donate-cancel', {
                    guildId: req.params.guildId
                });
            });
            
            // API Route für Stripe Checkout Session
            this.apiRouter.use('/create-donation', require('./routes/api/create-donation'));
            Logger.debug('[Core] Donation Routes registriert');

            // === HALL OF FAME ===
            // Hall of Fame - Top Donators Leaderboard
            this.guildRouter.get('/hall-of-fame', async (req, res) => {
                try {
                    const guildId = req.params.guildId;
                    const dbService = ServiceManager.get('dbService');
                    const userId = req.session?.user?.info?.id || null;
                    
                    // Top Donators abrufen (mit Badge-Info und User-Details)
                    const topDonators = await dbService.query(`
                        SELECT 
                            d.user_id,
                            SUM(CASE WHEN d.payment_status = 'completed' THEN d.amount ELSE 0 END) as total_donated,
                            COUNT(CASE WHEN d.payment_status = 'completed' THEN 1 END) as donation_count,
                            MAX(d.created_at) as last_donation,
                            sb.badge_level,
                            sb.is_active as has_active_badge,
                            JSON_UNQUOTE(JSON_EXTRACT(d.metadata, '$.username')) as username
                        FROM donations d
                        LEFT JOIN supporter_badges sb ON d.user_id = sb.user_id AND sb.is_active = 1
                        WHERE d.payment_status = 'completed'
                        GROUP BY d.user_id
                        ORDER BY total_donated DESC
                        LIMIT 50
                    `);
                    
                    // Community Stats
                    const statsResult = await dbService.query(`
                        SELECT 
                            SUM(CASE WHEN payment_status = 'completed' THEN amount ELSE 0 END) as total_amount,
                            COUNT(DISTINCT user_id) as supporter_count,
                            COUNT(CASE WHEN payment_status = 'completed' THEN 1 END) as total_donations,
                            AVG(CASE WHEN payment_status = 'completed' THEN amount END) as avg_donation
                        FROM donations
                    `);
                    const stats = Array.isArray(statsResult) && statsResult.length > 0 
                        ? statsResult[0] 
                        : { total_amount: 0, supporter_count: 0, total_donations: 0, avg_donation: 0 };
                    
                    // User Badge abrufen (falls eingeloggt)
                    let userBadge = null;
                    let userRank = null;
                    if (userId) {
                        const badgeResult = await dbService.query(
                            'SELECT * FROM supporter_badges WHERE user_id = ? AND is_active = 1',
                            [userId]
                        );
                        userBadge = Array.isArray(badgeResult) && badgeResult.length > 0 ? badgeResult[0] : null;
                        
                        // User-Rank ermitteln
                        const rankIndex = topDonators.findIndex(d => d.user_id === userId);
                        userRank = rankIndex >= 0 ? rankIndex + 1 : null;
                    }
                    
                    await themeManager.renderView(res, 'guild/hall-of-fame', {
                        title: 'Hall of Fame - Top Supporters',
                        activeMenu: `/guild/${guildId}/plugins/core/hall-of-fame`,
                        guildId,
                        topDonators: topDonators || [],
                        communityStats: stats,
                        userBadge,
                        userRank,
                        plugin: this
                    });
                } catch (error) {
                    Logger.error('[Core] Error loading hall-of-fame page:', error);
                    res.status(500).render('error', { message: 'Fehler beim Laden der Hall of Fame' });
                }
            });
            Logger.debug('[Core] Hall of Fame Route registriert');

            // === PLUGIN RELOAD SYSTEM ===
            // POST: Plugin für Guild neu laden (ohne Deaktivierung)
            this.guildRouter.post('/plugin-reload/:pluginName', async (req, res) => {
                const pluginManager = ServiceManager.get('pluginManager');
                const ipcServer = ServiceManager.get('ipcServer');
                const { pluginName } = req.params;
                const guildId = res.locals.guildId; // Guild-ID aus Middleware
                
                try {
                    Logger.info(`[Core] Plugin-Reload angefordert: ${pluginName} für Guild ${guildId}`);
                    
                    // Validierung
                    if (!pluginName) {
                        return res.status(400).json({ 
                            success: false, 
                            message: 'Plugin-Name fehlt' 
                        });
                    }
                    
                    if (!guildId) {
                        return res.status(400).json({ 
                            success: false, 
                            message: 'Guild-ID fehlt' 
                        });
                    }
                    
                    // Prüfen ob Plugin für diese Guild aktiviert ist
                    const dbService = ServiceManager.get('dbService');
                    const pluginStatus = await dbService.query(
                        'SELECT is_enabled FROM guild_plugins WHERE guild_id = ? AND plugin_name = ?',
                        [guildId, pluginName]
                    );
                    
                    if (!pluginStatus || pluginStatus.length === 0 || !pluginStatus[0].is_enabled) {
                        return res.status(404).json({ 
                            success: false, 
                            message: `Plugin "${pluginName}" ist für diese Guild nicht aktiviert` 
                        });
                    }
                    
                    // Core-Plugin ist erlaubt, aber mit Warnung
                    if (pluginName === 'core') {
                        Logger.warn(`[Core] Core-Plugin Reload angefordert für Guild ${guildId} - Vorsicht geboten`);
                    }
                    
                    // DASHBOARD: Require-Cache für das Plugin leeren
                    const path = require('path');
                    const pluginPath = path.join(__dirname, '../..', pluginName);
                    const cacheKeys = Object.keys(require.cache).filter(key => key.startsWith(pluginPath));
                    
                    Logger.debug(`[Core] Lösche ${cacheKeys.length} Dashboard-Cache-Einträge für ${pluginName}`);
                    cacheKeys.forEach(key => {
                        delete require.cache[key];
                    });
                    
                    // Dashboard-Modul neu laden (ohne onGuildEnable zu triggern)
                    let dashboardReloaded = false;
                    try {
                        const dashboardModulePath = path.join(pluginPath, 'dashboard', 'index.js');
                        if (require.cache[dashboardModulePath]) {
                            delete require.cache[dashboardModulePath];
                        }
                        require(dashboardModulePath);
                        dashboardReloaded = true;
                        Logger.debug(`[Core] Dashboard-Modul für ${pluginName} neu geladen`);
                    } catch (err) {
                        Logger.warn(`[Core] Dashboard-Modul konnte nicht neu geladen werden:`, err.message);
                    }
                    
                    // BOT: IPC-Call zum Reload des Bot-Teils (guild-spezifisch)
                    let botReloaded = false;
                    try {
                        const ipcResponse = await ipcServer.broadcastOne('dashboard:RELOAD_PLUGIN', {
                            pluginName,
                            guildId
                        });
                        
                        if (!ipcResponse.success) {
                            Logger.warn(`[Core] Bot-Plugin-Reload fehlgeschlagen:`, ipcResponse.error);
                        } else {
                            botReloaded = true;
                            Logger.debug(`[Core] Bot-Plugin ${pluginName} für Guild ${guildId} erfolgreich neu geladen`);
                        }
                    } catch (ipcErr) {
                        Logger.warn(`[Core] IPC-Reload fehlgeschlagen:`, ipcErr.message);
                    }
                    
                    res.json({ 
                        success: true, 
                        message: `Plugin "${pluginName}" wurde für Guild ${guildId} neu geladen.`,
                        details: {
                            cacheCleared: cacheKeys.length,
                            dashboardReloaded,
                            botReloaded,
                            pluginName,
                            guildId
                        }
                    });
                    
                } catch (error) {
                    Logger.error(`[Core] Fehler beim Reload von Plugin ${pluginName}:`, error);
                    res.status(500).json({ 
                        success: false, 
                        message: `Fehler beim Reload: ${error.message}` 
                    });
                }
            });
            

            Logger.debug('Core Plugin Routen eingerichtet');
        } catch (error) {
            Logger.error('Fehler beim Einrichten der Core Plugin Routen:', error);
            throw error;
        }
    }
  
    /**
     * Hooks registrieren
     */
    _registerHooks() {
      const Logger = ServiceManager.get('Logger');
      const pluginManager = ServiceManager.get('pluginManager');

      // Filter-Hook Beispiel
      pluginManager.hooks.addFilter('guild_navigation_items', async (items, guildId) => {
        // Hier könnten wir die Navigation filtern oder modifizieren
        return items;
      });
      
      // Action-Hook Beispiel
      pluginManager.hooks.addAction('after_plugin_enable', (plugin) => {
        Logger.info(`Plugin ${plugin.name} wurde aktiviert`);
      });
    }
  
    /**
     * Dashboard-Widgets registrieren
     */
    _registerWidgets() {
        const Logger = ServiceManager.get('Logger');
        const pluginManager = ServiceManager.get('pluginManager');
        const themeManager = ServiceManager.get("themeManager");

        // System-Status-Widget über den Filter registrieren
        pluginManager.hooks.addFilter('guild_dashboard_widgets', async (widgets, options) => {
            
          const { guildId, guild, req, res, theme, user, stats, enabledPlugins, custom } = options;

            // Plugin-Updates Widget (WICHTIG: Zuerst laden!)
            let pendingUpdates = [];
            try {
                pendingUpdates = await pluginManager.getAvailableUpdates(guildId);
            } catch (err) {
                Logger.error('[Core Plugin] Fehler beim Laden von Plugin-Updates:', err);
            }

            // Nur anzeigen wenn Updates vorhanden sind
            if (pendingUpdates.length > 0) {
                widgets.push({
                    id: 'plugin-updates',
                    title: 'Plugin-Updates',
                    size: 12, // Volle Breite statt 4
                    icon: 'fas fa-sync-alt',
                    cardClass: 'card-warning',
                    content: await themeManager.renderWidgetPartial('plugin-updates', { 
                        guildId,
                        pendingUpdates,
                        plugin: 'core'
                    })
                });
            }

            // === SUPPORT DUNEBOT WIDGET ===
            // Support-Widget für Donations (ans Ende verschieben)
            
            // Server-Information Widget
            widgets.push({
                id: 'server-info',
                title: 'Server-Infos',
                size: 4,
                icon: 'bi bi-speedometer',
                cardClass: '',
                async getData(guildId) {
                    return {
                        uptime: process.uptime(),
                        memory: process.memoryUsage()
                    };
                },
                content: await themeManager.renderWidgetPartial('server-info', { 
                  guild: options.guild,
                  stats: options.stats,
                  guildId: options.guildId,
                  enabledPlugins: options.enabledPlugins,
                  uptime: process.uptime(), 
                  memory: process.memoryUsage(),
                  plugin: 'core' })
            });

            // Bot-Berechtigungen Widget
            widgets.push({
                id: 'bot-permissions',
                title: 'Bot-Berechtigungen',
                size: 4,
                icon: 'bi bi-shield-check',
                cardClass: '',
                content: await themeManager.renderWidgetPartial('bot-permissions', { 
                  guild: options.guild,
                  stats: options.stats,
                  guildId: options.guildId,
                  enabledPlugins: options.enabledPlugins,
                  plugin: 'core' })
            });


            // Bot-Performance Widget
            widgets.push({
                id: 'bot-performance',
                title: 'Bot-Performance',
                size: 4,
                icon: 'bi bi-speedometer',
                cardClass: '',
                content: await themeManager.renderWidgetPartial('bot-performance', { 
                  guild: options.guild,
                  stats: options.stats,
                  guildId: options.guildId,
                  enabledPlugins: options.enabledPlugins,
                  plugin: 'core' })
            });
            
            // Server-Analyse Widget
            widgets.push({
                id: 'server-analysis',
                title: 'Server-Analyse',
                size: 4,
                icon: 'bi bi-bar-chart',
                cardClass: '',
                content: await themeManager.renderWidgetPartial('server-analysis', { guild: options.guild,
                  stats: options.stats,
                  guildId: options.guildId,
                  enabledPlugins: options.enabledPlugins,
                  plugin: 'core' })
            });

            // Bot-Berechtigungen Widget
            widgets.push({
                id: 'active-plugins',
                title: 'Active-Plugins',
                size: 8,
                icon: 'bi bi-shield-check',
                cardClass: '',
                content: await themeManager.renderWidgetPartial('active-plugins', { 
                  guild: options.guild,
                  stats: options.stats,
                  guildId: options.guildId,
                  enabledPlugins: options.enabledPlugins.filter(p => p !== 'superadmin'),
                  plugin: 'core'
              })
            });

            // === SUPPORT DUNEBOT WIDGET (am Ende) ===
            try {
                const dbService = ServiceManager.get('dbService');
                const userId = user?.id || null;
                
                // User Badge abrufen (nur wenn User eingeloggt)
                let userBadge = null;
                if (userId) {
                    const [badges] = await dbService.query(
                        'SELECT * FROM supporter_badges WHERE user_id = ? AND badge_visible = 1',
                        [userId]
                    );
                    userBadge = badges[0] || null;
                }
                
                // Community Stats
                const [donationStats] = await dbService.query(`
                    SELECT 
                        SUM(CASE WHEN payment_status = 'completed' THEN amount ELSE 0 END) as total_amount,
                        COUNT(DISTINCT user_id) as supporter_count
                    FROM donations
                `);
                
                widgets.push({
                    id: 'support-dunebot',
                    title: 'DuneBot unterstützen',
                    size: 12, // Volle Breite
                    icon: 'fas fa-heart',
                    cardClass: 'card-success',
                    content: await themeManager.renderWidgetPartial('support-dunebot', { 
                        guildId,
                        userBadge,
                        communityStats: donationStats[0] || { total_amount: 0, supporter_count: 0 },
                        plugin: 'core'
                    })
                });
            } catch (err) {
                Logger.error('[Core Plugin] Fehler beim Laden des Support-Widgets:', err);
            }

            return widgets;
        });

        Logger.debug('Core Plugin Widgets registriert');
    }
  
  
    /**
     * Registriert die Navigation für das Plugin
     * @private
     */
    async _registerNavigation(guildId) {
      const Logger = ServiceManager.get('Logger');
      const navigationManager = ServiceManager.get('navigationManager'); // <-- Verschieben nach oben!

        // Hauptmenüpunkte
        const navItems = [
            {
                title: 'NAV.DASHBOARD',
                url: `/guild/${guildId}`,
                icon: 'fa-solid fa-gauge-high',
                order: 10,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                guildId,
                parent: null
            },
            {
                title: 'NAV.BUG_REPORT',
                url: `/guild/${guildId}/plugins/core/bug-report`,
                icon: 'fa-solid fa-bug',
                order: 11,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                guildId,
                parent: `/guild/${guildId}`
            },
            {
                title: 'NAV.FEATURE_REQUEST',
                url: `/guild/${guildId}/plugins/core/feature-request`,
                icon: 'fa-solid fa-lightbulb',
                order: 12,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                guildId,
                parent: `/guild/${guildId}`
            },
            {
                title: 'NAV.SUPPORT_DUNEBOT',
                url: `/guild/${guildId}/plugins/core/donate`,
                icon: 'fa-solid fa-heart',
                order: 13,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                guildId,
                parent: `/guild/${guildId}`
            },
            {
                title: 'NAV.HALL_OF_FAME',
                url: `/guild/${guildId}/plugins/core/hall-of-fame`,
                icon: 'fa-solid fa-trophy',
                order: 14,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                guildId,
                parent: `/guild/${guildId}`
            },
            {
                title: 'NAV.SETTINGS',
                url: `/guild/${guildId}/plugins/core/settings`,
                icon: 'fa-solid fa-cog',
                order: 20,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                guildId,
                parent: null
            },
            {
                title: 'NAV.PLUGINS',
                url: `/guild/${guildId}/plugins`,
                icon: 'fa-solid fa-puzzle-piece',
                order: 30,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                guildId,
                parent: null
            },
            // Subnav für Einstellungen
            {
                title: 'NAV.GENERAL',
                url: `/guild/${guildId}/plugins/core/settings/general`,
                icon: 'fa-solid fa-sliders',
                order: 21,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                guildId,
                parent: `/guild/${guildId}/plugins/core/settings`
            },
            {
                title: 'NAV.USERS',
                url: `/guild/${guildId}/plugins/core/settings/users`,
                icon: 'fa-solid fa-users',
                order: 22,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                guildId,
                parent: `/guild/${guildId}/plugins/core/settings`
            },
            {
                title: 'NAV.INTEGRATIONS',
                url: `/guild/${guildId}/plugins/core/settings/integrations`,
                icon: 'fa-solid fa-plug',
                order: 23,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                guildId,
                parent: `/guild/${guildId}/plugins/core/settings`
            }
        ];

        try {
            await navigationManager.registerNavigation(this.name, guildId, navItems);

            Logger.debug('Core-Plugin Navigation (mit Subnav) über NavigationManager registriert');
        } catch (error) {
            Logger.error('Fehler beim Registrieren der Navigation:', error);
        }
    }
  
    /**
     * Shortcodes registrieren
     */
    _registerShortcodes() {
      // Shortcode für Guild-Namen registrieren
      this.app.shortcodeParser.register(this.name, 'guild-name', (attrs, content, context) => {
        const guildId = context.guildId || attrs.id;
        if (!guildId) return '[Keine Guild-ID]';
        
        // Guild-Namen aus dem Cache holen
        const guild = this.app.client?.guilds.cache.get(guildId);
        return guild ? guild.name : '[Unbekannte Guild]';
      });
    }
  
    /**
     * Registriert guild-spezifische Navigation
     * Wird aufgerufen, wenn das Plugin in einer Guild aktiviert wird
     * @param {string} guildId - Discord Guild ID
     */
    async onGuildEnable(guildId) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        
        Logger.info(`[Core Plugin] Aktiviere Core-Plugin für Guild ${guildId}`);
        
        try {
            // Prüfen, ob Navigation bereits existiert
            const existingNav = await dbService.query(
                "SELECT COUNT(*) as count FROM nav_items WHERE plugin = ? AND guildId = ?",
                ['core', guildId]
            );
            
            if (existingNav && existingNav[0] && existingNav[0].count > 0) {
                Logger.debug(`[Core Plugin] Navigation für Guild ${guildId} existiert bereits (${existingNav[0].count} Einträge)`);
                
                // Optional: Navigation löschen und neu erstellen
                await dbService.query(
                    "DELETE FROM nav_items WHERE plugin = ? AND guildId = ?",
                    ['core', guildId]
                );
                Logger.debug(`[Core Plugin] Bestehende Navigation für Guild ${guildId} gelöscht`);
            }
            
            // Navigation registrieren
            Logger.debug(`[Core Plugin] Registriere Navigation für Guild ${guildId}`);
            await this._registerNavigation(guildId);
            
            // Verifizieren, dass Navigation erstellt wurde
            const newNav = await dbService.query(
                "SELECT COUNT(*) as count FROM nav_items WHERE plugin = ? AND guildId = ?",
                ['core', guildId]
            );
            
            Logger.info(`[Core Plugin] Navigation für Guild ${guildId} erfolgreich registriert: ${newNav[0]?.count || 0} Einträge`);
        } catch (error) {
            Logger.error(`[Core Plugin] Fehler bei Guild-Aktivierung für ${guildId}:`, error);
            throw error; // Fehler weitergeben für korrekte Fehlerbehandlung
        }
    }

  
}
module.exports = CoreDashboardPlugin;