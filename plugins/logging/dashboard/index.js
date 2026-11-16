'use strict';

/**
 * Logging - Dashboard-Plugin (LG-1a, LG-1b Teil 1, K382, 2026-11-16).
 *
 * Stufe 1 bisher: eigene Navigation mit „Ereignisse“ (neueste zuerst, Filter
 * nach Kategorie, Schwere, Mitglied) und „Einstellungen“ (Kategorien und
 * Arten an/aus, Bots ausschließen, Fristen über den Kern-Teil G-05).
 * Startwerte beim Einschalten: eine Zeile in `log_einstellungen`; Kategorien
 * ohne Zeile folgen der Vorgabe aus `shared/katalog.js`.
 *
 * Gelöscht wird beim Abschalten vom Kern: Tabellen nach `guildInhalte`.
 *
 * @author FireBot Team
 */

const { DashboardPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

class LoggingDashboardPlugin extends DashboardPlugin {
    constructor() {
        super({
            name: 'logging',
            displayName: 'Logging',
            description: 'Protokoll der Guild: Discord-Ereignisse und Fachereignisse der Plugins',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
            icon: 'fa-solid fa-clipboard-list',
            baseDir: __dirname,
            ownerOnly: false
        });

        this.guildRouter = require('express').Router({ mergeParams: true });
    }

    async onEnable(app) {
        this.app = app;
        this.guildRouter.use('/', require('./routes/guild.router'));
        ServiceManager.get('Logger').success('[Logging] Dashboard-Plugin aktiviert');
        return true;
    }

    /**
     * Beim Einschalten und bei jedem Start je Guild: Startwerte (nur, was
     * fehlt), Navigation.
     *
     * @param {string} guildId
     */
    async onGuildEnable(guildId) {
        await ServiceManager.get('dbService').query(
            'INSERT INTO log_einstellungen (guild_id) VALUES (?) ON DUPLICATE KEY UPDATE guild_id = guild_id', [guildId]);
        await this._registerNavigation(guildId);
    }

    /**
     * Eigene Navigation. `removeNavigation` vorweg, weil `registerNavigation`
     * Vorhandenes überspringt, aber nie löscht.
     *
     * @param {string} guildId
     * @private
     */
    async _registerNavigation(guildId) {
        const navigationManager = ServiceManager.get('navigationManager');
        const basis = `/guild/${guildId}/plugins/logging`;
        const haupt = navigationManager.menuTypes.MAIN;
        // Ausgeschrieben wie in den anderen Plugins: check-navigationsordnung
        // liest den Wurzelpunkt (`order` bei `parent: null`) aus dem Quelltext.
        const navItems = [
            {
                title: 'logging:NAV.LOGGING',
                url: basis,
                icon: 'fa-solid fa-clipboard-list',
                // Freier Platz zwischen leveling (6250) und greeting (6500).
                order: 6400,
                type: haupt,
                capability: 'LOGGING.VIEW',
                visible: true,
                guildId,
                parent: null
            },
            {
                title: 'logging:NAV.EREIGNISSE',
                url: `${basis}/ereignisse`,
                icon: 'fa-solid fa-list',
                order: 10,
                type: haupt,
                capability: 'LOGGING.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'logging:NAV.EINSTELLUNGEN',
                url: `${basis}/einstellungen`,
                icon: 'fa-solid fa-sliders',
                order: 90,
                type: haupt,
                capability: 'LOGGING.CONFIGURE',
                visible: true,
                guildId,
                parent: basis
            }
        ];
        try {
            await navigationManager.removeNavigation(this.name, guildId);
            await navigationManager.registerNavigation(this.name, guildId, navItems);
        } catch (error) {
            ServiceManager.get('Logger').error('[Logging] Navigation nicht eingetragen:', error);
        }
    }
}

module.exports = LoggingDashboardPlugin;
