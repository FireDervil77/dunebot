const { DashboardPlugin } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

const path = require('path');

class DuneMapPlugin extends DashboardPlugin {
    constructor(app) {
        super({
            name: 'dunemap',
            displayName: 'DuneMap Plugin',
            description: 'Das lägendäre dunemap plugin',
            version: '1.0.0',
            author: 'DuneBot Team',
            icon: 'fa-solid fa-cog',
            baseDir: __dirname
        });
        
        this.app = app;
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
     * Plugin deaktivieren und Tabellen entfernen
     */
    async onDisable() {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        
        try {
            Logger.info('Deaktiviere DuneMap Plugin und entferne Tabellen...');
            
            // Tabellen in umgekehrter Reihenfolge löschen (wegen Foreign Keys)
            await dbService.query('DROP TABLE IF EXISTS dunemap_storm_timer');
            await dbService.query('DROP TABLE IF EXISTS dunemap_markers');
            
            Logger.success('DuneMap Tabellen erfolgreich entfernt');
            return true;
        } catch (error) {
            Logger.error('Fehler beim Entfernen der DuneMap Tabellen:', error);
            throw error;
        }
    }
    
    async onGuildEnable(guildId){

        // Register DuneMap Navigation
        this._registerNavigation(guildId);

        // Dashboard Routes
        //this.registerDashboardRoutes();

        // DB Models registrieren
        //await this.registerModel(require('./models/Markers'));
        //await this.registerModel(require('./models/StormTimer'));
    }
    
    /**
     * Registriert guild-spezifische Navigation
     * Wird aufgerufen, wenn das Plugin in einer Guild aktiviert wird
     * @param {string} guildId - Discord Guild ID
     */
    async onGuildEnable(guildId) {
        const Logger = ServiceManager.get('Logger');
        Logger.debug(`Registriere Navigation für dunemap in Guild ${guildId}`);
        await this._registerNavigation(guildId);

        // Dashboard Routes
        Logger.debug(`Registriere Routen für dunemap in Guild ${guildId}`);
        this.registerDashboardRoutes();

        // DB Models registrieren
        Logger.debug(`Registriere Models für dunemap in Guild ${guildId}`);
        await this.registerModel(require('./models/Marker'));
        await this.registerModel(require('./models/StormTimer'));
    }

    /**
     * Wird aufgerufen, wenn das Plugin in einer Guild deaktiviert wird
     * Entfernt guild-spezifische Daten
     * @param {string} guildId - Discord Guild ID
     */
    async onGuildDisable(guildId) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        const navigationManager = ServiceManager.get('navigationManager');
        
        try {
            Logger.info(`Deaktiviere DuneMap Plugin für Guild ${guildId}...`);
            
            // Navigation entfernen
            await navigationManager.unregisterNavigation(this.name, guildId);
            
            // Guild-spezifische Daten löschen
            await dbService.query('DELETE FROM dunemap_storm_timer WHERE guild_id = ?', [guildId]);
            await dbService.query('DELETE FROM dunemap_markers WHERE guild_id = ?', [guildId]);
            
            // Configs löschen
            await dbService.query(
                'DELETE FROM configs WHERE plugin_name = ? AND guild_id = ?',
                [this.name, guildId]
            );
            
            Logger.success(`DuneMap Daten für Guild ${guildId} erfolgreich entfernt`);
            return true;
        } catch (error) {
            Logger.error(`Fehler beim Entfernen der DuneMap Daten für Guild ${guildId}:`, error);
            throw error;
        }
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
                    title: 'DuneMap',
                    path: '/plugins/dunemap',
                    icon: 'fa-solid fa-map',
                    order: 50,
                    type: 'main',
                    visible: true
                },
                {
                    title: 'Karte',
                    path: '/plugins/dunemap/map',
                    icon: 'fa-solid fa-map-marked',
                    order: 51,
                    parent: '/plugins/dunemap',
                    type: 'main',
                    visible: true
                },
                {
                    title: 'Einstellungen',  
                    path: '/plugins/dunemap/settings',
                    icon: 'fa-solid fa-cogs',
                    order: 52,
                    parent: '/plugins/dunemap',
                    type: 'main',
                    visible: true
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
        
        Logger.debug('Core Plugin Widgets registriert');
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
        
}

module.exports = DuneMapPlugin;