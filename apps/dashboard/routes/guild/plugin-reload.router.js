/**
 * Plugin-Reload Route
 * 
 * POST /guild/:guildId/plugin-reload/:pluginName
 * 
 * Lädt ein Plugin für eine Guild neu (ohne Deaktivierung).
 * Ausgelagert aus CoreDashboardPlugin.
 *
 * @author FireBot Team
 */

'use strict';

const { Router } = require('express');
const path = require('path');
const { ServiceManager } = require('dunebot-core');

const router = Router({ mergeParams: true });

/**
 * POST /:guildId/plugin-reload/:pluginName
 * Plugin für Guild neu laden
 */
router.post('/:pluginName', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const pluginManager = ServiceManager.get('pluginManager');
    const ipcServer = ServiceManager.get('ipcServer');
    const dbService = ServiceManager.get('dbService');

    const { pluginName } = req.params;
    const guildId = res.locals.guildId;

    try {
        Logger.info(`[PluginReload] Angefordert: ${pluginName} für Guild ${guildId}`);

        if (!pluginName) {
            return res.status(400).json({ success: false, message: 'Plugin-Name fehlt' });
        }

        if (!guildId) {
            return res.status(400).json({ success: false, message: 'Guild-ID fehlt' });
        }

        // Prüfen ob Plugin für diese Guild aktiviert ist
        const pluginStatus = await dbService.query(
            'SELECT is_enabled FROM guild_plugins WHERE guild_id = ? AND plugin_name = ?',
            [guildId, pluginName]
        );

        if (!pluginStatus || pluginStatus.length === 0 || !pluginStatus[0].is_enabled) {
            return res.status(404).json({
                success: false,
                message: `Plugin "${pluginName}" ist für diese Guild nicht aktiviert`
            });
        }

        if (pluginName === 'core') {
            Logger.warn(`[PluginReload] Core-Plugin Reload für Guild ${guildId} angefordert - Vorsicht geboten`);
        }

        // DASHBOARD: Require-Cache für das Plugin leeren
        const pluginPath = path.join(__dirname, '../../../plugins', pluginName);
        const cacheKeys = Object.keys(require.cache).filter(key => key.startsWith(pluginPath));

        Logger.debug(`[PluginReload] Lösche ${cacheKeys.length} Dashboard-Cache-Einträge für ${pluginName}`);
        cacheKeys.forEach(key => {
            delete require.cache[key];
        });

        // Dashboard-Modul neu laden
        let dashboardReloaded = false;
        try {
            const dashboardModulePath = path.join(pluginPath, 'dashboard', 'index.js');
            if (require.cache[dashboardModulePath]) {
                delete require.cache[dashboardModulePath];
            }
            require(dashboardModulePath);
            dashboardReloaded = true;
            Logger.debug(`[PluginReload] Dashboard-Modul für ${pluginName} neu geladen`);
        } catch (err) {
            Logger.warn(`[PluginReload] Dashboard-Modul konnte nicht neu geladen werden:`, err.message);
        }

        // BOT: IPC-Call zum Reload des Bot-Teils
        let botReloaded = false;
        try {
            const ipcResponse = await ipcServer.broadcastOne('dashboard:RELOAD_PLUGIN', {
                pluginName,
                guildId
            });

            if (!ipcResponse.success) {
                Logger.warn(`[PluginReload] Bot-Reload fehlgeschlagen:`, ipcResponse.error);
            } else {
                botReloaded = true;
                Logger.debug(`[PluginReload] Bot-Plugin ${pluginName} für Guild ${guildId} erfolgreich neu geladen`);
            }
        } catch (ipcErr) {
            Logger.warn(`[PluginReload] IPC-Reload fehlgeschlagen:`, ipcErr.message);
        }

        res.json({
            success: true,
            message: `Plugin "${pluginName}" wurde für Guild ${guildId} neu geladen.`,
            details: {
                cacheCleared: cacheKeys.length,
                dashboardReloaded,
                botReloaded,
                pluginName,
                guildId
            }
        });

    } catch (error) {
        Logger.error(`[PluginReload] Fehler beim Reload von ${pluginName}:`, error);
        res.status(500).json({ success: false, message: `Fehler beim Reload: ${error.message}` });
    }
});

module.exports = router;
