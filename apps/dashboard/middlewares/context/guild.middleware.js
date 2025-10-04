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


    if (!req.params.guildId) {
        return next();
    }

    const responses = await ipcServer.broadcast("dashboard:VALIDATE_GUILD", req.params.guildId);
    if (!responses || !Array.isArray(responses)) {
        return res.status(500).send("Response in guild.midleware is empty or not an array");
    }
    const hasGuild = responses.some((r) => r.success && r.data === true);
    if (!hasGuild) {
        return res.status(404).send("Guild not found");
    }

    const guildData = req.session.user.guilds.find((guild) => guild.id === req.params.guildId);   

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
    
    next();
};
