const { ServiceManager } = require("dunebot-core");

/**
 * Middleware to populate the request object
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
module.exports = async (req, res, next) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const ipcServer = ServiceManager.get('ipcServer');
    const pluginManager = ServiceManager.get('pluginManager');
    const botHealthMonitor = ServiceManager.get('botHealthMonitor');

    // Guild-ID aus req.params ODER aus dem Path extrahieren
    let guildId = req.params.guildId;
    
    // Fallback: Wenn params leer ist, aus dem Path extrahieren
    if (!guildId) {
        const pathMatch = req.path.match(/^\/guild\/(\d+)/);
        if (pathMatch) {
            guildId = pathMatch[1];
        }
    }
    
    // Wenn immer noch keine Guild-ID, skip
    if (!guildId) {
        return next();
    }

    Logger.debug(`[Guild Middleware] 🔍 Prüfe Guild ${guildId.slice(0, 8)}...`);

    // 🏥 Bot Health Check - NUR für Bot-Offline-Detection (nicht Guild-spezifisch)
    if (botHealthMonitor) {
        const botStatus = botHealthMonitor.getStatus();
        
        // Bot offline nach mehreren Fehlversuchen
        if (!botStatus.isOnline) {
            Logger.warn(`[Guild Middleware] ❌ Bot offline - Redirect zu /auth/server-selector`);
            req.session.errorMessage = 'BOT_OFFLINE';
            return res.redirect('/auth/server-selector');
        }
        
        Logger.debug(`[Guild Middleware] ✅ Bot online (Health-Monitor)`);
    } else {
        Logger.warn('[Guild Middleware] ⚠️ BotHealthMonitor nicht verfügbar');
    }

    // 🔍 IPC-Validierung: Live-Check ob Bot in Guild ist (authoritative!)
    try {
        const responses = await Promise.race([
            ipcServer.broadcast("dashboard:VALIDATE_GUILD", { guildId }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('IPC Timeout')), 5000)  // Timeout reduziert auf 5s
            )
        ]);
        
        if (!responses || !Array.isArray(responses)) {
            Logger.error('[Guild Middleware] IPC Response ungültig');
            req.session.errorMessage = 'BOT_OFFLINE';
            return res.redirect('/auth/server-selector');
        }
        
        const hasGuild = responses.some((r) => r.success && r.data?.valid === true);
        if (!hasGuild) {
            Logger.warn(`[Guild Middleware] ❌ Guild ${guildId} nicht verfügbar (IPC) - Redirect`);
            req.session.errorMessage = 'GUILD_UNAVAILABLE';
            return res.redirect('/auth/server-selector');
        }
        
        Logger.debug(`[Guild Middleware] ✅ Guild-Validierung erfolgreich (IPC)`);
    } catch (error) {
        if (error.message === 'IPC Timeout') {
            Logger.error('[Guild Middleware] IPC Timeout nach 5s - Bot vermutlich nicht erreichbar');
            req.session.errorMessage = 'BOT_OFFLINE';
            return res.redirect('/auth/server-selector');
        }
        Logger.error('[Guild Middleware] IPC Error:', error);
        req.session.errorMessage = 'BOT_OFFLINE';
        return res.redirect('/auth/server-selector');
    }

    const guildData = req.session.user.guilds.find((guild) => guild.id === guildId);   

    // User-Daten für Templates bereitstellen
    res.locals.user = req.session?.user || null;

    // Navigation für diese Guild laden
try {
    // Existierende Guild-Daten nicht überschreiben
    if (!res.locals.guild || !res.locals.guild._id) {
        const guildData = req.session.user.guilds.find(
            (guild) => guild.id === req.params.guildId
        );
        
        if (guildData) {
            res.locals.guild = guildData;
            res.locals.guildId = req.params.guildId;
        }
    }

    // KORRIGIERT: sort_order statt order_num verwenden
    const navigation = await dbService.query(
        "SELECT * FROM nav_items WHERE guildId = ? ORDER BY plugin ASC, sort_order ASC",
        [req.params.guildId || null]
    );
    Logger.debug("Navigation query result:", navigation.length ? "Found items" : "No items");


     // Wenn keine Navigation existiert, für Core-Plugin anlegen
    if (!navigation || navigation.length === 0) {
        Logger.debug("No navigation found, attempting to create core navigation");

        const corePlugin = pluginManager.getPlugin("core");
        Logger.debug("Core plugin:", corePlugin ? "Found" : "Not found");

        if (corePlugin) {
            Logger.debug("Navigation items defined:", 
                        corePlugin.navigationItems ? "Yes" : "No");
            if (corePlugin.navigationItems) {
                await corePlugin.registerNavigation(dbService, req.params.guildId);
                
                // Neu laden - KORRIGIERT: sort_order statt order_num verwenden
                const refreshedNav = await dbService.query(
                    "SELECT * FROM nav_items WHERE guildId = ? ORDER BY plugin ASC, sort_order ASC",
                    [req.params.guildId || null]
                );
                Logger.debug("Navigation after creation:", 
                        refreshedNav.length ? "Items created" : "Still empty");
                        
                if (refreshedNav.length > 0) {
                    res.locals.navigation = refreshedNav;
                    return next();
                }
            }
        }
    }
    res.locals.navigation = navigation;
} catch (error) {
    Logger.error("Error loading navigation:", error);
    res.locals.navigation = [];
}  
    res.locals.guilds = req.session.user;
    
    // SuperAdmin Config-Variablen für alle Templates verfügbar machen
    // (guildId bereits oben deklariert)
    
    try {
        Logger.debug('[Guild Middleware] Loading SuperAdmin configs for guildId:', guildId);
        
        const supportUrl = await dbService.getConfig('superadmin', 'DISCORD_SUPPORT_SERVER_URL', guildId);
        const supportName = await dbService.getConfig('superadmin', 'DISCORD_SUPPORT_SERVER_NAME', guildId);
        const dashboardVersion = await dbService.getConfig('superadmin', 'DASHBOARD_VERSION', guildId);
        const botVersion = await dbService.getConfig('superadmin', 'BOT_VERSION', guildId);
        const buyMeCoffeeUrl = await dbService.getConfig('superadmin', 'BUYMEACOFFE_URL', guildId);
        
        // IMMER setzen, mit Fallback wenn null/undefined
        res.locals.supportUrl = supportUrl || '#';
        res.locals.supportName = supportName || 'Discord Support';
        res.locals.dashboardVersion = dashboardVersion || '1.0.0';
        res.locals.botVersion = botVersion || '1.0.0';
        res.locals.buyMeCoffeeUrl = buyMeCoffeeUrl || '#';
        
        Logger.debug('[Guild Middleware] SuperAdmin configs loaded:', {
            supportUrl: res.locals.supportUrl,
            supportName: res.locals.supportName,
            hasValues: !!supportUrl
        });
    } catch (error) {
        Logger.warn('[Guild Middleware] Error loading SuperAdmin configs:', error.message);
        // Fallback-Werte IMMER setzen
        res.locals.supportUrl = '#';
        res.locals.supportName = 'Discord Support';
        res.locals.dashboardVersion = '1.0.0';
        res.locals.botVersion = '1.0.0';
        res.locals.buyMeCoffeeUrl = '#';
    }
    
    // Plugin-Updates Anzahl laden für Badge in Navigation
    try {
        const pendingUpdates = await pluginManager.getAvailableUpdates(guildId);
        res.locals.pendingUpdatesCount = pendingUpdates.length;
    } catch (error) {
        Logger.warn('[Guild Middleware] Error loading plugin updates count:', error.message);
        res.locals.pendingUpdatesCount = 0;
    }
    
    // SuperAdmin-Status für Templates (für Reload-Button etc.)
    res.locals.isSuperAdmin = req.session?.user?.isSuperAdmin || false;
    
    next();
};
