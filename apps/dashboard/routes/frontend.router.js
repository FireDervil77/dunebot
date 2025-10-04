const express = require("express");
const { ServiceManager } = require("dunebot-core");
const frontendController = require("../controllers/frontend.controller");

// Router erstellen
const router = express.Router();

// News-Details Handler
const getNewsDetails = async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const Logger = ServiceManager.get('Logger');

    try {
        const news = await dbService.query(`
            SELECT 
                _id, title, slug, author, news_text,
                excerpt, image_url, date, status,
                created_at, updated_at
            FROM news 
            WHERE slug = ? AND status = 'published'
        `, [req.params.slug]);

        if (!news?.length) {
            return res.status(404).render('frontend/404');
        }

        // Layout setzen
        const themeManager = ServiceManager.get("themeManager");
        res.locals.layout = themeManager.getLayout('frontend');
        
        res.render('frontend/news-details', {
            news: {
                ...news[0],
                date: new Date(news[0].date).toLocaleString(
                    req.session.locale || 'de-DE',
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

module.exports = router;