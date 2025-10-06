const path = require('path');
const express = require('express');
const { DashboardPlugin } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

/**
 * Template-Plugin für das Dashboard
 * 
 * ANLEITUNG:
 * 1. Ersetzen Sie 'template' durch den Namen Ihres Plugins
 * 2. Passen Sie Routen in _setupRoutes() an
 * 3. Registrieren Sie Widgets in _registerWidgets()
 * 4. Fügen Sie Navigation in onGuildEnable() hinzu
 * 5. Erstellen Sie Views in dashboard/views/
 * 
 * @extends {DashboardPlugin}
 * @author DuneBot Team
 */
class TemplateDashboardPlugin extends DashboardPlugin {
    constructor(app) {
        super({
            name: 'template',
            displayName: 'Template Plugin',
            description: 'Ein Beispiel-Plugin für das DuneBot Dashboard',
            version: '1.0.0',
            author: 'Ihr Name',
            icon: 'fa-solid fa-puzzle-piece',
            baseDir: __dirname
        });
        
        this.app = app;
    }

    /**
     * Plugin aktivieren
     * Wird beim Laden des Plugins aufgerufen
     * 
     * @returns {Promise<boolean>}
     */
    async enable() {
        const Logger = ServiceManager.get('Logger');
        Logger.info('Aktiviere Template Dashboard-Plugin...');
        
        // Router initialisieren
        this.guildRouter = express.Router();
        
        // Plugin-Komponenten einrichten
        this._setupRoutes();
        this._registerWidgets();
        this._registerHooks();
        
        Logger.success('Template Dashboard-Plugin aktiviert');
        return true;
    }

    /**
     * Plugin deaktivieren
     * Wird beim Deaktivieren des Plugins aufgerufen
     * 
     * @returns {Promise<boolean>}
     */
    async disable() {
        const Logger = ServiceManager.get('Logger');
        Logger.info('Deaktiviere Template Dashboard-Plugin...');
        
        // Aufräumarbeiten durchführen
        // z.B. Listener entfernen, Timer stoppen
        
        Logger.success('Template Dashboard-Plugin deaktiviert');
        return true;
    }

    /**
     * Routen für das Plugin einrichten
     * 
     * @private
     */
    _setupRoutes() {
        const Logger = ServiceManager.get('Logger');
        const themeManager = ServiceManager.get('themeManager');
        
        // Haupt-Route: Plugin-Dashboard
        this.guildRouter.get('/', async (req, res) => {
            const guildId = res.locals.guildId;
            const dbService = ServiceManager.get('dbService');
            
            try {
                // Beispiel: Daten aus der Datenbank laden
                const [stats] = await dbService.query(
                    'SELECT * FROM template_stats WHERE guild_id = ?',
                    [guildId]
                );
                
                // Beispiel: IPC-Call zum Bot
                const ipcClient = ServiceManager.get('ipcClient');
                const botStats = await ipcClient.sendTo('Bot #0', {
                    action: 'template:GET_STATS',
                    guildId
                });
                
                res.render('index', {
                    title: req.translate('template:PAGE.TITLE'),
                    stats: stats || {},
                    botStats: botStats?.stats || {},
                    layout: themeManager.getLayout('guild')
                });
            } catch (error) {
                Logger.error('[Template] Fehler beim Laden der Dashboard-Seite:', error);
                res.status(500).render('error', {
                    message: req.translate('template:ERROR.LOAD_FAILED')
                });
            }
        });

        // Einstellungen-Route
        this.guildRouter.get('/settings', async (req, res) => {
            const guildId = res.locals.guildId;
            const dbService = ServiceManager.get('dbService');
            
            try {
                // Lade Plugin-Konfiguration
                const config = {
                    enabled: await dbService.getConfig('template', 'enabled', 'dashboard', guildId) || true,
                    notificationChannel: await dbService.getConfig('template', 'notificationChannel', 'dashboard', guildId),
                    logLevel: await dbService.getConfig('template', 'logLevel', 'dashboard', guildId) || 'info'
                };
                
                res.render('settings', {
                    title: req.translate('template:SETTINGS.TITLE'),
                    config,
                    layout: themeManager.getLayout('guild')
                });
            } catch (error) {
                Logger.error('[Template] Fehler beim Laden der Einstellungen:', error);
                res.status(500).json({ error: 'Failed to load settings' });
            }
        });

        // POST: Einstellungen speichern
        this.guildRouter.post('/settings', async (req, res) => {
            const guildId = res.locals.guildId;
            const dbService = ServiceManager.get('dbService');
            const { enabled, notificationChannel, logLevel } = req.body;
            
            try {
                // Konfiguration speichern
                await dbService.setConfig('template', 'enabled', enabled === 'on', 'dashboard', guildId);
                await dbService.setConfig('template', 'notificationChannel', notificationChannel, 'dashboard', guildId);
                await dbService.setConfig('template', 'logLevel', logLevel, 'dashboard', guildId);
                
                res.json({
                    success: true,
                    message: req.translate('template:SUCCESS.SETTINGS_SAVED')
                });
            } catch (error) {
                Logger.error('[Template] Fehler beim Speichern der Einstellungen:', error);
                res.status(500).json({
                    success: false,
                    error: req.translate('template:ERROR.SAVE_FAILED')
                });
            }
        });

        Logger.debug('[Template] Routen eingerichtet');
    }

