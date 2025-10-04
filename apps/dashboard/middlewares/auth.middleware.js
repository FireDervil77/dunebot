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
        
        if (!guild) {
            Logger.warn(`⚠️ User ${req.session.user.info.id} hat keinen OAuth2-Zugriff auf Guild ${guildId}`);
            return res.status(403).render("error", {
                message: "Du hast keinen Zugriff auf diesen Server",
                error: { status: 403 }
            });
        }
        
        // Überprüfen, ob der Benutzer Admin-Rechte auf diesem Server hat
        const hasAccess = (guild.permissions & 0x20) === 0x20 || 
                         (guild.permissions & 0x8) === 0x8 || 
                          guild.owner === true || 
                          req.session.user.admin === true;
        
        if (!hasAccess) {
            return res.status(403).render("error", {
                message: "Du benötigst Administrator-Rechte, um diesen Server zu verwalten",
                error: { status: 403 }
            });
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