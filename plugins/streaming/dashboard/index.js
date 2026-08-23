'use strict';

/**
 * Streaming - Dashboard-Plugin
 *
 * Angelegt am 2026-08-23 nach dem Muster, das bei Musik entstanden ist. Die
 * dort gesammelten Fallen sind hier von Anfang an vermieden:
 *
 *   - Rechteschluessel in Punktschreibweise, deckungsgleich mit permissions.json
 *   - `removeNavigation` vor `registerNavigation`, weil letzteres nie loescht
 *   - kein Verlass auf `onUpdate` - der Haken hat projektweit keinen Aufrufer
 *   - Lesen mit VIEW, Schreiben mit den engeren Rechten, in JEDER Route
 *   - jede Tabelle hat eine Ansicht, sonst waere sie tot
 *
 * Der Bauplan steht in docs/streamer-plugin/ - Wiedereinstieg ueber STAND.md.
 *
 * @author FireBot Team
 */

const { DashboardPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

class StreamingDashboardPlugin extends DashboardPlugin {
    constructor(app) {
        super({
            name: 'streaming',
            displayName: 'Streaming',
            description: 'Meldet im Discord, wenn ein beobachteter Kanal live geht',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
            icon: 'fa-solid fa-satellite-dish',
            baseDir: __dirname,
            publicAssets: true
        });

        this.app = app;
        this.guildRouter = require('express').Router({ mergeParams: true });
    }

    /**
     * Plugin aktivieren.
     *
     * @param {Object} app Express-App
     * @param {Object} dbService Datenbank-Dienst
     * @returns {Promise<boolean>} true bei Erfolg
     */
    async onEnable(app, dbService) {
        const Logger = ServiceManager.get('Logger');
        Logger.info('Aktiviere [Streaming] Dashboard-Plugin...');

        this._setupRoutes();
        await this._zugangsdatenPruefen();

        Logger.success('[Streaming] Dashboard-Plugin aktiviert');
        return true;
    }

    /**
     * Beim Start einmal deutlich sagen, ob die Plattform-Zugangsdaten da sind.
     *
     * Ohne sie laesst sich kein Abonnement anlegen - und das faellt sonst
     * erst auf, wenn jemand einen Kanal eintraegt und eine unverstaendliche
     * Fehlermeldung bekommt. Stilles Nichtstun ist der schlimmste
     * Fehlerzustand.
     *
     * @private
     */
    async _zugangsdatenPruefen() {
        const Logger = ServiceManager.get('Logger');
        try {
            const { zugangsdaten } = require('../shared/models');
            const daten = await zugangsdaten('TWITCH');

            if (daten.quelle === 'dashboard' || daten.quelle === 'env') {
                Logger.info(`[Streaming] Twitch-Zugangsdaten gefunden (Quelle: ${daten.quelle})`);
            } else if (daten.quelle === 'defekt') {
                Logger.error('[Streaming] Twitch-Secret liegt vor, laesst sich aber nicht entschluesseln - bitte im Betrieb neu setzen');
            } else {
                Logger.warn('[Streaming] Keine Twitch-Zugangsdaten hinterlegt - es koennen keine Abos angelegt werden. Einzutragen unter Streaming > Betrieb.');
            }
        } catch (error) {
            Logger.warn(`[Streaming] Zugangsdaten nicht pruefbar: ${error.message}`);
        }
    }

    /**
     * Router einhaengen.
     *
     * @private
     */
    _setupRoutes() {
        const Logger = ServiceManager.get('Logger');

        // Seiten-Router zuletzt: er faengt mit '/' auch die Startseite
        this.guildRouter.use('/', require('./routes/guild.router'));

        Logger.info('[Streaming] Routen registriert (1 Router)');
    }

    /**
     * @returns {Promise<boolean>} true bei Erfolg
     */
    async onDisable() {
        ServiceManager.get('Logger').info('[Streaming] Dashboard-Plugin deaktiviert');
        return true;
    }

    /**
     * Plugin in einer Guild aktivieren.
     *
     * @param {string} guildId Discord-Guild-ID
     */
    async onGuildEnable(guildId) {
        await this._registerNavigation(guildId);
        ServiceManager.get('Logger').info(`[Streaming] Plugin fuer Guild ${guildId} aktiviert`);
    }

    /**
     * Plugin in einer Guild deaktivieren.
     *
     * Entfernt werden die Ziele DIESER Guild - nicht die Streamer. Die sind
     * global und gehoeren anderen Guilds mit; wer sie hier loeschte, naehme
     * fremden Servern ihre Ankuendigungen weg.
     *
     * Die verwaisten Abos raeumt der taegliche Abgleich ab (Stufe 6).
     *
     * @param {string} guildId Discord-Guild-ID
     * @returns {Promise<boolean>} true bei Erfolg
     */
    async onGuildDisable(guildId) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        try {
            await ServiceManager.get('navigationManager').removeNavigation(this.name, guildId);

            // Reihenfolge zaehlt wegen der Fremdschluessel auf den Zielen
            const abfragen = [
                `DELETE FROM streaming_messages
                  WHERE target_id IN (SELECT id FROM streaming_targets WHERE guild_id = ?)`,
                'DELETE FROM streaming_outbox  WHERE guild_id = ?',
                'DELETE FROM streaming_targets WHERE guild_id = ?'
            ];

            for (const sql of abfragen) {
                try {
                    await dbService.query(sql, [guildId]);
                } catch (e) {
                    if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
                }
            }

            Logger.success(`[Streaming] Ziele der Guild ${guildId} entfernt (Streamer bleiben - sie sind global)`);
            return true;
        } catch (error) {
            Logger.error(`[Streaming] Fehler beim Deaktivieren fuer Guild ${guildId}:`, error);
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

        const basis = `/guild/${guildId}/plugins/streaming`;
        const haupt = navigationManager.menuTypes.MAIN;

        const eintrag = (titel, url, icon, order, extra = {}) => ({
            title: `streaming:${titel}`,
            url, icon, order,
            type: haupt,
            capability: 'STREAMING.VIEW',
            visible: true,
            guildId,
            parent: basis,
            ...extra
        });

        const navItems = [
            {
                title: 'streaming:NAV.STREAMING',
                url: basis,
                icon: 'fa-solid fa-satellite-dish',
                order: null,
                type: haupt,
                capability: 'STREAMING.VIEW',
                visible: true,
                guildId,
                parent: null
            },
            eintrag('NAV.STREAMERS', `${basis}/streamer`, 'fa-solid fa-video', 10),
            eintrag('NAV.TARGETS',   `${basis}/ziele`,    'fa-solid fa-bullseye', 20),
            eintrag('NAV.TEMPLATES', `${basis}/vorlagen`, 'fa-solid fa-comment-dots', 30),
            eintrag('NAV.STATE',     `${basis}/zustand`,  'fa-solid fa-heart-pulse', 40),

            // Einstiegspunkt unter den Kern-Einstellungen
            {
                title: 'streaming:NAV.STREAMING',
                url: basis,
                icon: 'fa-solid fa-satellite-dish',
                order: null,
                type: haupt,
                capability: 'STREAMING.VIEW',
                visible: true,
                guildId,
                parent: `/guild/${guildId}/settings`
            }
        ];

        // Betriebsseite: nur in der Kontroll-Guild, und dort nur fuer den
        // Serverbesitzer.
        //
        // `requiresOwner` allein reicht dafuer NICHT - nachgesehen in
        // `NavigationManager.js:545-556`: Es prueft `is_owner`, und das kommt
        // aus `PermissionManager.js:162` als `guild.owner_id === userId`. Das
        // ist der **Guild**-Besitzer, nicht der Betreiber der Anlage. Ohne die
        // Einschraenkung auf CONTROL_GUILD_ID saehe jeder Serverbesitzer einen
        // Menuepunkt "Betrieb" - und dahinter stehen die Zugangsdaten der
        // ganzen Anlage. Die Route selbst haengt zusaetzlich an CheckAdmin
        // (SYSTEM.ACCESS); ein sichtbarer Punkt, der 403 liefert, waere
        // trotzdem eine falsche Einladung.
        if (String(guildId) === String(process.env.CONTROL_GUILD_ID || '')) {
            navItems.push(
                eintrag('NAV.OPERATIONS', `${basis}/betrieb`, 'fa-solid fa-sliders', 50, {
                    capability: null,
                    requiresOwner: true
                })
            );
        }

        try {
            await navigationManager.removeNavigation(this.name, guildId);
            await navigationManager.registerNavigation(this.name, guildId, navItems);
            Logger.debug(`[Streaming] Navigation registriert (${navItems.length} Eintraege)`);
        } catch (error) {
            Logger.error('[Streaming] Fehler beim Registrieren der Navigation:', error);
        }
    }
}

module.exports = StreamingDashboardPlugin;
