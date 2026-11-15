'use strict';

/**
 * Leveling - Dashboard-Plugin (LV-1a, LV-1c, K382, 2026-11-15).
 *
 * Stufe 1: eigene Navigation mit Übersicht, Rangliste, XP-Regeln, Stufen,
 * Belohnungen, Ausschlüssen, Nachrichten (LV-1f) und Datenverwaltung (LV-1i),
 * Startwerte beim Einschalten, Storno nach `automod.verstoss`, Hinweis „kein
 * Level-Kanal gewählt“ oben im Guild-Bereich (F-LV1), nachts XP von
 * Mitgliedern löschen, die vor der Frist gegangen sind (`leveling:verlassen`).
 *
 * Gelöscht wird beim Abschalten vom Kern: Tabellen nach `guildInhalte`, die
 * Fortschritte `leveling:*` über `Fortschritt.loeschePlugin`
 * (`PluginManager.disableInGuild`, Schritt 2).
 *
 * @author FireBot Team
 */

const { DashboardPlugin, VersionHelper, Ereignisse, Zeitplan } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');
const { spieleStartwerteEin } = require('../shared/vorgaben');
const Ausgabe = require('../shared/ausgabe');

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
        this._registerMeldungen();

        // Frist beim Verlassen (LV-1i Teil 2): nachts, nach der Aufbewahrung (03:30).
        const Verlassen = require('./verlassen');
        Zeitplan.eintragen('leveling:verlassen', Verlassen.TAKT, Verlassen.nachts);

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
     * Hinweis an die Verwaltung (F-LV1): Ist „Level-Kanal“ gewählt, aber kein
     * Kanal, geht keine Level-up-Nachricht hinaus. Ausgerechnet bei jedem
     * Seitenaufruf (Filter `guild_notices`, wie die Daemon-Meldung des
     * Masterservers), nicht gespeichert: Ist der Kanal gewählt, verschwindet
     * er von selbst. Nur für wen `LEVELING.CONFIGURE` hat. Die Kennung gilt
     * je Guild: Wer den Hinweis wegklickt, sieht ihn dort nicht wieder. Die
     * Vorlage gibt `message` ungeschützt aus; der Text kommt nur aus der
     * Sprachdatei.
     *
     * @private
     */
    _registerMeldungen() {
        const Logger = ServiceManager.get('Logger');
        const pluginManager = ServiceManager.get('pluginManager');
        if (!pluginManager?.hooks) {
            Logger.warn('[Leveling] Hooks nicht verfügbar, Hinweis „kein Level-Kanal“ nicht eingetragen');
            return;
        }
        pluginManager.hooks.addFilter('guild_notices', async (meldungen, options = {}) => {
            const { guildId, user, req } = options;
            if (!guildId || !user?.id) return meldungen;
            try {
                if (!await pluginManager.isPluginEnabledForGuild('leveling', guildId)) return meldungen;
                const [e] = await ServiceManager.get('dbService').query(
                    'SELECT ausgabe_modus, ausgabe_kanal FROM level_einstellungen WHERE guild_id = ?', [guildId]);
                if (!Ausgabe.kanalFehlt(e)) return meldungen;
                if (!await ServiceManager.get('permissionManager').hasPermission(user.id, guildId, 'LEVELING.CONFIGURE')) return meldungen;
                const tr = (k) => (typeof req?.translate === 'function' ? req.translate(k) : k);
                meldungen.push({
                    id: `leveling-kein-kanal-${guildId}`,
                    type: 'warning',
                    title: tr('leveling:NACHRICHTEN.MELDUNG_TITEL'),
                    message: tr('leveling:NACHRICHTEN.MELDUNG_TEXT'),
                    action_url: `/guild/${encodeURIComponent(guildId)}/plugins/leveling/nachrichten`,
                    action_text: tr('leveling:NACHRICHTEN.MELDUNG_KNOPF'),
                });
            } catch (err) {
                Logger.error('[Leveling] Hinweis „kein Level-Kanal“ nicht gebaut:', err);
            }
            return meldungen;
        });
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
            },
            {
                title: 'leveling:NAV.RANGLISTE',
                url: `${basis}/rangliste`,
                icon: 'fa-solid fa-list-ol',
                order: 15,
                type: haupt,
                capability: 'LEVELING.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'leveling:NAV.XP_REGELN',
                url: `${basis}/xp-regeln`,
                icon: 'fa-solid fa-sliders',
                order: 20,
                type: haupt,
                capability: 'LEVELING.CONFIGURE',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'leveling:NAV.STUFEN',
                url: `${basis}/stufen`,
                icon: 'fa-solid fa-stairs',
                order: 30,
                type: haupt,
                capability: 'LEVELING.VIEW',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'leveling:NAV.BELOHNUNGEN',
                url: `${basis}/belohnungen`,
                icon: 'fa-solid fa-gift',
                order: 40,
                type: haupt,
                capability: 'LEVELING.REWARDS.MANAGE',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'leveling:NAV.AUSSCHLUESSE',
                url: `${basis}/ausschluesse`,
                icon: 'fa-solid fa-filter-circle-xmark',
                order: 50,
                type: haupt,
                capability: 'LEVELING.CONFIGURE',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'leveling:NAV.NACHRICHTEN',
                url: `${basis}/nachrichten`,
                icon: 'fa-solid fa-bullhorn',
                order: 60,
                type: haupt,
                capability: 'LEVELING.CONFIGURE',
                visible: true,
                guildId,
                parent: basis
            },
            {
                title: 'leveling:NAV.DATEN',
                url: `${basis}/daten`,
                icon: 'fa-solid fa-database',
                order: 70,
                type: haupt,
                capability: 'LEVELING.DATA.EXPORT',
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
