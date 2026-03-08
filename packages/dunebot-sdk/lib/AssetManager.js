const { ServiceManager } = require('dunebot-core');
const path = require('path');

/**
 * AssetManager - WordPress-ähnliches Asset-Enqueuing-System
 * Ermöglicht Plugins das Registrieren von CSS/JS mit Abhängigkeiten und Versionen
 * 
 * @author FireBot Team
 */
class AssetManager {
    constructor() {
        /** @type {Map<string, Asset>} Registrierte Scripts */
        this.scripts = new Map();
        
        /** @type {Map<string, Asset>} Registrierte Styles */
        this.styles = new Map();
        
        /** @type {Set<string>} Bereits eingereiht für Rendering */
        this.enqueuedScripts = new Set();
        
        /** @type {Set<string>} Bereits eingereiht für Rendering */
        this.enqueuedStyles = new Set();
        
        this.logger = ServiceManager.get('Logger');
    }

    /**
     * Registriert ein Script (wie wp_register_script)
     * 
     * @param {string} handle - Eindeutiger Identifier (z.B. 'dunemap-admin')
     * @param {string} src - Pfad zum Script (relativ zu Plugin/Theme)
     * @param {Object} options - Optionen
     * @param {Array<string>} [options.deps=[]] - Abhängigkeiten (andere Handles)
     * @param {string} [options.version='1.0.0'] - Version für Cache-Busting
     * @param {boolean} [options.inFooter=true] - Im Footer laden (false = head)
     * @param {string} [options.plugin] - Plugin-Name (für Pfad-Auflösung)
     * @param {Object} [options.localize] - JavaScript-Objekt für wp_localize_script
     * @param {boolean} [options.defer=false] - defer-Attribut hinzufügen
     * @param {boolean} [options.async=false] - async-Attribut hinzufügen
     * 
     * @returns {boolean} true bei Erfolg
     * 
     * @example
     * assetManager.registerScript('dunemap-admin', 'js/dunemap-admin.js', {
     *   plugin: 'dunemap',
     *   deps: ['jquery'],
     *   version: '2.1.0',
     *   localize: { guildId: '12345', markers: [...] }
     * });
     * 
     * @author FireBot Team
     */
    registerScript(handle, src, options = {}) {
        if (this.scripts.has(handle)) {
            this.logger.warn(`Script '${handle}' ist bereits registriert!`);
            return false;
        }

        // Vendor-Heuristik: Wenn Pfad auf einen Vendor-Unterordner zeigt, als Vendor markieren
        const isVendor = typeof options.vendor === 'boolean'
            ? options.vendor
            : /(^|\/)vendor\//.test(src);

        const asset = {
            handle,
            src: this._resolveAssetPath(src, options.plugin, 'js'),
            deps: options.deps || [],
            version: options.version || '1.0.0',
            inFooter: options.inFooter !== false,
            plugin: options.plugin,
            localize: options.localize,
            defer: options.defer || false,
            async: options.async || false,
            type: 'script',
            vendor: isVendor
        };

        this.scripts.set(handle, asset);
        this.logger.debug(`Script registriert: ${handle} → ${asset.src}`);
        return true;
    }

    /**
     * Registriert ein Stylesheet (wie wp_register_style)
     * 
     * @param {string} handle - Eindeutiger Identifier
     * @param {string} src - Pfad zum Stylesheet
     * @param {Object} options - Optionen
     * @param {Array<string>} [options.deps=[]] - Abhängigkeiten
     * @param {string} [options.version='1.0.0'] - Version
     * @param {string} [options.media='all'] - Media-Query (all, screen, print)
     * @param {string} [options.plugin] - Plugin-Name
     * 
     * @returns {boolean} true bei Erfolg
     * 
     * @author FireBot Team
     */
    registerStyle(handle, src, options = {}) {
        if (this.styles.has(handle)) {
            this.logger.warn(`Style '${handle}' ist bereits registriert!`);
            return false;
        }

        // Vendor-Heuristik: Wenn Pfad auf einen Vendor-Unterordner zeigt, als Vendor markieren
        const isVendor = typeof options.vendor === 'boolean'
            ? options.vendor
            : /(^|\/)vendor\//.test(src);

        const asset = {
            handle,
            src: this._resolveAssetPath(src, options.plugin, 'css'),
            deps: options.deps || [],
            version: options.version || '1.0.0',
            media: options.media || 'all',
            plugin: options.plugin,
            type: 'style',
            vendor: isVendor
        };

        this.styles.set(handle, asset);
        this.logger.debug(`Style registriert: ${handle} → ${asset.src}`);
        return true;
    }

    /**
     * Reiht ein Script für die Ausgabe ein (wie wp_enqueue_script)
     * 
     * @param {string} handle - Handle des zu ladenden Scripts
     * @returns {boolean} true bei Erfolg
     * 
     * @author FireBot Team
     */
    enqueueScript(handle) {
        if (!this.scripts.has(handle)) {
            this.logger.warn(`Script '${handle}' ist nicht registriert! Registriere erst mit registerScript().`);
            return false;
        }

        if (this.enqueuedScripts.has(handle)) {
            return true; // Bereits in der Queue
        }

        const asset = this.scripts.get(handle);

        // Abhängigkeiten rekursiv einreihen
        for (const dep of asset.deps) {
            this.enqueueScript(dep);
        }

        this.enqueuedScripts.add(handle);
        this.logger.debug(`Script enqueued: ${handle}`);
        return true;
    }

