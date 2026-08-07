/**
 * AutoMod - Dashboard-Plugin
 *
 * Umbau am 2026-08-07: Aus einer einzigen Seite mit neun Tabs wurde ein
 * eigenstaendiger Bereich mit eigener Navigation - nach dem Vorbild von
 * gameserver und masterserver. Die Routen liegen jetzt in `routes/`, diese
 * Datei kuemmert sich nur noch um den Lebenszyklus des Plugins.
 *
 * @author FireBot Team
 */

const { DashboardPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

class AutoModPlugin extends DashboardPlugin {
    constructor(app) {
        super({
            name: 'automod',
            displayName: 'AutoMod',
            description: 'Automatische Moderation: Filter, Regeln, Eskalation und Raid-Schutz',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
            icon: 'fa-solid fa-shield-halved',
            baseDir: __dirname,
            publicAssets: true
        });

        this.app = app;
        this.guildRouter = require('express').Router();
    }

    /**
     * Plugin aktivieren - wird vom PluginManager aufgerufen
     *
     * @param {Object} app Express-App
     * @param {Object} dbService Datenbank-Dienst
     */
    async onEnable(app, dbService) {
        const Logger = ServiceManager.get('Logger');
        Logger.info('Aktiviere [AutoMod] Dashboard-Plugin...');

        this._registerAssets();
        this._setupRoutes();
        this._registerShortcodes();

        Logger.success('[AutoMod] Dashboard-Plugin aktiviert');
        return true;
    }

    /**
     * Stylesheets und Skripte anmelden.
     *
     * Die Seiten holen sich per `enqueueScript` nur, was sie brauchen - bis
     * zum Umbau steckte all das als Inline-Block in der View.
     *
     * @private
     */
    _registerAssets() {
        const assetManager = ServiceManager.get('assetManager');
        const Logger = ServiceManager.get('Logger');

        if (!assetManager) {
            Logger.warn('[AutoMod] AssetManager nicht verfuegbar - Assets werden nicht angemeldet');
            return;
        }

        assetManager.registerStyle('automod-styles', 'css/automod.css', {
            plugin: 'automod',
            deps: [],
            version: this.version,
            media: 'all'
        });

        // Formulare: Checkboxen und Mehrfachauswahl absenden
        assetManager.registerScript('automod-forms', 'js/automod-forms.js', {
            plugin: 'automod',
            deps: [],
            version: this.version,
            inFooter: true
        });

        // Regeln, Ausnahmen und Eskalation ueber die JSON-Routen pflegen
        assetManager.registerScript('automod-rules', 'js/automod-rules.js', {
            plugin: 'automod',
            deps: [],
            version: this.version,
            inFooter: true
        });

        // Protokoll: Zeitraum wechseln, Strikes zuruecksetzen, aufraeumen
        assetManager.registerScript('automod-logs', 'js/automod-logs.js', {
            plugin: 'automod',
            deps: [],
            version: this.version,
            inFooter: true
        });

        Logger.debug('[AutoMod] Assets angemeldet (1 Stylesheet, 3 Skripte)');
    }

    /**
     * Router einhaengen.
     *
     * @private
     */
    _setupRoutes() {
        const Logger = ServiceManager.get('Logger');

        // Einstellungen speichern (PUT /settings)
        this.guildRouter.use('/settings', require('./routes/settings.router'));

        // JSON-Routen
        this.guildRouter.use('/exemptions', require('./routes/exemptions.router'));
        this.guildRouter.use('/escalation', require('./routes/escalation.router'));
        this.guildRouter.use('/protokoll/api', require('./routes/logs.router'));
        this.guildRouter.use('/', require('./routes/rules.router'));

        // Seiten zuletzt: der Seiten-Router faengt mit '/' auch die Startseite
        this.guildRouter.use('/', require('./routes/guild.router'));

        Logger.info('[AutoMod] Routen registriert (6 Router)');
    }

    /**
     * Shortcodes registrieren
     *
     * @private
     */
    _registerShortcodes() {
        this.app.shortcodeParser.register(this.name, 'guild-name', (attrs, content, context) => {
            const guildId = context.guildId || attrs.id;
            if (!guildId) return '[Keine Guild-ID]';

            const guild = this.app.client?.guilds.cache.get(guildId);
            return guild ? guild.name : '[Unbekannte Guild]';
        });
    }

    /**
     * Plugin deaktivieren
     */
    async onDisable() {
        ServiceManager.get('Logger').info('[AutoMod] Dashboard-Plugin deaktiviert');
        return true;
    }

    /**
     * Plugin in einer Guild aktivieren
     *
     * @param {string} guildId Discord-Guild-ID
     */
    async onGuildEnable(guildId) {
        const Logger = ServiceManager.get('Logger');
        await this._registerNavigation(guildId);
        Logger.info(`[AutoMod] Plugin fuer Guild ${guildId} aktiviert`);
    }

    /**
     * Plugin-Update in einer Guild
     *
     * Ohne diesen Haken erreicht eine geaenderte Navigation nur neu
     * aktivierte Guilds - bestehende behalten ewig das alte Menue. Genau so
     * fehlten anderswo schon Menuepunkte bei 9 von 11 Guilds.
     *
     * @param {string} oldVersion Vorherige Version
     * @param {string} newVersion Neue Version
     * @param {string} guildId Discord-Guild-ID
     */
    async onUpdate(oldVersion, newVersion, guildId) {
        const Logger = ServiceManager.get('Logger');
        const pluginManager = ServiceManager.get('pluginManager');

        Logger.info(`[AutoMod] Update ${oldVersion} → ${newVersion} fuer Guild ${guildId}`);

        try {
            const plugin = pluginManager.getPlugin('automod');
            if (plugin) {
                await pluginManager.registerPluginPermissionsForGuild(plugin, guildId);
            }
        } catch (err) {
            Logger.error(`[AutoMod] Rechte-Update fuer Guild ${guildId} fehlgeschlagen:`, err.message);
        }

        await this._registerNavigation(guildId);
    }

    /**
     * Plugin in einer Guild deaktivieren
     *
     * @param {string} guildId Discord-Guild-ID
     */
    async onGuildDisable(guildId) {
        const Logger = ServiceManager.get('Logger');
        const navigationManager = ServiceManager.get('navigationManager');

        try {
            await navigationManager.removeNavigation(this.name, guildId);
            Logger.success(`[AutoMod] Navigation fuer Guild ${guildId} entfernt`);
            return true;
        } catch (error) {
            Logger.error(`[AutoMod] Fehler beim Aufraeumen fuer Guild ${guildId}:`, error);
            throw error;
        }
    }

    /**
     * Navigation registrieren.
     *
     * Vor dem Anlegen wird die alte Navigation des Plugins ausdruecklich
     * entfernt. `registerNavigation` ueberspringt vorhandene Eintraege, loescht
     * aber nie - der alte Einzeleintrag (Ziel `/settings`, direkt unter der
     * Guild) wuerde sonst neben dem neuen Bereich stehen bleiben.
     *
     * @param {string} guildId Discord-Guild-ID
     * @private
     */
    async _registerNavigation(guildId) {
        const Logger = ServiceManager.get('Logger');
        const navigationManager = ServiceManager.get('navigationManager');

        const basis = `/guild/${guildId}/plugins/automod`;
        const haupt = navigationManager.menuTypes.MAIN;

        const navItems = [
            // Hauptpunkt
            {
                title: 'automod:NAV.AUTOMOD',
                url: basis,
                icon: 'fa-solid fa-shield-halved',
                order: null,
                type: haupt,
                capability: 'AUTOMOD.VIEW',
                visible: true,
                guildId,
                parent: null
            },
            {
                title: 'automod:NAV.DASHBOARD',
                url: `${basis}/dashboard`,
                icon: 'fa-solid fa-gauge-high',
                order: 10,
                type: haupt,
                capability: 'AUTOMOD.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'automod:NAV.FILTER',
                url: `${basis}/filter`,
                icon: 'fa-solid fa-filter',
                order: 20,
                type: haupt,
                capability: 'AUTOMOD.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'automod:NAV.RULES',
                url: `${basis}/regeln`,
                icon: 'fa-solid fa-code',
                order: 30,
                type: haupt,
                capability: 'AUTOMOD.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'automod:NAV.ESCALATION',
                url: `${basis}/eskalation`,
                icon: 'fa-solid fa-stairs',
                order: 40,
                type: haupt,
                capability: 'AUTOMOD.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'automod:NAV.EXEMPTIONS',
                url: `${basis}/ausnahmen`,
                icon: 'fa-solid fa-user-check',
                order: 50,
                type: haupt,
                capability: 'AUTOMOD.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'automod:NAV.RAID',
                url: `${basis}/raid`,
                icon: 'fa-solid fa-shield-virus',
                order: 60,
                type: haupt,
                capability: 'AUTOMOD.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'automod:NAV.LOGS',
                url: `${basis}/protokoll`,
                icon: 'fa-solid fa-file-lines',
                order: 70,
                type: haupt,
                capability: 'AUTOMOD.LOGS.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            // Einstellungsseite haengt weiterhin unter den Kern-Einstellungen
            {
                title: 'automod:NAV.AUTOMOD',
                url: `${basis}/settings`,
                icon: 'fa-solid fa-shield-halved',
                order: null,
                type: haupt,
                capability: 'AUTOMOD.VIEW',
                visible: true,
                guildId,
                parent: `/guild/${guildId}/settings`
            }
        ];

        try {
            await navigationManager.removeNavigation(this.name, guildId);
            await navigationManager.registerNavigation(this.name, guildId, navItems);
            Logger.debug(`[AutoMod] Navigation registriert (${navItems.length} Eintraege)`);
        } catch (error) {
            Logger.error('[AutoMod] Fehler beim Registrieren der Navigation:', error);
        }
    }
}

module.exports = AutoModPlugin;
