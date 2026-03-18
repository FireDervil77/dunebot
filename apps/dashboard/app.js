const express = require("express");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// ServiceManager aus SDK holen
const PluginManager = require("./helpers/PluginManager");
const { SessionManager, BotHealthMonitor } = require("dunebot-sdk");
const { ServiceManager, I18nManager, SiteConfig } = require("dunebot-core");
const { parseJsonArray } = require("dunebot-sdk/utils");
const { ThemeManager, AssetManager } = require('dunebot-sdk');
const ShortcodeParser = require("dunebot-sdk/lib/utils/ShortcodeParser");
const { NotificationManager} = require('dunebot-sdk');
const KernUpdater = require("./helpers/KernUpdater");
const { NavigationManager } = require("dunebot-sdk");
const PathConfig = require("dunebot-sdk/lib/utils/PathConfig"); // Hier PathConfig importieren
const { RouterManager } = require('dunebot-sdk');

// Middlewares
const expressLayouts = require("express-ejs-layouts");
const sessionMiddleware = require("./middlewares/session.middleware");
const baseMiddleware = require("./middlewares/context/base.middleware");
const userConfigMiddleware = require("./middlewares/context/user-config.middleware");
const { CheckAuth } = require("./middlewares/auth.middleware");
const { CheckAdmin } = require("./middlewares/admin.middleware");
const errorMiddleware = require("./middlewares/error.middleware");
const authMiddleware = require("./middlewares/auth.middleware");
const guildMiddleware = require("./middlewares/context/guild.middleware");
const hookMiddleware = require("./middlewares/context/hook.middleware");

// Routers
const frontendRouter = require("./routes/frontend.router");
const authRouter = require("./routes/auth.router");
const guildRouter = require("./routes/guild.router");
const apiRouter = require("./routes/api.router");
const adminRouter = require("./routes/admin.router");


