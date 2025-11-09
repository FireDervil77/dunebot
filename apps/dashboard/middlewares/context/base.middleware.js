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
    const assetManager = ServiceManager.get('assetManager');

    try {
        // Core Config laden
        const coreConfig = await pluginManager.getPlugin("core").getConfig();
        
        // SuperAdmin globale Configs laden (Versionen, Support-URLs)
        // WICHTIG: Diese sind GLOBAL (guildId = null) und gelten für alle Guilds
        const dashboardVersion = await dbService.getConfig('superadmin', 'DASHBOARD_VERSION', 'shared', null);
        const botVersion = await dbService.getConfig('superadmin', 'BOT_VERSION', 'shared', null);
        
        // Versionen zu coreConfig hinzufügen für Frontend-Footer Kompatibilität
        coreConfig.dashboardVersion = dashboardVersion || '1.0.0';
        coreConfig.botVersion = botVersion || '1.0.0';
        
        res.locals.coreConfig = coreConfig;

        // Map kurze Sprachcodes auf vollständige Codes
        const languageCodeMap = {
            'de': 'de-DE',
            'en': 'en-US',
            // weitere Sprachen nach Bedarf
        };

        // Setze und normalisiere Locale
        // KORREKTE Priorität: User-Override > Guild-Locale > Session-Locale > Global-Default
        let finalLocale = coreConfig?.LOCALE?.DEFAULT || "de-DE";
        let isGuildContext = false;
        
        // Guild-ID aus verschiedenen Quellen extrahieren (für Locale-Loading)
        // WICHTIG: Auch aus req.path extrahieren, da baseMiddleware VOR guildMiddleware läuft!
        let localeGuildId = res.locals?.guildId || req.params?.guildId || null;
        
        // Fallback: Guild-ID aus Pfad extrahieren (/guild/GUILD_ID/...)
        if (!localeGuildId && req.path.startsWith('/guild/')) {
            const pathMatch = req.path.match(/^\/guild\/([^\/]+)/);
            if (pathMatch && pathMatch[1]) {
                localeGuildId = pathMatch[1];
                Logger.debug(`[i18n] Guild-ID aus Pfad extrahiert: ${localeGuildId}`);
            }
        }
        
        // 1. Guild-Locale IMMER neu laden (falls Guild-Kontext vorhanden)
        //    → Guild-Locale hat Priorität über Session-Locale!
        if (localeGuildId) {
            isGuildContext = true;
            try {
                const [guildLocale] = await dbService.query(
                    "SELECT config_value FROM configs WHERE plugin_name = 'core' AND config_key = 'LOCALE' AND guild_id = ? AND context = 'shared'",
                    [localeGuildId]
                );
                if (guildLocale?.config_value) {
                    finalLocale = guildLocale.config_value;
                    Logger.debug(`[i18n] Guild-Locale für ${localeGuildId}: ${finalLocale}`);
                } else {
                    Logger.debug(`[i18n] Keine Guild-Locale gefunden für ${localeGuildId}, nutze Default: ${finalLocale}`);
                }
            } catch (err) {
                Logger.warn('[i18n] Fehler beim Laden der Guild-Locale:', err);
            }
        } else if (req.session && req.session.locale) {
            // Wenn kein Guild-Kontext, nutze Session-Locale als Fallback (falls Session existiert)
            finalLocale = req.session.locale;
            Logger.debug(`[i18n] Nutze Session-Locale: ${finalLocale}`);
        }
        
        // 2. User-Override prüfen (höchste Priorität!)
        //    → User kann persönliche Sprache unabhängig von Guild setzen
        if (req.session && req.session.user) {
            const [user] = await dbService.query(
                "SELECT locale FROM users WHERE _id = ?",
                [req.session.user.info.id]
            );
            const userLocale = user?.locale;
            if (userLocale) {
                finalLocale = userLocale;
                Logger.debug(`[i18n] User-Override-Locale für ${req.session.user.info.id}: ${finalLocale}`);
            }
        }
        
        // WICHTIG: Session-Locale NUR für authentifizierte User speichern!
        // Anonyme User bekommen keine Session-Erstellung durch Locale-Tracking
        if (req.session && req.session.user && req.session.locale !== finalLocale) {
            req.session.locale = finalLocale;
            Logger.debug(`[i18n] Session-Locale für User aktualisiert: ${finalLocale}`);
            
            if (req.session.save && !isGuildContext) {
                // Session nur außerhalb Guild-Kontext speichern (Performance)
                req.session.save((err) => {
                    if (err) Logger.error("[i18n] Failed to save session", err);
                });
            }
        }

        // Normalisiere Sprachcode falls nötig
        const normalizedLocale = languageCodeMap[finalLocale] || finalLocale || "de-DE";

        // WICHTIG: Setze aktuelle Sprache für diesen Request in i18next
        // Dies ermöglicht dynamischen Sprachwechsel ohne Neustart
        if (i18n && i18n.i18next) {
            await i18n.i18next.changeLanguage(normalizedLocale);
            Logger.debug(`[i18n] Sprache für Request auf ${normalizedLocale} gewechselt`);
        }

        // Extra user methods
        if (req.session.user) {
            req.session.user.info.isOwner = process.env.OWNER_IDS?.split(",")?.includes(req.session.user.info.id);
        }

        // Erstelle eine Übersetzungsfunktion mit Multi-Namespace-Support
        // WICHTIG: Nutze i18next direkt statt gecachte Translation-Funktionen!
        req.translate = function(key, options) {
            try {
                // Nutze i18next direkt mit aktueller Sprache
                if (i18n && i18n.i18next) {
                    // WICHTIG: Hole aktuelle Sprache dynamisch statt gecachte zu verwenden
                    const currentLang = i18n.i18next.language || normalizedLocale;
                    const result = i18n.i18next.t(key, { ...options, lng: currentLang });
                    
                    // Wenn i18next den Key zurückgibt (nicht gefunden), versuche Fallback
                    if (result === key) {
                        return manualLookup(key);
                    }
                    return result;
                }

                // Fallback zu altem System
                const translationFn = req.app.translations.get(normalizedLocale) || req.app.translations.get('de-DE');
                if (typeof translationFn === 'function') {
                    const result = translationFn(key, options);
                    if (result === key) {
                        return manualLookup(key);
                    }
                    return result;
                }

                return manualLookup(key);
            } catch (e) {
                Logger.error("Translation error:", e);
                return key; // Fallback auf den Key selbst
            }
            
            /**
             * Manueller Key-Lookup mit Multi-Namespace-Unterstützung
             * Sucht zuerst im aktuellen Plugin-Namespace, dann in 'translation'
             */
            function manualLookup(searchKey) {
                // DEBUG: Log zur Fehlersuche
                const pluginName = req.params?.pluginName || res.locals?.pluginName || null;
                
                Logger.debug('[i18n] manualLookup:', {
                    key: searchKey,
                    pluginName: pluginName,
                    'req.params.pluginName': req.params?.pluginName,
                    'res.locals.pluginName': res.locals?.pluginName,
                    locale: normalizedLocale
                });
                
                // 1. Versuche Plugin-Namespace (z.B. 'core', 'dunemap')
                if (pluginName && i18n) {
                    const pluginBundle = i18n.getResourceBundle?.(normalizedLocale, pluginName) || {};
                    
                    Logger.debug('[i18n] Plugin Bundle Keys:', Object.keys(pluginBundle).slice(0, 10));
                    
                    const pluginResult = searchKey.split('.').reduce(
                        (obj, k) => (obj && obj[k] !== undefined ? obj[k] : null), 
                        pluginBundle
                    );
                    if (pluginResult !== null) {
                        Logger.debug('[i18n] Found in plugin namespace:', pluginResult);
                        return pluginResult;
                    }
                }
                
                // 2. Fallback zu 'translation' Namespace (Dashboard-Basis-Übersetzungen)
                if (i18n) {
                    const translationObj = i18n.getResourceBundle?.(normalizedLocale, 'translation') || {};
                    const translationResult = searchKey.split('.').reduce(
                        (obj, k) => (obj && obj[k] !== undefined ? obj[k] : null), 
                        translationObj
                    );
                    if (translationResult !== null) {
                        Logger.debug('[i18n] Found in translation namespace:', translationResult);
                        return translationResult;
                    }
                }
                
                // 3. Letzter Fallback: Key selbst zurückgeben
                Logger.warn('[i18n] Translation not found, returning key:', searchKey);
                return searchKey;
            }
        };
        
        // WICHTIG: Alias req.t für Plugin-Kompatibilität (DuneMap u.a. nutzen req.t)
        req.t = req.translate;
        
        // WICHTIG: Stelle translate-Funktion auch für Templates bereit
        res.locals.tr = req.translate;
        res.locals.locale = normalizedLocale;

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
                const userId = res.locals.user?.id || null; // User ID für Permission-Filterung
                const mainMenu = await navigationManager.getMainMenuWithSubmenu(guildId, userId);
                
                // Navigation für das Template bereitstellen
                res.locals.guildNav = mainMenu;
                
                Logger.debug('[Navigation] Navigation für Template bereitgestellt:', {
                    itemCount: mainMenu?.length || 0,
                    userId: userId || 'anonymous',
                    permissionFiltered: !!userId
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
        
        // Plugin Scripts Array (für includePluginPartial Script Extraction)
        res.locals._pluginScripts = [];
        
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
        
        // AssetManager für Plugin-Assets (Scripts & Styles)
        const assetManager = ServiceManager.get('assetManager');
        if (assetManager) {
            res.locals.assetManager = assetManager;
        }
        
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

                    // Logger.debug('[Navigation] DB-Test Query:', {
                    //     found: testQuery?.length || 0,
                    //     items: testQuery?.map(i => ({
                    //         id: i.id,
                    //         title: i.title,
                    //         type: i.type,
                    //       parent: i.parent
                    //    }))
                    //});
                    
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
        
        // AssetManager für Templates bereitstellen
        if (assetManager) {
            res.locals.assetManager = assetManager;
            
            // Helper-Funktionen für Templates
            res.locals.enqueueScript = (handle) => assetManager.enqueueScript(handle);
            res.locals.enqueueStyle = (handle) => assetManager.enqueueStyle(handle);
        }
        
        if (themeManager?.setCurrentLocals) {
            themeManager.setCurrentLocals(res.locals);
            res.on('finish', () => themeManager.clearCurrentLocals?.());
            res.on('close',  () => themeManager.clearCurrentLocals?.());
        }
      
        if (themeManager) {
            await themeManager.loadGlobalNotifications(req, res);
            // Map globalNotifications zu notifications für Template-Kompatibilität
            if (res.locals.globalNotifications && Array.isArray(res.locals.globalNotifications)) {
                res.locals.notifications = res.locals.globalNotifications;
            }
        }

        
        next();
    } catch (error) {
        Logger.error("Error in base middleware:", error);
        next(error);
    }
};