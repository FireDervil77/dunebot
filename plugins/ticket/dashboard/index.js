/**
 * Ticket - Dashboard-Plugin
 *
 * Umbau am 2026-08-07: Aus einer Seite mit drei Tabs wurde ein eigenstaendiger
 * Bereich mit eigener Navigation - nach dem Vorbild von gameserver,
 * masterserver, automod, moderation, giveaway und greeting.
 *
 * @author FireBot Team
 */

const { DashboardPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

class TicketPlugin extends DashboardPlugin {
    constructor(app) {
        super({
            name: 'ticket',
            displayName: 'Tickets',
            description: 'Ticket-System mit Kategorien, Transkripten und Textbausteinen',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
            icon: 'fa-solid fa-ticket',
            baseDir: __dirname,
            ownerOnly: false,
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
        Logger.info('Aktiviere [Ticket] Dashboard-Plugin...');

        this._registerAssets();
        this._setupRoutes();

        Logger.success('[Ticket] Dashboard-Plugin aktiviert');
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
            Logger.warn('[Ticket] AssetManager nicht verfuegbar - Assets werden nicht angemeldet');
            return;
        }

        assetManager.registerScript('ticket-actions', 'js/ticket-actions.js', {
            plugin: 'ticket',
            deps: [],
            version: this.version,
            inFooter: true
        });

        Logger.debug('[Ticket] Assets angemeldet (1 Skript)');
    }

    /**
     * Router einhaengen.
     *
     * @private
     */
    _setupRoutes() {
        const Logger = ServiceManager.get('Logger');

        this.guildRouter.use('/settings', require('./routes/settings.router'));
        this.guildRouter.use('/categories', require('./routes/categories.router'));
        this.guildRouter.use('/tags', require('./routes/tags.router'));
        this.guildRouter.use('/tickets/api', require('./routes/tickets.router'));

        // Seiten zuletzt: der Seiten-Router faengt mit '/' auch die Startseite
        this.guildRouter.use('/', require('./routes/guild.router'));

        Logger.info('[Ticket] Routen registriert (5 Router)');
    }

    async onDisable() {
        ServiceManager.get('Logger').info('[Ticket] Dashboard-Plugin deaktiviert');
        return true;
    }

    /**
     * Plugin in einer Guild aktivieren
     *
     * @param {string} guildId Discord-Guild-ID
     */
    async onGuildEnable(guildId) {
        await this._registerNavigation(guildId);
        ServiceManager.get('Logger').info(`[Ticket] Plugin fuer Guild ${guildId} aktiviert`);
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

            // Reihenfolge zaehlt wegen der Fremdschluessel. `ticket_tags` kam
            // beim Umbau am 2026-08-07 dazu - vorher blieben die Bausteine
            // einer abgeschalteten Guild in der Tabelle stehen.
            const abfragen = [
                'DELETE FROM ticket_transcripts WHERE guild_id = ?',
                'DELETE FROM tickets WHERE guild_id = ?',
                'DELETE FROM ticket_categories WHERE guild_id = ?',
                'DELETE FROM ticket_tags WHERE guild_id = ?',
                'DELETE FROM ticket_settings WHERE guild_id = ?'
            ];

            for (const sql of abfragen) {
                try {
                    await dbService.query(sql, [guildId]);
                } catch (e) {
                    // Eine noch nie angelegte Tabelle ist kein Fehler
                    if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
                }
            }

            Logger.success(`[Ticket] Daten fuer Guild ${guildId} entfernt`);
            return true;
        } catch (error) {
            Logger.error(`[Ticket] Fehler beim Deaktivieren fuer Guild ${guildId}:`, error);
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
     * @param {string} guildId Discord-Guild-ID
     * @private
     */
    async _registerNavigation(guildId) {
        const Logger = ServiceManager.get('Logger');
        const navigationManager = ServiceManager.get('navigationManager');

        const basis = `/guild/${guildId}/plugins/ticket`;
        const haupt = navigationManager.menuTypes.MAIN;

        const navItems = [
            {
                title: 'ticket:NAV.TICKET',
                url: basis,
                icon: 'fa-solid fa-ticket',
                order: null,
                type: haupt,
                capability: 'TICKET.VIEW',
                visible: true,
                guildId,
                parent: null
            },
            {
                title: 'ticket:NAV.DASHBOARD',
                url: `${basis}/dashboard`,
                icon: 'fa-solid fa-gauge-high',
                order: 10,
                type: haupt,
                capability: 'TICKET.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'ticket:NAV.TICKETS',
                url: `${basis}/tickets`,
                icon: 'fa-solid fa-inbox',
                order: 20,
                type: haupt,
                capability: 'TICKET.TICKETS.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'ticket:NAV.CATEGORIES',
                url: `${basis}/kategorien`,
                icon: 'fa-solid fa-folder-tree',
                order: 30,
                type: haupt,
                capability: 'TICKET.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'ticket:NAV.TAGS',
                url: `${basis}/bausteine`,
                icon: 'fa-solid fa-comment-dots',
                order: 40,
                type: haupt,
                capability: 'TICKET.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            // Einstellungsseite haengt unter den Kern-Einstellungen
            {
                title: 'ticket:NAV.TICKET',
                url: `${basis}/settings`,
                icon: 'fa-solid fa-ticket',
                order: null,
                type: haupt,
                capability: 'TICKET.VIEW',
                visible: true,
                guildId,
                parent: `/guild/${guildId}/settings`
            }
        ];

        try {
            await navigationManager.removeNavigation(this.name, guildId);
            await navigationManager.registerNavigation(this.name, guildId, navItems);
            Logger.debug(`[Ticket] Navigation registriert (${navItems.length} Eintraege)`);
        } catch (error) {
            Logger.error('[Ticket] Fehler beim Registrieren der Navigation:', error);
        }
    }
}

module.exports = TicketPlugin;
