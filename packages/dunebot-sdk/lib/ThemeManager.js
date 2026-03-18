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
        /** @type {string[]} Geordnete Theme-Kette: [activeTheme, ...parents] */
        this._themeChain = ['default'];
        /** @type {Map<string, string>} Guild → Theme In-Memory-Cache */
        this._themeGuildCache = new Map();
        
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
                          view.startsWith('admin/') ? 'guild' :
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

            // 6. Template-Hierarchie auflösen und View rendern
            const hierarchy = this.resolveTemplateHierarchy(view, viewData);
            Logger.debug('[ThemeManager] Template-Hierarchie:', hierarchy);

            const resolvedPath = hierarchy
                .map(candidate => this.resolveViewPath(candidate))
                .find(p => p !== null);

            if (resolvedPath) {
                Logger.debug(`[ThemeManager] Rendere: ${resolvedPath}`);
                res.render(resolvedPath);
            } else {
                // Fallback: Express selbst suchen lassen (normales Verhalten)
                res.render(view);
            }

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
     * Gibt die Navigation für einen Bereich zurück (mit Permission-Filterung)
     * Holt die Navigation immer vom NavigationManager.
     * @param {string} area - Bereich (Guild ID)
     * @param {string} [userId=null] - User ID für Permission-Filterung (optional)
     * @returns {Promise<Array>} Navigationseinträge für den Bereich
     * @author firedervil
     */
    async getNavigation(area, userId = null) {
        const navigationManager = ServiceManager.get('navigationManager');
        return await navigationManager.getNavigation(area, userId);
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

            // Parent-Chain aufbauen (für Fallback-Logik)
            this._themeChain = await this._buildThemeChain(this.activeTheme);
            Logger.debug(`[ThemeManager] Theme-Chain: ${this._themeChain.join(' → ')}`);
            
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
     * Metadaten eines beliebigen installierten Themes laden.
     * Liest theme.json (bevorzugt) oder extrahiert Infos aus theme.js.
     *
     * @param {string} name - Theme-Verzeichnisname
     * @returns {object|null} Theme-Metadaten oder null wenn nicht gefunden
     */
    async loadTheme(name) {
        const Logger = ServiceManager.get('Logger');
        try {
            const configPath = this.PathConfig.getPath('theme', name).config;
            const jsModulePath = this.PathConfig.getPath('theme', name).module;

            if (fs.existsSync(configPath)) {
                const meta = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                Logger.debug(`[ThemeManager] theme.json für '${name}' geladen`);
                return meta;
            }

            if (fs.existsSync(jsModulePath)) {
                const ThemeModule = require(jsModulePath);
                const instance = new ThemeModule(this.app);
                return {
                    name: instance.name || name,
                    displayName: instance.name || name,
                    version: instance.version || '1.0.0',
                    description: instance.description || '',
                    author: instance.author || 'System',
                    parent: null,
                    tags: [],
                    supports: instance.info || { darkMode: false, rtl: false, responsive: true },
                    config: instance.config || {},
                    layouts: Object.fromEntries(
                        Object.entries(instance.layouts || {}).map(([k, v]) => [k, v.path || v])
                    )
                };
            }

            Logger.warn(`[ThemeManager] Kein theme.json / theme.js für '${name}' gefunden`);
            return null;
        } catch (error) {
            Logger.error(`[ThemeManager] Fehler beim Laden von Theme '${name}':`, error);
            return null;
        }
    }

    /**
     * Alle installierten Themes ermitteln.
     * Ein Theme gilt als installiert wenn es ein theme.json oder theme.js besitzt.
     *
     * @returns {object[]} Array von Theme-Metadaten-Objekten (+ Feld `active`)
     */
    async getInstalledThemes() {
        const Logger = ServiceManager.get('Logger');
        const themes = [];

        try {
            const entries = fs.readdirSync(this.themesDir, { withFileTypes: true });

            for (const entry of entries) {
                if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) continue;

                const meta = await this.loadTheme(entry.name);
                if (meta) {
                    themes.push({ ...meta, active: entry.name === this.activeTheme });
                }
            }
        } catch (error) {
            Logger.error('[ThemeManager] Fehler bei getInstalledThemes:', error);
        }

        return themes;
    }

    // ============================================================================
    // PER-GUILD THEME SWITCHING
    // ============================================================================

    /**
     * Aktives Theme für eine Guild aus DB laden (mit In-Memory-Cache).
     * Fehlt ein Eintrag → globaler Fallback (ENV ACTIVE_THEME oder 'default').
     *
     * @param {string} guildId
     * @returns {Promise<string>} Theme-Name
     */
    async getThemeForGuild(guildId) {
        if (this._themeGuildCache.has(guildId)) {
            return this._themeGuildCache.get(guildId);
        }

        try {
            const dbService = ServiceManager.get('dbService');
            const rows = await dbService.query(
                'SELECT theme_name FROM guild_themes WHERE guild_id = ? LIMIT 1',
                [guildId]
            );

            const themeName = (rows && rows.length > 0)
                ? rows[0].theme_name
                : (process.env.ACTIVE_THEME || 'default');

            this._themeGuildCache.set(guildId, themeName);
            return themeName;
        } catch {
            return process.env.ACTIVE_THEME || 'default';
        }
    }

    /**
     * Theme für eine Guild dauerhaft in DB speichern + Cache invalidieren.
     *
     * @param {string} guildId
     * @param {string} themeName
     * @returns {Promise<void>}
     */
    async setThemeForGuild(guildId, themeName) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        await dbService.query(
            `INSERT INTO guild_themes (guild_id, theme_name)
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE theme_name = VALUES(theme_name)`,
            [guildId, themeName]
        );

        this._themeGuildCache.delete(guildId);
        Logger.info(`[ThemeManager] Theme für Guild ${guildId} auf '${themeName}' gesetzt`);
    }

    /**
     * Theme-Name für den aktuellen Request ermitteln.
     * Liest guildId aus res.locals oder req.params.
     *
     * @param {import('express').Request} req
     * @param {import('express').Response} res
     * @returns {Promise<string>} Theme-Name
     */
    async getThemeForRequest(req, res) {
        const guildId = res?.locals?.guildId || req?.params?.guildId || null;

        if (guildId) {
            return this.getThemeForGuild(guildId);
        }

        return process.env.ACTIVE_THEME || this.activeTheme || 'default';
    }

    /**
     * Shortcut: Theme-Asset registrieren UND sofort einreihen (register + enqueue in einem).
     * Entspricht WordPress `wp_enqueue_script` mit impliziter Registrierung.
     *
     * @param {string} handle
     * @param {string} src   - Relativer oder absoluter Pfad
     * @param {object} [opts] - Optionen wie bei AssetManager.registerScript
     * @returns {boolean}
     */
    enqueueScript(handle, src, opts = {}) {
        const assetManager = ServiceManager.get('assetManager');
        if (!assetManager) return false;
        if (!assetManager.scripts.has(handle)) {
            assetManager.registerScript(handle, src, opts);
        }
        return assetManager.enqueueScript(handle);
    }

    /**
     * Shortcut: Theme-Style registrieren UND sofort einreihen.
     *
     * @param {string} handle
     * @param {string} src   - Relativer oder absoluter Pfad
     * @param {object} [opts] - Optionen wie bei AssetManager.registerStyle
     * @returns {boolean}
     */
    enqueueStyle(handle, src, opts = {}) {
        const assetManager = ServiceManager.get('assetManager');
        if (!assetManager) return false;
        if (!assetManager.styles.has(handle)) {
            assetManager.registerStyle(handle, src, opts);
        }
        return assetManager.enqueueStyle(handle);
    }

    /**
     * Geordnete Eltern-Kette für ein Theme aufbauen.
     * Beispiel: 'firebot' (parent: 'default') → ['firebot', 'default']
     *
     * @param {string} themeName
     * @returns {Promise<string[]>} Kette vom Kind zum ältesten Elternteil
     */
    async _buildThemeChain(themeName) {
        const chain = [];
        let current = themeName;
        const visited = new Set();

        while (current && !visited.has(current)) {
            chain.push(current);
            visited.add(current);

            const meta = await this.loadTheme(current);
            current = meta?.parent || null;
        }

        // Sicherstellen, dass 'default' immer am Ende steht
        if (!chain.includes('default')) {
            chain.push('default');
        }

        return chain;
    }

    /**
     * Absoluten Dateipfad eines Partials auflösen — Child → Parent Fallback.
     *
     * @param {string} partial - Relativer Partial-Name ohne .ejs
     * @param {string[]} [chain] - Theme-Chain (Standard: this._themeChain)
     * @returns {string|null} Absoluter Pfad oder null
     */
    resolvePartialPath(partial, chain = this._themeChain) {
        for (const themeName of chain) {
            const themeRoot = this.PathConfig.getPath('theme', themeName);
            const candidates = [
                path.join(themeRoot.partials, partial + '.ejs'),
                path.join(themeRoot.views, 'partials', partial + '.ejs'),
                path.join(themeRoot.root, partial + '.ejs')
            ];
            const found = candidates.find(p => fs.existsSync(p));
            if (found) return found;
        }
        return null;
    }

    /**
     * Absoluten Dateipfad einer View auflösen — Plugin → Child → Parent Fallback.
     *
     * @param {string} view - Relativer View-Name ohne .ejs
     * @param {string} [pluginName] - Optional: zuerst im Plugin suchen
     * @param {string[]} [chain] - Theme-Chain (Standard: this._themeChain)
     * @returns {string|null} Absoluter Pfad oder null
     */
    resolveViewPath(view, pluginName = null, chain = this._themeChain) {
        // 1. Plugin-Views zuerst
        if (pluginName) {
            const pluginView = path.join(this.PathConfig.getPath('plugin', pluginName).views, view + '.ejs');
            if (fs.existsSync(pluginView)) return pluginView;
        }

        // 2. Theme-Chain
        for (const themeName of chain) {
            const viewPath = path.join(this.PathConfig.getPath('theme', themeName).views, view + '.ejs');
            if (fs.existsSync(viewPath)) return viewPath;
        }

        return null;
    }

    /**
     * Browser-URL für ein Theme-Asset auflösen — Child → Parent Fallback.
     * Prüft das Dateisystem; wenn im Child nicht vorhanden, zeigt URL auf Parent.
     *
     * @param {string} assetPath - Relativer Asset-Pfad (z.B. 'css/style.css')
     * @param {string[]} [chain] - Theme-Chain (Standard: this._themeChain)
     * @returns {string} Browser-URL
     */
    resolveAssetUrl(assetPath, chain = this._themeChain) {
        for (const themeName of chain) {
            const fsPath = path.join(this.PathConfig.getPath('theme', themeName).assets, assetPath);
            if (fs.existsSync(fsPath)) {
                return `/themes/${themeName}/assets/${assetPath}`;
            }
        }
        // Fallback: URL des ersten Themes in der Kette (Default)
        return `/themes/${chain[chain.length - 1] || 'default'}/assets/${assetPath}`;
    }

    /**
     * Template-Hierarchie für eine View aufbauen (WordPress-Stil).
     * Gibt geordnetes Array von View-Namen zurück (ohne .ejs) — vom Spezifischsten
     * zum Generischsten.
     *
     * Beispiele:
     *   ('guild/settings', { guildId: '123' }) → ['guild/settings-123', 'guild/settings', 'guild/index', 'index']
     *   ('admin/news', {})                     → ['admin/news', 'admin/index', 'index']
     *
     * @param {string} view    - Basis-View-Name (z.B. 'guild/settings')
     * @param {object} context - Kontext-Objekt (kann { guildId } enthalten)
     * @returns {string[]} Kandidaten in Prioritätsreihenfolge
     */
    resolveTemplateHierarchy(view, context = {}) {
        const candidates = [];
        const parts = view.split('/');
        const section = parts.length > 1 ? parts[0] : null;
        const viewName = parts[parts.length - 1];

        // 1. Guild-spezifisch (nur wenn guildId vorhanden)
        if (context.guildId) {
            const slug = section ? `${section}/${viewName}-${context.guildId}` : `${viewName}-${context.guildId}`;
            candidates.push(slug);
        }

        // 2. Standard-View
        candidates.push(view);

        // 3. Section-Catch-All (z.B. guild/index)
        if (section && viewName !== 'index') {
            candidates.push(`${section}/index`);
        }

        // 4. Globaler Fallback
        if (view !== 'index') {
            candidates.push('index');
        }

        return candidates;
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
            // Theme-Chain: Child → Parent(s) → Default
            ...this._themeChain.map(t => this.PathConfig.getPath('theme', t).views),
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
        // ThemeManager-Instanz für Closures sichern
        const themeManager = this;
        
        // ============================================================================
        // GLOBAL FUNCTION: includePartial (WordPress-Style!)
        // ============================================================================
        // WICHTIG: Als GLOBALE FUNKTION registrieren, damit 'this' = EJS-Context!
        // Aufruf im Template: <%- includePartial('partial/name') %>
        this.app.locals.includePartial = function(filename, data = {}) {
            try {                    
                const ejs = require('ejs');

                // DEBUG
                Logger.debug(`[includePartial] ${filename} - Has guildId:`, typeof this.guildId !== 'undefined', this.guildId);

                // Child → Parent Fallback via resolvePartialPath
                const filePath = themeManager.resolvePartialPath(filename);
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
            // Unterstützt sowohl full { info: {...} } als auch flaches { id, avatar, ... } Objekt
            const info = (user && user.info) ? user.info : user;
            if (!info || !info.id) {
                return '/themes/default/assets/images/default-avatar.png';
            }
            
            // User hat eigenen Avatar
            if (info.avatar) {
                const extension = info.avatar.startsWith('a_') ? 'gif' : 'png';
                return `https://cdn.discordapp.com/avatars/${info.id}/${info.avatar}.${extension}?size=${size}`;
            }
            
            // Fallback: Discord Default Avatar
            const defaultAvatarIndex = info.discriminator 
                ? parseInt(info.discriminator) % 5 
                : Number((BigInt(info.id) >> BigInt(22)) % BigInt(5));
            
            return `https://cdn.discordapp.com/embed/avatars/${defaultAvatarIndex}.png`;
        };

        // ============================================================================
        // PERMISSION HELPERS - Zugriff auf User-Berechtigungen in Views
        // ============================================================================
        
        /**
         * Prüft ob der aktuelle User eine bestimmte Permission hat
         * Nutzt: this.userPermissions (aus loadUserPermissions Middleware)
         * 
         * Aufruf in EJS: <% if (hasPermission('gameserver.start')) { %>
         * 
         * @param {string} permissionKey - Permission-Key (z.B. 'gameserver.start')
         * @returns {boolean} - Hat User die Permission?
         */
        this.app.locals.hasPermission = function(permissionKey) {
            // this.userPermissions kommt von res.locals (siehe loadUserPermissions middleware)
            if (!this.userPermissions || !this.userPermissions.permissions) {
                return false;
            }
            
            // Wildcard-Check (Admin hat alles)
            if (this.userPermissions.permissions['*'] === true || 
                this.userPermissions.permissions['wildcard'] === true) {
                return true;
            }
            
            // Direkte Permission
            if (this.userPermissions.permissions[permissionKey] === true) {
                return true;
            }
            
            // Wildcard für Kategorie (z.B. 'gameserver.*' erlaubt 'gameserver.start')
            const parts = permissionKey.split('.');
            for (let i = parts.length - 1; i >= 0; i--) {
                const wildcardKey = parts.slice(0, i).join('.') + '.*';
                if (this.userPermissions.permissions[wildcardKey] === true) {
                    return true;
                }
            }
            
            return false;
        };
        
        /**
         * Prüft ob User MINDESTENS EINE der angegebenen Permissions hat
         * 
         * Aufruf in EJS: <% if (hasAnyPermission(['gameserver.start', 'gameserver.stop'])) { %>
         * 
         * @param {Array<string>} permissionKeys - Array von Permission-Keys
         * @returns {boolean} - Hat User mindestens eine Permission?
         */
        this.app.locals.hasAnyPermission = function(permissionKeys) {
            if (!Array.isArray(permissionKeys)) return false;
            return permissionKeys.some(perm => this.hasPermission(perm));
        };
        
        /**
         * Prüft ob User ALLE angegebenen Permissions hat
         * 
         * Aufruf in EJS: <% if (hasAllPermissions(['gameserver.view', 'gameserver.start'])) { %>
         * 
         * @param {Array<string>} permissionKeys - Array von Permission-Keys
         * @returns {boolean} - Hat User alle Permissions?
         */
        this.app.locals.hasAllPermissions = function(permissionKeys) {
            if (!Array.isArray(permissionKeys)) return false;
            return permissionKeys.every(perm => this.hasPermission(perm));
        };
        
        /**
         * Prüft ob der aktuelle User Guild-Owner ist
         * 
         * Aufruf in EJS: <% if (isGuildOwner()) { %>
         * 
         * @returns {boolean} - Ist User Guild-Owner?
         */
        this.app.locals.isGuildOwner = function() {
            return this.userPermissions?.isOwner === true;
        };
        
        /**
         * Gibt alle Permissions des aktuellen Users zurück (für Debugging)
         * 
         * Aufruf in EJS: <%- JSON.stringify(getUserPermissions(), null, 2) %>
         * 
         * @returns {Object} - User-Permissions-Objekt
         */
        this.app.locals.getUserPermissions = function() {
            return this.userPermissions?.permissions || {};
        };

        Logger.debug('View-Engine konfiguriert mit Pfaden:', this.app.get('views'));
    }
    
    /**
     * Rendert ein Widget-Partial und merged den kompletten Kontext
     * @param {string} widgetName - Name des Widgets (z.B. 'server-info')
     * @param {Object} data - Kontextdaten für das Widget
     * @returns {Promise<string>} - Gerenderter HTML-String
     * @author FireBot Team
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

            // 3. Theme-Chain: Child → Parent → default (wie resolvePartialPath)
            for (const themeName of this._themeChain) {
                searchPaths.push(
                    path.join(this.themesDir, themeName, 'views', 'widgets', widgetName + '.ejs')
                );
            }

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
     * @author FireBot Team
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
     * Theme-Modul laden und initialisieren (theme.js Klasse).
     * Hinweis: Umbenannt von loadTheme() → _loadThemeModule() um
     * Shadowing der loadTheme(name)-Methode (getInstalledThemes) zu verhindern.
     */
    async _loadThemeModule() {
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

    // ============================================================================
    // THEME CLONING (CHILD-THEME ERSTELLEN)
    // ============================================================================

    /**
     * Ein bestehendes Theme als Child-Theme klonen.
     * 
     * Erstellt ein neues Theme-Verzeichnis mit:
     * - theme.json (parent: sourceTheme)
     * - theme.js (leer)
     * - assets/css/ (leer, für Custom-Styles)
     * - assets/js/ (leer, für Custom-Scripts)
     * - views/ (leer, für überschriebene Templates)
     * - partials/ (leer, für überschriebene Partials)
     * 
     * @param {string} sourceTheme - Name des zu klonenden Themes
     * @param {string} newName - Interner Name des neuen Themes
     * @param {object} [options] - Optionen
     * @param {string} [options.displayName] - Anzeigename
     * @returns {Promise<object>} Ergebnis mit Theme-Pfad und Metadaten
     */
    async cloneTheme(sourceTheme, newName, options = {}) {
        const Logger = ServiceManager.get('Logger');

        // Validierungen
        if (!sourceTheme || !newName) {
            throw new Error('sourceTheme und newName sind erforderlich');
        }

        if (!/^[a-z0-9][a-z0-9-]*$/.test(newName) || newName.length > 50) {
            throw new Error('Name: nur Kleinbuchstaben, Zahlen und Bindestriche (max. 50 Zeichen)');
        }

        // Prüfe ob Source existiert
        const sourceMeta = await this.loadTheme(sourceTheme);
        if (!sourceMeta) {
            throw new Error(`Quell-Theme '${sourceTheme}' nicht gefunden`);
        }

        // Child-Themes können nicht erneut geklont werden
        if (sourceMeta.parent) {
            throw new Error(`'${sourceMeta.displayName || sourceTheme}' ist bereits ein Child-Theme und kann nicht erneut geklont werden`);
        }

        // Prüfe ob Ziel schon existiert
        const targetDir = path.join(this.themesDir, newName);
        if (fs.existsSync(targetDir)) {
            throw new Error(`Theme '${newName}' existiert bereits`);
        }

        // Verzeichnisstruktur anlegen
        const dirs = [
            targetDir,
            path.join(targetDir, 'assets'),
            path.join(targetDir, 'assets', 'css'),
            path.join(targetDir, 'assets', 'js'),
            path.join(targetDir, 'assets', 'img'),
            path.join(targetDir, 'views'),
            path.join(targetDir, 'partials')
        ];

        for (const dir of dirs) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // theme.json erstellen
        const themeJson = {
            name: newName,
            displayName: options.displayName || newName,
            description: `Child-Theme basierend auf ${sourceMeta.displayName || sourceTheme}`,
            version: '1.0.0',
            author: sourceMeta.author || 'Unbekannt',
            parent: sourceTheme,
            tags: ['child-theme'],
            config: {}
        };

        fs.writeFileSync(
            path.join(targetDir, 'theme.json'),
            JSON.stringify(themeJson, null, 2),
            'utf8'
        );

        // theme.js erstellen (leerer Skeleton)
        const themeJs = `/**
 * ${themeJson.displayName} — Child-Theme von ${sourceTheme}
 * 
 * Überschreibe hier Hooks, registriere Assets oder
 * passe das Verhalten des Parent-Themes an.
 */
module.exports = {
    // Hooks registrieren (optional)
    // registerHooks(hookManager) { },

    // Assets registrieren (optional)
    // registerAssets(assetManager, themeName) { },
};
`;

        fs.writeFileSync(path.join(targetDir, 'theme.js'), themeJs, 'utf8');

        // Leere CSS-Datei für Custom-Styles
        fs.writeFileSync(
            path.join(targetDir, 'assets', 'css', 'custom.css'),
            `/* ${themeJson.displayName} — Custom Styles */\n`,
            'utf8'
        );

        Logger.info(`[ThemeManager] Child-Theme '${newName}' von '${sourceTheme}' erstellt: ${targetDir}`);

        return {
            name: newName,
            path: targetDir,
            parent: sourceTheme,
            displayName: themeJson.displayName
        };
    }

}

module.exports = ThemeManager;