    /**
     * Reiht ein Stylesheet ein (wie wp_enqueue_style)
     * 
     * @param {string} handle - Handle des zu ladenden Styles
     * @returns {boolean} true bei Erfolg
     * 
     * @author FireBot Team
     */
    enqueueStyle(handle) {
        if (!this.styles.has(handle)) {
            this.logger.warn(`Style '${handle}' ist nicht registriert!`);
            return false;
        }

        if (this.enqueuedStyles.has(handle)) {
            return true;
        }

        const asset = this.styles.get(handle);

        // Abhängigkeiten rekursiv einreihen
        for (const dep of asset.deps) {
            this.enqueueStyle(dep);
        }

        this.enqueuedStyles.add(handle);
        this.logger.debug(`Style enqueued: ${handle}`);
        return true;
    }

    /**
     * Generiert HTML für alle enqueued Scripts
     * 
     * @param {boolean} [inFooter=true] - Nur Footer-Scripts oder nur Head-Scripts
     * @returns {string} HTML <script>-Tags
     * 
     * @author FireBot Team
     */
    renderScripts(inFooter = true) {
        const scripts = [];
        const localizeScripts = [];

        // Dependency-Reihenfolge berechnen
        const orderedHandles = this._resolveDependencyOrder(
            Array.from(this.enqueuedScripts),
            this.scripts
        );

        // Vendor-Skripte zuerst rendern, dann Nicht-Vendor – innerhalb der Gruppen bleibt die Dep-Reihenfolge erhalten
        const partitionedHandles = orderedHandles.reduce((acc, handle) => {
            const asset = this.scripts.get(handle);
            if (!asset) return acc;
            if (asset.vendor) acc.vendor.push(handle); else acc.app.push(handle);
            return acc;
        }, { vendor: [], app: [] });

        const handlesToRender = [...partitionedHandles.vendor, ...partitionedHandles.app];

        for (const handle of handlesToRender) {
            const asset = this.scripts.get(handle);
            
            // Nur Scripts für die richtige Position (head/footer)
            if (asset.inFooter !== inFooter) continue;

            // Nutze immer die registrierte Source-Datei (keine automatischen Debug-Versionen)
            // DEV→PROD Workflow läuft über Git, nicht über automatische File-Switches
            const src = asset.src;

            // wp_localize_script-Äquivalent
            if (asset.localize) {
                const varName = handle.replace(/-/g, '_') + '_data';
                localizeScripts.push(
                    `<script>window.${varName} = ${JSON.stringify(asset.localize)};</script>`
                );
            }

            // Script-Tag generieren
            const attrs = [];
            if (asset.defer) attrs.push('defer');
            if (asset.async) attrs.push('async');
            
            const versionedSrc = `${src}?ver=${asset.version}`;
            scripts.push(
                `<script src="${versionedSrc}"${attrs.length ? ' ' + attrs.join(' ') : ''}></script>`
            );

            // Inline-Code direkt nach dem Script ausgeben
            if (asset.inlineCode) {
                scripts.push(`<script>${asset.inlineCode}</script>`);
            }
        }

        return [...localizeScripts, ...scripts].join('\n');
    }

    /**
     * Generiert HTML für alle enqueued Styles
     * 
     * @returns {string} HTML <link>-Tags
     * 
     * @author FireBot Team
     */
    renderStyles() {
        const styles = [];

        // Dependency-Reihenfolge
        const orderedHandles = this._resolveDependencyOrder(
            Array.from(this.enqueuedStyles),
            this.styles
        );

        // Vendor-Styles zuerst, dann App-Styles – innerhalb der Gruppen Reihenfolge beibehalten
        const partitionedHandles = orderedHandles.reduce((acc, handle) => {
            const asset = this.styles.get(handle);
            if (!asset) return acc;
            if (asset.vendor) acc.vendor.push(handle); else acc.app.push(handle);
            return acc;
        }, { vendor: [], app: [] });

        const handlesToRender = [...partitionedHandles.vendor, ...partitionedHandles.app];

        for (const handle of handlesToRender) {
            const asset = this.styles.get(handle);
            const versionedSrc = `${asset.src}?ver=${asset.version}`;
            
            styles.push(
                `<link rel="stylesheet" href="${versionedSrc}" media="${asset.media}">`
            );
        }

        return styles.join('\n');
    }

    /**
     * Convenience: Registriert ein Vendor-Script (wird vor App-Skripten gerendert)
     * 
     * @param {string} handle
     * @param {string} src
     * @param {Object} options - gleiche Optionen wie registerScript
     * @returns {boolean}
     */
    registerVendorScript(handle, src, options = {}) {
        return this.registerScript(handle, src, { ...options, vendor: true });
    }

