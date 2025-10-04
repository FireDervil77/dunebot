const path = require('path');

class PathConfig {
    constructor(rootDir) {
        this.ROOT_DIR = rootDir || process.cwd();
        
        // Basis-Pfade
        this.paths = {
            root: this.ROOT_DIR,
            apps: path.join(this.ROOT_DIR, 'apps'),
            packages: path.join(this.ROOT_DIR, 'packages'),
            plugins: path.join(this.ROOT_DIR, 'plugins'),  // Hinzugefügt für ThemeManager
            plugin: (pluginName) => ({
                root: path.join(this.ROOT_DIR, 'plugins', pluginName),
                dashboard: path.join(this.ROOT_DIR, 'plugins', pluginName, 'dashboard'),
                views: path.join(this.ROOT_DIR, 'plugins', pluginName, 'dashboard/views'),
                widgets: path.join(this.ROOT_DIR, 'plugins', pluginName, 'dashboard/views/widgets'),
                assets: path.join(this.ROOT_DIR, 'plugins', pluginName, 'dashboard/public'),
                public: path.join(this.ROOT_DIR, 'plugins', pluginName, 'dashboard/public')
            }),
            
            // Dashboard-spezifische Pfade
            dashboard: {
                root: path.join(this.ROOT_DIR, 'apps/dashboard'),
                themes: path.join(this.ROOT_DIR, 'apps/dashboard/themes'),
                public: path.join(this.ROOT_DIR, 'apps/dashboard/public'),
                views: path.join(this.ROOT_DIR, 'apps/dashboard/views'),
                layouts: (theme = 'default') => ({
                    guild: path.join(this.ROOT_DIR, 'apps/dashboard/themes', theme, 'views/layouts/guild'),
                    frontend: path.join(this.ROOT_DIR, 'apps/dashboard/themes', theme, 'views/layouts/frontend'),
                    auth: path.join(this.ROOT_DIR, 'apps/dashboard/themes', theme, 'views/layouts/auth')
                }),
                partials: (theme = 'default') => ({
                    root: path.join(this.ROOT_DIR, 'apps/dashboard/themes', theme, 'partials'),
                    views: path.join(this.ROOT_DIR, 'apps/dashboard/themes', theme, 'views/partials')
                }),
                assets: (theme = 'default') => ({
                    root: path.join(this.ROOT_DIR, 'apps/dashboard/themes', theme, 'assets'),
                    css: path.join(this.ROOT_DIR, 'apps/dashboard/themes', theme, 'assets/css'),
                    js: path.join(this.ROOT_DIR, 'apps/dashboard/themes', theme, 'assets/js'),
                    images: path.join(this.ROOT_DIR, 'apps/dashboard/themes', theme, 'assets/images')
                })
            },

            // Theme-spezifische Pfade
            theme: (themeName = 'default') => ({
                root: path.join(this.ROOT_DIR, 'apps/dashboard/themes', themeName),
                config: path.join(this.ROOT_DIR, 'apps/dashboard/themes', themeName, 'theme.json'),
                module: path.join(this.ROOT_DIR, 'apps/dashboard/themes', themeName, 'theme.js'),
                views: path.join(this.ROOT_DIR, 'apps/dashboard/themes', themeName, 'views'),
                widgets: path.join(this.ROOT_DIR, 'apps/dashboard/themes', themeName, 'views/widgets')
            })
        };

       // URLs (Browser) anpassen
        this.urls = {
            base: process.env.BASE_URL || 'http://localhost:8900',
            assets: '/assets',
            themes: '/themes',
            plugins: '/plugins',
            
            // Theme URLs hinzufügen
            theme: (themeName, type = 'assets') => {
                const baseUrl = `/themes/${themeName}`;
                return {
                    assets: `${baseUrl}/assets`,
                    public: `${baseUrl}/public`,
                    root: baseUrl
                }[type] || baseUrl;
            },

            // Plugin URLs (bestehend)
            plugin: (pluginName, type = 'assets') => ({
                assets: `/plugins/${pluginName}/assets`,
                public: `/plugins/${pluginName}/public`
            })[type]
        };
    }

    /**
     * Gibt einen Filesystem-Pfad zurück
     */
    getPath(key, ...args) {
        const path = this.paths[key];
        if (typeof path === 'function') {
            return path(...args);
        }
        return path;
    }

    /**
     * Gibt eine URL zurück
     */
    getUrl(key, ...args) {
        const url = this.urls[key];
        if (typeof url === 'function') {
            return url(...args);
        }
        return url;
    }
}

// Singleton-Instanz
let instance = null;

module.exports = {
    init: (rootDir) => {
        instance = new PathConfig(rootDir);
        return instance;
    },
    getInstance: () => {
        if (!instance) {
            throw new Error('PathConfig not initialized');
        }
        return instance;
    }
};