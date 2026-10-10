const express = require("express");
const { ServiceManager } = require("dunebot-core");
const frontendController = require("../controllers/frontend.controller");
const apiController = require("../controllers/api.controller");
const { NewsHelper } = require("dunebot-sdk/utils");
const { ChangelogHelper } = require("dunebot-sdk/utils");
const { htmlZuVorschautext } = require("../helpers/text");

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
/**
 * Eine Fehlerseite des Frontends — ueber den Zeichner des Themes (2026-10-10).
 *
 * Bis dahin stand an fuenfzehn Stellen `res.status(404).render('frontend/404')`.
 * Das zeichnet die Seite am Theme vorbei: Die Stylesheets reiht erst
 * `themeManager.renderView` fuer die Anfrage ein. Die Seite kam deshalb ganz
 * ohne Gestaltung an — das Menue als Punkteliste, darunter die Meldung
 * (Betreiber, mit Bildschirmfoto: „sieht zugegeben falsch gerendert aus").
 *
 * Scheitert auch das Zeichnen, bleibt ein Satz in Reintext — nie eine Seite,
 * die haengt.
 */
async function fehlerseite(res, status) {
    res.status(status);
    try {
        await ServiceManager.get('themeManager').renderView(res, status >= 500 ? 'frontend/500' : 'frontend/404');
    } catch (err) {
        ServiceManager.get('Logger').error(`[Frontend] Fehlerseite ${status} liess sich nicht zeichnen:`, err);
        if (!res.headersSent) res.type('text/plain').send(status >= 500 ? 'Serverfehler' : 'Seite nicht gefunden');
    }
}

/**
 * Blaettern in den Uebersichten (2026-10-09).
 *
 * Betreiber: Die Startseite zeigt sechs News und drei Changelogs — und von
 * dort fuehrte kein Weg zu den uebrigen. Fuer die News gab es gar keine
 * Uebersicht; die der Changelogs gab es, aber ihr Knopf erschien nur bei mehr
 * als drei Eintraegen, waehrend genau drei geladen wurden.
 *
 * `?seite=` ist 1-basiert. Was keine ganze Zahl ab 1 ist, gilt als 1; eine
 * Seite hinter dem Ende zeigt die letzte, statt einer leeren Liste.
 */
const JE_SEITE = 12;

function blaettern(req, gesamt) {
    const seiten = Math.max(1, Math.ceil(gesamt / JE_SEITE));
    // Nur eine schlichte Zahl zaehlt. `parseInt` laese aus „2; DROP …" oder aus
    // einer doppelt angegebenen Seite („2,3") stillschweigend eine 2 heraus.
    const roh = req.query.seite;
    const gewuenscht = typeof roh === 'string' && /^[0-9]{1,6}$/.test(roh) ? Number(roh) : 1;
    const seite = gewuenscht >= 1 ? Math.min(gewuenscht, seiten) : 1;
    return { seite, seiten, gesamt, versatz: (seite - 1) * JE_SEITE, jeSeite: JE_SEITE };
}

const getNewsList = async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');

    try {
        const [{ n }] = await dbService.query("SELECT COUNT(*) AS n FROM news WHERE status = 'published'");
        const b = blaettern(req, Number(n) || 0);
        // Dieselbe Reihenfolge wie auf der Startseite: Die ersten sechs hier
        // sind die sechs dort. Grenze und Versatz sind Zahlen aus `blaettern`,
        // nie Eingaben.
        const roh = await dbService.query(
            `SELECT * FROM news WHERE status = 'published' ORDER BY created_at DESC, _id DESC LIMIT ${b.jeSeite} OFFSET ${b.versatz}`);

        const userLocale = res.locals.locale || 'de-DE';
        const news = NewsHelper.getLocalizedNewsList(roh, userLocale).map(eintrag => ({
            ...eintrag,
            // Der Anriss kommt als HTML aus dem Editor; die Karte zeigt Text.
            excerptText: htmlZuVorschautext(eintrag.excerpt, 200),
            formattedDate: eintrag.date
                ? new Date(eintrag.date).toLocaleString(userLocale, { year: 'numeric', month: 'long', day: 'numeric' })
                : ''
        }));

        await themeManager.renderView(res, 'frontend/news', { news, blaettern: b, currentLocale: userLocale });
    } catch (err) {
        Logger.error('Fehler beim Laden der News-Uebersicht:', err);
        await fehlerseite(res, 500);
    }
};

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
            return fehlerseite(res, 404);
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
        await fehlerseite(res, 500);
    }
};

