/**
 * Masterserver Plugin - Dashboard Integration
 * Verwaltet alle Nötigen Strukturen um die Plattform für die anderen Plugins zu Bilden!
 * 
 * @module masterserver/dashboard
 * @author FireBot Team
 */

const { DashboardPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

class MasterserverDashboardPlugin extends DashboardPlugin {
    constructor(app) {
        super({
            name: 'masterserver',
            displayName: 'Masterserver',
            description: 'Verwalte alle deine Server hier über ein zentrales Modul.',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
            icon: 'fa-solid fa-server',
            baseDir: __dirname,
            publicAssets: true
        });
        
        this.app = app;
        this.guildRouter = require('express').Router();
        this.baseRouter = require('express').Router();
    }

     /**
     * Plugin aktivieren (System-weit)
     * Wird nur EINMAL beim Dashboard-Start aufgerufen
     * 
     * @param {Object} app - Express App-Instanz
     * @param {Object} dbService - Datenbank-Service
     */
    async onEnable(app, dbService) {
        const Logger = ServiceManager.get('Logger');
        Logger.info('Aktiviere [Masterserver] Dashboard-Plugin...');

        this.app = app;
        this._setupRoutes(); // testen ob es aktiviert wird
        this._registerHooks(); // testen ob die ausgeführt werden
        this._registerWidgets();

        // Seed Standard-Quota-Profile
        try {
            const QuotaProfile = require('./models/QuotaProfile');
            await QuotaProfile.seedDefaultProfiles();
            Logger.info('[Masterserver] Standard-Quota-Profile initialisiert');
        } catch (error) {
            Logger.error('[Masterserver] Fehler beim Seeden der Quota-Profile:', error);
        }

        // `rootserver_ips` und die Overallocation-Spalten wurden hier bis zum
        // 2026-08-02 bei jedem Start per CREATE TABLE / ALTER TABLE nachgezogen.
        // Beides steht jetzt in `migrations/20260802_101500_ressourcen_eine_wahrheit.js`,
        // wo Schemaänderungen hingehören — einmal ausgeführt und in
        // `plugin_migrations` vermerkt, statt bei jedem Start erneut versucht.

        // Alte Daemon-Logs abräumen und täglich dranbleiben.
        await this._raeumeDaemonLogs();
        this.logAufraeumer = setInterval(() => this._raeumeDaemonLogs(), 24 * 60 * 60 * 1000);
        this.logAufraeumer.unref?.();

        Logger.success('[Masterserver] Dashboard-Plugin aktiviert');
        return true;
    }

    /**
     * Plugin deaktivieren (System-weit)
     */
    async onDisable() {
        const Logger = ServiceManager.get('Logger');
        Logger.info('Deaktiviere [Masterserver] Dashboard-Plugin...');

        if (this.logAufraeumer) {
            clearInterval(this.logAufraeumer);
            this.logAufraeumer = null;
        }
        return true;
    }

    /**
     * Löscht Daemon-Logs, die älter sind als die eingestellte Aufbewahrungsdauer.
     *
     * `LOG_RETENTION_DAYS` wurde bis zum 2026-08-02 nur auf der Logs-Seite
     * angezeigt — aufgeräumt hat nie jemand, die Tabelle wuchs unbegrenzt. Die
     * Dauer ist pro Guild einstellbar, also wird auch pro Guild gelöscht.
     *
     * @private
     */
    async _raeumeDaemonLogs() {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        try {
            const guilds = await dbService.query('SELECT DISTINCT guild_id FROM daemon_logs');
            let geloescht = 0;

            for (const { guild_id } of guilds) {
                const tage = parseInt(
                    await dbService.getConfig('masterserver', 'LOG_RETENTION_DAYS', 'shared', guild_id) || '30',
                    10
                );
                if (!Number.isFinite(tage) || tage <= 0) continue;   // 0 = unbegrenzt aufheben

                const ergebnis = await dbService.query(
                    'DELETE FROM daemon_logs WHERE guild_id = ? AND created_at < DATE_SUB(NOW(), INTERVAL ? DAY)',
                    [guild_id, tage]
                );
                geloescht += ergebnis.affectedRows || 0;
            }

            if (geloescht > 0) {
                Logger.info(`[Masterserver] ${geloescht} abgelaufene Daemon-Log-Einträge entfernt`);
            }
        } catch (error) {
            Logger.error('[Masterserver] Aufräumen der Daemon-Logs fehlgeschlagen:', error);
        }
    }


    async onGuildEnable(guildId, app, dbService) {
        const Logger = ServiceManager.get('Logger');
        Logger.info(`Aktiviere [Masterserver] Dashboard-Plugin für Guild ${guildId}...`);
         await this._registerNavigation(guildId);
    }

    

    /**
     * Guild-spezifische Deaktivierung
     * Entfernt guild-spezifische Daten und räumt alle Masterserver-Ressourcen auf
     * 
     * ⚠️ WICHTIG: Gameserver-Plugin MUSS zuerst deaktiviert werden!
     * 
     * Cleanup-Prozess:
     * 1. Dependency Check (Gameserver-Plugin darf nicht aktiv sein)
     * 2. Safety Check (keine Gameserver mehr auf Rootservern)
     * 3. System-User vom Daemon löschen (IPM)
     * 4. Rootserver aus DB löschen
     * 5. Daemon-Instances aus DB löschen
     * 
     * @param {string} guildId - Discord Guild ID
     * @throws {Error} Wenn Gameserver-Plugin noch aktiv ist
     * @throws {Error} Wenn noch Gameserver auf Rootservern existieren
     */
    async onGuildDisable(guildId) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        const ipmServer = ServiceManager.get('ipmServer');
        const navigationManager = ServiceManager.get('navigationManager');
        
        try {
            Logger.warn(`[Masterserver] Deaktiviere Plugin für Guild ${guildId} - Cleanup starten...`);
            
            // ════════════════════════════════════════════════════════════
            // 1. DEPENDENCY CHECK: Gameserver-Plugin darf nicht aktiv sein!
            // ════════════════════════════════════════════════════════════
            const gameserverActive = await this._isPluginActiveInGuild(guildId, 'gameserver');
            if (gameserverActive) {
                throw new Error(
                    'Das Gameserver-Plugin muss zuerst deaktiviert werden! ' +
                    'Deaktiviere zuerst alle abhängigen Plugins, bevor du Masterserver deaktivierst.'
                );
            }
            
            // ════════════════════════════════════════════════════════════
            // 2. Alle Rootserver der Guild holen
            // ════════════════════════════════════════════════════════════
            const rootservers = await dbService.query(
                'SELECT * FROM rootserver WHERE guild_id = ?',
                [guildId]
            );
            
            Logger.info(`[Masterserver] ${rootservers.length} Rootserver gefunden für Guild ${guildId}`);
            
            // ════════════════════════════════════════════════════════════
            // 3. SAFETY CHECK: Keine Gameserver mehr auf Rootservern
            // ════════════════════════════════════════════════════════════
            for (const rs of rootservers) {
                const [count] = await dbService.query(
                    'SELECT COUNT(*) as count FROM gameservers WHERE rootserver_id = ?',
                    [rs.id]
                );
                
                if (count.count > 0) {
                    throw new Error(
                        `Rootserver "${rs.name}" hat noch ${count.count} aktive Gameserver! ` +
                        'Dies sollte nicht passieren - bitte Gameserver-Plugin zuerst deaktivieren.'
                    );
                }
            }
            
            // ════════════════════════════════════════════════════════════
            // 4. Virtuelle Server auf den Daemons abräumen
            //
            // Hier stand bis zum 2026-08-02 ein Cleanup, der pro Daemon einen
            // Linux-System-User löschen wollte (`rootserver.delete_user`). Er
            // hat nie gelaufen: Migration 2.0.0 hat `rootserver.system_user` auf
            // "[DEPRECATED] Legacy gs-User, nicht mehr benutzt" gesetzt, seither
            // schreibt `RootServer.create()` die Spalte nicht mehr, und die
            // Bedingung `if (rs.system_user && ...)` war damit immer falsch.
            // Im Docker-Betrieb gibt es keinen Guild-User mehr, der zu löschen
            // wäre — abzuräumen ist das Verzeichnis des virtuellen Servers.
            // ════════════════════════════════════════════════════════════
            const daemonsGesehen = new Set();

            for (const rs of rootservers) {
                daemonsGesehen.add(rs.daemon_id);

                if (!ipmServer?.isDaemonOnline(rs.daemon_id)) {
                    Logger.warn(`[Masterserver] Daemon ${rs.daemon_id} offline — Verzeichnis von RootServer ${rs.id} bleibt liegen`);
                    continue;
                }

                try {
                    await ipmServer.sendCommand(rs.daemon_id, 'virtual.delete', {
                        daemon_id: rs.daemon_id,
                        rootserver_id: rs.id
                    }, 30000);
                    Logger.success(`[Masterserver] Virtueller Server ${rs.id} auf dem Daemon entfernt`);
                } catch (error) {
                    Logger.error(`[Masterserver] virtual.delete für RootServer ${rs.id} fehlgeschlagen:`, error);
                    // Weitermachen — der DB-Cleanup ist wichtiger.
                }
            }

            // ════════════════════════════════════════════════════════════
            // 5. Rootserver löschen (CASCADE löscht server_registry, Quotas etc.)
            //    daemon_instances existiert nicht mehr (seit Migration 2.0.0)
            // ════════════════════════════════════════════════════════════

            const rootserverResult = await dbService.query(
                'DELETE FROM rootserver WHERE guild_id = ?',
                [guildId]
            );

            Logger.info(`[Masterserver] ${rootserverResult.affectedRows} RootServer aus DB gelöscht`);
            
            // ════════════════════════════════════════════════════════════
            // 6. Navigation entfernen (wird automatisch vom PluginManager gemacht)
            // ════════════════════════════════════════════════════════════
            await navigationManager.removeNavigation(this.name, guildId);
            
            // ════════════════════════════════════════════════════════════
            // 7. Zusammenfassung & Warnungen
            // ════════════════════════════════════════════════════════════
            Logger.success(`[Masterserver] Cleanup erfolgreich abgeschlossen für Guild ${guildId}`);
            Logger.info(`[Masterserver] Gelöscht: ${rootservers.length} RootServer auf ${daemonsGesehen.size} Daemon(s)`);

            const offline = rootservers.filter(rs => !ipmServer?.isDaemonOnline(rs.daemon_id));
            if (offline.length) {
                Logger.warn(`[Masterserver] ⚠️  ${offline.length} Daemon(s) waren offline — deren Verzeichnisse bleiben liegen:`);
                for (const rs of offline) {
                    Logger.warn(`[Masterserver] → RootServer ${rs.id} (${rs.name}) auf Daemon ${rs.daemon_id}`);
                }
            }
            
            return true;
        } catch (error) {
            Logger.error(`[Masterserver] Fehler beim Deaktivieren für Guild ${guildId}:`, error);
            throw error;
        }
    }

    /**
     * Hilfsfunktion: Prüft ob ein Plugin in einer Guild aktiv ist
     * 
     * @param {string} guildId - Discord Guild ID
     * @param {string} pluginName - Name des zu prüfenden Plugins
     * @returns {Promise<boolean>} True wenn Plugin aktiv ist
     * @private
     */
    async _isPluginActiveInGuild(guildId, pluginName) {
        const dbService = ServiceManager.get('dbService');
        
        // ✅ Neue guild_plugins Tabelle verwenden (korrekte Spalte: is_enabled)
        const [plugin] = await dbService.query(
            'SELECT is_enabled FROM guild_plugins WHERE guild_id = ? AND plugin_name = ?',
            [guildId, pluginName]
        );
        
        return plugin ? plugin.is_enabled === 1 : false;
    }


    /**
         * Routen einrichten
         * Unterscheidet zwischen Base-Level (selten) und Guild-Level (häufig)
         * 
         * @private
         */
        _setupRoutes() {
            const Logger = ServiceManager.get('Logger');
            
            try {
                // `routes/settings.router.js` hing hier bis zum 2026-08-02 als
                // baseRouter. Die Datei enthielt keine einzige Route, nur einen
                // auskommentierten Entwurf für ein Admin-Panel.

                // === GUILD-LEVEL ROUTES (Per-Guild, häufig genutzt) ===
                const guildRouter = require('./routes/guild.router');
                this.guildRouter.use('/', guildRouter);
                
                // === ROOTSERVER ROUTES (Neue Multi-RootServer-Verwaltung) ===
                const rootserverRouter = require('./routes/rootserver.router');
                this.guildRouter.use('/rootservers', rootserverRouter);
                
                // === QUOTA MANAGEMENT ROUTES (Ressourcen-Verwaltung) ===
                const quotasRouter = require('./routes/quotas.router');
                this.guildRouter.use('/quotas', quotasRouter);
                
                // === TASK API ROUTES (Task-Queue-Management) ===
                const taskRouter = require('./routes/task.router');
                this.guildRouter.use('/api/tasks', taskRouter);
                
                // === TASK UI ROUTES (Task-Details-Seiten) ===
                const taskUIRouter = require('./routes/task-ui.router');
                this.guildRouter.use('/tasks', taskUIRouter);
                
                Logger.debug('[Masterserver] Routen registriert (Guild + RootServer + Quotas + Task API + Task UI)');
            } catch (error) {
                Logger.error('[Masterplugin] Fehler beim Einrichten der Routen:', error);
                throw error;
            }
        }

      /**
       * Hooks registrieren (falls benötigt)
       * @private
       */
      _registerHooks() {
          const Logger = ServiceManager.get('Logger');
          // Derzeit keine Hooks benötigt
          Logger.debug('[Masterserver] Hooks registriert');
      }

    /**
     * Haupt-Dashboard Widget registrieren
     * Zeigt RootServer-Status im Guild-Dashboard wenn das Plugin aktiv ist
     */
    _registerWidgets() {
        const Logger = ServiceManager.get('Logger');
        const pluginManager = ServiceManager.get('pluginManager');
        if (!pluginManager?.hooks) {
            Logger.warn('[Masterserver] PluginManager/Hooks nicht verfügbar – Widget nicht registriert');
            return;
        }

        pluginManager.hooks.addFilter('guild_dashboard_widgets', async (widgets, options) => {
            const { guildId, enabledPlugins, themeManager: tm } = options;

            // Nur wenn Plugin für diese Guild aktiv ist
            const isActive = Array.isArray(enabledPlugins)
                ? enabledPlugins.some(p => p === 'masterserver' || p?.name === 'masterserver')
                : false;
            if (!isActive) return widgets;

            try {
                const RootServer = require('./models/RootServer');
                const rootservers = await RootServer.getByGuild(guildId);

                const themeManager = tm || ServiceManager.get('themeManager');
                const content = await themeManager.renderWidgetPartial('rootserver-status', {
                    guildId,
                    rootservers,
                    plugin: 'masterserver'
                });

                widgets.push({
                    id: 'masterserver-rootserver-status',
                    title: 'RootServer',
                    area: 'dashboard-secondary',
                    position: 50,
                    size: 4,
                    icon: 'fa-solid fa-server',
                    cardClass: '',
                    content
                });
            } catch (err) {
                Logger.error('[Masterserver] Fehler beim Rendern des RootServer-Widgets:', err);
            }

            return widgets;
        });

        Logger.debug('[Masterserver] RootServer-Widget registriert');
    }

      /**
     * Navigation für das Plugin registrieren
     * @private
     * @param {string} guildId - Discord Guild ID
     */
    async _registerNavigation(guildId) {
        const Logger = ServiceManager.get('Logger');
        const navigationManager = ServiceManager.get('navigationManager');

        const navItems = [
            // Hauptmenü-Item: Masterserver
            {
                title: 'masterserver:NAV.MASTERSERVER',
                url: `/guild/${guildId}/plugins/masterserver`,
                icon: 'fa-solid fa-server',
                order: null,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                capability: 'MASTERSERVER.VIEW',
                guildId,
                parent: null
            },
            // Submenü: Übersicht
            {
                title: 'masterserver:NAV.DASHBOARD',
                url: `/guild/${guildId}/plugins/masterserver/dashboard`,
                icon: 'fa-solid fa-gauge-high',
                order: 10,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                capability: 'MASTERSERVER.VIEW',
                guildId,
                parent: `/guild/${guildId}/plugins/masterserver`
            },
            // Submenü: RootServer (Maschinen / Nodes)
            {
                title: 'masterserver:NAV.ROOTSERVERS',
                url: `/guild/${guildId}/plugins/masterserver/rootservers`,
                icon: 'fa-solid fa-server',
                order: 20,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                capability: 'MASTERSERVER.ROOTSERVER.VIEW',
                guildId,
                parent: `/guild/${guildId}/plugins/masterserver`
            },
            // Submenü: Ressourcen (Quota-Profile, Overallocation)
            {
                title: 'masterserver:NAV.RESOURCES',
                url: `/guild/${guildId}/plugins/masterserver/quotas`,
                icon: 'fa-solid fa-chart-pie',
                order: 30,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                capability: 'MASTERSERVER.RESOURCES.VIEW',
                guildId,
                parent: `/guild/${guildId}/plugins/masterserver`
            },
            // Submenü: Logs (Audit-Trail)
            {
                title: 'masterserver:NAV.LOGS',
                url: `/guild/${guildId}/plugins/masterserver/logs`,
                icon: 'fa-solid fa-file-lines',
                order: 40,
                type: navigationManager.menuTypes.MAIN,
                visible: true,
                capability: 'MASTERSERVER.LOGS.VIEW',
                guildId,
                parent: `/guild/${guildId}/plugins/masterserver`
            }
        ];

        try {
            await navigationManager.registerNavigation(this.name, guildId, navItems);
            Logger.debug(`[Masterserver] Navigation registriert (${navItems.length} Einträge)`);
        } catch (error) {
            Logger.error('[Masterserver] Fehler beim Registrieren der Navigation:', error);
        }
    }
    
}


module.exports = MasterserverDashboardPlugin;