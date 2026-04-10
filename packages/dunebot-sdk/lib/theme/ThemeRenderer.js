'use strict';

const fs = require('fs');
const path = require('path');
const { ServiceManager } = require('dunebot-core');

/**
 * ThemeRenderer — renderView(), Context-Merge, Layout, EJS-Helpers
 * 
 * Zuständig für das Rendern von Views und die Registrierung
 * aller EJS-Template-Helpers (includePartial, hasPermission, etc.).
 */
class ThemeRenderer {
    /**
     * @param {import('../ThemeManager')} manager - ThemeManager-Instanz
     */
    constructor(manager) {
        this.manager = manager;
    }

    /**
     * View rendern mit automatischem Context-Management
     * @param {Object} res - Express Response
     * @param {string} view - View-Pfad
     * @param {Object} data - Zusätzliche View-Daten
     */
    async renderView(res, view, data = {}) {
        const Logger = ServiceManager.get('Logger');

        try {
            // 1. Layout für den Bereich setzen
            const section = view.startsWith('guild/') ? 'guild' : 
                          view.startsWith('admin/') ? 'guild' :
                          view.startsWith('frontend/') ? 'frontend' : 
                          'frontend'; // default

            // 2. Basis-Context laden
            const baseContext = this.manager.getContext();

            // 3. View-spezifische Daten mit Basis-Context mergen
            const viewData = {
                ...baseContext,
                ...res.locals,
                ...data
            };

            // 4. Alle View-Daten in res.locals mergen für express-ejs-layouts
            Object.assign(res.locals, viewData);

            // 5. Layout NACH dem Merge setzen
            res.locals.layout = this.getLayout(section);

            Logger.debug('Render Context:', {
                view,
                section,
                hasUser: !!viewData.user,
                layout: res.locals.layout,
                hasEnabledPlugins: !!viewData.enabledPlugins
            });

            // 6. Plugin-Name erkennen (für Plugin-View-Fallback)
            const pluginName = data.pluginName || res.locals.pluginName || null;

            // 7. Template-Hierarchie auflösen und View rendern
            const hierarchy = this.manager.resolver.resolveTemplateHierarchy(view, viewData);
            Logger.debug('[ThemeRenderer] Template-Hierarchie:', hierarchy);

            const resolvedPath = hierarchy
                .map(candidate => this.manager.resolver.resolveViewPath(candidate, pluginName))
                .find(p => p !== null);

            if (resolvedPath) {
                Logger.debug(`[ThemeRenderer] Rendere: ${resolvedPath}`);
                res.render(resolvedPath);
            } else {
                // Fallback: Express selbst suchen lassen
                res.render(view);
            }

        } catch (error) {
            Logger.error('Fehler beim Rendern der View:', error);
            throw error;
        }
    }

    /**
     * Layout für einen bestimmten Bereich abrufen
     * @param {string} section - Bereich (guild, frontend, auth)
     * @returns {string} Layout-Pfad
     */
    getLayout(section) {
        const PathConfig = this.manager.PathConfig;
        const layouts = PathConfig.getPath('dashboard').layouts(this.manager.activeTheme);
        
        if (!layouts[section]) {
            throw new Error(`Kein Layout für Bereich '${section}' definiert`);
        }
        return layouts[section];
    }

    /**
     * Rendert ein Widget-Partial und merged den kompletten Kontext
     * @param {string} widgetName - Name des Widgets
     * @param {Object} data - Kontextdaten für das Widget
     * @returns {Promise<string>} Gerenderter HTML-String
     */
    async renderWidgetPartial(widgetName, data = {}) {
        const Logger = ServiceManager.get('Logger');
        const PathConfig = this.manager.PathConfig;
        const searchPaths = [];

        try {
            // 1. Plugin-spezifischer Pfad
            if (data.plugin) {
                const pluginPaths = PathConfig.getPath('plugin', data.plugin);
                searchPaths.push(path.join(pluginPaths.widgets, widgetName + '.ejs'));
            }

            // 2. Alle Plugin-Pfade durchsuchen
            const pluginsDir = PathConfig.getPath('plugins');
            if (fs.existsSync(pluginsDir)) {
                const plugins = fs.readdirSync(pluginsDir);
                plugins.forEach(plugin => {
                    const pluginPaths = PathConfig.getPath('plugin', plugin);
                    searchPaths.push(path.join(pluginPaths.widgets, widgetName + '.ejs'));
                });
            }

            // 3. Theme-Chain
            for (const themeName of this.manager._themeChain) {
                searchPaths.push(
                    path.join(this.manager.themesDir, themeName, 'views', 'widgets', widgetName + '.ejs')
                );
            }

            Logger.debug('Widget-Suchpfade:', searchPaths);

            for (const widgetPath of searchPaths) {
                if (fs.existsSync(widgetPath)) {
                    Logger.debug(`Widget gefunden: ${widgetPath}`);
                    return await this.manager.ejs.renderFile(widgetPath, {
                        ...this.manager.app.locals,
                        ...(this.manager.currentLocals || {}),
                        ...this.manager.themeContext,
                        ...data
                    }, { async: true });
                }
            }

            Logger.warn(`Widget ${widgetName} nicht gefunden`);
            return `<!-- Widget ${widgetName} nicht gefunden -->`;

        } catch (error) {
            Logger.error(`Fehler beim Rendern des Widgets ${widgetName}:`, error);
            return `<!-- Fehler beim Rendern von Widget ${widgetName} -->`;
        }
    }

