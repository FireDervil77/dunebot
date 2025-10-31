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
} = require('../../../../apps/dashboard/middlewares/permissions.middleware');

// Middleware: Lade User-Permissions für alle Routes
router.use(loadUserPermissions);

// ============================================================================
// USER MANAGEMENT ROUTES
// ============================================================================

/**
 * GET /permissions/users
 * Zeigt die User-Verwaltungs-Seite
 */
router.get('/users', requirePermission('permissions.users.view'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const permissionManager = ServiceManager.get('permissionManager');
    const guildId = res.locals.guildId;
    
    try {
        // Hole alle User dieser Guild mit aggregierten Permissions
        const users = await dbService.query(`
            SELECT 
                gu.*,
                u.username,
                u.avatar,
                u.discriminator,
                GROUP_CONCAT(DISTINCT gg.name ORDER BY gg.priority DESC SEPARATOR ', ') as group_names,
                GROUP_CONCAT(DISTINCT gg.id ORDER BY gg.priority DESC) as group_ids,
                GROUP_CONCAT(DISTINCT gg.color ORDER BY gg.priority DESC) as group_colors
            FROM guild_users gu
            LEFT JOIN users u ON gu.user_id = u.user_id
            LEFT JOIN guild_user_groups gug ON gu.id = gug.guild_user_id
            LEFT JOIN guild_groups gg ON gug.group_id = gg.id
            WHERE gu.guild_id = ? AND gu.status = 'active'
            GROUP BY gu.id
            ORDER BY gu.is_owner DESC, gu.created_at DESC
        `, [guildId]);
        
        // Parse JSON permissions
        users.forEach(user => {
            if (user.direct_permissions) {
                user.direct_permissions = JSON.parse(user.direct_permissions);
            }
        });
        
        res.render('guild/permissions/users', {
            pageTitle: 'Benutzer-Verwaltung',
            users: users || [],
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
 * POST /permissions/users/invite
 * Lädt einen Discord-User ein (sendet DM mit Einladungslink)
 */
router.post('/users/invite', requirePermission('permissions.users.invite'), async (req, res) => {
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
router.put('/users/:userId', requirePermission('permissions.users.edit'), async (req, res) => {
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
            const directPermsJson = direct_permissions ? JSON.stringify(direct_permissions) : null;
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
            const [guildUser] = await dbService.query(
                'SELECT id FROM guild_users WHERE user_id = ? AND guild_id = ?',
                [userId, guildId]
            );
            
            if (guildUser && guildUser[0]) {
                const guildUserId = guildUser[0].id;
                
                // Alle alten Gruppen entfernen
                await dbService.query(
                    'DELETE FROM guild_user_groups WHERE guild_user_id = ?',
                    [guildUserId]
                );
                
                // Neue Gruppen zuweisen
                if (Array.isArray(group_ids) && group_ids.length > 0) {
                    const values = group_ids.map(groupId => 
                        `(${guildUserId}, ${groupId}, '${req.session.user.info.id}')`
                    ).join(',');
                    
                    await dbService.query(`
                        INSERT INTO guild_user_groups (guild_user_id, group_id, assigned_by)
                        VALUES ${values}
                    `);
                }
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
router.delete('/users/:userId', requirePermission('permissions.users.remove'), async (req, res) => {
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
router.post('/users/:userId/groups', requirePermission('permissions.assign'), async (req, res) => {
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
router.delete('/users/:userId/groups/:groupId', requirePermission('permissions.assign'), async (req, res) => {
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
router.get('/groups', requirePermission('permissions.groups.view'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const permissionManager = ServiceManager.get('permissionManager');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    
    try {
        // Hole alle Gruppen mit member_count
        const groups = await permissionManager.getGuildGroups(guildId);
        
        // Parse JSON permissions
        groups.forEach(group => {
            if (group.permissions) {
                group.permissions = JSON.parse(group.permissions);
            }
        });
        
        // Hole alle verfügbaren Permissions für Checkboxes
        const permissions = await dbService.query(`
            SELECT * FROM permission_definitions
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
        
        res.render('guild/permissions/groups', {
            pageTitle: 'Gruppen-Verwaltung',
            groups: groups || [],
            permissions: permissionsByCategory,
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
router.post('/groups', requirePermission('permissions.groups.create'), async (req, res) => {
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
router.put('/groups/:groupId', requirePermission('permissions.groups.edit'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const permissionManager = ServiceManager.get('permissionManager');
    const groupId = req.params.groupId;
    const updates = req.body;
    
    try {
        await permissionManager.updateGroup(groupId, updates);
        
        Logger.info(`[Permissions] Group ${groupId} updated`);
        
        res.json({
            success: true,
            message: 'Gruppe wurde aktualisiert'
        });
        
    } catch (error) {
        Logger.error('[Permissions] Error updating group:', error);
        
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
router.delete('/groups/:groupId', requirePermission('permissions.groups.delete'), async (req, res) => {
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
router.get('/matrix', requireAnyPermission(['permissions.groups.view', 'permissions.users.view']), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const permissionManager = ServiceManager.get('permissionManager');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    
    try {
        // Hole alle Gruppen
        const groups = await permissionManager.getGuildGroups(guildId);
        
        // Parse Permissions
        groups.forEach(group => {
            if (group.permissions) {
                group.permissions = JSON.parse(group.permissions);
            }
        });
        
        // Hole alle Permissions
        const permissions = await dbService.query(`
            SELECT * FROM permission_definitions
            ORDER BY category, sort_order, permission_key
        `);
        
        // Gruppiere nach Kategorie
        const permissionsByCategory = {};
        permissions.forEach(perm => {
            if (!permissionsByCategory[perm.category]) {
                permissionsByCategory[perm.category] = [];
            }
            permissionsByCategory[perm.category].push(perm);
        });
        
        res.render('guild/permissions/matrix', {
            pageTitle: 'Berechtigungsmatrix',
            groups: groups || [],
            permissions: permissionsByCategory,
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

module.exports = router;
