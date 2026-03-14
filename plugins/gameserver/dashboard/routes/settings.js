/**
 * Gameserver Settings Route
 * Plugin-weite Einstellungen (unter Core-Settings)
 * @module routes/settings
 * @author FireBot Team
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');

/**
 * GET /guild/:guildId/plugins/gameserver/settings
 * Gameserver Plugin-Einstellungen
 */
router.get('/', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');
    
    try {
        const guildId = res.locals.guildId; // ← Aus res.locals!
        const { user } = req;

        Logger.debug(`[Gameserver] Settings aufgerufen für Guild ${guildId}`);

        // Plugin-Config abrufen
        const config = await dbService.getConfig('gameserver', guildId) || {};

        // Default-Werte setzen falls nicht vorhanden
        const settings = {
            auto_start_servers: config.auto_start_servers ?? true,
            auto_update_addons: config.auto_update_addons ?? false,
            max_servers_per_guild: config.max_servers_per_guild ?? 10,
            default_backup_enabled: config.default_backup_enabled ?? true,
            backup_interval_hours: config.backup_interval_hours ?? 24
        };

        // View rendern
        await themeManager.renderView(res, 'guild/gameserver-settings', {
            title: 'Gameserver Einstellungen',
            activeMenu: `/guild/${guildId}/plugins/gameserver/settings`,
            settings,
            guildId,
            user
        });
    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Laden der Settings:', error);
        res.status(500).render('error', {
            message: 'Fehler beim Laden der Gameserver-Einstellungen',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

/**
 * PUT /guild/:guildId/plugins/gameserver/settings
 * Gameserver Settings speichern
 */
router.put('/', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    
    try {
        const guildId = res.locals.guildId; // ← Aus res.locals (wie GET-Route)!
        const {
            auto_start_servers,
            auto_update_addons,
            max_servers_per_guild,
            default_backup_enabled,
            backup_interval_hours
        } = req.body;

        Logger.info(`[Gameserver] Settings-Update für Guild ${guildId}`);

        // Validierung mit Defaults für undefined-Werte
        const maxServers = parseInt(max_servers_per_guild) || 10;
        const backupInterval = parseInt(backup_interval_hours) || 24;

        if (isNaN(maxServers) || maxServers < 1 || maxServers > 100) {
            return res.status(400).json({
                success: false,
                message: 'Ungültiger Wert für max_servers_per_guild (1-100)'
            });
        }

        if (isNaN(backupInterval) || backupInterval < 1 || backupInterval > 168) {
            return res.status(400).json({
                success: false,
                message: 'Ungültiger Wert für backup_interval_hours (1-168)'
            });
        }

        // Config-Objekt erstellen (mit expliziten Werten, niemals undefined)
        const config = {
            auto_start_servers: auto_start_servers === '1' || auto_start_servers === true || false,
            auto_update_addons: auto_update_addons === '1' || auto_update_addons === true || false,
            max_servers_per_guild: maxServers,
            default_backup_enabled: default_backup_enabled === '1' || default_backup_enabled === true || false,
            backup_interval_hours: backupInterval
        };

        // Config speichern
        await dbService.setConfig('gameserver', guildId, config);

        Logger.success(`[Gameserver] Settings gespeichert für Guild ${guildId}`);

        res.json({
            success: true,
            message: 'Einstellungen erfolgreich gespeichert'
        });
    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Speichern der Settings:', error);
        res.status(500).json({
            success: false,
            message: 'Serverfehler beim Speichern der Einstellungen'
        });
    }
});

module.exports = router;
