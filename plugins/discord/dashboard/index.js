/**
 * Discord — Dashboard-Plugin
 *
 * Angelegt am 2026-08-09. Rollen und Kanäle standen bis dahin im Kern unter
 * „Einstellungen" — zwischen Schaltern, die das Verhalten unseres Bots regeln.
 * Sie gehören dort nicht hin: beide Seiten haben keine eigene Datenhaltung,
 * sie spiegeln Discord live über IPC und schreiben dorthin zurück. Es ist die
 * einzige Stelle im Dashboard, an der man Discord selbst anfasst.
 *
 * Aufbau nach dem Vorbild von `automod` nach dessen Umbau: ein eigener
 * Navigationsbereich mit Unterseiten, Router getrennt in `routes/`, diese
 * Datei kümmert sich nur um den Lebenszyklus.
 *
 * **Anders als bei automod bleibt kein Eintrag unter „Einstellungen" stehen.**
 * Bei den übrigen Plugins hängt dort bewusst die Einstellungsseite. Rollen und
 * Kanäle sind keine Einstellungen und ziehen vollständig um.
 *
 * @author FireBot Team
 */

const { DashboardPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

class DiscordPlugin extends DashboardPlugin {
    constructor(app) {
        super({
            name: 'discord',
            displayName: 'Discord',
            description: 'Direkter Zugriff auf Discord: Rollen anlegen und ändern, Kanäle einsehen',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
            icon: 'fa-brands fa-discord',
            baseDir: __dirname,
            publicAssets: false
        });

        this.app = app;
        this.guildRouter = require('express').Router();
    }

    /**
     * Plugin aktivieren — wird vom PluginManager aufgerufen.
     *
     * @param {Object} app Express-App
     * @param {Object} dbService Datenbank-Dienst
     */
    async onEnable(app, dbService) {
        const Logger = ServiceManager.get('Logger');
        Logger.info('Aktiviere [Discord] Dashboard-Plugin...');

        this._setupRoutes();

        Logger.success('[Discord] Dashboard-Plugin aktiviert');
        return true;
    }

    /**
     * Router einhängen.
     *
     * Der Seiten-Router zuletzt: er fängt mit '/' auch die Startseite ab.
     *
     * @private
     */
    _setupRoutes() {
        const Logger = ServiceManager.get('Logger');

        this.guildRouter.use('/roles', require('./routes/roles.router'));
        this.guildRouter.use('/channels', require('./routes/channels.router'));
        this.guildRouter.use('/', require('./routes/guild.router'));

        Logger.info('[Discord] Routen registriert (3 Router)');
    }

    /**
     * Plugin deaktivieren.
     */
    async onDisable() {
        ServiceManager.get('Logger').info('[Discord] Dashboard-Plugin deaktiviert');
        return true;
    }

    /**
     * Plugin in einer Guild aktivieren.
     *
     * @param {string} guildId Discord-Guild-ID
     */
    async onGuildEnable(guildId) {
        const Logger = ServiceManager.get('Logger');
        await this._registerNavigation(guildId);
        Logger.info(`[Discord] Plugin für Guild ${guildId} aktiviert`);
    }

    /**
     * Plugin in einer Guild deaktivieren.
     *
     * @param {string} guildId Discord-Guild-ID
     */
    async onGuildDisable(guildId) {
        const Logger = ServiceManager.get('Logger');
        const navigationManager = ServiceManager.get('navigationManager');

        try {
            await navigationManager.removeNavigation(this.name, guildId);
            Logger.success(`[Discord] Navigation für Guild ${guildId} entfernt`);
            return true;
        } catch (error) {
            Logger.error(`[Discord] Fehler beim Aufräumen für Guild ${guildId}:`, error);
            throw error;
        }
    }

    /**
     * Navigation registrieren.
     *
     * Läuft bei jedem Start des Dashboards: `enableGuildSpecificPlugins()` geht
     * über alle Guilds und ruft für jedes eingeschaltete Plugin `enableInGuild`
     * auf, das wiederum `onGuildEnable` aufruft.
     *
     * Vor dem Anlegen wird die eigene Navigation ausdrücklich entfernt —
     * `registerNavigation` überspringt vorhandene Einträge, löscht aber nie.
     * Die **alten Kern-Einträge** (NAV.ROLES und NAV.CHANNELS unter
     * `/settings`) räumt die Migration `20260809_..._rollen_kanaele_ins_discord_plugin`
     * einmalig weg; von hier aus ist das nicht erreichbar, weil sie unter dem
     * Plugin-Namen `core` stehen.
     *
     * @param {string} guildId Discord-Guild-ID
     * @private
     */
    async _registerNavigation(guildId) {
        const Logger = ServiceManager.get('Logger');
        const navigationManager = ServiceManager.get('navigationManager');

        const basis = `/guild/${guildId}/plugins/discord`;
        const haupt = navigationManager.menuTypes.MAIN;

        const navItems = [
            {
                title: 'discord:NAV.DISCORD',
                url: basis,
                icon: 'fa-brands fa-discord',
                order: null,
                type: haupt,
                capability: 'DISCORD.VIEW',
                visible: true,
                guildId,
                parent: null
            },
            {
                title: 'discord:NAV.ROLES',
                url: `${basis}/roles`,
                icon: 'fa-solid fa-shield-halved',
                order: 10,
                type: haupt,
                capability: 'DISCORD.ROLES.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'discord:NAV.CHANNELS',
                url: `${basis}/channels`,
                icon: 'fa-solid fa-hashtag',
                order: 20,
                type: haupt,
                capability: 'DISCORD.CHANNELS.VIEW',
                visible: true,
                guildId,
                parent: basis
            }
        ];

        try {
            await navigationManager.removeNavigation(this.name, guildId);
            await navigationManager.registerNavigation(this.name, guildId, navItems);
            Logger.debug(`[Discord] Navigation registriert (${navItems.length} Einträge)`);
        } catch (error) {
            Logger.error('[Discord] Fehler beim Registrieren der Navigation:', error);
        }
    }
}

module.exports = DiscordPlugin;
