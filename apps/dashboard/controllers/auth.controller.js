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
        
        // =====================================================
        // Guild-Liste von Discord OAuth2 API holen
        // Diese Liste enthält ALLE Guilds des Users (auch ohne Bot)
        // =====================================================
        
        const oauthGuildsResponse = await axios.get(`${DISCORD_API_URL}/users/@me/guilds`, {
            headers: {
                Authorization: `Bearer ${tokens.access_token}`
            }
        });
        const oauthGuilds = oauthGuildsResponse.data;
        Logger.debug(`🔍 [GHOST-DEBUG] OAuth2 API lieferte ${oauthGuilds.length} Guilds`);
        
        // Guilds aus Datenbank laden (wo Bot bereits ist)
        const dbGuilds = await dbService.query(
            "SELECT _id, guild_name, owner_id FROM guilds WHERE left_at IS NULL"
        );
        Logger.debug(`🔍 [GHOST-DEBUG] Datenbank enthält ${dbGuilds.length} aktive Guilds mit Bot`);
        
        // Alle OAuth2-Guilds verwenden, aber mit Bot-Status anreichern
        const guildsData = oauthGuilds.map(oauthGuild => {
            const dbGuild = dbGuilds.find(dg => dg._id === oauthGuild.id);
            
            return {
                id: oauthGuild.id,
                name: oauthGuild.name,
                icon: oauthGuild.icon,
                owner: oauthGuild.owner,
                permissions: oauthGuild.permissions,
                permissions_new: oauthGuild.permissions_new,
                botPresent: !!dbGuild // Bot ist auf diesem Server?
            };
        });
        
        Logger.debug(`✅ [GHOST-DEBUG] Finale Guild-Liste: ${guildsData.length} Guilds (${guildsData.filter(g => g.botPresent).length} mit Bot)`);
        guildsData.forEach(g => Logger.debug(`  - ${g.id} (${g.name}) ${g.botPresent ? '✅ Bot' : '❌ Kein Bot'}`));
        
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
                    (_id, locale, logged_in, tokens, created_at, updated_at)
                VALUES 
                    (?, ?, ?, ?, NOW(), NOW())
                ON DUPLICATE KEY UPDATE
                    logged_in = VALUES(logged_in),
                    tokens = VALUES(tokens),
                    updated_at = NOW()
            `, [
                userData.id,                                      // _id
                null,                                             // locale (NULL = nutze Guild-LOCALE)
                true,                                             // logged_in
                JSON.stringify(userTokens)                        // tokens
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
        
        // DEBUG: Session-Inhalt VOR dem Speichern loggen
        Logger.debug('[CALLBACK] Session-Inhalt VOR save():', {
            hasUser: !!req.session.user,
            hasGuilds: !!req.session.user?.guilds,
            guildsCount: req.session.user?.guilds?.length || 0,
            userId: req.session.user?.info?.id
        });
        
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
            Logger.debug('[CALLBACK] Session-Inhalt NACH save():', {
                hasUser: !!req.session.user,
                hasGuilds: !!req.session.user?.guilds,
                guildsCount: req.session.user?.guilds?.length || 0
            });
            
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
    const dbService = ServiceManager.get("dbService");
    const pluginManager = ServiceManager.get('pluginManager');
    const sessionManager = ServiceManager.get('sessionManager');
    const themeManager = ServiceManager.get('themeManager');

   try {
        const userId = req.session?.user?.info?.id;
        
        // Hook vor dem Logout
        if (pluginManager?.hooks && req.session.user) {
            await pluginManager.hooks.doAction('before_user_logout', req.session.user, req, res);
        }
        
        if (userId) {
            // Transaktion starten
            await dbService.query('START TRANSACTION');

            try {
                // 1. User logged_in Status aktualisieren
                await dbService.upsertUser({
                    _id: userId,
                    logged_in: 0,
                    last_logout: new Date()
                });

                // 2. Alle aktiven Guild-Zuweisungen des Users entfernen
                await dbService.query(
                    'UPDATE guilds SET is_active_guild = 0, active_user_id = NULL WHERE owner_id = ?',
                    [userId]
                );

                // 3. Alle Sessions des Users zerstören (Session-Cleanup)
                if (sessionManager) {
                    await sessionManager.destroyUserSessions(userId);
                }

                // Transaktion bestätigen
                await dbService.query('COMMIT');
                Logger.debug(`Logout erfolgreich: User ${userId} abgemeldet, Guild-Zuweisungen entfernt und Sessions bereinigt`);

            } catch (error) {
                // Bei Fehler Transaktion zurückrollen
                await dbService.query('ROLLBACK');
                throw error;
            }
        }

        // Aktuelle Session zerstören
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
        res.locals.layout = themeManager.getLayout('auth');

        // DEBUG: Session-Inhalt loggen
        Logger.debug('[SERVER-SELECTOR] Session-Check:', {
            hasSession: !!req.session,
            hasUser: !!req.session?.user,
            hasGuilds: !!req.session?.user?.guilds,
            guildsCount: req.session?.user?.guilds?.length || 0,
            userId: req.session?.user?.info?.id || 'KEINE USER-ID'
        });

        if (!req.session.user?.guilds) {
            Logger.warn('[SERVER-SELECTOR] Keine Guilds in Session - Redirect zu /auth/login');
            return res.redirect('/auth/login');
        }

        // Session-Fehlermeldung auslesen (von guild.middleware)
        const errorMessage = req.session.errorMessage || null;
        if (errorMessage) {
            delete req.session.errorMessage; // Nach dem Auslesen löschen
        }

        // BOT ONLINE CHECK
        let botOnline = false;
        try {
            // 1. Prüfen ob überhaupt IPC-Verbindungen existieren
            const sockets = ipcServer?.getSockets ? ipcServer.getSockets() : [];
            if (sockets.length > 0) {
                // 2. Ping testen
                const pingResp = await ipcServer.broadcastOne("dashboard:PING_PONG", null);
                botOnline = !!(pingResp && pingResp.success);
            }
        } catch (e) {
            Logger.warn("Bot-Online-Check fehlgeschlagen:", e);
            botOnline = false;
        }

        if (!botOnline) {
            Logger.warn("Bot ist offline – Server-Selector im ReadOnly-Modus.");
            return res.render("auth/server-selector", {
                title: "Server auswählen (Bot offline)",
                user: req.session.user,
                guilds: [],
                botOnline: false,
                errorMessage: errorMessage,
                offlineReason: "Der Bot ist derzeit offline oder wird neu gestartet. Ein Zugriff auf Server-Daten ist temporär nicht möglich."
            });
        }

        // Normaler Flow (Bot online)
        const userGuilds = req.session.user.guilds;
        const userId = req.session.user.info.id;

        Logger.debug(`[SERVER-SELECTOR] Lade Custom Permissions für User-ID: ${userId}`);

        // Custom Permissions aus DB laden (guild_staff)
        const dbService = ServiceManager.get('dbService');
        let customPermissions = [];
        try {
            const result = await dbService.query(`
                SELECT 
                    guild_id,
                    role,
                    can_manage_settings,
                    can_manage_plugins,
                    can_view_logs
                FROM guild_staff
                WHERE user_id = ?
                AND (expires_at IS NULL OR expires_at > NOW())
            `, [userId]);
            
            // dbService.query gibt direkt die Row zurück wenn nur 1 Row!
            // Bei 1 Row: result = [{guild_id: "...", role: "..."}, fields]
            // Bei mehreren Rows: result = [{0: row1, 1: row2}, fields]
            if (result && result[0]) {
                const firstElement = result[0];
                
                // Check ob es direkt eine Row ist (hat guild_id key)
                if (firstElement.guild_id) {
                    customPermissions = [firstElement];
                } 
                // Oder ein Object mit numerischen Keys
                else if (typeof firstElement === 'object' && !Array.isArray(firstElement)) {
                    const numericKeys = Object.keys(firstElement).filter(key => !isNaN(key));
                    customPermissions = numericKeys.map(key => firstElement[key]);
                }
                // Oder schon ein Array
                else if (Array.isArray(firstElement)) {
                    customPermissions = firstElement;
                }
            }
            
            Logger.debug(`[SERVER-SELECTOR] Custom Permissions Array:`, customPermissions);
        } catch (err) {
            Logger.warn('[SERVER-SELECTOR] Fehler beim Laden von guild_staff (Tabelle existiert noch nicht?):', err.message);
        }
        
        const customPermsMap = new Map();
        customPermissions.forEach(p => {
            customPermsMap.set(p.guild_id, p);
        });
        
        Logger.debug(`[SERVER-SELECTOR] User hat ${customPermissions.length} Custom Permissions in guild_staff`);

        const botGuildsResponse = await ipcServer.broadcast("dashboard:GET_BOT_GUILDS");
        const botGuildIds = botGuildsResponse
            .filter(r => r && r.success)
            .flatMap(r => r.data || [])
            .map(guild => guild.id);

        Logger.debug(`Bot ist in ${botGuildIds.length} Servern`);

        const guilds = userGuilds.map(guild => {
            const isAdmin = (guild.permissions & 0x8) === 0x8;
            const isManager = (guild.permissions & 0x20) === 0x20;
            
            // Custom Permissions aus DB prüfen
            const customPerm = customPermsMap.get(guild.id);
            const hasCustomAccess = !!customPerm; // Wenn Eintrag in guild_staff existiert
            const customRole = customPerm?.role || null;
            
            // canManage: Discord-Permissions ODER Custom DB-Permissions
            const canManage = isAdmin || isManager || guild.owner || hasCustomAccess;
            
            const botInGuild = botGuildIds.includes(guild.id);

            const settingsUrl = botInGuild
                ? `/guild/${guild.id}`
                : `https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&scope=bot+applications.commands&permissions=1374891929078&guild_id=${guild.id}`;

            const iconURL = guild.icon
                ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`
                : "https://cdn.discordapp.com/embed/avatars/0.png";

            return {
                ...guild,
                admin: isAdmin || guild.owner,
                canManage,
                customRole, // 'admin', 'manager', 'moderator', 'viewer' oder null
                hasCustomAccess,
                botInGuild,
                settingsUrl,
                iconURL
            };
        });

        // FIXME: Filtere nach canManage (Admin/Manager/Owner ODER Custom DB-Permission)!
        // Zeige alle Server wo User Discord-Permissions ODER Custom-Permissions hat
        const accessibleGuilds = guilds.filter(g => g.canManage);
        
        Logger.debug(`[SERVER-SELECTOR] User hat Zugriff auf ${accessibleGuilds.length} von ${guilds.length} Servern`);
        accessibleGuilds.forEach(g => {
            Logger.debug(`  - ${g.name} (${g.id}): owner=${g.owner}, admin=${g.admin}, customRole=${g.customRole}, canManage=${g.canManage}, botInGuild=${g.botInGuild}`);
        });
        
        return res.render("auth/server-selector", {
            title: "Server auswählen",
            activeMenu: "/auth/server-selector",
            user: req.session.user,
            guilds: accessibleGuilds,
            botOnline: true,
            errorMessage: errorMessage
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
 * Setzt die aktive Guild für den User und aktualisiert die Guild-Status-Felder
 */
exports.setActiveGuild = async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const ipcServer = ServiceManager.get('ipcServer');

    const guildId = req.params.guildId;
    const userId = req.session?.user?.info?.id;
    
    try {
        // 1. Zuerst prüfen ob der Bot auf dem Server ist
        const validationResponse = await ipcServer.broadcastOne("dashboard:VALIDATE_GUILD", { guildId });
        if (!validationResponse?.success || !validationResponse?.data?.valid) {
            Logger.warn(`Bot ist nicht auf Server ${guildId}, Aktivierung nicht möglich`);
            return res.redirect(`https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&scope=bot+applications.commands&permissions=1374891929078&guild_id=${guildId}`);
        }

        // 2. Guild in DB aktualisieren
        await dbService.query(`
            UPDATE guilds 
            SET 
                is_active_guild = 1,
                active_user_id = ?,
                updated_at = NOW()
            WHERE _id = ?
        `, [userId, guildId]);

        Logger.info(`Guild ${guildId} wurde für User ${userId} aktiviert`);
        
        // 3. Alle anderen Guilds für diesen User deaktivieren
        await dbService.query(`
            UPDATE guilds 
            SET 
                is_active_guild = 0,
                updated_at = NOW()
            WHERE _id != ? 
            AND active_user_id = ?
        `, [guildId, userId]);

        res.redirect(`/guild/${guildId}`);
    } catch (error) {
        Logger.error("Fehler beim Setzen der aktiven Guild:", error);
        res.redirect('/dashboard');
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