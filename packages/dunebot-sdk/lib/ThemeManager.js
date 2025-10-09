const fs = require('fs');
const path = require('path');
const express = require('express'); // Express für statische Dateien importieren

const { ServiceManager } = require("dunebot-core");


class ThemeManager {
    constructor(app) {
        const Logger = ServiceManager.get('Logger');
        this.app = app;
        this.ownerOnly = true;
        
        // PathConfig als Klassenvariable speichern
        this.PathConfig = require('./utils/PathConfig').getInstance();
        this.ejs = require('ejs');

        // Theme-Basis
        this.activeTheme = 'default';
        this.themeConfig = {};
        this.themeContext = {};
        this.currentLocals = {};
        
        this.themesDir = this.PathConfig.getPath('dashboard').themes;
        this.viewPaths = {
            theme: this.PathConfig.getPath('theme', this.activeTheme).views,
            default: this.PathConfig.getPath('theme', 'default').views,
            global: this.PathConfig.getPath('dashboard').views
        };

        Logger.debug('ThemeManager initialisiert mit Pfaden:', this.viewPaths);
    }

        
    /**
     *  HELPER methoden for the themeContext
     */


    /**
     * View rendern mit automatischem Context-Management
     * @param {Object} res - Express Response
     * @param {string} view - View-Pfad
     * @param {Object} data - Zusätzliche View-Daten
     */
    async renderView(res, view, data = {}) {
        const Logger = ServiceManager.get('Logger');

        try {
            // 1. Layout für den Bereich setzen
            const section = view.startsWith('guild/') ? 'guild' : 
                          view.startsWith('frontend/') ? 'frontend' : 
                          'frontend'; // default

            // 2. Basis-Context laden
            const baseContext = await this.getContext();

            // 3. View-spezifische Daten mit Basis-Context mergen
            const viewData = {
                ...baseContext,           // Basis-Context (User, Guild, etc.)
                ...res.locals,            // Express locals (enthält bereits vorhandene Daten)
                ...data                   // View-spezifische Daten (überschreibt alles)
            };

            // 4. WICHTIG: Layout in res.locals setzen für express-ejs-layouts
            res.locals.layout = this.getLayout(section);
            
            // 5. WICHTIG: Alle View-Daten in res.locals mergen für express-ejs-layouts
            Object.assign(res.locals, viewData);

            Logger.debug('Render Context:', {
                view,
                section,
                hasUser: !!viewData.user,
                layout: res.locals.layout,
                hasEnabledPlugins: !!viewData.enabledPlugins
            });

            // 6. View rendern (express-ejs-layouts nutzt jetzt res.locals)
            res.render(view);

        } catch (error) {
            Logger.error('Fehler beim Rendern der View:', error);
            throw error;
        }
    }
    

    /**
     * Theme-Routen registrieren
     */
    registerThemeRoutes(routerManager) {
        const Logger = ServiceManager.get('Logger');
        
        try {
            // Theme-Assets registrieren
            const assetsPath = this.PathConfig.getPath('theme', this.activeTheme).assets;
            if (fs.existsSync(assetsPath)) {
                routerManager.register(
                    `/themes/${this.activeTheme}/assets`,
                    express.static(assetsPath),
                    { theme: this.activeTheme }
                );
                Logger.debug(`Theme-Assets registriert für ${this.activeTheme}`);
            }

            // Theme-spezifische Routen registrieren
            if (this.theme?.routes) {
                Object.entries(this.theme.routes).forEach(([path, handler]) => {
                    routerManager.register(path, handler, {
                        theme: this.activeTheme
                    });
                });
            }
        } catch (error) {
            Logger.error('Fehler beim Registrieren der Theme-Routen:', error);
            throw error;
        }
    }


    /**
     * Gibt die Navigation für einen Bereich zurück.
     * Holt die Navigation immer vom NavigationManager.
     * @param {string} area - Bereich (z.B. 'guild', 'frontend', 'auth')
     * @returns {Promise<Array>} Navigationseinträge für den Bereich
     * @author firedervil
     */
    async getNavigation(area) {
        const navigationManager = ServiceManager.get('navigationManager');
        return await navigationManager.getNavigation(area);
    }

