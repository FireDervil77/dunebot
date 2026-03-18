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

    // User-Session prüfen BEVOR auf guilds zugegriffen wird
    if (!req.session || !req.session.user || !req.session.user.guilds) {
        Logger.warn('[Guild Middleware] Session ungültig oder keine Guilds - Redirect zu Login');
        return res.redirect('/auth/login');
    }

    const guildData = req.session.user.guilds.find((guild) => guild.id === guildId);   

    // User-Daten für Templates bereitstellen
    // WICHTIG: .info verwenden, damit isOwner/hasSystemAccess aus base.middleware.js erhalten bleibt!
    res.locals.user = req.session?.user?.info || null;

    // Navigation für diese Guild sicherstellen (nur erstellen wenn fehlt, NICHT überschreiben!)
try {
    // Existierende Guild-Daten nicht überschreiben
    if (!res.locals.guild || !res.locals.guild._id) {
        const guildData = req.session.user.guilds.find(
            (guild) => guild.id === guildId
        );
        
        if (guildData) {
            res.locals.guild = guildData;
            res.locals.guildId = guildId;
        }
    }

    // Prüfe ob Navigation in DB existiert (OHNE zu überschreiben!)
    const navigationRaw = await dbService.query(
        "SELECT COUNT(*) as count FROM guild_nav_items WHERE guildId = ?",
        [guildId]
    );

    // Wenn keine Navigation existiert, für Core-Plugin anlegen
    if (navigationRaw[0].count === 0) {
        Logger.debug(`[Guild Middleware] Keine Navigation gefunden für Guild ${guildId}, erstelle Core-Navigation`);

        const corePlugin = pluginManager.getPlugin("core");
        
        if (corePlugin && typeof corePlugin._registerNavigation === 'function') {
            try {
                await corePlugin._registerNavigation(guildId);
                Logger.debug(`[Guild Middleware] Core-Navigation für Guild ${guildId} erfolgreich erstellt`);
            } catch (error) {
                Logger.error("[Guild Middleware] Fehler beim Erstellen der Core-Navigation:", error);
            }
        }
    }
    
    // ✅ WICHTIG: res.locals.guildNav wird von base.middleware.js gesetzt (mit Struktur + Filterung)!
    // Wir überschreiben es hier NICHT!
    
} catch (error) {
    Logger.error("[Guild Middleware] Error in navigation check:", error);
}  
    res.locals.guilds = req.session.user;
    
    // Globale Konfigurations-Variablen für alle Templates (aus ENV)
    try {
        res.locals.supportUrl = process.env.DISCORD_SUPPORT_SERVER_URL || '#';
        res.locals.supportName = process.env.DISCORD_SUPPORT_SERVER_NAME || 'Discord Support';
        res.locals.dashboardVersion = process.env.DASHBOARD_VERSION || '1.0.0';
        res.locals.botVersion = process.env.BOT_VERSION || '1.0.0';
        res.locals.buyMeCoffeeUrl = process.env.BUYMEACOFFE_URL || '#';
    } catch (error) {
        Logger.warn('[Guild Middleware] Error loading SuperAdmin configs:', error.message);
        // Fallback-Werte IMMER setzen
        res.locals.supportUrl = '#';
        res.locals.supportName = 'Discord Support';
        res.locals.dashboardVersion = '1.0.0';
        res.locals.botVersion = '1.0.0';
        res.locals.buyMeCoffeeUrl = '#';
    }
    
    // Plugin-Updates Badge (externes Update-System entfernt — nur noch PluginUpdater)
    res.locals.pendingUpdatesCount = 0;
    
    // Admin-Status für Templates (OWNER_IDS aus ENV)
    const { isAdminUser } = require('../admin.middleware');
    res.locals.isAdmin = isAdminUser(req.session?.user?.id || req.session?.user?.info?.id);
    
    next();
};
