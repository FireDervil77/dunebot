/**
 * Permission Middleware - Granular Permission Checks für Express Routes
 * 
 * Stellt Middleware-Funktionen für Permission-basierte Route-Protection bereit.
 * Nutzt das neue Permission-System (guild_users, guild_groups, permission_definitions).
 * 
 * Features:
 * - requirePermission(key) - Einzelne Permission erforderlich
 * - requireAnyPermission([keys]) - Mindestens eine Permission
 * - requireAllPermissions([keys]) - Alle Permissions erforderlich
 * - requireGuildOwner() - Nur Guild-Owner
 * - Integration mit res.locals.user und res.locals.guildId
 * 
 * @author FireDervil
 * @version 2.0.0
 * @date 2025-10-30
 */

const { ServiceManager } = require("dunebot-core");

/**
 * Middleware: Prüft ob User eine bestimmte Permission hat
 * 
 * Verwendung:
 * router.get('/servers', requirePermission('gameserver.view'), (req, res) => {...})
 * 
 * @param {string} permissionKey - Permission Key (z.B. "gameserver.start")
 * @returns {Function} Express Middleware
 */
function requirePermission(permissionKey) {
    return async (req, res, next) => {
        const Logger = ServiceManager.get('Logger');
        const permissionManager = ServiceManager.get('permissionManager');
        
        try {
            // User muss angemeldet sein
            if (!req.session.user?.info?.id) {
                Logger.warn(`[Permission] User nicht angemeldet - Permission ${permissionKey} verweigert`);
                return res.status(401).json({
                    success: false,
                    message: 'Bitte melde dich an'
                });
            }
            
            const userId = req.session.user.info.id;
            const guildId = res.locals.guildId || req.params.guildId;
            
            if (!guildId) {
                Logger.error(`[Permission] Keine guildId in res.locals oder req.params`);
                return res.status(400).json({
                    success: false,
                    message: 'Guild-Kontext fehlt'
                });
            }
            
            // Permission Check
            const hasPermission = await permissionManager.hasPermission(userId, guildId, permissionKey);
            
            if (!hasPermission) {
                Logger.warn(`[Permission] User ${userId} hat keine Permission "${permissionKey}" in Guild ${guildId}`);
                
                // API vs. Web-Request unterscheiden
                if (req.xhr || req.headers.accept?.includes('application/json')) {
                    return res.status(403).json({
                        success: false,
                        message: `Du hast keine Berechtigung für diese Aktion (${permissionKey})`
                    });
                } else {
                    // Web-Request: Error-Page mit Guild-Layout rendern
                    res.locals.layout = res.locals.themeManager?.getLayout('guild');
                    return res.status(403).render('error', {
                        status: 403,
                        message: 'Fehlende Berechtigung',
                        error: {
                            status: 403,
                            title: 'Keine Berechtigung',
                            message: `Du benötigst die Berechtigung "${permissionKey}" um diese Seite aufzurufen.`,
                            details: `Bitte kontaktiere einen Administrator, um die benötigte Berechtigung zu erhalten.`
                        }
                    });
                }
            }
            
            Logger.debug(`[Permission] ✅ User ${userId} hat Permission "${permissionKey}" in Guild ${guildId}`);
            next();
            
        } catch (error) {
            Logger.error(`[Permission] Fehler beim Prüfen von Permission "${permissionKey}":`, error);
            return res.status(500).json({
                success: false,
                message: 'Interner Serverfehler bei Permission-Check'
            });
        }
    };
}

/**
 * Middleware: Prüft ob User MINDESTENS EINE der Permissions hat
 * 
 * Verwendung:
 * router.get('/admin', requireAnyPermission(['dashboard.settings.view', 'permissions.users.view']), ...)
 * 
 * @param {string[]} permissionKeys - Array von Permission Keys
 * @returns {Function} Express Middleware
 */
