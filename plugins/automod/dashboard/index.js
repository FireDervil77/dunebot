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

    // `onUpdate` ist am 2026-11-09 entfallen (K028): Niemand rief den Haken auf.
    // Rechte und Navigation schreibt onGuildEnable bei jedem Start.

    // `onGuildDisable` entfällt (K341, 2026-11-10): Menü und Rechte nimmt der
    // Kern (PluginManager.disableInGuild, Schritte 4 und 5), die Zeilen der Guild
    // nach `guildInhalte` in package.json (K067).

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
                // **Fester Platz in der Seitenleiste** (2026-09-04).
                //
                // Hier stand `order: null`. Der NavigationManager vergab dann
                // die naechste freie 1000er-Stufe — also die, die sich aus der
                // Reihenfolge der REGISTRIERUNG ergibt, nicht aus dem Plugin.
                // Wer sich zuerst eintrug, stand oben; nach einem Neustart in
                // anderer Reihenfolge stand er woanders. Und weil die Abfrage
                // alles ab 9000 ausblendet, bekamen ab dem achten Plugin ALLE
                // die 9000 — fuenf Punkte mit demselben Wert, deren Reihenfolge
                // dann der Uebersetzungsschluessel entschied.
                //
                // Die Zahlen sind der heutige Stand, eingefroren, in
                // 500er-Schritten: unter 9000 ist Platz fuer alle zehn.
                order: 5000,
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
