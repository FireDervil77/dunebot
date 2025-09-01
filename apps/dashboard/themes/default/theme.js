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
        this.info = {
            darkMode: false,
            supportRTL: false,
            responsive: true
        };
        
        // Reduzierte Layout-Struktur
        this.layouts = {
            frontend: {
                default: true,
                name: 'Frontend-Layout',
                path: 'layouts/frontend.ejs'
            },
            guild: {
                name: 'Guild-Layout',
                path: 'layouts/guild.ejs'
            },
            auth: {
                name: 'Auth-Layout',
                path: 'layouts/auth.ejs'
            }
        };
        
        // Navigation für beide Bereiche
        this.navigation = {
            frontend: [], // Wird dynamisch durch Plugins befüllt
            guild: []     // Wird dynamisch durch Plugins befüllt
        };
        
        // Theme-Konfiguration
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
        // Basis-Navigation für Guild-Bereich einrichten
        this.setupCoreNavigation();
        
        // Hooks registrieren
        if (this.app.pluginManager?.hooks) {
            this.registerHooks();
        }
        
        return true;
    }
    
    /**
     * Basis-Navigation für den Guild-Bereich einrichten
     */
    setupCoreNavigation() {
        // Standardmäßig im Admin-Bereich: Dashboard, Plugins, Einstellungen
        this.registerNavigation('guild', {
            title: 'Dashboard',
            url: '/guild',
            icon: 'fa-solid fa-gauge-high',
            priority: 0
        });
        
        this.registerNavigation('guild', {
            title: 'Plugins',
            url: '/guild/plugins',
            icon: 'fa-solid fa-puzzle-piece',
            priority: 10
        });
        
        this.registerNavigation('guild', {
            title: 'Server',
            url: '/guild/servers',
            icon: 'fa-solid fa-server',
            priority: 20,
            children: [] // Wird dynamisch mit Servern befüllt
        });
        
        this.registerNavigation('guild', {
            title: 'Einstellungen',
            url: '/guild/settings',
            icon: 'fa-solid fa-cog',
            priority: 100
        });
    }
    
    /**
     * Theme-spezifische Hooks registrieren
     */
    registerHooks() {
        const hooks = this.app.pluginManager.hooks;
        
        // Hook zum Anpassen der Navigation
        hooks.addFilter('theme_navigation', (items, section) => {
            // Hier könnte das Theme die Standard-Navigation anpassen
            return section === 'guild' || section === 'frontend' ? 
                [...this.navigation[section], ...items] : 
                items;
        });
        
        // Hook zum Hinzufügen von CSS-Klassen zum Body
        hooks.addFilter('body_classes', (classes, layout) => {
            if (this.config.darkMode) {
                classes.push('dark-theme');
            }
            
            if (layout === 'frontend') {
                classes.push('frontend-layout');
            } else if (layout === 'guild') {
                classes.push('guild-layout');
            }
            
            return classes;
        });
        
        // Hook für Layout-spezifische Assets
        hooks.addFilter('page_assets', (assets, layout) => {
            if (layout === 'frontend') {
                assets.css.push('css/adminlte.min.css');
                assets.css.push('css/main.css');
                assets.js.push('js/main.js');
                assets.js.push('js/adminlte.min.js');
            } else if (layout === 'guild') {
                assets.css.push('css/adminlte.min.css');
                assets.js.push('js/adminlte.min.js');
            }
            
            return assets;
        });
        
        // Hook für Plugin-Integration im Guild-Bereich
        hooks.addAction('after_plugin_enable', (plugin) => {
            // Automatisch Navigation für Plugin im Guild-Bereich registrieren
            if (plugin.adminRouter) {
                this.registerNavigation('guild', {
                    title: plugin.displayName || plugin.name,
                    url: `/guild/${plugin.name}`,
                    icon: plugin.icon || 'fa-solid fa-puzzle-piece',
                    priority: plugin.adminPriority || 50,
                    plugin: plugin.name
                });
            }
        });
    }
    
    /**
     * Navigation für einen bestimmten Bereich registrieren
     * @param {string} section - 'frontend' oder 'guild'
     * @param {Object} item - Navigationselement
     */
    registerNavigation(section, item) {
        if (section !== 'frontend' && section !== 'guild') {
             console.warn(`Ungültiger Navigationsbereich: ${section}`);
             return;
         }
        
        
        if (!this.navigation[section]) {
             this.navigation[section] = [];
         }
        
        // Nach Priorität sortieren
        this.navigation[section].push(item);
        this.navigation[section].sort((a, b) => a.priority - b.priority);
    }
    
    /**
     * Navigation für einen bestimmten Bereich abrufen
     * @param {string} section - 'frontend' oder 'guild'
     * @param {object} context - Kontext-Objekt mit zusätzlichen Informationen
     * @returns {Array} - Navigationselemente
     */
    getNavigation(section, context = {}) {
        if (!this.navigation[section]) {
            return [];
        }
        
        // Navigation durch Plugin-Filter laufen lassen
        let navItems = [...this.navigation[section]];
        
        if (this.app.pluginManager?.hooks) {
            navItems = this.app.pluginManager.hooks.applyFilter(
                'theme_navigation', 
                navItems, 
                section, 
                context
            );
        }
        
        // Guild-ID einsetzen, falls vorhanden
        if (context.guildId) {
            navItems = navItems.map(item => {
                return {
                    ...item,
                    url: item.url.replace(':guildId', context.guildId)
                };
            });
        }
        
        return navItems;
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