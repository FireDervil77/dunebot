const crypto = require("crypto");
const { ServiceManager } = require("dunebot-core");

/**
 * Middleware to check if the user is logged in
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
module.exports.CheckAuth = async (req, res, next) => {
    // aus dem ServiceManager bereit stellen
    const dbService = ServiceManager.get('dbService');

      if (!req.session.user?.info?.id) {
        const redirectURL = req.originalUrl;
        const state = crypto.randomBytes(16).toString("hex");
        try {
            await dbService.saveState(state, redirectURL);
            return res.redirect(`/auth/login?state=${state}`);
        } catch (err) {
            return res.status(500).send("Internal Server Error");
        }
    }
    return next();
};

/**
 * Middleware to check if the user is an admin
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
module.exports.CheckAdmin = async (req, res, next) => {
    if (!req.session.user?.info.isOwner) {
        return res.redirect("/guild");
    }

    return next();
};

/**
 * Middleware zur Überprüfung des Server-Zugriffs
 * Diese Middleware überprüft, ob der Benutzer Zugriff auf den angeforderten Discord-Server hat
 * und lädt die Server-Daten für die nachfolgenden Controller.
 * 
 * @author firedervil
 * @param {import('express').Request} req - Express Request Objekt
 * @param {import('express').Response} res - Express Response Objekt
 * @param {import('express').NextFunction} next - Express Next Funktion
 * @returns {Promise<void>}
 */
