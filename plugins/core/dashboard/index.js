const path = require('path');
const express = require('express');

const { DashboardPlugin } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

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

      Logger.debug('Core Plugin Routen:', {
              hasRouter: !!this.guildRouter,
              routes: this.guildRouter?.stack
                  ?.filter(r => r.route)
                  ?.map(r => ({
                      path: r.route.path,
                      methods: Object.keys(r.route.methods)
                  }))
          });

      // Restliche Initialisierung
      await this.registerTables();
      this._registerHooks();
      this._registerWidgets();
      this._registerAdminSections();
      this._registerNavigation();
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
    
    Logger.debug('Core Plugin Routen:', {
            hasRouter: !!this.guildRouter,
            routes: this.guildRouter?.stack
                ?.filter(r => r.route)
                ?.map(r => ({
                    path: r.route.path,
                    methods: Object.keys(r.route.methods)
                }))
        });

    // Restliche Initialisierung
    await this.registerTables();
    this._registerHooks();
    this._registerWidgets();
    this._registerAdminSections();
    this._registerNavigation();
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
          this.guildRouter.get('/settings', async (req, res) => {
              Logger.debug('Core Settings Route aufgerufen:', {
                  guildId: req.params.guildId,
                  path: req.path
              });
              
              // View über ThemeManager rendern lassen
              await themeManager.renderView(res, 'guild/settings', {
                  title: 'Core Plugin Einstellungen',
                  guildId: req.params.guildId,
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
   * Tabellen für das Dashboard registrieren
   * @returns {Promise<boolean>} Erfolg der Registrierung
   * @author firedervil
   */
  async registerTables() {
      const Logger = ServiceManager.get('Logger');
      const dbService = ServiceManager.get('dbService');

      try {
          // SQL für configs Tabelle
          await dbService.query(`
              CREATE TABLE IF NOT EXISTS configs (
                  _id VARCHAR(255) PRIMARY KEY,
                  enabled_plugins TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
              ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
          `);

          // SQL für nav_items Tabelle
          await dbService.query(`
              CREATE TABLE IF NOT EXISTS nav_items (
                  id INT AUTO_INCREMENT PRIMARY KEY,
                  guildId VARCHAR(255) NOT NULL,
                  plugin VARCHAR(255) NOT NULL,
                  title VARCHAR(255) NOT NULL,
                  url VARCHAR(255) NOT NULL,
                  icon VARCHAR(255),
                  \`order\` INT DEFAULT 0,
                  INDEX idx_guild_plugin (guildId, plugin)
              ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
          `);

          Logger.debug('Core-Plugin-Tabellen erstellt/aktualisiert');
          return true;
      } catch (err) {
          Logger.error('Fehler beim Registrieren der Core-Tabellen:', err);
          return false;
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

      // System-Status-Widget über den Filter registrieren
      pluginManager.hooks.addFilter('dashboard_widgets', (widgets) => {
          // Neues Widget zum Array hinzufügen
          widgets.push({
              id: 'system-status',
              title: 'System-Status',
              plugin: this.name,
              size: 'medium',
              icon: 'fa-solid fa-server',
              component: path.join(__dirname, '../views/widgets/system-status.ejs'),
              async getData(guildId) {
                  return {
                      uptime: process.uptime(),
                      memory: process.memoryUsage()
                  };
              }
          });
          
          return widgets;
      });

      Logger.debug('Core Plugin Widgets registriert');
  }
  
  /**
   * Guild-Sektionen registrieren
   */
  _registerAdminSections() {
    const Logger = ServiceManager.get('Logger');
    const pluginManager = ServiceManager.get('pluginManager');

    // Guild-Sektion für Core-Einstellungen registrieren
    pluginManager.hooks.registerGuildSection({
      id: 'core-settings',
      title: 'Kern-Einstellungen',
      plugin: this.name,
      icon: 'fa-solid fa-cog',
      component: path.join(__dirname, '../views/guild/settings.ejs'),
      order: 0
    });
  }
  
  /**
   * Registriert die Navigation für das Plugin
   * @private
   */
  _registerNavigation() {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');

    try {
        // Guild-Navigation (global)
        themeManager.registerNavigation({
            title: 'Dashboard',
            url: '/guild',
            icon: 'fa-solid fa-gauge-high',
            order_num: 10,
            plugin: this.name,
            type: 'main',
            visible: true
        });
        
        // Einstellungen
        themeManager.registerNavigation({
            title: 'Einstellungen',
            url: `/guild/plugins/${this.name}/settings`,
            icon: 'fa-solid fa-cog',
            order_num: 20,
            plugin: this.name,
            guildId: '*',
            type: 'main',
            visible: true
        });
        
        // Frontend-Navigation
        themeManager.registerNavigation({
            title: 'Home',
            url: '/',
            icon: 'fa-solid fa-home',
            order_num: 10,
            plugin: this.name,
            type: 'frontend',
            visible: true
        });

        Logger.debug('Core-Plugin Navigation registriert');
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
  onGuildEnable(guildId) {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');

      // Guild-spezifische Navigation
      this.registerNavigation('guild', {
          title: 'Server-Dashboard',
          url: `/guild/${guildId}`,
          icon: 'fa-solid fa-server',
          priority: 10,
          guildId
      });
      
      this.registerNavigation('guild', {
          title: 'Server-Einstellungen',
          url: `/guild/${guildId}/settings`,
          icon: 'fa-solid fa-sliders',
          priority: 20,
          guildId
      });
      
      Logger.debug(`Core-Plugin Navigation für Guild ${guildId} registriert`);
  }

  /**
   * Navigation hinzufügen
   */
  async addNavItem(data) {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    try {
      const guildId = data.guildId || '*';
      // Prüfen, ob der Eintrag bereits existiert
      const [existingItem] = await dbService.query(
        "SELECT * FROM nav_items WHERE guildId = ? AND plugin = ? AND url = ? LIMIT 1",
        [guildId, this.name, data.url]
      );
      if (existingItem) return existingItem;
      // Neuen Eintrag erstellen
      await dbService.query(
        "INSERT INTO nav_items (guildId, plugin, title, url, icon, `order`) VALUES (?, ?, ?, ?, ?, ?)",
        [guildId, this.name, data.title, data.url, data.icon || null, data.order || 0]
      );
      // Optional: Das neu eingefügte Item zurückgeben
      const [newItem] = await dbService.query(
        "SELECT * FROM nav_items WHERE guildId = ? AND plugin = ? AND url = ? LIMIT 1",
        [guildId, this.name, data.url]
      );
      return newItem;
    } catch (err) {
      Logger.error(`Fehler beim Hinzufügen der Navigation:`, err);
      return null;
    }
  }
  
  /**
   * Plugin-Konfiguration abrufen
   * @returns {Promise<Object>} Die Konfiguration des Plugins
   * @author firedervil
   */
  async getConfig() {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    try {
      const configs = await dbService.query(
        "SELECT * FROM configs WHERE plugin_name = ?",
        [this.name]
      );
      const config = {};
      config.ENABLED_PLUGINS = ['core'];
      for (const entry of configs) {
        try {
          config[entry.config_key] = JSON.parse(entry.config_value);
        } catch (e) {
          config[entry.config_key] = entry.config_value;
        }
      }
      Logger.debug(`Konfiguration für Plugin ${this.name} geladen:`, config);
      return config;
    } catch (error) {
      Logger.error('Fehler beim Laden der Config:', error);
      return { ENABLED_PLUGINS: ['core'] };
    }
  }
}
module.exports = CoreDashboardPlugin;