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
        /** @type {Map<string, object>} Theme-Name → Kontext (Kette, Layouts, Tokens, Module) */
        this._contexts = new Map();
        /** @type {string[]|null} Kette, gegen die gerade Assets angemeldet werden */
        this._registeringChain = null;
        
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
    getLayout(section, ctx) { return this.renderer.getLayout(section, ctx); }
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

            // View-Engine konfigurieren
            this.setupViewEngine();

            // Statische Asset-Routen registrieren
            this.registerThemeAssets();

            // Kontexte für ALLE installierten Themes bauen und deren theme.js
            // ausführen. Erst dadurch kann eine Guild ihr Theme im Betrieb
            // wählen — sonst wäre nur das beim Start gesetzte benutzbar.
            await this.buildAllContexts();

            // Tokens des aktiven Themes als Vorgabe für Views ohne Guild-Bezug
            this.setGlobalVar('themeTokensCSS', this.getThemeContext()?.tokensCSS || '');

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
    async buildTokenMap(chain = this._themeChain) {
        const merged = {};

        for (const themeName of [...chain].reverse()) {
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
    renderThemeTokens(tokens = this._tokens) {
        return this.customizer.buildTokenBlock(tokens);
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
    async buildLayoutMap(chain = this._themeChain) {
        const merged = {};

        // Vom ältesten Elternteil zum Kind, damit das Kind zuletzt überschreibt
        for (const themeName of [...chain].reverse()) {
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
    _themeModuleContext(ctx = null) {
        const { getInstance: getWidgetManager } = require('./WidgetManager');

        return {
            app: this.app,
            themeManager: this,
            assetManager: ServiceManager.get('assetManager'),
            hooks: this.app?.pluginManager?.hooks || null,
            widgetManager: getWidgetManager(),
            themeName: ctx ? ctx.name : this.activeTheme,
            themeChain: [...(ctx ? ctx.chain : this._themeChain)]
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
    /**
     * Namen aller installierten Themes (Verzeichnisnamen).
     * @returns {string[]}
     */
    installierteThemes() {
        try {
            return fs.readdirSync(this.themesDir, { withFileTypes: true })
                .filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'))
                .map(e => e.name);
        } catch {
            return ['default'];
        }
    }

    /**
     * Alles zusammentragen, was ein Theme zum Rendern braucht.
     *
     * @param {string} name
     * @returns {Promise<object>} Theme-Kontext
     */
    async buildContext(name) {
        const chain = await this.resolver.buildThemeChain(name);
        const moduleChain = await this.resolver.buildDeclaredChain(name);
        const layouts = await this.buildLayoutMap(chain);
        const tokens = await this.buildTokenMap(chain);

        return {
            name,
            chain,
            moduleChain,
            layouts,
            tokens,
            tokensCSS: this.renderThemeTokens(tokens),
            modules: []
        };
    }

    /**
     * Für jedes installierte Theme einen Kontext bauen und sein theme.js
     * ausführen. Läuft einmal beim Start.
     *
     * @returns {Promise<void>}
     */
    async buildAllContexts() {
        const Logger = ServiceManager.get('Logger');
        this._contexts = new Map();

        for (const name of this.installierteThemes()) {
            try {
                const ctx = await this.buildContext(name);
                await this.bootThemeModules(ctx);
                this._contexts.set(name, ctx);
            } catch (error) {
                Logger.error(`[ThemeManager] Kontext für Theme '${name}' fehlgeschlagen:`, error);
            }
        }

        // Rückwärtsverträglichkeit: die Felder des aktiven Themes bleiben gesetzt
        const aktiv = this._contexts.get(this.activeTheme);
        if (aktiv) {
            this._themeChain = aktiv.chain;
            this._moduleChain = aktiv.moduleChain;
            this._layouts = aktiv.layouts;
            this._tokens = aktiv.tokens;
            this.themeModules = aktiv.modules;
        }

        Logger.info(`Theme-Kontexte bereit: ${[...this._contexts.keys()].join(', ')}`);
    }

    /**
     * Kontext eines Themes holen — mit Rückfall auf das aktive und auf 'default'.
     *
     * @param {string} [name]
     * @returns {object|null}
     */
    getThemeContext(name = this.activeTheme) {
        if (!this._contexts) return null;
        return this._contexts.get(name)
            || this._contexts.get(this.activeTheme)
            || this._contexts.get('default')
            || null;
    }

    /**
     * Kontext für die laufende Anfrage ermitteln — die Guild entscheidet.
     *
     * @param {import('express').Response} res
     * @returns {Promise<object|null>}
     */
    async getContextForRequest(res) {
        const guildId = res?.locals?.guildId || null;

        if (guildId) {
            try {
                const name = await this.getThemeForGuild(guildId);
                return this.getThemeContext(name);
            } catch {
                // DB nicht erreichbar → aktives Theme
            }
        }

        return this.getThemeContext();
    }

    /**
     * Fassade, die alle Handles eines Themes mit seinem Namen versieht.
     *
     * `registerStyle('tokens', …)` wird zu `default::tokens`. Damit können
     * mehrere Themes gleichzeitig angemeldet sein, ohne sich die Namen
     * wegzunehmen. Im Theme selbst bleibt der Code unverändert.
     *
     * @param {object} assetManager
     * @param {string} themeName
     * @returns {object} Fassade mit derselben Oberfläche
     */
    _assetFassade(assetManager, themeName) {
        const mitPrefix = handle => `${themeName}::${handle}`;
        const deps = (opts = {}) => ({
            ...opts,
            deps: (opts.deps || []).map(mitPrefix)
        });

        return {
            registerScript:       (h, src, o = {}) => assetManager.registerScript(mitPrefix(h), src, deps(o)),
            registerStyle:        (h, src, o = {}) => assetManager.registerStyle(mitPrefix(h), src, deps(o)),
            registerVendorScript: (h, src, o = {}) => assetManager.registerVendorScript(mitPrefix(h), src, deps(o)),
            registerVendorStyle:  (h, src, o = {}) => assetManager.registerVendorStyle(mitPrefix(h), src, deps(o)),
            enqueueScript:        h => assetManager.enqueueScript(mitPrefix(h)),
            enqueueStyle:         h => assetManager.enqueueStyle(mitPrefix(h)),
            addInlineScript:      (h, code) => assetManager.addInlineScript(mitPrefix(h), code)
        };
    }

    /**
     * `theme.js` der erklärten Kette eines Kontexts ausführen.
     *
     * Reihenfolge: Eltern zuerst, Kind zuletzt — damit ein Child-Theme
     * überschreiben kann, was sein Parent angemeldet hat.
     * Lebenszyklus pro Modul: initialize() → registerAssets() → registerHooks()
     *
     * @param {object} ctx - Theme-Kontext
     * @returns {Promise<void>}
     */
    async bootThemeModules(ctx) {
        const Logger = ServiceManager.get('Logger');
        const context = this._themeModuleContext(ctx);
        const assetManager = ServiceManager.get('assetManager');
        const fassade = assetManager ? this._assetFassade(assetManager, ctx.name) : null;

        ctx.modules = [];

        // Relative Asset-Pfade gegen die Kette DIESES Themes auflösen,
        // nicht gegen die des gerade aktiven.
        this._registeringChain = ctx.chain;

        try {
            for (const themeName of [...ctx.moduleChain].reverse()) {
                const instance = this.registry.loadThemeModule(themeName);
                if (!instance) continue;

                try {
                    if (typeof instance.initialize === 'function') {
                        await instance.initialize(context);
                    }
                    if (typeof instance.registerAssets === 'function') {
                        await instance.registerAssets(fassade, context);
                    }
                    if (typeof instance.registerHooks === 'function' && ctx.name === this.activeTheme) {
                        // Hooks nur einmal anmelden — sie sind nicht pro Theme getrennt
                        await instance.registerHooks(context.hooks, context);
                    }

                    ctx.modules.push({ name: themeName, instance });
                } catch (error) {
                    // Ein Theme-Modul darf den Start nicht verhindern
                    Logger.error(`[ThemeManager] theme.js '${themeName}' warf einen Fehler:`, error);
                }
            }
        } finally {
            this._registeringChain = null;
        }

        if (ctx.modules.length > 0) {
            Logger.debug(`[ThemeManager] '${ctx.name}': ${ctx.modules.map(m => m.name).join(' → ')}`);
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
    enqueueForSection(section, ctx = this.getThemeContext()) {
        const Logger = ServiceManager.get('Logger');
        const assetManager = ServiceManager.get('assetManager');
        if (!assetManager || !ctx) return;

        const fassade = this._assetFassade(assetManager, ctx.name);

        for (const { name, instance } of ctx.modules || []) {
            if (typeof instance.enqueueAssets !== 'function') continue;
            try {
                instance.enqueueAssets(fassade, section, this._themeModuleContext(ctx));
            } catch (error) {
                Logger.error(`[ThemeManager] enqueueAssets von '${name}' warf einen Fehler:`, error);
            }
        }
    }
}

module.exports = ThemeManager;
