/**
 * Permissions Router - Granular Permission Management Routes
 * 
 * Stellt Routes für User- und Gruppen-Verwaltung bereit.
 * Alle Routes sind durch Permission-Middleware geschützt.
 * 
 * Routes:
 * - GET  /permissions/users - User-Liste anzeigen
 * - POST /permissions/users/invite - User einladen
 * - PUT  /permissions/users/:userId - User bearbeiten
 * - DELETE /permissions/users/:userId - User entfernen
 * - POST /permissions/users/:userId/groups - Gruppe zuweisen
 * - DELETE /permissions/users/:userId/groups/:groupId - Gruppe entfernen
 * 
 * - GET  /permissions/groups - Gruppen-Liste anzeigen
 * - POST /permissions/groups - Neue Gruppe erstellen
 * - PUT  /permissions/groups/:groupId - Gruppe bearbeiten
 * - DELETE /permissions/groups/:groupId - Gruppe löschen
 * 
 * - GET /permissions/matrix - Berechtigungsmatrix anzeigen
 * 
 * @author FireDervil
 * @version 2.0.0
 * @date 2025-10-30
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { 
    requirePermission, 
    requireAnyPermission,
    requireGuildOwner,
    loadUserPermissions 
} = require('../middlewares/permissions.middleware');

// Middleware: Lade User-Permissions für alle Routes
router.use(loadUserPermissions);

// ============================================================================
// ROOT REDIRECT
// ============================================================================

/**
 * GET /permissions
 * Redirect zum ersten Untermenü (Users)
 */
router.get('/', (req, res) => {
    const guildId = res.locals.guildId;
    res.redirect(`/guild/${guildId}/permissions/users`);
});

// ============================================================================
// USER MANAGEMENT ROUTES
// ============================================================================

/**
 * GET /permissions/users
 * Zeigt die User-Verwaltungs-Seite
 */
