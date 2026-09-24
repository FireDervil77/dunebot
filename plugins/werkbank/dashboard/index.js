/**
 * Werkbank — Dashboard-Plugin (Stufe 1, 2026-09-24).
 *
 * Abgestimmt mit dem Betreiber: Guild-Plugin mit eigenen Rechten `WERKBANK.*`,
 * vorerst nur in der Kontroll-Guild eingeschaltet (W-2 „vorerst nur wir");
 * die Übersicht ALLER Sitzungen kommt später unter /admin (W-4, Stufe 5).
 *
 * Diese Datei kümmert sich nur um den Lebenszyklus — nach dem Vorbild von
 * `discord`: Router in `routes/`, Daten in `helpers/Sitzungen.js`, Ereignisse
 * des Daemons in `helpers/Ereignisse.js`.
 *
 * @author FireBot Team
 */

const { DashboardPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

class WerkbankPlugin extends DashboardPlugin {
    constructor(app) {
        super({
            name: 'werkbank',
            displayName: 'Werkbank',
            description: 'Spielpakete bauen: Schritte ausprobieren, starten, prüfen, veröffentlichen',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
            icon: 'fa-solid fa-screwdriver-wrench',
            baseDir: __dirname
        });
        this.app = app;
        this.guildRouter = require('express').Router();
    }

    async onEnable(app, dbService) {
        const Logger = ServiceManager.get('Logger');
        Logger.info('Aktiviere [Werkbank] Dashboard-Plugin...');
        this.guildRouter.use('/', require('./routes/guild.router'));
        // Die Ereignisse gehören dem Prozess, nicht einer Guild: Ein Schritt
        // meldet sich, egal wer gerade zusieht.
        require('./helpers/Ereignisse').anmelden();
        Logger.success('[Werkbank] Dashboard-Plugin aktiviert');
        return true;
    }

    async onDisable() {
        ServiceManager.get('Logger').info('[Werkbank] Dashboard-Plugin deaktiviert');
        return true;
    }

    async onGuildEnable(guildId) {
        await this._registerNavigation(guildId);
        ServiceManager.get('Logger').info(`[Werkbank] Plugin für Guild ${guildId} aktiviert`);
    }

    async onGuildDisable(guildId) {
        const navigationManager = ServiceManager.get('navigationManager');
        await navigationManager.removeNavigation(this.name, guildId);
        return true;
    }

    /**
     * Navigation: ein Punkt, direkt unter dem Gameserver (4500) — Maschinen,
     * Server, Werkbank gehören zusammen. 4750 war frei (nachgesehen:
     * dunemap 3500 … ticket 8500 in 500er-Schritten).
     *
     * Vorher entfernen: `registerNavigation` überspringt vorhandene Einträge,
     * löscht aber nie.
     *
     * @private
     */
    async _registerNavigation(guildId) {
        const Logger = ServiceManager.get('Logger');
        const navigationManager = ServiceManager.get('navigationManager');
        const navItems = [{
            title: 'werkbank:NAV.WERKBANK',
            url: `/guild/${guildId}/plugins/werkbank`,
            icon: 'fa-solid fa-screwdriver-wrench',
            order: 4750,
            type: navigationManager.menuTypes.MAIN,
            capability: 'WERKBANK.VIEW',
            visible: true,
            guildId,
            parent: null
        }];
        try {
            await navigationManager.removeNavigation(this.name, guildId);
            await navigationManager.registerNavigation(this.name, guildId, navItems);
        } catch (error) {
            Logger.error('[Werkbank] Fehler beim Registrieren der Navigation:', error);
        }
    }
}

module.exports = WerkbankPlugin;
