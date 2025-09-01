const axios = require("axios");
const querystring = require("querystring");
require("dotenv").config();

const { ServiceManager } = require("dunebot-core");

// Discord OAuth2 Konfiguration
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || "http://91.200.102.182:8900/auth/callback";
const DISCORD_API_URL = "https://discord.com/api/v10";

/**
 * Zur Discord-Authentifizierung weiterleiten
 */
exports.login = async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    
    try {
        // Auth-Layout und Weiterleitung zur Discord-Auth
        res.locals.layout = themeManager?.getLayout ? 
            themeManager.getLayout('auth') : 
            'layouts/auth';
        
        // Wenn der Benutzer nicht angemeldet ist, zeige die Login-Seite
        if (!req.session.user?.info?.id || !req.session.user?.guilds) {
            // Redirect-URL für nach der Anmeldung
            const redirectURL = req.query.redirect || "/auth/server-selector";
            req.session.redirectURL = redirectURL;
            
            // Discord OAuth URL
            const scope = "identify email guilds";
            const discordAuthURL = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scope)}`;
            
            // Direkt zur Discord-Auth weiterleiten oder Login-Seite anzeigen
            if (req.query.direct === "true") {
                return res.redirect(discordAuthURL);
            }
            
            // Login-Formular oder Weiterleitung anzeigen
            res.render("auth/login", {
                title: "Anmelden mit Discord",
                discordAuthURL,
                redirectURL
            });
        } else {
            // Wenn der Nutzer bereits angemeldet ist, weiterleiten
            res.redirect(req.query.redirect || "/auth/server-selector");
        }
    } catch (error) {
        Logger.error("Fehler beim Anzeigen der Login-Seite:", error);
        res.status(500).render("error", {
            message: "Ein Fehler ist aufgetreten.",
            error
        });
    }
};

/**
 * OAuth-Callback verarbeiten
 */
exports.callback = async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const pluginManager = ServiceManager.get('pluginManager');
    const themeManager = ServiceManager.get('themeManager');

    try {
        // Auth-Layout während der Verarbeitung des Callbacks
        res.locals.layout = themeManager?.getLayout ? 
            themeManager.getLayout('auth') : 
            'layouts/auth';
        
        if (!req.query.code) {
            Logger.warn("OAuth Callback ohne Code aufgerufen");
            return res.redirect("/auth/login?error=no_code");
        }
        
        Logger.debug("OAuth Callback gestartet mit Code:", req.query.code.substring(0, 10) + "...");
        
        // OAuth-Token holen
        const tokenResponse = await axios.post(
            `${DISCORD_API_URL}/oauth2/token`,
            querystring.stringify({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                grant_type: "authorization_code",
                code: req.query.code,
                redirect_uri: REDIRECT_URI
            }),
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                }
            }
        );
        
        const tokens = tokenResponse.data;
        Logger.debug("OAuth Token erhalten");
        
        // Benutzerinformationen holen
        const userResponse = await axios.get(`${DISCORD_API_URL}/users/@me`, {
            headers: {
                Authorization: `Bearer ${tokens.access_token}`
            }
        });
        
        const userData = userResponse.data;
        Logger.debug("Benutzerdaten erhalten für:", userData.username);
        
        // Server (Guilds) des Benutzers holen
        const guildsResponse = await axios.get(`${DISCORD_API_URL}/users/@me/guilds`, {
            headers: {
                Authorization: `Bearer ${tokens.access_token}`
            }
        });
        
        const guildsData = guildsResponse.data;
        Logger.debug("Guild-Daten erhalten:", guildsData.length, "Guilds");
        
        // Prüfen, ob der Benutzer Admin ist
        const isAdmin = process.env.OWNER_IDS ? 
            process.env.OWNER_IDS.split(',').includes(userData.id) : 
            false;
        
        // In Datenbank speichern mit nativer MySQL-Methode
        try {
            const userTokens = {
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token, 
                token_type: tokens.token_type,
                expires_at: Date.now() + tokens.expires_in * 1000
            };

            await dbService.query(`
                INSERT INTO users 
                    (_id, username, discriminator, avatar, email, locale, logged_in, tokens, last_login)
                VALUES 
                    (?, ?, ?, ?, ?, ?, true, ?, NOW())
                ON DUPLICATE KEY UPDATE
                    username = VALUES(username),
                    discriminator = VALUES(discriminator),
                    avatar = VALUES(avatar),
                    email = VALUES(email),
                    locale = VALUES(locale),
                    logged_in = VALUES(logged_in),
                    tokens = VALUES(tokens),
                    last_login = VALUES(last_login)
            `, [
                userData.id,
                userData.username,
                userData.discriminator || '0',
                userData.avatar,
                userData.email,
                userData.locale || req.session.locale || 'de',
                JSON.stringify(userTokens)
            ]);

            Logger.debug("Benutzerdaten in DB gespeichert");
        } catch (error) {
            Logger.error("Fehler beim Speichern der Benutzerinformationen:", error);
        }
        
        // WICHTIG: IMMER zum Server-Selector weiterleiten nach Login
        // Dies stellt sicher, dass der Benutzer zunächst einen Server auswählt
        const redirectURL = "/auth/server-selector";
        Logger.debug("Redirect nach Login fest eingestellt auf:", redirectURL);
        
        // Daten in Session speichern
        req.session.user = {
            info: userData,
            guilds: guildsData,
            admin: isAdmin,
            token: tokens.access_token
        };
        
        req.session.locale = userData.locale || req.session.locale || "de";
        
        // Session speichern und dann weiterleiten
        req.session.save((err) => {
            if (err) {
                Logger.error("Fehler beim Speichern der Session:", err);
                return res.render("auth/error", {
                    title: "Anmeldung fehlgeschlagen",
                    error: "Session konnte nicht gespeichert werden."
                });
            }
            
            Logger.debug("Session gespeichert, leite weiter zu:", redirectURL);
            
            // Hook nach erfolgreicher Anmeldung
            if (pluginManager?.hooks) {
                pluginManager.hooks.doAction('after_user_login', userData, req, res)
                    .then(() => {
                        // DIREKTE Weiterleitung statt Template-Rendering
                        res.redirect(redirectURL);
                    })
                    .catch((hookError) => {
                        Logger.error("Fehler im after_user_login Hook:", hookError);
                        res.redirect(redirectURL);
                    });
            } else {
                // DIREKTE Weiterleitung statt Template-Rendering
                res.redirect(redirectURL);
            }
        });
        
    } catch (error) {
        Logger.error("Fehler bei der Authentifizierung:", error);
        res.render("auth/error", {
            title: "Anmeldung fehlgeschlagen",
            error: "Bei der Anmeldung ist ein Fehler aufgetreten."
        });
    }
};

/**
 * Logout durchführen
 */
exports.logout = async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const pluginManager = ServiceManager.get('pluginManager');
    const themeManager = ServiceManager.get('themeManager');

    try {
        // Hook vor dem Logout
        if (pluginManager?.hooks && req.session.user) {
            await pluginManager.hooks.doAction('before_user_logout', req.session.user, req, res);
        }
        
        // Session zerstören
        req.session.destroy();
        
        // Auth-Layout für Logout-Bestätigung
        res.locals.layout = themeManager?.getLayout ? themeManager.getLayout('auth') : 'layouts/auth';
        
        res.render("auth/logout", {
            title: "Abgemeldet"
        });
    } catch (error) {
        Logger.error("Fehler beim Logout:", error);
        res.status(500).render("error", {
            message: "Ein Fehler ist aufgetreten.",
            error
        });
    }
};

/**
 * API-Tokens anzeigen
 */
exports.getTokens = async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');

    try {
        // Auth-Layout
        res.locals.layout = themeManager?.getLayout ? 
            themeManager.getLayout('guild') : 
            'layouts/guild';
        
        // User mit Tokens aus der Datenbank laden
        const user = await dbService.query(
            "SELECT tokens FROM users WHERE _id = ?",
            [req.session.user.info.id]
        );

        // Tokens aus dem JSON-Feld extrahieren
        let userTokens = [];
        if (user && user[0]?.tokens) {
            const tokensData = JSON.parse(user[0].tokens);
            // OAuth2 Token-Informationen anzeigen
            userTokens = [{
                name: "Discord OAuth2",
                token: tokensData.access_token,
                type: tokensData.token_type,
                expires_at: new Date(tokensData.expires_at).toLocaleString()
            }];
        }
        
        res.render("guild/profile/tokens", {
            title: "API-Tokens",
            activeMenu: "/guild/profile/tokens",
            user: req.session.user,
            tokens: userTokens
        });
    } catch (error) {
        Logger.error("Fehler beim Anzeigen der API-Tokens:", error);
        res.status(500).render("error", {
            message: "Ein Fehler ist aufgetreten.",
            error
        });
    }
};

/**
 * Server-Selector anzeigen - Übersicht aller Server, die der Benutzer verwalten kann
 * @author firedervil
 * @param {import('express').Request} req - Express Request Objekt
 * @param {import('express').Response} res - Express Response Objekt
 * @returns {Promise<void>}
 */
exports.getServerSelector = async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipcServer = ServiceManager.get('ipcServer');
    const themeManager = ServiceManager.get('themeManager');

    try {
        // Admin-Layout verwenden
        res.locals.layout = themeManager.getLayout('auth');
        
        if (!req.session.user?.guilds) {
            return res.redirect('/auth/login');
        }
        
        // Benutzerguilds aus Session holen
        const userGuilds = req.session.user.guilds;
        
        // Bot-Guilds von der API abrufen
        const botGuildsResponse = await ipcServer.broadcast("dashboard:GET_BOT_GUILDS");
        const botGuildIds = botGuildsResponse
            .filter(r => r && r.success)
            .flatMap(r => r.data || [])
            .map(guild => guild.id);
        
        Logger.debug(`Bot ist in ${botGuildIds.length} Servern`);
        
        // Anreicherung der Guild-Daten
        const guilds = userGuilds.map(guild => {
            // Berechtigungen prüfen
            const isAdmin = (guild.permissions & 0x8) === 0x8;
            const isManager = (guild.permissions & 0x20) === 0x20;
            const canManage = isAdmin || isManager || guild.owner;
            
            // Bestimmen, ob der Bot im Server ist
            const botInGuild = botGuildIds.includes(guild.id);
            
            // URLs für den Server
            const settingsUrl = botInGuild
                ? `/guild/${guild.id}`
                : `https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&scope=bot+applications.commands&permissions=1374891929078&guild_id=${guild.id}`;
            
            // Icon-URL generieren
            const iconURL = guild.icon
                ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=256`
                : "https://cdn.discordapp.com/embed/avatars/0.png";
            
            return {
                ...guild,
                admin: isAdmin || guild.owner,
                canManage,
                botInGuild,
                settingsUrl,
                iconURL
            };
        });
        
        // Template rendern - WICHTIG: Hier nur Guilds filtern, wo der User Owner ist
        res.render("auth/server-selector", {
            title: "Server auswählen",
            activeMenu: "/auth/server-selector",
            user: req.session.user,
            // Nur Guilds anzeigen, bei denen der Nutzer Owner ist
            guilds: guilds.filter(g => g.owner === true)
        });
    } catch (error) {
        Logger.error('Fehler beim Rendern des Server-Selectors:', error);
        res.status(500).render("error", { 
            message: "Ein Fehler ist aufgetreten.", 
            error 
        });
    }
};