router.get('/users', requirePermission('PERMISSIONS.USERS.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const permissionManager = ServiceManager.get('permissionManager');
    const themeManager = ServiceManager.get('themeManager');
    const guildId = res.locals.guildId;
    
    try {
        // Hole alle User dieser Guild mit aggregierten Permissions
        const users = await dbService.query(`
            SELECT 
                gu.*,
                GROUP_CONCAT(DISTINCT gg.name ORDER BY gg.priority DESC SEPARATOR ', ') as group_names,
                GROUP_CONCAT(DISTINCT gg.id ORDER BY gg.priority DESC) as group_ids,
                GROUP_CONCAT(DISTINCT gg.color ORDER BY gg.priority DESC) as group_colors
            FROM guild_users gu
            LEFT JOIN guild_user_groups gug ON gu.id = gug.guild_user_id
            LEFT JOIN guild_groups gg ON gug.group_id = gg.id
            WHERE gu.guild_id = ? AND gu.status = 'active'
            GROUP BY gu.id
            ORDER BY gu.is_owner DESC, gu.created_at DESC
        `, [guildId]);
        
        // Parse JSON permissions & formatiere Gruppendaten
        const userIds = [];
        users.forEach(user => {
            if (user.direct_permissions) {
                try {
                    user.direct_permissions = JSON.parse(user.direct_permissions);
                } catch (parseError) {
                    Logger.warn(`[Permissions] Konnte direct_permissions für ${user.user_id} nicht parsen:`, parseError.message);
                    user.direct_permissions = {};
                }
            }

            // group_ids ist komma-separiert (ohne Leerzeichen)
            user.group_ids = user.group_ids 
                ? user.group_ids.split(',').map(id => id.trim()).filter(Boolean)
                : [];

            // group_colors ist komma-separiert (ohne Leerzeichen)
            user.group_colors = user.group_colors 
                ? user.group_colors.split(',').map(color => color.trim()).filter(Boolean)
                : [];

            // group_names ist komma + leerzeichen separiert (', ')
            if (user.group_names) {
                user.group_names = user.group_names.split(',').map(name => name.trim()).filter(Boolean);
            } else {
                user.group_names = [];
            }

            if (user.user_id) {
                userIds.push(user.user_id);
            }
        });

        // Discord-User-Daten via IPC auflösen (einmalige Anfrage für alle Nutzer)
        let memberInfos = {};
        if (userIds.length > 0) {
            try {
                const ipcServer = ServiceManager.get('ipcServer');
                const responses = await ipcServer.broadcast('dashboard:GET_GUILD_MEMBERS', {
                    guildId,
                    userIds
                });

                const successfulResponse = responses?.find(response => response?.success);
                if (successfulResponse && successfulResponse.members) {
                    memberInfos = successfulResponse.members;
                    Logger.debug(`[Permissions] ${Object.keys(memberInfos).length}/${userIds.length} Discord-User aufgelöst.`);
                } else {
                    Logger.warn('[Permissions] IPC GET_GUILD_MEMBERS lieferte keine gültige Antwort.', responses);
                }
            } catch (ipcError) {
                Logger.error('[Permissions] IPC GET_GUILD_MEMBERS fehlgeschlagen:', ipcError);
            }
        }

        users.forEach(user => {
            const member = memberInfos[user.user_id];
            if (member) {
                user.username = member.username || `User ${user.user_id}`;
                user.displayName = member.displayName || member.username || `User ${user.user_id}`;
                user.nickname = member.nickname || null;
                user.discriminator = member.discriminator || '0000';
                user.tag = member.tag || `${user.username}#${user.discriminator}`;
                user.avatar = member.avatar || null;
                user.joinedAt = member.joinedAt || null;
            } else {
                user.username = `User ${user.user_id}`;
                user.displayName = user.username;
                user.nickname = null;
                user.discriminator = '0000';
                user.tag = `${user.username}#0000`;
                user.avatar = null;
                user.joinedAt = null;
            }
        });
        
        // Hole alle Gruppen für Dropdowns/Modals
        const availableGroups = await permissionManager.getGuildGroups(guildId);
        
        // Hole alle verfügbaren Permissions (global, kein guild_id-Filter)
        const allPermissions = await dbService.query(`
            SELECT * FROM permission_definitions
            WHERE is_active = 1
            ORDER BY category, sort_order, permission_key
        `);
        
        // Gruppiere Permissions nach Kategorie
        const permissionsByCategory = {};
        allPermissions.forEach(perm => {
            if (!permissionsByCategory[perm.category]) {
                permissionsByCategory[perm.category] = [];
            }
            permissionsByCategory[perm.category].push(perm);
        });
        
        await themeManager.renderView(res, 'guild/permissions/users', {
            pageTitle: 'Benutzer-Verwaltung',
            users: users || [],
            availableGroups: availableGroups || [],
            permissions: permissionsByCategory,
            userPermissions: res.locals.userPermissions, // ← WICHTIG: Übergabe an View!
            guildId
        });
        
    } catch (error) {
        Logger.error('[Permissions] Error loading users page:', error);
        res.status(500).render('error', {
            message: 'Fehler beim Laden der Benutzer-Verwaltung',
            error
        });
    }
});

/**
 * GET /permissions/users/guild-members
 * Gibt alle Discord-Mitglieder der Guild zurück (für "Mitglied hinzufügen" Modal)
 * 
 * WICHTIG: Diese Route MUSS vor /users/:userId stehen!
 * Sonst matched Express :userId auf "guild-members"
 */
router.get('/users/guild-members', requirePermission('PERMISSIONS.USERS.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipcServer = ServiceManager.get('ipcServer');
    const guildId = res.locals.guildId;
    
    Logger.info('[Permissions] GET /users/guild-members aufgerufen für Guild:', guildId);
    
    try {
        // Hole ALLE Guild-Mitglieder via IPC
        const responses = await ipcServer.broadcast('dashboard:GET_ALL_GUILD_MEMBERS', {
            guildId
        });
        
        const successfulResponse = responses?.find(response => response?.success);
        
        if (!successfulResponse || !successfulResponse.members) {
            Logger.warn('[Permissions] IPC GET_ALL_GUILD_MEMBERS lieferte keine Mitglieder:', responses);
            return res.json({
                success: false,
                message: 'Bot konnte keine Mitglieder-Daten liefern. Ist der Bot online?'
            });
        }
        
        const members = successfulResponse.members;
        
        Logger.debug(`[Permissions] ${members.length} Guild-Mitglieder geladen`);
        
        res.json({
            success: true,
            members: members.map(member => ({
                user: {
                    id: member.user.id,
                    username: member.user.username,
                    discriminator: member.user.discriminator,
                    avatar: member.user.avatar,
                    bot: member.user.bot || false
                },
                nick: member.nick || null,
                roles: member.roles || [],
                joinedAt: member.joinedAt || null
            }))
        });
        
    } catch (error) {
        Logger.error('[Permissions] Error loading guild members:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Laden der Guild-Mitglieder'
        });
    }
});

