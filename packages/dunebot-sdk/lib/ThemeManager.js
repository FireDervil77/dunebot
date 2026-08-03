'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { ServiceManager } = require('dunebot-core');

// Sub-Module
const ThemeResolver = require('./theme/ThemeResolver');
const ThemeRenderer = require('./theme/ThemeRenderer');
const ThemeRegistry = require('./theme/ThemeRegistry');
const ThemeCustomizer = require('./theme/ThemeCustomizer');

/**
 * ThemeManager — Orchestrator / Service-Facade
 * 
 * Delegiert an spezialisierte Sub-Module:
 * - ThemeResolver:   View/Partial/Asset Auflösung + Chain
 * - ThemeRenderer:   renderView(), Context-Merge, EJS-Helpers
 * - ThemeRegistry:   Installierte Themes laden, Validierung, Cloning
 * - ThemeCustomizer: Per-Guild CSS, Variables, DB-Zugriff
 */
class ThemeManager {
    constructor(app) {
        const Logger = ServiceManager.get('Logger');
        this.app = app;
        this.ownerOnly = true;
        
        // PathConfig
        this.PathConfig = require('./utils/PathConfig').getInstance();
        this.ejs = require('ejs');

        // Theme-Basis
        this.activeTheme = 'default';
        this.themeConfig = {};
        this.themeContext = {};
        this.currentLocals = {};
        /** @type {string[]} Geordnete Theme-Kette für Views/Assets: [activeTheme, ...parents, 'default'] */
        this._themeChain = ['default'];
        /** @type {string[]} Erklärte Eltern-Kette für theme.js — ohne das angehängte 'default' */
        this._moduleChain = ['default'];
        /** @type {Array<{name: string, instance: object}>} Ausgeführte theme.js-Module (Eltern zuerst) */
        this.themeModules = [];
        /** @type {object} Zusammengeführte Layouts der Kette: Bereich → relativer Pfad */
        this._layouts = {};
        /** @type {object} Zusammengeführte Design-Tokens der Kette: Name → Wert */
        this._tokens = {};
        /** @type {Map<string, string>} Guild → Theme In-Memory-Cache */
        this._themeGuildCache = new Map();
        
        this.themesDir = this.PathConfig.getPath('dashboard').themes;
        this.viewPaths = {
            theme: this.PathConfig.getPath('theme', this.activeTheme).views,
            default: this.PathConfig.getPath('theme', 'default').views,
            global: this.PathConfig.getPath('dashboard').views
        };

        // Sub-Module initialisieren
        this.resolver = new ThemeResolver(this);
        this.renderer = new ThemeRenderer(this);
        this.registry = new ThemeRegistry(this);
        this.customizer = new ThemeCustomizer(this);

        Logger.debug('ThemeManager initialisiert mit Pfaden:', this.viewPaths);
    }

    // ============================================================================
    // FACADE: Delegierte Methoden (externe API bleibt identisch)
    // ============================================================================

    // --- ThemeRenderer ---
    async renderView(res, view, data = {}) { return this.renderer.renderView(res, view, data); }
    getLayout(section) { return this.renderer.getLayout(section); }
    async renderWidgetPartial(widgetName, data = {}) { return this.renderer.renderWidgetPartial(widgetName, data); }
    setupViewEngine() { return this.renderer.setupViewEngine(); }

    // --- ThemeResolver ---
    resolvePartialPath(partial, chain) { return this.resolver.resolvePartialPath(partial, chain); }
    resolveViewPath(view, pluginName, chain) { return this.resolver.resolveViewPath(view, pluginName, chain); }
    resolveAssetUrl(assetPath, chain) { return this.resolver.resolveAssetUrl(assetPath, chain); }
    resolveTemplateHierarchy(view, context) { return this.resolver.resolveTemplateHierarchy(view, context); }

    // --- ThemeRegistry ---
    async loadThemeConfig() { return this.registry.loadThemeConfig(); }
    loadThemeModule(name) { return this.registry.loadThemeModule(name); }
    async loadTheme(name) { return this.registry.loadTheme(name); }
    async getInstalledThemes() { return this.registry.getInstalledThemes(); }
    async cloneTheme(sourceTheme, newName, options) { return this.registry.cloneTheme(sourceTheme, newName, options); }

    // --- ThemeCustomizer ---
    async getThemeForGuild(guildId) { return this.customizer.getThemeForGuild(guildId); }
    async setThemeForGuild(guildId, themeName) { return this.customizer.setThemeForGuild(guildId, themeName); }
    async getGuildCustomization(guildId) { return this.customizer.getGuildCustomization(guildId); }
    async setGuildCustomization(guildId, data) { return this.customizer.setGuildCustomization(guildId, data); }
    async renderGuildCustomCSS(guildId) { return this.customizer.renderGuildCustomCSS(guildId); }
    buildTokenBlock(variables) { return this.customizer.buildTokenBlock(variables); }
    async getThemeForRequest(req, res) { return this.customizer.getThemeForRequest(req, res); }

