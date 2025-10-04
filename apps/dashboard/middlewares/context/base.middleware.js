const { ServiceManager } = require("dunebot-core");
const { languagesMeta } = require("dunebot-core");
const path = require("path");
require("dotenv").config();

const OWNER_IDS = process.env.OWNER_IDS
    ? process.env.OWNER_IDS.split(",").map(id => id.trim())
    : [];

/**
 * Basis-Middleware zur Bereitstellung von Kontextdaten für alle Requests
 * Stellt globale Variablen für Templates, Benutzerinformationen und Navigation bereit
 * 
 * @author firedervil
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
module.exports = async (req, res, next) => {
    // aus dem ServiceManager bereit stellen
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const pluginManager = ServiceManager.get('pluginManager');
    const i18n = ServiceManager.get('i18n');
    const themeManager = ServiceManager.get('themeManager');
    const navManager = ServiceManager.get('navigationManager');

    try {
        // Core Config laden
        const coreConfig = await pluginManager.getPlugin("core").getConfig();
        res.locals.coreConfig = coreConfig;

        // Map kurze Sprachcodes auf vollständige Codes
        const languageCodeMap = {
            'de': 'de-DE',
            'en': 'en-US',
            // weitere Sprachen nach Bedarf
        };

        // Setze und normalisiere Locale
        if (!req.session.locale) {
            if (!req.session.user) {
                req.session.locale = coreConfig?.LOCALE?.DEFAULT || "de-DE";
            } else {
                const [user] = await dbService.query(
                    "SELECT locale FROM users WHERE _id = ?",
                    [req.session.user.info.id]
                );
                const dbLocale = user?.locale;
                req.session.locale = dbLocale || coreConfig?.LOCALE?.DEFAULT || "de-DE";
            }
            req.session.save((err) => {
                if (err) Logger.error("Failed to save session", err);
            });
        }

        // Normalisiere Sprachcode falls nötig
        const normalizedLocale = languageCodeMap[req.session.locale] || req.session.locale || "de-DE";

        // Extra user methods
        if (req.session.user) {
            req.session.user.info.isOwner = process.env.OWNER_IDS?.split(",")?.includes(req.session.user.info.id);
        }

        // Erstelle eine Übersetzungsfunktion
        req.translate = function(key, options) {
            try {
                const translationFn = req.app.translations.get(normalizedLocale) || req.app.translations.get('de-DE');
                if (typeof translationFn === 'function') {
                    return translationFn(key, options);
                }

                // Fallback: Manueller Key-Lookup
                const translationObj = i18n?.getResourceBundle?.(normalizedLocale, 'translation') || {};
                return key.split('.').reduce((obj, k) => (obj && obj[k] !== undefined ? obj[k] : key), translationObj);
            } catch (e) {
                Logger.error("Translation error:", e);
                return key; // Fallback auf den Key selbst
            }
        };

        // =========================================
        // THEME-VARIABLEN SETZEN
        // =========================================
        
        // Basis-URLs aus .env oder Defaults
        const dashboardUrl = process.env.DASHBOARD_URL || `${req.protocol}://${req.get('host')}`;
        
        // Benutzer- und Guild-Daten für Templates
        res.locals.user = req.session?.user || null;
        res.locals.user = req.session?.user?.info || null;

        // Prüfen ob es sich um eine Guild-Route handelt
        const isGuildRoute = req.path.startsWith('/guild/');
        
        // Guild-Informationen extrahieren und als Fallback leere Objekte bereitstellen
        let guildId = req.params?.guildId || req.query?.guildId || '';
        
        // Falls keine guildId in params, versuche sie aus dem Pfad zu extrahieren
        if (!guildId && isGuildRoute) {
            const matches = req.path.match(/^\/guild\/([^\/]+)/);
            if (matches && matches[1]) {
                guildId = matches[1];
                // Setze die guildId auch in params für spätere Middleware
                req.params.guildId = guildId;
            }
        }
        
        Logger.debug('[Navigation] Parameter-Extraktion:', {
            path: req.path,
            isGuildRoute,
            extractedFromPath: req.path.match(/^\/guild\/([^\/]+)/)?.[1],
            params: req.params,
            query: req.query,
            finalGuildId: guildId
        });
        
        // Stelle sicher, dass Guild-Daten immer verfügbar sind (auch wenn leer)
        res.locals.guild = res.locals.guild || { name: '', id: guildId };
        res.locals.guildId = guildId;
        
        // Prüfen ob es sich um eine Asset-Route handelt
        const isAssetRoute = req.path.startsWith('/themes/') || 
                           req.path.startsWith('/assets/') || 
                           req.path.startsWith('/plugins/');

        // Navigation nur laden wenn es eine Guild-Route ist und keine Asset-Route
        if (isGuildRoute && guildId && !isAssetRoute) {
            try {
                const navigationManager = ServiceManager.get('navigationManager');
                const mainMenu = await navigationManager.getMainMenuWithSubmenu(guildId);
                
                // Navigation für das Template bereitstellen
                res.locals.guildNav = mainMenu;
                
                Logger.debug('[Navigation] Navigation für Template bereitgestellt:', {
                    itemCount: mainMenu?.length || 0
                });
            } catch (error) {
                Logger.error('[Navigation] Fehler beim Laden der Navigation:', error);
                res.locals.guildNav = [];
            }
        } else {
            res.locals.guildNav = [];
            
            if (isAssetRoute) {
                Logger.debug('[Navigation] Asset-Route erkannt, überspringe Navigation:', {
                    path: req.path
                });
            }
        }
        
        Logger.debug('[Navigation] Guild-Info:', {
            guildId,
            params: req.params,
            path: req.path
        });
        
        // URL und Navigation
        res.locals.currentUrl = `${dashboardUrl}${req.originalUrl}`;
        res.locals.baseUrl = dashboardUrl;
        res.locals.activeMenu = req.originalUrl;
        res.locals.dashboardHomeUrl = req.session?.user ? '/guild' : '/auth/server-selector';
        
        // Meta-Informationen
        res.locals.siteName = process.env.SITE_NAME || 'DuneBot';
        res.locals.dashboard_version = process.env.DASHBOARD_VERSION || '0.1.0-beta';
        res.locals.bot_version = process.env.BOT_VERSION || '0.1.0-beta';
        res.locals.environment = process.env.NODE_ENV || 'development';
        res.locals.year = new Date().getFullYear();
        
        // Flash Messages (falls vorhanden) - IMMER als Arrays setzen
        const successMessages = req.flash?.('success') || [];
        const errorMessages = req.flash?.('error') || [];
        const infoMessages = req.flash?.('info') || [];
        const warningMessages = req.flash?.('warning') || [];
        res.locals.success = Array.isArray(successMessages) ? successMessages : [String(successMessages)];
        res.locals.error = Array.isArray(errorMessages) ? errorMessages : [String(errorMessages)];
        res.locals.info = Array.isArray(infoMessages) ? infoMessages : [String(infoMessages)];
        res.locals.warning = Array.isArray(warningMessages) ? warningMessages : [String(warningMessages)];
        
        // Leere Standardwerte für erwartete Arrays und Objekte
        res.locals.notifications = [];
        res.locals.unreadMessages = 0;
        res.locals.messages = [];
        res.locals.guildNav = [];  // Wichtig für die Sidebar!
        res.locals.breadcrumbs = []; // Breadcrumb-Navigation

        // Meta-Defaults, falls ein Controller nichts setzt
        if (!res.locals.meta) {
            res.locals.meta = {
                pageType: 'generic',
                objectId: res.locals.guildId || null,
                capabilities: []
            };
        }
        
        // Cache-Buster für Assets
        res.locals.cacheBuster = process.env.NODE_ENV === 'production' ? 
            (pluginManager?.getPlugin?.("core")?.version || '1.0.0') : 
            Date.now();
        
        // Hilfsfunktionen für Templates
        res.locals.formatDate = (date) => {
            if (!date) return '';
            const d = new Date(date);
            return d.toLocaleDateString(normalizedLocale, {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        };
        
        // Sprach-Metadaten
        res.locals.languagesMeta = languagesMeta;
        res.locals.locale = normalizedLocale;
        
        // Theme-spezifische Variablen
        if (navManager) {
            try {
                // Prüfe, ob dies ein Guild-bezogener Request ist
                const isGuildRoute = req.path.startsWith('/guild/');
                Logger.debug(`[Navigation] Request-Info:`, {
                    path: req.path,
                    isGuildRoute,
                    guildId
                });
                
                // Navigation nur für Guild-Routen laden
                if (isGuildRoute && guildId) {
                    Logger.debug(`[Navigation] Starte Navigation-Load für Guild ${guildId}`);
                    
                    // DIREKTE DB-ABFRAGE zur Prüfung
                    const testQuery = await dbService.query(
                        "SELECT * FROM nav_items WHERE guildid = ? AND (type = 'main' OR type = 'widget') AND visible = 1",
                        [guildId]
                    );
                    
                    Logger.debug('[Navigation] DB-Test Query:', {
                        found: testQuery?.length || 0,
                        items: testQuery?.map(i => ({
                            id: i.id,
                            title: i.title,
                            type: i.type,
                            parent: i.parent
                        }))
                    });
                    
                    // Navigation laden
                    const mainMenu = await navManager.getMainMenuWithSubmenu(guildId);

                    if (!mainMenu || mainMenu.length === 0) {
                        Logger.warn(`[Navigation] Keine Navigation geladen für Guild ${guildId}`);
                        // Versuche Core Plugin zu aktivieren
                        try {
                            const corePlugin = pluginManager.getPlugin('core');
                            if (corePlugin?.onGuildEnable) {
                                await corePlugin.onGuildEnable(guildId);
                                Logger.debug('[Navigation] Core Plugin aktiviert, lade Navigation neu...');
                                const refreshedMenu = await navManager.getMainMenuWithSubmenu(guildId);
                                res.locals.guildNav = refreshedMenu || [];
                            }
                        } catch (err) {
                            Logger.error('[Navigation] Core Plugin Aktivierung fehlgeschlagen:', err);
                        }
                    } else {
                        res.locals.guildNav = mainMenu;
                    }
                    
                } else {
                    res.locals.guildNav = [];
                    Logger.debug('[Navigation] Keine Guild ID verfügbar');
                }
                                
                // Plugin-Navigationen dynamisch sammeln
                const pluginAreas = Object.keys(navManager.navigationCache || {}).filter(a => a.startsWith('plugin-'));
                res.locals.pluginNavs = pluginAreas.map(area => ({
                    key: area,
                    title: `Plugin: ${area.replace('plugin-', '')}`,
                    nav: navManager.getNavigation(area)
                }));
            } catch (e) {
                Logger.warn("Fehler beim Laden der Navigation:", e);
                res.locals.guildNav = [];
                res.locals.pluginNavs = [];
            }
            
            // Hook-System für Templates verfügbar machen
            res.locals.hooks = themeManager.hooks || {};
        }
        if (themeManager?.setCurrentLocals) {
            themeManager.setCurrentLocals(res.locals);
            res.on('finish', () => themeManager.clearCurrentLocals?.());
            res.on('close',  () => themeManager.clearCurrentLocals?.());
        }
      
        if (themeManager) {
            await themeManager.loadGlobalNotifications(req, res);
        }

        
        next();
    } catch (error) {
        Logger.error("Error in base middleware:", error);
        next(error);
    }
};