    /**
     * Widgets für das Dashboard registrieren
     * 
     * @private
     */
    _registerWidgets() {
        const Logger = ServiceManager.get('Logger');
        const hooks = ServiceManager.get('hooks');
        
        // Widget für Guild-Dashboard registrieren
        hooks.addFilter('guild_dashboard_widgets', (widgets, guildId) => {
            widgets.push({
                id: 'template-stats',
                title: 'Template Statistiken',
                view: 'widgets/stats',
                plugin: 'template',
                order: 100,
                width: 6  // Bootstrap col-md-6
            });
            
            widgets.push({
                id: 'template-recent',
                title: 'Letzte Aktivitäten',
                view: 'widgets/recentActivity',
                plugin: 'template',
                order: 101,
                width: 6
            });
            
            return widgets;
        });
        
        Logger.debug('[Template] Widgets registriert');
    }

    /**
     * Hooks für das Plugin registrieren
     * 
     * @private
     */
    _registerHooks() {
        const Logger = ServiceManager.get('Logger');
        const hooks = ServiceManager.get('hooks');
        
        // Beispiel: Action Hook
        hooks.addAction('plugin_settings_updated', async (pluginName, guildId) => {
            if (pluginName === 'template') {
                Logger.debug(`[Template] Einstellungen für Guild ${guildId} wurden aktualisiert`);
                // Zusätzliche Aktionen durchführen
            }
        });
        
        // Beispiel: Filter Hook
        hooks.addFilter('dashboard_navigation', (navigation, guildId) => {
            // Navigation kann hier modifiziert werden
            return navigation;
        });
        
        Logger.debug('[Template] Hooks registriert');
    }

    /**
     * Wird aufgerufen wenn das Plugin für eine Guild aktiviert wird
     * 
     * @param {string} guildId - Guild ID
     * @returns {Promise<void>}
     */
    async onGuildEnable(guildId) {
        const Logger = ServiceManager.get('Logger');
        Logger.info(`[Template] Aktiviere Plugin für Guild ${guildId}`);
        
        try {
            // Navigation registrieren
            await this._registerNavigation(guildId);
            
            // Standardkonfiguration erstellen
            const dbService = ServiceManager.get('dbService');
            await dbService.setConfig('template', 'enabled', true, 'dashboard', guildId);
            await dbService.setConfig('template', 'logLevel', 'info', 'dashboard', guildId);
            
            // Statistik-Eintrag erstellen
            await dbService.query(
                'INSERT IGNORE INTO template_stats (guild_id, total_uses) VALUES (?, 0)',
                [guildId]
            );
            
            Logger.success(`[Template] Plugin für Guild ${guildId} aktiviert`);
        } catch (error) {
            Logger.error(`[Template] Fehler beim Aktivieren für Guild ${guildId}:`, error);
            throw error;
        }
    }

    /**
     * Navigation für das Plugin registrieren
     * 
     * @param {string} guildId - Guild ID
     * @returns {Promise<void>}
     * @private
     */
    async _registerNavigation(guildId) {
        const navigationManager = ServiceManager.get('navigationManager');
        
        const navItems = [
            {
                plugin: 'template',
                guildId,
                title: 'Template',
                url: '/guild/:guildId/template',
                icon: 'fa-solid fa-puzzle-piece',
                sort_order: 50,
                parent: null,
                type: 'link',
                capability: 'MANAGE_GUILD',
                visible: true,
                position: 'main'
            },
            {
                plugin: 'template',
                guildId,
                title: 'Einstellungen',
                url: '/guild/:guildId/template/settings',
                icon: 'fa-solid fa-cog',
                sort_order: 51,
                parent: 'template',
                type: 'link',
                capability: 'MANAGE_GUILD',
                visible: true,
                position: 'main'
            }
        ];
        
        for (const item of navItems) {
            await navigationManager.registerNavigation(item);
        }
    }

    /**
     * Wird aufgerufen wenn das Plugin für eine Guild deaktiviert wird
     * 
     * @param {string} guildId - Guild ID
     * @returns {Promise<void>}
     */
    async onGuildDisable(guildId) {
        const Logger = ServiceManager.get('Logger');
        Logger.info(`[Template] Deaktiviere Plugin für Guild ${guildId}`);
        
        // Optional: Daten löschen oder archivieren
        // const dbService = ServiceManager.get('dbService');
        // await dbService.query('DELETE FROM template_data WHERE guild_id = ?', [guildId]);
        
        Logger.success(`[Template] Plugin für Guild ${guildId} deaktiviert`);
    }
}

module.exports = TemplateDashboardPlugin;
