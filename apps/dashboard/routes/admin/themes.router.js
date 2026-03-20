/**
 * Admin: Theme-Registry & Theme-Verwaltung
 * Liste aller installierten Themes, globale Aktivierung, Per-Guild-Zuweisung
 *
 * @author firedervil
 * @version 1.0.0
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');

/**
 * GET /admin/themes
 * Alle installierten Themes anzeigen
 */
router.get('/', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    const dbService = ServiceManager.get('dbService');

    res.locals.layout = themeManager.getLayout('guild');

    try {
        const themes = await themeManager.getInstalledThemes();

        // Anzahl der Guilds pro Theme ermitteln
        const usageCounts = await dbService.query(
            `SELECT theme_name, COUNT(*) AS cnt FROM guild_themes GROUP BY theme_name`
        );
        const usageMap = Object.fromEntries(usageCounts.map(r => [r.theme_name, r.cnt]));

        const themesWithStats = themes.map(t => ({
            ...t,
            guildCount: usageMap[t.name] || 0
        }));

        return themeManager.renderView(res, 'admin/themes/index', {
            pageTitle: 'Theme-Verwaltung',
            themes: themesWithStats,
            activeTheme: process.env.ACTIVE_THEME || 'default'
        });
    } catch (error) {
        Logger.error('[Admin/Themes] Fehler beim Laden der Themes:', error);
        res.status(500).send('Fehler beim Laden der Themes');
    }
});

/**
 * POST /admin/themes/:name/activate
 * Theme global als Standard aktivieren (ENV-Override via SiteConfig)
 */
