/**
 * DuneBot Standard-Theme
 * 
 * Dieses Modul stellt das Standard-Theme für das DuneBot-Dashboard bereit
 * mit zwei Hauptbereichen: Frontend und Guild
 */
class DefaultTheme {
    constructor(app) {
        this.app = app;
        this.name = 'default';
        this.version = '1.0.0';
        this.description = 'Standard-Theme für DuneBot';
        this.author = 'DuneBot Team';
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