function requireAnyPermission(permissionKeys) {
    return async (req, res, next) => {
        const Logger = ServiceManager.get('Logger');
        const permissionManager = ServiceManager.get('permissionManager');
        
        try {
            if (!req.session.user?.info?.id) {
                Logger.warn(`[Permission] User nicht angemeldet - Permissions ${permissionKeys.join(', ')} verweigert`);
                return res.status(401).json({
                    success: false,
                    message: 'Bitte melde dich an'
                });
            }
            
            const userId = req.session.user.info.id;
            const guildId = res.locals.guildId || req.params.guildId;
            
            if (!guildId) {
                Logger.error(`[Permission] Keine guildId in res.locals oder req.params`);
                return res.status(400).json({
                    success: false,
                    message: 'Guild-Kontext fehlt'
                });
            }
            
            // Prüfe jede Permission
            const hasAny = await permissionManager.hasAnyPermission(userId, guildId, permissionKeys);
            
            if (!hasAny) {
                Logger.warn(`[Permission] User ${userId} hat KEINE der Permissions [${permissionKeys.join(', ')}] in Guild ${guildId}`);
                
                if (req.xhr || req.headers.accept?.includes('application/json')) {
                    return res.status(403).json({
                        success: false,
                        message: `Du benötigst mindestens eine dieser Berechtigungen: ${permissionKeys.join(', ')}`
                    });
                } else {
                    res.locals.layout = res.locals.themeManager?.getLayout('guild');
                    return res.status(403).render('error', {
                        status: 403,
                        message: 'Fehlende Berechtigung',
                        error: {
                            status: 403,
                            title: 'Keine Berechtigung',
                            message: `Du benötigst mindestens eine dieser Berechtigungen: ${permissionKeys.join(', ')}`,
                            details: 'Bitte kontaktiere einen Administrator.'
                        }
                    });
                }
            }
            
            Logger.debug(`[Permission] ✅ User ${userId} hat mindestens eine Permission aus [${permissionKeys.join(', ')}]`);
            next();
            
        } catch (error) {
            Logger.error(`[Permission] Fehler beim Prüfen von Permissions [${permissionKeys.join(', ')}]:`, error);
            return res.status(500).json({
                success: false,
                message: 'Interner Serverfehler bei Permission-Check'
            });
        }
    };
}

/**
 * Middleware: Prüft ob User ALLE Permissions hat
 * 
 * Verwendung:
 * router.delete('/dangerous', requireAllPermissions(['gameserver.delete', 'gameserver.console.execute']), ...)
 * 
 * @param {string[]} permissionKeys - Array von Permission Keys
 * @returns {Function} Express Middleware
 */
function requireAllPermissions(permissionKeys) {
    return async (req, res, next) => {
        const Logger = ServiceManager.get('Logger');
        const permissionManager = ServiceManager.get('permissionManager');
        
        try {
            if (!req.session.user?.info?.id) {
                Logger.warn(`[Permission] User nicht angemeldet - Permissions ${permissionKeys.join(', ')} verweigert`);
                return res.status(401).json({
                    success: false,
                    message: 'Bitte melde dich an'
                });
            }
            
            const userId = req.session.user.info.id;
            const guildId = res.locals.guildId || req.params.guildId;
            
            if (!guildId) {
                Logger.error(`[Permission] Keine guildId in res.locals oder req.params`);
                return res.status(400).json({
                    success: false,
                    message: 'Guild-Kontext fehlt'
                });
            }
            
            // Prüfe alle Permissions
            const hasAll = await permissionManager.hasAllPermissions(userId, guildId, permissionKeys);
            
            if (!hasAll) {
                Logger.warn(`[Permission] User ${userId} hat NICHT ALLE Permissions [${permissionKeys.join(', ')}] in Guild ${guildId}`);
                
                if (req.xhr || req.headers.accept?.includes('application/json')) {
                    return res.status(403).json({
                        success: false,
                        message: `Du benötigst alle diese Berechtigungen: ${permissionKeys.join(', ')}`
                    });
                } else {
                    res.locals.layout = res.locals.themeManager?.getLayout('guild');
                    return res.status(403).render('error', {
                        status: 403,
                        message: 'Fehlende Berechtigung',
                        error: {
                            status: 403,
                            title: 'Keine Berechtigung',
                            message: `Du benötigst alle diese Berechtigungen: ${permissionKeys.join(', ')}`,
                            details: 'Bitte kontaktiere einen Administrator.'
                        }
                    });
                }
            }
            
            Logger.debug(`[Permission] ✅ User ${userId} hat ALLE Permissions [${permissionKeys.join(', ')}]`);
            next();
            
        } catch (error) {
            Logger.error(`[Permission] Fehler beim Prüfen von Permissions [${permissionKeys.join(', ')}]:`, error);
            return res.status(500).json({
                success: false,
                message: 'Interner Serverfehler bei Permission-Check'
            });
        }
    };
}

/**
 * Middleware: Nur Guild-Owner haben Zugriff
 * 
 * Verwendung:
 * router.delete('/guild/:guildId/dangerous', requireGuildOwner(), ...)
 * 
 * @returns {Function} Express Middleware
 */
