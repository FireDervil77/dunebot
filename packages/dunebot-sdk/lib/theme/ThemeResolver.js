'use strict';

const fs = require('fs');
const path = require('path');
const { ServiceManager } = require('dunebot-core');

/**
 * ThemeResolver — View/Partial/Asset Auflösung + Theme-Chain
 * 
 * Zuständig für die Auflösung von Dateipfaden innerhalb der
 * Theme-Hierarchie (Child → Parent → Default).
 */
class ThemeResolver {
    /**
     * @param {import('../ThemeManager')} manager - ThemeManager-Instanz
     */
    constructor(manager) {
        this.manager = manager;
    }

    /**
     * Geordnete Eltern-Kette für ein Theme aufbauen.
     * Beispiel: 'firebot' (parent: 'default') → ['firebot', 'default']
     *
     * @param {string} themeName
     * @returns {Promise<string[]>} Kette vom Kind zum ältesten Elternteil
     */
    async buildThemeChain(themeName) {
        const chain = await this.buildDeclaredChain(themeName);

        // Sicherstellen, dass 'default' immer am Ende steht
        if (!chain.includes('default')) {
            chain.push('default');
        }

        return chain;
    }

    /**
     * Nur die **erklärte** Eltern-Kette — ohne das automatisch angehängte
     * 'default'.
     *
     * Der Unterschied ist wichtig: Für Views und Assets soll 'default' immer
     * als Auffangnetz dienen (ein Theme muss nicht alle 106 Views mitbringen).
     * Für `theme.js` gilt das **nicht** — sonst würde ein eigenständiges Theme
     * die Assets des Standard-Themes mit einreihen und AdminLTE ungewollt
     * mitladen. Ein Theme baut nur dann auf einem anderen auf, wenn es das in
     * seiner theme.json über `parent` ausdrücklich sagt.
     *
     * @param {string} themeName
     * @returns {Promise<string[]>} Kette vom Kind zum ältesten erklärten Elternteil
     */
    async buildDeclaredChain(themeName) {
        const chain = [];
        let current = themeName;
        const visited = new Set();

        while (current && !visited.has(current)) {
            chain.push(current);
            visited.add(current);

            const meta = await this.manager.registry.loadTheme(current);
            current = meta?.parent || null;
        }

        return chain;
    }

    /**
     * Absoluten Dateipfad eines Partials auflösen — Child → Parent Fallback.
     *
     * @param {string} partial - Relativer Partial-Name ohne .ejs
     * @param {string[]} [chain] - Theme-Chain (Standard: this.manager._themeChain)
     * @returns {string|null} Absoluter Pfad oder null
     */
    resolvePartialPath(partial, chain = this.manager._themeChain) {
        for (const themeName of chain) {
            const themeRoot = this.manager.PathConfig.getPath('theme', themeName);
            const candidates = [
                path.join(themeRoot.partials, partial + '.ejs'),
                path.join(themeRoot.views, 'partials', partial + '.ejs'),
                // Auch unterhalb von views/ suchen — dort liegen z. B. die
                // Widget-Partials (`widgets/admin-stat`). Ohne diesen Eintrag
                // waren sie fuer includePartial und hookArea unerreichbar.
                path.join(themeRoot.views, partial + '.ejs'),
                path.join(themeRoot.root, partial + '.ejs')
            ];
            const found = candidates.find(p => fs.existsSync(p));
            if (found) return found;
        }
        return null;
    }

    /**
     * Absoluten Dateipfad einer View auflösen — Theme-Chain → Plugin Fallback.
     *
     * Reihenfolge:
     *  1. Theme-Chain (Child → Parent → Default) — damit Themes Plugin-Views überschreiben können
     *  2. Plugin-eigene Views (Fallback)
     *
     * @param {string} view - Relativer View-Name ohne .ejs
     * @param {string} [pluginName] - Optional: als Fallback im Plugin suchen
     * @param {string[]} [chain] - Theme-Chain (Standard: this.manager._themeChain)
     * @returns {string|null} Absoluter Pfad oder null
     */
    resolveViewPath(view, pluginName = null, chain = this.manager._themeChain) {
        // 1. Theme-Chain (ermöglicht Theme-Overrides für Plugin-Views)
        for (const themeName of chain) {
            const viewPath = path.join(this.manager.PathConfig.getPath('theme', themeName).views, view + '.ejs');
            if (fs.existsSync(viewPath)) return viewPath;
        }

        // 2. Plugin-Views als Fallback
        if (pluginName) {
            try {
                const pluginPaths = this.manager.PathConfig.getPath('plugin', pluginName);
                if (pluginPaths?.views) {
                    const pluginView = path.join(pluginPaths.views, view + '.ejs');
                    if (fs.existsSync(pluginView)) return pluginView;
                }
            } catch { /* Plugin existiert nicht */ }
        }

        return null;
    }

    /**
     * Browser-URL für ein Theme-Asset auflösen — Child → Parent Fallback.
     *
     * @param {string} assetPath - Relativer Asset-Pfad (z.B. 'css/style.css')
     * @param {string[]} [chain] - Theme-Chain (Standard: this.manager._themeChain)
     * @returns {string} Browser-URL
     */
    resolveAssetUrl(assetPath, chain = this.manager._themeChain) {
        for (const themeName of chain) {
            const fsPath = path.join(this.manager.PathConfig.getPath('theme', themeName).assets, assetPath);
            if (fs.existsSync(fsPath)) {
                return `/themes/${themeName}/assets/${assetPath}`;
            }
        }
        // Fallback: URL des letzten Themes in der Kette (Default)
        return `/themes/${chain[chain.length - 1] || 'default'}/assets/${assetPath}`;
    }

    /**
     * Dateipfad eines Theme-Assets entlang der Kette — Gegenstück zu
     * `resolveAssetUrl`, nur eben auf der Festplatte.
     *
     * @param {string} assetPath - z. B. 'js/guild.js'
     * @param {string[]} [chain]
     * @returns {string|null}
     */
    resolveAssetPath(assetPath, chain = this.manager._themeChain) {
        for (const themeName of chain) {
            const pfad = path.join(this.manager.PathConfig.getPath('theme', themeName).assets, assetPath);
            if (fs.existsSync(pfad)) return pfad;
        }
        return null;
    }

    /**
     * Template-Hierarchie für eine View aufbauen (WordPress-Stil).
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
}

module.exports = ThemeResolver;
