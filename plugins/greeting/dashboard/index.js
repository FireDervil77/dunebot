/**
 * Greeting Plugin - Dashboard Integration
 * Verwaltet Willkommens-/Verabschiedungs-Nachrichten und Autoroles
 * 
 * @module greeting/dashboard
 * @author DuneBot Team
 */

const { DashboardPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

class GreetingDashboardPlugin extends DashboardPlugin {
    constructor() {
        super({
            name: 'greeting',
            displayName: 'Greeting Plugin',
            description: 'Willkommens- und Verabschiedungsnachrichten für neue/ausgetretene Member',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'DuneBot Team',
            icon: 'fa-solid fa-hand-wave',
            baseDir: __dirname,
            publicAssets: true
        });
        
        this.guildRouter = require('express').Router();
        this.baseRouter = require('express').Router();
    }

    /**
     * Plugin aktivieren (System-weit)
     * Wird nur EINMAL beim Dashboard-Start aufgerufen
     * 
     * @param {Object} app - Express App-Instanz
     * @param {Object} dbService - Datenbank-Service
     */
    async onEnable(app, dbService) {
        const Logger = ServiceManager.get('Logger');
        Logger.info('Aktiviere Greeting Dashboard-Plugin...');

        this.app = app;
        this._setupRoutes();
        this._registerHooks();
        
        Logger.success('Greeting Dashboard-Plugin aktiviert');
        return true;
    }

    /**
     * Plugin deaktivieren (System-weit)
     */
    async onDisable() {
        const Logger = ServiceManager.get('Logger');
        Logger.info('Deaktiviere Greeting Plugin...');
        // Cleanup bei Bedarf
        return true;
    }

    /**
     * Routen einrichten
     * Unterscheidet zwischen Base-Level (selten) und Guild-Level (häufig)
     * 
     * @private
     */
    _setupRoutes() {
        const Logger = ServiceManager.get('Logger');
        
        try {
            // === BASE-LEVEL ROUTES (System-weit, selten genutzt) ===
            const baseRouter = require('./routes/settings.router');
            this.baseRouter.use('/', baseRouter);
            
            // === GUILD-LEVEL ROUTES (Per-Guild, häufig genutzt) ===
            const guildRouter = require('./routes/guild.router');
            this.guildRouter.use('/', guildRouter);
            
            Logger.debug('[Greeting] Routen registriert (Base + Guild)');
        } catch (error) {
            Logger.error('[Greeting] Fehler beim Einrichten der Routen:', error);
            throw error;
        }
    }

    /**
     * Hooks registrieren (falls benötigt)
     * @private
     */
    _registerHooks() {
        const Logger = ServiceManager.get('Logger');
        // Derzeit keine Hooks benötigt
        Logger.debug('[Greeting] Hooks registriert');
    }

    /**
     * Guild-spezifische Aktivierung
     * Wird aufgerufen, wenn Plugin in einer Guild aktiviert wird
     * 
     * @param {string} guildId - Discord Guild ID
     */
    async onGuildEnable(guildId) {
        const Logger = ServiceManager.get('Logger');
        Logger.debug(`[Greeting] Registriere Navigation für Guild ${guildId}`);
        await this._registerNavigation(guildId);
    }

    /**
     * Guild-spezifische Deaktivierung
     * Entfernt guild-spezifische Daten
     * 
     * @param {string} guildId - Discord Guild ID
     */
    async onGuildDisable(guildId) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        const navigationManager = ServiceManager.get('navigationManager');
        
        try {
            Logger.info(`[Greeting] Deaktiviere Plugin für Guild ${guildId}...`);
            
            // Navigation entfernen
            await navigationManager.removeNavigation(this.name, guildId);
            
            // Guild-spezifische Daten löschen
            await dbService.query('DELETE FROM greeting_settings WHERE guild_id = ?', [guildId]);
            
            Logger.success(`[Greeting] Daten für Guild ${guildId} entfernt`);
            return true;
        } catch (error) {
            Logger.error(`[Greeting] Fehler beim Deaktivieren für Guild ${guildId}:`, error);
            throw error;
        }
    }

    /**
     * Navigation für das Plugin registrieren
     * @private
     * @param {string} guildId - Discord Guild ID
     */
    async _registerNavigation(guildId) {
        const Logger = ServiceManager.get('Logger');
        const navigationManager = ServiceManager.get('navigationManager');

        const navItems = [
            {
                title: 'greeting:NAV.GREETING',
                path: `/guild/${guildId}/plugins/greeting/settings`,
                icon: 'fa-solid fa-hands',
                order: 25,  // Nach Core-Settings und DuneMap
                parent: `/guild/${guildId}/plugins/core/settings`,
                type: 'main',
                visible: true,
                capability: 'GREETING.SETTINGS'
            }
        ];

        try {
            await navigationManager.registerNavigation(this.name, guildId, navItems);
            Logger.debug('[Greeting] Navigation registriert (unter Core-Settings)');
        } catch (error) {
            Logger.error('[Greeting] Fehler beim Registrieren der Navigation:', error);
        }
    }
}

module.exports = GreetingDashboardPlugin;
