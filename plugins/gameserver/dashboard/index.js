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

        // Guard: Event-Handler nur einmal registrieren
        this._handlersRegistered = false;
    }

    /**
     * WordPress-Style Asset Registration
     * @author DuneBot Team
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
     * Routes registrieren
     * Express-Router für Guild und Base-Endpoints
     */
    _setupRoutes() {
        const Logger = ServiceManager.get('Logger');
        
        // Guild-spezifische Routes (aus separaten Files)
        const serversRoutes = require('./routes/servers');
        const addonsRoutes = require('./routes/addons');
        const filesRoutes = require('./routes/files');  // ← NEU: File-Manager
        const consoleRoutes = require('./routes/console');
        const settingsRoutes = require('./routes/settings');
        
        // Guild-Router mounten
        this.guildRouter.use('/servers', serversRoutes);
        this.guildRouter.use('/addons', addonsRoutes);
        this.guildRouter.use('/', filesRoutes);  // ← Files-Routes unter / (weil /servers/:serverId/files)
        this.guildRouter.use('/console', consoleRoutes);
        this.guildRouter.use('/settings', settingsRoutes);
        
        Logger.debug('[Gameserver] Routes registriert (Servers, Addons, Files, Console, Settings)');
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
        const ConsoleManager = require('./helpers/ConsoleManager');
        const consoleManager = new ConsoleManager();
        ServiceManager.register('consoleManager', consoleManager);
        Logger.debug('[Gameserver] ConsoleManager registriert und initialisiert');
        
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
     * Liest alle shared/addons/*.json ein und sichert sie in addon_marketplace.
     * Läuft asynchron im Hintergrund – Fehler sind unkritisch.
     * ON DUPLICATE KEY UPDATE sorgt dafür, dass bereits vorhandene Addons nur
     * aktualisiert werden wenn sich game_data geändert hat.
     */
    async _syncOfficialAddons(dbService) {
        const Logger = ServiceManager.get('Logger');
        const fs   = require('fs');
        const path = require('path');

        const sharedDir = path.join(__dirname, '../shared/addons');
        if (!fs.existsSync(sharedDir)) return;

        const files = fs.readdirSync(sharedDir).filter(f => f.endsWith('.json'));
        if (!files.length) return;

        let synced = 0;
        for (const file of files) {
            try {
                const raw   = fs.readFileSync(path.join(sharedDir, file), 'utf8');
                const addon = JSON.parse(raw);

                if (!addon.slug || !addon.name) {
                    Logger.warn(`[Gameserver] syncOfficialAddons: Datei ${file} hat kein slug/name – übersprungen`);
                    continue;
                }

                const gameData = JSON.stringify(addon);

                await dbService.query(`
                    INSERT INTO addon_marketplace
                        (name, slug, description, author_user_id, visibility, status, trust_level,
                         category, runtime_type, source_type, steam_app_id, steam_server_app_id,
                         icon_url, banner_url, tags, version, game_data)
                    VALUES (?, ?, ?, '544578232704565262', 'official', 'approved', 'official',
                            ?, 'native', 'native', ?, ?,
                            ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                        name               = VALUES(name),
                        description        = VALUES(description),
                        visibility         = 'official',
                        status             = 'approved',
                        trust_level        = 'official',
                        category           = VALUES(category),
                        runtime_type       = 'native',
                        source_type        = 'native',
                        steam_app_id       = VALUES(steam_app_id),
                        steam_server_app_id = VALUES(steam_server_app_id),
                        icon_url           = VALUES(icon_url),
                        banner_url         = VALUES(banner_url),
                        tags               = VALUES(tags),
                        version            = VALUES(version),
                        game_data          = VALUES(game_data),
                        updated_at         = NOW()
                `, [
                    addon.name,
                    addon.slug,
                    addon.description || '',
                    addon.category    || 'other',
                    addon.steam?.app_id        || addon.steam_app_id        || null,
                    addon.steam?.server_app_id || addon.steam_server_app_id || null,
                    addon.assets?.icon_url     || addon.icon_url            || null,
                    addon.assets?.banner_url   || addon.banner_url          || null,
                    addon.tags ? JSON.stringify(addon.tags) : null,
                    addon.version || '1.0.0',
                    gameData,
                ]);

                synced++;
            } catch (err) {
                Logger.error(`[Gameserver] syncOfficialAddons: Fehler bei ${file}:`, err.message);
            }
        }

        if (synced > 0) {
            Logger.info(`[Gameserver] syncOfficialAddons: ${synced}/${files.length} offizielle Addons synchronisiert`);
        }
    }
    
    
    /**
     * Plugin deaktivieren (System-weit)
     */
    async onDisable() {
        const Logger = ServiceManager.get('Logger');
        Logger.info('Deaktiviere [Gameserver] Dashboard-Plugin...');
        // Cleanup bei Bedarf
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
            // Console Output (Live Console)
            // ════════════════════════════════════════════════════════════
            eventRouter.register(
                MessageTypes.NS_CONSOLE, 
                MessageTypes.CONSOLE_OUTPUT, 
                this._handleConsoleOutput.bind(this),
                { priority: 10 }  // Low priority, high frequency
            );

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
     * Handler: Gameserver Status Changed
     * @private
     */
    async _handleStatusChanged(payload, message, context) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        
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