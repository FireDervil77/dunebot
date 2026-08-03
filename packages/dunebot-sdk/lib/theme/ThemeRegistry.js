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
     * Theme-Konfiguration laden (für aktives Theme).
     *
     * `theme.json` beschreibt das Theme (Metadaten, Layouts, Tokens),
     * `theme.js` bringt sein Verhalten mit (Assets, Hooks, Widget-Bereiche).
     * Beide werden geladen — die JSON ist keine Bedingung mehr dafür, dass
     * das Modul übersprungen wird.
     */
    async loadThemeConfig() {
        const Logger = ServiceManager.get('Logger');
        const manager = this.manager;

        try {
            const configPath = manager.PathConfig.getPath('theme', manager.activeTheme).config;

            if (fs.existsSync(configPath)) {
                manager.themeConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            }

            // theme.js ist unsere functions.php — immer laden, auch neben theme.json
            const themeInstance = this.loadThemeModule(manager.activeTheme);

            if (themeInstance) {
                manager.themeInstance = themeInstance;

                // Ohne theme.json die Metadaten aus dem Modul ableiten (Altbestand)
                if (!fs.existsSync(configPath)) {
                    manager.themeConfig = {
                        name: themeInstance.name || manager.activeTheme,
                        version: themeInstance.version || '1.0.0',
                        description: themeInstance.description || 'Standard-Theme',
                        author: themeInstance.author || 'System',
                        layouts: this._normalizeLayouts(themeInstance.layouts),
                        info: themeInstance.info || {
                            darkMode: false,
                            supportRTL: false,
                            responsive: true
                        }
                    };
                }
            }

            return manager.themeConfig;
        } catch (error) {
            Logger.error('Fehler beim Laden der Theme-Konfiguration:', error);
            throw error;
        }
    }

    /**
     * `theme.js` eines Themes laden und zu einer Instanz normalisieren.
     *
     * Erlaubt sind zwei Schreibweisen:
     *  - `module.exports = class { … }`  → wird mit der App instanziiert
     *  - `module.exports = { … }`        → wird unverändert verwendet
     *
     * @param {string} name - Theme-Verzeichnisname
     * @returns {object|null} Theme-Instanz oder null, wenn es keine theme.js gibt
     */
    loadThemeModule(name) {
        const Logger = ServiceManager.get('Logger');
        const modulePath = this.manager.PathConfig.getPath('theme', name).module;

        if (!fs.existsSync(modulePath)) return null;

        try {
            const exported = require(modulePath);
            if (!exported) return null;

            const instance = typeof exported === 'function'
                ? new exported(this.manager.app)
                : exported;

            instance.themeName = instance.themeName || name;
            Logger.debug(`[ThemeRegistry] theme.js für '${name}' geladen`);
            return instance;
        } catch (error) {
            // Ein kaputtes Theme-Modul darf den Dashboard-Start nicht verhindern
            Logger.error(`[ThemeRegistry] theme.js für '${name}' konnte nicht geladen werden:`, error);
            return null;
        }
    }

    /**
     * Layout-Angaben auf reine Pfade bringen.
     * Erlaubt sind `'layouts/guild.ejs'` und `{ path: 'layouts/guild.ejs' }`.
     *
     * @param {object} [layouts]
     * @returns {object} Bereich → relativer Pfad
     */
    _normalizeLayouts(layouts = {}) {
        return Object.fromEntries(
            Object.entries(layouts || {}).map(([section, value]) => [
                section,
                typeof value === 'string' ? value : value?.path
            ]).filter(([, value]) => Boolean(value))
        );
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
                const instance = this.loadThemeModule(name);
                if (!instance) return null;

                return {
                    name: instance.name || name,
                    displayName: instance.name || name,
                    version: instance.version || '1.0.0',
                    description: instance.description || '',
                    author: instance.author || 'System',
                    parent: instance.parent || null,
                    tags: [],
                    supports: instance.info || { darkMode: false, rtl: false, responsive: true },
                    config: instance.config || {},
                    layouts: this._normalizeLayouts(instance.layouts)
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
 *
 * Wird nach dem Parent-Theme ausgeführt, kann dessen Anmeldungen also
 * ergänzen oder ersetzen. Alle Methoden sind freiwillig.
 */
module.exports = {
    /**
     * Eigene Assets anmelden. Ein relativer Name wird über die Theme-Kette
     * aufgelöst — liegt die Datei hier, gewinnt sie gegen die des Parents.
     *
     * @param {object} am  - AssetManager
     * @param {object} ctx - { themeManager, hooks, widgetManager, themeChain }
     */
    registerAssets(am, ctx) {
        am.registerStyle('${newName}-custom', 'custom.css', { deps: ['guild-css'], version: '1.0.0' });
    },

    /**
     * Pro Request: entscheiden, was in welchem Bereich geladen wird.
     *
     * @param {object} am      - AssetManager
     * @param {string} section - 'guild', 'frontend' oder 'auth'
     */
    enqueueAssets(am, section) {
        if (section === 'guild') am.enqueueStyle('${newName}-custom');
    },

    /**
     * Filter und Aktionen anmelden.
     *
     * @param {object} hooks - Hook-System des PluginManagers
     */
    // registerHooks(hooks, ctx) { },
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
