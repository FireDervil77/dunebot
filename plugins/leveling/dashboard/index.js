'use strict';

/**
 * Leveling - Dashboard-Plugin (LV-1a, LV-1c, K382, 2026-11-15).
 *
 * Stufe 1 bisher: eigene Navigation mit der Übersicht, Startwerte beim
 * Einschalten, Storno nach `automod.verstoss`. Die Einstellseiten kommen mit
 * LV-1i.
 *
 * Gelöscht wird beim Abschalten vom Kern: Tabellen nach `guildInhalte`, die
 * Fortschritte `leveling:*` über `Fortschritt.loeschePlugin`
 * (`PluginManager.disableInGuild`, Schritt 2).
 *
 * @author FireBot Team
 */

const { DashboardPlugin, VersionHelper, Ereignisse } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');
const { spieleStartwerteEin } = require('../shared/vorgaben');

class LevelingDashboardPlugin extends DashboardPlugin {
    constructor() {
        super({
            name: 'leveling',
            displayName: 'Leveling',
            description: 'Community-Level, XP und Ranglisten je Guild',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
            icon: 'fa-solid fa-ranking-star',
            baseDir: __dirname,
            ownerOnly: false
        });

        this.guildRouter = require('express').Router({ mergeParams: true });
    }

    async onEnable(app) {
        const Logger = ServiceManager.get('Logger');
        this.app = app;
        this.guildRouter.use('/', require('./routes/guild.router'));

        // automod hat die Nachricht beanstandet → ihre XP zurück (LV-1c).
        Ereignisse.hoere('automod.verstoss', 'leveling', require('./hoerer').automodVerstoss);

        Logger.success('[Leveling] Dashboard-Plugin aktiviert');
        return true;
    }

    /**
     * Läuft beim Einschalten und bei jedem Start je Guild: Startwerte
     * einspielen (nur, was fehlt), Navigation eintragen.
     *
     * @param {string} guildId
     */
    async onGuildEnable(guildId) {
        await this._startwerte(guildId);
        await this._registerNavigation(guildId);
    }

    /**
     * Einstellungen mit den Spaltenvorgaben der Migration, Quellen mit
     * `shared/vorgaben.js`. Vorhandenes bleibt, wie die Guild es eingestellt hat.
     *
     * @param {string} guildId
     * @private
     */
    async _startwerte(guildId) {
        await spieleStartwerteEin(ServiceManager.get('dbService'), guildId);
    }

    /**
     * Eigene Navigation. `removeNavigation` vorweg, weil `registerNavigation`
     * Vorhandenes überspringt, aber nie löscht.
     *
     * @param {string} guildId
     * @private
     */
    async _registerNavigation(guildId) {
        const Logger = ServiceManager.get('Logger');
        const navigationManager = ServiceManager.get('navigationManager');
        const basis = `/guild/${guildId}/plugins/leveling`;
        const haupt = navigationManager.menuTypes.MAIN;

        const navItems = [
            {
                title: 'leveling:NAV.LEVELING',
                url: basis,
                icon: 'fa-solid fa-ranking-star',
                // Freier Platz zwischen giveaway (6000) und dem nächsten (6500).
                order: 6250,
                type: haupt,
                capability: 'LEVELING.VIEW',
                visible: true,
                guildId,
                parent: null
            },
            {
                title: 'leveling:NAV.UEBERSICHT',
                url: `${basis}/uebersicht`,
                icon: 'fa-solid fa-gauge-high',
                order: 10,
                type: haupt,
                capability: 'LEVELING.VIEW',
                visible: true,
                guildId,
                parent: basis
            }
        ];

        try {
            await navigationManager.removeNavigation(this.name, guildId);
            await navigationManager.registerNavigation(this.name, guildId, navItems);
        } catch (error) {
            Logger.error('[Leveling] Navigation nicht registriert:', error);
        }
    }
}

module.exports = LevelingDashboardPlugin;
