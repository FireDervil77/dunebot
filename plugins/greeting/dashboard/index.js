/**
 * Greeting Plugin - Dashboard Integration
 * Verwaltet Willkommens-/Verabschiedungs-Nachrichten und Autoroles
 * 
 * @module greeting/dashboard
 * @author FireBot Team
 */

const { DashboardPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

class GreetingDashboardPlugin extends DashboardPlugin {
    constructor() {
        super({
            name: 'greeting',
            displayName: 'Greeting',
            description: 'Willkommens- und Verabschiedungsnachrichten für neue/ausgetretene Member',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
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
        this._registerAssets();
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
     * Skripte anmelden.
     *
     * `greeting-scripts` ist ein View-Partial und bleibt es - der Block haengt
     * eng an den Formularen. Angemeldet wird hier nur, was seitenweise dazu
     * kommt.
     *
     * @private
     */
    _registerAssets() {
        const assetManager = ServiceManager.get('assetManager');
        if (!assetManager) return;

        assetManager.registerScript('greeting-forms', 'js/greeting-forms.js', {
            plugin: 'greeting',
            deps: [],
            version: this.version,
            inFooter: true
        });
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

        const basis = `/guild/${guildId}/plugins/greeting`;
        const haupt = navigationManager.menuTypes.MAIN;

        const navItems = [
            {
                title: 'greeting:NAV.GREETING',
                url: basis,
                icon: 'fa-solid fa-hand-sparkles',
                order: null,
                type: haupt,
                capability: 'GREETING.VIEW',
                visible: true,
                guildId,
                parent: null
            },
            {
                title: 'greeting:NAV.DASHBOARD',
                url: `${basis}/dashboard`,
                icon: 'fa-solid fa-gauge-high',
                order: 10,
                type: haupt,
                capability: 'GREETING.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'greeting:NAV.MESSAGES',
                url: `${basis}/nachrichten`,
                icon: 'fa-solid fa-comment-dots',
                order: 20,
                type: haupt,
                capability: 'GREETING.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'greeting:NAV.ROLES',
                url: `${basis}/rollen`,
                icon: 'fa-solid fa-user-tag',
                order: 30,
                type: haupt,
                capability: 'GREETING.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'greeting:NAV.VERIFICATION',
                url: `${basis}/verifizierung`,
                icon: 'fa-solid fa-shield-halved',
                order: 40,
                type: haupt,
                capability: 'GREETING.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'greeting:NAV.BOOST',
                url: `${basis}/boost`,
                icon: 'fa-solid fa-rocket',
                order: 50,
                type: haupt,
                capability: 'GREETING.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'greeting:NAV.INVITES',
                url: `${basis}/einladungen`,
                icon: 'fa-solid fa-link',
                order: 60,
                type: haupt,
                capability: 'GREETING.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            // Einstellungsseite haengt unter den Kern-Einstellungen
            {
                title: 'greeting:NAV.GREETING',
                url: `${basis}/settings`,
                icon: 'fa-solid fa-hand-sparkles',
                order: null,
                type: haupt,
                capability: 'GREETING.VIEW',
                visible: true,
                guildId,
                parent: `/guild/${guildId}/settings`
            }
        ];

        try {
            // Erst aufraeumen: registerNavigation ueberspringt vorhandene
            // Eintraege, loescht aber nie - der alte Einzeleintrag stuende
            // sonst weiter neben dem neuen Bereich.
            await navigationManager.removeNavigation(this.name, guildId);
            await navigationManager.registerNavigation(this.name, guildId, navItems);
            Logger.debug(`[Greeting] Navigation registriert (${navItems.length} Eintraege)`);
        } catch (error) {
            Logger.error('[Greeting] Fehler beim Registrieren der Navigation:', error);
        }
    }
}

module.exports = GreetingDashboardPlugin;
