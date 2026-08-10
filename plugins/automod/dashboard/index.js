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

        // Stichwortlisten: Listen, Woerter, Trefferart, Abgleich
        assetManager.registerScript('automod-stichwoerter', 'js/automod-stichwoerter.js', {
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

        Logger.debug('[AutoMod] Assets angemeldet (1 Stylesheet, 4 Skripte)');
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
        this.guildRouter.use('/stichwoerter', require('./routes/keywords.router'));
        this.guildRouter.use('/', require('./routes/rules.router'));

        // Seiten zuletzt: der Seiten-Router faengt mit '/' auch die Startseite
        this.guildRouter.use('/', require('./routes/guild.router'));

        Logger.info('[AutoMod] Routen registriert (7 Router)');
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

        // Stichwortlisten aus den Vorlagen befuellen - einmalig.
        //
        // Die Listen kommen ausgeschaltet an, damit sich am Verhalten einer
        // Guild nichts aendert, nur weil das Plugin neu eingeschaltet wurde.
        // `keyword_lists_seeded_at` verhindert, dass eine Guild, die ihre
        // Listen bewusst geloescht hat, sie beim naechsten Start zurueckbekommt.
        try {
            const { AutoModKeywordLists } = require('../shared/models');
            const angelegt = await AutoModKeywordLists.befuelleAusVorlagen(guildId);
            if (angelegt > 0) {
                Logger.info(`[AutoMod] ${angelegt} Stichwortliste(n) fuer Guild ${guildId} aus den Vorlagen befuellt`);
            }
        } catch (error) {
            // Kein Grund, die Aktivierung scheitern zu lassen - die Seite holt
            // das Befuellen beim ersten Aufruf nach.
            Logger.warn(`[AutoMod] Stichwortlisten fuer Guild ${guildId} nicht befuellbar: ${error.message}`);
        }

        Logger.info(`[AutoMod] Plugin fuer Guild ${guildId} aktiviert`);
    }

    /**
     * Plugin-Update in einer Guild
     *
     * Achtung: Diesen Haken ruft im Projekt derzeit niemand auf - er ist wie
     * bei core und gameserver totes Gewicht (Punkt 17 in Baustellen.md). Auf
     * die Navigation wirkt sich das nicht aus, die schreibt `onGuildEnable`
     * bei jedem Start neu. Die Methode steht hier fuer den Tag, an dem der
     * Aufrufer gebaut wird, und macht nichts, worauf sich etwas verlaesst.
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
     * Entfernt die Navigation - und sonst nichts. Einstellungen, Strikes und
     * Protokoll bleiben stehen, damit ein versehentliches Abschalten und
     * Wiedereinschalten nicht die Arbeit von Monaten kostet.
     *
     * In den Modellen standen dafuer `deleteSettings`, `deleteAllStrikes` und
     * `deleteAllLogs` bereit, mit dem Kommentar "z.B. bei Plugin-Deaktivierung".
     * Keine davon hatte je einen Aufrufer; am 2026-08-10 wurden sie geloescht.
     * Wenn Daten wirklich weg sollen, gehoert das in eine eigene, ausdrueckliche
     * Aktion mit Rueckfrage - nicht stillschweigend an den Abschalter.
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
     * Laeuft bei jedem Start des Dashboards: `enableGuildSpecificPlugins()`
     * geht ueber alle Guilds und ruft fuer jedes eingeschaltete Plugin
     * `enableInGuild` auf, das wiederum `onGuildEnable` aufruft.
     *
     * Vor dem Anlegen wird die alte Navigation des Plugins ausdruecklich
     * entfernt. `registerNavigation` ueberspringt vorhandene Eintraege, loescht
     * aber nie - der alte Einzeleintrag (Ziel `/settings`, direkt unter der
     * Guild) stuende sonst weiter neben dem neuen Bereich. Das ist gefahrlos:
     * auf `guild_nav_items` gibt es projektweit keine einzige UPDATE-Anweisung,
     * es gibt also keine von Hand gesetzte Sortierung, die verloren gehen
     * koennte.
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
                title: 'automod:NAV.KEYWORDS',
                url: `${basis}/stichwoerter`,
                icon: 'fa-solid fa-list-check',
                order: 35,
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
