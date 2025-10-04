const express = require('express');
const { DashboardPlugin } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

/**
 * Beispiel-Plugin: Navigation & Routen Best Practice
 * 
 * Zeigt alle 3 Arten von Navigation-Integration:
 * 1. Eigener Hauptmenü-Punkt
 * 2. Untermenü zu bestehendem Menü
 * 3. Settings-Page unter Einstellungen
 * 
 * @author FireDervil
 */
class ExampleNavigationPlugin extends DashboardPlugin {
    constructor(app) {
        super({
            name: 'example-navigation',
            displayName: 'Navigation Beispiel',
            description: 'Zeigt wie man Navigation und Routen richtig integriert',
            version: '1.0.0',
            author: 'FireDervil',
            icon: 'fa-solid fa-map',
            baseDir: __dirname
        });
        
        this.app = app;
        this.guildRouter = express.Router();
        this._setupRoutes();
    }

    /**
     * Routen für das Plugin einrichten
     * Alle Routen sind automatisch unter /guild/:guildId/plugins/example-navigation verfügbar
     */
    _setupRoutes() {
        const Logger = ServiceManager.get('Logger');
        const themeManager = ServiceManager.get('themeManager');

        // Route: /guild/:guildId/plugins/example-navigation/dashboard
        this.guildRouter.get('/dashboard', async (req, res) => {
            await themeManager.renderView(res, 'dashboard', {
                title: 'Navigation Beispiel - Dashboard',
                guildId: req.params.guildId,
                plugin: this
            });
        });

        // Route: /guild/:guildId/plugins/example-navigation/settings
        this.guildRouter.get('/settings', async (req, res) => {
            await themeManager.renderView(res, 'settings', {
                title: 'Navigation Beispiel - Einstellungen',
                guildId: req.params.guildId,
                plugin: this
            });
        });

        // Route: /guild/:guildId/plugins/example-navigation/analytics
        this.guildRouter.get('/analytics', async (req, res) => {
            await themeManager.renderView(res, 'analytics', {
                title: 'Analytics',
                guildId: req.params.guildId,
                plugin: this
            });
        });

        Logger.debug('Example Navigation Plugin Routen eingerichtet');
    }

    /**
     * Plugin aktivieren (Dashboard-weit)
     */
    async enable() {
        const Logger = ServiceManager.get('Logger');
        Logger.info('Example Navigation Plugin aktiviert');
        return true;
    }

    /**
     * Plugin für eine Guild aktivieren
     * HIER wird die Navigation registriert!
     * 
     * @param {string} guildId - Discord Guild ID
     */
    async onGuildEnable(guildId) {
        const Logger = ServiceManager.get('Logger');
        const navigationManager = ServiceManager.get('navigationManager');
        
        Logger.info(`Example Navigation Plugin für Guild ${guildId} aktivieren`);
        
        try {
            // ========================================
            // VARIANTE 1: Eigenes Hauptmenü mit Submenü
            // ========================================
            await navigationManager.registerNavigation(this.name, guildId, [
                // Hauptmenü-Punkt
                {
                    title: 'Mein Plugin',
                    url: `/guild/${guildId}/plugins/example-navigation/dashboard`,
                    icon: 'fa-solid fa-map',
                    order: 60,  // Zwischen Plugins (30) und Übersetzungen (40)
                    parent: null,  // Kein Parent = Hauptmenü
                    type: 'main',
                    visible: true
                },
                // Untermenü-Punkt 1
                {
                    title: 'Analytics',
                    url: `/guild/${guildId}/plugins/example-navigation/analytics`,
                    icon: 'fa-solid fa-chart-line',
                    order: 61,
                    parent: `/guild/${guildId}/plugins/example-navigation/dashboard`,  // Parent URL!
                    type: 'main',
                    visible: true
                },
                // Untermenü-Punkt 2
                {
                    title: 'Logs',
                    url: `/guild/${guildId}/plugins/example-navigation/logs`,
                    icon: 'fa-solid fa-file-lines',
                    order: 62,
                    parent: `/guild/${guildId}/plugins/example-navigation/dashboard`,
                    type: 'main',
                    visible: true
                }
            ]);

            // ========================================
            // VARIANTE 2: Als Untermenü zu "Einstellungen"
            // ========================================
            await navigationManager.addSubmenu(
                this.name,
                guildId,
                `/guild/${guildId}/plugins/core/settings`,  // Parent = Core Settings
                {
                    title: 'Plugin-Einstellungen',
                    url: `/guild/${guildId}/plugins/example-navigation/settings`,
                    icon: 'fa-solid fa-puzzle-piece',
                    order: 24  // Zwischen anderen Settings-Submenüs
                }
            );

            // ========================================
            // VARIANTE 3: WordPress-Style Settings Page
            // ========================================
            // await navigationManager.addSettingsPage(
            //     this.name,
            //     guildId,
            //     {
            //         title: 'Mein Plugin',
            //         url: `/guild/${guildId}/plugins/example-navigation/settings`,
            //         icon: 'fa-solid fa-sliders'
            //     }
            // );

            Logger.success(`Navigation für Example Navigation Plugin in Guild ${guildId} registriert`);
        } catch (error) {
            Logger.error(`Fehler bei Navigation-Registrierung für Guild ${guildId}:`, error);
            throw error;
        }
    }

    /**
     * Plugin für eine Guild deaktivieren
     */
    async onGuildDisable(guildId) {
        const Logger = ServiceManager.get('Logger');
        const navigationManager = ServiceManager.get('navigationManager');
        
        // Navigation wird automatisch vom PluginManager entfernt
        // Hier kannst du zusätzliche Cleanup-Logik einfügen
        
        Logger.info(`Example Navigation Plugin für Guild ${guildId} deaktiviert`);
    }
}

module.exports = ExampleNavigationPlugin;
