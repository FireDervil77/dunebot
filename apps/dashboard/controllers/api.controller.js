const { languagesMeta } = require("dunebot-core");
const { ServiceManager } = require("dunebot-core");

/**
 * API-Endpunkt zum Abrufen von Benutzerinformationen
 * 
 * @author firedervil
 * @param {import('express').Request} req - Express Request Objekt
 * @param {import('express').Response} res - Express Response Objekt
 * @returns {Promise<void>}
 */
module.exports.getUserInfo = async function (req, res) {
    const Logger = ServiceManager.get('Logger');

    try {
        if (!req.session.user?.info) {
            return res.status(401).json({ 
                success: false,
                error: "Nicht authentifiziert" 
            });
        }
        
        // Benutzerinformationen aus der Session zurückgeben
        const userInfo = {
            id: req.session.user.info.id,
            username: req.session.user.info.username,
            avatar: req.session.user.info.avatar,
            discriminator: req.session.user.info.discriminator || '0',
            locale: req.session.locale || req.session.user.info.locale || 'de',
            admin: req.session.user.admin === true,
            email: req.session.user.info.email,
            // Sensible Informationen ausfiltern
            verified: req.session.user.info.verified
        };
        
        res.json({
            success: true,
            user: userInfo
        });
    } catch (error) {
        Logger.error("Fehler beim Abrufen der Benutzerinformationen:", error);
        res.status(500).json({
            success: false,
            error: "Ein interner Fehler ist aufgetreten"
        });
    }
};

/**
 * API-Endpunkt zum Abrufen aller Server des Benutzers
 * 
 * @author firedervil
 * @param {import('express').Request} req - Express Request Objekt
 * @param {import('express').Response} res - Express Response Objekt
 * @returns {Promise<void>}
 */
module.exports.getGuilds = async function (req, res) {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        if (!req.session.user?.guilds) {
            return res.status(401).json({ 
                success: false,
                error: "Nicht authentifiziert oder keine Server verfügbar" 
            });
        }
        
        // Benutzerserver aus der Session abrufen
        const userGuilds = req.session.user.guilds;
        
        // Server-IDs extrahieren
        const guildIds = userGuilds.map(g => g.id);
        
        // Wenn keine Server-IDs vorhanden sind, leere Liste zurückgeben
        if (!guildIds.length) {
            return res.json({
                success: true,
                guilds: []
            });
        }
        
        try {
            // Neue Methode: Server direkt über DBService laden
            const dbGuilds = await dbService.getGuilds(guildIds);
            
            // Informationen zusammenführen
            const guildsWithDetails = userGuilds.map(guild => {
                const dbGuild = dbGuilds.find(g => g._id === guild.id);
                
                // Berechtigungen prüfen
                const isAdmin = (guild.permissions & 0x8) === 0x8;
                const canManage = (guild.permissions & 0x20) === 0x20;
                
                return {
                    ...guild,
                    botJoined: !!dbGuild,
                    memberCount: dbGuild?.member_count || 0,
                    region: dbGuild?.region || null,
                    isAdmin,
                    canManage,
                    canInviteBot: isAdmin || canManage || guild.owner
                };
            });
            
            res.json({
                success: true,
                guilds: guildsWithDetails
            });
        } catch (dbError) {
            Logger.error("Datenbankfehler beim Abrufen der Server:", dbError);
            
            // Fallback: Nur Session-Daten ohne DB-Details zurückgeben
            const basicGuildsInfo = userGuilds.map(guild => {
                const isAdmin = (guild.permissions & 0x8) === 0x8;
                const canManage = (guild.permissions & 0x20) === 0x20;
                
                return {
                    ...guild,
                    botJoined: false, // Wir wissen es nicht sicher ohne DB
                    isAdmin,
                    canManage,
                    canInviteBot: isAdmin || canManage || guild.owner
                };
            });
            
            res.json({
                success: true,
                guilds: basicGuildsInfo,
                warning: "Eingeschränkte Daten aufgrund eines Datenbankfehlers"
            });
        }
    } catch (error) {
        Logger.error("Fehler beim Abrufen der Server:", error);
        res.status(500).json({
            success: false,
            error: "Ein interner Fehler ist aufgetreten"
        });
    }
};

