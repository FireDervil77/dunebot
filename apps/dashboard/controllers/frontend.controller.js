const { ServiceManager } = require("dunebot-core");
/**
 * Frontend Controller
 * Steuert die öffentlich zugänglichen Seiten des Dashboards
 * 
 * @author firedervil
 */

/**
 * Landing Page anzeigen
 * @author firedervil
 * @param {import('express').Request} req - Express Request Objekt
 * @param {import('express').Response} res - Express Response Objekt
 * @returns {Promise<void>}
 */
exports.getIndex = async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');

    try {
        // Frontend-Layout verwenden
        res.locals.layout = themeManager.getLayout('frontend');
        
        // News aus der Datenbank laden
        let newsList = [];
        try {
            newsList = await dbService.query(
                "SELECT * FROM news ORDER BY created_at DESC LIMIT 6"
            );
        } catch (err) {
            Logger.error("Fehler beim Laden der News:", err);
        }

        // Datumsformat lokalisieren
        const localizedNewsList = newsList.map(news => {
            // news ist bereits ein Plain-Objekt!
            return {
                ...news,
                date: news.date
                    ? new Date(news.date).toLocaleString(
                        req.session.locale || 'de-DE',
                        {
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
        
        // Template rendern
        res.render("frontend/index", {
            title: "Willkommen bei DuneBot",
            user: req.session?.user || null,
            newsList: localizedNewsList
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