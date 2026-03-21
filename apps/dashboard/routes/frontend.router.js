const express = require("express");
const { ServiceManager } = require("dunebot-core");
const frontendController = require("../controllers/frontend.controller");
const apiController = require("../controllers/api.controller");
const { NewsHelper } = require("dunebot-sdk/utils");
const { ChangelogHelper } = require("dunebot-sdk/utils");

// Router erstellen
const router = express.Router();

// ── Middleware: Menu + Footer + Layout für alle Frontend-Seiten laden ──
router.use(async (req, res, next) => {
    try {
        const FrontendMenu = require('dunebot-db-client/models/FrontendMenu');
        const FrontendFooter = require('dunebot-db-client/models/FrontendFooter');
        const themeManager = ServiceManager.get('themeManager');
        const [menuItems, footerColumns] = await Promise.all([
            FrontendMenu.getVisibleTree(),
            FrontendFooter.getVisibleColumnsWithLinks()
        ]);
        res.locals.menuItems = menuItems;
        res.locals.footerColumns = footerColumns;
        // Layout global für alle Frontend-Routes setzen (inkl. 404/500)
        res.locals.layout = themeManager.getLayout('frontend');
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

// ── Dokumentation: /docs und /docs/:path(*) ──
const docsPath = require('path');
const docsFs = require('fs').promises;
const { marked } = require('marked');

const DOCS_ROOT = docsPath.resolve(__dirname, '..', '..', '..', 'documentation');

/**
 * Sicherer Pfad-Check (verhindert Path-Traversal)
 */
function safeDocsPath(relativePath) {
    if (!relativePath) return null;
    const cleaned = docsPath.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
    const absolute = docsPath.resolve(DOCS_ROOT, cleaned);
    if (!absolute.startsWith(DOCS_ROOT)) return null;
    return absolute;
}

/**
 * Rekursiver Dateibaum für Sidebar-Navigation
 */
async function buildDocsNav(dirPath, basePath = '') {
    try {
        const entries = await docsFs.readdir(dirPath, { withFileTypes: true });
        const items = [];
        for (const entry of entries) {
            const rel = docsPath.join(basePath, entry.name);
            if (entry.isDirectory()) {
                const children = await buildDocsNav(docsPath.join(dirPath, entry.name), rel);
                if (children.length > 0) {
                    items.push({ name: entry.name, path: rel, type: 'folder', children });
                }
            } else if (entry.name.endsWith('.md')) {
                items.push({
                    name: entry.name.replace(/\.md$/, ''),
                    path: rel.replace(/\.md$/, ''),
                    type: 'file'
                });
            }
        }
        items.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        return items;
    } catch {
        return [];
    }
}

router.get('/docs', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');

    try {
        const indexPath = docsPath.join(DOCS_ROOT, 'index.md');
        let content = '';
        try { content = await docsFs.readFile(indexPath, 'utf-8'); } catch {}
        const htmlContent = marked(content);
        const nav = await buildDocsNav(DOCS_ROOT);

        res.locals.layout = themeManager.getLayout('frontend');
        res.render('frontend/documentation', {
            title: 'Dokumentation',
            docTitle: 'Dokumentation',
            htmlContent,
            nav,
            currentPath: ''
        });
    } catch (err) {
        Logger.error('[Frontend/Docs] Fehler:', err);
        res.status(500).render('frontend/500');
    }
});

router.get('/docs/{*docPath}', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    const requestedPath = Array.isArray(req.params.docPath)
        ? req.params.docPath.join('/')
        : req.params.docPath;

    // .md-Endung an angefragten Pfad
    let mdPath = requestedPath;
    if (!mdPath.endsWith('.md')) mdPath += '.md';

    const absolute = safeDocsPath(mdPath);
    if (!absolute) {
        return res.status(400).render('frontend/404');
    }

    try {
        let content;
        try {
            content = await docsFs.readFile(absolute, 'utf-8');
        } catch (e) {
            if (e.code === 'ENOENT') {
                // Versuche als Ordner → index.md
                const folderIndex = safeDocsPath(docsPath.join(requestedPath, 'index.md'));
                if (folderIndex) {
                    try {
                        content = await docsFs.readFile(folderIndex, 'utf-8');
                    } catch { /* ignore */ }
                }
            }
            if (!content) return res.status(404).render('frontend/404');
        }

        const htmlContent = marked(content);
        const nav = await buildDocsNav(DOCS_ROOT);

        // Titel aus erstem H1 extrahieren oder Dateiname
        const titleMatch = content.match(/^#\s+(.+)$/m);
        const docTitle = titleMatch ? titleMatch[1] : requestedPath.split('/').pop();

        res.locals.layout = themeManager.getLayout('frontend');
        res.render('frontend/documentation', {
            title: docTitle + ' — Dokumentation',
            docTitle,
            htmlContent,
            nav,
            currentPath: requestedPath
        });
    } catch (err) {
        Logger.error('[Frontend/Docs] Fehler:', err);
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