    /**
     * Convenience: Registriert ein Vendor-Stylesheet (wird vor App-Styles gerendert)
     * 
     * @param {string} handle
     * @param {string} src
     * @param {Object} options - gleiche Optionen wie registerStyle
     * @returns {boolean}
     */
    registerVendorStyle(handle, src, options = {}) {
        return this.registerStyle(handle, src, { ...options, vendor: true });
    }

    /**
     * Deregistriert ein Script (für Overrides)
     * 
     * @param {string} handle - Handle des zu entfernenden Scripts
     * @returns {boolean} true bei Erfolg
     * 
     * @author FireBot Team
     */
    deregisterScript(handle) {
        this.scripts.delete(handle);
        this.enqueuedScripts.delete(handle);
        return true;
    }

    /**
     * Deregistriert ein Style
     * 
     * @param {string} handle - Handle des zu entfernenden Styles
     * @returns {boolean} true bei Erfolg
     * 
     * @author FireBot Team
     */
    deregisterStyle(handle) {
        this.styles.delete(handle);
        this.enqueuedStyles.delete(handle);
        return true;
    }

    /**
     * Löst Asset-Pfad auf (Plugin-relativ zu absoluter URL)
     * 
     * @private
     * @param {string} src - Relativer Pfad
     * @param {string} plugin - Plugin-Name
     * @param {string} type - 'js' oder 'css'
     * @returns {string} Absoluter URL-Pfad
     * 
     * @author FireBot Team
     */
    _resolveAssetPath(src, plugin, type) {
        // Wenn bereits absolut (startet mit / oder http), unverändert zurückgeben
        if (src.startsWith('/') || src.startsWith('http')) {
            return src;
        }

        // Plugin-Assets: /assets/plugins/{name}/{src}
        // WICHTIG: Muss mit Express Static Route übereinstimmen (siehe app.js)
        if (plugin) {
            return `/assets/plugins/${plugin}/${src}`;
        }

        // Theme-Assets: aktives Theme aus ThemeManager ermitteln (Child → Parent Fallback)
        const themeManager = ServiceManager.get('themeManager');
        if (themeManager && typeof themeManager.resolveAssetUrl === 'function') {
            return themeManager.resolveAssetUrl(`${type}/${src}`);
        }

        // Fallback: default Theme
        const activeTheme = themeManager?.activeTheme || 'default';
        return `/themes/${activeTheme}/assets/${type}/${src}`;
    }

    /**
     * Berechnet korrekte Lade-Reihenfolge basierend auf Abhängigkeiten
     * 
     * @private
     * @param {Array<string>} handles - Zu sortierende Handles
     * @param {Map} assetMap - Map mit Asset-Definitionen
     * @returns {Array<string>} Sortierte Handles
     * 
     * @author FireBot Team
     */
    _resolveDependencyOrder(handles, assetMap) {
        const sorted = [];
        const visited = new Set();

        const visit = (handle) => {
            if (visited.has(handle)) return;
            visited.add(handle);

            const asset = assetMap.get(handle);
            if (!asset) return;

            // Rekursiv Abhängigkeiten besuchen
            for (const dep of asset.deps) {
                visit(dep);
            }

            sorted.push(handle);
        };

        for (const handle of handles) {
            visit(handle);
        }

        return sorted;
    }

    /**
     * Gibt alle registrierten Assets aus (Debug)
     * 
     * @returns {Object} {scripts: Array, styles: Array}
     * 
     * @author FireBot Team
     */
    getRegisteredAssets() {
        return {
            scripts: Array.from(this.scripts.keys()),
            styles: Array.from(this.styles.keys()),
            enqueuedScripts: Array.from(this.enqueuedScripts),
            enqueuedStyles: Array.from(this.enqueuedStyles)
        };
    }

    /**
     * Reset für Tests
     * 
     * @author FireBot Team
     */
    reset() {
        this.scripts.clear();
        this.styles.clear();
        this.enqueuedScripts.clear();
        this.enqueuedStyles.clear();
    }

    /**
     * Nur die Enqueue-Sets zurücksetzen, Registrierungen bleiben erhalten.
     * Wird pro Request aufgerufen, damit keine Assets aus vorherigen Requests durchsickern.
     */
    resetEnqueued() {
        this.enqueuedScripts.clear();
        this.enqueuedStyles.clear();
    }

    /**
     * Fügt Inline-JavaScript nach einem registrierten Script ein (wie wp_add_inline_script).
     *
     * @param {string} handle - Handle des Eltern-Scripts
     * @param {string} code   - JavaScript-Code (ohne <script>-Tags)
     * @returns {boolean}
     */
    addInlineScript(handle, code) {
        if (!this.scripts.has(handle)) {
            this.logger.warn(`[AssetManager] addInlineScript: Handle '${handle}' nicht registriert`);
            return false;
        }
        const asset = this.scripts.get(handle);
        asset.inlineCode = (asset.inlineCode || '') + '\n' + code;
        return true;
    }
}

module.exports = AssetManager;
