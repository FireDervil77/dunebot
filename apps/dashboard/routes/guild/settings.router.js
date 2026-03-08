/**
 * Kern-Settings-Router
 * Routes: /guild/:guildId/settings/*
 *
 * Ersetzt das Core-Plugin für Settings-Routen.
 *
 * @author FireDervil
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../middlewares/permissions.middleware');

// GET /settings → Overview
router.get('/', requirePermission('CORE.SETTINGS.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');
    const guildId = res.locals.guildId;

    let enabledPlugins = [];
    try {
        enabledPlugins = await dbService.getEnabledPluginsWithBadges(guildId);
    } catch (err) {
        Logger.error('[KernSettings] Fehler beim Laden der Plugins:', err);
    }

    await themeManager.renderView(res, 'guild/settings', {
        title: 'Einstellungen',
        activeMenu: `/guild/${guildId}/settings`,
        guildId,
        enabledPlugins: enabledPlugins || []
    });
});

// GET /settings/general
router.get('/general', requirePermission('CORE.SETTINGS.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');
    const i18n = ServiceManager.get('i18n');
    const guildId = res.locals.guildId;

    res.locals.pluginName = 'core';
    req.params.pluginName = 'core';

    const settings = { prefix: '!', locale: 'de-DE', theme: 'default', slashCommands: true };

    try {
        const configs = await dbService.query(`
            SELECT config_key, config_value
            FROM configs
            WHERE plugin_name = 'core'
              AND guild_id = ?
              AND context = 'shared'
              AND config_key IN ('PREFIX_COMMANDS_PREFIX', 'LOCALE', 'THEME', 'INTERACTIONS_SLASH')
        `, [guildId]);

        const keyMap = {
            'PREFIX_COMMANDS_PREFIX': 'prefix',
            'LOCALE': 'locale',
            'THEME': 'theme',
            'INTERACTIONS_SLASH': 'slashCommands'
        };

        configs.forEach(row => {
            const viewKey = keyMap[row.config_key];
            if (viewKey) {
                let value = row.config_value;
                if (viewKey === 'slashCommands') {
                    value = value === '1' || value === 1 || value === true;
                }
                settings[viewKey] = value;
            }
        });
    } catch (err) {
        Logger.error('[KernSettings] Fehler beim Laden der Settings:', err);
    }

    const languagesMeta = i18n.languagesMeta || [];

    await themeManager.renderView(res, 'guild/settings/general', {
        title: 'Allgemeine Einstellungen',
        activeMenu: `/guild/${guildId}/settings/general`,
        guildId,
        settings,
        languagesMeta
    });
});

// PUT /settings/general
router.put('/general', requirePermission('CORE.SETTINGS.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const { prefix, locale, theme, slashCommands } = req.body;

    try {
        const settingsMap = {
            'PREFIX_COMMANDS_PREFIX': prefix,
            'LOCALE': locale,
            'THEME': theme,
            'INTERACTIONS_SLASH': slashCommands === 'on' ? 1 : 0
        };

        for (const [configKey, value] of Object.entries(settingsMap)) {
            const configValue = typeof value === 'number' ? value.toString() : value;
            await dbService.query(`
                INSERT INTO configs (plugin_name, config_key, config_value, context, guild_id, is_global)
                VALUES ('core', ?, ?, 'shared', ?, 0)
                ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)
            `, [configKey, configValue, guildId]);
        }

        // Session-Locale löschen → sofortiger Sprachwechsel
        delete req.session.locale;

        res.json({ success: true, message: 'Einstellungen erfolgreich gespeichert!' });
    } catch (error) {
        Logger.error('[KernSettings] Fehler beim Speichern:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /settings/integrations
router.get('/integrations', requirePermission('CORE.SETTINGS.EDIT'), async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    const guildId = res.locals.guildId;

    await themeManager.renderView(res, 'guild/settings/integrations', {
        title: 'Integrationen',
        activeMenu: `/guild/${guildId}/settings/integrations`,
        guildId
    });
});

module.exports = router;
