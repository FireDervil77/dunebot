/**
 * Giveaway - Dashboard-Plugin
 *
 * Umbau am 2026-08-07: Aus einer Seite mit sechs Tabs wurde ein eigenstaendiger
 * Bereich mit eigener Navigation - nach dem Vorbild von gameserver,
 * masterserver, automod und moderation. Die Routen liegen in `routes/`.
 *
 * @author FireBot Team
 */

const { DashboardPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

class GiveawayDashboardPlugin extends DashboardPlugin {
    constructor() {
        super({
            name: 'giveaway',
            displayName: 'Giveaway',
            description: 'Verlosungen anlegen, steuern und auswerten',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
            icon: 'fa-solid fa-gift',
            baseDir: __dirname,
            ownerOnly: false,
            publicAssets: true
        });

        this.guildRouter = require('express').Router({ mergeParams: true });
    }

    /**
     * Plugin aktivieren
     *
     * @param {Object} app Express-App
     * @param {Object} dbService Datenbank-Dienst
     */
    async onEnable(app, dbService) {
        const Logger = ServiceManager.get('Logger');
        Logger.info('Aktiviere [Giveaway] Dashboard-Plugin...');

        this.app = app;
        this._registerAssets();
        this._setupRoutes();

        Logger.success('[Giveaway] Dashboard-Plugin aktiviert');
        return true;
    }

    /**
     * Skripte anmelden.
     *
     * @private
     */
    _registerAssets() {
        const assetManager = ServiceManager.get('assetManager');
        const Logger = ServiceManager.get('Logger');

        if (!assetManager) {
            Logger.warn('[Giveaway] AssetManager nicht verfuegbar - Assets werden nicht angemeldet');
            return;
        }

        assetManager.registerScript('giveaway-actions', 'js/giveaway-actions.js', {
            plugin: 'giveaway',
            deps: [],
            version: this.version,
            inFooter: true
        });

        Logger.debug('[Giveaway] Assets angemeldet (1 Skript)');
    }

    /**
     * Router einhaengen.
     *
     * Die Reihenfolge ist wichtig: `/templates` und `/blacklist` muessen vor
     * dem Verlosungs-Router stehen, dessen `/:id`-Muster sonst zuerst greift.
     *
     * @private
     */
    _setupRoutes() {
        const Logger = ServiceManager.get('Logger');

        this.guildRouter.use('/templates', require('./routes/templates.router'));
        this.guildRouter.use('/blacklist', require('./routes/blacklist.router'));
        this.guildRouter.use('/', require('./routes/giveaways.router'));

        // Seiten zuletzt: der Seiten-Router faengt mit '/' auch die Startseite
        this.guildRouter.use('/', require('./routes/guild.router'));

        Logger.info('[Giveaway] Routen registriert (4 Router)');
    }

    async onDisable() {
        ServiceManager.get('Logger').info('[Giveaway] Dashboard-Plugin deaktiviert');
        return true;
    }

    /**
     * Plugin in einer Guild aktivieren
     *
     * @param {string} guildId Discord-Guild-ID
     */
    async onGuildEnable(guildId) {
        await this._registerNavigation(guildId);
        ServiceManager.get('Logger').info(`[Giveaway] Plugin fuer Guild ${guildId} aktiviert`);
    }

    /**
     * Plugin in einer Guild deaktivieren - Navigation und Daten entfernen
     *
     * @param {string} guildId Discord-Guild-ID
     */
    async onGuildDisable(guildId) {
        const Logger = ServiceManager.get('Logger');
        const navigationManager = ServiceManager.get('navigationManager');
        const dbService = ServiceManager.get('dbService');

        try {
            await navigationManager.removeNavigation(this.name, guildId);

            // Reihenfolge zaehlt: erst die abhaengigen Zeilen, dann die
            // Verlosungen selbst.
            const abfragen = [
                'DELETE FROM giveaway_requirements WHERE giveaway_id IN (SELECT id FROM giveaways WHERE guild_id = ?)',
                'DELETE FROM giveaway_winners WHERE giveaway_id IN (SELECT id FROM giveaways WHERE guild_id = ?)',
                'DELETE FROM giveaway_entries WHERE giveaway_id IN (SELECT id FROM giveaways WHERE guild_id = ?)',
                'DELETE FROM giveaways WHERE guild_id = ?',
                'DELETE FROM giveaway_templates WHERE guild_id = ?',
                'DELETE FROM giveaway_blacklist WHERE guild_id = ?'
            ];

            for (const sql of abfragen) {
                try {
                    await dbService.query(sql, [guildId]);
                } catch (e) {
                    // Eine noch nie angelegte Tabelle ist kein Fehler
                    if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
                }
            }

            Logger.success(`[Giveaway] Daten fuer Guild ${guildId} entfernt`);
            return true;
        } catch (error) {
            Logger.error(`[Giveaway] Fehler beim Deaktivieren fuer Guild ${guildId}:`, error);
            throw error;
        }
    }

    /**
     * Navigation registrieren.
     *
     * Laeuft bei jedem Start ueber `onGuildEnable`. Das vorangestellte
     * `removeNavigation` raeumt den alten Einzeleintrag weg - `registerNavigation`
     * ueberspringt Vorhandenes, loescht aber nie.
     *
     * Einen Eintrag unter den Kern-Einstellungen gibt es hier bewusst nicht:
     * Giveaway hat keine Einstellungen je Guild. `dashboard/config.json` haelt
     * nur Emoji und Farben, und zwar fuer alle Guilds gemeinsam.
     *
     * @param {string} guildId Discord-Guild-ID
     * @private
     */
    async _registerNavigation(guildId) {
        const Logger = ServiceManager.get('Logger');
        const navigationManager = ServiceManager.get('navigationManager');

        const basis = `/guild/${guildId}/plugins/giveaway`;
        const haupt = navigationManager.menuTypes.MAIN;

        const navItems = [
            {
                title: 'giveaway:NAV.GIVEAWAY',
                url: basis,
                icon: 'fa-solid fa-gift',
                order: null,
                type: haupt,
                capability: 'GIVEAWAY.VIEW',
                visible: true,
                guildId,
                parent: null
            },
            {
                title: 'giveaway:NAV.DASHBOARD',
                url: `${basis}/dashboard`,
                icon: 'fa-solid fa-gauge-high',
                order: 10,
                type: haupt,
                capability: 'GIVEAWAY.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'giveaway:NAV.ACTIVE',
                url: `${basis}/laufende`,
                icon: 'fa-solid fa-bolt',
                order: 20,
                type: haupt,
                capability: 'GIVEAWAY.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'giveaway:NAV.ENDED',
                url: `${basis}/beendet`,
                icon: 'fa-solid fa-clock-rotate-left',
                order: 30,
                type: haupt,
                capability: 'GIVEAWAY.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'giveaway:NAV.TEMPLATES',
                url: `${basis}/vorlagen`,
                icon: 'fa-solid fa-copy',
                order: 40,
                type: haupt,
                capability: 'GIVEAWAY.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'giveaway:NAV.BLACKLIST',
                url: `${basis}/sperrliste`,
                icon: 'fa-solid fa-ban',
                order: 50,
                type: haupt,
                capability: 'GIVEAWAY.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'giveaway:NAV.ANALYTICS',
                url: `${basis}/auswertung`,
                icon: 'fa-solid fa-chart-simple',
                order: 60,
                type: haupt,
                capability: 'GIVEAWAY.VIEW',
                visible: true,
                guildId,
                parent: basis
            }
        ];

        try {
            await navigationManager.removeNavigation(this.name, guildId);
            await navigationManager.registerNavigation(this.name, guildId, navItems);
            Logger.debug(`[Giveaway] Navigation registriert (${navItems.length} Eintraege)`);
        } catch (error) {
            Logger.error('[Giveaway] Fehler beim Registrieren der Navigation:', error);
        }
    }
}

module.exports = GiveawayDashboardPlugin;