module.exports = class App {
    constructor(ipcServer, dbService) {
        if (!ipcServer) throw new Error("IPC Server required");
        if (!dbService) throw new Error("DB Service required");
        
        this.app = express();
        // WebSocket-Unterstützung für Express aktivieren (router.ws())
        try {
            require('express-ws')(this.app);
        } catch (e) {
            // Fallback: Wenn express-ws nicht installiert ist, loggen wir nur
            console.warn('[WS] express-ws konnte nicht initialisiert werden. WebSocket-Routen sind deaktiviert.');
        }
        this.app.set('trust proxy', 1);
        
        const Logger = ServiceManager.get("Logger");

        // SiteConfig ZUERST registrieren — cached alle statischen ENV-Variablen einmalig
        this.app.siteConfig = new SiteConfig();
        ServiceManager.register('siteConfig', this.app.siteConfig);

        // RouterManager ZUERST initialisieren
        this.routerManager = new RouterManager(this.app);
        ServiceManager.register('routerManager', this.routerManager);

        // DANN erst die Router importieren
        this.routers = {
            frontend: require("./routes/frontend.router"),
            auth: require("./routes/auth.router"),
            guild: require("./routes/guild.router"),
            api: require("./routes/api.router"),
            downloads: require("./routes/downloads.router")
        };

        // Weitere Manager initialisieren...
        this.app.navigationManager = new NavigationManager();
        ServiceManager.register("navigationManager", this.app.navigationManager);
        

        
        // I18n-Manager initialisieren
        const baseDir = path.join(__dirname, "locales");
        this.app.i18n = new I18nManager("dashboard", {
            baseDir,
            logger : Logger,
            pluginsDir: process.env.PLUGINS_DIR,
            fallbackLng: "de-DE",
        });
        ServiceManager.register("i18n", this.app.i18n);
        this.app.translations = new Map();
        
        // Theme-Manager initialisieren
        this.app.themeManager = new ThemeManager(this.app);
        this.app.themeManager.registerThemeAssets();
        ServiceManager.register("themeManager", this.app.themeManager);

        // Asset-Manager initialisieren (WordPress-like enqueue system)
        this.app.assetManager = new AssetManager();
        ServiceManager.register("assetManager", this.app.assetManager);

        // Session-Manager initialisieren
        this.app.sessionManager = new SessionManager();
        ServiceManager.register("sessionManager", this.app.sessionManager);
        
        // Plugin-Manager initialisieren
        this.app.pluginManager = new PluginManager(
            this.app,
            process.env.PLUGINS_DIR,
        );
        Logger.info("Plugin Manager initialized"); 
        ServiceManager.register("pluginManager", this.app.pluginManager);

        // Shortcode-Parser initialisieren
        this.app.shortcodeParser = new ShortcodeParser();
        
        // Middleware und Routen initialisieren
        this.#initializeMiddlewares();
    }

    // Und in der initialize()-Methode den Aufruf entfernen:
    async initialize() {
        const Logger = ServiceManager.get("Logger");
        try {
            // Hook vor der Initialisierung ausführen
            if (this.app.pluginManager?.hooks) {
                await this.app.pluginManager.hooks.doAction('before_dashboard_initialize', this.app);
            }
            
            // Konfiguration laden (VOR Theme-Initialisierung)
            this.config = await this.loadConfig();

            // Übersetzungen laden
            await this.loadTranslations();
            
            // Express und EJS Setup (WICHTIG: VOR ThemeManager!)
            this.app.use(expressLayouts);
            this.app.set('view engine', 'ejs');
            
            // EJS-Cache nur in Production aktivieren
            const isProduction = process.env.NODE_ENV === 'production';
            this.app.set('view cache', isProduction);
            
            // FORCE: Alle EJS-Caches beim Start IMMER leeren (wichtig bei Template-Änderungen)
            const ejs = require('ejs');
            ejs.clearCache();
            Logger.debug(`EJS-Cache beim Start geleert (${isProduction ? 'Production' : 'Development'} Mode)`); 

            // Router mit RouterManager registrieren
            this.routerManager
                .register('/', this.routers.frontend)
                .register('/auth', this.routers.auth)
                .register('/downloads', this.routers.downloads) // Öffentlich, keine Auth
                .register('/guild', this.routers.guild, { 
                    auth: true,  // Aktiviert CheckAuth Middleware
                    middlewares: [guildMiddleware]  // Zusätzliche Middleware
                })
                .register('/api', this.routers.api); // FIXED: Keine automatische Auth - wird in Routes selbst gehandhabt

            // Admin-Bereich (nur Bot-Owner)
            this.app.use('/admin', CheckAuth, CheckAdmin, adminRouter);
            
            // Theme initialisieren - übernimmt bereits die View-Engine-Initialisierung
            await this.app.themeManager.initialize(this.config.THEME || 'default');
            
            // Notification Manager initialisieren
            this.app.notificationManager = new NotificationManager(this.app.dbService);
            // Notifications-Modell registrieren (falls nicht schon bei Datenbank-Initialisierung geschehen)
            try {
                const dbService = ServiceManager.get('dbService');
                if (!dbService) {
                    throw new Error('DBService ist nicht initialisiert');
                }

                // NotificationManager initialisieren und registrieren
                this.app.notificationManager = new NotificationManager(dbService);
                ServiceManager.register("notificationManager", this.app.notificationManager);
                Logger.success("NotificationManager erfolgreich initialisiert");

            } catch (error) {
                // Nur warnen, nicht die App crashen lassen
                Logger.warn("NotificationManager konnte nicht initialisiert werden:", error);
                // Trotzdem weitermachen, da Notifications nicht kritisch sind
            }
            // NotificationManager in den ServiceManager laden
            ServiceManager.register("notificationManager", this.app.notificationManager)

            // Plugins laden
            await this.loadPlugins();
            
            // Kern-Updates ausführen (Migrationen, Nav-Sync, Permission-Updates)
            try {
                const kernUpdater = new KernUpdater();
                await kernUpdater.run();
            } catch (err) {
                Logger.error('[KernUpdater] Fehler bei Kern-Updates:', err);
                // Dashboard trotzdem starten
            }
            
            // View-Pfade nach Plugin-Load aktualisieren (damit Plugin-Views gefunden werden)
            if (this.app.themeManager && typeof this.app.themeManager.setupViewEngine === 'function') {
                this.app.themeManager.setupViewEngine();
                Logger.debug('Plugin-View-Pfade nach Plugin-Load aktualisiert');
            }
            
            // Hook nach der Initialisierung ausführen
            if (this.app.pluginManager && this.app.pluginManager.hooks) {
                await this.app.pluginManager.hooks.doAction('after_dashboard_initialize', this.app);
            }

            // Session-Cleanup starten (nach erfolgreicher Initialisierung)
            if (this.app.sessionManager) {
                this.app.sessionManager.startCleanup(60); // Alle 60 Minuten
            }

            // Bot Health Monitor starten (nach IPC-Initialisierung)
            Logger.debug('[INIT] Erstelle BotHealthMonitor-Instanz...');
            this.app.botHealthMonitor = new BotHealthMonitor();
            ServiceManager.register("botHealthMonitor", this.app.botHealthMonitor);
            Logger.debug('[INIT] BotHealthMonitor registriert, starte setTimeout...');
            
            // Warte kurz bis IPC vollständig connected ist
            setTimeout(() => {
                Logger.debug('[INIT] setTimeout gefeuert! Starte Monitoring...');
                try {
                    this.app.botHealthMonitor.startMonitoring(60000); // Alle 60 Sekunden
                    Logger.success("🏥 Bot Health Monitoring gestartet (60s Intervall)");
                } catch (error) {
                    Logger.error('[INIT] Fehler beim Starten des BotHealthMonitors:', error);
                }
            }, 3000); // 3s Verzögerung für IPC-Connect

            this.#initializeErrorHandling();
            
            Logger.success("Dashboard-App erfolgreich initialisiert");
            return true;
        } catch (error) {
            Logger.error('Fehler bei der Initialisierung der Dashboard-App:', error);
            
            // Hook bei Fehler ausführen
            if (this.app.pluginManager && this.app.pluginManager.hooks) {
                await this.app.pluginManager.hooks.doAction('dashboard_initialize_failed', error);
            }
            
            throw error;
        }
    }

    /**
     * Übersetzungen laden
     */
    async loadTranslations() {
        const Logger = ServiceManager.get("Logger");
        try {
            this.app.translations = await this.app.i18n.initialize();            
            Logger.success("Übersetzungen geladen");
        } catch (error) {
            Logger.error("Fehler beim Laden der Übersetzungen:", error);
            throw error;
        }
    }

    /**
     * Dashboard-Plugins laden und initialisieren
     */
    async loadPlugins() {
        const Logger = ServiceManager.get("Logger");
        try {
            Logger.info('Initialisiere Dashboard-Plugins...');
            
            // 1. Hook vor der Initialisierung ausführen
            if (this.app.pluginManager.hooks) {
                await this.app.pluginManager.hooks.doAction('before_plugins_load', this.app);
            }
            
            // 2. PluginManager initialisieren
            await this.app.pluginManager.init();
            
            // 3. Core-Plugin aktivieren
            await this.app.pluginManager.enablePlugin('core');
            
            // 4. Andere Plugins basierend auf guild_plugins aktivieren
            // Lade alle Plugins die in mindestens einer Guild aktiviert sind
            const dbService = ServiceManager.get('dbService');
            
            const pluginRows = await dbService.query(`
                SELECT DISTINCT plugin_name 
                FROM guild_plugins 
                WHERE is_enabled = 1 AND plugin_name != 'core'
            `);
            
            // Sicherstellen dass pluginRows ein Array ist
            if (!Array.isArray(pluginRows)) {
                Logger.error('[Plugin Load] Query lieferte kein Array:', pluginRows);
                throw new Error('rows.map is not a function - pluginRows ist kein Array');
            }
            
            let enabledPlugins = pluginRows.map(row => row.plugin_name);
            
            // Filter-Hook anwenden, falls vorhanden
            if (this.app.pluginManager.hooks) {
                enabledPlugins = await this.app.pluginManager.hooks.applyFilter(
                    'filter_enabled_plugins',
                    enabledPlugins
                );
            }
            
            Logger.debug(`Aktiviere ${enabledPlugins.length} Plugins global: ${enabledPlugins.join(', ')}`);
            
            // Plugins aktivieren (außer core, das bereits aktiviert wurde)
            for (const pluginName of enabledPlugins) {
                if (pluginName !== 'core') {
                    await this.app.pluginManager.enablePlugin(pluginName);
                }
            }
            
            // 5. Prüfen, ob bestimmte Plugins für bestimmte Guilds aktiviert werden sollen
            await this.enableGuildSpecificPlugins();
            
            // 6. Plugin-Routen registrieren
            this.app.pluginManager.registerPluginRoutes();
            
            // 7. Plugin-Assets registrieren
            this.registerPluginAssets();
            
            // 8. Shortcodes registrieren
            this.registerPluginShortcodes();
            
            // 9. Hook nach der Initialisierung ausführen
            if (this.app.pluginManager.hooks) {
                await this.app.pluginManager.hooks.doAction('after_plugins_load', this.app);
            }
            
            Logger.success(`${this.app.pluginManager.plugins.size} Plugins für das Dashboard geladen`);
            return true;
        } catch (error) {
            Logger.error('Fehler beim Laden der Dashboard-Plugins:', error);
            
            // Hook bei Fehler ausführen
            if (this.app.pluginManager?.hooks) {
                await this.app.pluginManager.hooks.doAction('plugins_load_failed', error);
            }
            
            throw error;
        }
    }

    /**
     * Konfiguration aus der Datenbank laden
     * HINWEIS: ENABLED_PLUGINS wird nicht mehr aus configs geladen!
     * Plugins werden jetzt über guild_plugins Tabelle verwaltet.
     */
    async loadConfig() {
        const Logger = ServiceManager.get("Logger");
        const dbService = ServiceManager.get('dbService')

        try {
            // Core-Plugin Config laden (shared scope, keine Guild-ID)
            const configs = await dbService.query(
                "SELECT config_key, config_value FROM configs WHERE plugin_name = ?  AND context = ? AND guild_id IS NULL",
                ['core', 'shared']
            );
            
            const config = {};
            
            // Gespeicherte Werte laden
            if (configs && configs.length > 0) {
                for (const entry of configs) {
                    try {
                        config[entry.config_key] = JSON.parse(entry.config_value);
                    } catch (e) {
                        config[entry.config_key] = entry.config_value;
                    }
                }
            }
            
            Logger.debug(`Dashboard-Config geladen: ${Object.keys(config).length} Einträge`);
            return config;
        } catch (error) {
            Logger.error('Fehler beim Laden der Konfiguration:', error);
            return {};
        }
    }
    
    /**
     * Guild-spezifische Plugins aktivieren
     */
    async enableGuildSpecificPlugins() {
        const Logger = ServiceManager.get("Logger");
        const dbService = ServiceManager.get("dbService");
        const pluginManager = ServiceManager.get("pluginManager");
        try {
            // Alle Guild-IDs holen
            const allGuilds = await dbService.query("SELECT _id FROM guilds");
            if (!allGuilds || allGuilds.length === 0) {
                Logger.warn("Keine Guilds gefunden, keine Guild-spezifischen Plugins aktiviert");
                return;
            }
            
            // Set für bereits aktivierte Plugins
            const activatedPlugins = new Set(['core']);
            pluginManager.plugins.forEach(plugin => {
                activatedPlugins.add(plugin.name);
            });
            
            // Für jede Guild die aktivierten Plugins aus guild_plugins holen (NEU!)
            for (const guild of allGuilds) {
                const guildId = guild._id;
                
                // NEU: guild_plugins Tabelle nutzen statt configs
                const enabledPlugins = await dbService.getEnabledPlugins(guildId);

                // Plugins für diese Guild aktivieren
                for (const pluginName of enabledPlugins) {
                    if (pluginName === 'core') continue;
                    
                    // WICHTIG: Owner-only Plugins nur für Control-Guild aktivieren
                    const pluginInfo = await pluginManager.getPluginInfo(pluginName);
                    const controlGuildId = process.env.CONTROL_GUILD_ID;
                    
                    if (pluginInfo?.requiresOwner && String(guildId) !== String(controlGuildId)) {
                        Logger.debug(`[PluginManager] Überspringe Owner-only Plugin ${pluginName} für Guild ${guildId} (nicht Control-Guild)`);
                        continue;
                    }
                    
                    if (!activatedPlugins.has(pluginName)) {
                        try {
                            await pluginManager.enablePlugin(pluginName);
                            activatedPlugins.add(pluginName);
                        } catch (err) {
                            Logger.error(`Fehler beim Aktivieren von Plugin ${pluginName}:`, err);
                            continue;
                        }
                    }
                    try {
                        await pluginManager.enableInGuild(pluginName, guildId);
                    } catch (err) {
                        Logger.error(`Fehler beim Aktivieren von Plugin ${pluginName} für Guild ${guildId}:`, err);
                    }
                }
            }
        } catch (error) {
            Logger.error("Fehler beim Aktivieren guild-spezifischer Plugins:", error);
            throw error;
        }
    }

    /**
     * Plugin-Assets registrieren
     */
    registerPluginAssets() {
        const Logger = ServiceManager.get("Logger");
        // Plugin-Assets werden jetzt über das dynamische Middleware in #initializeMiddlewares() bereitgestellt.
        // Das Middleware ist früh (vor den Routen) registriert und löst Assets zur Laufzeit auf –
        // auch für Plugins die nach dem Serverstart aktiviert wurden.
        Logger.debug('Plugin-Asset-Registrierung abgeschlossen (dynamisches Middleware aktiv)');
    }

    /**
     * Plugin-Shortcodes registrieren
     */
    registerPluginShortcodes() {
        const Logger = ServiceManager.get("Logger");
        if (!this.app.shortcodeParser) {
            Logger.warn("Shortcode-Parser nicht verfügbar");
            return;
        }
        
        for (const plugin of this.app.pluginManager.plugins) {
            if (plugin.shortcodes) {
                for (const [tag, callback] of Object.entries(plugin.shortcodes)) {
                    this.app.shortcodeParser.register(plugin.name, tag, callback);
                }
            }
        }
    }

    /**
     * Server starten
     * @param {number} port - Port, auf dem der Server laufen soll
     */
    listen(port) {
        const Logger = ServiceManager.get("Logger");
        this.app.listen(port, () => {
            Logger.success(`Dashboard läuft auf Port ${port}`);
        });
    }

    /**
     * Express-Server abrufen
     * @returns {Object} Express-Server
     */
    getServer() {
        return this.app;
    }

    /**
     * Middlewares initialisieren
     * @private
     */
    #initializeMiddlewares() {
        // === WICHTIG: Stripe Webhook Route VOR express.json() ===
        // Webhook benötigt raw body für Signature Verification!
        this.app.use(
            '/api/stripe/webhooks', 
            express.raw({ type: 'application/json' }), 
            require('./routes/admin/stripe-webhook.router')
        );
        
        // =====================================================
        // SECURITY MIDDLEWARES (Reihenfolge wichtig!)
        // =====================================================
        
        // 1. Helmet - HTTP Security Headers
        const helmet = require('helmet');
        this.app.use(helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    styleSrc: [
                        "'self'", 
                        "'unsafe-inline'", 
                        "https://fonts.googleapis.com", 
                        "https://cdn.jsdelivr.net",
                        "https://cdnjs.cloudflare.com" // Font Awesome
                    ],
                    scriptSrc: [
                        "'self'", 
                        "'unsafe-inline'", 
                        "'unsafe-eval'", 
                        "https://cdn.jsdelivr.net",
                        "https://cdnjs.cloudflare.com", // Font Awesome
                        "https://js.stripe.com" // Stripe SDK
                    ],
                    scriptSrcAttr: ["'unsafe-inline'"], // Inline Event Handler (onclick, onload, etc.)
                    fontSrc: [
                        "'self'", 
                        "https://fonts.gstatic.com", 
                        "https://cdn.jsdelivr.net",
                        "https://cdnjs.cloudflare.com", // Font Awesome
                        "data:" // Font-Data-URLs
                    ],
                    imgSrc: ["'self'", "data:", "https:", "http:"],
                    connectSrc: [
                        "'self'", 
                        "ws:", 
                        "wss:",
                        "https://cdn.jsdelivr.net", // Source Maps für Chart.js, Toastr, etc.
                        "https://cdnjs.cloudflare.com", // Source Maps für Font Awesome, etc.
                        "https://api.stripe.com", // Stripe API
                        "https://checkout.stripe.com" // Stripe Checkout
                    ],
                    frameSrc: [
                        "'self'",
                        "https://js.stripe.com", // Stripe Elements iframe
                        "https://checkout.stripe.com" // Stripe Checkout iframe
                    ],
                    formAction: [
                        "'self'",
                        "https://firenetworks.de", // PROD Domain (für TinyMCE/AJAX Forms)
                        "https://checkout.stripe.com" // Stripe form submissions
                    ]
                }
            },
            hsts: {
                maxAge: 31536000,
                includeSubDomains: true,
                preload: true
            }
        }));
        
        // 2. Exploit-Blocker (PHP-Scans, Path-Traversal, SQL-Injection)
        const exploitBlocker = require('./middlewares/security/exploit-blocker.middleware');
        this.app.use(exploitBlocker);
        
        // 3. Block Sensitive Files (.env, .git, node_modules, etc.)
        const blockSensitiveFiles = require('./middlewares/blockSensitiveFiles');
        this.app.use(blockSensitiveFiles);
        
        // 4. Rate Limiting - Allgemeines Limit
        const { generalLimiter } = require('./middlewares/security/rate-limiter.middleware');
        this.app.use(generalLimiter);
        
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));
        
        // Cookie Parser (für CSRF Double-Submit-Cookie)
        const cookieParser = require('cookie-parser');
        this.app.use(cookieParser());
        
        this.app.use(expressLayouts);
        
        // Theme Assets (JS, CSS, Images, Fonts, Vendor)
        // Beispiel: /themes/default/assets/js/guild.js
        this.app.use('/themes', express.static(path.join(__dirname, 'themes')));

        // Media Uploads (Guild-spezifische Medien-Bibliothek)
        // Beispiel: /uploads/media/1234567890/abc123.png
        this.app.use('/uploads/media', express.static(path.join(__dirname, 'uploads/media')));

        // Plugin Assets - dynamisches Middleware das zur Laufzeit Plugins auflöst
        // Funktioniert auch für Plugins die nach dem Serverstart aktiviert wurden
        // Beispiel: /assets/plugins/dunemap/images/map.png
        this.app.use('/assets/plugins', (req, res, next) => {
            const pluginManager = this.app.pluginManager;
            if (!pluginManager) return next();

            // /PluginName/sub/path → pluginName + subPath
            const parts = req.path.split('/').filter(Boolean);
            if (parts.length < 1) return next();
            const pluginName = parts[0];
            const subPath = parts.slice(1).join('/');

            const plugin = pluginManager.getPlugin(pluginName);
            if (!plugin || !plugin.publicAssets) return next();

            // Dashboard-Assets: plugins/<name>/dashboard/assets/
            const assetDir = path.join(pluginManager.pluginsDir, pluginName, 'dashboard', 'assets');
            const filePath = path.resolve(assetDir, subPath);

            // Path-Traversal-Schutz
            if (!filePath.startsWith(path.resolve(assetDir) + path.sep) && filePath !== path.resolve(assetDir)) {
                return res.status(403).end();
            }

            if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                // Explizite MIME-Types
                if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) {
                    res.setHeader('Content-Type', 'application/javascript; charset=UTF-8');
                } else if (filePath.endsWith('.css')) {
                    res.setHeader('Content-Type', 'text/css; charset=UTF-8');
                }
                return res.sendFile(filePath);
            }

            // Fallback: Legacy Root-Assets plugins/<name>/assets/
            const rootAssetDir = path.join(pluginManager.pluginsDir, pluginName, 'assets');
            const rootFilePath = path.resolve(rootAssetDir, subPath);
            if (!rootFilePath.startsWith(path.resolve(rootAssetDir) + path.sep) && rootFilePath !== path.resolve(rootAssetDir)) {
                return res.status(403).end();
            }
            if (fs.existsSync(rootFilePath) && fs.statSync(rootFilePath).isFile()) {
                if (rootFilePath.endsWith('.js') || rootFilePath.endsWith('.mjs')) {
                    res.setHeader('Content-Type', 'application/javascript; charset=UTF-8');
                } else if (rootFilePath.endsWith('.css')) {
                    res.setHeader('Content-Type', 'text/css; charset=UTF-8');
                }
                return res.sendFile(rootFilePath);
            }

            next();
        });
        
        // Session & Auth
        this.app.use(sessionMiddleware);
        
        // 4. CSRF Protection (nach Session und Cookie-Parser!)
        const { csrfMiddleware, csrfProtection } = require('./middlewares/security/csrf-protection.middleware');
        this.app.use(csrfMiddleware); // Token generieren
        // csrfProtection wird pro-Route angewendet (siehe unten)
        
        // Rest of the middlewares
        this.app.use(hookMiddleware);
        // ✅ WICHTIG: baseMiddleware VOR guildMiddleware! 
        // baseMiddleware lädt ungefilterte Navigation, guildMiddleware filtert und überschreibt
        this.app.use(baseMiddleware);
        this.app.use(guildMiddleware);  // NACH base - überschreibt res.locals.guildNav mit gefilterten Items
        this.app.use(userConfigMiddleware); // User-Config nach baseMiddleware (braucht req.session.user)
    }


    /**
     * Fehlerbehandlung initialisieren
     * @private
     */
    #initializeErrorHandling() {
        // 404-Handler - MUSS VOR dem Error-Handler stehen
        this.app.use((req, res, next) => {
            res.status(404).send({
                success: false,
                code: 404,
                message: "404 Not Found. Visit /docs for more information"
            });
        });
        
        // Error Middleware (MUSS als letztes registriert werden)
        this.app.use(errorMiddleware);
    }
};