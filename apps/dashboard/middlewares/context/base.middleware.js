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

        // Guild-Informationen extrahieren und als Fallback leere Objekte bereitstellen
        const guildId = req.params?.guildId || '';
        
        // Stelle sicher, dass Guild-Daten immer verfügbar sind (auch wenn leer)
        res.locals.guild = res.locals.guild || { name: '', id: guildId };
        res.locals.guildId = guildId;
        
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
        res.locals.serverNav = [];  // Wichtig für die Sidebar!
        res.locals.adminNav = [];   // Wichtig für die Sidebar!
        res.locals.frontendNav = [];
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
        if (themeManager) {
            try {
                // Guild-Navigation
                res.locals.guildNav = themeManager.getNavigation?.('guild') || [];
                // Frontend-Navigation
                res.locals.frontendNav = themeManager.getNavigation?.('frontend') || [];
                // Plugin-Navigationen dynamisch sammeln
                const pluginAreas = Object.keys(themeManager.navigationCache || {}).filter(a => a.startsWith('plugin-'));
                res.locals.pluginNavs = pluginAreas.map(area => ({
                    key: area,
                    title: `Plugin: ${area.replace('plugin-', '')}`,
                    nav: themeManager.getNavigation(area)
                }));
            } catch (e) {
                Logger.warn("Fehler beim Laden der Navigation:", e);
                res.locals.guildNav = [];
                res.locals.frontendNav = [];
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