/**
 * GET /permissions/users/:userId
 * Gibt User-Daten für Edit-Modal zurück (JSON)
 */
router.get('/users/:userId', requirePermission('PERMISSIONS.USERS.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const userId = req.params.userId;
    
    try {
        // Hole User-Daten
        const users = await dbService.query(`
            SELECT 
                gu.*,
                GROUP_CONCAT(DISTINCT gg.id) as group_ids,
                GROUP_CONCAT(DISTINCT gg.name ORDER BY gg.priority DESC SEPARATOR ', ') as group_names
            FROM guild_users gu
            LEFT JOIN guild_user_groups gug ON gu.id = gug.guild_user_id
            LEFT JOIN guild_groups gg ON gug.group_id = gg.id
            WHERE gu.guild_id = ? AND gu.user_id = ?
            GROUP BY gu.id
        `, [guildId, userId]);
        
        if (!users || users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Benutzer nicht gefunden'
            });
        }
        
        const user = users[0];
        
        // Parse JSON & formatiere
        if (user.direct_permissions) {
            try {
                user.direct_permissions = JSON.parse(user.direct_permissions);
            } catch (e) {
                user.direct_permissions = {};
            }
        }
        
        user.group_ids = user.group_ids 
            ? user.group_ids.split(',').map(id => parseInt(id)).filter(Boolean)
            : [];
        
        // Discord-Daten via IPC
        try {
            const ipcServer = ServiceManager.get('ipcServer');
            const responses = await ipcServer.broadcast('dashboard:GET_GUILD_MEMBERS', {
                guildId,
                userIds: [userId]
            });
            
            const successfulResponse = responses?.find(response => response?.success);
            if (successfulResponse && successfulResponse.members && successfulResponse.members[userId]) {
                const member = successfulResponse.members[userId];
                user.username = member.username;
                user.displayName = member.displayName || member.username;
                user.avatar = member.avatar;
                user.discriminator = member.discriminator;
            }
        } catch (ipcError) {
            Logger.warn('[Permissions] IPC failed for user data:', ipcError);
        }
        
        res.json({
            success: true,
            user
        });
        
    } catch (error) {
        Logger.error('[Permissions] Error loading user data:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Laden der Benutzerdaten'
        });
    }
});

/**
 * POST /permissions/users/add-guild-member
 * Fügt ein Discord-Guild-Mitglied zum Dashboard hinzu
 */
router.post('/users/add-guild-member', requirePermission('PERMISSIONS.USERS.INVITE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const { user_id } = req.body;
    
    try {
        // Validierung
        if (!user_id) {
            return res.status(400).json({
                success: false,
                message: 'User ID fehlt'
            });
        }
        
        // Prüfe ob User bereits existiert
        const existing = await dbService.query(
            'SELECT id FROM guild_users WHERE user_id = ? AND guild_id = ?',
            [user_id, guildId]
        );
        
        if (existing && existing.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Benutzer wurde bereits hinzugefügt'
            });
        }
        
        // ========================================
        // User in DB anlegen mit Dashboard-Access-Permission
        // ========================================
        const defaultPermissions = {
            'DASHBOARD.ACCESS': true  // Automatisch setzen für neuen User
        };
        
        await dbService.query(`
            INSERT INTO guild_users (user_id, guild_id, status, is_owner, direct_permissions)
            VALUES (?, ?, 'active', false, ?)
        `, [user_id, guildId, JSON.stringify(defaultPermissions)]);
        
        Logger.info(`[Permissions] User ${user_id} added to guild ${guildId} with DASHBOARD.ACCESS`);
        
        res.json({
            success: true,
            message: 'Benutzer wurde erfolgreich hinzugefügt'
        });
        
    } catch (error) {
        Logger.error('[Permissions] Error adding guild member:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Hinzufügen des Benutzers'
        });
    }
});

