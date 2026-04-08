/**
 * FireBot Standard-Theme
 * 
 * Dieses Modul stellt das Standard-Theme für das FireBot-Dashboard bereit
 * mit zwei Hauptbereichen: Frontend und Guild
 */
class DefaultTheme {
    constructor(app) {
        this.app = app;
        this.name = 'default';
        this.version = '1.0.0';
        this.description = 'Standard-Theme für FireBot';
        this.author = 'FireBot Team';
        this.info = { darkMode: false, supportRTL: false, responsive: true };

        // Entfernt: this.navigation = { frontend: [], guild: [] };
        this.layouts = {
            frontend: { default: true, name: 'Frontend-Layout', path: 'layouts/frontend.ejs' },
            guild: { name: 'Guild-Layout', path: 'layouts/guild.ejs' },
            auth: { name: 'Auth-Layout', path: 'layouts/auth.ejs' }
        };
        this.config = {
            darkMode: true,
            primaryColor: '#3498db',
            accentColor: '#f39c12',
            logo: 'images/dunebot-logo.png',
            favicon: 'images/favicon.ico'
        };
    }

    /**
     * Theme initialisieren
     */
    async initialize() {
        const { ServiceManager } = require('dunebot-core');
        const assetManager = ServiceManager.get('assetManager');

        if (assetManager) {
            // ── Vendor Styles ──────────────────────────────────────────────
            assetManager.registerVendorStyle('adminlte-css',
                '/themes/default/assets/css/adminlte.min.css', { version: '3.2.0' });
            assetManager.registerVendorStyle('fontawesome',
                '/themes/default/assets/vendor/fontawesome-free/css/all.min.css', { version: '5.15.4' });

            // ── App Styles ─────────────────────────────────────────────────
            assetManager.registerStyle('theme-main-css',
                '/themes/default/assets/css/main.css',
                { deps: ['adminlte-css'], version: this.version });

            // ── Vendor Scripts ─────────────────────────────────────────────
            assetManager.registerVendorScript('jquery',
                '/themes/default/assets/vendor/jquery/jquery.min.js',
                { inFooter: false, version: '3.6.0' });
            assetManager.registerVendorScript('bootstrap',
                '/themes/default/assets/vendor/bootstrap/js/bootstrap.bundle.min.js',
                { deps: ['jquery'], version: '4.6.2' });
            assetManager.registerVendorScript('adminlte-js',
                '/themes/default/assets/js/adminlte.min.js',
                { deps: ['jquery', 'bootstrap'], version: '3.2.0' });

            // ── App Scripts ────────────────────────────────────────────────
            assetManager.registerScript('theme-main-js',
                '/themes/default/assets/js/main.js',
                { deps: ['adminlte-js'], version: this.version });
        }

        // Entfernt: setupCoreNavigation(); (Core-Navigation jetzt rein DB)
        if (this.app.pluginManager?.hooks) {
            this.registerHooks();
        }
        return true;
    }
    
    
    /**
     * Theme-spezifische Hooks registrieren
     */
    registerHooks() {
        const hooks = this.app.pluginManager.hooks;

        // Entfernt: theme_navigation Merging eigener Arrays
        hooks.addFilter('body_classes', (classes, layout) => {
            if (this.config.darkMode) classes.push('dark-theme');
            if (layout === 'frontend') classes.push('frontend-layout'); 
            else if (layout === 'guild') classes.push('guild-layout');
            return classes;
        });

        hooks.addFilter('page_assets', (assets, layout) => {
            if (layout === 'frontend') {
                assets.css.push('css/adminlte.min.css','css/main.css');
                assets.js.push('js/main.js','js/adminlte.min.js');
            } else if (layout === 'guild') {
                assets.css.push('css/adminlte.min.css');
                assets.js.push('js/adminlte.min.js');
            }
            return assets;
        });
    }

    
    /**
     * Layout für einen bestimmten Bereich abrufen
     * @param {string} section - 'frontend', 'guild' oder 'auth'
     * @returns {string}
     * @throws {Error} wenn nicht definiert
     */
    getLayout(section) {
        const entry = this.layouts[section];
        if (entry && entry.path) {
            return entry.path;
        }
        // Statt Frontend-Fallback: explizit Fehler melden
        throw new Error(`Theme '${this.name}': Layout-Bereich '${section}' ist nicht definiert`);
    }
}

module.exports = DefaultTheme;