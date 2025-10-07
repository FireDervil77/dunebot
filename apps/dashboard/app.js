const express = require("express");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// ServiceManager aus SDK holen
const PluginManager = require("./helpers/PluginManager");
const { ServiceManager, I18nManager } = require("dunebot-core");
const { parseJsonArray } = require("dunebot-sdk/utils");
const { ThemeManager, AssetManager } = require('dunebot-sdk');
const ShortcodeParser = require("dunebot-sdk/lib/utils/ShortcodeParser");
const { NotificationManager} = require('dunebot-sdk');
const { UpdatesManager } = require('dunebot-sdk');
const { NavigationManager } = require("dunebot-sdk");
const PathConfig = require("dunebot-sdk/lib/utils/PathConfig"); // Hier PathConfig importieren
const { RouterManager } = require('dunebot-sdk');

// Middlewares
const expressLayouts = require("express-ejs-layouts");
const sessionMiddleware = require("./middlewares/session.middleware");
const baseMiddleware = require("./middlewares/context/base.middleware");
const { CheckAuth, CheckAdmin } = require("./middlewares/auth.middleware");
const errorMiddleware = require("./middlewares/error.middleware");
const authMiddleware = require("./middlewares/auth.middleware");
const guildMiddleware = require("./middlewares/context/guild.middleware");
const hookMiddleware = require("./middlewares/context/hook.middleware");

// Routers
const frontendRouter = require("./routes/frontend.router");
const authRouter = require("./routes/auth.router");
const guildRouter = require("./routes/guild.router");
const apiRouter = require("./routes/api.router");


module.exports = class App {
    constructor(ipcServer, dbService) {
        if (!ipcServer) throw new Error("IPC Server required");
        if (!dbService) throw new Error("DB Service required");
        
        this.app = express();
        this.app.set('trust proxy', 1);
        
        const Logger = ServiceManager.get("Logger");

        // RouterManager ZUERST initialisieren
        this.routerManager = new RouterManager(this.app);
        ServiceManager.register('routerManager', this.routerManager);

        // DANN erst die Router importieren
        this.routers = {
            frontend: require("./routes/frontend.router"),
            auth: require("./routes/auth.router"),
            guild: require("./routes/guild.router"),
            api: require("./routes/api.router")
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

        
        // Plugin-Manager initialisieren
        this.app.pluginManager = new PluginManager(
            this.app,
            process.env.REGISTRY_PATH,
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
                .register('/guild', this.routers.guild, { 
                    auth: true,  // Aktiviert CheckAuth Middleware
                    middlewares: [guildMiddleware]  // Zusätzliche Middleware
                })
                .register('/api', this.routers.api, { 
                    auth: true  // Aktiviert CheckAuth Middleware
                });
            
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

            // Update-Controller initialisieren (für automatische Update-Checks)
            this.app.updatesManager = new UpdatesManager(this.app);
            Logger.info("Update-Manager initialisiert - Prüft automatisch auf Updates");
            ServiceManager.register("updatesManager", this.app.updatesManager);

            // Plugins laden
            await this.loadPlugins();
            
            // View-Pfade nach Plugin-Load aktualisieren (damit Plugin-Views gefunden werden)
            if (this.app.themeManager && typeof this.app.themeManager.setupViewEngine === 'function') {
                this.app.themeManager.setupViewEngine();
                Logger.debug('Plugin-View-Pfade nach Plugin-Load aktualisiert');
            }
            
            // Hook nach der Initialisierung ausführen
            if (this.app.pluginManager && this.app.pluginManager.hooks) {
                await this.app.pluginManager.hooks.doAction('after_dashboard_initialize', this.app);
            }

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
            
            // 4. Andere Plugins basierend auf der Konfiguration aktivieren
            // HINWEIS: SuperAdmin wird NICHT mehr automatisch aktiviert!
            // Es muss manuell über die Plugin-Verwaltung aktiviert werden.
            const config = await this.loadConfig();
            let enabledPlugins = config.ENABLED_PLUGINS || ['core'];
            
            // Filter anwenden, falls vorhanden
            if (this.app.pluginManager.hooks) {
                enabledPlugins = await this.app.pluginManager.hooks.applyFilter(
                    'filter_enabled_plugins',
                    enabledPlugins
                );
            }
            
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
     */
    async loadConfig() {
        const Logger = ServiceManager.get("Logger");
        const dbService = ServiceManager.get('dbService')

        try {
            const configs = await dbService.query(
                "SELECT config_key, config_value FROM configs WHERE context = ?",
                ['dashboard']
            );
            if (!configs || configs.length === 0) {
                return { ENABLED_PLUGINS: ['core'] };
            }
            
            const config = {};
            
            // Default-Werte
            config.ENABLED_PLUGINS = ['core'];
            
            // Gespeicherte Werte laden
            for (const entry of configs) {
                try {
                    config[entry.config_key] = JSON.parse(entry.config_value);
                } catch (e) {
                    config[entry.config_key] = entry.config_value;
                }
            }
            
            return config;
        } catch (error) {
            Logger.error('Fehler beim Laden der Konfiguration:', error);
            return { ENABLED_PLUGINS: ['core'] };
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
                    
                    // WICHTIG: Owner-only Plugins (wie superadmin) nur für Control-Guild aktivieren
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
        for (const plugin of this.app.pluginManager.plugins) {
            if (plugin.publicAssets) {
                const assetsPath = path.join(this.app.pluginManager.pluginsDir, plugin.name, 'dashboard', 'public');
                if (fs.existsSync(assetsPath)) {
                    this.app.use(`/assets/plugins/${plugin.name}`, express.static(assetsPath));
                    Logger.debug(`Assets für Plugin ${plugin.name} registriert unter /assets/plugins/${plugin.name}`);
                }
            }
        }
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
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));
        this.app.use(expressLayouts);
        this.app.use(express.static(path.join(__dirname, "/public")));
        
        // Session & Auth
        this.app.use(sessionMiddleware);
        
        // Rest of the middlewares
        this.app.use(hookMiddleware);
        this.app.use(guildMiddleware);
        this.app.use(baseMiddleware);
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

        // Allgemeiner Error-Handler - MUSS als LETZTES stehen
        this.app.use(errorMiddleware);
    }
};