/**
 * POST /permissions/users/invite
 * Lädt einen Discord-User ein (sendet DM mit Einladungslink)
 */
router.post('/users/invite', requirePermission('PERMISSIONS.USERS.INVITE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const ipcServer = ServiceManager.get('ipcServer');
    const guildId = res.locals.guildId;
    const { user_id, default_group_id } = req.body;
    
    try {
        // Validierung
        if (!user_id) {
            return res.status(400).json({
                success: false,
                message: 'User ID fehlt'
            });
        }
        
        // TODO: Über IPC Discord-DM senden mit Einladungslink
        // ipcServer.send('bot:SEND_INVITE_DM', { userId: user_id, guildId });
        
        // User in DB anlegen (Status: invited)
        await dbService.query(`
            INSERT INTO guild_users (user_id, guild_id, status, is_owner)
            VALUES (?, ?, 'invited', false)
            ON DUPLICATE KEY UPDATE status = 'invited', updated_at = NOW()
        `, [user_id, guildId]);
        
        // Optional: Default-Gruppe zuweisen
        if (default_group_id) {
            const [guildUser] = await dbService.query(
                'SELECT id FROM guild_users WHERE user_id = ? AND guild_id = ?',
                [user_id, guildId]
            );
            
            if (guildUser && guildUser[0]) {
                await dbService.query(
                    'INSERT IGNORE INTO guild_user_groups (guild_user_id, group_id, assigned_by) VALUES (?, ?, ?)',
                    [guildUser[0].id, default_group_id, req.session.user.info.id]
                );
            }
        }
        
        Logger.info(`[Permissions] User ${user_id} invited to guild ${guildId}`);
        
        res.json({
            success: true,
            message: 'Einladung wurde versendet'
        });
        
    } catch (error) {
        Logger.error('[Permissions] Error inviting user:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Einladen des Benutzers'
        });
    }
});

/**
 * PUT /permissions/users/:userId
 * Bearbeitet einen User (Gruppen, Direct Permissions, Status)
 */
router.put('/users/:userId', requirePermission('PERMISSIONS.USERS.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const permissionManager = ServiceManager.get('permissionManager');
    const guildId = res.locals.guildId;
    const userId = req.params.userId;
    const { direct_permissions, status, group_ids } = req.body;
    
    try {
        // Prüfe ob User Owner ist
        const [guild] = await dbService.query(
            'SELECT owner_id FROM guilds WHERE _id = ?',
            [guildId]
        );
        
        if (guild && guild[0]?.owner_id === userId) {
            return res.status(403).json({
                success: false,
                message: 'Der Server-Owner kann nicht bearbeitet werden'
            });
        }
        
        // Update Direct Permissions
        if (direct_permissions !== undefined) {
            // Konvertiere String "true" zu boolean true
            const cleanedPerms = {};
            if (direct_permissions && typeof direct_permissions === 'object') {
                Object.keys(direct_permissions).forEach(key => {
                    cleanedPerms[key] = direct_permissions[key] === 'true' || direct_permissions[key] === true;
                });
            }
            
            const directPermsJson = Object.keys(cleanedPerms).length > 0 ? JSON.stringify(cleanedPerms) : null;
            await dbService.query(`
                UPDATE guild_users 
                SET direct_permissions = ?, updated_at = NOW()
                WHERE user_id = ? AND guild_id = ?
            `, [directPermsJson, userId, guildId]);
        }
        
        // Update Status
        if (status) {
            await dbService.query(`
                UPDATE guild_users 
                SET status = ?, updated_at = NOW()
                WHERE user_id = ? AND guild_id = ?
            `, [status, userId, guildId]);
        }
        
        // Update Gruppen-Zuweisungen
        if (group_ids !== undefined) {
            Logger.info(`[Permissions] Updating group assignments for user ${userId}:`, group_ids);
            
            const guildUserResult = await dbService.query(
                'SELECT id FROM guild_users WHERE user_id = ? AND guild_id = ?',
                [userId, guildId]
            );
            
            Logger.info(`[Permissions] Guild user query result:`, guildUserResult);
            
            if (guildUserResult && guildUserResult[0]) {
                const guildUserId = guildUserResult[0].id;
                
                Logger.info(`[Permissions] Found guild_user_id: ${guildUserId}`);
                
                // Alle alten Gruppen entfernen
                await dbService.query(
                    'DELETE FROM guild_user_groups WHERE guild_user_id = ?',
                    [guildUserId]
                );
                
                Logger.info(`[Permissions] Deleted old group assignments`);
                
                // Neue Gruppen zuweisen
                if (Array.isArray(group_ids) && group_ids.length > 0) {
                    // Konvertiere zu Numbers und validiere
                    const validGroupIds = group_ids
                        .map(id => parseInt(id))
                        .filter(id => !isNaN(id) && id > 0);
                    
                    if (validGroupIds.length > 0) {
                        const values = validGroupIds.map(groupId => 
                            `(${guildUserId}, ${groupId}, '${req.session.user.info.id}')`
                        ).join(',');
                        
                        Logger.info(`[Permissions] Inserting new groups: ${validGroupIds.join(', ')}`);
                        
                        await dbService.query(`
                            INSERT INTO guild_user_groups (guild_user_id, group_id, assigned_by)
                            VALUES ${values}
                        `);
                        
                        Logger.info(`[Permissions] Successfully assigned ${validGroupIds.length} groups`);
                    } else {
                        Logger.warn(`[Permissions] No valid group IDs found in:`, group_ids);
                    }
                } else {
                    Logger.info(`[Permissions] No groups to assign (empty array or not an array)`);
                }
            } else {
                Logger.error(`[Permissions] Guild user not found for user_id ${userId} in guild ${guildId}`);
            }
        }
        
        Logger.info(`[Permissions] User ${userId} updated in guild ${guildId}`);
        
        res.json({
            success: true,
            message: 'Benutzer wurde aktualisiert'
        });
        
    } catch (error) {
        Logger.error('[Permissions] Error updating user:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Aktualisieren des Benutzers'
        });
    }
});