function requireGuildOwner() {
    return async (req, res, next) => {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        
        try {
            if (!req.session.user?.info?.id) {
                Logger.warn(`[Permission] User nicht angemeldet - Guild Owner benötigt`);
                return res.status(401).json({
                    success: false,
                    message: 'Bitte melde dich an'
                });
            }
            
            const userId = req.session.user.info.id;
            const guildId = res.locals.guildId || req.params.guildId;
            
            if (!guildId) {
                Logger.error(`[Permission] Keine guildId in res.locals oder req.params`);
                return res.status(400).json({
                    success: false,
                    message: 'Guild-Kontext fehlt'
                });
            }
            
            // Prüfe ob User Guild-Owner ist
            const [guild] = await dbService.query(
                'SELECT owner_id FROM guilds WHERE _id = ?',
                [guildId]
            );
            
            if (!guild || guild.length === 0) {
                Logger.error(`[Permission] Guild ${guildId} nicht gefunden`);
                return res.status(404).json({
                    success: false,
                    message: 'Server nicht gefunden'
                });
            }
            
            const isOwner = guild[0].owner_id === userId;
            
            if (!isOwner) {
                Logger.warn(`[Permission] User ${userId} ist NICHT Owner von Guild ${guildId}`);
                
                if (req.xhr || req.headers.accept?.includes('application/json')) {
                    return res.status(403).json({
                        success: false,
                        message: 'Nur der Server-Owner darf diese Aktion ausführen'
                    });
                } else {
                    res.locals.layout = res.locals.themeManager?.getLayout('guild');
                    return res.status(403).render('error', {
                        status: 403,
                        message: 'Keine Berechtigung',
                        error: {
                            status: 403,
                            title: 'Nur für Server-Owner',
                            message: 'Nur der Server-Owner darf diese Aktion ausführen.',
                            details: 'Diese Funktion ist ausschließlich dem Server-Besitzer vorbehalten.'
                        }
                    });
                }
            }
            
            Logger.debug(`[Permission] ✅ User ${userId} ist Owner von Guild ${guildId}`);
            next();
            
        } catch (error) {
            Logger.error(`[Permission] Fehler beim Prüfen von Guild-Owner:`, error);
            return res.status(500).json({
                success: false,
                message: 'Interner Serverfehler bei Permission-Check'
            });
        }
    };
}

/**
 * Middleware: Lädt User-Permissions in res.locals für Templates
 * 
 * Stellt res.locals.userPermissions bereit:
 * {
 *   permissions: { 'gameserver.start': true, ... },
 *   groups: [ { name: 'Administrator', ... } ],
 *   is_owner: true/false
 * }
 * 
 * Verwendung:
 * router.use(loadUserPermissions);
 * 
 * Im Template:
 * <% if (userPermissions.permissions['gameserver.start']) { %>
 *   <button>Server starten</button>
 * <% } %>
 */
async function loadUserPermissions(req, res, next) {
    const Logger = ServiceManager.get('Logger');
    const permissionManager = ServiceManager.get('permissionManager');
    
    try {
        // Nur wenn User angemeldet ist und guildId vorhanden
        if (req.session.user?.info?.id && (res.locals.guildId || req.params.guildId)) {
            const userId = req.session.user.info.id;
            const guildId = res.locals.guildId || req.params.guildId;
            
            const userPerms = await permissionManager.getUserPermissions(userId, guildId);
            res.locals.userPermissions = userPerms;
            
            Logger.debug(`[Permission] Loaded permissions for user ${userId} in guild ${guildId}`);
        } else {
            res.locals.userPermissions = {
                permissions: {},
                groups: [],
                is_owner: false
            };
        }
        
        next();
        
    } catch (error) {
        Logger.error('[Permission] Fehler beim Laden von User-Permissions:', error);
        res.locals.userPermissions = {
            permissions: {},
            groups: [],
            is_owner: false
        };
        next();
    }
}

/**
 * Helper: Prüft Permission in Template/Controller (ohne Middleware)
 * 
 * Verwendung in Controller:
 * const canStart = await checkPermission(userId, guildId, 'gameserver.start');
 * if (!canStart) return res.status(403).json({...})
 * 
 * @param {string} userId - Discord User ID
 * @param {string} guildId - Discord Guild ID
 * @param {string} permissionKey - Permission Key
 * @returns {Promise<boolean>}
 */
async function checkPermission(userId, guildId, permissionKey) {
    const permissionManager = ServiceManager.get('permissionManager');
    return await permissionManager.hasPermission(userId, guildId, permissionKey);
}

module.exports = {
    // Middleware-Funktionen
    requirePermission,
    requireAnyPermission,
    requireAllPermissions,
    requireGuildOwner,
    loadUserPermissions,
    
    // Helper-Funktion
    checkPermission
};
