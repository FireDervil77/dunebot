/**
 * Musik - Dashboard-Plugin
 *
 * Neu angelegt am 2026-08-07, von Anfang an nach dem Muster, das bei den
 * Umbauten von automod, moderation, giveaway, greeting und ticket entstanden
 * ist. Die acht Fallen, die dort gefunden wurden, sind hier vermieden:
 *
 *   - Rechteschluessel in Punktschreibweise, deckungsgleich mit permissions.json
 *   - `removeNavigation` vor `registerNavigation`, weil letzteres nie loescht
 *   - kein Verlass auf `onUpdate` - der Haken hat projektweit keinen Aufrufer
 *   - Nutzer aus der Sitzung, nicht aus `req.user` (das gibt es nicht)
 *   - Lesen mit VIEW, Schreiben mit den engeren Rechten
 *   - Plugin-CSS waere auf `.music-*` eingegrenzt (hier gar keins noetig)
 *   - jede Tabelle hat eine Ansicht, sonst waere sie tot
 *
 * @author FireBot Team
 */

const { DashboardPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

class MusicDashboardPlugin extends DashboardPlugin {
    constructor(app) {
        super({
            name: 'music',
            displayName: 'Musik',
            description: 'Wiedergabe steuern, Warteschlange, Wiedergabelisten und Verlauf',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
            icon: 'fa-solid fa-music',
            baseDir: __dirname,
            publicAssets: true
        });

        this.app = app;
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
        Logger.info('Aktiviere [Musik] Dashboard-Plugin...');

        this._registerAssets();
        this._setupRoutes();

        Logger.success('[Musik] Dashboard-Plugin aktiviert');
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
            Logger.warn('[Musik] AssetManager nicht verfuegbar - Assets werden nicht angemeldet');
            return;
        }

        assetManager.registerScript('music-steuerung', 'js/music-steuerung.js', {
            plugin: 'music',
            deps: [],
            version: this.version,
            inFooter: true
        });

        Logger.debug('[Musik] Assets angemeldet (1 Skript)');
    }

    /**
     * Router einhaengen.
     *
     * @private
     */
    _setupRoutes() {
        const Logger = ServiceManager.get('Logger');

        this.guildRouter.use('/settings', require('./routes/settings.router'));
        this.guildRouter.use('/steuerung', require('./routes/control.router'));
        this.guildRouter.use('/listen/api', require('./routes/playlists.router'));
        this.guildRouter.use('/dateien', require('./routes/dateien.router'));

        // Seiten zuletzt: der Seiten-Router faengt mit '/' auch die Startseite
        this.guildRouter.use('/', require('./routes/guild.router'));

        Logger.info('[Musik] Routen registriert (4 Router)');
    }

    async onDisable() {
        ServiceManager.get('Logger').info('[Musik] Dashboard-Plugin deaktiviert');
        return true;
    }

    /**
     * Plugin in einer Guild aktivieren
     *
     * @param {string} guildId Discord-Guild-ID
     */
    async onGuildEnable(guildId) {
        await this._registerNavigation(guildId);
        ServiceManager.get('Logger').info(`[Musik] Plugin fuer Guild ${guildId} aktiviert`);
    }

    /**
     * Plugin in einer Guild deaktivieren - Navigation und Daten entfernen
     *
     * @param {string} guildId Discord-Guild-ID
     */
    async onGuildDisable(guildId) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        try {
            await ServiceManager.get('navigationManager').removeNavigation(this.name, guildId);

            // Reihenfolge zaehlt wegen des Fremdschluessels auf den Listen
            const abfragen = [
                'DELETE FROM music_playlist_tracks WHERE playlist_id IN (SELECT id FROM music_playlists WHERE guild_id = ?)',
                'DELETE FROM music_playlists WHERE guild_id = ?',
                'DELETE FROM music_history WHERE guild_id = ?',
                'DELETE FROM music_files WHERE guild_id = ?',
                'DELETE FROM music_settings WHERE guild_id = ?'
            ];

            for (const sql of abfragen) {
                try {
                    await dbService.query(sql, [guildId]);
                } catch (e) {
                    if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
                }
            }

            Logger.success(`[Musik] Daten fuer Guild ${guildId} entfernt`);
            return true;
        } catch (error) {
            Logger.error(`[Musik] Fehler beim Deaktivieren fuer Guild ${guildId}:`, error);
            throw error;
        }
    }

    /**
     * Navigation registrieren.
     *
     * Laeuft bei jedem Start ueber `onGuildEnable`. Das vorangestellte
     * `removeNavigation` raeumt Altbestand weg - `registerNavigation`
     * ueberspringt Vorhandenes, loescht aber nie.
     *
     * @param {string} guildId Discord-Guild-ID
     * @private
     */
    async _registerNavigation(guildId) {
        const Logger = ServiceManager.get('Logger');
        const navigationManager = ServiceManager.get('navigationManager');

        const basis = `/guild/${guildId}/plugins/music`;
        const haupt = navigationManager.menuTypes.MAIN;

        const navItems = [
            {
                title: 'music:NAV.MUSIC',
                url: basis,
                icon: 'fa-solid fa-music',
                order: null,
                type: haupt,
                capability: 'MUSIC.VIEW',
                visible: true,
                guildId,
                parent: null
            },
            {
                title: 'music:NAV.DASHBOARD',
                url: `${basis}/dashboard`,
                icon: 'fa-solid fa-play',
                order: 10,
                type: haupt,
                capability: 'MUSIC.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'music:NAV.QUEUE',
                url: `${basis}/warteschlange`,
                icon: 'fa-solid fa-list-ol',
                order: 20,
                type: haupt,
                capability: 'MUSIC.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'music:NAV.PLAYLISTS',
                url: `${basis}/listen`,
                icon: 'fa-solid fa-rectangle-list',
                order: 30,
                type: haupt,
                capability: 'MUSIC.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'music:NAV.FILES',
                url: `${basis}/dateien`,
                icon: 'fa-solid fa-file-audio',
                order: 35,
                type: haupt,
                capability: 'MUSIC.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'music:NAV.HISTORY',
                url: `${basis}/verlauf`,
                icon: 'fa-solid fa-clock-rotate-left',
                order: 40,
                type: haupt,
                capability: 'MUSIC.HISTORY.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            // Einstellungsseite haengt unter den Kern-Einstellungen
            {
                title: 'music:NAV.MUSIC',
                url: `${basis}/settings`,
                icon: 'fa-solid fa-music',
                order: null,
                type: haupt,
                capability: 'MUSIC.VIEW',
                visible: true,
                guildId,
                parent: `/guild/${guildId}/settings`
            }
        ];

        try {
            await navigationManager.removeNavigation(this.name, guildId);
            await navigationManager.registerNavigation(this.name, guildId, navItems);
            Logger.debug(`[Musik] Navigation registriert (${navItems.length} Eintraege)`);
        } catch (error) {
            Logger.error('[Musik] Fehler beim Registrieren der Navigation:', error);
        }
    }
}

module.exports = MusicDashboardPlugin;