/**
 * DELETE /permissions/users/:userId
 * Entfernt einen User aus der Guild (Soft Delete via Status)
 */
router.delete('/users/:userId', requirePermission('PERMISSIONS.USERS.REMOVE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const permissionManager = ServiceManager.get('permissionManager');
    const guildId = res.locals.guildId;
    const userId = req.params.userId;
    
    try {
        await permissionManager.removeGuildUser(userId, guildId);
        
        Logger.info(`[Permissions] User ${userId} removed from guild ${guildId}`);
        
        res.json({
            success: true,
            message: 'Benutzer wurde entfernt'
        });
        
    } catch (error) {
        Logger.error('[Permissions] Error removing user:', error);
        
        if (error.message === 'Cannot remove guild owner') {
            return res.status(403).json({
                success: false,
                message: 'Der Server-Owner kann nicht entfernt werden'
            });
        }
        
        res.status(500).json({
            success: false,
            message: 'Fehler beim Entfernen des Benutzers'
        });
    }
});

/**
 * POST /permissions/users/:userId/groups
 * Weist einem User eine Gruppe zu
 */
router.post('/users/:userId/groups', requirePermission('PERMISSIONS.ASSIGN'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const permissionManager = ServiceManager.get('permissionManager');
    const userId = req.params.userId;
    const { group_id } = req.body;
    
    try {
        if (!group_id) {
            return res.status(400).json({
                success: false,
                message: 'Gruppen-ID fehlt'
            });
        }
        
        await permissionManager.assignUserToGroup(
            userId, 
            group_id, 
            req.session.user.info.id
        );
        
        Logger.info(`[Permissions] User ${userId} assigned to group ${group_id}`);
        
        res.json({
            success: true,
            message: 'Gruppe wurde zugewiesen'
        });
        
    } catch (error) {
        Logger.error('[Permissions] Error assigning group:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Zuweisen der Gruppe'
        });
    }
});

/**
 * DELETE /permissions/users/:userId/groups/:groupId
 * Entfernt eine Gruppe von einem User
 */