/**
 * API-Endpunkt zum Abrufen von Informationen zu einem bestimmten Server
 * 
 * @author firedervil
 * @param {import('express').Request} req - Express Request Objekt
 * @param {import('express').Response} res - Express Response Objekt
 * @returns {Promise<void>}
 */
module.exports.getGuildInfo = async function (req, res) {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const ipcServer = ServiceManager.get('ipcServer');

    try {
        const guildId = req.params.guildId;
        
        if (!guildId) {
            return res.status(400).json({
                success: false,
                error: "Server-ID nicht angegeben"
            });
        }
        
        if (!req.session.user?.guilds) {
            return res.status(401).json({ 
                success: false,
                error: "Nicht authentifiziert" 
            });
        }
        
        // Überprüfen, ob der Benutzer Zugriff auf diesen Server hat
        const userGuild = req.session.user.guilds.find(g => g.id === guildId);
        
        if (!userGuild) {
            return res.status(403).json({
                success: false,
                error: "Kein Zugriff auf diesen Server"
            });
        }
        
        let guildData = {
            id: guildId,
            name: userGuild.name,
            icon: userGuild.icon,
            owner: userGuild.owner,
            permissions: userGuild.permissions
        };
        
        // Detaillierte Informationen aus der Datenbank laden mit nativer MySQL-Methode
        try {
            const dbGuild = await dbService.getGuild(guildId);
            
            if (dbGuild) {
                guildData = {
                    ...guildData,
                    botJoined: true,
                    memberCount: dbGuild.member_count || 0,
                    region: dbGuild.region || null,
                    owner_id: dbGuild.owner_id,
                    joined_at: dbGuild.created_at,
                    premium_tier: dbGuild.premium_tier || 0,
                    premium_since: dbGuild.premium_since
                };
                
                // Erweiterte Informationen vom Bot abrufen, falls verbunden
                try {
                    const guildResponse = await ipcServer.broadcastOne("dashboard:GET_GUILD_INFO", { guildId });
                    
                    if (guildResponse?.success && guildResponse.data) {
                        guildData = {
                            ...guildData,
                            channels: guildResponse.data.channels || [],
                            roles: guildResponse.data.roles || [],
                            emojis: guildResponse.data.emojis || [],
                            features: guildResponse.data.features || []
                        };
                    }
                } catch (ipcErr) {
                    Logger.warn(`Konnte keine erweiterten Informationen für Guild ${guildId} abrufen:`, ipcErr);
                }
            } else {
                guildData.botJoined = false;
            }
        } catch (dbErr) {
            Logger.error(`Fehler beim Laden der Guild ${guildId} aus der Datenbank:`, dbErr);
        }
        
        // Berechtigungen prüfen
        const isAdmin = (userGuild.permissions & 0x8) === 0x8;
        const canManage = (userGuild.permissions & 0x20) === 0x20;
        
        guildData.isAdmin = isAdmin;
        guildData.canManage = canManage;
        guildData.canInviteBot = isAdmin || canManage || userGuild.owner;
        
        res.json({
            success: true,
            guild: guildData
        });
    } catch (error) {
        Logger.error(`Fehler beim Abrufen der Informationen für Guild ${req.params.guildId}:`, error);
        res.status(500).json({
            success: false,
            error: "Ein interner Fehler ist aufgetreten"
        });
    }
};

/**
 * API-Endpunkt zum Abrufen der Bot-Lokalisierungen
 * 
 * @author firedervil
 * @param {import('express').Request} req - Express Request Objekt
 * @param {import('express').Response} res - Express Response Objekt
 * @returns {Promise<void>}
 */
module.exports.getBotLocales = async function (req, res) {
    const ipcServer = ServiceManager.get('ipcServer');
    const ipcResp = await ipcServer.broadcastOne("dashboard:GET_LOCALE_BUNDLE");
    if (!ipcResp?.success) return res.sendStatus(500);

    return res.json(ipcResp.data);
};

