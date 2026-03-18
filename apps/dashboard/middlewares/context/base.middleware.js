const { ServiceManager } = require("dunebot-core");
const { languagesMeta } = require("dunebot-core");
const path = require("path");
require("dotenv").config();

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
    const siteConfig = ServiceManager.get('siteConfig');

    // Enqueue-Sets pro Request zurücksetzen (Registrierungen bleiben erhalten)
    assetManager?.resetEnqueued();

    try {
        // Core Config laden
        const coreConfig = await pluginManager.getPlugin("core").getConfig();

        // Versionen aus SiteConfig (einmalig gecacht beim Start)
        coreConfig.dashboardVersion = siteConfig?.get('DASHBOARD_VERSION', '1.0.0') || '1.0.0';
        coreConfig.botVersion = siteConfig?.get('BOT_VERSION', '1.0.0') || '1.0.0';

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
            req.session.user.info.isOwner = siteConfig
                ? siteConfig.isOwner(req.session.user.info.id)
                : (process.env.OWNER_IDS?.split(',')?.map(s => s.trim())?.includes(req.session.user.info.id) ?? false);
        }

        // Erstelle eine Übersetzungsfunktion mit Multi-Namespace-Support
        // WICHTIG: Nutze i18next direkt statt gecachte Translation-Funktionen!
        req.translate = function (key, options) {
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
                const pluginName = req.params?.pluginName || res.locals?.pluginName || null;

                Logger.debug('[i18n] manualLookup:', {
                    key: searchKey,
                    pluginName: pluginName,
                    locale: normalizedLocale
                });

                if (!i18n) {
                    Logger.warn('[i18n] i18n nicht verfügbar, gebe Key zurück:', searchKey);
                    return searchKey;
                }

                const keyParts = searchKey.split('.');

                // Hilfsfunktion: Dotted-Path im Bundle suchen
                const lookupInBundle = (bundle, parts) => {
                    const result = parts.reduce(
                        (obj, k) => (obj && obj[k] !== undefined ? obj[k] : null),
                        bundle
                    );
                    return (result !== null && typeof result === 'string') ? result : null;
                };

                const triedNs = new Set();

                // 1. Versuche Plugin-Namespace (z.B. 'core', 'dunemap')
                if (pluginName) {
                    triedNs.add(pluginName);
                    const pluginBundle = i18n.getResourceBundle?.(normalizedLocale, pluginName) || {};
                    const result = lookupInBundle(pluginBundle, keyParts);
                    if (result !== null) {
                        Logger.debug(`[i18n] Gefunden in Plugin-Namespace '${pluginName}':`, result);
                        return result;
                    }
                }

                // 2. Namespace aus Key-Prefix ableiten (z.B. 'CORE.PERM_X' → 'core')
                if (keyParts.length > 1) {
                    const nsFromKey = keyParts[0].toLowerCase();
                    if (!triedNs.has(nsFromKey)) {
                        triedNs.add(nsFromKey);
                        const nsBundle = i18n.getResourceBundle?.(normalizedLocale, nsFromKey) || {};
                        if (Object.keys(nsBundle).length > 0) {
                            const result = lookupInBundle(nsBundle, keyParts);
                            if (result !== null) {
                                Logger.debug(`[i18n] Gefunden via Key-Prefix-Namespace '${nsFromKey}':`, result);
                                return result;
                            }
                        }
                    }
                }

                // 3. Alle geladenen Namespaces durchsuchen (Fallback für Seiten ohne pluginName-Kontext)
                const storeData = i18n.i18next?.store?.data?.[normalizedLocale] || {};
                for (const [ns, bundle] of Object.entries(storeData)) {
                    if (triedNs.has(ns)) continue;
                    triedNs.add(ns);
                    const result = lookupInBundle(bundle, keyParts);
                    if (result !== null) {
                        Logger.debug(`[i18n] Gefunden in Namespace '${ns}':`, result);
                        return result;
                    }
                }

                // 4. Letzter Fallback: Key selbst zurückgeben
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

        // Basis-URL: SiteConfig liefert gecachten Wert; dynamischer Request-Fallback wenn nicht konfiguriert
        const dynamicBaseUrl = `${req.protocol}://${req.get('host')}`;
        const dashboardUrl = siteConfig?.get('DASHBOARD_URL') || dynamicBaseUrl;

        // Benutzer- und Guild-Daten für Templates
        // IMMER .info verwenden, damit isOwner/hasSystemAccess korrekt gesetzt ist!
        res.locals.user = req.session?.user?.info || null;

        // System-Zugriff für Templates vorberechnen (async, non-blocking)
        if (res.locals.user && !res.locals.user.isOwner) {
            try {
                const permissionManager = ServiceManager.get('permissionManager');
                if (permissionManager) {
                    const hasSystemAccess = await permissionManager.hasSystemPermission(res.locals.user.id, 'SYSTEM.ACCESS');
                    res.locals.user.hasSystemAccess = hasSystemAccess;
                }
            } catch (_) {
                res.locals.user.hasSystemAccess = false;
            }
        } else if (res.locals.user) {
            res.locals.user.hasSystemAccess = res.locals.user.isOwner === true;
        }

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

        const isAdminRoute = req.path.startsWith('/admin');

        // Auf Guild-Routen: lastGuildId in Session speichern (für Admin-Sidebar)
        if (isGuildRoute && guildId && req.session?.user) {
            req.session.lastGuildId = guildId;
        }

        // Auf Admin-Routen: lastGuildId aus Session für guildNav verwenden
        const navGuildId = (isAdminRoute && !guildId && req.session?.lastGuildId)
            ? req.session.lastGuildId
            : guildId;

        // Navigation laden wenn Guild-Route ODER Admin-Route mit bekannter lastGuildId
        if ((isGuildRoute || isAdminRoute) && navGuildId && !isAssetRoute) {
            try {
                const navigationManager = ServiceManager.get('navigationManager');
                const userId = res.locals.user?.id || null;
                const mainMenu = await navigationManager.getMainMenuWithSubmenu(navGuildId, userId);

                res.locals.guildNav = mainMenu;
                // Auch guildId für Brand-URL in Sidebar setzen (falls noch nicht gesetzt)
                if (isAdminRoute && !res.locals.guildId) {
                    res.locals.guildId = navGuildId;
                }

                Logger.debug('[Navigation] Navigation für Template bereitgestellt:', {
                    itemCount: mainMenu?.length || 0,
                    userId: userId || 'anonymous',
                    permissionFiltered: !!userId,
                    source: isAdminRoute ? 'lastGuildId' : 'guildId'
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

        // Statische Site-Informationen aus SiteConfig (einmalig gecacht, kein process.env pro Request)
        if (siteConfig) {
            Object.assign(res.locals, siteConfig.toLocals(dashboardUrl));
        } else {
            // Fallback falls SiteConfig noch nicht registriert
            res.locals.siteName = process.env.SITE_NAME || 'DuneBot';
            res.locals.dashboard_version = process.env.DASHBOARD_VERSION || '0.1.0-beta';
            res.locals.dashboardVersion = res.locals.dashboard_version;
            res.locals.bot_version = process.env.BOT_VERSION || '0.1.0-beta';
            res.locals.botVersion = res.locals.bot_version;
            res.locals.environment = process.env.NODE_ENV || 'development';
            res.locals.year = new Date().getFullYear();
        }

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
        res.locals.cacheBuster = siteConfig?.get('NODE_ENV') === 'production'
            ? (pluginManager?.getPlugin?.('core')?.version || '1.0.0')
            : Date.now();

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
                const isAdminRoute2 = req.path.startsWith('/admin');
                Logger.debug(`[Navigation] Request-Info:`, {
                    path: req.path,
                    isGuildRoute,
                    guildId
                });

                // Auf Admin-Routen: lastGuildId aus Session nutzen
                const navGuildId2 = (isAdminRoute2 && !guildId && req.session?.lastGuildId)
                    ? req.session.lastGuildId
                    : guildId;

                // Navigation für Guild- und Admin-Routen laden
                if ((isGuildRoute || isAdminRoute2) && navGuildId2) {
                    Logger.debug(`[Navigation] Starte Navigation-Load für Guild ${navGuildId2}`);

                    // DIREKTE DB-ABFRAGE zur Prüfung
                    const testQuery = await dbService.query(
                        "SELECT * FROM guild_nav_items WHERE guildid = ? AND (type = 'main' OR type = 'widget') AND visible = 1",
                        [navGuildId2]
                    );

                    // Navigation laden (MIT Permission-Filterung!)
                    const userId = res.locals.user?.id || null;
                    const mainMenu = await navManager.getMainMenuWithSubmenu(navGuildId2, userId);

                    if (!mainMenu || mainMenu.length === 0) {
                        Logger.warn(`[Navigation] Keine Navigation geladen für Guild ${navGuildId2}`);
                        // Versuche Core Plugin zu aktivieren (nur auf Guild-Routen)
                        if (isGuildRoute) {
                            try {
                                const corePlugin = pluginManager.getPlugin('core');
                                if (corePlugin?.onGuildEnable) {
                                    await corePlugin.onGuildEnable(navGuildId2);
                                    Logger.debug('[Navigation] Core Plugin aktiviert, lade Navigation neu...');
                                    const refreshedMenu = await navManager.getMainMenuWithSubmenu(navGuildId2, userId);
                                    res.locals.guildNav = refreshedMenu || [];
                                }
                            } catch (err) {
                                Logger.error('[Navigation] Core Plugin Aktivierung fehlgeschlagen:', err);
                            }
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
            res.on('close', () => themeManager.clearCurrentLocals?.());
        }

        if (themeManager) {
            await themeManager.loadGlobalNotifications(req, res);
            // Map globalNotifications zu notifications für Template-Kompatibilität
            if (res.locals.globalNotifications && Array.isArray(res.locals.globalNotifications)) {
                res.locals.notifications = res.locals.globalNotifications;
            }
        }

        // Aktives Theme per Guild ermitteln und in Request/Response bereitstellen
        if (themeManager) {
            const activeThemeName = await themeManager.getThemeForRequest(req, res);
            req.activeTheme = activeThemeName;
            res.locals.activeTheme = activeThemeName;

            // Helper: Theme-aware Asset-URL (Child → Parent → default)
            res.locals.resolveAssetUrl = (assetPath) => themeManager.resolveAssetUrl(assetPath);
        }

        next();
    } catch (error) {
        Logger.error("Error in base middleware:", error);
        next(error);
    }
};