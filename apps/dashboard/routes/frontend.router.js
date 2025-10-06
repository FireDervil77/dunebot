const express = require("express");
const { ServiceManager } = require("dunebot-core");
const frontendController = require("../controllers/frontend.controller");
const apiController = require("../controllers/api.controller");
const { getLocalizedNews } = require("../helpers/newsHelper");

// Router erstellen
const router = express.Router();

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

        // News lokalisieren
        const userLocale = req.session.locale || res.locals.locale || 'de-DE';
        const localizedNews = getLocalizedNews(rawNews[0], userLocale);

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
router.get('/privacy', frontendController.privacy);
router.get('/tos', frontendController.tos);

/**
 * Spracheinstellung für Gäste (ohne Authentifizierung)
 * @route POST /language/guest
 * @author firedervil
 */
router.post('/language/guest', apiController.updateGuestLanguage);

module.exports = router;