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

module.exports = router;