router.delete('/users/:userId/groups/:groupId', requirePermission('PERMISSIONS.ASSIGN'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const permissionManager = ServiceManager.get('permissionManager');
    const userId = req.params.userId;
    const groupId = req.params.groupId;
    
    try {
        await permissionManager.removeUserFromGroup(userId, groupId);
        
        Logger.info(`[Permissions] User ${userId} removed from group ${groupId}`);
        
        res.json({
            success: true,
            message: 'Gruppe wurde entfernt'
        });
        
    } catch (error) {
        Logger.error('[Permissions] Error removing group:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Entfernen der Gruppe'
        });
    }
});

// ============================================================================
// GROUP MANAGEMENT ROUTES
// ============================================================================

/**
 * GET /permissions/groups
 * Zeigt die Gruppen-Verwaltungs-Seite
 */
router.get('/groups', requirePermission('PERMISSIONS.GROUPS.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const permissionManager = ServiceManager.get('permissionManager');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');
    const guildId = res.locals.guildId;
    
    try {
        // Hole alle Gruppen mit member_count
        const groups = await permissionManager.getGuildGroups(guildId);
        
        // ✅ Parse JSON-Permissions aus guild_groups.permissions (NEW SYSTEM!)
        for (const group of groups) {
            // permissions kommt als JSON-String aus der View
            if (group.permissions && typeof group.permissions === 'string') {
                try {
                    group.permissions = JSON.parse(group.permissions);
                } catch (parseError) {
                    Logger.warn(`[Permissions GET /groups] Konnte permissions für Gruppe ${group.name} nicht parsen:`, parseError.message);
                    group.permissions = {};
                }
            } else if (!group.permissions) {
                // Fallback: Leeres Object falls null/undefined
                group.permissions = {};
            }
            
            const permCount = Object.keys(group.permissions).length;
            Logger.info(`[Permissions GET /groups] Gruppe ${group.name} (ID: ${group.id}): ${permCount} Permissions geladen`);
        }
        
        // Hole alle verfügbaren Permissions (global, kein guild_id-Filter)
        const permissions = await dbService.query(`
            SELECT * FROM permission_definitions
            WHERE is_active = 1
            ORDER BY category, sort_order, permission_key
        `);
        
        // Gruppiere Permissions nach Kategorie
        const permissionsByCategory = {};
        permissions.forEach(perm => {
            if (!permissionsByCategory[perm.category]) {
                permissionsByCategory[perm.category] = [];
            }
            permissionsByCategory[perm.category].push(perm);
        });
        
        await themeManager.renderView(res, 'guild/permissions/groups', {
            pageTitle: 'Gruppen-Verwaltung',
            groups: groups || [],
            permissions: permissionsByCategory,
            userPermissions: res.locals.userPermissions, // ← WICHTIG: Übergabe an View!
            guildId
        });
        
    } catch (error) {
        Logger.error('[Permissions] Error loading groups page:', error);
        res.status(500).render('error', {
            message: 'Fehler beim Laden der Gruppen-Verwaltung',
            error
        });
    }
});

/**
 * POST /permissions/groups
 * Erstellt eine neue Gruppe
 */
router.post('/groups', requirePermission('PERMISSIONS.GROUPS.CREATE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const permissionManager = ServiceManager.get('permissionManager');
    const guildId = res.locals.guildId;
    const { name, slug, description, color, icon, permissions, priority } = req.body;
    
    try {
        // Validierung
        if (!name || !slug) {
            return res.status(400).json({
                success: false,
                message: 'Name und Slug sind erforderlich'
            });
        }
        
        // Erstelle Gruppe
        const groupId = await permissionManager.createGroup(guildId, {
            name,
            slug,
            description,
            color: color || '#6c757d',
            icon: icon || 'fa-users',
            permissions: permissions || {},
            priority: priority || 0
        });
        
        Logger.info(`[Permissions] Group "${name}" created in guild ${guildId} (ID: ${groupId})`);
        
        res.json({
            success: true,
            message: 'Gruppe wurde erstellt',
            groupId
        });
        
    } catch (error) {
        Logger.error('[Permissions] Error creating group:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Erstellen der Gruppe'
        });
    }
});

/**
 * PUT /permissions/groups/:groupId
 * Bearbeitet eine Gruppe
 */