    /**
     * Setzt den aktuellen Request-Kontext für Partials
     * @param {Object} locals - res.locals des aktuellen Requests
     */
    setCurrentLocals(locals) {
        this.currentLocals = locals || {};
        return this;
    }

    /**
     * Löscht den aktuellen Request-Kontext nach Response-Ende
     */
    clearCurrentLocals() {
        this.currentLocals = {};
        return this;
    }

    // Neue Methode: Globale Variablen setzen
    setGlobalVar(key, value) {
        this.themeContext[key] = value;
        // Auch in app.locals spiegeln für direkten Zugriff
        this.app.locals[key] = value;
        return this;
    }

    // Neue Methode: Mehrere globale Variablen setzen
    setGlobalVars(vars) {
        Object.entries(vars).forEach(([key, value]) => {
            this.setGlobalVar(key, value);
        });
        return this;
    }

    /**
     * Initialisiert die Standard-Kontext-Variablen für alle Views und Partials
     * Dies wird beim Initialisieren des Themes aufgerufen
     * 
     * @author FireDervil
     * @returns {ThemeManager} - Für Method Chaining
     */
    initializeDefaultContext() {
        const Logger = ServiceManager.get('Logger');
        Logger.debug('Initialisiere Standard-Kontext-Variablen für alle Views und Partials');
        
        // Basis-Kontextvariablen
        this.setGlobalVars({
            user: null,                       // Aktueller Benutzer (wird pro Request gesetzt)
            guild: null,                      // Aktuelle Guild (wird pro Request gesetzt)
            baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || 8900}`,
            siteName: process.env.SITE_NAME || 'DuneBot',
            version: process.env.npm_package_version || '1.0.0',
            environment: process.env.NODE_ENV || 'development',
            year: new Date().getFullYear(),
            
            // Core Plugin Config (mit Fallbacks)
            coreConfig: {
                githubUrl: process.env.GITHUB_URL || 'https://github.com/yourusername/dunebot',
                supportUrl: process.env.SUPPORT_URL || '#',
                documentationUrl: process.env.DOCS_URL || '#documentation'
            },
            
            // Theme-bezogene URLs
            themeUrls: {
                assets: this.PathConfig.getUrl('theme', this.activeTheme, 'assets'),
                public: this.PathConfig.getUrl('theme', this.activeTheme, 'public')
            },
            
            // Arrays und Objekte mit Standardwerten initialisieren
            notifications: [],
            unreadMessages: 0,
            messages: [],
            guildNav: [],
            frontendNav: [],
            
            // Cache-Buster für Assets
            cacheBuster: Date.now(),
            
            // Hilfsfunktionen
            formatDate: (date) => {
                if (!date) return '';
                const d = new Date(date);
                return d.toLocaleDateString('de-DE', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            }
        });
        
        return this;
    }

    /**
     * Theme initialisieren
     * 
     * @param {string} [themeName='default'] - Name des zu ladenden Themes
     * @returns {Promise<boolean>} Erfolg der Initialisierung
     */
    async initialize(themeName = 'default') {
        const Logger = ServiceManager.get('Logger');

        try {
            // Theme-Name verwenden (keine DB-Abfrage ohne Guild-ID!)
            this.activeTheme = themeName || 'default';
            
            Logger.debug(`Initialisiere Theme '${this.activeTheme}'...`);
            
            // Standard-Kontext initialisieren
            this.initializeDefaultContext();
            
            // Theme-Konfiguration laden
            await this.loadThemeConfig();
            
            // Theme-spezifische View-Engine konfigurieren
            this.setupViewEngine();
            
            // Theme-Assets für Express registrieren
            this.registerThemeAssets();
            
            // Hooks registrieren
            if (this.themeInstance && typeof this.themeInstance.registerHooks === 'function') {
                this.themeInstance.registerHooks();
            }
            
            Logger.success(`Theme '${this.activeTheme}' initialisiert`);
            return true;
        } catch (error) {
            Logger.error('Fehler bei der Theme-Initialisierung:', error);
            throw error;
        }
    }
    
    /**
     * Theme-Konfiguration laden
     */
    async loadThemeConfig() {
        const Logger = ServiceManager.get('Logger');
        
        try {
            const configPath = this.PathConfig.getPath('theme', this.activeTheme).config;
            const jsModulePath = this.PathConfig.getPath('theme', this.activeTheme).module;
            
            if (fs.existsSync(configPath)) {
                this.themeConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            } else if (fs.existsSync(jsModulePath)) {
                const ThemeModule = require(jsModulePath);
                const themeInstance = new ThemeModule(this.app);
                this.themeConfig = {
                    name: themeInstance.name || this.activeTheme,
                    version: themeInstance.version || '1.0.0',
                    description: themeInstance.description || 'Standard-Theme',
                    author: themeInstance.author || 'System',
                    layouts: themeInstance.layouts || {},
                    info: themeInstance.info || {
                        darkMode: false,
                        supportRTL: false,
                        responsive: true
                    }
                };
                this.themeInstance = themeInstance;
                Logger.info(`Theme-Modul '${this.themeConfig.name}' geladen`);
            }
            
            return this.themeConfig;
        } catch (error) {
            Logger.error('Fehler beim Laden der Theme-Konfiguration:', error);
            throw error;
        }
    }
    
    /**
     * Theme-spezifische View-Engine konfigurieren
     */
     setupViewEngine() {
        const Logger = ServiceManager.get('Logger');
        const i18n = ServiceManager.get('i18n');

        // Plugin-Views sammeln (nur Dashboard-Plugin-Views)
        // ROOT_DIR ist 2 Ebenen über apps/dashboard
        const projectRoot = path.join(process.cwd(), '..', '..');
        const pluginsDir = path.join(projectRoot, 'plugins');
        const pluginViewPaths = [];

        Logger.info(`Durchsuche Plugins-Verzeichnis nach Views: ${pluginsDir}`);
        
        if (fs.existsSync(pluginsDir)) {
            const plugins = fs.readdirSync(pluginsDir);
            Logger.info(`Gefundene Plugins (${plugins.length}): ${plugins.join(', ')}`);
            
            plugins.forEach(plugin => {
                // Überspringe Dateien und versteckte Verzeichnisse
                const pluginPath = path.join(pluginsDir, plugin);
                const stat = fs.statSync(pluginPath);
                
                if (!stat.isDirectory() || plugin.startsWith('.') || plugin.startsWith('_')) {
                    Logger.debug(`Überspringe Plugin: ${plugin} (Datei oder versteckt)`);
                    return;
                }
                
                const pluginDashboardPath = path.join(pluginsDir, plugin, 'dashboard');
                const pluginViewsPath = path.join(pluginDashboardPath, 'views');
                
                Logger.debug(`Prüfe Plugin ${plugin}: ${pluginViewsPath}`);
                
                if (fs.existsSync(pluginViewsPath)) {
                    pluginViewPaths.push(pluginViewsPath);
                    Logger.info(`✅ Plugin-Views gefunden für ${plugin}: ${pluginViewsPath}`);
                } else {
                    Logger.debug(`❌ Keine Views für Plugin ${plugin}`);
                }
            });
        } else {
            Logger.warn(`Plugins-Verzeichnis existiert nicht: ${pluginsDir}`);
        }

        // Views-Verzeichnisse aktualisieren
        const viewPaths = [
            ...pluginViewPaths,                                    // Plugin Views (höchste Priorität)
            this.PathConfig.getPath('theme', this.activeTheme).views,   // Aktives Theme
            this.PathConfig.getPath('theme', 'default').views,          // Default Theme
            this.PathConfig.getPath('dashboard').views                  // Globale Views
        ];
        
        // Debug-Logging angepasst an existierende Struktur
        Logger.debug('View-Pfade:', {
            pluginViews: pluginViewPaths,
            themeViews: this.viewPaths.theme,
            defaultViews: this.viewPaths.default,
            globalViews: this.viewPaths.global
        });

        
        this.app.set('views', viewPaths);
        Logger.debug('View-Pfade konfiguriert:', viewPaths);

        // EJS Layout-Verzeichnis anpassen
        this.app.set('layout', 'layouts/frontend');
        this.app.set('layout extractScripts', true);
        this.app.set('layout extractStyles', true);

        this.app.locals.tr = this.app.locals.tr || ((key, options) => {
            const locale = this.app?.session?.locale || 'de-DE';
            return i18n?.tr?.(key, options, locale) || key;
        });
        
        // app.locals für Closure speichern (wichtig für includePartial)
        const appLocals = this.app.locals;
        
        // ============================================================================
        // GLOBAL FUNCTION: includePartial (WordPress-Style!)
        // ============================================================================
        // WICHTIG: Als GLOBALE FUNKTION registrieren, damit 'this' = EJS-Context!
        // Aufruf im Template: <%- includePartial('partial/name') %>
        this.app.locals.includePartial = function(filename, data = {}) {
            try {                    
                const ejs = require('ejs');
                const PathConfig = require('./utils/PathConfig').getInstance();
                const activeTheme = 'default'; // TODO: Dynamisch
                
                // DEBUG
                Logger.debug(`[includePartial] ${filename} - Has guildId:`, typeof this.guildId !== 'undefined', this.guildId);
                
                const searchPaths = [
                    path.join(PathConfig.getPath('theme', activeTheme).root, 'partials', filename + '.ejs'),
                    path.join(PathConfig.getPath('theme', activeTheme).root, filename + '.ejs'),
                    path.join(PathConfig.getPath('theme', activeTheme).views, 'partials', filename + '.ejs'),
                    path.join(PathConfig.getPath('theme', 'default').root, 'partials', filename + '.ejs'),
                    path.join(PathConfig.getPath('theme', 'default').views, 'partials', filename + '.ejs')
                ];
                
                const filePath = searchPaths.find(p => fs.existsSync(p));
                if (!filePath) {
                    Logger.warn(`Partial ${filename} nicht gefunden`);
                    return `<!-- Partial ${filename}.ejs nicht gefunden -->`;
                }
                
                const template = fs.readFileSync(filePath, 'utf8');
                
                // KRITISCH: Spread-Order! appLocals → this (EJS) → data
                // this enthält bereits res.locals aus renderView (viewData)
                const renderContext = {
                    ...appLocals,  // Globals (tr, theme, coreConfig)
                    ...this,       // EJS View Data (user, guild, guildId, supportUrl, etc.)
                    ...data        // Explicit data
                };
                
                // FORCE: EJS-Cache für diese Datei löschen (nur in Development, wichtig bei Template-Änderungen)
                if (process.env.NODE_ENV !== 'production') {
                    ejs.clearCache();
                }
                
                return ejs.render(template, renderContext, { cache: false, filename: filePath });
            } catch (error) {
                Logger.error(`Fehler beim Einbinden des Partials ${filename}:`, error);
                return `<!-- Fehler beim Laden von ${filename} -->`;
            }
        };
        
        // ============================================================================
        // GLOBAL FUNCTION: includePluginPartial (für Plugin-Partials!)
        // ============================================================================
        // Lädt Partials aus Plugin-Verzeichnissen
        // Aufruf im Template: <%- includePluginPartial('pluginname', 'partial/name') %>
        this.app.locals.includePluginPartial = function(pluginName, filename, data = {}) {
            try {                    
                const ejs = require('ejs');
                const path = require('path');  // WICHTIG: path importieren!
                const PathConfig = require('./utils/PathConfig').getInstance();
                
                // DEBUG
                Logger.debug(`[includePluginPartial] Plugin: ${pluginName}, Partial: ${filename}`);
                
                // Plugin-spezifische Suchpfade
                const pluginPaths = PathConfig.getPath('plugin', pluginName);
                
                // DEBUG: Pfade ausgeben
                Logger.debug(`[includePluginPartial] pluginPaths:`, pluginPaths);
                
                const searchPaths = [
                    // Dashboard-Partials
                    path.join(pluginPaths.dashboard, 'views', 'partials', filename + '.ejs'),
                    path.join(pluginPaths.dashboard, 'partials', filename + '.ejs'),
                    // Root-Level Partials
                    path.join(pluginPaths.root, 'partials', filename + '.ejs')
                ];
                
                const filePath = searchPaths.find(p => fs.existsSync(p));
                if (!filePath) {
                    Logger.warn(`Plugin-Partial ${pluginName}/${filename} nicht gefunden. Suchpfade:`, searchPaths);
                    return `<!-- Plugin-Partial ${pluginName}/${filename} nicht gefunden -->`;
                }
                
                Logger.debug(`Plugin-Partial gefunden: ${filePath}`);
                const template = fs.readFileSync(filePath, 'utf8');
                
                // Kontext wie bei includePartial: appLocals → this (EJS) → data
                const renderContext = {
                    ...appLocals,  // Globals (tr, theme, coreConfig)
                    ...this,       // EJS View Data (user, guild, guildId, etc.)
                    ...data        // Explicit data
                };
                
                // EJS-Cache löschen in Development
                if (process.env.NODE_ENV !== 'production') {
                    ejs.clearCache();
                }
                
                // Template rendern
                let renderedContent = ejs.render(template, renderContext, { cache: false, filename: filePath });
                
                // ============================================================================
                // SCRIPT EXTRACTION: Scripts aus dem gerenderten Content extrahieren
                // und in res.locals._scripts sammeln (wie express-ejs-layouts es macht)
                // ============================================================================
                const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
                const scripts = [];
                let match;
                
                // Alle <script> Tags finden
                while ((match = scriptRegex.exec(renderedContent)) !== null) {
                    scripts.push(match[0]); // Komplettes <script>...</script> Tag
                }
                
                if (scripts.length > 0) {
                    Logger.debug(`[includePluginPartial] ${scripts.length} Script(s) gefunden und extrahiert`);
                    
                    // Scripts aus dem Content entfernen
                    renderedContent = renderedContent.replace(scriptRegex, '');
                    
                    // Scripts in renderContext._pluginScripts sammeln (kommt von res.locals!)
                    // renderContext enthält: appLocals + this (EJS context) + data
                    // res.locals._pluginScripts wird in base.middleware.js initialisiert
                    if (Array.isArray(renderContext._pluginScripts)) {
                        renderContext._pluginScripts.push(...scripts);
                        Logger.debug(`[includePluginPartial] Scripts zu _pluginScripts hinzugefügt. Total: ${renderContext._pluginScripts.length}`);
                    } else {
                        Logger.warn(`[includePluginPartial] renderContext._pluginScripts ist kein Array!`, typeof renderContext._pluginScripts);
                    }
                }
                
                return renderedContent;
            } catch (error) {
                Logger.error(`Fehler beim Einbinden des Plugin-Partials ${pluginName}/${filename}:`, error);
                return `<!-- Fehler beim Laden von ${pluginName}/${filename}: ${error.message} -->`;
            }
        };
        
        // ============================================================================
        // Theme-Helper-Objekt (für theme.asset(), theme.info)
        // ============================================================================
        // Globale Theme-Helfer registrieren
        this.app.locals.theme = {
           asset: (assetPath) => {
                
                // Fallback-Bild definieren
                const fallbackRel = 'images/dunebot-news.gif';

                // Null / undefined / leer -> Fallback
                if (!assetPath || typeof assetPath !== 'string') {
                    assetPath = fallbackRel;
                }

                // Absolute URL unverändert zurückgeben
                if (/^https?:\/\//i.test(assetPath)) {
                    return assetPath;
                }

                // Prüfen, ob die Datei im aktiven Theme existiert
                const activeThemeAssets = this.PathConfig.getPath('dashboard').assets(this.activeTheme);
                const activeAssetPath = path.join(activeThemeAssets.root, assetPath);
                
                if (fs.existsSync(activeAssetPath)) {
                    return this.PathConfig.getUrl('theme', this.activeTheme, 'assets') + '/' + assetPath;
                }
                
                // Fallback: Default Theme (auch dort prüfen)
                const defaultAssets = this.PathConfig.getPath('dashboard').assets('default');
                const defaultAssetPath = path.join(defaultAssets.root, assetPath);
                if (fs.existsSync(defaultAssetPath)) {
                    return this.PathConfig.getUrl('theme', 'default', 'assets') + '/' + assetPath;
                }

                // Letzter Ausweg: Fallback-Bild im Default Theme
                return this.PathConfig.getUrl('theme', 'default', 'assets') + '/' + fallbackRel;
            },
            info: this.themeConfig
        };
        
        // ============================================================================
        // GLOBAL HELPER: getUserAvatar (Discord Avatar mit Fallback)
        // ============================================================================
        /**
         * Gibt den Discord Avatar-URL zurück mit Fallback für User ohne Avatar
         * @param {Object} user - User-Objekt mit info.id, info.avatar, info.discriminator
         * @param {number} size - Avatar-Größe (default: 128)
         * @returns {string} - Avatar-URL
         */
        this.app.locals.getUserAvatar = function(user, size = 128) {
            if (!user || !user.info || !user.info.id) {
                return '/themes/default/assets/images/default-avatar.png';
            }
            
            // User hat eigenen Avatar
            if (user.info.avatar) {
                const extension = user.info.avatar.startsWith('a_') ? 'gif' : 'png';
                return `https://cdn.discordapp.com/avatars/${user.info.id}/${user.info.avatar}.${extension}?size=${size}`;
            }
            
            // Fallback: Discord Default Avatar
            // Discord nutzt (discriminator % 5) für Default Avatars
            // Seit Discord's neue Username-System: User-ID Modulo verwenden
            const defaultAvatarIndex = user.info.discriminator 
                ? parseInt(user.info.discriminator) % 5 
                : (BigInt(user.info.id) >> BigInt(22)) % BigInt(5);
            
            return `https://cdn.discordapp.com/embed/avatars/${defaultAvatarIndex}.png`;
        };

