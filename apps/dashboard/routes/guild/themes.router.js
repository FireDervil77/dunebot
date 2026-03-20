/**
 * Guild Theme-Router
 * 
 * Stellt Theme-Verwaltung auf Guild-Level bereit:
 * - GET  /themes          → Theme-Übersicht (Galerie)
 * - GET  /themes/:name    → Theme-Detail (Info + Clone)
 * - POST /themes/activate → Theme für Guild aktivieren
 * - POST /themes/clone    → Theme als Child klonen
 */

'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });
const { ServiceManager } = require('dunebot-core');

// Permission-Middleware
function requirePermission(permissionKey) {
    return async (req, res, next) => {
        const permissionManager = ServiceManager.get('permissionManager');
        const guildId = res.locals.guildId;
        const userId = res.locals.user?.id;

        if (!userId) return res.status(401).json({ success: false, message: 'Nicht eingeloggt' });

        const hasPermission = await permissionManager.hasPermission(userId, guildId, permissionKey);
        if (!hasPermission) {
            return res.status(403).json({ success: false, message: 'Keine Berechtigung' });
        }
        next();
    };
}

// =====================================================
// GET /guild/:guildId/themes — Theme-Übersicht
// =====================================================
router.get('/', requirePermission('CORE.THEMES.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    const guildId = res.locals.guildId;

    try {
        const themes = await themeManager.getInstalledThemes();
        const activeThemeName = await themeManager.getThemeForGuild(guildId);

        return themeManager.renderView(res, 'guild/themes/index', {
            title: 'Themes',
            activeMenu: `/guild/${guildId}/themes`,
            guildId,
            themes,
            activeThemeName
        });
    } catch (error) {
        Logger.error('[Themes] Fehler beim Laden:', error);
        res.status(500).send('Fehler beim Laden der Themes');
    }
});

// =====================================================
// GET /guild/:guildId/themes/widgets — Widget-Bereiche
// =====================================================
router.get('/widgets', requirePermission('CORE.THEMES.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    const guildId = res.locals.guildId;

    try {
        const { getInstance: getWidgetManager } = require('dunebot-sdk/lib/WidgetManager');
        const wm = getWidgetManager();
        const areas = wm.getAreas();
        const allRegistered = Array.from(wm._registeredWidgets.values());

        // Guild-spezifische Overrides laden
        const dbService = ServiceManager.get('dbService');
        const guildConfigs = await dbService.query(
            'SELECT * FROM guild_widget_config WHERE guild_id = ?',
            [guildId]
        );

        // Overrides als Map (widget_id → config)
        const overrides = {};
        if (guildConfigs) {
            guildConfigs.forEach(c => { overrides[c.widget_id] = c; });
        }

        return themeManager.renderView(res, 'guild/themes/widgets', {
            title: 'Widget-Bereiche',
            activeMenu: `/guild/${guildId}/themes/widgets`,
            guildId,
            areas,
            registeredWidgets: allRegistered,
            overrides
        });
    } catch (error) {
        Logger.error('[Themes/Widgets] Fehler beim Laden:', error);
        res.status(500).send('Fehler beim Laden der Widget-Konfiguration');
    }
});