router.put('/groups/:groupId', requirePermission('PERMISSIONS.GROUPS.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const permissionManager = ServiceManager.get('permissionManager');
    const groupId = req.params.groupId;
    const updates = req.body;
    
    // DEBUG: Log incoming request
    Logger.info(`[Permissions PUT /groups/${groupId}] Request body keys:`, Object.keys(updates));
    if (updates.permissions) {
        const permCount = Object.keys(updates.permissions).length;
        const trueCount = Object.values(updates.permissions).filter(v => v === true || v === 'true').length;
        Logger.info(`[Permissions PUT /groups/${groupId}] Permissions: ${permCount} total, ${trueCount} true`);
    }
    
    try {
        await permissionManager.updateGroup(groupId, updates);
        
        Logger.info(`[Permissions] Group ${groupId} updated successfully`);
        
        res.json({
            success: true,
            message: 'Gruppe wurde aktualisiert'
        });
        
    } catch (error) {
        Logger.error(`[Permissions] Error updating group ${groupId}:`, error);
        Logger.error(`[Permissions] Error stack:`, error.stack);
        
        if (error.message.includes('Cannot modify protected group')) {
            return res.status(403).json({
                success: false,
                message: 'Geschützte Gruppen können nur in ihren Berechtigungen geändert werden'
            });
        }
        
        res.status(500).json({
            success: false,
            message: 'Fehler beim Aktualisieren der Gruppe'
        });
    }
});

/**
 * DELETE /permissions/groups/:groupId
 * Löscht eine Gruppe (nur wenn nicht protected)
 */
router.delete('/groups/:groupId', requirePermission('PERMISSIONS.GROUPS.DELETE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const permissionManager = ServiceManager.get('permissionManager');
    const groupId = req.params.groupId;
    
    try {
        await permissionManager.deleteGroup(groupId);
        
        Logger.info(`[Permissions] Group ${groupId} deleted`);
        
        res.json({
            success: true,
            message: 'Gruppe wurde gelöscht'
        });
        
    } catch (error) {
        Logger.error('[Permissions] Error deleting group:', error);
        
        if (error.message.includes('Cannot delete protected group')) {
            return res.status(403).json({
                success: false,
                message: 'Geschützte Gruppen können nicht gelöscht werden'
            });
        }
        
        if (error.message === 'Group not found') {
            return res.status(404).json({
                success: false,
                message: 'Gruppe nicht gefunden'
            });
        }
        
        res.status(500).json({
            success: false,
            message: 'Fehler beim Löschen der Gruppe'
        });
    }
});

// ============================================================================
// PERMISSION MATRIX ROUTE
// ============================================================================

/**
 * GET /permissions/matrix
 * Zeigt die Berechtigungsmatrix (Gruppen x Permissions)
 */
router.get('/matrix', requireAnyPermission(['PERMISSIONS.GROUPS.VIEW', 'PERMISSIONS.USERS.VIEW']), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const permissionManager = ServiceManager.get('permissionManager');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');
    const guildId = res.locals.guildId;
    
    try {
        // Hole alle Gruppen (permissions ist bereits als JSON in group.permissions enthalten)
        const groups = await permissionManager.getGuildGroups(guildId);

        // Stelle sicher dass group.permissions immer ein Objekt ist (mysql2 parst JSON automatisch)
        for (const group of groups) {
            if (!group.permissions || typeof group.permissions === 'string') {
                try {
                    group.permissions = group.permissions ? JSON.parse(group.permissions) : {};
                } catch {
                    group.permissions = {};
                }
            }
        }

        // Hole alle verfügbaren Permissions (global, kein guild_id-Filter)
        const permissions = await dbService.query(`
            SELECT * FROM permission_definitions
            WHERE is_active = 1
            ORDER BY category, sort_order, permission_key
        `);

        // SYSTEM & SUPERADMIN Kategorien nur auf der Control-Guild anzeigen
        const isControlGuild = guildId === process.env.CONTROL_GUILD_ID;
        const filteredPermissions = isControlGuild
            ? permissions
            : permissions.filter(perm => perm.category !== 'system' && perm.category !== 'superadmin');

        // Translation-Keys auflösen (Kern-Permissions nutzen 'core' Namespace)
        const i18n = ServiceManager.get('i18n');
        filteredPermissions.forEach(perm => {
            if (perm.name_translation_key) {
                let translated = i18n.tr(perm.name_translation_key);
                if (translated === perm.name_translation_key) {
                    translated = i18n.tr('core:' + perm.name_translation_key);
                }
                perm.resolved_name = translated;
            }
            if (perm.description_translation_key) {
                let translated = i18n.tr(perm.description_translation_key);
                if (translated === perm.description_translation_key) {
                    translated = i18n.tr('core:' + perm.description_translation_key);
                }
                perm.resolved_description = translated;
            }
        });

        // Gruppiere nach Kategorie
        const permissionsByCategory = {};
        filteredPermissions.forEach(perm => {
            if (!permissionsByCategory[perm.category]) {
                permissionsByCategory[perm.category] = [];
            }
            permissionsByCategory[perm.category].push(perm);
        });
        
        await themeManager.renderView(res, 'guild/permissions/matrix', {
            pageTitle: 'Berechtigungsmatrix',
            groups: groups || [],
            permissions: permissionsByCategory,
            userPermissions: res.locals.userPermissions, // ← WICHTIG: Übergabe an View!
            guildId
        });
        
    } catch (error) {
        Logger.error('[Permissions] Error loading matrix page:', error);
        res.status(500).render('error', {
            message: 'Fehler beim Laden der Berechtigungsmatrix',
            error
        });
    }
});

