const { DashboardPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');
const path = require('path');

class TicketPlugin extends DashboardPlugin {
    constructor(app) {
        super({
            name: 'ticket',
            displayName: 'Ticket Plugin',
            description: 'Das Ticket Plugin für FireBot',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
            icon: 'fa-solid fa-shield-halved',
            baseDir: __dirname,
            ownerOnly: false,
            publicAssets: true
        });
        
    this.app = app;
    // mergeParams stellt sicher, dass :guildId und :pluginName aus dem Parent-Router verfügbar sind
    this.guildRouter = require('express').Router({ mergeParams: true });
    }

    async onEnable(app, dbService) {
        const Logger = ServiceManager.get('Logger');
        Logger.info('Aktiviere [Ticket] Dashboard-Plugin...');

        this._setupRoutes();
        this._registerHooks();
        this._registerWidgets();
        this._registerShortcodes();
        this._registerAssets();
        
        Logger.success('[Ticket] Dashboard-Plugin aktiviert');
        return true;
    }

    _registerAssets() {
        const Logger = ServiceManager.get('Logger');
        Logger.debug('[Ticket] Assets registriert');
    }

    _setupRoutes() {
        const Logger = ServiceManager.get('Logger');
        const themeManager = ServiceManager.get('themeManager');
        const dbService = ServiceManager.get('dbService');
        const ipcServer = ServiceManager.get('ipcServer');

    }

    async onDisable() {
        const Logger = ServiceManager.get('Logger');
        Logger.info('Deaktiviere [Ticket] Plugin...');
        // Hier können Bereinigungsaktionen für das Plugin durchgeführt werden
        
        Logger.success('[Ticket] Plugin deaktiviert');
        return true;
    }
    
    async onGuildEnable(guildId) {
        const Logger = ServiceManager.get('Logger');
        Logger.debug(`Registriere Navigation für [Ticket] in Guild ${guildId}`);
        await this._registerNavigation(guildId);

    }

    async onGuildDisable(guildId) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        
        try {
            Logger.info(`Entferne Navigation für [Ticket] aus Guild ${guildId}`);
            await dbService.query("DELETE FROM nav_items WHERE plugin = ? AND guildId = ?", [this.name, guildId]);
            Logger.success(`[Ticket] Navigation für Guild ${guildId} entfernt`);
            return true;
        } catch (error) {
            Logger.error(`Fehler beim Entfernen der [Ticket] Navigation für Guild ${guildId}:`, error);
            throw error;
        }
    }

    async _registerNavigation(guildId) {
        const Logger = ServiceManager.get('Logger');
        const navigationManager = ServiceManager.get('navigationManager');

        /*
        // Beispiel CONTENT
        const navItems = [{
            title: 'moderation:NAV.MODERATION',
            path: `/guild/${guildId}/plugins/moderation`,
            icon: 'fa-solid fa-shield-halved',
            order: 24,
            parent: `/guild/${guildId}/plugins/core/settings`,
            type: 'main',
            visible: true
        }];
        */
        try {
            await navigationManager.registerNavigation(this.name, guildId, navItems);
            Logger.debug('[Ticket] Navigation registriert');
        } catch (error) {
            Logger.error('[Ticket] Fehler beim Registrieren der Navigation:', error);
        }
    }

    _registerHooks() {
        const Logger = ServiceManager.get('Logger');
        Logger.debug('[Ticket] Hooks registriert');
    }

    _registerWidgets() {
        const Logger = ServiceManager.get('Logger');
        Logger.debug('[Ticket] Widgets registriert');
    }

    _registerShortcodes() {
        const Logger = ServiceManager.get('Logger');
        Logger.debug('[Ticket] Shortcodes registriert');
    }
}

module.exports = TicketPlugin;