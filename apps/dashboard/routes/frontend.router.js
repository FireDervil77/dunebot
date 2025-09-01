const express = require("express");
const router = express.Router();

// Controller & Manager
const frontendController = require("../controllers/frontend.controller");
const { ServiceManager } = require("dunebot-core");

// Basis-Routen
router.get("/", frontendController.getIndex);

router.get('/news-details/:slug', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        // News mit korrekten Feldern aus der DB holen
        const news = await dbService.query(`
            SELECT 
                _id,
                title,
                slug,
                author,
                news_text,
                excerpt,
                image_url,
                date,
                status,
                created_at,
                updated_at
            FROM news 
            WHERE slug = ?
            AND status = 'published'
        `, [req.params.slug]);

        if (!news || news.length === 0) {
            return res.status(404).render('frontend/404');
        }

        // Layout setzen
        res.locals.layout = ServiceManager.get('themeManager').getLayout('frontend');
        
        // News-Objekt an Template übergeben
        res.render('frontend/news-details', { 
            news: {
                ...news[0],
                // Datum formatieren
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
});


router.get("/privacy", frontendController.privacy);
router.get("/tos", frontendController.tos);

module.exports = router;