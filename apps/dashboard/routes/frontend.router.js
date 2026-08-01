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

    // Einwilligung + Tag Manager für das Layout bereitstellen.
    // Eigenes try: Ein Fehler hier darf die Seite nicht kosten – er führt dann
    // dazu, dass nichts eingebunden wird, und das ist die sichere Richtung.
    try {
        res.locals.consent = await ladeConsentKontext(req);
    } catch (_) {
        res.locals.consent = null;
    }

    next();
});

/**
 * Baut den Kontext, den `partials/frontend/consent.ejs` braucht.
 *
 * Die gespeicherte Auswahl kommt aus dem Cookie – sie muss serverseitig gelesen
 * werden, damit das `consent`-Update im selben Seitenaufbau mitgeht. Würde man
 * erst im Browser nachsehen, liefe GTM einen Wimpernschlag ohne Einwilligung.
 *
 * @param {object} req
 * @returns {Promise<object|null>}
 */
async function ladeConsentKontext(req) {
    const AnalyticsConsent = require('../helpers/AnalyticsConsent');
    const dbService = ServiceManager.get('dbService');

    const einstellungen = await AnalyticsConsent.ladeEinstellungen(dbService);
    if (!AnalyticsConsent.istAktiv(einstellungen)) return null;

    let auswahl = null;
    const roh = req.cookies?.[AnalyticsConsent.COOKIE_NAME];
    if (roh) {
        try {
            const gespeichert = JSON.parse(roh);
            const gewaehlt = AnalyticsConsent.bereinigeAuswahl(gespeichert.gewaehlt, einstellungen.kategorien);
            auswahl = {
                gewaehlt,
                version: Number(gespeichert.version) || 0,
                signale: AnalyticsConsent.signaleFuer(gewaehlt),
            };
        } catch (_) {
            // Unlesbares Cookie zählt als "nicht gefragt" – dann erscheint das Banner.
        }
    }

    return {
        aktiv:      true,
        gtmId:      einstellungen.gtmId,
        version:    einstellungen.version,
        kategorien: einstellungen.kategorien,
        cookieName: AnalyticsConsent.COOKIE_NAME,
        auswahl,
    };
}

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

        await themeManager.renderView(res, 'frontend/news-details', {
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
        // Die Beschreibung ist HTML (WYSIWYG). In der Kachel wird daraus ein
        // Reintext-Auszug - sonst steht dort entweder ein <h1>, das die Karte
        // sprengt, oder das escapte Markup als lesbarer Text.
        const localizedChangelogs = rawChangelogs.map(cl => {
            const localized = ChangelogHelper.getLocalizedChangelog(cl, userLocale);
            return { ...localized, excerpt: ChangelogHelper.zuTextauszug(localized.description) };
        });

        await themeManager.renderView(res, 'frontend/changelogs', {
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
        // "v" Prefix entfernen falls vorhanden (URL: /changelogs/v1.0.0 → DB: 1.0.0)
        const version = req.params.version.replace(/^v/i, '');

        const rawChangelog = await dbService.query(`
            SELECT * FROM changelogs 
            WHERE version = ?
        `, [version]);

        if (!rawChangelog?.length) {
            return res.status(404).render('frontend/404');
        }

        // Changelog lokalisieren (nutze res.locals.locale statt Session-Zugriff)
        const userLocale = res.locals.locale || 'de-DE';
        const localizedChangelog = ChangelogHelper.getLocalizedChangelog(rawChangelog[0], userLocale);

        // Parse hierarchische Struktur aus changes-Text
        const hierarchicalData = ChangelogHelper.parseHierarchicalChangelog(localizedChangelog.changes);

        await themeManager.renderView(res, 'frontend/changelog-details', {
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

// ── Blog: /blog und /blog/:slug ──
router.get('/blog', async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');

    try {
        const userLocale = res.locals.locale || 'de-DE';
        const category = req.query.category || null;

        let query = "SELECT * FROM blog_posts WHERE status = 'published' ORDER BY published_at DESC";
        let params = [];
        if (category) {
            query = "SELECT * FROM blog_posts WHERE status = 'published' AND category = ? ORDER BY published_at DESC";
            params = [category];
        }

        const rawPosts = await dbService.query(query, params);
        const blogPosts = rawPosts.map(p => {
            const titles = typeof p.title_translations === 'string' ? JSON.parse(p.title_translations) : (p.title_translations || {});
            const excerpts = typeof p.excerpt_translations === 'string' ? JSON.parse(p.excerpt_translations) : (p.excerpt_translations || {});
            return {
                ...p,
                title: titles[userLocale] || titles['de-DE'] || '',
                excerpt: excerpts[userLocale] || excerpts['de-DE'] || '',
                formattedDate: p.published_at
                    ? new Date(p.published_at).toLocaleString(userLocale, { year: 'numeric', month: 'long', day: 'numeric' })
                    : '—'
            };
        });

        res.locals.layout = themeManager.getLayout('frontend');
        await themeManager.renderView(res, 'frontend/blog', {
            blogPosts,
            currentCategory: category,
            currentLocale: userLocale,
            title: 'Blog'
        });
    } catch (err) {
        Logger.error('[Frontend/Blog] Fehler:', err);
        res.status(500).render('frontend/500');
    }
});

router.get('/blog/:slug', async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');

    try {
        const [rawPost] = await dbService.query(
            "SELECT * FROM blog_posts WHERE slug = ? AND status = 'published'",
            [req.params.slug]
        );

        if (!rawPost) {
            return res.status(404).render('frontend/404');
        }

        const userLocale = res.locals.locale || 'de-DE';
        const titles = typeof rawPost.title_translations === 'string' ? JSON.parse(rawPost.title_translations) : (rawPost.title_translations || {});
        const contents = typeof rawPost.content_translations === 'string' ? JSON.parse(rawPost.content_translations) : (rawPost.content_translations || {});
        const excerpts = typeof rawPost.excerpt_translations === 'string' ? JSON.parse(rawPost.excerpt_translations) : (rawPost.excerpt_translations || {});

        const post = {
            ...rawPost,
            title: titles[userLocale] || titles['de-DE'] || '',
            content: contents[userLocale] || contents['de-DE'] || '',
            excerpt: excerpts[userLocale] || excerpts['de-DE'] || '',
            formattedDate: rawPost.published_at
                ? new Date(rawPost.published_at).toLocaleString(userLocale, { year: 'numeric', month: 'long', day: 'numeric' })
                : '—'
        };

        res.locals.layout = themeManager.getLayout('frontend');
        await themeManager.renderView(res, 'frontend/blog-detail', {
            post,
            title: post.title,
            currentLocale: userLocale
        });
    } catch (err) {
        Logger.error('[Frontend/Blog] Fehler:', err);
        res.status(500).render('frontend/500');
    }
});

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

        await themeManager.renderView(res, 'frontend/page', {
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
        await themeManager.renderView(res, 'frontend/documentation', {
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
        await themeManager.renderView(res, 'frontend/documentation', {
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

/**
 * Cookie-Einwilligung entgegennehmen.
 *
 * Setzt das Cookie beim Besucher **und** schreibt den Nachweis in `consent_log` –
 * die DSGVO verlangt, dass der Verantwortliche eine Einwilligung belegen kann,
 * und ein Cookie im fremden Browser ist kein Beleg bei uns.
 *
 * Antwortet mit den Consent-Mode-Signalen, damit die Seite sie ohne Neuladen
 * an GTM weiterreichen kann.
 *
 * @route POST /consent
 */
router.post('/consent', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const AnalyticsConsent = require('../helpers/AnalyticsConsent');
    const crypto = require('crypto');

    try {
        const einstellungen = await AnalyticsConsent.ladeEinstellungen(dbService);
        const gewaehlt = AnalyticsConsent.bereinigeAuswahl(req.body?.gewaehlt, einstellungen.kategorien);
        const signale  = AnalyticsConsent.signaleFuer(gewaehlt);

        // Die Fassung kommt vom Server, nicht aus dem Formular: Sonst könnte ein
        // veralteter Tab eine Einwilligung unter einer Nummer ablegen, die für
        // einen längst geänderten Text steht.
        const version = einstellungen.version;

        res.cookie(AnalyticsConsent.COOKIE_NAME, JSON.stringify({ gewaehlt, version }), {
            maxAge:   AnalyticsConsent.COOKIE_MAX_AGE_MS,
            httpOnly: false,   // die Seite liest es selbst, es steht nichts Schützenswertes drin
            sameSite: 'lax',
            secure:   req.protocol === 'https',
            path:     '/',
        });

        // Nachweis: gesalzener Hash statt IP im Klartext. Ein Nachweis, für den
        // man IP-Adressen sammelt, tauscht ein Risiko gegen ein größeres.
        const salz = process.env.SESSION_SECRET || 'firebot';
        const hash = crypto.createHash('sha256')
            .update(`${salz}:${req.ip || ''}:${req.get('user-agent') || ''}`)
            .digest('hex');

        const herkunft = ['banner', 'einstellungen', 'widerruf'].includes(req.body?.herkunft)
            ? req.body.herkunft : 'banner';

        try {
            await dbService.query(
                `INSERT INTO consent_log (kategorien, version, herkunft, besucher_hash, user_agent)
                 VALUES (?, ?, ?, ?, ?)`,
                [gewaehlt.join(','), version, herkunft, hash, String(req.get('user-agent') || '').slice(0, 255)]
            );
        } catch (err) {
            // Der Besucher hat entschieden – das darf nicht daran scheitern, dass
            // der Nachweis nicht geschrieben werden konnte. Gemeldet wird es aber.
            Logger.warn(`[Consent] Nachweis nicht gespeichert: ${err.message}`);
        }

        return res.json({ success: true, signale, version });
    } catch (error) {
        Logger.error('[Consent] Fehler beim Speichern der Einwilligung:', error);
        return res.status(500).json({ success: false });
    }
});

module.exports = router;