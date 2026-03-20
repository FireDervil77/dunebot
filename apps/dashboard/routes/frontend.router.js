const express = require("express");
const { ServiceManager } = require("dunebot-core");
const frontendController = require("../controllers/frontend.controller");
const apiController = require("../controllers/api.controller");
const { NewsHelper } = require("dunebot-sdk/utils");
const { ChangelogHelper } = require("dunebot-sdk/utils");

// Router erstellen
const router = express.Router();

// ── Middleware: Menu + Footer Daten für alle Frontend-Seiten laden ──
router.use(async (req, res, next) => {
    try {
        const FrontendMenu = require('dunebot-db-client/models/FrontendMenu');
        const FrontendFooter = require('dunebot-db-client/models/FrontendFooter');
        const [menuItems, footerColumns] = await Promise.all([
            FrontendMenu.getVisibleTree(),
            FrontendFooter.getVisibleColumnsWithLinks()
        ]);
        res.locals.menuItems = menuItems;
        res.locals.footerColumns = footerColumns;
    } catch (err) {
        // Tabellen existieren evtl. noch nicht — Fallback auf leere Arrays
        res.locals.menuItems = [];
        res.locals.footerColumns = [];
    }
    next();
});

// News-Details Handler
const getNewsDetails = async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get("themeManager");

    try {
        const rawNews = await dbService.query(`
            SELECT * FROM news 
            WHERE slug = ? AND status = 'published'
        `, [req.params.slug]);

        if (!rawNews?.length) {
            return res.status(404).render('frontend/404');
        }

        // News lokalisieren (nutze res.locals.locale statt Session-Zugriff)
        const userLocale = res.locals.locale || 'de-DE';
        const localizedNews = NewsHelper.getLocalizedNews(rawNews[0], userLocale);

        // Layout setzen
        res.locals.layout = themeManager.getLayout('frontend');
        
        res.render('frontend/news-details', {
            news: {
                ...localizedNews,
                formattedDate: new Date(localizedNews.date).toLocaleString(
                    userLocale,
                    {
                        year: 'numeric',
                        month: 'long', 
                        day: 'numeric'
                    }
                )
            }
        });
    } catch (err) {
        Logger.error('Fehler beim Laden der News-Details:', err);
        res.status(500).render('frontend/500');
    }
};

// Changelogs Overview Handler
const getChangelogsList = async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get("themeManager");

    try {
        const rawChangelogs = await dbService.query(`
            SELECT * FROM changelogs 
            WHERE is_public = 1
            ORDER BY release_date DESC
        `);

        // Changelogs lokalisieren (nutze res.locals.locale statt Session-Zugriff)
        const userLocale = res.locals.locale || 'de-DE';
        const localizedChangelogs = rawChangelogs.map(cl => ChangelogHelper.getLocalizedChangelog(cl, userLocale));

        // Layout setzen
        res.locals.layout = themeManager.getLayout('frontend');
        
        res.render('frontend/changelogs', {
            changelogs: localizedChangelogs,
            currentLocale: userLocale
        });
    } catch (err) {
        Logger.error('Fehler beim Laden der Changelogs:', err);
        res.status(500).render('frontend/500');
    }
};

// Changelog-Details Handler
const getChangelogDetails = async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get("themeManager");

    try {
        const rawChangelog = await dbService.query(`
            SELECT * FROM changelogs 
            WHERE version = ?
        `, [req.params.version]);

        if (!rawChangelog?.length) {
            return res.status(404).render('frontend/404');
        }

        // Changelog lokalisieren (nutze res.locals.locale statt Session-Zugriff)
        const userLocale = res.locals.locale || 'de-DE';
        const localizedChangelog = ChangelogHelper.getLocalizedChangelog(rawChangelog[0], userLocale);

        // Parse hierarchische Struktur aus changes-Text
        const hierarchicalData = ChangelogHelper.parseHierarchicalChangelog(localizedChangelog.changes);

        // Layout setzen
        res.locals.layout = themeManager.getLayout('frontend');
        
        res.render('frontend/changelog-details', {
            changelog: localizedChangelog,
            hierarchicalData: hierarchicalData,
            currentLocale: userLocale
        });
    } catch (err) {
        Logger.error('Fehler beim Laden der Changelog-Details:', err);
        res.status(500).render('frontend/500');
    }
};

// Routen-Konfiguration definieren
const routeConfig = {
    base: {
        path: '/',
        handler: frontendController.getIndex,
        navigation: {
            section: 'frontend',
            item: {
                title: 'Home',
                icon: 'fa-home',
                order: 10
            }
        }
    },
    news: {
        path: '/news-details/:slug',
        handler: getNewsDetails,
        navigation: {
            section: 'frontend',
            item: {
                title: 'News',
                icon: 'fa-newspaper',
                order: 20
            }
        }
    },
    privacy: {
        path: '/privacy', 
        handler: frontendController.privacy,
        navigation: {
            section: 'footer',
            item: {
                title: 'Datenschutz',
                order: 30
            }
        }
    },
    tos: {
        path: '/tos', 
        handler: frontendController.tos,
        navigation: {
            section: 'footer',
            item: {
                title: 'Terms of Service',
                order: 40
            }
        }
    }
};

// Routen auf dem Router registrieren
router.get('/', frontendController.getIndex);
router.get('/news-details/:slug', getNewsDetails);
router.get('/changelogs', getChangelogsList);
router.get('/changelogs/:version', getChangelogDetails);
router.get('/privacy', frontendController.privacy);
router.get('/tos', frontendController.tos);

// ── CMS-Seiten: /page/:slug ──
router.get('/page/:slug', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');

    try {
        const FrontendPage = require('dunebot-db-client/models/FrontendPage');
        const page = await FrontendPage.getBySlug(req.params.slug);

        if (!page) {
            return res.status(404).render('frontend/404');
        }

        res.locals.layout = themeManager.getLayout('frontend');

        res.render('frontend/page', {
            page,
            title: page.meta_title || page.title,
            metaDescription: page.meta_description || ''
        });
    } catch (err) {
        Logger.error('[Frontend/Page] Fehler beim Laden:', err);
        res.status(500).render('frontend/500');
    }
});

/**
 * Spracheinstellung für Gäste (ohne Authentifizierung)
 * @route POST /language/guest
 * @author firedervil
 */
router.post('/language/guest', apiController.updateGuestLanguage);

module.exports = router;