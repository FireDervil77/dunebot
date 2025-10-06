const { ServiceManager } = require('dunebot-core');
const path = require('path');

/**
 * AssetManager - WordPress-ähnliches Asset-Enqueuing-System
 * Ermöglicht Plugins das Registrieren von CSS/JS mit Abhängigkeiten, Versionen und Debug-Support
 * 
 * @author DuneBot Team
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
        
        /** @type {boolean} Debug-Modus (lädt .dev.js statt .min.js) */
        this.debugMode = process.env.NODE_ENV === 'development' || process.env.SCRIPT_DEBUG === 'true';
        
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
     * @param {string} [options.debugSrc] - Alternative Source für Debug-Modus
     * 
     * @returns {boolean} true bei Erfolg
     * 
     * @example
     * assetManager.registerScript('dunemap-admin', 'js/dunemap-admin.js', {
     *   plugin: 'dunemap',
     *   deps: ['jquery'],
     *   version: '2.1.0',
     *   localize: { guildId: '12345', markers: [...] },
     *   debugSrc: 'js/dunemap-admin.dev.js'
     * });
     * 
     * @author DuneBot Team
     */
    registerScript(handle, src, options = {}) {
        if (this.scripts.has(handle)) {
            this.logger.warn(`Script '${handle}' ist bereits registriert!`);
            return false;
        }

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
            debugSrc: options.debugSrc ? this._resolveAssetPath(options.debugSrc, options.plugin, 'js') : null,
            type: 'script'
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
     * @author DuneBot Team
     */
    registerStyle(handle, src, options = {}) {
        if (this.styles.has(handle)) {
            this.logger.warn(`Style '${handle}' ist bereits registriert!`);
            return false;
        }

        const asset = {
            handle,
            src: this._resolveAssetPath(src, options.plugin, 'css'),
            deps: options.deps || [],
            version: options.version || '1.0.0',
            media: options.media || 'all',
            plugin: options.plugin,
            type: 'style'
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
     * @author DuneBot Team
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
     * @author DuneBot Team
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
     * @author DuneBot Team
     */
    renderScripts(inFooter = true) {
        const scripts = [];
        const localizeScripts = [];

        // Dependency-Reihenfolge berechnen
        const orderedHandles = this._resolveDependencyOrder(
            Array.from(this.enqueuedScripts),
            this.scripts
        );

        for (const handle of orderedHandles) {
            const asset = this.scripts.get(handle);
            
            // Nur Scripts für die richtige Position (head/footer)
            if (asset.inFooter !== inFooter) continue;

            // Debug-Modus: .dev.js statt .min.js oder debugSrc verwenden
            let src = asset.src;
            if (this.debugMode && asset.debugSrc) {
                src = asset.debugSrc;
            } else if (this.debugMode) {
                src = src.replace(/\.min\.js$/, '.dev.js').replace(/\.js$/, '.dev.js');
            }

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

            // Debug-Kommentar im Development
            if (this.debugMode) {
                scripts.push(`<!-- Script: ${handle} (${asset.plugin || 'core'}) -->`);
            }
        }

        return [...localizeScripts, ...scripts].join('\n');
    }

    /**
     * Generiert HTML für alle enqueued Styles
     * 
     * @returns {string} HTML <link>-Tags
     * 
     * @author DuneBot Team
     */
    renderStyles() {
        const styles = [];

        // Dependency-Reihenfolge
        const orderedHandles = this._resolveDependencyOrder(
            Array.from(this.enqueuedStyles),
            this.styles
        );

        for (const handle of orderedHandles) {
            const asset = this.styles.get(handle);
            const versionedSrc = `${asset.src}?ver=${asset.version}`;
            
            styles.push(
                `<link rel="stylesheet" href="${versionedSrc}" media="${asset.media}">`
            );

            if (this.debugMode) {
                styles.push(`<!-- Style: ${handle} (${asset.plugin || 'core'}) -->`);
            }
        }

        return styles.join('\n');
    }

    /**
     * Deregistriert ein Script (für Overrides)
     * 
     * @param {string} handle - Handle des zu entfernenden Scripts
     * @returns {boolean} true bei Erfolg
     * 
     * @author DuneBot Team
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
     * @author DuneBot Team
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
     * @author DuneBot Team
     */
    _resolveAssetPath(src, plugin, type) {
        // Wenn bereits absolut (startet mit / oder http), unverändert zurückgeben
        if (src.startsWith('/') || src.startsWith('http')) {
            return src;
        }

        // Plugin-Assets: /assets/plugins/{name}/{src}
        if (plugin) {
            return `/assets/plugins/${plugin}/${src}`;
        }

        // Theme-Assets: /themes/default/assets/{type}/{src}
        return `/themes/default/assets/${type}/${src}`;
    }

    /**
     * Berechnet korrekte Lade-Reihenfolge basierend auf Abhängigkeiten
     * 
     * @private
     * @param {Array<string>} handles - Zu sortierende Handles
     * @param {Map} assetMap - Map mit Asset-Definitionen
     * @returns {Array<string>} Sortierte Handles
     * 
     * @author DuneBot Team
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
     * @author DuneBot Team
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
     * @author DuneBot Team
     */
    reset() {
        this.scripts.clear();
        this.styles.clear();
        this.enqueuedScripts.clear();
        this.enqueuedStyles.clear();
    }
}

module.exports = AssetManager;