/**
 * API-Endpunkt zum Aktualisieren der Bot-Lokalisierungen
 * 
 * @author firedervil
 * @param {import('express').Request} req - Express Request Objekt
 * @param {import('express').Response} res - Express Response Objekt
 * @returns {Promise<void>}
 */
module.exports.updateBotLocales = async function (req, res) {
    const ipcServer = ServiceManager.get('ipcServer');

    const { plugin, language, keys } = req.body;

    // TODO: Add validations

    const response = await ipcServer.broadcast("dashboard:SET_LOCALE_BUNDLE", {
        plugin,
        language,
        keys,
    });

    if (response.some((r) => !r.success)) return res.sendStatus(500);
    return res.sendStatus(200);
};

/**
 * API-Endpunkt zum Aktualisieren der Dashboard-Sprache
 * 
 * @author firedervil
 * @param {import('express').Request} req - Express Request Objekt
 * @param {import('express').Response} res - Express Response Objekt
 * @returns {Promise<void>}
 */
module.exports.updateDashboardLanguage = async function (req, res) {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const lang = req.body.language_code;

    // Prüfen ob der Benutzer authentifiziert ist
    if (!req.session.user?.info?.id) {
        return res.status(401).json({
            success: false,
            error: "Nicht authentifiziert"
        });
    }

    // Prüfen ob die Sprache gültig ist
    if (!languagesMeta.find((l) => l.name === lang)) {
        return res.status(400).json({
            success: false,
            error: "Ungültige Sprache"
        });
    }

    // Wenn keine Änderung notwendig ist
    if (req.session.locale === lang) {
        return res.status(200).json({
            success: true,
            message: "Sprache ist bereits eingestellt"
        });
    }

    try {
        // Update user locale in database mit nativer MySQL-Methode
        await dbService.updateUser(req.session.user.info.id, { locale: lang });
        
        // Update session
        req.session.locale = lang;
        req.session.save((err) => {
            if (err) {
                Logger.error("Fehler beim Speichern der Session:", err);
                return res.status(500).json({
                    success: false,
                    error: "Session konnte nicht aktualisiert werden"
                });
            }
            
            // Erfolgreiche Antwort
            res.status(200).json({
                success: true,
                message: "Sprache erfolgreich aktualisiert",
                locale: lang
            });
        });
    } catch (error) {
        // Detaillierte Fehlerbehandlung
        if (error.code === 'ER_NO_REFERENCED_ROW') {
            Logger.error("Benutzer nicht in Datenbank gefunden:", error);
            return res.status(404).json({
                success: false,
                error: "Benutzer nicht gefunden"
            });
        }
        
        Logger.error("Fehler beim Aktualisieren der Sprache:", error);
        res.status(500).json({
            success: false,
            error: "Datenbankfehler bei der Sprachaktualisierung"
        });
    }
};
/**
 * Sprache für Gäste (nicht authentifizierte Benutzer) aktualisieren
 * Speichert nur in Session, nicht in DB
 * @route POST /api/language/guest
 * @author firedervil
 */
module.exports.updateGuestLanguage = async function (req, res) {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    
    try {
        const lang = req.body.language_code;
        
        // Validierung
        if (!lang || (lang !== 'de-DE' && lang !== 'en-GB')) {
            return res.status(400).json({ success: false, error: 'Invalid language' });
        }
        
        // Session initialisieren falls nicht vorhanden
        if (!req.session) {
            req.session = {};
        }
        
        // Locale setzen in Session
        req.session.locale = lang;
        
        // Wenn User eingeloggt ist, auch in DB speichern
        if (req.session.user && req.session.user.info && req.session.user.info.id) {
            try {
                await dbService.query(
                    'UPDATE users SET locale = ? WHERE _id = ?',
                    [lang, req.session.user.info.id]
                );
            } catch (dbError) {
                Logger.warn('Failed to update user locale in DB:', dbError.message);
            }
        }
        
        // Session speichern
        req.session.save((err) => {
            if (err) {
                Logger.error('Session save error:', err);
                return res.status(500).json({ success: false, error: 'Session error' });
            }
            
            return res.status(200).json({
                success: true,
                message: 'Language updated',
                locale: lang
            });
        });
        
    } catch (error) {
        Logger.error('updateGuestLanguage error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
};