    // ============================================================================
    // INITIALISIERUNG
    // ============================================================================

    /**
     * Theme initialisieren
     * @param {string} [themeName='default']
     * @returns {Promise<boolean>}
     */
    async initialize(themeName = 'default') {
        const Logger = ServiceManager.get('Logger');

        try {
            this.activeTheme = themeName || 'default';
            
            Logger.debug(`Initialisiere Theme '${this.activeTheme}'...`);
            
            // Standard-Kontext initialisieren
            this.initializeDefaultContext();
            
            // Theme-Konfiguration laden
            await this.loadThemeConfig();

            // Parent-Chain aufbauen
            this._themeChain = await this.resolver.buildThemeChain(this.activeTheme);
            this._moduleChain = await this.resolver.buildDeclaredChain(this.activeTheme);
            Logger.debug(`[ThemeManager] Theme-Chain: ${this._themeChain.join(' → ')}`);
            Logger.debug(`[ThemeManager] Modul-Kette: ${this._moduleChain.join(' → ')}`);

            // Layout-Angaben und Tokens der Kette zusammenführen (Kind schlägt Elternteil)
            this._layouts = await this.buildLayoutMap();
            this._tokens = await this.buildTokenMap();
            Logger.debug('[ThemeManager] Layouts:', this._layouts);

            // Tokens aus theme.json stehen allen Views zur Verfügung. Sie ändern
            // sich nach dem Start nicht mehr, also einmal rendern statt pro Request.
            this.setGlobalVar('themeTokensCSS', this.renderThemeTokens());

            // View-Engine konfigurieren
            this.setupViewEngine();

            // Statische Asset-Routen registrieren
            this.registerThemeAssets();

            // theme.js der gesamten Kette ausführen (Eltern zuerst, Kind zuletzt)
            await this.bootThemeModules();

            Logger.success(`Theme '${this.activeTheme}' initialisiert`);
            return true;
        } catch (error) {
            Logger.error('Fehler bei der Theme-Initialisierung:', error);
            throw error;
        }
    }

    // ============================================================================
    // KONTEXT-MANAGEMENT
    // ============================================================================

    /**
     * Gibt die Navigation für einen Bereich zurück
     */
    async getNavigation(area, userId = null) {
        const navigationManager = ServiceManager.get('navigationManager');
        return await navigationManager.getNavigation(area, userId);
    }

    setCurrentLocals(locals) {
        this.currentLocals = locals || {};
        return this;
    }

    clearCurrentLocals() {
        this.currentLocals = {};
        return this;
    }

    setGlobalVar(key, value) {
        this.themeContext[key] = value;
        this.app.locals[key] = value;
        return this;
    }

    setGlobalVars(vars) {
        Object.entries(vars).forEach(([key, value]) => {
            this.setGlobalVar(key, value);
        });
        return this;
    }

    getContext() {
        return this.themeContext || {};
    }

    getActiveTheme() {
        return this.activeTheme || 'default';
    }