router.post('/:name/activate', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    const siteConfig = ServiceManager.get('siteConfig');
    const { name } = req.params;

    try {
        const installed = await themeManager.getInstalledThemes();
        const theme = installed.find(t => t.name === name);

        if (!theme) {
            return res.status(404).json({ success: false, message: `Theme '${name}' nicht gefunden` });
        }

        // In-Memory Override bis zum nächsten Neustart
        if (siteConfig) {
            siteConfig.set('ACTIVE_THEME', name);
        }
        process.env.ACTIVE_THEME = name;

        Logger.info(`[Admin/Themes] Globales Theme auf '${name}' gesetzt`);

        return res.json({ success: true, message: `Theme '${theme.displayName || name}' ist jetzt global aktiv` });
    } catch (error) {
        Logger.error('[Admin/Themes] Fehler beim Aktivieren:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

/**
 * POST /admin/themes/:name/guild/:guildId
 * Theme für eine bestimmte Guild setzen
 */
router.post('/:name/guild/:guildId', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    const { name, guildId } = req.params;

    try {
        const installed = await themeManager.getInstalledThemes();
        const theme = installed.find(t => t.name === name);

        if (!theme) {
            return res.status(404).json({ success: false, message: `Theme '${name}' nicht gefunden` });
        }

        await themeManager.setThemeForGuild(guildId, name);

        Logger.info(`[Admin/Themes] Theme für Guild ${guildId} auf '${name}' gesetzt`);

        return res.json({
            success: true,
            message: `Theme '${theme.displayName || name}' für Guild ${guildId} gesetzt`
        });
    } catch (error) {
        Logger.error('[Admin/Themes] Fehler beim Guild-Theme-Setzen:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

/**
 * DELETE /admin/themes/:name/guild/:guildId
 * Guild-spezifisches Theme zurücksetzen (nutzt wieder globales Default)
 */
router.delete('/:name/guild/:guildId', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    const dbService = ServiceManager.get('dbService');
    const { guildId } = req.params;

    try {
        await dbService.query('DELETE FROM guild_themes WHERE guild_id = ?', [guildId]);
        themeManager._themeGuildCache.delete(guildId);

        return res.json({ success: true, message: 'Guild-Theme zurückgesetzt auf globales Default' });
    } catch (error) {
        Logger.error('[Admin/Themes] Fehler beim Zurücksetzen:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

// =============================================================================
// WIDGET-AREA-MANAGER
// =============================================================================

/**
 * GET /admin/themes/widgets
 * Widget-Bereiche & Widgets verwalten (global / per Guild)
 */
router.get('/widgets', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');

    res.locals.layout = themeManager.getLayout('guild');

    try {
        const { getInstance: getWidgetManager } = require('dunebot-sdk/lib/WidgetManager');
        const wm = getWidgetManager();
        const areas = wm.getAreas();

        // Alle registrierten Widgets zusammenstellen
        const allRegistered = Array.from(wm._registeredWidgets.values());

        return themeManager.renderView(res, 'admin/themes/widgets', {
            pageTitle: 'Widget-Bereiche',
            areas,
            registeredWidgets: allRegistered,
        });
    } catch (error) {
        Logger.error('[Admin/Themes/Widgets] Fehler:', error);
        res.status(500).send('Fehler beim Laden der Widget-Konfiguration');
    }
});

/**
 * POST /admin/themes/widgets/guild/:guildId
 * Widget-Config einer Guild speichern (AJAX, guild.js-Pattern)
 */
router.post('/widgets/guild/:guildId', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const { guildId } = req.params;
    const { widgets } = req.body; // [{widget_id, area, position, visible}]

    if (!guildId || !Array.isArray(widgets)) {
        return res.status(400).json({ success: false, message: 'Ungültige Eingabedaten' });
    }

    try {
        const { getInstance: getWidgetManager } = require('dunebot-sdk/lib/WidgetManager');
        const wm = getWidgetManager();

        for (const cfg of widgets) {
            if (!cfg.widget_id) continue;
            await wm.setGuildWidgetConfig(guildId, cfg.widget_id, {
                area: cfg.area || null,
                position: cfg.position !== undefined ? Number(cfg.position) : null,
                visible: cfg.visible !== undefined ? Boolean(cfg.visible) : null,
            });
        }

        Logger.info(`[Admin/Themes/Widgets] Widget-Config für Guild ${guildId} gespeichert`);
        res.json({ success: true, message: 'Widget-Konfiguration gespeichert' });
    } catch (error) {
        Logger.error('[Admin/Themes/Widgets] Fehler beim Speichern:', error);
        res.status(500).json({ success: false, message: 'Serverfehler beim Speichern' });
    }
});

/**
 * DELETE /admin/themes/widgets/guild/:guildId
 * Widget-Config einer Guild zurücksetzen
 */
router.delete('/widgets/guild/:guildId', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const { guildId } = req.params;
    const { widgetId } = req.body;

    try {
        const { getInstance: getWidgetManager } = require('dunebot-sdk/lib/WidgetManager');
        const wm = getWidgetManager();
        await wm.resetGuildWidgetConfig(guildId, widgetId || null);

        Logger.info(`[Admin/Themes/Widgets] Config zurückgesetzt für Guild ${guildId}${widgetId ? ` / Widget ${widgetId}` : ''}`);
        res.json({ success: true, message: 'Widget-Konfiguration zurückgesetzt' });
    } catch (error) {
        Logger.error('[Admin/Themes/Widgets] Fehler beim Zurücksetzen:', error);
        res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

// =============================================================================
// FRONTPAGE SECTIONS MANAGER
// =============================================================================

const FrontpageSection = require('dunebot-db-client/models/FrontpageSection');

/**
 * GET /admin/themes/frontpage
 * Frontpage-Sektionen verwalten (Reihenfolge, Sichtbarkeit, Config)
 */
router.get('/frontpage', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');

    res.locals.layout = themeManager.getLayout('guild');

    try {
        const sections = await FrontpageSection.getAll();

        return themeManager.renderView(res, 'admin/themes/frontpage', {
            pageTitle: 'Frontpage-Sektionen',
            activeMenu: '/admin/themes/frontpage',
            sections
        });
    } catch (error) {
        Logger.error('[Admin/Themes/Frontpage] Fehler:', error);
        res.status(500).send('Fehler beim Laden der Frontpage-Konfiguration');
    }
});

/**
 * PUT /admin/themes/frontpage/reorder
 * Reihenfolge der Sektionen aktualisieren (Drag&Drop)
 */
router.put('/frontpage/reorder', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const { order } = req.body; // [{id, position}]

    if (!Array.isArray(order)) {
        return res.status(400).json({ success: false, message: 'Ungültige Daten' });
    }

    try {
        await FrontpageSection.updateOrder(order);
        Logger.info(`[Admin/Themes/Frontpage] Reihenfolge aktualisiert (${order.length} Sektionen)`);
        return res.json({ success: true, message: 'Reihenfolge gespeichert' });
    } catch (error) {
        Logger.error('[Admin/Themes/Frontpage] Fehler beim Reorder:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

/**
 * PUT /admin/themes/frontpage/:id/toggle
 * Sichtbarkeit einer Sektion umschalten
 */
router.put('/frontpage/:id/toggle', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const { id } = req.params;

    try {
        const newVisible = await FrontpageSection.toggleVisibility(Number(id));
        Logger.info(`[Admin/Themes/Frontpage] Sektion ${id} → visible=${newVisible}`);
        return res.json({ success: true, visible: newVisible });
    } catch (error) {
        Logger.error('[Admin/Themes/Frontpage] Fehler beim Toggle:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

/**
 * PUT /admin/themes/frontpage/:id
 * Sektion aktualisieren (Config, Titel, CSS-Klasse, Divider, Custom HTML)
 */
router.put('/frontpage/:id', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const { id } = req.params;
    const { title, config, css_class, visible, divider_before, custom_html } = req.body;

    try {
        const updated = await FrontpageSection.update(Number(id), { title, config, css_class, visible, divider_before, custom_html });
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Sektion nicht gefunden' });
        }
        Logger.info(`[Admin/Themes/Frontpage] Sektion ${id} aktualisiert`);
        return res.json({ success: true, section: updated });
    } catch (error) {
        Logger.error('[Admin/Themes/Frontpage] Fehler beim Update:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

/**
 * POST /admin/themes/frontpage
 * Neue Custom-Sektion erstellen
 */
router.post('/frontpage', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const { title, css_class, custom_html } = req.body;

    if (!title || !title.trim()) {
        return res.status(400).json({ success: false, message: 'Titel erforderlich' });
    }

    try {
        const section = await FrontpageSection.create({
            section_type: 'custom',
            title: title.trim(),
            css_class: css_class || '',
            custom_html: custom_html || '',
            divider_before: 'auto'
        });
        Logger.info(`[Admin/Themes/Frontpage] Custom-Sektion erstellt: ${section.id}`);
        return res.json({ success: true, section });
    } catch (error) {
        Logger.error('[Admin/Themes/Frontpage] Fehler beim Erstellen:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

/**
 * DELETE /admin/themes/frontpage/:id
 * Custom-Sektion löschen (nur Typ 'custom' ist löschbar)
 */
router.delete('/frontpage/:id', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const { id } = req.params;

    try {
        const section = await FrontpageSection.getById(Number(id));
        if (!section) {
            return res.status(404).json({ success: false, message: 'Sektion nicht gefunden' });
        }
        if (section.section_type !== 'custom') {
            return res.status(400).json({ success: false, message: 'Nur Custom-Sektionen können gelöscht werden' });
        }
        await FrontpageSection.delete(Number(id));
        Logger.info(`[Admin/Themes/Frontpage] Sektion ${id} gelöscht`);
        return res.json({ success: true });
    } catch (error) {
        Logger.error('[Admin/Themes/Frontpage] Fehler beim Löschen:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

// =============================================================================
// MENU BUILDER
// =============================================================================

const FrontendMenu = require('dunebot-db-client/models/FrontendMenu');

/**
 * GET /admin/themes/menu
 */
router.get('/menu', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    res.locals.layout = themeManager.getLayout('guild');

    try {
        const menuTree = await FrontendMenu.getTree();
        return themeManager.renderView(res, 'admin/themes/menu', {
            pageTitle: 'Navigation',
            activeMenu: '/admin/themes/menu',
            menuTree
        });
    } catch (error) {
        Logger.error('[Admin/Themes/Menu] Fehler:', error);
        res.status(500).send('Fehler beim Laden der Navigation');
    }
});

/** POST /admin/themes/menu — Neuen Menüpunkt erstellen */
router.post('/menu', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    try {
        const item = await FrontendMenu.create(req.body);
        Logger.info(`[Admin/Themes/Menu] Menüpunkt erstellt: ${item.id}`);
        return res.json({ success: true, item });
    } catch (error) {
        Logger.error('[Admin/Themes/Menu] Fehler:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

/** PUT /admin/themes/menu/reorder */
router.put('/menu/reorder', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ success: false, message: 'Ungültige Daten' });

    try {
        await FrontendMenu.updateOrder(order);
        return res.json({ success: true });
    } catch (error) {
        Logger.error('[Admin/Themes/Menu] Reorder-Fehler:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

/** PUT /admin/themes/menu/:id — Update */
router.put('/menu/:id', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    try {
        const item = await FrontendMenu.update(Number(req.params.id), req.body);
        if (!item) return res.status(404).json({ success: false, message: 'Nicht gefunden' });
        return res.json({ success: true, item });
    } catch (error) {
        Logger.error('[Admin/Themes/Menu] Update-Fehler:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

/** DELETE /admin/themes/menu/:id */
router.delete('/menu/:id', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    try {
        await FrontendMenu.delete(Number(req.params.id));
        Logger.info(`[Admin/Themes/Menu] Menüpunkt ${req.params.id} gelöscht`);
        return res.json({ success: true });
    } catch (error) {
        Logger.error('[Admin/Themes/Menu] Delete-Fehler:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

// =============================================================================
// FOOTER EDITOR
// =============================================================================

const FrontendFooter = require('dunebot-db-client/models/FrontendFooter');

/**
 * GET /admin/themes/footer
 */
router.get('/footer', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    res.locals.layout = themeManager.getLayout('guild');

    try {
        const columns = await FrontendFooter.getColumnsWithLinks();
        return themeManager.renderView(res, 'admin/themes/footer', {
            pageTitle: 'Footer',
            activeMenu: '/admin/themes/footer',
            columns
        });
    } catch (error) {
        Logger.error('[Admin/Themes/Footer] Fehler:', error);
        res.status(500).send('Fehler beim Laden des Footers');
    }
});

/** POST /admin/themes/footer/column */
router.post('/footer/column', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    try {
        const col = await FrontendFooter.createColumn(req.body);
        return res.json({ success: true, column: col });
    } catch (error) {
        Logger.error('[Admin/Themes/Footer] Column Create-Fehler:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

/** PUT /admin/themes/footer/column/reorder */
router.put('/footer/column/reorder', async (req, res) => {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ success: false, message: 'Ungültige Daten' });
    try {
        await FrontendFooter.updateColumnOrder(order);
        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

/** PUT /admin/themes/footer/column/:id */
router.put('/footer/column/:id', async (req, res) => {
    try {
        const col = await FrontendFooter.updateColumn(Number(req.params.id), req.body);
        if (!col) return res.status(404).json({ success: false, message: 'Nicht gefunden' });
        return res.json({ success: true, column: col });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

/** DELETE /admin/themes/footer/column/:id */
router.delete('/footer/column/:id', async (req, res) => {
    try {
        await FrontendFooter.deleteColumn(Number(req.params.id));
        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

/** POST /admin/themes/footer/link */
router.post('/footer/link', async (req, res) => {
    try {
        const link = await FrontendFooter.createLink(req.body);
        return res.json({ success: true, link });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

/** PUT /admin/themes/footer/link/:id */
router.put('/footer/link/:id', async (req, res) => {
    try {
        const link = await FrontendFooter.updateLink(Number(req.params.id), req.body);
        if (!link) return res.status(404).json({ success: false, message: 'Nicht gefunden' });
        return res.json({ success: true, link });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

/** DELETE /admin/themes/footer/link/:id */
router.delete('/footer/link/:id', async (req, res) => {
    try {
        await FrontendFooter.deleteLink(Number(req.params.id));
        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

// =============================================================================
// PAGES CMS (Statische Seiten)
// =============================================================================

const FrontendPage = require('dunebot-db-client/models/FrontendPage');

/**
 * GET /admin/themes/pages
 * Alle Seiten auflisten
 */
router.get('/pages', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    res.locals.layout = themeManager.getLayout('guild');

    try {
        const pages = await FrontendPage.getAll();
        return themeManager.renderView(res, 'admin/themes/pages', {
            pageTitle: 'Seiten',
            activeMenu: '/admin/themes/pages',
            pages
        });
    } catch (error) {
        Logger.error('[Admin/Themes/Pages] Fehler:', error);
        res.status(500).send('Fehler beim Laden der Seiten');
    }
});

/**
 * GET /admin/themes/pages/new
 * Neue Seite erstellen (Editor)
 */
router.get('/pages/new', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    res.locals.layout = themeManager.getLayout('guild');

    return themeManager.renderView(res, 'admin/themes/pages-editor', {
        pageTitle: 'Neue Seite',
        activeMenu: '/admin/themes/pages',
        page: null,
        isNew: true
    });
});

/**
 * GET /admin/themes/pages/:id/edit
 * Seite bearbeiten (Editor)
 */
router.get('/pages/:id/edit', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    res.locals.layout = themeManager.getLayout('guild');

    try {
        const page = await FrontendPage.getById(Number(req.params.id));
        if (!page) {
            return res.status(404).send('Seite nicht gefunden');
        }
        return themeManager.renderView(res, 'admin/themes/pages-editor', {
            pageTitle: `Seite bearbeiten: ${page.title}`,
            activeMenu: '/admin/themes/pages',
            page,
            isNew: false
        });
    } catch (error) {
        Logger.error('[Admin/Themes/Pages] Fehler:', error);
        res.status(500).send('Fehler beim Laden der Seite');
    }
});

/**
 * POST /admin/themes/pages
 * Neue Seite erstellen (API)
 */
router.post('/pages', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const { title, slug, content, status, template, meta_title, meta_description, visible_in_menu } = req.body;

    if (!title || !title.trim()) {
        return res.status(400).json({ success: false, message: 'Titel erforderlich' });
    }

    const finalSlug = slug && slug.trim() ? slug.trim() : title.trim();

    try {
        // Slug-Duplikat prüfen
        if (await FrontendPage.slugExists(finalSlug)) {
            return res.status(400).json({ success: false, message: 'Dieser Slug ist bereits vergeben' });
        }

        const page = await FrontendPage.create({
            title: title.trim(),
            slug: finalSlug,
            content: content || '',
            status: status || 'draft',
            template: template || 'default',
            meta_title: meta_title || null,
            meta_description: meta_description || null,
            visible_in_menu: visible_in_menu ? 1 : 0,
            created_by: req.user?.id || null
        });

        Logger.info(`[Admin/Themes/Pages] Seite erstellt: ${page.id} (${page.slug})`);
        return res.json({ success: true, page });
    } catch (error) {
        Logger.error('[Admin/Themes/Pages] Fehler beim Erstellen:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

/**
 * PUT /admin/themes/pages/:id
 * Seite aktualisieren (API)
 */
router.put('/pages/:id', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const { id } = req.params;
    const { title, slug, content, status, template, meta_title, meta_description, visible_in_menu } = req.body;

    try {
        const existing = await FrontendPage.getById(Number(id));
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Seite nicht gefunden' });
        }

        // Slug-Duplikat prüfen (andere Seite mit gleichem Slug?)
        if (slug && await FrontendPage.slugExists(slug, Number(id))) {
            return res.status(400).json({ success: false, message: 'Dieser Slug ist bereits vergeben' });
        }

        const page = await FrontendPage.update(Number(id), {
            title, slug, content, status, template,
            meta_title, meta_description,
            visible_in_menu: visible_in_menu !== undefined ? (visible_in_menu ? 1 : 0) : undefined
        });

        Logger.info(`[Admin/Themes/Pages] Seite ${id} aktualisiert`);
        return res.json({ success: true, page });
    } catch (error) {
        Logger.error('[Admin/Themes/Pages] Fehler beim Update:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

/**
 * DELETE /admin/themes/pages/:id
 * Seite löschen (API)
 */
router.delete('/pages/:id', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const { id } = req.params;

    try {
        const page = await FrontendPage.getById(Number(id));
        if (!page) {
            return res.status(404).json({ success: false, message: 'Seite nicht gefunden' });
        }

        await FrontendPage.delete(Number(id));
        Logger.info(`[Admin/Themes/Pages] Seite ${id} (${page.slug}) gelöscht`);
        return res.json({ success: true });
    } catch (error) {
        Logger.error('[Admin/Themes/Pages] Fehler beim Löschen:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

/**
 * GET /admin/themes/pages/api/list
 * Alle Seiten als JSON (für Menu-Builder Integration)
 */
router.get('/pages/api/list', async (req, res) => {
    try {
        const pages = await FrontendPage.getPublished();
        return res.json({ success: true, pages: pages.map(p => ({ id: p.id, title: p.title, slug: p.slug })) });
    } catch (error) {
        return res.status(500).json({ success: false, pages: [] });
    }
});

module.exports = router;
