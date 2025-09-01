const fs = require('fs');
const path = require('path');
const express = require('express'); // Express für statische Dateien importieren

const { ServiceManager } = require("dunebot-core");


class ThemeManager {
    constructor(app) {
        const Logger = ServiceManager.get('Logger');

        this.app = app;
        this.themesDir = path.join(__dirname, '../themes');
        this.activeTheme = 'default';
        this.themeConfig = {};
        this.navigationPoints = [];
        
        // TEST: Globaler Theme-Kontext für alle Partials und Views
        this.themeContext = {};
        this.currentLocals = {};

        this.viewPaths = {
            theme: path.join(this.themesDir, this.activeTheme, 'views'),  // Theme-spezifische Views
            default: path.join(this.themesDir, 'default', 'views'),       // Default Theme Views
            global: path.join(__dirname, '../views')                       // Globale Views
        };

        // Express-spezifische Einstellungen
        app.set('views', [
            this.viewPaths.theme,     // Aktives Theme
            this.viewPaths.default,   // Default Theme als Fallback
            this.viewPaths.global     // Globale Views
        ]);

        Logger.debug('View-Pfade:', this.viewPaths);
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

            // 3. View-spezifische Daten mit Basis-Context und Layout mergen
            const viewData = {
                ...baseContext,           // Basis-Context (User, Guild, etc.)
                ...res.locals,            // Express locals
                ...data,                  // View-spezifische Daten
                layout: this.getLayout(section)  // Korrektes Layout
            };

            Logger.debug('Render Context:', {
                view,
                section,
                hasUser: !!viewData.user,
                layout: viewData.layout
            });

            // 4. View rendern
            res.render(view, viewData);

        } catch (error) {
            Logger.error('Fehler beim Rendern der View:', error);
            throw error;
        }
    }
    
    /**
     * Lädt alle Navigation-Items aus der DB und cached sie
     * @returns {Promise<void>}
     * @author firedervil
     */
    async loadNavigation() {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        
        try {
            this.navigationCache = {};
            
            // Native MySQL-Query für Navigation-Items
            const items = await dbService.query(`
                SELECT * FROM nav_items 
                WHERE visible = 1
                ORDER BY type ASC
            `);

            // Items in Cache einsortieren
            for (const item of items) {
                if (!this.navigationCache[item.area]) {
                    this.navigationCache[item.area] = [];
                }
                this.navigationCache[item.area].push(item);
            }
            
            Logger.debug(`Navigation geladen: ${items.length} Items`);
        } catch (error) {
            Logger.error('Fehler beim Laden der Navigation:', error);
            this.navigationCache = {}; // Cache zurücksetzen bei Fehler
        }
    }

    /**
     * Fügt ein neues Navigation-Item hinzu
     * @param {Object} item Navigation-Item
     * @returns {Promise<Object>} Das erstellte Navigation-Item
     */
    async addNavigationItem(item) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        try {
            const result = await dbService.query(`
                INSERT INTO nav_items 
                    (area, title, url, icon, order_num, enabled, plugin)
                VALUES 
                    (?, ?, ?, ?, ?, true, ?)
            `, [
                item.area || 'main',
                item.title,
                item.url,
                item.icon || null,
                item.order_num || 0,
                item.plugin || null
            ]);

            if (result.insertId) {
                const [newItem] = await dbService.query(
                    "SELECT * FROM nav_items WHERE id = ?",
                    [result.insertId]
                );
                
                // Navigation-Cache aktualisieren
                await this.loadNavigation();
                
                return newItem;
            }
            return null;
        } catch (error) {
            Logger.error('Fehler beim Erstellen eines Navigation-Items:', error);
            throw error;
        }
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
            
            // Arrays und Objekte mit Standardwerten initialisieren
            notifications: [],
            unreadMessages: 0,
            messages: [],
            serverNav: [],
            adminNav: [],
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
            // Übergebenes Theme aktivieren
            this.activeTheme = themeName;
            
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
            
            // Core-Navigation einrichten (falls vorhanden)
            if (this.themeInstance && typeof this.themeInstance.setupCoreNavigation === 'function') {
                this.themeInstance.setupCoreNavigation();
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
            // Aktives Theme aus Datenbank oder Config laden
            // Hier könnten wir später die Auswahl von Themes implementieren
            const configPath = path.join(this.themesDir, this.activeTheme, 'theme.json');
            const jsModulePath = path.join(this.themesDir, this.activeTheme, 'theme.js');
            
            if (fs.existsSync(configPath)) {
                // JSON-Datei laden
                this.themeConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            } else if (fs.existsSync(jsModulePath)) {
                // JS-Modul laden
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
                
                // Theme-Instance für spätere Verwendung speichern
                this.themeInstance = themeInstance;
                
                Logger.info(`Theme-Modul '${this.themeConfig.name}' geladen`);
            } else {
                Logger.warn(`Keine Konfigurationsdatei für Theme '${this.activeTheme}' gefunden`);
                this.themeConfig = {
                    name: this.activeTheme,
                    version: '1.0.0',
                    description: 'Standard-Theme',
                    author: 'System'
                };
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

        // Plugin-Views-Verzeichnis hinzufügen
        const pluginsDir = path.join(__dirname, '../../../plugins');
        const pluginViewPaths = [];

        // Plugin-Verzeichnisse durchsuchen
        if (fs.existsSync(pluginsDir)) {
            const plugins = fs.readdirSync(pluginsDir);
            plugins.forEach(plugin => {
                const pluginViewsPath = path.join(pluginsDir, plugin, 'dashboard/views');
                if (fs.existsSync(pluginViewsPath)) {
                    pluginViewPaths.push(pluginViewsPath);
                    Logger.debug(`Plugin-Views gefunden für ${plugin}: ${pluginViewsPath}`);
                }
            });
        }

        const themeViewsPath = path.join(this.themesDir, this.activeTheme, 'views');
        
        // Views-Verzeichnisse aktualisieren (Plugin-Views haben höchste Priorität)
        this.app.set('views', [
            ...pluginViewPaths,                                      // Plugin-Views (höchste Priorität)
            themeViewsPath,                                         // Aktives Theme
            path.join(this.themesDir, 'default', 'views'),         // Default Theme
            path.join(__dirname, '../views')                        // Globale Views
        ]);

        Logger.debug('View-Pfade:', {
            pluginViews: pluginViewPaths,
            themeViews: themeViewsPath,
            defaultViews: path.join(this.themesDir, 'default', 'views'),
            globalViews: path.join(__dirname, '../views')
        });
        
       
        // EJS Layout-Verzeichnis anpassen
        this.app.set('layout', 'layouts/frontend');
        this.app.set('layout extractScripts', true);
        this.app.set('layout extractStyles', true);

        this.app.locals.tr = this.app.locals.tr || ((key, options) => {
            const locale = this.app?.session?.locale || 'de-DE';
            return i18n?.tr?.(key, options, locale) || key;
        });
        
        // Globale Theme-Helfer registrieren
        this.app.locals.theme = {
           asset: (assetPath) => {
                // Prüfen, ob die Datei im aktiven Theme existiert
                const activeThemePath = path.join(this.themesDir, this.activeTheme, 'assets', assetPath);
                if (fs.existsSync(activeThemePath)) {
                    return `/themes/${this.activeTheme}/assets/${assetPath}`;
                }
                
                // Fallback: Datei aus dem Default-Theme verwenden
                return `/themes/default/assets/${assetPath}`;
            },
            info: this.themeConfig,
            
            /**
             * Rendert ein Partial und merged den kompletten Kontext
             * @param {string} filename
             * @param {Object} data - Zusätzliche Daten
             * @returns {string} gerenderter HTML-String
             */
            includePartial: (filename, data = {}) => {
                try {
                    const ejs = require('ejs');
                    
                     // Erweiterte Suchreihenfolge:
                    // 1) Theme-Root partials (themes/<theme>/partials/<section>/<file>.ejs)
                    // 2) Theme-Root files (themes/<theme>/<section>/<file>.ejs) & (themes/<theme>/<file>.ejs)
                    // 3) Theme views partials (themes/<theme>/views/partials/...)
                    // 4) Default theme partials
                    // 5) Global app views partials
                    const searchPaths = [
                        path.join(this.themesDir, this.activeTheme, 'partials', filename + '.ejs'),
                        path.join(this.themesDir, this.activeTheme, filename + '.ejs'),
                        path.join(this.themesDir, this.activeTheme, filename, 'index.ejs'),
                        path.join(themeViewsPath, 'partials', filename + '.ejs'),
                        path.join(this.themesDir, 'default', 'partials', filename + '.ejs'),
                        path.join(this.themesDir, 'default', 'views', 'partials', filename + '.ejs'),
                        path.join(__dirname, '../views', 'partials', filename + '.ejs')
                    ];
                    
                    // Erste existierende Datei verwenden
                    const filePath = searchPaths.find(p => fs.existsSync(p));
                    
                    if (!filePath) {
                        Logger.warn(`Partial ${filename} nicht gefunden. Gesucht in:`, searchPaths);
                        return `<!-- Partial ${filename}.ejs nicht gefunden -->`;
                    }
                    
                    const template = fs.readFileSync(filePath, 'utf8');
                    
                    // Alle Render-Daten zusammenführen:
                    // 1. app.locals (enthält tr, theme, etc.)
                    // 2. this.themeContext (globale Variablen wie coreConfig)
                    // 3. Lokale data (explizit übergebene Variablen)
                    // NEU: Kontext zusammenführen (Request-Kontext hat Vorrang vor themeContext)
                    return ejs.render(template, {
                        ...this.app.locals,
                        ...(this.currentLocals || {}),
                        ...this.themeContext,
                        ...data
                    });
                } catch (error) {
                    Logger.error(`Fehler beim Einbinden des Partials ${filename}:`, error);
                    return `<!-- Fehler beim Laden von ${filename} -->`;
                }
            }
        };

        Logger.debug('View-Engine konfiguriert mit Pfaden:', this.app.get('views'));
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
        const Logger = ServiceManager.get('Logger');
        const i18n = ServiceManager.get('i18n');

        try {
            // Debug-Ausgabe zur Überprüfung der Pfade
            Logger.debug(`Theme-Assets werden registriert...`);
            Logger.debug(`Theme-Verzeichnis: ${this.themesDir}`);
            Logger.debug(`Aktives Theme: ${this.activeTheme}`);

            // Wichtig: Absoluten Pfad zum Themes-Verzeichnis verwenden
            const absoluteThemesDir = path.resolve(this.themesDir);
            Logger.debug(`Absoluter Pfad zum Theme-Verzeichnis: ${absoluteThemesDir}`);

            // Umfassende MIME-Typen-Map für alle Asset-Typen
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

            // Haupt-Theme-Verzeichnis registrieren mit verbesserten MIME-Typen
            this.app.use('/themes', express.static(absoluteThemesDir, {
                setHeaders: (res, filePath) => {
                    // Dateiendung extrahieren
                    const ext = path.extname(filePath).toLowerCase();
                    // MIME-Typ setzen, wenn bekannt
                    if (mimeTypes[ext]) {
                        res.setHeader('Content-Type', mimeTypes[ext]);
                    }
                    // Cache-Kontrolle für bessere Performance
                    res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 Stunden
                }
            }));

            // Assets des aktiven Themes explizit registrieren (Priorität)
            const activeThemeAssetsPath = path.join(absoluteThemesDir, this.activeTheme, 'assets');
            if (fs.existsSync(activeThemeAssetsPath)) {
                Logger.debug(`Registriere Assets für Theme '${this.activeTheme}': ${activeThemeAssetsPath}`);
                this.app.use(`/themes/${this.activeTheme}/assets`, express.static(activeThemeAssetsPath, {
                    setHeaders: (res, filePath) => {
                        const ext = path.extname(filePath).toLowerCase();
                        if (mimeTypes[ext]) {
                            res.setHeader('Content-Type', mimeTypes[ext]);
                        }
                        res.setHeader('Cache-Control', 'public, max-age=86400');
                    }
                }));
            }
            
            // Fallback zum Default-Theme
            if (this.activeTheme !== 'default') {
                const defaultAssetsPath = path.join(absoluteThemesDir, 'default', 'assets');
                if (fs.existsSync(defaultAssetsPath)) {
                    Logger.debug(`Registriere Default-Theme-Assets als Fallback: ${defaultAssetsPath}`);
                    this.app.use('/themes/default/assets', express.static(defaultAssetsPath, {
                        setHeaders: (res, filePath) => {
                            const ext = path.extname(filePath).toLowerCase();
                            if (mimeTypes[ext]) {
                                res.setHeader('Content-Type', mimeTypes[ext]);
                            }
                            res.setHeader('Cache-Control', 'public, max-age=86400');
                        }
                    }));
                }
            }

            // Debug-Informationen für Testzwecke
            const mainCssPath = path.join(activeThemeAssetsPath, 'css', 'main.css');
            const mainJsPath = path.join(activeThemeAssetsPath, 'js', 'main.js');

            Logger.debug(`Beispiel URL für main.css: themes/${this.activeTheme}/assets/css/main.css`);
            Logger.debug(`Prüfe ob CSS-Datei existiert: ${mainCssPath} - ${fs.existsSync(mainCssPath) ? 'JA' : 'NEIN'}`);
            Logger.debug(`Prüfe ob JS-Datei existiert: ${mainJsPath} - ${fs.existsSync(mainJsPath) ? 'JA' : 'NEIN'}`);

            Logger.success(`Theme-Assets erfolgreich registriert`);
        } catch (error) {
            Logger.error('Fehler beim Registrieren der Theme-Assets:', error);
        }
    }
    
    /**
     * Lädt globale Benachrichtigungen für das Dashboard
     * @param {Object} req - Express Request
     * @param {Object} res - Express Response
     */
    async loadGlobalNotifications(req, res) {
        const Logger = ServiceManager.get('Logger');
        const notificationManager = ServiceManager.get('notificationManager');

        if (!notificationManager) return [];
        
        try {
            // Benachrichtigungen für den aktuellen Benutzer laden
            const notifications = await notificationManager.getNotificationsForUser(req.user);
            
            // In den View-Kontext einfügen
            res.locals.globalNotifications = notifications;
            return notifications;
        } catch (error) {
            Logger.error('Fehler beim Laden globaler Benachrichtigungen:', error);
            return [];
        }
    }

    /**
     * Gibt Navigation für einen Bereich zurück
     * @param {string} area
     * @returns {Array}
     */
    getNavigation(area) {
        return this.navigationCache?.[area] || [];
    }

   /**
     * Fügt ein Navigation-Item hinzu (Plugin/Theme)
     * @param {Object} item
     * @returns {Promise<void>}
     * @author firedervil
     */
    async registerNavigation(item) {
        const dbService = ServiceManager.get('dbService');
        const Logger = ServiceManager.get('Logger');

        try {
            // Navigation-Item in die Datenbank einfügen
            await dbService.query(`
                INSERT INTO nav_items 
                    (plugin, guildId, title, url, icon, \`order\`, type, visible)
                VALUES 
                    (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                item.plugin || null,
                item.guildId || null,
                item.title,
                item.url,
                item.icon || 'fa-puzzle-piece',
                item.order_num || 50,
                item.type || 'main',
                item.visible !== false
            ]);

            // Navigation-Cache aktualisieren
            await this.loadNavigation();
            
            Logger.debug('Navigation-Item hinzugefügt:', {
                title: item.title,
                plugin: item.plugin
            });
        } catch (error) {
            Logger.error('Fehler beim Hinzufügen eines Navigation-Items:', error);
            throw error;
        }
    }

    /**
     * Theme laden und initialisieren
     */
    async loadTheme() {
        const Logger = ServiceManager.get('Logger');
        try {
            const themePath = path.join(this.themesDir, this.activeTheme, 'theme.js');
            
            if (fs.existsSync(themePath)) {
                const ThemeClass = require(themePath);
                this.theme = new ThemeClass(this.app);
                
                // Theme initialisieren
                await this.theme.initialize();
                
                // Theme-Konfiguration in themeConfig übernehmen
                this.themeConfig = {
                    ...this.themeConfig,
                    ...this.theme.config
                };
                
                Logger.debug(`Theme '${this.activeTheme}' geladen`);
            } else {
                Logger.warn(`Keine Theme-Klasse für '${this.activeTheme}' gefunden`);
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
        // Falls eine Theme-Klasse existiert und eine getLayout-Methode hat
        if (this.theme && typeof this.theme.getLayout === 'function') {
            const layoutPath = this.theme.getLayout(section);
            if (!layoutPath) {
                Logger.error(`ThemeManager.getLayout: Layout-Bereich '${section}' ist im aktiven Theme nicht definiert`);
                throw new Error(`Layout '${section}' ist im Theme nicht definiert`);
            }
            return layoutPath;
        }
        
        // Unterstützte Standard-Layout-Pfade (kein Admin/Server-Alias mehr)
        const layoutPaths = {
            guild: 'layouts/guild',
            frontend: 'layouts/frontend',
            auth: 'layouts/auth'
        };

        if (!layoutPaths[section]) {
            Logger.error(`ThemeManager.getLayout: Unbekannter Layout-Bereich '${section}'. Kein Fallback erlaubt.`);
            throw new Error(`Kein Layout für Bereich '${section}' definiert`);
        }
        
        return layoutPaths[section];
    }

}

module.exports = ThemeManager;