        Logger.debug('View-Engine konfiguriert mit Pfaden:', this.app.get('views'));
    }
    
    /**
     * Rendert ein Widget-Partial und merged den kompletten Kontext
     * @param {string} widgetName - Name des Widgets (z.B. 'server-info')
     * @param {Object} data - Kontextdaten für das Widget
     * @returns {Promise<string>} - Gerenderter HTML-String
     * @author DuneBot Team
     */
     async renderWidgetPartial(widgetName, data = {}) {
        const Logger = ServiceManager.get('Logger');
        const PathConfig = require('./utils/PathConfig').getInstance(); // Import hinzugefügt
        const searchPaths = [];

       try {
            // 1. Plugin-spezifischer Pfad (wenn Plugin angegeben)
            if (data.plugin) {
                const pluginPaths = PathConfig.getPath('plugin', data.plugin);
                searchPaths.push(path.join(pluginPaths.widgets, widgetName + '.ejs'));
                Logger.debug(`Plugin-Widget-Pfad: ${searchPaths[0]}`);
            }

            // 2. Alle Plugin-Pfade durchsuchen
            const pluginsDir = PathConfig.getPath('plugins');
            if (fs.existsSync(pluginsDir)) {
                const plugins = fs.readdirSync(pluginsDir);
                plugins.forEach(plugin => {
                    const pluginPaths = PathConfig.getPath('plugin', plugin);
                    searchPaths.push(path.join(pluginPaths.widgets, widgetName + '.ejs'));
                });
            }

            // 3. Theme-spezifische Widget-Pfade
            searchPaths.push(
                path.join(this.themesDir, this.activeTheme, 'views', 'widgets', widgetName + '.ejs'),
                path.join(this.themesDir, 'default', 'views', 'widgets', widgetName + '.ejs')
            );

            // Debug: Alle Suchpfade ausgeben
            Logger.debug('Widget-Suchpfade:', searchPaths);

            // Ersten existierenden Pfad finden und Widget rendern
            for (const widgetPath of searchPaths) {
                if (fs.existsSync(widgetPath)) {
                    Logger.debug(`Widget gefunden: ${widgetPath}`);
                    return await this.ejs.renderFile(widgetPath, {
                        ...this.app.locals,
                        ...(this.currentLocals || {}),
                        ...this.themeContext,
                        ...data
                    }, { async: true });
                }
            }

            Logger.warn(`Widget ${widgetName} nicht gefunden`);
            return `<!-- Widget ${widgetName} nicht gefunden -->`;

        } catch (error) {
            Logger.error(`Fehler beim Rendern des Widgets ${widgetName}:`, error);
            return `<!-- Fehler beim Rendern von Widget ${widgetName} -->`;
        }
    }

    /**
     * Gibt den aktuellen Theme-Kontext zurück
     * 
     * @author FireDervil
     * @returns {Object} Theme-Kontext-Objekt
     */
    getContext() {
        return this.themeContext || {};
    }
    
    /**
     * Gibt das aktuell aktive Theme zurück
     * @returns {string} Name des aktiven Themes
     */
    getActiveTheme() {
        return this.activeTheme || 'default';
    }

    /**
     * Theme-Assets für Express registrieren
     * Macht die Assets unter /themes/<themeName>/assets/ verfügbar
     * 
     * @author DuneBot Team
     */
    registerThemeAssets() {
        const PathConfig = require('./utils/PathConfig').getInstance();
        const Logger = ServiceManager.get('Logger');

        try {
            Logger.debug(`Theme-Assets werden registriert...`);
            
            // MIME-Typen-Map für Asset-Typen
            const mimeTypes = {
                '.css': 'text/css',
                '.js': 'application/javascript',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.gif': 'image/gif',
                '.svg': 'image/svg+xml',
                '.ico': 'image/x-icon',
                '.woff': 'font/woff',
                '.woff2': 'font/woff2',
                '.ttf': 'font/ttf',
                '.eot': 'application/vnd.ms-fontobject'
            };

            // Header-Setter Funktion für Express static
            const setHeaders = (res, filePath) => {
                const ext = path.extname(filePath).toLowerCase();
                if (mimeTypes[ext]) {
                    res.setHeader('Content-Type', mimeTypes[ext]);
                }
                res.setHeader('Cache-Control', 'public, max-age=86400'); // 24h Cache
            };

            // 1. Globales Theme-Verzeichnis
            const themesPath = PathConfig.getPath('dashboard').themes;
            this.app.use('/themes', express.static(themesPath, { setHeaders }));
            Logger.debug(`Globales Theme-Verzeichnis registriert: ${themesPath}`);

            // 2. Aktives Theme (Priorität)
            const activeThemeAssets = PathConfig.getPath('dashboard').assets(this.activeTheme);
            if (fs.existsSync(activeThemeAssets.root)) {
                const activeThemeUrl = PathConfig.getUrl('theme', this.activeTheme, 'assets');
                this.app.use(activeThemeUrl, express.static(activeThemeAssets.root, { setHeaders }));
                Logger.debug(`Aktives Theme registriert: ${activeThemeAssets.root} -> ${activeThemeUrl}`);

                // Debug-Info für wichtige Assets
                const assetPaths = {
                    css: path.join(activeThemeAssets.css, 'main.css'),
                    js: path.join(activeThemeAssets.js, 'main.js')
                };

                Object.entries(assetPaths).forEach(([type, filePath]) => {
                    Logger.debug(`${type.toUpperCase()}-Datei Prüfung:`, {
                        path: filePath,
                        exists: fs.existsSync(filePath),
                        url: `${activeThemeUrl}/${type}/main.${type}`
                    });
                });
            }

            // 3. Default Theme (Fallback)
            if (this.activeTheme !== 'default') {
                const defaultThemeAssets = PathConfig.getPath('dashboard').assets('default');
                if (fs.existsSync(defaultThemeAssets.root)) {
                    const defaultThemeUrl = PathConfig.getUrl('theme', 'default', 'assets');
                    this.app.use(defaultThemeUrl, express.static(defaultThemeAssets.root, { setHeaders }));
                    Logger.debug(`Default Theme als Fallback registriert: ${defaultThemeAssets.root} -> ${defaultThemeUrl}`);
                }
            }

            // 4. Plugin Assets (wenn vorhanden)
            const pluginsDir = PathConfig.getPath('plugins');
            if (fs.existsSync(pluginsDir)) {
                fs.readdirSync(pluginsDir).forEach(plugin => {
                    const pluginPath = PathConfig.getPath('plugin', plugin);
                    if (pluginPath && fs.existsSync(pluginPath.assets)) {
                        const pluginUrl = PathConfig.getUrl('plugin', plugin);
                        this.app.use(pluginUrl, express.static(pluginPath.assets, { setHeaders }));
                        Logger.debug(`Plugin Assets registriert: ${plugin} -> ${pluginUrl}`);
                    }
                });
            }

            Logger.success('Theme-Assets erfolgreich registriert');

        } catch (error) {
            Logger.error('Fehler beim Registrieren der Theme-Assets:', error);
            throw error;
        }
    }
    
        /**
     * Lädt globale Benachrichtigungen für den View-Kontext
     * @param {Object} req - Express Request
     * @param {Object} res - Express Response
     */
    async loadGlobalNotifications(req, res) {
        const Logger = ServiceManager.get('Logger');
        const notificationManager = ServiceManager.get('notificationManager');

        if (!notificationManager) return [];
        
        try {
            // Benutzer-Locale aus Session oder res.locals ermitteln
            const userLocale = req.session?.locale || res.locals?.locale || 'de-DE';
            
            // Benachrichtigungen für den aktuellen Benutzer laden
            const notifications = await notificationManager.getNotificationsForUser(req.user, userLocale);
            
            // In den View-Kontext einfügen
            res.locals.globalNotifications = notifications;
            return notifications;
        } catch (error) {
            Logger.error('Fehler beim Laden globaler Benachrichtigungen:', error);
            return [];
        }
    }

    /**
     * Theme laden und initialisieren
     */
    async loadTheme() {
        const Logger = ServiceManager.get('Logger');
        const PathConfig = require('./utils/PathConfig').getInstance();
        
        try {
            const themePath = PathConfig.getPath('theme', this.activeTheme).module;
            
            if (fs.existsSync(themePath)) {
                const ThemeClass = require(themePath);
                this.theme = new ThemeClass(this.app);
                
                await this.theme.initialize();
                
                this.themeConfig = {
                    ...this.themeConfig,
                    ...this.theme.config
                };
                
                Logger.debug(`Theme '${this.activeTheme}' geladen`);
            } else {
                Logger.warn(`Keine Theme-Klasse für '${this.activeTheme}' gefunden in: ${themePath}`);
            }
        } catch (error) {
            Logger.error(`Fehler beim Laden der Theme-Klasse für '${this.activeTheme}':`, error);
        }
    }

    /**
     * Layout für einen bestimmten Bereich abrufen
     * @param {string} section - Bereich (guild, frontend, auth)
     * @returns {string} Layout-Pfad
     * @throws {Error} wenn der Bereich unbekannt ist oder kein Layout definiert ist
     */
    getLayout(section) {
        const PathConfig = require('./utils/PathConfig').getInstance();
        const layouts = PathConfig.getPath('dashboard').layouts(this.activeTheme);
        
        if (!layouts[section]) {
            throw new Error(`Kein Layout für Bereich '${section}' definiert`);
        }
        return layouts[section];
    }

}

module.exports = ThemeManager;