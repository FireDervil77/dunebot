'use strict';

const fs = require('fs');
const path = require('path');
const { ServiceManager } = require('dunebot-core');

/**
 * ThemeRegistry — Installierte Themes laden, Validierung, Cloning
 */
class ThemeRegistry {
    /**
     * @param {import('../ThemeManager')} manager - ThemeManager-Instanz
     */
    constructor(manager) {
        this.manager = manager;
    }

    /**
     * Theme-Konfiguration laden (für aktives Theme)
     */
    async loadThemeConfig() {
        const Logger = ServiceManager.get('Logger');
        const manager = this.manager;
        
        try {
            const configPath = manager.PathConfig.getPath('theme', manager.activeTheme).config;
            const jsModulePath = manager.PathConfig.getPath('theme', manager.activeTheme).module;
            
            if (fs.existsSync(configPath)) {
                manager.themeConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            } else if (fs.existsSync(jsModulePath)) {
                const ThemeModule = require(jsModulePath);
                const themeInstance = new ThemeModule(manager.app);
                manager.themeConfig = {
                    name: themeInstance.name || manager.activeTheme,
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
                manager.themeInstance = themeInstance;
                Logger.info(`Theme-Modul '${manager.themeConfig.name}' geladen`);
            }
            
            return manager.themeConfig;
        } catch (error) {
            Logger.error('Fehler beim Laden der Theme-Konfiguration:', error);
            throw error;
        }
    }

    /**
     * Metadaten eines beliebigen installierten Themes laden.
     *
     * @param {string} name - Theme-Verzeichnisname
     * @returns {object|null} Theme-Metadaten oder null
     */
    async loadTheme(name) {
        const Logger = ServiceManager.get('Logger');
        const manager = this.manager;

        try {
            const configPath = manager.PathConfig.getPath('theme', name).config;
            const jsModulePath = manager.PathConfig.getPath('theme', name).module;

            if (fs.existsSync(configPath)) {
                const meta = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                Logger.debug(`[ThemeRegistry] theme.json für '${name}' geladen`);
                return meta;
            }

            if (fs.existsSync(jsModulePath)) {
                const ThemeModule = require(jsModulePath);
                const instance = new ThemeModule(manager.app);
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

            Logger.warn(`[ThemeRegistry] Kein theme.json / theme.js für '${name}' gefunden`);
            return null;
        } catch (error) {
            Logger.error(`[ThemeRegistry] Fehler beim Laden von Theme '${name}':`, error);
            return null;
        }
    }

    /**
     * Alle installierten Themes ermitteln.
     *
     * @returns {object[]} Array von Theme-Metadaten-Objekten (+ Feld `active`)
     */
    async getInstalledThemes() {
        const Logger = ServiceManager.get('Logger');
        const themes = [];

        try {
            const entries = fs.readdirSync(this.manager.themesDir, { withFileTypes: true });

            for (const entry of entries) {
                if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) continue;

                const meta = await this.loadTheme(entry.name);
                if (meta) {
                    themes.push({ ...meta, active: entry.name === this.manager.activeTheme });
                }
            }
        } catch (error) {
            Logger.error('[ThemeRegistry] Fehler bei getInstalledThemes:', error);
        }

        return themes;
    }

    /**
     * Ein bestehendes Theme als Child-Theme klonen.
     * 
     * @param {string} sourceTheme - Name des zu klonenden Themes
     * @param {string} newName - Interner Name des neuen Themes
     * @param {object} [options] - Optionen
     * @returns {Promise<object>} Ergebnis mit Theme-Pfad und Metadaten
     */
    async cloneTheme(sourceTheme, newName, options = {}) {
        const Logger = ServiceManager.get('Logger');

        if (!sourceTheme || !newName) {
            throw new Error('sourceTheme und newName sind erforderlich');
        }

        if (!/^[a-z0-9][a-z0-9-]*$/.test(newName) || newName.length > 50) {
            throw new Error('Name: nur Kleinbuchstaben, Zahlen und Bindestriche (max. 50 Zeichen)');
        }

        const sourceMeta = await this.loadTheme(sourceTheme);
        if (!sourceMeta) {
            throw new Error(`Quell-Theme '${sourceTheme}' nicht gefunden`);
        }

        if (sourceMeta.parent) {
            throw new Error(`'${sourceMeta.displayName || sourceTheme}' ist bereits ein Child-Theme und kann nicht erneut geklont werden`);
        }

        const targetDir = path.join(this.manager.themesDir, newName);
        if (fs.existsSync(targetDir)) {
            throw new Error(`Theme '${newName}' existiert bereits`);
        }

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

        const themeJs = `/**
 * ${themeJson.displayName} — Child-Theme von ${sourceTheme}
 */
module.exports = {
    // registerHooks(hookManager) { },
    // registerAssets(assetManager, themeName) { },
};
`;

        fs.writeFileSync(path.join(targetDir, 'theme.js'), themeJs, 'utf8');

        fs.writeFileSync(
            path.join(targetDir, 'assets', 'css', 'custom.css'),
            `/* ${themeJson.displayName} — Custom Styles */\n`,
            'utf8'
        );

        Logger.info(`[ThemeRegistry] Child-Theme '${newName}' von '${sourceTheme}' erstellt: ${targetDir}`);

        return {
            name: newName,
            path: targetDir,
            parent: sourceTheme,
            displayName: themeJson.displayName
        };
    }
}

module.exports = ThemeRegistry;
