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
            description: 'Grundlegende Funktionen für FireBot Dashboard',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
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
      Logger.info('Aktiviere [Core] Dashboard-Plugin...');
      
      // Router initialisieren
      this.guildRouter = express.Router();   // Guild-Bereich (früher dashboard/admin)
      this.apiRouter = express.Router();     // API-Bereich für AJAX-Calls

      // Routen einrichten
      this._setupRoutes();
      this._registerHooks();
      this._registerWidgets();
      this._registerShortcodes();
      
      Logger.success('[Core] Dashboard-Plugin aktiviert');
      return true;
    }

    /**
     * Plugin aktivieren
     */
    async enable() {
      const Logger = ServiceManager.get('Logger');
      Logger.info('Aktiviere [Core] Dashboard-Plugin...');

      this._registerHooks();
      this._registerWidgets();
      this._registerShortcodes();
      
      Logger.success('[Core] Dashboard-Plugin aktiviert');
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
                    
                    Logger.debug('[Core] Speichere Settings:', settingsMap);
                    
                    for (const [configKey, value] of Object.entries(settingsMap)) {
                        const configValue = typeof value === 'number' ? value.toString() : value;
                        
                        Logger.debug(`[Core] UPDATE ${configKey} = ${configValue} für Guild ${guildId}`);
                        
                        const result = await dbService.query(`
                            INSERT INTO configs (plugin_name, config_key, config_value, context, guild_id, is_global)
                            VALUES ('core', ?, ?, 'shared', ?, 0)
                            ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)
                        `, [configKey, configValue, guildId]);
                        
                        Logger.debug(`[Core] SQL-Result:`, result);
                    }
                    
                    // WICHTIG: Session-Locale löschen, damit sie beim nächsten Request neu geladen wird!
                    // Dies ermöglicht sofortige Sprachwechsel ohne Logout
                    delete req.session.locale;
                    
                    Logger.debug('[Core] Session-Locale gelöscht für sofortigen Sprachwechsel');
                    
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
                
                // Lade aktuelle Guild Staff Members
                const dbService = ServiceManager.get('dbService');
                const ipcServer = ServiceManager.get('ipcServer');
                let staffMembers = [];
                
                try {
                    const result = await dbService.query(`
                        SELECT 
                            gs.user_id,
                            gs.role,
                            gs.can_manage_settings,
                            gs.can_manage_plugins,
                            gs.can_view_logs,
                            gs.granted_by,
                            gs.granted_at,
                            gs.expires_at,
                            gs.notes
                        FROM guild_staff gs
                        WHERE gs.guild_id = ?
                        ORDER BY gs.granted_at DESC
                    `, [guildId]);
                    
                    // Handle verschiedene Result-Formate
                    if (result && result[0]) {
                        const firstElement = result[0];
                        if (firstElement.user_id) {
                            staffMembers = [firstElement];
                        } else if (typeof firstElement === 'object' && !Array.isArray(firstElement)) {
                            const numericKeys = Object.keys(firstElement).filter(key => !isNaN(key));
                            staffMembers = numericKeys.map(key => firstElement[key]);
                        } else if (Array.isArray(firstElement)) {
                            staffMembers = firstElement;
                        }
                    }
                    
                    // User-Daten vom Bot holen für Namen/Avatare
                    if (staffMembers.length > 0) {
                        const userIds = staffMembers.map(m => m.user_id);
                        try {
                            const userDataResponse = await ipcServer.broadcastOne('dashboard:GET_USERS_DATA', { userIds });
                            
                            if (userDataResponse && userDataResponse.users) {
                                staffMembers = staffMembers.map(member => {
                                    const userData = userDataResponse.users[member.user_id];
                                    return {
                                        ...member,
                                        username: userData?.username || 'Unbekannt',
                                        discriminator: userData?.discriminator || '0000',
                                        avatar: userData?.avatar || null,
                                        tag: userData ? `${userData.username}#${userData.discriminator}` : member.user_id
                                    };
                                });
                            }
                        } catch (ipcErr) {
                            Logger.warn('[Core] Fehler beim Laden von User-Daten via IPC:', ipcErr.message);
                        }
                    }
                } catch (err) {
                    Logger.error('[Core] Fehler beim Laden von Guild Staff:', err);
                }
                
                await themeManager.renderView(res, 'guild/settings/users', {
                    title: 'Benutzer-Verwaltung',
                    activeMenu: `/guild/${guildId}/plugins/core/settings/users`,
                    guildId,
                    staffMembers,
                    plugin: this
                });
            });
            
            // API: Guild Staff Liste laden
            this.guildRouter.get('/settings/users/staff', async (req, res) => {
                const guildId = res.locals.guildId;
                const dbService = ServiceManager.get('dbService');
                
                try {
                    const result = await dbService.query(`
                        SELECT 
                            user_id,
                            role,
                            can_manage_settings,
                            can_manage_plugins,
                            can_view_logs,
                            granted_by,
                            granted_at,
                            expires_at
                        FROM guild_staff
                        WHERE guild_id = ?
                        ORDER BY granted_at DESC
                    `, [guildId]);
                    
                    let staffMembers = [];
                    if (result && result[0]) {
                        const firstElement = result[0];
                        if (firstElement.user_id) {
                            staffMembers = [firstElement];
                        } else if (typeof firstElement === 'object') {
                            const numericKeys = Object.keys(firstElement).filter(key => !isNaN(key));
                            staffMembers = numericKeys.map(key => firstElement[key]);
                        }
                    }
                    
                    res.json({ success: true, staff: staffMembers });
                } catch (err) {
                    Logger.error('[Core] Fehler beim Laden von Guild Staff:', err);
                    res.status(500).json({ success: false, message: 'Fehler beim Laden der Staff-Liste' });
                }
            });
            
            // API: Guild Staff Member hinzufügen
            this.guildRouter.post('/settings/users/staff', async (req, res) => {
                const guildId = res.locals.guildId;
                const dbService = ServiceManager.get('dbService');
                const { user_id, role, can_manage_settings, can_manage_plugins, can_view_logs, expires_at, notes } = req.body;
                
                // Validierung
                if (!user_id || !role) {
                    return res.status(400).json({ success: false, message: 'User ID und Rolle sind erforderlich' });
                }
                
                const validRoles = ['admin', 'manager', 'moderator', 'viewer'];
                if (!validRoles.includes(role)) {
                    return res.status(400).json({ success: false, message: 'Ungültige Rolle' });
                }
                
                try {
                    // Prüfen ob User schon existiert
                    const checkResult = await dbService.query(`
                        SELECT user_id FROM guild_staff WHERE guild_id = ? AND user_id = ?
                    `, [guildId, user_id]);
                    
                    if (checkResult && checkResult[0] && checkResult[0].user_id) {
                        return res.status(400).json({ success: false, message: 'Dieser Benutzer hat bereits eine Rolle' });
                    }
                    
                    // Neuen Staff Member einfügen
                    await dbService.query(`
                        INSERT INTO guild_staff (
                            guild_id, user_id, role,
                            can_manage_settings, can_manage_plugins, can_view_logs,
                            granted_by, granted_at, expires_at, notes
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)
                    `, [
                        guildId,
                        user_id,
                        role,
                        can_manage_settings ? 1 : 0,
                        can_manage_plugins ? 1 : 0,
                        can_view_logs ? 1 : 0,
                        req.session.user.info.id,
                        expires_at || null,
                        notes || null
                    ]);
                    
                    Logger.info(`[Core] Guild Staff hinzugefügt: ${user_id} als ${role} in Guild ${guildId}`);
                    res.json({ success: true, message: 'Benutzer erfolgreich hinzugefügt' });
                } catch (err) {
                    Logger.error('[Core] Fehler beim Hinzufügen von Guild Staff:', err);
                    res.status(500).json({ success: false, message: 'Fehler beim Hinzufügen des Benutzers' });
                }
            });
            
            // API: Guild Staff Member entfernen
            this.guildRouter.delete('/settings/users/staff/:userId', async (req, res) => {
                const guildId = res.locals.guildId;
                const { userId } = req.params;
                const dbService = ServiceManager.get('dbService');
                
                try {
                    await dbService.query(`
                        DELETE FROM guild_staff WHERE guild_id = ? AND user_id = ?
                    `, [guildId, userId]);
                    
                    Logger.info(`[Core] Guild Staff entfernt: ${userId} aus Guild ${guildId}`);
                    res.json({ success: true, message: 'Benutzer erfolgreich entfernt' });
                } catch (err) {
                    Logger.error('[Core] Fehler beim Entfernen von Guild Staff:', err);
                    res.status(500).json({ success: false, message: 'Fehler beim Entfernen des Benutzers' });
                }
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
            
            // Permissions Router
            const permissionsRouter = require('./routes/permissions.router');
            this.guildRouter.use('/permissions', permissionsRouter);
            Logger.debug('[Core] Permissions-Router registriert');

            Logger.debug('[Core] Routen eingerichtet');
        } catch (error) {
            Logger.error('Fehler beim Einrichten der [Core] Routen:', error);
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
                Logger.error('[Core] Fehler beim Laden von Plugin-Updates:', err);
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
                Logger.error('[Core] Fehler beim Laden des Support-Widgets:', err);
            }

            return widgets;
        });

        Logger.debug('[Core] Plugin Widgets registriert');
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
                order: 1000,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                guildId,
                parent: null
            },
            {
                title: 'NAV.BUG_REPORT',
                url: `/guild/${guildId}/plugins/core/bug-report`,
                icon: 'fa-solid fa-bug',
                order: 10,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                guildId,
                parent: `/guild/${guildId}`
            },
            {
                title: 'NAV.FEATURE_REQUEST',
                url: `/guild/${guildId}/plugins/core/feature-request`,
                icon: 'fa-solid fa-lightbulb',
                order: 20,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                guildId,
                parent: `/guild/${guildId}`
            },
            {
                title: 'NAV.SUPPORT_DUNEBOT',
                url: `/guild/${guildId}/plugins/core/donate`,
                icon: 'fa-solid fa-heart',
                order: 30,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                guildId,
                parent: `/guild/${guildId}`
            },
            {
                title: 'NAV.HALL_OF_FAME',
                url: `/guild/${guildId}/plugins/core/hall-of-fame`,
                icon: 'fa-solid fa-trophy',
                order: 40,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                guildId,
                parent: `/guild/${guildId}`
            },
            {
                title: 'NAV.SETTINGS',
                url: `/guild/${guildId}/plugins/core/settings`,
                icon: 'fa-solid fa-cog',
                order: 2000,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                guildId,
                parent: null
            },
            {
                title: 'NAV.PERMISSIONS',
                url: `/guild/${guildId}/permissions`,
                icon: 'fa-solid fa-user-lock',
                order: 2500,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                guildId,
                parent: null
            },
            {
                title: 'NAV.PLUGINS',
                url: `/guild/${guildId}/plugins`,
                icon: 'fa-solid fa-puzzle-piece',
                order: 3000,
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
                order: 10,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                guildId,
                parent: `/guild/${guildId}/plugins/core/settings`
            },
            {
                title: 'NAV.USERS',
                url: `/guild/${guildId}/plugins/core/settings/users`,
                icon: 'fa-solid fa-users',
                order: 20,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                guildId,
                parent: `/guild/${guildId}/plugins/core/settings`
            },
            {
                title: 'NAV.INTEGRATIONS',
                url: `/guild/${guildId}/plugins/core/settings/integrations`,
                icon: 'fa-solid fa-plug',
                order: 30,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                guildId,
                parent: `/guild/${guildId}/plugins/core/settings`
            },
            // Subnav für Berechtigungen
            {
                title: 'NAV.PERMISSIONS_USERS',
                url: `/guild/${guildId}/permissions/users`,
                icon: 'fa-solid fa-users',
                order: 10,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                guildId,
                parent: `/guild/${guildId}/permissions`
            },
            {
                title: 'NAV.PERMISSIONS_GROUPS',
                url: `/guild/${guildId}/permissions/groups`,
                icon: 'fa-solid fa-users-cog',
                order: 20,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                guildId,
                parent: `/guild/${guildId}/permissions`
            },
            {
                title: 'NAV.PERMISSIONS_MATRIX',
                url: `/guild/${guildId}/permissions/matrix`,
                icon: 'fa-solid fa-table',
                order: 30,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                guildId,
                parent: `/guild/${guildId}/permissions`
            }
        ];

        try {
            await navigationManager.registerNavigation(this.name, guildId, navItems);

            Logger.debug('[Core] Plugin Navigation (mit Subnav) über NavigationManager registriert');
        } catch (error) {
            Logger.error('[Core] Fehler beim Registrieren der Navigation:', error);
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
     * Wird nach einem Plugin-Update ausgeführt
     * Führt Migrations aus und aktualisiert System-Daten
     * 
     * @param {string} oldVersion - Alte Plugin-Version
     * @param {string} newVersion - Neue Plugin-Version
     * @param {string} guildId - Guild ID (optional, kann null sein für globale Updates)
     * @returns {Promise<{success: boolean, message?: string, error?: string}>}
     */
    async onUpdate(oldVersion, newVersion, guildId = null) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        const PermissionManager = require('dunebot-sdk/lib/PermissionManager');
        const semver = require('semver');
        
        Logger.info(`[Core] Update-Hook: ${oldVersion} → ${newVersion}${guildId ? ' (Guild: ' + guildId + ')' : ' (global)'}`);
        
        try {
            // ====================================
            // Version 6.6.0: Permission-System
            // ====================================
            if (semver.gte(newVersion, '6.6.0') && semver.lt(oldVersion, '6.6.0')) {
                Logger.info('[Core] Erkannte Migration: Permission-System (v6.6.0)');
                
                // Migration wird automatisch vom PluginManager via runMigration() aufgerufen
                // Hier nur zusätzliche Guild-spezifische Logik
                
                if (guildId) {
                    // Sicherstellen, dass Standard-Gruppen existieren
                    const [groups] = await dbService.query(
                        'SELECT COUNT(*) as count FROM guild_groups WHERE guild_id = ?',
                        [guildId]
                    );
                    
                    if (!groups || groups.count === 0) {
                        Logger.warn(`[Core] Keine Gruppen für Guild ${guildId}, erstelle Standard-Gruppen...`);
                        await PermissionManager.seedDefaultGroups(guildId);
                    }
                    
                    // Owner zur Admin-Gruppe hinzufügen (falls nicht schon passiert)
                    const [guild] = await dbService.query(
                        'SELECT owner_id FROM guilds WHERE _id = ?',
                        [guildId]
                    );
                    
                    if (guild && guild.owner_id) {
                        const [userExists] = await dbService.query(
                            'SELECT id FROM guild_users WHERE user_id = ? AND guild_id = ?',
                            [guild.owner_id, guildId]
                        );
                        
                        if (!userExists) {
                            Logger.info(`[Core] Erstelle Owner-User für Guild ${guildId}`);
                            await PermissionManager.upsertGuildUser(guild.owner_id, guildId, {
                                is_owner: true,
                                status: 'active'
                            });
                            
                            // Zur Admin-Gruppe hinzufügen
                            const [adminGroup] = await dbService.query(
                                'SELECT id FROM guild_groups WHERE guild_id = ? AND slug = ?',
                                [guildId, 'administrator']
                            );
                            
                            if (adminGroup) {
                                await PermissionManager.assignUserToGroup(guild.owner_id, adminGroup.id, 'system');
                                Logger.success(`[Core] Owner zur Administrator-Gruppe hinzugefügt`);
                            }
                        }
                    }
                    
                    // Navigation aktualisieren (WICHTIG: Core kann nicht deaktiviert werden!)
                    Logger.info(`[Core] Aktualisiere Navigation für Guild ${guildId}...`);
                    try {
                        // Alte Navigation löschen
                        await dbService.query(
                            "DELETE FROM nav_items WHERE plugin = ? AND guildId = ?",
                            ['core', guildId]
                        );
                        
                        // Neue Navigation registrieren
                        await this._registerNavigation(guildId);
                        
                        const [navCount] = await dbService.query(
                            "SELECT COUNT(*) as count FROM nav_items WHERE plugin = ? AND guildId = ?",
                            ['core', guildId]
                        );
                        
                        Logger.success(`[Core] Navigation aktualisiert: ${navCount.count} Einträge`);
                    } catch (navError) {
                        Logger.error('[Core] Fehler beim Aktualisieren der Navigation:', navError);
                        // Nicht abbrechen, Update ist trotzdem erfolgreich
                    }
                }
                
                Logger.success('[Core] Permission-System Update abgeschlossen');
            }
            
            // ====================================
            // GENERELLES: Navigation IMMER aktualisieren bei Core-Updates
            // ====================================
            if (guildId) {
                Logger.info(`[Core] Aktualisiere Navigation für Guild ${guildId} (generell bei Core-Updates)...`);
                try {
                    // Alte Navigation löschen
                    await dbService.query(
                        "DELETE FROM nav_items WHERE plugin = ? AND guildId = ?",
                        ['core', guildId]
                    );
                    
                    // Neue Navigation registrieren
                    await this._registerNavigation(guildId);
                    
                    const [navCount] = await dbService.query(
                        "SELECT COUNT(*) as count FROM nav_items WHERE plugin = ? AND guildId = ?",
                        ['core', guildId]
                    );
                    
                    Logger.success(`[Core] Navigation aktualisiert: ${navCount.count} Einträge (genereller Update-Hook)`);
                } catch (navError) {
                    Logger.error('[Core] Fehler beim Aktualisieren der Navigation:', navError);
                    // Nicht abbrechen, Update ist trotzdem erfolgreich
                }
            }
            
            // ====================================
            // Weitere Versions-Checks hier...
            // ====================================
            
            return {
                success: true,
                message: `Core-Plugin erfolgreich aktualisiert auf ${newVersion}`
            };
            
        } catch (error) {
            Logger.error('[Core] Fehler in onUpdate():', error);
            return {
                success: false,
                error: `Update fehlgeschlagen: ${error.message}`
            };
        }
    }

    /**
     * Registriert guild-spezifische Navigation
     * Wird aufgerufen, wenn das Plugin in einer Guild aktiviert wird
     * @param {string} guildId - Discord Guild ID
     */
    async onGuildEnable(guildId) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        
        Logger.info(`[Core] Aktiviere Core-Plugin für Guild ${guildId}`);
        
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
                Logger.debug(`[Core] Bestehende Navigation für Guild ${guildId} gelöscht`);
            }
            
            // Navigation registrieren
            Logger.debug(`[Core] Registriere Navigation für Guild ${guildId}`);
            await this._registerNavigation(guildId);
            
            // Verifizieren, dass Navigation erstellt wurde
            const newNav = await dbService.query(
                "SELECT COUNT(*) as count FROM nav_items WHERE plugin = ? AND guildId = ?",
                ['core', guildId]
            );
            
            Logger.info(`[Core] Navigation für Guild ${guildId} erfolgreich registriert: ${newNav[0]?.count || 0} Einträge`);
        } catch (error) {
            Logger.error(`[Core] Fehler bei Guild-Aktivierung für ${guildId}:`, error);
            throw error; // Fehler weitergeben für korrekte Fehlerbehandlung
        }
    }

  
}
module.exports = CoreDashboardPlugin;