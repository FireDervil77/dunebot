const { DashboardPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

const path = require('path');
// Dieselbe Rechnung, aus der die Serverseite ihren Messstreifen baut (B147):
// Der Live-Push schickt fertigen Text und fertige Farbe, damit im Browser keine
// zweite Formatierung entsteht, die von dieser abdriftet.
const { baueMesswerte } = require('./helpers/Serverseite');

class GameserverPlugin extends DashboardPlugin {
    constructor(app) {
        super({
            name: 'gameserver',
            displayName: 'Gameserver',
            description: 'Das Gameserver Management Plugin für FireBot',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
            icon: 'fa-solid fa-server',
            baseDir: __dirname,
            publicAssets: true // ✅ Assets aus dashboard/assets/ bereitstellen
        });
        
        this.app = app;
        this.guildRouter = require('express').Router();
        this.baseRouter = require('express').Router();

        // Öffentlicher Status (E5): haengt bewusst NICHT am guildRouter, denn der
        // steht hinter der Anmeldung. Der PluginManager haengt den apiRouter
        // unter /api/gameserver ein - ohne Auth, dafuer nur ueber ein Token
        // erreichbar, das der Betreiber je Server einschalten muss.
        this.apiRouter = require('express').Router();
        this.apiRouter.use('/', require('./routes/public'));

        // Das einbettbare Widget unter /plugin/gameserver/widget/:token.
        this.frontendRouter = require('express').Router();
        this.frontendRouter.use('/', require('./routes/widget'));

        // Guard: Event-Handler nur einmal registrieren
        this._handlersRegistered = false;
    }

    /**
     * WordPress-Style Asset Registration
     * @author FireBot Team
     */
    _registerAssets() {
        const assetManager = ServiceManager.get('assetManager');
        const Logger = ServiceManager.get('Logger');
        
        if (!assetManager) {
            Logger.warn('[Gameserver] AssetManager nicht verfügbar!');
            return;
        }
        
        // ========================================
        // VENDOR LIBRARIES (xterm.js für Console)
        // ========================================
        
        // xterm.js Core Library
        assetManager.registerScript('xterm-core', 'vendor/xterm/xterm.min.js', {
            plugin: 'gameserver',
            deps: [], 
            version: '5.3.0',
            inFooter: true, 
            defer: false
        });
        
        // xterm.js Fit Addon (für Terminal-Größenanpassung)
        assetManager.registerScript('xterm-addon-fit', 'vendor/xterm/xterm-addon-fit.min.js', {
            plugin: 'gameserver',
            deps: ['xterm-core'], 
            version: '0.8.0',
            inFooter: true, // Im Footer (WordPress-Standard)
            defer: false
        });
        
        // Das Aussehen der neuen Serverseite (Entwurf 2026-08-18).
        //
        // Bewusst als Stylesheet des PLUGINS und nicht auf eine Seite begrenzt:
        // Der ganze Gameserver-Bereich soll so aussehen wie abgenommen, nicht
        // eine Karte darin.
        assetManager.registerStyle('gameserver-serverseite', 'css/serverseite.css', {
            plugin: 'gameserver',
            deps: [],
            version: '1.0.0',
            media: 'all'
        });

        // xterm.js CSS
        assetManager.registerStyle('xterm-style', 'vendor/xterm/xterm.min.css', {
            plugin: 'gameserver',
            deps: [],
            version: '5.3.0',
            media: 'all'
        });
        
        // ========================================
        // VENDOR LIBRARIES (Monaco Editor für File-Manager)
        // ========================================
        
        // Monaco Editor Loader (AMD Module Loader - muss zuerst geladen werden!)
        assetManager.registerScript('monaco-loader', 'vendor/monaco-editor/min/vs/loader.js', {
            plugin: 'gameserver',
            deps: [],
            version: '0.45.0',
            inFooter: true,
            defer: false
        });
        
        // Monaco Editor Main (wird über require.config geladen, nicht direkt)
        // Hinweis: Das eigentliche Editor-Bundle wird per require(['vs/editor/editor.main']) geladen
        // Keine separate Script-Registration nötig - Monaco nutzt AMD-Loader!
        
        // ========================================
        // GAMESERVER PLUGIN SCRIPTS
        // ========================================
        
        // Gameserver SSE Script (für Live-Updates)
        assetManager.registerScript('gameserver-sse', 'js/gameserver-sse.js', {
            plugin: 'gameserver',
            deps: [], 
            version: this.version,
            inFooter: true,
            defer: false
        });
        
        // Console Client Script (für Live-Console mit xterm.js)
        assetManager.registerScript('gameserver-console', 'js/console-client.js', {
            plugin: 'gameserver',
            deps: ['xterm-core', 'xterm-addon-fit'], // Abhängigkeiten zu xterm.js
            version: this.version,
            inFooter: true,
            defer: false
        });
        
        // Server Actions Script (für Server-Management)
        assetManager.registerScript('gameserver-actions', 'js/server-actions.js', {
            plugin: 'gameserver',
            deps: [], 
            version: this.version,
            inFooter: true,
            defer: false
        });
        
        // Servers Overview Script (für Server-Listen)
        // Die Live-Anzeige (Baustelle 62b). Braucht den SSE-Client.
        assetManager.registerScript('gameserver-live', 'js/gameserver-live.js', {
            plugin: 'gameserver',
            deps: ['gameserver-sse'],
            version: '1.0.0',
            defer: false
        });

        assetManager.registerScript('gameserver-overview', 'js/servers-overview.js', {
            plugin: 'gameserver',
            deps: [], 
            version: this.version,
            inFooter: true,
            defer: false
        });
        
        // File Manager Script (für File-Browser mit Monaco Editor)
        assetManager.registerScript('gameserver-file-manager', 'js/file-manager.js', {
            plugin: 'gameserver',
            deps: ['monaco-loader'], // Benötigt Monaco Loader
            version: this.version,
            inFooter: true,
            defer: false
        });

        Logger.debug('[Gameserver] Assets registriert (8 Scripts + 1 Style: xterm.js, Monaco, Console, Actions, Overview, File-Manager)');
    }


    
    /**
     * Plugin aktivieren (System-weit)
     * Wird nur EINMAL beim Dashboard-Start aufgerufen
     * @param {Object} app - Express App-Instanz
     * @param {Object} dbService - Datenbank-Service
     */
    async onEnable(app, dbService) {
        const Logger = ServiceManager.get('Logger');
        const path = require('path');
        const express = require('express');
        
        Logger.info('Aktiviere [Gameserver] Dashboard-Plugin...');

        this.app = app;

        // DB-Migrationen → jetzt via MigrationRunner (plugins/gameserver/migrations/)
        
        // ConsoleManager initialisieren und registrieren
        // WICHTIG: Bei Plugin-Reload zuerst die alte Instanz disposen, sonst
        // bleibt deren Event-Handler im IPMEventRouter hängen → jede
        // Console-Zeile wird pro Reload einmal mehr gebroadcastet (doppelt/dreifach)
        try {
            const oldConsoleManager = ServiceManager.get('consoleManager');
            if (oldConsoleManager && typeof oldConsoleManager.dispose === 'function') {
                oldConsoleManager.dispose();
                Logger.debug('[Gameserver] Alte ConsoleManager-Instanz disposed (Plugin-Reload)');
            }
        } catch (_) { /* noch keine Instanz registriert */ }
        const ConsoleManager = require('./helpers/ConsoleManager');
        const consoleManager = new ConsoleManager();
        ServiceManager.register('consoleManager', consoleManager);
        Logger.debug('[Gameserver] ConsoleManager registriert und initialisiert');

        // CronWorker initialisieren und registrieren
        // Verwaiste Migrationen aufräumen (Dashboard-Neustart bricht laufende
        // Migrationen ab — sie hingen sonst ewig als "läuft" in der DB)
        setTimeout(() => {
            try {
                require('./helpers/MigrationManager').cleanupOrphanedMigrations();
            } catch (err) {
                Logger.warn('[Gameserver] Migration-Cleanup fehlgeschlagen:', err?.message || err);
            }
        }, 5000);

        const CronWorker = require('./helpers/CronWorker');
        const cronWorker = new CronWorker();
        ServiceManager.register('gameserverCronWorker', cronWorker);
        // Startet asynchron nach kurzem Delay (DB muss bereit sein)
        setTimeout(() => {
            cronWorker.start(dbService).catch(err =>
                Logger.error('[Gameserver] CronWorker-Start fehlgeschlagen:', err.message)
            );
        }, 5000);
        Logger.debug('[Gameserver] CronWorker registriert (Start in 5s)');

        // StatusPoller: hält gameserver_status aktuell (Spielerzahlen, Map, Ping)
        const StatusPoller = require('./helpers/StatusPoller');
        const statusPoller = new StatusPoller();
        ServiceManager.register('gameserverStatusPoller', statusPoller);
        setTimeout(() => {
            try {
                statusPoller.start(dbService);
            } catch (err) {
                Logger.error('[Gameserver] StatusPoller-Start fehlgeschlagen:', err.message);
            }
        }, 5000);
        Logger.debug('[Gameserver] StatusPoller registriert (Start in 5s)');

        // ✅ Static Assets bereitstellen (WICHTIG!)
        const assetsPath = path.join(__dirname, 'assets');
        this.app.use('/assets/plugins/gameserver', express.static(assetsPath, {
            setHeaders: (res, filepath) => {
                if (filepath.endsWith('.js')) {
                    res.setHeader('Content-Type', 'application/javascript; charset=UTF-8');
                } else if (filepath.endsWith('.css')) {
                    res.setHeader('Content-Type', 'text/css; charset=UTF-8');
                }
            }
        }));
        Logger.debug(`[Gameserver] Static Assets bereitgestellt: ${assetsPath}`);
        
        this._registerAssets(); //  NEU: Assets registrieren
        this._setupRoutes();
        this._registerHooks();
        this._registerEventHandlers(); //  NEU: Event-Handler registrieren (idempotent)

        // Hier legte `_syncOfficialAddons` bis zum 2026-09-10 bei JEDEM Start
        // fehlende Alt-Addons aus shared/addons/*.json an — Eggs mit
        // parkervcp-/pterodactyl-Images. Die Spiele kommen aus Paketen.
        
        // **Steuerung fuer andere Plugins anbieten** (Baustelle 118). Der Zusatz
        // „Streamserver" im Streaming-Plugin fragt hier nach, ohne dieses Plugin
        // zu `require`n. Scheitert das Eintragen, laeuft das Plugin trotzdem -
        // der Zusatz meldet dann, dass es keinen Anbieter gibt.
        try {
            const { ServersteuerungRegistry } = require('dunebot-sdk');
            ServersteuerungRegistry.register('gameserver', require('./helpers/Serversteuerung').anbieter);
            Logger.debug('[Gameserver] Serversteuerung fuer andere Plugins eingetragen');
        } catch (err) {
            Logger.error('[Gameserver] Serversteuerung nicht eingetragen:', err);
        }

        Logger.success('[Gameserver] Dashboard-Plugin aktiviert');
        return true;
    }

    /**
     * Plugin deaktivieren (System-weit)
     */
    async onDisable() {
        const Logger = ServiceManager.get('Logger');
        Logger.info('Deaktiviere [Gameserver] Dashboard-Plugin...');
        try {
            require('dunebot-sdk').ServersteuerungRegistry.unregister('gameserver');
        } catch (err) {
            Logger.warn('[Gameserver] Serversteuerung nicht ausgetragen:', err);
        }
        // CronWorker stoppen
        const cronWorker = ServiceManager.get('gameserverCronWorker');
        if (cronWorker) cronWorker.stop();
        // StatusPoller stoppen
        const statusPoller = ServiceManager.get('gameserverStatusPoller');
        if (statusPoller) statusPoller.stop();
        return true;
    }
    

    /**
     * Registriert guild-spezifische Navigation
     * Wird aufgerufen, wenn das Plugin in einer Guild aktiviert wird
     * @param {string} guildId - Discord Guild ID
     */
    async onGuildEnable(guildId, app, dbService) {
        const Logger = ServiceManager.get('Logger');
        Logger.info(`Aktiviere [Gameserver] Dashboard-Plugin für Guild ${guildId}...`);
        
        // ✅ Assets & Routes wurden bereits in onEnable() registriert
        // ❌ NICHT erneut registrieren - führt zu Duplikaten und Rate-Limit-Problemen!
        // Event-Handler sind global; nicht erneut pro Guild registrieren
        
        await this._registerNavigation(guildId);
        
        Logger.success(`[Gameserver] Guild-spezifische Aktivierung abgeschlossen für ${guildId}`);
    }

    /**
     * Wird bei Versions-Bump automatisch aufgerufen.
     * Stellt sicher dass neue Permissions in bestehenden Administrator-Gruppen landen.
     */
    async onUpdate(oldVersion, newVersion, guildId) {
        const Logger = ServiceManager.get('Logger');
        const pluginManager = ServiceManager.get('pluginManager');
        Logger.info(`[Gameserver] Update ${oldVersion} → ${newVersion} für Guild ${guildId}, aktualisiere Permissions...`);
        try {
            const plugin = pluginManager.getPlugin('gameserver');
            if (plugin) {
                await pluginManager.registerPluginPermissionsForGuild(plugin, guildId);
            }
        } catch (err) {
            Logger.error(`[Gameserver] Fehler beim Permission-Update für Guild ${guildId}:`, err.message);
        }
        await this._registerNavigation(guildId);
    }


    /**
     * Guild-spezifische Deaktivierung
     * 
     * Cleanup-Prozess:
     * 1. Alle Gameserver der Guild laden
     * 2. Laufende Server stoppen (IPM)
     * 3. Server-Dateien deinstallieren (IPM)
     * 4. Gameserver aus DB löschen
     * 5. Private Addons & Templates löschen
     * 
     * ⚠️ Öffentliche Addons bleiben erhalten (Community-Ressource)!
     * 
     * @param {string} guildId - Discord Guild ID
     * @throws {Error} Bei kritischen Fehlern während des Cleanup
     */
    async onGuildDisable(guildId) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        const ipmServer = ServiceManager.get('ipmServer');
        const navigationManager = ServiceManager.get('navigationManager');
        
        try {
            Logger.warn(`[Gameserver] Deaktiviere Plugin für Guild ${guildId} - Cleanup starten...`);
            
            // ════════════════════════════════════════════════════════════
            // 1. Alle Gameserver der Guild holen
            // ════════════════════════════════════════════════════════════
            const servers = await dbService.query(`
                SELECT 
                    gs.*,
                    r.daemon_id,
                    r.system_user,
                    am.name as addon_name,
                    am.slug as addon_slug
                FROM gameservers gs
                LEFT JOIN rootserver r ON gs.rootserver_id = r.id
                LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
                WHERE gs.guild_id = ?
            `, [guildId]);
            
            Logger.info(`[Gameserver] ${servers.length} Gameserver gefunden für Guild ${guildId}`);
            
            if (servers.length === 0) {
                Logger.info('[Gameserver] Keine Gameserver vorhanden - überspringe Server-Cleanup');
            } else {
                // ════════════════════════════════════════════════════════════
                // 2. Jeden Gameserver stoppen & deinstallieren
                // ════════════════════════════════════════════════════════════
                let stoppedCount = 0;
                let uninstalledCount = 0;
                let offlineCount = 0;
                
                for (const server of servers) {
                    Logger.info(`[Gameserver] Verarbeite Server: ${server.name} (${server.addon_name || 'Unknown'})`);
                    
                    const daemonOnline = ipmServer?.isDaemonOnline(server.daemon_id);
                    
                    if (!daemonOnline) {
                        Logger.warn(`[Gameserver] Daemon ${server.daemon_id} offline - Server ${server.id} wird nur aus DB gelöscht`);
                        Logger.warn(`[Gameserver] → Server-Dateien müssen manuell gelöscht werden: ${server.install_path}`);
                        offlineCount++;
                        continue;
                    }
                    
                    // ────────────────────────────────────────────────────────
                    // 2a. Server stoppen (falls läuft)
                    // ────────────────────────────────────────────────────────
                    // `online`, nicht `running`: Die Spalte kennt `running` nicht
                    // (ENUM installing, installed, starting, online, stopping,
                    // offline, error, updating) — das ist ein Daemon-Wert, den
                    // diese Datei weiter unten selbst in `online` uebersetzt. Bis
                    // zum 2026-09-14 stand hier `running`, und laufende Server
                    // wurden beim Abbau des Plugins deshalb nie gestoppt, bevor
                    // ihre Dateien weg waren (Baustelle 117).
                    if (server.status === 'online' || server.status === 'starting') {
                        try {
                            Logger.info(`[Gameserver] Stoppe Server ${server.id} (${server.name})...`);
                            
                            await ipmServer.sendCommand(server.daemon_id, 'gameserver.stop', {
                                server_id: server.id.toString(),
                                rootserver_id: server.rootserver_id
                            }, 30000);
                            
                            stoppedCount++;
                            Logger.success(`[Gameserver] Server ${server.id} gestoppt`);
                            
                            // Kurz warten, bis Prozess beendet ist
                            await new Promise(resolve => setTimeout(resolve, 2000));
                        } catch (error) {
                            Logger.warn(`[Gameserver] Konnte Server ${server.id} nicht stoppen:`, error.message);
                            // Trotzdem weitermachen mit Deinstallation
                        }
                    }
                    
                    // ────────────────────────────────────────────────────────
                    // 2b. Server-Dateien deinstallieren
                    // ────────────────────────────────────────────────────────
                    try {
                        Logger.info(`[Gameserver] Deinstalliere Server ${server.id} (${server.install_path})...`);
                        
                        await ipmServer.sendCommand(server.daemon_id, 'gameserver.uninstall', {
                            server_id: server.id.toString(),
                            rootserver_id: server.rootserver_id,
                            install_path: server.install_path
                        }, 60000);  // 60s Timeout für Uninstall
                        
                        uninstalledCount++;
                        Logger.success(`[Gameserver] Server ${server.id} deinstalliert (Dateien gelöscht)`);
                    } catch (error) {
                        Logger.error(`[Gameserver] Fehler beim Deinstallieren von Server ${server.id}:`, error);
                        Logger.warn(`[Gameserver] → Server-Dateien müssen manuell gelöscht werden: ${server.install_path}`);
                        // Trotzdem weitermachen - DB-Cleanup ist wichtiger
                    }
                }
                
                Logger.info(`[Gameserver] Server-Cleanup: ${stoppedCount} gestoppt, ${uninstalledCount} deinstalliert, ${offlineCount} offline`);
            }
            
            // ════════════════════════════════════════════════════════════
            // 3. Alle Gameserver aus DB löschen
            // ════════════════════════════════════════════════════════════
            const gameserverResult = await dbService.query(
                'DELETE FROM gameservers WHERE guild_id = ?',
                [guildId]
            );
            
            Logger.info(`[Gameserver] ${gameserverResult.affectedRows} Gameserver aus DB gelöscht`);
            
            // ════════════════════════════════════════════════════════════
            // 4. Private Addons löschen (korrekte Spalte: guild_id)
            // ════════════════════════════════════════════════════════════
            const privateAddons = await dbService.query(
                'DELETE FROM addon_marketplace WHERE guild_id = ? AND visibility = "private"',
                [guildId]
            );
            
            Logger.info(`[Gameserver] ${privateAddons.affectedRows} private Addons gelöscht`);
            
            // Hinweis auf öffentliche Addons
            const publicAddonsCount = await dbService.query(
                'SELECT COUNT(*) as count FROM addon_marketplace WHERE guild_id = ? AND visibility = "public"',
                [guildId]
            );
            
            if (publicAddonsCount[0]?.count > 0) {
                Logger.info(`[Gameserver] ℹ️  ${publicAddonsCount[0].count} öffentliche Addons bleiben erhalten (Community-Ressource)`);
            }
            
            // ════════════════════════════════════════════════════════════
            // 5. Navigation entfernen
            // ════════════════════════════════════════════════════════════
            await navigationManager.removeNavigation(this.name, guildId);
            
            // ════════════════════════════════════════════════════════════
            // 6. Zusammenfassung
            // ════════════════════════════════════════════════════════════
            Logger.success(`[Gameserver] Cleanup erfolgreich abgeschlossen für Guild ${guildId}`);
            Logger.info(`[Gameserver] Zusammenfassung:`);
            Logger.info(`  → ${servers.length} Gameserver verarbeitet`);
            Logger.info(`  → ${gameserverResult.affectedRows} DB-Einträge gelöscht`);
            Logger.info(`  → ${privateAddons.affectedRows} private Addons gelöscht`);
            
            if (servers.some(s => !ipmServer?.isDaemonOnline(s.daemon_id))) {
                Logger.warn(`[Gameserver] ⚠️  Einige Daemons waren offline!`);
                Logger.warn(`[Gameserver] → Server-Dateien müssen manuell gelöscht werden!`);
            }
            
            return true;
        } catch (error) {
            Logger.error(`[Gameserver] Fehler beim Deaktivieren für Guild ${guildId}:`, error);
            throw error;
        }
    }


    /**
     * Routen einrichten
     * Unterscheidet zwischen Base-Level (selten) und Guild-Level (häufig)
     * @private
     */
    _setupRoutes() {
        const Logger = ServiceManager.get('Logger');
        
        try {
            // === GUILD-LEVEL ROUTES ===
            const addonsRouter = require('./routes/addons');
            const serversRouter = require('./routes/servers');
            const settingsRouter = require('./routes/settings');
            const filesRouter = require('./routes/files');
            const consoleRouter = require('./routes/console');
            
            // Root-Route: die Serveruebersicht IST der Einstieg (B140).
            //
            // Bis zum 2026-09-18 fuehrte sie auf `/dashboard` — eine zweite
            // Uebersicht mit eigenen Kacheln, eigener Tabelle und einem
            // ZWEITEN Live-Weg (SSE plus Inline-Skript, waehrend die
            // Uebersicht `gameserver-live.js` benutzt). Die Kacheln und die
            // rechte Spalte stehen jetzt auf der Uebersicht, die Seite ist weg.
            //
            // Die Umleitung bleibt: Lesezeichen und aeltere Verweise zeigen
            // hierher.
            this.guildRouter.get('/', (req, res) => {
                const guildId = res.locals.guildId;
                res.redirect(`/guild/${guildId}/plugins/gameserver/servers`);
            });

            // `/dashboard` ebenso — es war ein Jahr lang DIE Adresse des
            // Bereichs. Ein 404 darauf waere eine Ueberraschung ohne Nutzen.
            this.guildRouter.get('/dashboard', (req, res) => {
                const guildId = res.locals.guildId;
                res.redirect(301, `/guild/${guildId}/plugins/gameserver/servers`);
            });
            
            // Addon Marketplace
            this.guildRouter.use('/addons', addonsRouter);
            
            // Server-Management
            this.guildRouter.use('/servers', serversRouter);

            // Inhalte je Server (Mods und Lader, E6/B.12). VOR filesRouter, der
            // mit '/' alles faengt, was danach kommt.
            this.guildRouter.use('/servers', require('./routes/inhalte'));
            
            // File-Management (WebFTP) - eigener /servers/:serverId/... Prefix in files.js
            this.guildRouter.use('/', filesRouter);
            
            // Console-API (Live Console)
            this.guildRouter.use('/console', consoleRouter);
            
            // Settings
            this.guildRouter.use('/settings', settingsRouter);
            
            Logger.debug('[Gameserver] Routen registriert (Guild-Level + WebFTP + Console)');
        } catch (error) {
            Logger.error('[Gameserver] Fehler beim Einrichten der Routen:', error);
            throw error;
        }
    }

    /**
     * Registriert Event-Handler für IPM-Events vom Daemon
     * @private
     */
    _registerEventHandlers() {
        const Logger = ServiceManager.get('Logger');
        const eventRouter = require('../../../apps/dashboard/helpers/IPMEventRouter');
        const { MessageTypes } = require('dunebot-sdk');
        
        try {
            if (this._handlersRegistered) {
                Logger.debug('[Gameserver] Event-Handler bereits registriert – überspringe');
                return;
            }
            // ════════════════════════════════════════════════════════════
            // Gameserver Status Changed
            // ════════════════════════════════════════════════════════════
            eventRouter.register(
                MessageTypes.NS_GAMESERVER, 
                MessageTypes.GAMESERVER_STATUS_CHANGED, 
                this._handleStatusChanged.bind(this),
                { priority: 1 }
            );
            
            // ════════════════════════════════════════════════════════════
            // Gameserver Resource Usage
            // ════════════════════════════════════════════════════════════
            eventRouter.register(
                MessageTypes.NS_GAMESERVER, 
                MessageTypes.GAMESERVER_RESOURCE_USAGE, 
                this._handleResourceUsage.bind(this),
                { priority: 5 }
            );
            
            // ════════════════════════════════════════════════════════════
            // Gameserver Crashed
            // ════════════════════════════════════════════════════════════
            eventRouter.register(
                MessageTypes.NS_GAMESERVER, 
                MessageTypes.GAMESERVER_CRASHED, 
                this._handleCrashed.bind(this),
                { priority: 1 }
            );
            
            // ════════════════════════════════════════════════════════════
            // Platzgrenze: greift sie wirklich? (Baustellen 37)
            // ════════════════════════════════════════════════════════════
            eventRouter.register(
                MessageTypes.NS_GAMESERVER,
                MessageTypes.GAMESERVER_QUOTA_STATUS,
                this._handleQuotaStatus.bind(this),
                { priority: 5 }
            );

            // ════════════════════════════════════════════════════════════
            // Platzstand: wie voll ist der Server? (Baustelle 101, Weg C)
            // ════════════════════════════════════════════════════════════
            //
            // Die laufenden Zahlen kommen im Herzschlag (`platz_*` je Server,
            // IPMServer._updateServerRegistry). Dieses Ereignis ist der Stoß
            // für die Warnung: Es kommt beim Wechsel über die Grenze und in dem
            // Augenblick, in dem ein Start deshalb verweigert wurde — und der
            // liegt zwischen zwei Herzschlägen.
            eventRouter.register(
                MessageTypes.NS_GAMESERVER,
                MessageTypes.GAMESERVER_PLATZSTAND,
                this._handlePlatzstand.bind(this),
                { priority: 1 }
            );

            // ════════════════════════════════════════════════════════════
            // Bereitschaft: kann jemand rein? (Baustellen 58 und 62f)
            // ════════════════════════════════════════════════════════════
            //
            // Der Daemon meldet das seit dem 2026-08-20 nachweislich — hier gab
            // es dafür bis heute keinen Empfänger. Die Meldung lief ins Leere,
            // und die Karte auf der Serverseite sagte „nicht gemessen", obwohl
            // die Messung unten längst vorlag.
            eventRouter.register(
                MessageTypes.NS_GAMESERVER,
                MessageTypes.GAMESERVER_READINESS,
                this._handleReadiness.bind(this),
                { priority: 1 }
            );

            // HINWEIS: KEIN Handler für NS_CONSOLE/CONSOLE_OUTPUT hier!
            // Der ConsoleManager registriert sich selbst auf 'console:output'
            // (ConsoleManager._registerEventHandlers). Eine zweite Registrierung
            // hier führte dazu, dass jede Console-Zeile doppelt gebroadcastet wurde.

            // Install-Handler (completed, failed, output, status) werden
            // autoritativ in IPMServer._registerEventHandlers() registriert
            // und broadcasten dort mit dem korrekten SSE-Namespace 'install'.

            // ════════════════════════════════════════════════════════════
            // Installation fertig → die vorgemerkten Mods holen (E6/B.12)
            // ════════════════════════════════════════════════════════════
            //
            // ⚠ REGISTRIERT, nicht nur geschrieben. Bis zum 2026-09-12 haengte
            // dieser Aufruf in `_handleInstallCompleted` — einer Methode OHNE
            // Aufrufer. Beim ersten echten Test (Server 187) meldete der Daemon
            // „Installation abgeschlossen", und beide Mod-Zeilen blieben auf
            // `geplant`; im Log stand keine einzige Zeile davon. Die Methode ist
            // deshalb entfernt, und der Haken haengt an dem Ereignis, das
            // wirklich eintrifft: `install`/`completed`.
            //
            // Prioritaet 20 = NACH dem Kern (IPMServer registriert dasselbe
            // Ereignis mit der Vorgabe 10 und setzt dort Status und Zaehler).
            eventRouter.register(
                MessageTypes.NS_INSTALL,
                MessageTypes.INSTALL_COMPLETED,
                async (payload) => {
                    if (payload?.server_id) await this._holeVorgemerkteMods(payload.server_id);
                },
                { priority: 20 }
            );

            this._handlersRegistered = true;
            Logger.success('[Gameserver] Event-Handler registriert (5 Handler)');
        } catch (error) {
            Logger.error('[Gameserver] Fehler beim Registrieren der Event-Handler:', error);
            throw error;
        }
    }

    /**
     * Handler: meldet, ob die gebuchte Platzgrenze wirklich durchgesetzt wird.
     *
     * Der Daemon schickt das nach jedem Start. Bis Baustellen 37 stand die
     * GiB-Angabe im Dashboard und wirkte nirgends — jetzt steht dort, ob sie
     * greift, und wenn nicht, was der Betreiber am Rootserver tun muss.
     *
     * @private
     */
    async _handleQuotaStatus(payload, message, context) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        const { server_id, disk_gb, erzwungen, grund } = payload || {};
        if (!server_id) return;

        try {
            await dbService.query(
                'UPDATE gameservers SET disk_quota_enforced = ?, disk_quota_note = ? WHERE id = ?',
                [erzwungen ? 1 : 0, grund ? String(grund).slice(0, 500) : null, server_id]
            );

            if (!erzwungen) {
                Logger.warn(`[Gameserver] Platzgrenze für Server ${server_id} (${disk_gb} GiB) greift nicht: ${grund}`);
            } else {
                Logger.debug(`[Gameserver] Platzgrenze für Server ${server_id}: ${disk_gb || 'unbegrenzt'} GiB, durchgesetzt`);
            }

            const [server] = await dbService.query(
                'SELECT guild_id FROM gameservers WHERE id = ?', [server_id]
            );
            if (server) {
                ServiceManager.get('sseManager')?.broadcast(String(server.guild_id), 'gameserver', {
                    action: 'quota_status',
                    server_id,
                    disk_gb,
                    erzwungen: !!erzwungen,
                    grund: grund || null,
                });
            }
        } catch (error) {
            Logger.error('[Gameserver] Quota-Meldung konnte nicht gespeichert werden:', error);
        }
    }

    /**
     * Handler: wie voll ein Server ist (Baustelle 101, weiche Grenze).
     *
     * ── Warum hier nichts in die Datenbank geschrieben wird ─────────────────
     *
     * Die Werte stehen schon in `server_registry`, geschrieben vom Herzschlag —
     * dort kommen sie regelmäßig und vollständig an. Sie hier ein zweites Mal
     * zu schreiben hieße, zwei Schreiber auf eine Wahrheit zu setzen, und der
     * seltenere (dieses Ereignis) würde den häufigeren gelegentlich
     * überschreiben. Dieser Handler tut deshalb genau zwei Dinge: Er
     * protokolliert, und er stößt die Anzeige an.
     *
     * @private
     */
    async _handlePlatzstand(payload, message, context) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        const { server_id, belegt_bytes, grenze_bytes, prozent, ueber, geschaetzt } = payload || {};
        if (!server_id) return;

        try {
            const gib = (b) => (Number.isFinite(Number(b)) ? (Number(b) / 1024 ** 3).toFixed(1) : '?');

            if (ueber) {
                Logger.warn(`[Gameserver] Server ${server_id} über seiner Platzgrenze: `
                          + `${gib(belegt_bytes)} von ${gib(grenze_bytes)} GiB (${prozent} %)`);
            } else {
                Logger.info(`[Gameserver] Server ${server_id} wieder unter seiner Platzgrenze: `
                          + `${gib(belegt_bytes)} von ${gib(grenze_bytes)} GiB (${prozent} %)`);
            }

            const [server] = await dbService.query(
                'SELECT guild_id FROM gameservers WHERE id = ?', [server_id]
            );
            if (server) {
                ServiceManager.get('sseManager')?.broadcast(String(server.guild_id), 'gameserver', {
                    action: 'platzstand',
                    server_id,
                    belegt_bytes: belegt_bytes ?? null,
                    grenze_bytes: grenze_bytes ?? null,
                    prozent: prozent ?? null,
                    ueber: !!ueber,
                    geschaetzt: !!geschaetzt,
                });
            }
        } catch (error) {
            Logger.error('[Gameserver] Platzstand konnte nicht verarbeitet werden:', error);
        }
    }

    /**
     * Handler: die Bereitschaftsstufe von fb-init.
     *
     * ── Warum das nicht in `status` gehört ──────────────────────────────────
     *
     * `status` sagt, ob der Container läuft. Die Bereitschaft sagt, ob jemand
     * rein kann. Zwischen „läuft" und „bereit" liegen bei Valheim rund dreissig
     * Sekunden, bei einer neuen Welt Minuten — und genau in dieser Spanne schaut
     * ein Betreiber hin.
     *
     * Der Erklärsatz ist der Teil, für den fb-init überhaupt gebaut wurde:
     * „Port 2457 lauscht nach 60 s noch nicht, der Prozess läuft aber. Bei einer
     * neuen Welt ist das normal." Ohne ihn bliebe von einer dreistufigen Messung
     * ein Ampelmännchen.
     *
     * @private
     */
    async _handleReadiness(payload, message, context) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        const { server_id, stage, hinweis } = payload || {};
        if (!server_id) return;

        try {
            await dbService.query(
                `UPDATE gameservers
                    SET bereitschaft_stufe = ?, bereitschaft_grund = ?, bereitschaft_am = NOW()
                  WHERE id = ?`,
                [stage || null, hinweis ? String(hinweis).slice(0, 500) : null, server_id]
            );

            const [server] = await dbService.query(
                'SELECT guild_id, name FROM gameservers WHERE id = ?', [server_id]);
            if (!server) return;

            Logger.info(`[Gameserver] Bereitschaft ${server.name} (${server_id}): `
                + `${stage || 'unbekannt'}${hinweis ? ' — ' + hinweis : ''}`);

            ServiceManager.get('sseManager')?.broadcast(String(server.guild_id), 'gameserver', {
                action: 'readiness',
                server_id,
                stufe: stage || null,
                grund: hinweis || null,
            });
        } catch (error) {
            // Eine verlorene Bereitschaftsmeldung darf nichts kippen: Der Server
            // läuft, nur die Anzeige bleibt auf dem vorigen Stand.
            Logger.error('[Gameserver] Bereitschaft konnte nicht übernommen werden', error);
        }
    }

    /**
     * Handler: Gameserver Status Changed
     * @private
     */
    async _handleStatusChanged(payload, message, context) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        // Spät geladen, wie an den übrigen Stellen im Plugin: Beim Modul-Laden
        // steht der ServiceManager noch nicht, den diese Helfer brauchen.
        const StatusService = require('./helpers/StatusService');
        const PanelService  = require('./helpers/PanelService');

        // `error` gehoert dazu: Der Daemon schickt bei einem gescheiterten Start
        // oder Absturz den Grund mit — bis zum 2026-09-12 nahm dieser Handler
        // nur drei Felder, und der Grund fiel hier herunter. Im Dashboard stand
        // dann „error" und `error_message = NULL`; nachlesen liess es sich nur
        // im Daemon-Log, das root gehoert (0600). Genau so ist der
        // fehlgeschlagene Start von Server 188 unerklaerlich geblieben.
        const { server_id, status, timestamp, error } = payload;
        const { daemonId } = context;

        Logger.debug(`[Gameserver] Status Changed: Server ${server_id} → ${status}`
            + (error ? ` (${error})` : ''));
        
        try {
            // Status-Mapping: Daemon → DB ENUM
            // Daemon sendet: running, stopped
            // DB ENUM hat: online, offline, starting, stopping, error, installing, installed, updating
            const statusMap = {
                'running': 'online',
                'stopped': 'offline',
                'starting': 'starting',
                'stopping': 'stopping',
                'crashed': 'error'
            };
            
            const dbStatus = statusMap[status] || status;
            
            // 1. MySQL-Update — mit dem Grund, wenn es einen gibt.
            //
            // Beim Verlassen des Fehlerzustands wird er geloescht: Eine alte
            // Begruendung an einem laufenden Server ist schlimmer als keine,
            // weil sie beim naechsten Blick wie die aktuelle aussieht.
            if (dbStatus === 'error') {
                await dbService.query(
                    `UPDATE gameservers
                        SET status = ?, error_message = ?, last_status_update = NOW(), updated_at = NOW()
                      WHERE id = ?`,
                    [dbStatus, error || null, server_id]
                );
                if (error) {
                    Logger.warn(`[Gameserver] Server ${server_id} meldet "${status}": ${error}`);
                } else {
                    // Auch das ist eine Auskunft: Der Daemon hat den Zustand
                    // gemeldet, aber keinen Grund mitgegeben.
                    Logger.warn(`[Gameserver] Server ${server_id} meldet "${status}" OHNE Grund — `
                        + 'der Grund steht nur im Daemon-Log');
                }
            } else {
                await dbService.query(
                    `UPDATE gameservers
                        SET status = ?, error_message = NULL, last_status_update = NOW(), updated_at = NOW()
                      WHERE id = ?`,
                    [dbStatus, server_id]
                );
            }
            
            // 2. Guild-ID holen für SSE-Broadcasting
            const [server] = await dbService.query(
                'SELECT guild_id, name FROM gameservers WHERE id = ?', 
                [server_id]
            );
            
            if (server) {
                // ✅ SSE-Broadcasting an Browser (mit gemapptem DB-Status für UI-Konsistenz)
                const sseManager = ServiceManager.get('sseManager');
                sseManager.broadcast(server.guild_id, 'gameserver', {
                    action: 'status_changed',
                    server_id,
                    server_name: server.name,
                    status: dbStatus,  // ← WICHTIG: Gemappten Status senden (online statt running, offline statt stopped)
                    error_message: dbStatus === 'error' ? (error || null) : null,
                    timestamp
                });

                // ✅ Discord-Panels nachziehen – der Browser erfuhr es bisher als
                //    Einziger. Ein Panel hing bis zu 5 Minuten hinterher, weil der
                //    StatusPoller jeden nicht-laufenden Server auf das Leerlauf-
                //    Intervall (300 s) setzt, bevor er überhaupt prüft, ob ein
                //    Panel daran hängt.
                //    Beim Aus-Zustand muss zusätzlich der Snapshot nachgezogen
                //    werden: Das Panel rendert "online" aus dem Snapshot, nicht
                //    aus gameservers.status. Ohne diese Zeile stünde dort weiter
                //    "🟢 Online" für einen Server, den der Daemon gerade beendet hat.
                if (dbStatus === 'offline' || dbStatus === 'error') {
                    await StatusService.markiereAus(server_id, server.guild_id, dbStatus);
                }
                PanelService.pushZustandswechsel(server_id);

                Logger.info(`[Gameserver] Status-Update gespeichert & gebroadcastet: ${server.name} (${server_id}) → ${dbStatus} (original: ${status})`);
            }
        } catch (error) {
            Logger.error(`[Gameserver] Fehler beim Status-Update für Server ${server_id}:`, error);
            throw error;
        }
    }

    /**
     * Handler: Gameserver Resource Usage
     * @private
     */
    async _handleResourceUsage(payload, message, context) {
        const Logger = ServiceManager.get('Logger');

        const { server_id } = payload;
        if (!server_id) return;

        try {
            // ── Der Live-Kanal (Baustelle 147, Weg B) ─────────────────────────
            //
            // Bis zum 2026-09-22 war dieser Handler ein Blindgänger neben einem
            // zweiten: Er schrieb in drei Spalten, die es nicht gibt — und
            // aufgefallen ist es nie, weil der Daemon das Ereignis gar nicht
            // schickte. Jetzt schickt er es, alle drei Sekunden je laufendem
            // Server, flüchtig (nicht gepuffert, nicht protokolliert).
            //
            // **Dieser Handler schreibt nichts in die Datenbank.** Das tut der
            // Herzschlag alle 30 s. Zwei Schreiber auf dieselben Spalten wären
            // der nächste Befund — und bei drei Sekunden wären es 1200 UPDATEs
            // die Stunde je Server für einen Wert, den niemand später liest.
            // Zwei Wege, zwei Aufgaben: der eine bewahrt auf, der andere zeigt.
            //
            // ── Warum die Guild aus dem Kontext kommt ────────────────────────
            //
            // Vorher stand hier `SELECT guild_id FROM gameservers` — bei einem
            // Ereignis alle drei Sekunden eine Abfrage je Messung, für einen Wert,
            // der sich nie ändert. Die Kennung steht in der Daemon-Verbindung und
            // geht seit dem 2026-09-22 im Kontext mit.
            const guildId = context?.guildId || null;
            if (!guildId) {
                // Ohne Guild kann niemand zuschauen. Gemeldet, nicht verschwiegen:
                // Es hieße, die Verbindung kennt ihre Guild nicht.
                Logger.warn(`[Gameserver] Messwerte für Server ${server_id} ohne Guild im Kontext — nicht gesendet`);
                return;
            }

            const sseManager = ServiceManager.get('sseManager');
            if (!sseManager) return;

            // **Gerechnet wird hier, gezeichnet im Browser** — mit derselben
            // Funktion, aus der die Serverseite ihren Streifen baut. Eine zweite,
            // knappere Formatierung im Browser würde driften: Nach dem ersten
            // Push stünde dort „12.5%" und beim Neuladen „12,5 %".
            //
            // Die Zeile wird aus dem Ereignis zusammengesetzt, nicht geladen: Das
            // Ereignis kommt nur für laufende Container, und `last_heartbeat`
            // ist in diesem Augenblick genau jetzt.
            const messwerte = baueMesswerte({
                status: 'online',
                last_heartbeat: new Date(),
                cpu_percent:  payload.cpu,
                ram_used_mb:  payload.ram,
                ram_total_mb: payload.ram_total,
                net_rx_bytes: payload.net_rx_bytes,
                net_tx_bytes: payload.net_tx_bytes,
                net_rx_rate:  payload.net_rx_rate,
                net_tx_rate:  payload.net_tx_rate,
            });

            sseManager.broadcast(guildId, 'gameserver', {
                action: 'resource_usage',
                server_id,
                // Fertig gerechnet: Text, Prozent, Farbe.
                messwerte,
            });
        } catch (error) {
            Logger.error(`[Gameserver] Fehler beim Messwert-Push für Server ${server_id}:`, error);
        }
    }

    /**
     * Handler: Gameserver Crashed
     * @private
     */
    async _handleCrashed(payload, message, context) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        
        const { server_id, error: rawError, timestamp } = payload;
        const { daemonId } = context;
        const error = rawError || null;
        
        Logger.error(`[Gameserver] Server Crashed: ${server_id} - ${error || 'unknown'}`);
        
        try {
            // 1. Status auf 'error' setzen (ENUM-konform)
            await dbService.query(
                `UPDATE gameservers 
                 SET status = 'error', 
                     crash_count = crash_count + 1,
                     last_crash_at = NOW(),
                     last_crash_reason = ?,
                     updated_at = NOW() 
                 WHERE id = ?`,
                [error, server_id]
            );
            
            // 2. Crash-Log speichern
            //
            // **Der Daemon schickt SEKUNDEN.** Hier stand `timestamp / 1000` —
            // ein zweites Teilen, und jeder Absturz landete im Januar 1970.
            // Am 2026-09-05 an den beiden Zeilen von Server 182 gesehen:
            // gespeichert 1970-01-21T16:49:26, gemeint 2026-09-05T00:09:26.
            //
            // Geraten wird die Einheit nicht, sie wird erkannt: Ein Wert ueber
            // 1e11 kann keine Sekundenzahl sein (das waere das Jahr 5138), also
            // sind es Millisekunden. So bleibt die Stelle richtig, falls ein
            // spaeterer Daemon die andere Einheit schickt.
            const roh = Number(timestamp) || (Date.now() / 1000);
            const crashTime = roh > 1e11 ? roh / 1000 : roh;
            await dbService.query(
                `INSERT INTO gameserver_crash_logs 
                 (server_id, daemon_id, error_message, timestamp) 
                 VALUES (?, ?, ?, FROM_UNIXTIME(?))`,
                [server_id, daemonId || null, error, crashTime]
            );
            
            // 3. Guild-Owner benachrichtigen + SSE-Broadcasting
            const [server] = await dbService.query(
                'SELECT guild_id, name FROM gameservers WHERE id = ?', 
                [server_id]
            );
            
            if (server) {
                // ✅ SSE-Broadcasting + Notification
                const sseManager = ServiceManager.get('sseManager');
                sseManager.broadcast(server.guild_id, 'gameserver', {
                    action: 'crashed',
                    server_id,
                    server_name: server.name,
                    error,
                    timestamp
                });
                
                Logger.warn(`[Gameserver] Crash-Notification gesendet: ${server.name} (${server_id}) in Guild ${server.guild_id}`);
            }
            
        } catch (error) {
            Logger.error(`[Gameserver] Fehler beim Crash-Handling für Server ${server_id}:`, error);
            throw error;
        }
    }

    // Hier stand bis zum 2026-09-12 `_handleInstallCompleted` — sie setzte den
    // Status auf „installed" und broadcastete „install_completed". **Sie hatte
    // nie einen Aufrufer**: Registriert sind die fuenf Handler oben, dieser
    // nicht. Was wirklich laeuft, ist `IPMServer._handleGameserverInstallComplete`
    // (Status `offline`, Install-Zaehler, SSE). Zwei Wahrheiten fuer dasselbe
    // Ereignis, von denen eine tot war — gefunden beim ersten echten Mod-Test.

    /**
     * Die beim Anlegen vorgemerkten Mods holen (E6/B.12).
     *
     * Eigener Schritt, weil er scheitern darf: Thunderstore kann gerade nicht
     * ausliefern, ein Mod kann zurueckgezogen sein. Beides steht danach in der
     * Zeile und in der Karte — die Installation des Servers selbst gilt
     * trotzdem als abgeschlossen.
     *
     * @private
     */
    async _holeVorgemerkteMods(serverId) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        try {
            // `paket_werte` MUSS mit: Der Inhaltsvertrag haengt seit Stufe 3 am
            // gewaehlten Lader (Minecraft).
            const [server] = await dbService.query(
                `SELECT id, guild_id, rootserver_id, install_path, addon_marketplace_id, paket_werte
                   FROM gameservers WHERE id = ?`, [serverId]);
            if (!server) return;

            const { ladePaketFuerAddon } = require('./helpers/StartPayload');
            const { loeseInhaltAuf } = require('./helpers/InhaltJeLader');
            const paketZeile = await ladePaketFuerAddon(dbService, server.addon_marketplace_id);
            const roh = paketZeile
                ? (typeof paketZeile.paket_json === 'string'
                    ? JSON.parse(paketZeile.paket_json) : paketZeile.paket_json)
                : null;
            let werte = {};
            try {
                werte = typeof server.paket_werte === 'string'
                    ? JSON.parse(server.paket_werte) : (server.paket_werte || {});
            } catch { werte = {}; }
            const paket = loeseInhaltAuf(roh, werte);
            const inhalt = paket?.content || null;
            const InhalteHolen = require('./helpers/InhalteHolen');

            // ── Das Modpack ZUERST (2026-09-23) ────────────────────────────
            //
            // Es bringt `config/` und andere Beigaben mit; eine einzeln
            // gewaehlte Mod darf die danach ueberschreiben, umgekehrt haette
            // das Paket die Wahl des Betreibers ueberschrieben.
            //
            // Eigener try-Block, weil ein gescheitertes Modpack die Mods nicht
            // mitreissen darf: Was hier misslingt, steht in seiner Zeile
            // (`status = 'fehlgeschlagen'`) und im Log — die Mods danach sind
            // eine andere Sache.
            try {
                const mp = await InhalteHolen.holeGeplantesModpack({
                    server, guildId: server.guild_id });
                if (mp && mp.success) {
                    Logger.info(`[Gameserver] Server ${serverId}: Modpack „${mp.name}" mit `
                        + `${mp.dateien} Datei(en) installiert, ${mp.ausgelassen} ausgelassen`);
                } else if (mp) {
                    Logger.warn(`[Gameserver] Server ${serverId}: Modpack fehlgeschlagen: ${mp.fehler}`);
                }
            } catch (fehler) {
                Logger.error(`[Gameserver] Modpack für Server ${serverId} nicht geholt:`, fehler);
            }


            // Ab hier geht es um einzelne Mods — und die gibt es nur, wo das
            // Paket sie kennt. Das Modpack oben haengt bewusst NICHT daran:
            // `content.supported` ist bei Minecraft eine Eigenschaft des
            // LADERS (vanilla: false, fabric: true). Dass ein Modpack ohnehin
            // immer einen modfaehigen Lader verlangt, ist heute wahr und waere
            // eine stille Abhaengigkeit von einer fremden Bedingung.
            if (!inhalt?.supported) return;


            const ergebnis = await InhalteHolen.holeGeplante({
                server, inhalt, guildId: server.guild_id });
            if (!ergebnis) return;

            Logger.info(`[Gameserver] Server ${serverId}: ${ergebnis.installiert.length} Mod(s) `
                + `installiert, ${ergebnis.fehlgeschlagen.length} fehlgeschlagen`);

            const sseManager = ServiceManager.get('sseManager');
            if (sseManager) {
                sseManager.broadcast(server.guild_id, 'gameserver', {
                    action:         'inhalte_geholt',
                    server_id:      serverId,
                    installiert:    ergebnis.installiert.length,
                    fehlgeschlagen: ergebnis.fehlgeschlagen.length,
                    timestamp:      Date.now(),
                });
            }
        } catch (fehler) {
            // Melden, nicht werfen: Der Server ist installiert, die Mods fehlen.
            Logger.error(`[Gameserver] Vorgemerkte Mods für Server ${serverId} nicht geholt:`, fehler);
        }
    }

    /**
     * Handler: Install Failed
     * Wird aufgerufen wenn Installation fehlschlägt (SteamCMD Error, Permission-Probleme, etc.)
     * @private
     */
    async _handleInstallFailed(payload, message, context) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        
        const { server_id, error, timestamp } = payload;
        const { daemonId } = context;
        
        Logger.error(`[Gameserver] Installation fehlgeschlagen: Server ${server_id} - ${error}`);
        
        try {
            // Status auf 'error' setzen (zeigt Reinstall-Button an)
            await dbService.query(
                `UPDATE gameservers 
                 SET status = 'error', 
                     error_message = ?,
                     last_status_update = NOW(),
                     updated_at = NOW() 
                 WHERE id = ?`,
                [error || 'Installation fehlgeschlagen', server_id]
            );
            
            // SSE-Broadcasting
            const [server] = await dbService.query(
                'SELECT guild_id, name FROM gameservers WHERE id = ?', 
                [server_id]
            );
            
            if (server) {
                const sseManager = ServiceManager.get('sseManager');
                sseManager.broadcast(server.guild_id, 'gameserver', {
                    action: 'install_failed',
                    server_id,
                    server_name: server.name,
                    error,
                    timestamp
                });
                
                Logger.warn(`[Gameserver] Installation-Failed gebroadcastet: ${server.name} (${server_id})`);
            }
            
        } catch (error) {
            Logger.error(`[Gameserver] Fehler beim Install-Failed-Handling für Server ${server_id}:`, error);
            throw error;
        }
    }

    /**
     * Handler: Console Output
     * Forwarded zu ConsoleManager für Output-Buffering und SSE-Broadcasting
     * @private
     */
    async _handleConsoleOutput(payload, message, context) {
        const Logger = ServiceManager.get('Logger');
        
        try {
            const consoleManager = ServiceManager.get('consoleManager');
            
            if (!consoleManager) {
                Logger.warn('[Gameserver] ConsoleManager nicht verfügbar, Output-Event ignoriert');
                return;
            }
            
            // Forward zu ConsoleManager (handhabt SSE-Broadcasting + Buffering)
            await consoleManager.handleOutputEvent(payload);
            
        } catch (error) {
            Logger.error('[Gameserver] Fehler beim Console-Output-Handling:', error);
            // Nicht thrownen, da hohe Frequenz - Event wird übersprungen
        }
    }

    async _handleInstallOutput(payload, message, context) {
        const Logger = ServiceManager.get('Logger');
        try {
            const { server_id, line } = payload;
            if (!server_id || !line) return;

            const dbService = ServiceManager.get('dbService');
            const sseManager = ServiceManager.get('sseManager');
            if (!sseManager) return;

            const rows = await dbService.query('SELECT guild_id FROM gameservers WHERE id = ?', [server_id]);
            if (!rows || rows.length === 0) return;

            sseManager.broadcast(rows[0].guild_id, 'install', {
                action:    'output',
                server_id: String(server_id),
                line,
            });
        } catch (error) {
            Logger.error('[Gameserver] Fehler beim Install-Output-Handling:', error);
        }
    }

    async _handleInstallStatus(payload, message, context) {
        const Logger = ServiceManager.get('Logger');
        try {
            const { server_id, phase, message: msg } = payload;
            if (!server_id) return;

            const dbService = ServiceManager.get('dbService');
            const sseManager = ServiceManager.get('sseManager');
            if (!sseManager) return;

            const rows = await dbService.query('SELECT guild_id FROM gameservers WHERE id = ?', [server_id]);
            if (!rows || rows.length === 0) return;

            sseManager.broadcast(rows[0].guild_id, 'install', {
                action:    'status',
                server_id: String(server_id),
                phase,
                message:   msg,
            });
        } catch (error) {
            Logger.error('[Gameserver] Fehler beim Install-Status-Handling:', error);
        }
    }


    /**
     * Registriert die Navigation für das Plugin
     * @private
     */
    async _registerNavigation(guildId) {
        const Logger = ServiceManager.get('Logger');
        const navigationManager = ServiceManager.get('navigationManager');

        // Haupt-Plugin-Navigation (mit UPPERCASE Capabilities!)
         const navItems = [
            // Hauptmenü-Item: gameserver
            {
                title: 'gameserver:NAV.GAMESERVER',
                // **Zeigt auf die Übersicht, nicht auf die Wurzel** (2026-09-18,
                // Baustelle 140). Damit ist die Entscheidung vom 2026-08-18
                // abgeschlossen: Es gibt EINEN Eintrag, der zu „Server ansehen"
                // führt. Vorher zeigte dieser Punkt auf die Wurzel, die zum
                // Dashboard umleitete — und NAV.SERVERS daneben auf dieselbe
                // Liste. Zwei Einträge, ein Ziel.
                //
                // Die Wurzel leitet weiter hierher, damit alte Lesezeichen und
                // Verweise nicht ins Leere laufen.
                url: `/guild/${guildId}/plugins/gameserver/servers`,
                icon: 'fa-solid fa-server',
                // **Fester Platz in der Seitenleiste** (2026-09-04).
                //
                // Hier stand `order: null` mit dem Vermerk "Auto-Range". Genau
                // das war das Problem: Die Auto-Range ist die naechste freie
                // 1000er-Stufe, also die, die sich aus der Reihenfolge der
                // REGISTRIERUNG ergibt und nicht aus dem Plugin. Nach einem
                // Neustart in anderer Reihenfolge stand der Punkt woanders.
                order: 4500,
                type: navigationManager.menuTypes.MAIN,
                capability: 'GAMESERVER.VIEW', // Gameserver-Zugriff
                visible: true,
                guildId,
                parent: null
            },
            // ── Dashboard und „Meine Addons" sind entfallen ──────────────────
            //
            // Entschieden am 2026-08-18: „Heute führen DREI Einträge zu
            // Spielarten von ‚Server ansehen': die Plugin-Wurzel,
            // NAV.DASHBOARD und NAV.SERVERS. Daraus wird einer." Die neue
            // Serverübersicht IST das Dashboard — eine zweite Seite daneben
            // wäre dieselbe Auskunft in schlechter.
            //
            // „Meine Addons" entfällt mit der Entscheidung gegen private Pakete
            // (E4, 2026-08-18): Es gibt nur EINEN Katalog.
            //
            // ACHTUNG: registerNavigation() LÖSCHT NICHT (nachgelesen in
            // NavigationManager.js, Zeile 181/188 — es fügt nur hinzu, was noch
            // fehlt). Die alten Zeilen räumt deshalb die Migration
            // 20260819_190000_navigation_zusammenlegen.js weg. Wer hier einen
            // Eintrag entfernt und die Migration vergisst, sieht ihn weiter.
            // Submenü: Daemon-Setup
            {
                // Heisst jetzt „Spiele": Niemand sucht ein Addon, alle suchen
                // ein Spiel. „Marktplatz" verdient sich den Namen erst, wenn es
                // mehr als einen Beisteuernden gibt (Papier 05).
                title: 'gameserver:NAV.ADDONS',
                url: `/guild/${guildId}/plugins/gameserver/addons`,
                icon: 'fa-solid fa-dice-d20',
                order: 20,
                type: navigationManager.menuTypes.MAIN,
                capability: 'GAMESERVER.EDIT', // Addons verwalten erfordert Edit-Rechte
                visible: true,
                guildId,
                // Muss dem `url` des Elternpunktes ZEICHENGLEICH entsprechen -
                // `NavigationManager.js:536` vergleicht genau so. Wer oben die
                // Adresse aendert und hier nicht, haengt den Punkt ab.
                parent: `/guild/${guildId}/plugins/gameserver/servers`
            },
            // ── NAV.SERVERS ist entfallen (2026-09-18, Baustelle 140) ───────
            //
            // Er zeigte auf dieselbe Seite wie der Elternpunkt darueber. Die
            // Seitenleiste haette beides untereinander angezeigt: "Gameserver"
            // und "Server", beide zur Serveruebersicht. Genau das Doppel, das
            // am 2026-09-03 schon bei `core` auffiel ("Themes / Uebersicht").
            //
            // Der Elternpunkt TRAEGT die Uebersicht jetzt selbst.    
            {
                title: 'gameserver:NAV.GAMESERVER',
                path: `/guild/${guildId}/plugins/gameserver/settings`,
                icon: 'fa-solid fa-map',
                order: null,  // Nach Core-Settings (21, 22, 23)
                parent: `/guild/${guildId}/settings`,  // ← Parent ist Core-Settings!
                type: 'main',
                capability: 'GAMESERVER.EDIT', // Gameserver-Einstellungen ändern
                visible: true
            }
        ];

        try {
            // **Erst raeumen, dann anmelden** (2026-09-18, Baustelle 140).
            //
            // `registerNavigation` ueberspringt Vorhandenes und LOESCHT NIE —
            // ein entfernter oder umgehaengter Punkt stand deshalb weiter in
            // der Leiste, bis jemand eine Migration dafuer schrieb. Genau
            // deswegen gibt es `20260819_190000_navigation_zusammenlegen.js`.
            //
            // Die anderen fuenf Plugins mit Navigation (music, streaming,
            // discord, moderation, masterserver) raeumen hier vorher auf.
            // Gameserver war der Ausreisser. Mit dieser Zeile traegt jede
            // Aenderung an `navItems` sich selbst — ohne eine weitere Migration.
            await navigationManager.removeNavigation(this.name, guildId);
            await navigationManager.registerNavigation(this.name, guildId, navItems);
            Logger.debug('[Gameserver] Navigation registriert (inkl. Settings unter Core)');
        } catch (error) {
            Logger.error('[Gameserver] Fehler beim Registrieren der Navigation:', error);
        }
    }

    /**
     * Hooks registrieren
     */
    _registerHooks() {
        const Logger = ServiceManager.get('Logger');
        // Aktuell keine Hooks benötigt (Leaflet entfernt)
        Logger.debug('[Gameserver] Hooks registriert');
    }

    /**
     * Dashboard-Widgets registrieren
     */
    _registerWidgets() {
        const Logger = ServiceManager.get('Logger');
        Logger.debug('[Gameserver] Widgets registriert');
    }

}

module.exports = GameserverPlugin;