// Changelogs Overview Handler
const getChangelogsList = async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get("themeManager");

    try {
        // Oeffentlich UND veroeffentlicht: Bis zum 2026-10-09 genuegte
        // `is_public` — ein Entwurf mit gesetztem Haken stand in der Liste.
        const [{ n }] = await dbService.query(
            "SELECT COUNT(*) AS n FROM changelogs WHERE is_public = 1 AND status = 'published'");
        const b = blaettern(req, Number(n) || 0);
        const rawChangelogs = await dbService.query(`
            SELECT * FROM changelogs
            WHERE is_public = 1 AND status = 'published'
            ORDER BY release_date DESC, id DESC
            LIMIT ${b.jeSeite} OFFSET ${b.versatz}
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
            blaettern: b,
            currentLocale: userLocale
        });
    } catch (err) {
        Logger.error('Fehler beim Laden der Changelogs:', err);
        await fehlerseite(res, 500);
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

        // Wie die Liste: nur, was oeffentlich und veroeffentlicht ist. Bis zum
        // 2026-10-09 fragte diese Seite nur nach der Fassung — ein ENTWURF war
        // fuer jeden lesbar, der die Nummer in die Adresse tippte.
        const rawChangelog = await dbService.query(`
            SELECT * FROM changelogs
            WHERE version = ? AND is_public = 1 AND status = 'published'
        `, [version]);

        if (!rawChangelog?.length) {
            return fehlerseite(res, 404);
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
        await fehlerseite(res, 500);
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
router.get('/news', getNewsList);
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
            const excerpt = excerpts[userLocale] || excerpts['de-DE'] || '';
            return {
                ...p,
                title: titles[userLocale] || titles['de-DE'] || '',
                excerpt,
                // Der Anriss kommt als HTML aus dem Editor. Die Karte zeigt ihn
                // als reinen Text, und das heisst: Tags weg UND Entities
                // aufloesen. Ohne das Zweite stand `&nbsp;` sichtbar auf der Seite.
                excerptText: htmlZuVorschautext(excerpt, 150),
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
        await fehlerseite(res, 500);
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
            return fehlerseite(res, 404);
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
        await fehlerseite(res, 500);
    }
});

// ── CMS-Seiten: /page/:slug ──
/**
 * Seiten, die es als CMS-Eintrag GAB, aber eine eigene Route haben.
 *
 * Datenschutz und Nutzungsbedingungen lagen doppelt vor: einmal als
 * CMS-Seite (deutsch, am 2026-03-21 aus der gerenderten Fassung
 * herauskopiert, seitdem unveraendert) und einmal unter /privacy bzw. /tos,
 * wo der Text aus den Sprachdateien kommt — zweisprachig gepflegt, 58 bzw. 32
 * Schluessel je Sprache.
 *
 * Die CMS-Kopien stehen jetzt auf "draft", damit es eine Quelle gibt. Alte
 * Verweise auf /page/privacy sollen deshalb nicht ins Leere laufen: Sie
 * bekommen einen dauerhaften Umzug auf die gepflegte Fassung. Bei
 * Rechtstexten ist das wichtiger als bei anderen Seiten — sie werden verlinkt
 * und zitiert.
 */
const UMGEZOGENE_SEITEN = {
    privacy: '/privacy',
    tos:     '/tos'
};

router.get('/page/:slug', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');

    try {
        const FrontendPage = require('dunebot-db-client/models/FrontendPage');
        const page = await FrontendPage.getBySlug(req.params.slug);

        if (!page) {
            const ziel = UMGEZOGENE_SEITEN[req.params.slug];
            if (ziel) {
                return res.redirect(301, ziel);
            }
            return fehlerseite(res, 404);
        }

        await themeManager.renderView(res, 'frontend/page', {
            page,
            title: page.meta_title || page.title,
            metaDescription: page.meta_description || ''
        });
    } catch (err) {
        Logger.error('[Frontend/Page] Fehler beim Laden:', err);
        await fehlerseite(res, 500);
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
        await fehlerseite(res, 500);
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
        return fehlerseite(res, 400);
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
            if (!content) return fehlerseite(res, 404);
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
        await fehlerseite(res, 500);
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