const { ServiceManager } = require("dunebot-core");
/**
 * Frontend Controller
 * Steuert die öffentlich zugänglichen Seiten des Dashboards
 * 
 * @author firedervil
 */

const { NewsHelper } = require('dunebot-sdk/utils');

/**
 * Controller für Frontend-Routen
 * Verarbeitet Anfragen für die öffentliche Website
 * 
 * @author FireDervil
 */

module.exports.getIndex = async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');

    try {
        // Frontend-Layout verwenden
        res.locals.layout = themeManager.getLayout('frontend');
        
        // User-Locale einmal bestimmen
        const userLocale = req.session?.locale || res.locals?.locale || 'de-DE';
        
        // News aus der Datenbank laden
        let newsList = [];
        try {
            const rawNews = await dbService.query(
                "SELECT * FROM news WHERE status = 'published' ORDER BY created_at DESC LIMIT 6"
            );
            
            // News lokalisieren basierend auf User-Locale
            newsList = NewsHelper.getLocalizedNewsList(rawNews, userLocale);
        } catch (err) {
            Logger.error("Fehler beim Laden der News:", err);
        }

        // Changelogs aus der Datenbank laden
        let changelogsList = [];
        try {
            const rawChangelogs = await dbService.query(
                "SELECT * FROM changelogs WHERE is_public = 1 ORDER BY release_date DESC LIMIT 3"
            );
            
            // Changelogs lokalisieren
            const { ChangelogHelper } = require('dunebot-sdk/utils');
            changelogsList = ChangelogHelper.getLocalizedChangelogList(rawChangelogs, userLocale);
        } catch (err) {
            Logger.error("Fehler beim Laden der Changelogs:", err);
        }

        // Datumsformat lokalisieren
        const localizedNewsList = newsList.map(news => {
            // news ist bereits ein Plain-Objekt!
            return {
                ...news,
                formattedDate: news.date
                    ? new Date(news.date).toLocaleString(userLocale, {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        }
                    )
                    : ''
            };
        });

                // Changelogs Datumsformat lokalisieren
        const localizedChangelogsList = changelogsList.map(changelog => {
            return {
                ...changelog,
                formattedDate: changelog.release_date 
                    ? new Date(changelog.release_date).toLocaleString(userLocale, {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    })
                    : ''
            };
        });
        
        // Plugins aus Registry und package.json laden
        let pluginsList = [];
        try {
            const fs = require('fs');
            const path = require('path');
            const pluginsDir = path.join(__dirname, '../../../plugins');
            
            // Nur öffentliche Plugins (nicht superadmin)
            const pluginFolders = fs.readdirSync(pluginsDir)
                .filter(folder => {
                    const pluginPath = path.join(pluginsDir, folder);
                    return fs.statSync(pluginPath).isDirectory() && 
                           fs.existsSync(path.join(pluginPath, 'package.json')) &&
                           folder !== 'superadmin'; // Superadmin ausschließen
                });
            
            pluginsList = pluginFolders.map(folder => {
                try {
                    // fs.readFileSync + JSON.parse statt require() (Pfad-Problem)
                    const packagePath = path.join(pluginsDir, folder, 'package.json');
                    const packageData = fs.readFileSync(packagePath, 'utf8');
                    const packageJson = JSON.parse(packageData);
                    
                    return {
                        name: packageJson.name || folder,
                        displayName: packageJson.displayName || packageJson.name || folder,
                        description: packageJson.description || 'Keine Beschreibung verfügbar',
                        version: packageJson.version || '1.0.0',
                        author: packageJson.author || 'FireDervil',
                        icon: this._getPluginIcon(folder) // Icon basierend auf Plugin-Name
                    };
                } catch (err) {
                    Logger.warn(`Konnte package.json für Plugin ${folder} nicht laden:`, err);
                    return null;
                }
            }).filter(Boolean); // null-Werte entfernen
            
            Logger.debug(`Plugins für Carousel geladen: ${pluginsList.length}`);
        } catch (err) {
            Logger.error("Fehler beim Laden der Plugins:", err);
        }
        
        // Template rendern
        res.render("frontend/index", {
            title: "Willkommen bei DuneBot",
            user: req.session?.user || null,
            newsList: localizedNewsList,
            changelogsList: localizedChangelogsList,
            pluginsList: pluginsList
        });
    } catch (error) {
        Logger.error("Fehler beim Rendern der Landing Page:", error);
        res.status(500).render("error", {
            message: "Ein Fehler ist aufgetreten.",
            error
        });
    }
};

/**
 * Changelogs anzeigen
 * @author firedervil
 * @param {import('express').Request} req - Express Request Objekt
 * @param {import('express').Response} res - Express Response Objekt
 * @returns {Promise<void>}
 */
