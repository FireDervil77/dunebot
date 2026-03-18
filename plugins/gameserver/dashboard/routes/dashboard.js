/**
 * Gameserver Dashboard Route
 * Zeigt Übersicht über alle Gameserver der Guild
 * @module routes/dashboard
 * @author FireBot Team
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');

/**
 * GET /guild/:guildId/plugins/gameserver/dashboard
 * Dashboard-Übersicht mit Stats
 */
router.get('/', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');
    
    try {
        const guildId = res.locals.guildId; // ← WICHTIG: Aus res.locals, nicht req.params!
        const user = res.locals.user; // ← User aus res.locals!

        // Validation: guildId muss existieren
        if (!guildId) {
            Logger.error('[Gameserver] Keine guildId in res.locals gefunden!');
            throw new Error('Guild ID fehlt in der Anfrage');
        }

        Logger.debug(`[Gameserver] Dashboard aufgerufen für Guild ${guildId}`);

        // Stats abrufen: Gameserver-Count
        const serverStatsResult = await dbService.query(`
            SELECT 
                COUNT(*) as total_servers,
                SUM(CASE WHEN status = 'online' THEN 1 ELSE 0 END) as online_servers,
                SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END) as offline_servers,
                SUM(current_players) as total_players
            FROM gameservers 
            WHERE guild_id = ?
        `, [guildId]);
        
        // Sicherstellen, dass wir Daten haben (auch wenn Tabelle leer ist)
        const serverStats = serverStatsResult && serverStatsResult[0] ? serverStatsResult[0] : {
            total_servers: 0,
            online_servers: 0,
            offline_servers: 0,
            total_players: 0
        };

        // Letzte 5 Server abrufen
        const recentServers = await dbService.query(`
            SELECT 
                gs.id,
                gs.name,
                gs.status,
                gs.current_players,
                gs.max_players,
                gs.created_at,
                am.name as game_name,
                am.slug as game_slug,
                JSON_UNQUOTE(JSON_EXTRACT(am.game_data, '$.query.gamedig_type')) as gamedig_type
            FROM gameservers gs
            LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
            WHERE gs.guild_id = ?
            ORDER BY gs.created_at DESC
            LIMIT 5
        `, [guildId]);

        // Addon-Stats (welche Games werden genutzt?)
        const addonStats = await dbService.query(`
            SELECT 
                am.name as game_name,
                am.slug as game_slug,
                COUNT(*) as server_count
            FROM gameservers gs
            LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
            WHERE gs.guild_id = ?
            GROUP BY am.id
            ORDER BY server_count DESC
            LIMIT 5
        `, [guildId]);

        // ✅ Scripts für Live-Updates und Toasts einreihen
        const assetManager = ServiceManager.get('assetManager');
        if (assetManager) {
            assetManager.enqueueScript('guild');           // ← GuildAjax für Toasts
            assetManager.enqueueScript('gameserver-sse');  // ← SSE-Client für Live-Updates
        }

        // View rendern
        await themeManager.renderView(res, 'guild/gameserver-dashboard', {
            title: 'Gameserver Dashboard',
            activeMenu: `/guild/${guildId}/plugins/gameserver/dashboard`,
            serverStats,
            recentServers: Array.isArray(recentServers) ? recentServers : [],
            addonStats: Array.isArray(addonStats) ? addonStats : [],
            guildId,
            user
        });
    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Laden des Dashboards:', error);
        res.status(500).render('error', {
            message: 'Fehler beim Laden des Gameserver-Dashboards',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

module.exports = router;