/**
 * POST /permissions/matrix
 * Speichert Bulk-Updates für die Berechtigungsmatrix (RELATIONAL!)
 */
router.post('/matrix', requirePermission('PERMISSIONS.ASSIGN'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const permissionManager = ServiceManager.get('permissionManager');
    const guildId = res.locals.guildId;
    const { updates } = req.body;
    
    try {
        if (!updates || typeof updates !== 'object') {
            return res.status(400).json({
                success: false,
                message: 'Ungültige Update-Daten'
            });
        }
        
        // Für jede Gruppe: Permissions MERGEN (nicht ersetzen!)
        // SYSTEM & SUPERADMIN Permissions nur auf der Control-Guild erlauben
        const isControlGuild = guildId === process.env.CONTROL_GUILD_ID;
        const restrictedPrefixes = ['SYSTEM.', 'SUPERADMIN.'];

        for (const [groupId, permissions] of Object.entries(updates)) {
            // Prüfe ob Gruppe zu dieser Guild gehört
            const groups = await dbService.query(
                'SELECT guild_id, permissions FROM guild_groups WHERE id = ? AND guild_id = ?',
                [groupId, guildId]
            );
            
            if (!groups || groups.length === 0) {
                Logger.warn(`[Permissions] Group ${groupId} not found or not in guild ${guildId}`);
                continue;
            }
            
            // Bestehende Permissions laden
            let existingPerms = groups[0].permissions || {};
            if (typeof existingPerms === 'string') {
                try { existingPerms = JSON.parse(existingPerms); } catch { existingPerms = {}; }
            }
            
            // Merge: Änderungen auf bestehende Permissions anwenden
            const mergedPermissions = { ...existingPerms };
            for (const [permKey, value] of Object.entries(permissions)) {
                // SYSTEM/SUPERADMIN Permissions auf Nicht-Control-Guilds blocken
                if (!isControlGuild && restrictedPrefixes.some(prefix => permKey.startsWith(prefix))) {
                    Logger.warn(`[Permissions] Blocked restricted permission ${permKey} for non-control guild ${guildId}`);
                    continue;
                }
                if (value === true || value === 'true' || value === '1') {
                    mergedPermissions[permKey] = true;
                } else {
                    // false/unchecked → Permission entfernen
                    delete mergedPermissions[permKey];
                }
            }
            
            // updateGroup mit vollständigem Permission-Set aufrufen
            await permissionManager.updateGroup(parseInt(groupId), { permissions: mergedPermissions });
            
            Logger.info(`[Permissions] Updated permissions for group ${groupId} (RELATIONAL)`);
        }
        
        res.json({
            success: true,
            message: 'Berechtigungen erfolgreich aktualisiert'
        });
        
    } catch (error) {
        Logger.error('[Permissions] Error updating matrix:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Aktualisieren der Berechtigungen'
        });
    }
});

module.exports = router;