/**
 * Bot-Status in einer Guild prüfen (API-Route)
 * @author GitHub Copilot
 * @param {import('express').Request} req - Express Request Objekt
 * @param {import('express').Response} res - Express Response Objekt
 * @returns {Promise<void>}
 */
exports.checkBotInGuild = async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipcServer = ServiceManager.get('ipcServer');

    try {
        const guildId = req.params.guildId;
        
        if (!guildId) {
            return res.status(400).json({
                success: false,
                message: "Guild-ID ist erforderlich"
            });
        }
        
        // Prüfen, ob der Bot in der Guild ist
        const response = await ipcServer.broadcastOne("dashboard:VALIDATE_GUILD", { guildId });
        
        // Erfolg zurückmelden
        if (response?.success && response?.data?.valid) {
            Logger.info(`Bot-Status-Check: Bot ist in Guild ${guildId}`);
            return res.json({
                success: true,
                botInGuild: true,
                guild: response.data.guild
            });
        } else {
            Logger.info(`Bot-Status-Check: Bot ist NICHT in Guild ${guildId}`);
            return res.json({
                success: true,
                botInGuild: false
            });
        }
    } catch (error) {
        Logger.error("Fehler beim Prüfen des Bot-Status:", error);
        res.status(500).json({
            success: false,
            message: "Ein Fehler ist aufgetreten"
        });
    }
};