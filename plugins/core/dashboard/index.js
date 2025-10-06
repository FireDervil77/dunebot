const path = require('path');
const express = require('express');

const { DashboardPlugin } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');
const { uptime } = require('process');


class CoreDashboardPlugin extends DashboardPlugin {
  constructor(app) {
        super({
            name: 'core',
            displayName: 'Kern-Plugin',
            description: 'Grundlegende Funktionen für DuneBot',
            version: '1.0.0',
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
            // Haupteinstellungen
            this.guildRouter.get('/settings', async (req, res) => {
                const guildId = res.locals.guildId;
                const dbService = ServiceManager.get('dbService');
                
                // Lade aktivierte Plugins für die Guild
                let enabledPlugins = [];
                try {
                    const [config] = await dbService.query(
                        `SELECT config_value FROM configs 
                         WHERE plugin_name = 'core' 
                         AND config_key = 'ENABLED_PLUGINS' 
                         AND context = 'shared' 
                         AND guild_id = ?`,
                        [guildId]
                    );
                    
                    if (config && config.config_value) {
                        enabledPlugins = typeof config.config_value === 'string' 
                            ? JSON.parse(config.config_value) 
                            : config.config_value;
                    }
                } catch (err) {
                    Logger.error('[Core] Fehler beim Laden der enabled Plugins:', err);
                }
                
                // View über ThemeManager rendern lassen
                await themeManager.renderView(res, 'guild/settings', {
                    title: 'Einstellungen',
                    activeMenu: `/guild/${guildId}/plugins/core/settings`,
                    guildId,
                    enabledPlugins,
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
                  enabledPlugins: options.enabledPlugins,
                  plugin: 'core'
              })
            });

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
                title: 'Dashboard',
                url: `/guild/${guildId}`,
                icon: 'fa-solid fa-gauge-high',
                order: 10,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                guildId,
                parent: null
            },
            {
                title: 'Einstellungen',
                url: `/guild/${guildId}/plugins/core/settings`,
                icon: 'fa-solid fa-cog',
                order: 20,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                guildId,
                parent: null
            },
            {
                title: 'Plugins',
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
                title: 'Allgemein',
                url: `/guild/${guildId}/plugins/core/settings/general`,
                icon: 'fa-solid fa-sliders',
                order: 21,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                guildId,
                parent: `/guild/${guildId}/plugins/core/settings`
            },
            {
                title: 'Benutzer',
                url: `/guild/${guildId}/plugins/core/settings/users`,
                icon: 'fa-solid fa-users',
                order: 22,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                guildId,
                parent: `/guild/${guildId}/plugins/core/settings`
            },
            {
                title: 'Integrationen',
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