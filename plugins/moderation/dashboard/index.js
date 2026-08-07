/**
 * Moderation - Dashboard-Plugin
 *
 * Umbau am 2026-08-07: Aus einer Seite mit fuenf Tabs wurde ein eigenstaendiger
 * Bereich mit eigener Navigation - nach dem Vorbild von gameserver, masterserver
 * und automod. Die Routen liegen in `routes/`, diese Datei kuemmert sich nur
 * noch um den Lebenszyklus.
 *
 * @author FireBot Team
 */

const { DashboardPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

class ModerationPlugin extends DashboardPlugin {
    constructor(app) {
        super({
            name: 'moderation',
            displayName: 'Moderation',
            description: 'Verwarnungen, Kicks, Banns, Notizen und Kanalregeln',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
            icon: 'fa-solid fa-gavel',
            baseDir: __dirname,
            publicAssets: true
        });

        this.app = app;
        this.guildRouter = require('express').Router();
    }

    /**
     * Plugin aktivieren
     *
     * @param {Object} app Express-App
     * @param {Object} dbService Datenbank-Dienst
     */
    async onEnable(app, dbService) {
        const Logger = ServiceManager.get('Logger');
        Logger.info('Aktiviere [Moderation] Dashboard-Plugin...');

        this._registerAssets();
        this._setupRoutes();

        Logger.success('[Moderation] Dashboard-Plugin aktiviert');
        return true;
    }

    /**
     * Skripte anmelden. Die Seiten reihen per `enqueueScript` nur ein, was sie
     * brauchen - bis zum Umbau steckte all das inline in der View.
     *
     * @private
     */
    _registerAssets() {
        const assetManager = ServiceManager.get('assetManager');
        const Logger = ServiceManager.get('Logger');

        if (!assetManager) {
            Logger.warn('[Moderation] AssetManager nicht verfuegbar - Assets werden nicht angemeldet');
            return;
        }

        assetManager.registerScript('moderation-forms', 'js/moderation-forms.js', {
            plugin: 'moderation',
            deps: [],
            version: this.version,
            inFooter: true
        });

        assetManager.registerScript('moderation-actions', 'js/moderation-actions.js', {
            plugin: 'moderation',
            deps: [],
            version: this.version,
            inFooter: true
        });

        Logger.debug('[Moderation] Assets angemeldet (2 Skripte)');
    }

    /**
     * Router einhaengen.
     *
     * @private
     */
    _setupRoutes() {
        const Logger = ServiceManager.get('Logger');

        this.guildRouter.use('/settings', require('./routes/settings.router'));
        this.guildRouter.use('/protected-roles', require('./routes/protected-roles.router'));
        this.guildRouter.use('/channel-rules', require('./routes/channel-rules.router'));
        this.guildRouter.use('/notes', require('./routes/notes.router'));
        this.guildRouter.use('/logs', require('./routes/logs.router'));

        // Seiten zuletzt: der Seiten-Router faengt mit '/' auch die Startseite
        this.guildRouter.use('/', require('./routes/guild.router'));

        Logger.info('[Moderation] Routen registriert (6 Router)');
    }

    async onDisable() {
        ServiceManager.get('Logger').info('[Moderation] Dashboard-Plugin deaktiviert');
        return true;
    }

    /**
     * Plugin in einer Guild aktivieren
     *
     * @param {string} guildId Discord-Guild-ID
     */
    async onGuildEnable(guildId) {
        await this._registerNavigation(guildId);
        ServiceManager.get('Logger').info(`[Moderation] Plugin fuer Guild ${guildId} aktiviert`);
    }

    /**
     * Plugin in einer Guild deaktivieren
     *
     * Frueher stand hier ein handgeschriebenes DELETE auf `guild_nav_items`.
     * Der NavigationManager kann das selbst und bleibt die eine Stelle, die
     * diese Tabelle kennt.
     *
     * @param {string} guildId Discord-Guild-ID
     */
    async onGuildDisable(guildId) {
        const Logger = ServiceManager.get('Logger');

        try {
            await ServiceManager.get('navigationManager').removeNavigation(this.name, guildId);
            Logger.success(`[Moderation] Navigation fuer Guild ${guildId} entfernt`);
            return true;
        } catch (error) {
            Logger.error(`[Moderation] Fehler beim Aufraeumen fuer Guild ${guildId}:`, error);
            throw error;
        }
    }

    /**
     * Navigation registrieren.
     *
     * Laeuft bei jedem Start des Dashboards ueber `onGuildEnable`. Vorher wird
     * die alte Navigation des Plugins entfernt: `registerNavigation` ueberspringt
     * vorhandene Eintraege, loescht aber nie - der alte Einzeleintrag stuende
     * sonst weiter neben dem neuen Bereich.
     *
     * @param {string} guildId Discord-Guild-ID
     * @private
     */
    async _registerNavigation(guildId) {
        const Logger = ServiceManager.get('Logger');
        const navigationManager = ServiceManager.get('navigationManager');

        const basis = `/guild/${guildId}/plugins/moderation`;
        const haupt = navigationManager.menuTypes.MAIN;

        const navItems = [
            {
                title: 'moderation:NAV.MODERATION',
                url: basis,
                icon: 'fa-solid fa-gavel',
                order: null,
                type: haupt,
                capability: 'MODERATION.VIEW',
                visible: true,
                guildId,
                parent: null
            },
            {
                title: 'moderation:NAV.DASHBOARD',
                url: `${basis}/dashboard`,
                icon: 'fa-solid fa-gauge-high',
                order: 10,
                type: haupt,
                capability: 'MODERATION.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'moderation:NAV.CASES',
                url: `${basis}/faelle`,
                icon: 'fa-solid fa-folder-open',
                order: 20,
                type: haupt,
                capability: 'MODERATION.LOGS.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'moderation:NAV.NOTES',
                url: `${basis}/notizen`,
                icon: 'fa-solid fa-note-sticky',
                order: 30,
                type: haupt,
                capability: 'MODERATION.NOTES.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'moderation:NAV.CHANNEL_RULES',
                url: `${basis}/kanalregeln`,
                icon: 'fa-solid fa-hashtag',
                order: 40,
                type: haupt,
                capability: 'MODERATION.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'moderation:NAV.PROTECTED',
                url: `${basis}/rollen`,
                icon: 'fa-solid fa-user-shield',
                order: 50,
                type: haupt,
                capability: 'MODERATION.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            // Einstellungsseite haengt unter den Kern-Einstellungen
            {
                title: 'moderation:NAV.MODERATION',
                url: `${basis}/settings`,
                icon: 'fa-solid fa-gavel',
                order: null,
                type: haupt,
                capability: 'MODERATION.VIEW',
                visible: true,
                guildId,
                parent: `/guild/${guildId}/settings`
            }
        ];

        try {
            await navigationManager.removeNavigation(this.name, guildId);
            await navigationManager.registerNavigation(this.name, guildId, navItems);
            Logger.debug(`[Moderation] Navigation registriert (${navItems.length} Eintraege)`);
        } catch (error) {
            Logger.error('[Moderation] Fehler beim Registrieren der Navigation:', error);
        }
    }
}

module.exports = ModerationPlugin;