exports.getChangelog = async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');

    try {
        // Frontend-Layout verwenden
        res.locals.layout = themeManager.getLayout('frontend');

        // Changelogs aus der Datenbank laden
        let changelogs = [];
        try {
            changelogs = await dbService.query(`
                SELECT *,
                       CASE type 
                           WHEN 'major' THEN 1
                           WHEN 'minor' THEN 2 
                           WHEN 'patch' THEN 3
                           WHEN 'hotfix' THEN 4
                           ELSE 5 
                       END AS type_order
                FROM changelogs 
                WHERE is_public = TRUE
                ORDER BY release_date DESC, type_order ASC
                LIMIT 20
            `);

            // JSON-Felder parsen
            changelogs = changelogs.map(log => ({
                ...log,
                changes: typeof log.changes === 'string' ? JSON.parse(log.changes) : log.changes
            }));
        } catch (err) {
            Logger.error("Fehler beim Laden der Changelogs:", err);
        }

        // Template rendern
        res.render("frontend/changelog", {
            title: "DuneBot Changelogs",
            user: req.session?.user || null,
            changelogs
        });
    } catch (error) {
        Logger.error("Fehler beim Rendern der Changelog-Seite:", error);
        res.status(500).render("error", {
            message: "Ein Fehler ist aufgetreten.",
            error
        });
    }
};

/**
 * Datenschutz-Seite anzeigen
 * @param {Object} req - Express Request
 * @param {Object} res - Express Response
 */
exports.privacy = async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');

    try {
        res.locals.layout = themeManager?.getLayout('frontend');
        
        res.render("frontend/privacy", {
            title: "Datenschutz - DuneBot",
            user: req.session.user || null,
            privacyContent: await getPrivacyContent(req.app)
        });
    } catch (error) {
        Logger.error('Fehler beim Rendern der Datenschutz-Seite:', error);
        res.status(500).render("error", { message: "Ein Fehler ist aufgetreten." });
    }
};

/**
 * AGB-Seite anzeigen
 * @param {Object} req - Express Request
 * @param {Object} res - Express Response
 */
exports.tos = async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');

    try {
        res.locals.layout = themeManager?.getLayout('frontend');
        
        res.render("frontend/tos", {
            title: "Terms of Service - DuneBot",
            user: req.session.user || null,
            termsContent: await getTermsContent(req.app)
        });
    } catch (error) {
        Logger.error('Fehler beim Rendern der Terms of Service-Seite:', error);
        res.status(500).render("error", { message: "Ein Fehler ist aufgetreten." });
    }
};

// Helper-Funktionen

/**
 * Helper-Funktion: Plugin-Icon basierend auf Plugin-Namen zuweisen
 * @private
 * @param {string} pluginName - Name des Plugins
 * @returns {string} FontAwesome Icon-Klasse
 */
module.exports._getPluginIcon = function(pluginName) {
    const iconMap = {
        'core': 'fa-solid fa-gear',
        'automod': 'fa-solid fa-shield-halved',
        'moderation': 'fa-solid fa-gavel',
        'dunemap': 'fa-solid fa-map',
        'greeting': 'fa-solid fa-hand-wave',
        'information': 'fa-solid fa-circle-info',
        'ticket': 'fa-solid fa-ticket',
        'economy': 'fa-solid fa-coins',
        'giveaway': 'fa-solid fa-gift',
        'statistik': 'fa-solid fa-chart-line'
    };
    
    return iconMap[pluginName] || 'fa-solid fa-puzzle-piece';
};

/**
 * News aus der Datenbank laden und lokalisieren
 * @private
 * @param {Object} req - Express Request
 * @returns {Promise<Array>} Liste der News-Einträge
 */
async function loadNews(req) {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        // News aus der Datenbank laden
        const newsList = await dbService.query(
            "SELECT * FROM news ORDER BY created_at DESC LIMIT 6"
        );
        
        // News lokalisieren (Datumsformat anpassen)
        const localizedNewsList = newsList.map(news => {
            const newsData = news.get({ plain: true });
            newsData.date = new Date(newsData.date).toLocaleString(
                req.session.locale || 'de-DE',
                { 
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                }
            );
            return newsData;
        });
        
        return localizedNewsList;
    } catch (error) {
        Logger.error('Fehler beim Laden der News:', error);
        return []; // Leere Liste zurückgeben, wenn ein Fehler auftritt
    }
}

/**
 * Datenschutz-Text laden
 * @private
 * @param {Object} app - Express App
 * @returns {Promise<string>} Datenschutz-Text
 */
async function getPrivacyContent(app) {
    // Implementierung für Datenschutz
    return '';
}

/**
 * AGB-Text laden
 * @private
 * @param {Object} app - Express App
 * @returns {Promise<string>} AGB-Text
 */
async function getTermsContent(app) {
    // Implementierung für AGB
    return '';
}