    /**
     * Theme-spezifische View-Engine konfigurieren und EJS-Helpers registrieren
     */
    setupViewEngine() {
        const Logger = ServiceManager.get('Logger');
        const i18n = ServiceManager.get('i18n');
        const manager = this.manager;

        // Plugin-Views sammeln
        const projectRoot = path.join(process.cwd(), '..', '..');
        const pluginsDir = path.join(projectRoot, 'plugins');
        const pluginViewPaths = [];

        Logger.info(`Durchsuche Plugins-Verzeichnis nach Views: ${pluginsDir}`);
        
        if (fs.existsSync(pluginsDir)) {
            const plugins = fs.readdirSync(pluginsDir);
            Logger.info(`Gefundene Plugins (${plugins.length}): ${plugins.join(', ')}`);
            
            plugins.forEach(plugin => {
                const pluginPath = path.join(pluginsDir, plugin);
                const stat = fs.statSync(pluginPath);
                
                if (!stat.isDirectory() || plugin.startsWith('.') || plugin.startsWith('_')) {
                    return;
                }
                
                const pluginViewsPath = path.join(pluginsDir, plugin, 'dashboard', 'views');
                
                if (fs.existsSync(pluginViewsPath)) {
                    pluginViewPaths.push(pluginViewsPath);
                    Logger.info(`✅ Plugin-Views gefunden für ${plugin}: ${pluginViewsPath}`);
                }
            });
        }

        // Views-Verzeichnisse aktualisieren
        const viewPaths = [
            ...pluginViewPaths,
            ...manager._themeChain.map(t => manager.PathConfig.getPath('theme', t).views),
            manager.PathConfig.getPath('dashboard').views
        ];
        
        manager.app.set('views', viewPaths);
        Logger.debug('View-Pfade konfiguriert:', viewPaths);

        // EJS Layout-Konfiguration
        manager.app.set('layout', 'layouts/frontend');
        manager.app.set('layout extractScripts', true);
        manager.app.set('layout extractStyles', true);

        manager.app.locals.tr = manager.app.locals.tr || ((key, options) => {
            const locale = manager.app?.session?.locale || 'de-DE';
            return i18n?.tr?.(key, options, locale) || key;
        });
        
        const appLocals = manager.app.locals;
        const themeManager = manager;
        
        // ============================================================================
        // GLOBAL FUNCTION: includePartial (WordPress-Style!)
        // ============================================================================
        manager.app.locals.includePartial = function(filename, data = {}) {
            try {                    
                const ejs = require('ejs');

                Logger.debug(`[includePartial] ${filename} - Has guildId:`, typeof this.guildId !== 'undefined', this.guildId);

                const filePath = themeManager.resolver.resolvePartialPath(filename);
                if (!filePath) {
                    Logger.warn(`Partial ${filename} nicht gefunden`);
                    return `<!-- Partial ${filename}.ejs nicht gefunden -->`;
                }
                
                const template = fs.readFileSync(filePath, 'utf8');
                
                const renderContext = {
                    ...appLocals,
                    ...this,
                    ...data
                };
                
                if (process.env.NODE_ENV !== 'production') {
                    ejs.clearCache();
                }
                
                return ejs.render(template, renderContext, { cache: false, filename: filePath });
            } catch (error) {
                Logger.error(`Fehler beim Einbinden des Partials ${filename}:`, error);
                return `<!-- Fehler beim Laden von ${filename} -->`;
            }
        };
        
        // ============================================================================
        // GLOBAL FUNCTION: includePluginPartial
        // ============================================================================
        manager.app.locals.includePluginPartial = function(pluginName, filename, data = {}) {
            try {                    
                const ejs = require('ejs');
                const PathConfig = require('../utils/PathConfig').getInstance();
                
                Logger.debug(`[includePluginPartial] Plugin: ${pluginName}, Partial: ${filename}`);
                
                const pluginPaths = PathConfig.getPath('plugin', pluginName);
                
                const searchPaths = [
                    path.join(pluginPaths.dashboard, 'views', 'partials', filename + '.ejs'),
                    path.join(pluginPaths.dashboard, 'partials', filename + '.ejs'),
                    path.join(pluginPaths.root, 'partials', filename + '.ejs')
                ];
                
                const filePath = searchPaths.find(p => fs.existsSync(p));
                if (!filePath) {
                    Logger.warn(`Plugin-Partial ${pluginName}/${filename} nicht gefunden. Suchpfade:`, searchPaths);
                    return `<!-- Plugin-Partial ${pluginName}/${filename} nicht gefunden -->`;
                }
                
                Logger.debug(`Plugin-Partial gefunden: ${filePath}`);
                const template = fs.readFileSync(filePath, 'utf8');
                
                const renderContext = {
                    ...appLocals,
                    ...this,
                    ...data
                };
                
                if (process.env.NODE_ENV !== 'production') {
                    ejs.clearCache();
                }
                
                let renderedContent = ejs.render(template, renderContext, { cache: false, filename: filePath });
                
                // Script Extraction
                const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
                const scripts = [];
                let match;
                
                while ((match = scriptRegex.exec(renderedContent)) !== null) {
                    scripts.push(match[0]);
                }
                
                if (scripts.length > 0) {
                    Logger.debug(`[includePluginPartial] ${scripts.length} Script(s) gefunden und extrahiert`);
                    renderedContent = renderedContent.replace(scriptRegex, '');
                    
                    if (Array.isArray(renderContext._pluginScripts)) {
                        renderContext._pluginScripts.push(...scripts);
                    }
                }
                
                return renderedContent;
            } catch (error) {
                Logger.error(`Fehler beim Einbinden des Plugin-Partials ${pluginName}/${filename}:`, error);
                return `<!-- Fehler beim Laden von ${pluginName}/${filename}: ${error.message} -->`;
            }
        };
        
        // ============================================================================
        // Theme-Helper-Objekt (für theme.asset(), theme.info)
        // ============================================================================
        manager.app.locals.theme = {
            asset: (assetPath) => {
                const fallbackRel = 'images/dunebot-news.gif';

                if (!assetPath || typeof assetPath !== 'string') {
                    assetPath = fallbackRel;
                }

                if (/^https?:\/\//i.test(assetPath)) {
                    return assetPath;
                }

                const activeThemeAssets = manager.PathConfig.getPath('dashboard').assets(manager.activeTheme);
                const activeAssetPath = path.join(activeThemeAssets.root, assetPath);
                
                if (fs.existsSync(activeAssetPath)) {
                    return manager.PathConfig.getUrl('theme', manager.activeTheme, 'assets') + '/' + assetPath;
                }
                
                const defaultAssets = manager.PathConfig.getPath('dashboard').assets('default');
                const defaultAssetPath = path.join(defaultAssets.root, assetPath);
                if (fs.existsSync(defaultAssetPath)) {
                    return manager.PathConfig.getUrl('theme', 'default', 'assets') + '/' + assetPath;
                }

                return manager.PathConfig.getUrl('theme', 'default', 'assets') + '/' + fallbackRel;
            },
            info: manager.themeConfig
        };
        
        // ============================================================================
        // getUserAvatar
        // ============================================================================
        manager.app.locals.getUserAvatar = function(user, size = 128) {
            const info = (user && user.info) ? user.info : user;
            if (!info || !info.id) {
                return '/themes/default/assets/images/default-avatar.png';
            }
            
            if (info.avatar) {
                const extension = info.avatar.startsWith('a_') ? 'gif' : 'png';
                return `https://cdn.discordapp.com/avatars/${info.id}/${info.avatar}.${extension}?size=${size}`;
            }
            
            const defaultAvatarIndex = info.discriminator 
                ? parseInt(info.discriminator) % 5 
                : Number((BigInt(info.id) >> BigInt(22)) % BigInt(5));
            
            return `https://cdn.discordapp.com/embed/avatars/${defaultAvatarIndex}.png`;
        };

        // ============================================================================
        // Permission Helpers
        // ============================================================================
        manager.app.locals.hasPermission = function(permissionKey) {
            if (!this.userPermissions || !this.userPermissions.permissions) {
                return false;
            }
            
            if (this.userPermissions.permissions['*'] === true || 
                this.userPermissions.permissions['wildcard'] === true) {
                return true;
            }
            
            if (this.userPermissions.permissions[permissionKey] === true) {
                return true;
            }
            
            const parts = permissionKey.split('.');
            for (let i = parts.length - 1; i >= 0; i--) {
                const wildcardKey = parts.slice(0, i).join('.') + '.*';
                if (this.userPermissions.permissions[wildcardKey] === true) {
                    return true;
                }
            }
            
            return false;
        };
        
        manager.app.locals.hasAnyPermission = function(permissionKeys) {
            if (!Array.isArray(permissionKeys)) return false;
            return permissionKeys.some(perm => this.hasPermission(perm));
        };
        
        manager.app.locals.hasAllPermissions = function(permissionKeys) {
            if (!Array.isArray(permissionKeys)) return false;
            return permissionKeys.every(perm => this.hasPermission(perm));
        };
        
        manager.app.locals.isGuildOwner = function() {
            return this.userPermissions?.isOwner === true;
        };
        
        manager.app.locals.getUserPermissions = function() {
            return this.userPermissions?.permissions || {};
        };

        Logger.debug('View-Engine konfiguriert mit Pfaden:', manager.app.get('views'));
    }
}

module.exports = ThemeRenderer;