    /**
     * Initialisiert die Standard-Kontext-Variablen für alle Views
     */
    initializeDefaultContext() {
        const Logger = ServiceManager.get('Logger');
        Logger.debug('Initialisiere Standard-Kontext-Variablen für alle Views und Partials');
        
        this.setGlobalVars({
            user: null,
            guild: null,
            baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || 8900}`,
            siteName: process.env.SITE_NAME || 'DuneBot',
            version: process.env.npm_package_version || '1.0.0',
            environment: process.env.NODE_ENV || 'development',
            year: new Date().getFullYear(),
            
            coreConfig: {
                githubUrl: process.env.GITHUB_URL || 'https://github.com/yourusername/dunebot',
                supportUrl: process.env.SUPPORT_URL || '#',
                documentationUrl: process.env.DOCS_URL || '#documentation'
            },
            
            themeUrls: {
                assets: this.PathConfig.getUrl('theme', this.activeTheme, 'assets'),
                public: this.PathConfig.getUrl('theme', this.activeTheme, 'public')
            },
            
            notifications: [],
            unreadMessages: 0,
            messages: [],
            guildNav: [],
            frontendNav: [],
            
            cacheBuster: Date.now(),
            
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

    // ============================================================================
    // THEME-ROUTEN & ASSETS
    // ============================================================================

    registerThemeRoutes(routerManager) {
        const Logger = ServiceManager.get('Logger');
        
        try {
            const assetsPath = this.PathConfig.getPath('theme', this.activeTheme).assets;
            if (fs.existsSync(assetsPath)) {
                routerManager.register(
                    `/themes/${this.activeTheme}/assets`,
                    express.static(assetsPath),
                    { theme: this.activeTheme }
                );
            }

            if (this.themeInstance?.routes) {
                Object.entries(this.themeInstance.routes).forEach(([routePath, handler]) => {
                    routerManager.register(routePath, handler, { theme: this.activeTheme });
                });
            }
        } catch (error) {
            Logger.error('Fehler beim Registrieren der Theme-Routen:', error);
            throw error;
        }
    }

    registerThemeAssets() {
        const PathConfig = this.PathConfig;
        const Logger = ServiceManager.get('Logger');

        try {
            Logger.debug(`Theme-Assets werden registriert...`);
            
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

            const setHeaders = (res, filePath) => {
                const ext = path.extname(filePath).toLowerCase();
                if (mimeTypes[ext]) {
                    res.setHeader('Content-Type', mimeTypes[ext]);
                }
                res.setHeader('Cache-Control', 'public, max-age=86400');
            };

            // 1. Globales Theme-Verzeichnis
            const themesPath = PathConfig.getPath('dashboard').themes;
            this.app.use('/themes', express.static(themesPath, { setHeaders }));

            // 2. Aktives Theme
            const activeThemeAssets = PathConfig.getPath('dashboard').assets(this.activeTheme);
            if (fs.existsSync(activeThemeAssets.root)) {
                const activeThemeUrl = PathConfig.getUrl('theme', this.activeTheme, 'assets');
                this.app.use(activeThemeUrl, express.static(activeThemeAssets.root, { setHeaders }));
            }

            // 3. Default Theme (Fallback)
            if (this.activeTheme !== 'default') {
                const defaultThemeAssets = PathConfig.getPath('dashboard').assets('default');
                if (fs.existsSync(defaultThemeAssets.root)) {
                    const defaultThemeUrl = PathConfig.getUrl('theme', 'default', 'assets');
                    this.app.use(defaultThemeUrl, express.static(defaultThemeAssets.root, { setHeaders }));
                }
            }

            // 4. Plugin Assets
            const pluginsDir = PathConfig.getPath('plugins');
            if (fs.existsSync(pluginsDir)) {
                fs.readdirSync(pluginsDir).forEach(plugin => {
                    const pluginPath = PathConfig.getPath('plugin', plugin);
                    if (pluginPath && fs.existsSync(pluginPath.assets)) {
                        const pluginUrl = PathConfig.getUrl('plugin', plugin);
                        this.app.use(pluginUrl, express.static(pluginPath.assets, { setHeaders }));
                    }
                });
            }

            Logger.success('Theme-Assets erfolgreich registriert');

        } catch (error) {
            Logger.error('Fehler beim Registrieren der Theme-Assets:', error);
            throw error;
        }
    }

    // ============================================================================
    // ASSET ENQUEUE (WordPress-Style)
    // ============================================================================

    enqueueScript(handle, src, opts = {}) {
        const assetManager = ServiceManager.get('assetManager');
        if (!assetManager) return false;
        if (!assetManager.scripts.has(handle)) {
            assetManager.registerScript(handle, src, opts);
        }
        return assetManager.enqueueScript(handle);
    }

    enqueueStyle(handle, src, opts = {}) {
        const assetManager = ServiceManager.get('assetManager');
        if (!assetManager) return false;
        if (!assetManager.styles.has(handle)) {
            assetManager.registerStyle(handle, src, opts);
        }
        return assetManager.enqueueStyle(handle);
    }

    // ============================================================================
    // BENACHRICHTIGUNGEN & THEME-MODULE
    // ============================================================================

    async loadGlobalNotifications(req, res) {
        const Logger = ServiceManager.get('Logger');
        const notificationManager = ServiceManager.get('notificationManager');

        if (!notificationManager) return [];
        
        try {
            const userLocale = req.session?.locale || res.locals?.locale || 'de-DE';
            const user = req.session?.user?.info || req.user?.info || req.user || null;
            const notifications = await notificationManager.getNotificationsForUser(user, userLocale);
            
            res.locals.globalNotifications = notifications;
            return notifications;
        } catch (error) {
            Logger.error('Fehler beim Laden globaler Benachrichtigungen:', error);
            return [];
        }
    }

    // ============================================================================
    // THEME-MODULE (theme.js — unsere functions.php)
    // ============================================================================

    /**
     * Design-Tokens der Theme-Kette zu einer Karte zusammenführen.
     * Gleiche Regel wie bei den Layouts: das Kind schlägt seinen Elternteil.
     *
     * @returns {Promise<object>} Token-Name → Wert
     */
    async buildTokenMap() {
        const merged = {};

        for (const themeName of [...this._themeChain].reverse()) {
            const meta = await this.registry.loadTheme(themeName);
            if (meta?.tokens && typeof meta.tokens === 'object') {
                Object.assign(merged, meta.tokens);
            }
        }

        return merged;
    }

    /**
     * Die in `theme.json` deklarierten Tokens als `:root`-Block ausgeben.
     *
     * Damit kann ein Theme seine Farben festlegen, ohne CSS zu schreiben.
     * Die Werte stehen zwischen `tokens.css` (Standard des Themes) und der
     * Guild-Anpassung — ein Server kann sie also weiterhin überschreiben.
     *
     * @returns {string} CSS-Block oder leerer String
     */
    renderThemeTokens() {
        return this.customizer.buildTokenBlock(this._tokens);
    }

    /**
     * Layout-Angaben der gesamten Theme-Kette zu einer Karte zusammenführen.
     *
     * Ein Child-Theme muss damit nur die Layouts nennen, die es wirklich
     * ersetzt — alles andere erbt es von seinem Parent. Ohne das müsste jedes
     * Child-Theme die vollständige Liste wiederholen.
     *
     * @returns {Promise<object>} Bereich → relativer Layout-Pfad
     */
    async buildLayoutMap() {
        const merged = {};

        // Vom ältesten Elternteil zum Kind, damit das Kind zuletzt überschreibt
        for (const themeName of [...this._themeChain].reverse()) {
            const meta = await this.registry.loadTheme(themeName);
            const layouts = this.registry._normalizeLayouts(meta?.layouts);
            Object.assign(merged, layouts);
        }

        return merged;
    }

    /**
     * Kontext, den jedes Theme-Modul bekommt.
     * Damit muss ein Theme nicht über `this.app` in fremde Interna greifen.
     *
     * @returns {object}
     */
    _themeModuleContext() {
        const { getInstance: getWidgetManager } = require('./WidgetManager');

        return {
            app: this.app,
            themeManager: this,
            assetManager: ServiceManager.get('assetManager'),
            hooks: this.app?.pluginManager?.hooks || null,
            widgetManager: getWidgetManager(),
            themeChain: [...this._themeChain]
        };
    }

    /**
     * `theme.js` der gesamten Theme-Kette laden und ausführen.
     *
     * Reihenfolge: Eltern zuerst, Kind zuletzt — damit ein Child-Theme
     * überschreiben kann, was sein Parent angemeldet hat.
     *
     * Lebenszyklus pro Modul: initialize() → registerAssets() → registerHooks()
     *
     * @returns {Promise<void>}
     */
    async bootThemeModules() {
        const Logger = ServiceManager.get('Logger');
        const context = this._themeModuleContext();

        // Nur die erklärte Kette: ein Theme ohne `parent` bringt seine Assets
        // allein mit und erbt nicht ungefragt die des Standard-Themes.
        // Vom ältesten Elternteil zum Kind → umdrehen.
        const bootOrder = [...this._moduleChain].reverse();

        this.themeModules = [];

        for (const themeName of bootOrder) {
            const instance = themeName === this.activeTheme && this.themeInstance
                ? this.themeInstance
                : this.registry.loadThemeModule(themeName);

            if (!instance) continue;

            try {
                if (typeof instance.initialize === 'function') {
                    await instance.initialize(context);
                }
                if (typeof instance.registerAssets === 'function') {
                    await instance.registerAssets(context.assetManager, context);
                }
                if (typeof instance.registerHooks === 'function') {
                    await instance.registerHooks(context.hooks, context);
                }

                this.themeModules.push({ name: themeName, instance });
                Logger.debug(`[ThemeManager] theme.js '${themeName}' ausgeführt`);
            } catch (error) {
                // Ein Theme-Modul darf den Start nicht verhindern
                Logger.error(`[ThemeManager] theme.js '${themeName}' warf einen Fehler:`, error);
            }
        }

        if (this.themeModules.length > 0) {
            Logger.info(`Theme-Module aktiv: ${this.themeModules.map(m => m.name).join(' → ')}`);
        }
    }

    /**
     * Basis-Assets eines Bereichs einreihen (wie wp_enqueue_scripts).
     * Wird pro Request aus dem Renderer gerufen, weil die Enqueue-Listen
     * zwischen den Requests zurückgesetzt werden.
     *
     * @param {string} section - 'guild', 'frontend' oder 'auth'
     * @returns {void}
     */
    enqueueForSection(section) {
        const Logger = ServiceManager.get('Logger');
        const assetManager = ServiceManager.get('assetManager');
        if (!assetManager) return;

        for (const { name, instance } of this.themeModules || []) {
            if (typeof instance.enqueueAssets !== 'function') continue;
            try {
                instance.enqueueAssets(assetManager, section, this._themeModuleContext());
            } catch (error) {
                Logger.error(`[ThemeManager] enqueueAssets von '${name}' warf einen Fehler:`, error);
            }
        }
    }
}

module.exports = ThemeManager;
