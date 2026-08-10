const { DashboardPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

const path = require('path');

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

        // Offizielle Addons aus shared/addons/*.json in die DB syncen
        this._syncOfficialAddons(dbService).catch(err =>
            Logger.warn('[Gameserver] syncOfficialAddons fehlgeschlagen (unkritisch):', err.message)
        );
        
        Logger.success('[Gameserver] Dashboard-Plugin aktiviert');
        return true;
    }

    /**
     * Legt fehlende offizielle Addons aus shared/addons/*.json an.
     *
     * **Vorhandene Addons werden bewusst NICHT überschrieben.** In der Datenbank
     * hängen die installierten Server, ihre Port-Allokationen und die per Egg
     * importierten Definitionen – sie ist die Wahrheit, die Datei nur ihr Abbild
     * (Gegenrichtung: `scripts/export-addons.js`).
     *
     * Vorher stand hier ein vollständiges Upsert samt `game_data = VALUES(...)`.
     * Das hätte z.B. das Valheim-Addon, dessen Variablen `PUBLIC_SERVER` und
     * `ENABLE_CROSSPLAY` heißen, durch eine ältere Fassung mit `PUBLIC` ersetzt –
     * die Variablen der laufenden Server hätten danach zu nichts mehr gehört.
     *
     * Aufgefallen ist das nur, weil das Upsert nie lief: Es schrieb
     * `source_type = 'native_steamcmd'`, ein Wert, den diese Spalte gar nicht
     * kennt (der gehört in `runtime_type`). Jeder INSERT scheiterte an
     * WARN_DATA_TRUNCATED.
     *
     * Läuft asynchron im Hintergrund – Fehler sind unkritisch.
     */
    async _syncOfficialAddons(dbService) {
        const Logger = ServiceManager.get('Logger');
        const fs   = require('fs');
        const path = require('path');

        const sharedDir = path.join(__dirname, '../shared/addons');
        if (!fs.existsSync(sharedDir)) return;

        const files = fs.readdirSync(sharedDir).filter(f => f.endsWith('.json'));
        if (!files.length) return;

        let created = 0;
        let existing = 0;
        for (const file of files) {
            try {
                const raw   = fs.readFileSync(path.join(sharedDir, file), 'utf8');
                const addon = JSON.parse(raw);

                if (!addon.slug || !addon.name) {
                    Logger.warn(`[Gameserver] syncOfficialAddons: Datei ${file} hat kein slug/name – übersprungen`);
                    continue;
                }

                const gameData = JSON.stringify(addon);

                // "ON DUPLICATE KEY UPDATE id = id" ist ein bewusster Leerlauf:
                // Es verhindert den Duplicate-Key-Fehler bei bereits vorhandenem
                // slug, ohne irgendeine Spalte anzufassen. INSERT IGNORE wäre
                // verlockender, würde aber auch echte Fehler verschlucken – genau
                // dadurch blieb der kaputte source_type so lange unbemerkt.
                // dbService.query() liefert die Zeilen entpackt – bei INSERT also
                // direkt das OkPacket, nicht [OkPacket, fields].
                const res = await dbService.query(`
                    INSERT INTO addon_marketplace
                        (name, slug, description, author_user_id, visibility, status, trust_level,
                         category, runtime_type, source_type, steam_app_id, steam_server_app_id,
                         icon_url, banner_url, tags, version, game_data)
                    VALUES (?, ?, ?, '544578232704565262', 'official', 'approved', 'official',
                            ?, ?, ?, ?, ?,
                            ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE id = id
                `, [
                    addon.name,
                    addon.slug,
                    addon.description || '',
                    addon.category    || 'other',
                    // Beide Spalten sind ENUMs mit unterschiedlichen Wertebereichen;
                    // "native_steamcmd" ist nur für runtime_type gültig. Die Datei
                    // darf beides setzen, sonst gilt, was alle Bestandsaddons nutzen.
                    addon.runtime_type || 'docker_steam',
                    addon.source_type  || 'native',
                    addon.steam?.app_id        || addon.steam_app_id        || null,
                    addon.steam?.server_app_id || addon.steam_server_app_id || null,
                    addon.assets?.icon_url     || addon.icon_url            || null,
                    addon.assets?.banner_url   || addon.banner_url          || null,
                    addon.tags ? JSON.stringify(addon.tags) : null,
                    addon.version || '1.0.0',
                    gameData,
                ]);

                // affectedRows taugt hier nicht: mysql2 zählt getroffene statt
                // geänderte Zeilen und meldet auch für den Leerlauf 1. insertId
                // ist eindeutig – 0, wenn der slug bereits existierte.
                if (res?.insertId > 0) {
                    created++;
                    Logger.info(`[Gameserver] syncOfficialAddons: ${addon.slug} neu angelegt (#${res.insertId})`);
                } else {
                    existing++;
                }
            } catch (err) {
                Logger.error(`[Gameserver] syncOfficialAddons: Fehler bei ${file}:`, err.message);
            }
        }

        if (created > 0) {
            Logger.info(`[Gameserver] syncOfficialAddons: ${created} Addon(s) neu angelegt, ${existing} bereits vorhanden (unverändert)`);
        } else {
            Logger.debug(`[Gameserver] syncOfficialAddons: alle ${existing} offiziellen Addons bereits vorhanden`);
        }
    }
    
    
    /**
     * Plugin deaktivieren (System-weit)
     */
    async onDisable() {
        const Logger = ServiceManager.get('Logger');
        Logger.info('Deaktiviere [Gameserver] Dashboard-Plugin...');
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
                    if (server.status === 'running' || server.status === 'starting') {
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
            const dashboardRouter = require('./routes/dashboard');
            const addonsRouter = require('./routes/addons');
            const serversRouter = require('./routes/servers');
            const settingsRouter = require('./routes/settings');
            const filesRouter = require('./routes/files');
            const consoleRouter = require('./routes/console');
            
            // Root-Route: Redirect zu Dashboard
            this.guildRouter.get('/', (req, res) => {
                const guildId = res.locals.guildId;
                res.redirect(`/guild/${guildId}/plugins/gameserver/dashboard`);
            });
            
            // Haupt-Route: Dashboard
            this.guildRouter.use('/dashboard', dashboardRouter);
            
            // Addon Marketplace
            this.guildRouter.use('/addons', addonsRouter);
            
            // Server-Management
            this.guildRouter.use('/servers', serversRouter);
            
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

            // HINWEIS: KEIN Handler für NS_CONSOLE/CONSOLE_OUTPUT hier!
            // Der ConsoleManager registriert sich selbst auf 'console:output'
            // (ConsoleManager._registerEventHandlers). Eine zweite Registrierung
            // hier führte dazu, dass jede Console-Zeile doppelt gebroadcastet wurde.

            // Install-Handler (completed, failed, output, status) werden
            // autoritativ in IPMServer._registerEventHandlers() registriert
            // und broadcasten dort mit dem korrekten SSE-Namespace 'install'.

            this._handlersRegistered = true;
            Logger.success('[Gameserver] Event-Handler registriert (4 Handler)');
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

        const { server_id, status, timestamp } = payload;
        const { daemonId } = context;
        
        Logger.debug(`[Gameserver] Status Changed: Server ${server_id} → ${status}`);
        
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
            
            // 1. MySQL-Update
            await dbService.query(
                'UPDATE gameservers SET status = ?, updated_at = NOW() WHERE id = ?',
                [dbStatus, server_id]
            );
            
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
        const dbService = ServiceManager.get('dbService');
        
        const { server_id, cpu, ram, disk } = payload;
        
        Logger.debug(`[Gameserver] Resource Usage: Server ${server_id} - CPU: ${cpu}%, RAM: ${ram}MB`);
        
        try {
            // Resource-Metriken in DB speichern (optional)
            // TODO: Metrics-Tabelle anlegen für Zeitreihen-Daten
            
            // Für jetzt: In gameservers-Tabelle aktualisieren
            await dbService.query(
                `UPDATE gameservers 
                 SET last_cpu_usage = ?, 
                     last_ram_usage = ?,
                     last_disk_usage = ?,
                     updated_at = NOW() 
                 WHERE id = ?`,
                [cpu, ram, disk, server_id]
            );
            
            // ✅ SSE-Broadcasting für Live-Monitoring
            const [server] = await dbService.query(
                'SELECT guild_id FROM gameservers WHERE id = ?',
                [server_id]
            );
            
            if (server) {
                const sseManager = ServiceManager.get('sseManager');
                sseManager.broadcast(server.guild_id, 'gameserver', {
                    action: 'resource_usage',
                    server_id,
                    cpu,
                    ram,
                    disk,
                    timestamp: Date.now()
                });
            }
            
        } catch (error) {
            Logger.error(`[Gameserver] Fehler beim Resource-Update für Server ${server_id}:`, error);
            // Nicht werfen - Resource-Updates sind nicht kritisch
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
            const crashTime = timestamp ? timestamp / 1000 : Date.now() / 1000;
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

    /**
     * Handler: Install Completed
     * @private
     */
    async _handleInstallCompleted(payload, message, context) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        
        const { server_id, install_path, timestamp } = payload;
        const { daemonId } = context;
        
        Logger.info(`[Gameserver] Installation abgeschlossen: Server ${server_id}`);
        
        try {
            // Status auf 'installed' setzen (zeigt grünes "Installed" Badge + Start/Delete Buttons)
            await dbService.query(
                `UPDATE gameservers 
                 SET status = 'installed', 
                     updated_at = NOW() 
                 WHERE id = ?`,
                [server_id]
            );
            
            // SSE-Broadcasting
            const [server] = await dbService.query(
                'SELECT guild_id, name FROM gameservers WHERE id = ?', 
                [server_id]
            );
            
            if (server) {
                const sseManager = ServiceManager.get('sseManager');
                sseManager.broadcast(server.guild_id, 'gameserver', {
                    action: 'install_completed',
                    server_id,
                    server_name: server.name,
                    install_path,
                    timestamp
                });
                
                Logger.success(`[Gameserver] Installation-Complete gebroadcastet: ${server.name} (${server_id})`);
            }
            
        } catch (error) {
            Logger.error(`[Gameserver] Fehler beim Install-Complete-Handling für Server ${server_id}:`, error);
            throw error;
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
                url: `/guild/${guildId}/plugins/gameserver`,
                icon: 'fa-solid fa-server',
                order: null, // Auto-Range (nächste 1000er-Range nach Core)
                type: navigationManager.menuTypes.MAIN,
                capability: 'GAMESERVER.VIEW', // Gameserver-Zugriff
                visible: true,
                guildId,
                parent: null
            },
            // Submenü: Dashboard
            {
                title: 'gameserver:NAV.DASHBOARD',
                url: `/guild/${guildId}/plugins/gameserver/dashboard`,
                icon: 'fa-solid fa-gauge-high',
                order: 10,
                type: navigationManager.menuTypes.MAIN,
                capability: 'GAMESERVER.VIEW', // Gameserver-Zugriff
                visible: true,
                guildId,
                parent: `/guild/${guildId}/plugins/gameserver`
            },
            // Submenü: Daemon-Setup
            {
                title: 'gameserver:NAV.ADDONS',
                url: `/guild/${guildId}/plugins/gameserver/addons`,
                icon: 'fa-solid fa-cog',
                order: 20,
                type: navigationManager.menuTypes.MAIN,
                capability: 'GAMESERVER.EDIT', // Addons verwalten erfordert Edit-Rechte
                visible: true,
                guildId,
                parent: `/guild/${guildId}/plugins/gameserver`
            },
            // Submenü: Meine Addons (NEU!)
            {
                title: 'gameserver:NAV.MY_ADDONS',
                url: `/guild/${guildId}/plugins/gameserver/addons/my-addons`,
                icon: 'fa-solid fa-puzzle-piece',
                order: 30,
                type: navigationManager.menuTypes.MAIN,
                capability: 'GAMESERVER.EDIT', // Eigene Addons verwalten
                visible: true,
                guildId,
                parent: `/guild/${guildId}/plugins/gameserver`
            },
            // Submenü: Server-Registry
            {
                title: 'gameserver:NAV.SERVERS',
                url: `/guild/${guildId}/plugins/gameserver/servers`,
                icon: 'fa-solid fa-list',
                order: 40,
                type: navigationManager.menuTypes.MAIN,
                capability: 'GAMESERVER.VIEW', // Server-Liste ansehen
                visible: true,
                guildId,
                parent: `/guild/${guildId}/plugins/gameserver`
            },    
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