// =====================================================
// POST /guild/:guildId/themes/widgets — Widget-Config speichern
// =====================================================
router.post('/widgets', requirePermission('CORE.THEMES.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const { widgets } = req.body;

    if (!Array.isArray(widgets)) {
        return res.status(400).json({ success: false, message: 'widgets muss ein Array sein' });
    }

    try {
        const { getInstance: getWidgetManager } = require('dunebot-sdk/lib/WidgetManager');
        const wm = getWidgetManager();

        for (const cfg of widgets) {
            if (!cfg.widget_id || typeof cfg.widget_id !== 'string') continue;

            await wm.setGuildWidgetConfig(guildId, cfg.widget_id, {
                area: cfg.area || null,
                position: cfg.position !== undefined ? Number(cfg.position) : null,
                visible: cfg.visible !== undefined ? (cfg.visible ? 1 : 0) : null,
            });
        }

        Logger.info(`[Themes/Widgets] Widget-Config für Guild ${guildId} gespeichert (${widgets.length} Widgets)`);
        return res.json({ success: true, message: 'Widget-Konfiguration gespeichert' });
    } catch (error) {
        Logger.error('[Themes/Widgets] Fehler beim Speichern:', error);
        res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

// =====================================================
// DELETE /guild/:guildId/themes/widgets — Widget-Config zurücksetzen
// =====================================================
router.delete('/widgets', requirePermission('CORE.THEMES.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const { widgetId } = req.body;

    try {
        const { getInstance: getWidgetManager } = require('dunebot-sdk/lib/WidgetManager');
        const wm = getWidgetManager();

        await wm.resetGuildWidgetConfig(guildId, widgetId || null);

        const msg = widgetId
            ? `Widget '${widgetId}' für Guild ${guildId} zurückgesetzt`
            : `Alle Widget-Configs für Guild ${guildId} zurückgesetzt`;
        Logger.info(`[Themes/Widgets] ${msg}`);
        return res.json({ success: true, message: msg });
    } catch (error) {
        Logger.error('[Themes/Widgets] Fehler beim Zurücksetzen:', error);
        res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

// =====================================================
// GET /guild/:guildId/themes/:name — Theme-Detail
// =====================================================
router.get('/:name', requirePermission('CORE.THEMES.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    const guildId = res.locals.guildId;
    const themeName = req.params.name;

    try {
        const themes = await themeManager.getInstalledThemes();
        const theme = themes.find(t => t.name === themeName);

        if (!theme) {
            return res.status(404).send('Theme nicht gefunden');
        }

        const activeThemeName = await themeManager.getThemeForGuild(guildId);

        // Child-Themes dieses Themes finden
        const childThemes = themes.filter(t => t.parent === themeName);

        return themeManager.renderView(res, 'guild/themes/detail', {
            title: theme.displayName || theme.name,
            activeMenu: `/guild/${guildId}/themes`,
            guildId,
            theme,
            childThemes,
            activeThemeName,
            allThemes: themes
        });
    } catch (error) {
        Logger.error('[Themes] Fehler beim Laden des Theme-Details:', error);
        res.status(500).send('Fehler beim Laden des Themes');
    }
});

// =====================================================
// POST /guild/:guildId/themes/activate — Theme aktivieren
// =====================================================
router.post('/activate', requirePermission('CORE.THEMES.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    const guildId = res.locals.guildId;
    const { themeName } = req.body;

    try {
        const installed = await themeManager.getInstalledThemes();
        const theme = installed.find(t => t.name === themeName);

        if (!theme) {
            return res.status(404).json({ success: false, message: `Theme '${themeName}' nicht gefunden` });
        }

        await themeManager.setThemeForGuild(guildId, themeName);
        Logger.info(`[Themes] Theme für Guild ${guildId} auf '${themeName}' gesetzt`);

        return res.json({ success: true, message: `Theme '${theme.displayName || themeName}' aktiviert` });
    } catch (error) {
        Logger.error('[Themes] Fehler beim Aktivieren:', error);
        res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

// =====================================================
// POST /guild/:guildId/themes/clone — Theme als Child klonen
// =====================================================
router.post('/clone', requirePermission('CORE.THEMES.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    const { sourceTheme, newName, displayName } = req.body;

    if (!sourceTheme || !newName) {
        return res.status(400).json({ success: false, message: 'sourceTheme und newName erforderlich' });
    }

    // Name validieren: nur lowercase, alphanumeric, hyphens
    if (!/^[a-z0-9][a-z0-9-]*$/.test(newName) || newName.length > 50) {
        return res.status(400).json({ success: false, message: 'Name: nur Kleinbuchstaben, Zahlen und Bindestriche (max. 50 Zeichen)' });
    }

    try {
        const result = await themeManager.cloneTheme(sourceTheme, newName, {
            displayName: displayName || newName
        });

        Logger.info(`[Themes] Theme '${sourceTheme}' zu '${newName}' geklont`);
        return res.json({ success: true, message: `Child-Theme '${newName}' erstellt`, data: result });
    } catch (error) {
        Logger.error('[Themes] Clone-Fehler:', error);
        return res.status(400).json({ success: false, message: error.message });
    }
});

module.exports = router;
