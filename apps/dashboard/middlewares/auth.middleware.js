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
        
        // Überprüfen, ob der Benutzer Zugriff auf diesen Server hat
        const guild = req.session.user.guilds.find(g => g.id === guildId);
        
        if (!guild) {
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
        
        // Server-Informationen aus der Datenbank laden
        let guildData;
        try {
            const [dbGuild] = await dbService.query(
                "SELECT * FROM guilds WHERE _id = ?",
                [guildId]
            );
            
            if (!dbGuild) {
                // Erweiterte Discord-Server-Informationen über IPC vom Bot abrufen
                const guildResponse = await ipcServer.broadcastOne("dashboard:GET_GUILD_INFO", { guildId });
                
                if (guildResponse?.success && guildResponse.data) {
                    // Server in der Datenbank speichern
                    await dbService.query(`
                        INSERT INTO guilds 
                            (_id, name, icon, owner_id, region, member_count, created_at, updated_at)
                        VALUES 
                            (?, ?, ?, ?, ?, ?, NOW(), NOW())
                    `, [
                        guildId,
                        guild.name,
                        guild.icon,
                        guildResponse.data.owner_id,
                        guildResponse.data.region || 'unknown',
                        guildResponse.data.member_count || 0
                    ]);

                    // Neu geladene Daten abrufen
                    [guildData] = await dbService.query(
                        "SELECT * FROM guilds WHERE _id = ?",
                        [guildId]
                    );
                } else {
                    // Basisinformationen speichern wenn IPC fehlschlägt
                    await dbService.query(`
                        INSERT INTO guilds 
                            (_id, name, icon, created_at, updated_at)
                        VALUES 
                            (?, ?, ?, NOW(), NOW())
                    `, [
                        guildId,
                        guild.name,
                        guild.icon
                    ]);

                    // Neu geladene Daten abrufen
                    [guildData] = await dbService.query(
                        "SELECT * FROM guilds WHERE _id = ?",
                        [guildId]
                    );
                }
            } else {
                guildData = dbGuild;
            }
        } catch (err) {
            Logger.error(`Fehler beim Laden/Erstellen des Server-Eintrags für ${guildId}:`, err);
            
            // Temporäres Objekt für die Anfrage erstellen
            guildData = {
                _id: guildId,
                name: guild.name,
                icon: guild.icon
            };
        }
        
        // Server-Informationen an res.locals anhängen
        res.locals.guild = guildData;
        res.locals.guildId = guildId;
        res.locals.isServerOwner = guild.owner === true;
        res.locals.isServerAdmin = hasAccess;
        //console.log("RES.LOCALS", res.locals);
        next();
        
    } catch (error) {
        Logger.error(`Fehler in CheckGuildAccess für Guild ${req.params.guildId}:`, error);
        res.status(500).render("error", { 
            message: "Ein Fehler ist aufgetreten.", 
            error 
        });
    }
};