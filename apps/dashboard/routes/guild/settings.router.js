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

// GET /settings/theme → Redirect auf neuen Themes-Bereich
router.get('/theme', (req, res) => {
    const guildId = res.locals.guildId;
    res.redirect(`/guild/${guildId}/themes`);
});

// POST /settings/theme → Redirect auf neuen Endpoint
router.post('/theme', requirePermission('CORE.SETTINGS.EDIT'), async (req, res) => {
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
        Logger.info(`[KernSettings] Theme für Guild ${guildId} auf '${themeName}' gesetzt`);

        return res.json({ success: true, message: `Theme '${theme.displayName || themeName}' aktiviert` });
    } catch (error) {
        Logger.error('[KernSettings] Fehler beim Setzen des Themes:', error);
        res.status(500).json({ success: false, message: 'Serverfehler' });
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

// =============================================
// CHANNEL-VERWALTUNG (Discord Channels Mirror)
// =============================================

// GET /settings/channels → Channel-Übersicht
router.get('/channels', requirePermission('CORE.SETTINGS.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    const ipcServer = ServiceManager.get('ipcServer');
    const guildId = res.locals.guildId;

    let channels = [];
    let categories = [];
    let botHasManageChannels = false;
    let channelTypeIcons = {};

    try {
        if (ipcServer) {
            const responses = await ipcServer.broadcast('dashboard:GET_GUILD_CHANNELS_DETAILED', { guildId });
            const resp = responses && responses.length > 0 ? responses[0] : null;
            const result = resp?.data || resp;

            if (result && result.success) {
                channels = result.channels || [];
                categories = result.categories || [];
                botHasManageChannels = result.botHasManageChannels || false;
                channelTypeIcons = result.channelTypeIcons || {};
            }
        }
    } catch (err) {
        Logger.error('[KernSettings] Fehler beim Laden der Channels via IPC:', err.message);
    }

    await themeManager.renderView(res, 'guild/settings/channels', {
        title: 'Channel-Verwaltung',
        activeMenu: `/guild/${guildId}/settings/channels`,
        guildId,
        channels,
        categories,
        botHasManageChannels,
        channelTypeIcons
    });
});

// =============================================
// ROLLEN-VERWALTUNG (Discord Roles Mirror)
// =============================================

// GET /settings/roles → Rollen-Übersicht
router.get('/roles', requirePermission('CORE.ROLES.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    const ipcServer = ServiceManager.get('ipcServer');
    const guildId = res.locals.guildId;

    let roles = [];
    let botHighestPosition = 0;
    let botHasManageRoles = false;
    let permissionFlags = [];

    try {
        if (ipcServer) {
            const responses = await ipcServer.broadcast('dashboard:GET_GUILD_ROLES_DETAILED', { guildId });
            const resp = responses && responses.length > 0 ? responses[0] : null;

            if (resp && resp.data && resp.data.success) {
                roles = resp.data.roles || [];
                botHighestPosition = resp.data.botHighestPosition || 0;
                botHasManageRoles = resp.data.botHasManageRoles || false;
                permissionFlags = resp.data.permissionFlags || [];
            } else if (resp && resp.success) {
                roles = resp.roles || [];
                botHighestPosition = resp.botHighestPosition || 0;
                botHasManageRoles = resp.botHasManageRoles || false;
                permissionFlags = resp.permissionFlags || [];
            }
        }
    } catch (err) {
        Logger.error('[KernSettings] Fehler beim Laden der Rollen via IPC:', err.message);
    }

    await themeManager.renderView(res, 'guild/settings/roles', {
        title: 'Rollen-Verwaltung',
        activeMenu: `/guild/${guildId}/settings/roles`,
        guildId,
        roles,
        botHighestPosition,
        botHasManageRoles,
        permissionFlags
    });
});

// POST /settings/roles → Neue Rolle erstellen
router.post('/roles', requirePermission('CORE.ROLES.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipcServer = ServiceManager.get('ipcServer');
    const guildId = res.locals.guildId;
    const { name, color, hoist, mentionable, permissions } = req.body;

    try {
        if (!ipcServer) {
            return res.status(503).json({ success: false, message: 'Bot nicht verbunden' });
        }

        const responses = await ipcServer.broadcast('dashboard:CREATE_GUILD_ROLE', {
            guildId, name, color: parseInt(color, 10) || 0, hoist, mentionable, permissions
        });
        const resp = responses && responses.length > 0 ? responses[0] : null;
        const result = resp?.data || resp;

        if (result && result.success) {
            return res.json({ success: true, role: result.role });
        }
        return res.status(400).json({ success: false, message: result?.error || 'Fehler beim Erstellen' });
    } catch (error) {
        Logger.error('[KernSettings] Fehler beim Erstellen der Rolle:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// PUT /settings/roles/:roleId → Rolle bearbeiten
router.put('/roles/:roleId', requirePermission('CORE.ROLES.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipcServer = ServiceManager.get('ipcServer');
    const guildId = res.locals.guildId;
    const { roleId } = req.params;
    const { name, color, hoist, mentionable, permissions } = req.body;

    if (!roleId || !/^\d{17,20}$/.test(roleId)) {
        return res.status(400).json({ success: false, message: 'Ungültige Role-ID' });
    }

    try {
        if (!ipcServer) {
            return res.status(503).json({ success: false, message: 'Bot nicht verbunden' });
        }

        const responses = await ipcServer.broadcast('dashboard:UPDATE_GUILD_ROLE', {
            guildId, roleId, name,
            color: color !== undefined ? (parseInt(color, 10) || 0) : undefined,
            hoist, mentionable, permissions
        });
        const resp = responses && responses.length > 0 ? responses[0] : null;
        const result = resp?.data || resp;

        if (result && result.success) {
            return res.json({ success: true, role: result.role });
        }
        return res.status(400).json({ success: false, message: result?.error || 'Fehler beim Aktualisieren' });
    } catch (error) {
        Logger.error('[KernSettings] Fehler beim Aktualisieren der Rolle:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE /settings/roles/:roleId → Rolle löschen
router.delete('/roles/:roleId', requirePermission('CORE.ROLES.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipcServer = ServiceManager.get('ipcServer');
    const guildId = res.locals.guildId;
    const { roleId } = req.params;

    if (!roleId || !/^\d{17,20}$/.test(roleId)) {
        return res.status(400).json({ success: false, message: 'Ungültige Role-ID' });
    }

    try {
        if (!ipcServer) {
            return res.status(503).json({ success: false, message: 'Bot nicht verbunden' });
        }

        const responses = await ipcServer.broadcast('dashboard:DELETE_GUILD_ROLE', {
            guildId, roleId
        });
        const resp = responses && responses.length > 0 ? responses[0] : null;
        const result = resp?.data || resp;

        if (result && result.success) {
            return res.json({ success: true, deletedRoleName: result.deletedRoleName });
        }
        return res.status(400).json({ success: false, message: result?.error || 'Fehler beim Löschen' });
    } catch (error) {
        Logger.error('[KernSettings] Fehler beim Löschen der Rolle:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