module.exports.CheckGuildAccess = async (req, res, next) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const ipcServer = ServiceManager.get('ipcServer');

    try {
        // Benutzer muss angemeldet sein
        if (!req.session.user?.info?.id || !req.session.user?.guilds) {
            return res.redirect(`/auth/login?redirect=${encodeURIComponent(req.originalUrl)}`);
        }
        
        const guildId = req.params.guildId;
        
        Logger.debug(`🔍 [GHOST-DEBUG] CheckGuildAccess für Guild: ${guildId}`);
        Logger.debug(`🔍 [GHOST-DEBUG] OAuth2 Session Guilds:`, req.session.user.guilds.map(g => ({
            id: g.id,
            name: g.name,
            source: 'OAuth2-Session'
        })));
        
        // =====================================================
        // KRITISCH: ZUERST in Datenbank prüfen!
        // NUR Guilds aus der DB sind valide!
        // OAuth2-Session kann falsche/gecachte IDs enthalten!
        // =====================================================
        const [dbGuild] = await dbService.query(
            "SELECT * FROM guilds WHERE _id = ?",
            [guildId]
        );
        
        Logger.debug(`🔍 [GHOST-DEBUG] Guild in DB gefunden:`, dbGuild ? 'JA' : 'NEIN');
        
        if (!dbGuild) {
            // Guild NICHT in DB = GHOST-ID!
            Logger.warn(`⚠️ [GHOST-ID BLOCKIERT] Guild ${guildId} existiert nicht in DB!`);
            Logger.warn(`⚠️ [GHOST-ID BLOCKIERT] Diese ID stammt aus OAuth2-Session und ist ungültig!`);
            Logger.warn(`⚠️ [GHOST-ID BLOCKIERT] User muss Bot erst zum Server einladen!`);
            
            // Zur Bot-Einladung weiterleiten
            return res.redirect(
                `https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&scope=bot+applications.commands&permissions=1374891929078&guild_id=${guildId}`
            );
        }
        
        // Guild existiert in DB - Jetzt OAuth2-Rechte prüfen
        const guild = req.session.user.guilds.find(g => g.id === guildId);
        
        // Prüfe ob User explizit in guild_users eingetragen ist (NEUES PERMISSION-SYSTEM!)
        let hasGuildUserAccess = false;
        try {
            const guildUser = await dbService.query(`
                SELECT status 
                FROM guild_users 
                WHERE guild_id = ? AND user_id = ? 
                AND status = 'active'
            `, [guildId, req.session.user.info.id]);
            
            if (guildUser && guildUser[0]) {
                hasGuildUserAccess = true;
                Logger.debug(`✅ User ${req.session.user.info.id} hat guild_users-Zugriff auf Guild ${guildId}`);
            }
        } catch (err) {
            Logger.warn('[requireGuildAccess] Fehler beim Laden von guild_users:', err.message);
        }
        
        // Wenn User in guild_users ist, erlaube Zugriff auch OHNE Discord-OAuth2-Permission!
        if (!guild && !hasGuildUserAccess) {
            Logger.warn(`⚠️ User ${req.session.user.info.id} hat KEINEN Zugriff auf Guild ${guildId}`);
            Logger.warn(`   - Kein OAuth2-Zugriff (Discord-Permissions fehlen)`);
            Logger.warn(`   - Nicht in guild_users eingetragen`);
            return res.status(403).render("error", {
                message: "Du hast keinen Zugriff auf diesen Server",
                error: { status: 403 }
            });
        }
        
        // Überprüfen Discord-Permissions (falls OAuth2-Guild existiert)
        const isAdmin = guild ? (guild.permissions & 0x8) === 0x8 : false;
        const isManager = guild ? (guild.permissions & 0x20) === 0x20 : false;
        const isOwner = guild ? guild.owner === true : false;
        const isBotOwner = req.session.user.admin === true;
        
        // Custom Permissions aus guild_staff prüfen (ALTE TABELLE - Backward-Compatibility)
        let hasCustomAccess = false;
        try {
            const result = await dbService.query(`
                SELECT role 
                FROM guild_staff 
                WHERE guild_id = ? AND user_id = ? 
                AND (expires_at IS NULL OR expires_at > NOW())
            `, [guildId, req.session.user.info.id]);
            
            // dbService.query gibt direkt die Row zurück wenn nur 1 Row
            if (result && result[0]) {
                const firstElement = result[0];
                hasCustomAccess = !!(firstElement.role); // Hat irgendeine Rolle = Zugriff
            }
        } catch (err) {
            Logger.warn('[requireGuildAccess] Fehler beim Laden von guild_staff:', err.message);
        }
        
        // Zugriff prüfen: Discord-Permissions ODER Custom DB-Permissions ODER guild_users
        const hasAccess = isAdmin || isManager || isOwner || isBotOwner || hasCustomAccess || hasGuildUserAccess;
        
        if (!hasAccess) {
            Logger.warn(`⚠️ User ${req.session.user.info.id} hat KEINE ausreichenden Rechte für Guild ${guildId}`);
            Logger.warn(`   - isAdmin: ${isAdmin}, isManager: ${isManager}, isOwner: ${isOwner}`);
            Logger.warn(`   - isBotOwner: ${isBotOwner}, hasCustomAccess: ${hasCustomAccess}`);
            Logger.warn(`   - hasGuildUserAccess: ${hasGuildUserAccess}`);
            return res.status(403).render("error", {
                message: "Du benötigst Administrator-Rechte, um diesen Server zu verwalten",
                error: { status: 403 }
            });
        }
        
        // ========================================
        // Dashboard-Access-Permission Check
        // ========================================
        // Für guild_users ohne Discord-Admin-Rechte muss die Permission "DASHBOARD.ACCESS" vorhanden sein
        // Discord Admins/Owner/BotOwner bekommen automatisch Zugriff (Bypass)
        if (hasGuildUserAccess && !isAdmin && !isManager && !isOwner && !isBotOwner && !hasCustomAccess) {
            Logger.debug(`[Dashboard-Access] User ${req.session.user.info.id} hat nur guild_users-Zugriff → Permission prüfen`);
            
            try {
                const permissionManager = ServiceManager.get('permissionManager');
                const hasDashboardAccess = await permissionManager.hasPermission(
                    req.session.user.info.id, 
                    guildId, 
                    'DASHBOARD.ACCESS'
                );
                
                if (!hasDashboardAccess) {
                    Logger.warn(`⚠️ User ${req.session.user.info.id} hat KEINE DASHBOARD.ACCESS Permission!`);
                    Logger.warn(`   Guild: ${guildId}`);
                    Logger.warn(`   → Zugriff verweigert (kein Discord-Admin UND keine Dashboard-Permission)`);
                    
                    return res.status(403).render("error", {
                        message: "Du hast keinen Zugriff auf dieses Dashboard",
                        error: { 
                            status: 403,
                            details: "Fehlende Berechtigung: Dashboard-Zugriff. Bitte kontaktiere einen Server-Administrator."
                        }
                    });
                }
                
                Logger.debug(`✅ User ${req.session.user.info.id} hat DASHBOARD.ACCESS → Zugriff gewährt`);
                
            } catch (err) {
                Logger.error('[Dashboard-Access] Fehler beim Permission-Check:', err);
                return res.status(500).render("error", {
                    message: "Fehler beim Überprüfen der Zugriffsrechte",
                    error: { status: 500 }
                });
            }
        } else {
            Logger.debug(`[Dashboard-Access] User ${req.session.user.info.id} hat Discord/Owner-Rechte → Auto-Zugriff`);
        }
        
        // WICHTIG: Active-Status für diese Guild setzen
        try {
            await dbService.query(`
                UPDATE guilds 
                SET 
                    is_active_guild = 1,
                    active_user_id = ?,
                    updated_at = NOW()
                WHERE _id = ?
            `, [req.session.user.info.id, guildId]);
            
            // Alle anderen Guilds für diesen User deaktivieren
            await dbService.query(`
                UPDATE guilds 
                SET is_active_guild = 0
                WHERE _id != ? AND active_user_id = ?
            `, [guildId, req.session.user.info.id]);
            
            Logger.debug(`✅ Guild ${guildId} als aktiv markiert für User ${req.session.user.info.id}`);
        } catch (updateErr) {
            Logger.warn(`Konnte Active-Status für Guild ${guildId} nicht setzen:`, updateErr);
        }
        
        // Server-Informationen an res.locals anhängen
        res.locals.guild = dbGuild;
        res.locals.guildId = guildId;
        
        // User-Daten für Templates bereitstellen
        res.locals.user = req.session.user;
        res.locals.isServerOwner = guild.owner === true;
        res.locals.isServerAdmin = hasAccess;
        
        next();
        
    } catch (error) {
        Logger.error(`Fehler in CheckGuildAccess für Guild ${req.params.guildId}:`, error);
        res.status(500).render("error", { 
            message: "Ein Fehler ist aufgetreten.", 
            error 
        });
    }
};