/**
 * PermissionManager - Zentrales Permission-System für DuneBot
 * 
 * Verwaltet granulare Berechtigungen für Guild-User im Dashboard.
 * Unterstützt:
 * - Gruppen-basierte Permissions
 * - Direct Permissions (überschreiben Gruppen)
 * - Hierarchische Permission-Keys (plugin.resource.action)
 * - Wildcard-Permissions (admin hat "wildcard": true)
 * - Permission-Dependencies (console.execute requires console.view)
 * 
 * @author FireDervil
 * @version 2.0.0
 * @date 2025-10-30
 */

const { ServiceManager } = require('dunebot-core');

class PermissionManager {
  constructor() {
    this.dbService = null;
    this.logger = null;
    this._initialized = false;
  }

  /**
   * Initialisiert den PermissionManager mit Services
   */
  async initialize() {
    if (this._initialized) return;
    
    this.dbService = ServiceManager.get('dbService');
    this.logger = ServiceManager.get('Logger');
    this._initialized = true;
    
    this.logger.info('[PermissionManager] Initialized');
  }

  /**
   * Prüft ob PermissionManager initialisiert ist
   * @throws {Error} Wenn nicht initialisiert
   */
  _ensureInitialized() {
    if (!this._initialized) {
      throw new Error('PermissionManager not initialized. Call initialize() first.');
    }
  }

  // ============================================================================
  // SEED DEFAULT GROUPS
  // ============================================================================

  /**
   * Erstellt Standard-Gruppen für eine Guild
   * Wird automatisch aufgerufen wenn Bot einer Guild beitritt
   * 
   * @param {string} guildId - Discord Guild ID
   * @returns {Promise<Object>} Erstellte Gruppen { administrator, moderators, support, viewer }
   */
  async seedDefaultGroups(guildId) {
    this._ensureInitialized();
    
    try {
      // Prüfe ob Gruppen bereits existieren
      const existing = await this.dbService.query(
        'SELECT slug FROM guild_groups WHERE guild_id = ?',
        [guildId]
      );
      
      if (existing.length > 0) {
        this.logger.warn(`[PermissionManager] Guild ${guildId} has already ${existing.length} groups, skipping seed`);
        return null;
      }

      this.logger.info(`[PermissionManager] Seeding default groups for guild ${guildId}`);

      // 1. Administrator-Gruppe (Protected, explizite Permissions + Wildcard-Support)
      const adminPerms = JSON.stringify({
        wildcard: true,
        // Explizite Permissions für bessere UI-Kompatibilität
        'permissions.view': true,
        'permissions.users.view': true,
        'permissions.users.invite': true,
        'permissions.users.edit': true,
        'permissions.users.remove': true,
        'permissions.groups.view': true,
        'permissions.groups.create': true,
        'permissions.groups.edit': true,
        'permissions.groups.delete': true,
        'permissions.assign': true,  // ← WICHTIG für Matrix-Editing!
        'gameserver.view': true,
        'gameserver.create': true,
        'gameserver.edit': true,
        'gameserver.delete': true,
        'gameserver.start': true,
        'gameserver.stop': true,
        'gameserver.restart': true,
        'gameserver.console.view': true,
        'gameserver.console.execute': true,
        'gameserver.files.view': true,
        'gameserver.files.upload': true,
        'gameserver.files.download': true,
        'gameserver.files.delete': true,
        'gameserver.settings.edit': true,
        'moderation.view': true,
        'moderation.ban': true,
        'moderation.kick': true,
        'moderation.warn': true,
        'moderation.mute': true,
        'moderation.settings.edit': true,
        'core.settings.view': true,
        'core.settings.edit': true,
        'core.plugins.manage': true
      });
      const [adminResult] = await this.dbService.query(
        `INSERT INTO guild_groups 
        (guild_id, name, slug, description, color, icon, permissions, is_protected, is_default, priority, sort_order) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          guildId,
          'Administrator',
          'administrator',
          'Vollzugriff auf alle Dashboard-Funktionen',
          '#dc3545',
          'fa-shield-alt',
          adminPerms,
          true, // is_protected
          false,
          100,
          1
        ]
      );

      // 2. Moderatoren-Gruppe
      const modPerms = JSON.stringify({
        'gameserver.view': true,
        'gameserver.start': true,
        'gameserver.stop': true,
        'gameserver.restart': true,
        'gameserver.console.view': true,
        'gameserver.console.execute': true,
        'gameserver.files.view': true,
        'gameserver.files.upload': true,
        'gameserver.files.download': true,
        'moderation.view': true,
        'moderation.ban': true,
        'moderation.kick': true,
        'moderation.warn': true,
        'moderation.mute': true
      });
      
      const [modResult] = await this.dbService.query(
        `INSERT INTO guild_groups 
        (guild_id, name, slug, description, color, icon, permissions, is_protected, is_default, priority, sort_order) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          guildId,
          'Moderatoren',
          'moderators',
          'Server-Verwaltung und Moderation',
          '#007bff',
          'fa-user-shield',
          modPerms,
          false,
          false,
          50,
          2
        ]
      );

      // 3. Support-Gruppe
      const supportPerms = JSON.stringify({
        'gameserver.view': true,
        'gameserver.console.view': true,
        'gameserver.files.view': true,
        'gameserver.files.download': true,
        'moderation.view': true
      });
      
      const [supportResult] = await this.dbService.query(
        `INSERT INTO guild_groups 
        (guild_id, name, slug, description, color, icon, permissions, is_protected, is_default, priority, sort_order) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          guildId,
          'Support',
          'support',
          'Nur-Lesezugriff für Support-Zwecke',
          '#28a745',
          'fa-headset',
          supportPerms,
          false,
          false,
          25,
          3
        ]
      );

      // 4. Viewer-Gruppe (Default)
      const viewerPerms = JSON.stringify({
        'gameserver.view': true,
        'moderation.view': true
      });
      
      const [viewerResult] = await this.dbService.query(
        `INSERT INTO guild_groups 
        (guild_id, name, slug, description, color, icon, permissions, is_protected, is_default, priority, sort_order) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          guildId,
          'Viewer',
          'viewer',
          'Minimaler Lesezugriff',
          '#6c757d',
          'fa-eye',
          viewerPerms,
          false,
          true, // is_default
          0,
          4
        ]
      );

      this.logger.info(`[PermissionManager] Created 4 default groups for guild ${guildId}`);

      return {
        administrator: adminResult.insertId,
        moderators: modResult.insertId,
        support: supportResult.insertId,
        viewer: viewerResult.insertId
      };
      
    } catch (error) {
      this.logger.error(`[PermissionManager] Error seeding groups for guild ${guildId}:`, error);
      throw error;
    }
  }

  // ============================================================================
  // PERMISSION CHECKS
  // ============================================================================

  /**
   * Prüft ob ein User eine bestimmte Permission hat
   * Berücksichtigt:
   * - Guild Owner (hat immer alle Rechte)
   * - Direct Permissions (überschreiben Gruppen)
   * - Gruppen-Permissions (höchste Priorität zählt)
   * - Wildcard-Permissions
   * 
   * @param {string} userId - Discord User ID
   * @param {string} guildId - Discord Guild ID
   * @param {string} permissionKey - Permission Key (z.B. "gameserver.start")
   * @returns {Promise<boolean>} Hat User die Permission?
   */
  async hasPermission(userId, guildId, permissionKey) {
    this._ensureInitialized();
    
    try {
      // 1. Prüfe ob User Guild-Owner ist
      const [guild] = await this.dbService.query(
        'SELECT owner_id FROM guilds WHERE _id = ?',
        [guildId]
      );
      
      if (guild && guild.owner_id === userId) {
        this.logger.debug(`[Permission] ✅ User ${userId} ist Guild-Owner → Alle Permissions`);
        return true; // Owner hat immer alle Rechte
      }

      // 2. Hole User mit allen Permissions (View nutzt bereits die Aggregation)
      const user = await this.dbService.query(
        'SELECT * FROM v_guild_user_permissions WHERE user_id = ? AND guild_id = ?',
        [userId, guildId]
      );

      if (!user || !Array.isArray(user) || user.length === 0) {
        return false; // User hat keinen Zugriff auf diese Guild
      }

      const userData = user[0];
      
      // Safety-Check
      if (!userData) {
        return false;
      }

      // 3. Prüfe Direct Permissions (haben Vorrang)
      if (userData.direct_permissions) {
        const directPerms = typeof userData.direct_permissions === 'string' 
          ? JSON.parse(userData.direct_permissions) 
          : userData.direct_permissions;
        
        // Wildcard in direct permissions
        if (directPerms.wildcard === true) {
          return true;
        }
        
        // Explizite Permission in direct permissions
        if (directPerms[permissionKey] === true) {
          return true;
        }
        
        // Explizit verweigert in direct permissions
        if (directPerms[permissionKey] === false) {
          return false;
        }
      }

      // 4. Prüfe Gruppen-Permissions
      if (userData.group_permissions) {
        const groupPerms = typeof userData.group_permissions === 'string'
          ? JSON.parse(userData.group_permissions)
          : userData.group_permissions;
        
        // Wildcard in Gruppen
        if (groupPerms.wildcard === true) {
          return true;
        }
        
        // Explizite Permission in Gruppen
        if (groupPerms[permissionKey] === true) {
          return true;
        }
      }

      return false;
      
    } catch (error) {
      this.logger.error(`[PermissionManager] Error checking permission ${permissionKey} for user ${userId} in guild ${guildId}:`, error);
      return false; // Im Fehlerfall: Kein Zugriff
    }
  }

  /**
   * Prüft ob User mindestens EINE der Permissions hat
   * 
   * @param {string} userId - Discord User ID
   * @param {string} guildId - Discord Guild ID
   * @param {string[]} permissionKeys - Array von Permission Keys
   * @returns {Promise<boolean>}
   */
  async hasAnyPermission(userId, guildId, permissionKeys) {
    for (const key of permissionKeys) {
      if (await this.hasPermission(userId, guildId, key)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Prüft ob User ALLE Permissions hat
   * 
   * @param {string} userId - Discord User ID
   * @param {string} guildId - Discord Guild ID
   * @param {string[]} permissionKeys - Array von Permission Keys
   * @returns {Promise<boolean>}
   */
  async hasAllPermissions(userId, guildId, permissionKeys) {
    for (const key of permissionKeys) {
      if (!(await this.hasPermission(userId, guildId, key))) {
        return false;
      }
    }
    return true;
  }

  /**
   * Gibt alle Permissions eines Users zurück (Direct + Gruppen aggregiert)
   * 
   * @param {string} userId - Discord User ID
   * @param {string} guildId - Discord Guild ID
   * @returns {Promise<Object>} { permissions: {...}, groups: [...], is_owner: bool }
   */
  async getUserPermissions(userId, guildId) {
    this._ensureInitialized();
    
    try {
      // 1. Prüfe ob Owner oder Bot-Admin
      const [guild] = await this.dbService.query(
        'SELECT owner_id FROM guilds WHERE _id = ?',
        [guildId]
      );
      
      const isOwner = guild && guild[0]?.owner_id === userId;
      
      // Bot-Admin-Check (aus .env OWNER_IDS)
      const botAdminIds = process.env.OWNER_IDS ? process.env.OWNER_IDS.split(',') : [];
      const isBotAdmin = botAdminIds.includes(userId);

      // 2. Hole User-Daten aus View
      const user = await this.dbService.query(
        'SELECT * FROM v_guild_user_permissions WHERE user_id = ? AND guild_id = ?',
        [userId, guildId]
      );

      // User existiert nicht in guild_users?
      if (!user || !Array.isArray(user) || user.length === 0) {
        // FALL 1: Guild-Owner oder Bot-Admin → Automatisch erstellen!
        if (isOwner || isBotAdmin) {
          this.logger.info(`[Permission] ${isBotAdmin ? 'Bot-Admin' : 'Guild-Owner'} ${userId} nicht in guild_users → Erstelle mit Administrator-Rechten...`);
          
          try {
            // User erstellen (korrekte Signatur: userId, guildId, options)
            await this.upsertGuildUser(userId, guildId, {
              status: 'active',
              direct_permissions: null
            });
            
            // Zur Administrator-Gruppe hinzufügen
            const adminGroup = await this.dbService.query(
              'SELECT id FROM guild_groups WHERE guild_id = ? AND name = ?',
              [guildId, 'Administrator']
            );
            
            if (adminGroup && adminGroup.length > 0) {
              // Hole guild_users.id für den User
              const guildUser = await this.dbService.query(
                'SELECT id FROM guild_users WHERE guild_id = ? AND user_id = ?',
                [guildId, userId]
              );
              
              if (guildUser && guildUser.length > 0) {
                await this.dbService.query(
                  'INSERT IGNORE INTO guild_user_groups (guild_user_id, group_id) VALUES (?, ?)',
                  [guildUser[0].id, adminGroup[0].id]
                );
                this.logger.success(`[Permission] ${isBotAdmin ? 'Bot-Admin' : 'Owner'} ${userId} zur Administrator-Gruppe hinzugefügt`);
              } else {
                this.logger.error(`[Permission] guild_users.id nicht gefunden für User ${userId}!`);
              }
            } else {
              this.logger.error(`[Permission] Administrator-Gruppe nicht gefunden in Guild ${guildId}!`);
            }
            
            // Query nochmal ausführen
            const userRetry = await this.dbService.query(
              'SELECT * FROM v_guild_user_permissions WHERE user_id = ? AND guild_id = ?',
              [userId, guildId]
            );
            
            if (userRetry && userRetry.length > 0) {
              const userData = userRetry[0];
              
              // Permissions aus View laden
              let permissions = {};
              
              if (userData.group_permissions && typeof userData.group_permissions === 'string') {
                const permStrings = userData.group_permissions.split('|||').filter(Boolean);
                for (const permString of permStrings) {
                  try {
                    const perms = JSON.parse(permString);
                    permissions = { ...permissions, ...perms };
                  } catch (parseErr) {
                    // Ignore
                  }
                }
              }
              
              if (userData.direct_permissions) {
                permissions = { ...permissions, ...userData.direct_permissions };
              }
              
              return {
                permissions,
                groups: userData.groups ? userData.groups.split(',') : [],
                is_owner: isOwner
              };
            }
          } catch (createErr) {
            this.logger.error('[Permission] Fehler beim Auto-Erstellen von Admin:', createErr);
          }
        }
        
        // FALL 2: Normaler User → Keine Permissions (muss vom Admin eingeladen werden)
        this.logger.debug(`[Permission] User ${userId} nicht in guild_users → Keine Permissions (muss eingeladen werden)`);
        return { 
          permissions: {}, 
          groups: [], 
          is_owner: isOwner 
        };
      }

      const userData = user[0];
      
      // Safety-Check
      if (!userData) {
        this.logger.warn(`[Permission] userData ist undefined für User ${userId}`);
        return { 
          permissions: {}, 
          groups: [], 
          is_owner: isOwner 
        };
      }

      // 3. Aggregiere Permissions
      let permissions = {};

      // Gruppen-Permissions (Basis)
      // WICHTIG: group_permissions ist concatenated String "perm1|||perm2|||..."
      if (userData && userData.group_permissions) {
        const groupPermsRaw = userData.group_permissions;
        
        // Split und merge (höchste Priorität = zuerst)
        if (groupPermsRaw && typeof groupPermsRaw === 'string') {
          const permStrings = groupPermsRaw.split('|||').filter(Boolean);
          
          for (const permString of permStrings) {
            try {
              const perms = typeof permString === 'string' 
                ? JSON.parse(permString) 
                : permString;
              
              // Merge: Spätere (höhere Priorität) überschreiben frühere
              permissions = { ...permissions, ...perms };
            } catch (parseErr) {
              // Ignore ungültige JSON-Strings
            }
          }
        }
      }

      // Direct Permissions (überschreiben Gruppen)
      if (userData.direct_permissions) {
        const directPerms = typeof userData.direct_permissions === 'string'
          ? JSON.parse(userData.direct_permissions)
          : userData.direct_permissions;
        permissions = { ...permissions, ...directPerms };
      }

      // Owner hat Wildcard
      if (isOwner) {
        permissions.wildcard = true;
      }

      // 4. Hole Gruppen-Details
      const groups = await this.dbService.query(
        `SELECT gg.id, gg.name, gg.slug, gg.color, gg.icon, gg.priority
         FROM guild_user_groups gug
         JOIN guild_groups gg ON gug.group_id = gg.id
         JOIN guild_users gu ON gug.guild_user_id = gu.id
         WHERE gu.user_id = ? AND gu.guild_id = ?
         ORDER BY gg.priority DESC`,
        [userId, guildId]
      );

      return {
        permissions,
        groups: groups || [],
        is_owner: isOwner
      };
      
    } catch (error) {
      this.logger.error(`[PermissionManager] Error getting user permissions for ${userId} in guild ${guildId}:`, error);
      return { permissions: {}, groups: [], is_owner: false };
    }
  }

  // ============================================================================
  // USER MANAGEMENT
  // ============================================================================

  /**
   * Erstellt oder aktualisiert einen Guild-User
   * 
   * @param {string} userId - Discord User ID
   * @param {string} guildId - Discord Guild ID
   * @param {Object} options - { direct_permissions, status, expires_at }
   * @returns {Promise<number>} Guild User ID
   */
  async upsertGuildUser(userId, guildId, options = {}) {
    this._ensureInitialized();
    
    const {
      direct_permissions = null,
      status = 'active',
      expires_at = null
    } = options;

    // Prüfe ob User Owner ist
    const guilds = await this.dbService.query(
      'SELECT owner_id FROM guilds WHERE _id = ?',
      [guildId]
    );
    const isOwner = guilds && guilds[0]?.owner_id === userId ? 1 : 0;

    const directPermsJson = direct_permissions ? JSON.stringify(direct_permissions) : null;

    // INSERT ON DUPLICATE KEY UPDATE
    const result = await this.dbService.query(
      `INSERT INTO guild_users (user_id, guild_id, is_owner, direct_permissions, status, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         direct_permissions = VALUES(direct_permissions),
         status = VALUES(status),
         expires_at = VALUES(expires_at),
         is_owner = VALUES(is_owner),
         updated_at = NOW()`,
      [userId, guildId, isOwner, directPermsJson, status, expires_at]
    );

    const guildUserId = result.insertId || (await this.dbService.query(
      'SELECT id FROM guild_users WHERE user_id = ? AND guild_id = ?',
      [userId, guildId]
    ))[0]?.id;

    this.logger.info(`[PermissionManager] Upserted guild user ${userId} in guild ${guildId} (ID: ${guildUserId})`);

    return guildUserId;
  }

  /**
   * Entfernt einen User aus einer Guild (soft delete via status)
   * 
   * @param {string} userId - Discord User ID
   * @param {string} guildId - Discord Guild ID
   * @returns {Promise<boolean>} Erfolgreich entfernt?
   */
  async removeGuildUser(userId, guildId) {
    this._ensureInitialized();
    
    // Owner kann nicht entfernt werden
    const [guild] = await this.dbService.query(
      'SELECT owner_id FROM guilds WHERE _id = ?',
      [guildId]
    );
    
    if (guild && guild[0]?.owner_id === userId) {
      throw new Error('Cannot remove guild owner');
    }

    // User komplett aus guild_users entfernen (inkl. Gruppen-Zuweisungen via CASCADE)
    await this.dbService.query(
      'DELETE FROM guild_users WHERE user_id = ? AND guild_id = ?',
      [userId, guildId]
    );

    // ✅ NEU: Session des Users beenden (sofortiges Logout)
    try {
      const ServiceManager = require('dunebot-core').ServiceManager;
      const sessionManager = ServiceManager.get('sessionManager');
      
      if (sessionManager) {
        // Lösche alle Sessions dieses Users für diese Guild
        await sessionManager.destroyUserGuildSessions(userId, guildId);
        this.logger.info(`[PermissionManager] Session destroyed for user ${userId} in guild ${guildId}`);
      }
    } catch (sessionError) {
      // Session-Fehler nicht kritisch (User ist trotzdem aus DB entfernt)
      this.logger.warn(`[PermissionManager] Failed to destroy session for ${userId}:`, sessionError.message);
    }

    this.logger.info(`[PermissionManager] Removed user ${userId} from guild ${guildId}`);
    return true;
  }

  /**
   * Weist einen User einer Gruppe zu
   * 
   * @param {string} userId - Discord User ID
   * @param {number} groupId - Group ID
   * @param {string} assignedBy - User ID des Zuweisenden
   * @returns {Promise<boolean>}
   */
  async assignUserToGroup(userId, groupId, assignedBy) {
    this._ensureInitialized();
    
    // Hole guild_user_id
    const [guildUser] = await this.dbService.query(
      'SELECT id, guild_id FROM guild_users WHERE user_id = ? AND id IN (SELECT guild_user_id FROM guild_user_groups WHERE group_id = ?)',
      [userId, groupId]
    );

    if (!guildUser || guildUser.length === 0) {
      // Hole guild_id von Gruppe
      const [group] = await this.dbService.query(
        'SELECT guild_id FROM guild_groups WHERE id = ?',
        [groupId]
      );
      
      if (!group || group.length === 0) {
        throw new Error('Group not found');
      }

      // Erstelle guild_user wenn nicht existiert
      const guildUserId = await this.upsertGuildUser(userId, group[0].guild_id);
      
      await this.dbService.query(
        'INSERT INTO guild_user_groups (guild_user_id, group_id, assigned_by) VALUES (?, ?, ?)',
        [guildUserId, groupId, assignedBy]
      );
    } else {
      await this.dbService.query(
        'INSERT IGNORE INTO guild_user_groups (guild_user_id, group_id, assigned_by) VALUES (?, ?, ?)',
        [guildUser[0].id, groupId, assignedBy]
      );
    }

    this.logger.info(`[PermissionManager] Assigned user ${userId} to group ${groupId} by ${assignedBy}`);
    return true;
  }

  /**
   * Entfernt einen User aus einer Gruppe
   * 
   * @param {string} userId - Discord User ID
   * @param {number} groupId - Group ID
   * @returns {Promise<boolean>}
   */
  async removeUserFromGroup(userId, groupId) {
    this._ensureInitialized();
    
    await this.dbService.query(
      `DELETE FROM guild_user_groups 
       WHERE guild_user_id IN (SELECT id FROM guild_users WHERE user_id = ?)
       AND group_id = ?`,
      [userId, groupId]
    );

    this.logger.info(`[PermissionManager] Removed user ${userId} from group ${groupId}`);
    return true;
  }

  // ============================================================================
  // GROUP MANAGEMENT
  // ============================================================================

  /**
   * Erstellt eine neue Permission-Gruppe
   * 
   * @param {string} guildId - Discord Guild ID
   * @param {Object} groupData - { name, slug, description, color, icon, permissions, priority }
   * @returns {Promise<number>} Group ID
   */
  async createGroup(guildId, groupData) {
    this._ensureInitialized();
    
    const {
      name,
      slug,
      description = null,
      color = '#6c757d',
      icon = 'fa-users',
      permissions = {},
      is_default = false,
      priority = 0
    } = groupData;

    const permissionsJson = JSON.stringify(permissions);

    const result = await this.dbService.query(
      `INSERT INTO guild_groups 
       (guild_id, name, slug, description, color, icon, permissions, is_default, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [guildId, name, slug, description, color, icon, permissionsJson, is_default, priority]
    );

    this.logger.info(`[PermissionManager] Created group ${name} (${slug}) in guild ${guildId}`);
    return result.insertId;
  }

  /**
   * Aktualisiert eine Gruppe
   * 
   * @param {number} groupId - Group ID
   * @param {Object} updates - Felder zum Aktualisieren
   * @returns {Promise<boolean>}
   */
  async updateGroup(groupId, updates) {
    this._ensureInitialized();
    
    // Prüfe ob Gruppe protected ist
    const [group] = await this.dbService.query(
      'SELECT is_protected FROM guild_groups WHERE id = ?',
      [groupId]
    );

    if (group && group[0]?.is_protected) {
      // Protected Gruppen: Nur permissions dürfen geändert werden
      if (Object.keys(updates).some(key => key !== 'permissions')) {
        throw new Error('Cannot modify protected group (only permissions can be changed)');
      }
    }

    const allowedFields = ['name', 'slug', 'description', 'color', 'icon', 'permissions', 'priority'];
    const updateFields = [];
    const updateValues = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        updateFields.push(`${key} = ?`);
        
        if (key === 'permissions') {
          // Konvertiere String "true" zu boolean true in permissions
          const cleanedPerms = {};
          if (value && typeof value === 'object') {
            Object.keys(value).forEach(permKey => {
              cleanedPerms[permKey] = value[permKey] === 'true' || value[permKey] === true;
            });
          }
          updateValues.push(JSON.stringify(cleanedPerms));
        } else {
          updateValues.push(value);
        }
      }
    }

    if (updateFields.length === 0) {
      return false;
    }

    updateValues.push(groupId);

    await this.dbService.query(
      `UPDATE guild_groups SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ?`,
      updateValues
    );

    this.logger.info(`[PermissionManager] Updated group ${groupId}`);
    return true;
  }

  /**
   * Löscht eine Gruppe
   * Protected Gruppen können nicht gelöscht werden!
   * 
   * @param {number} groupId - Group ID
   * @returns {Promise<boolean>}
   */
  async deleteGroup(groupId) {
    this._ensureInitialized();
    
    // Prüfe ob Gruppe protected ist
    const [group] = await this.dbService.query(
      'SELECT is_protected, name FROM guild_groups WHERE id = ?',
      [groupId]
    );

    if (!group || group.length === 0) {
      throw new Error('Group not found');
    }

    if (group[0].is_protected) {
      throw new Error(`Cannot delete protected group: ${group[0].name}`);
    }

    // DELETE CASCADE entfernt automatisch guild_user_groups Einträge
    await this.dbService.query(
      'DELETE FROM guild_groups WHERE id = ?',
      [groupId]
    );

    this.logger.info(`[PermissionManager] Deleted group ${groupId}`);
    return true;
  }

  /**
   * Gibt alle Gruppen einer Guild zurück
   * 
   * @param {string} guildId - Discord Guild ID
   * @returns {Promise<Array>} Array von Gruppen
   */
  async getGuildGroups(guildId) {
    this._ensureInitialized();
    
    const groups = await this.dbService.query(
      'SELECT * FROM v_guild_groups_summary WHERE guild_id = ? ORDER BY priority DESC',
      [guildId]
    );

    return groups || [];
  }

  // ============================================================================
  // PLUGIN PERMISSION MANAGEMENT (Dynamic Registration)
  // ============================================================================

  /**
   * Registriert Permissions aus plugin/permissions.json für eine Guild
   * Wird automatisch beim Plugin-Enable aufgerufen
   * 
   * Format permissions.json:
   * {
   *   "plugin": "gameserver",
   *   "version": "1.0.0",
   *   "permissions": [
   *     {
   *       "key": "gameserver.view",
   *       "name": "PERMISSIONS.GAMESERVER_VIEW",
   *       "description": "PERMISSIONS.GAMESERVER_VIEW_DESC",
   *       "category": "gameserver",
   *       "is_dangerous": 0,
   *       "requires": "gameserver.view"  // oder null
   *     }
   *   ]
   * }
   * 
   * @param {string} pluginName - Plugin-Name (z.B. "gameserver")
   * @param {string} guildId - Discord Guild ID
   * @param {Array} permissions - Array von Permission-Objekten aus permissions.json
   * @returns {Promise<number>} Anzahl registrierter Permissions
   */
  async registerPluginPermissions(pluginName, guildId, permissions) {
    this._ensureInitialized();
    
    if (!pluginName || !guildId || !Array.isArray(permissions)) {
      throw new Error('Invalid arguments: pluginName, guildId and permissions array required');
    }
    
    this.logger.info(`[PermissionManager] Registering ${permissions.length} permissions for plugin "${pluginName}" in guild ${guildId}...`);
    
    let registeredCount = 0;
    
    for (const perm of permissions) {
      try {
        // Validierung
        if (!perm.key || !perm.category) {
          this.logger.warn(`[PermissionManager] Skipping invalid permission (missing key or category):`, perm);
          continue;
        }
        
        // Konvertiere requires (String oder null → JSON oder NULL)
        let requiresJson = null;
        if (perm.requires) {
          if (typeof perm.requires === 'string') {
            requiresJson = JSON.stringify([perm.requires]);
          } else if (Array.isArray(perm.requires)) {
            requiresJson = JSON.stringify(perm.requires);
          }
        }
        
        // INSERT or UPDATE (ON DUPLICATE KEY UPDATE)
        await this.dbService.query(`
          INSERT INTO permission_definitions 
          (guild_id, permission_key, category, name_translation_key, description_translation_key, 
           is_dangerous, requires_permissions, plugin_name, sort_order, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, true)
          ON DUPLICATE KEY UPDATE
            category = VALUES(category),
            name_translation_key = VALUES(name_translation_key),
            description_translation_key = VALUES(description_translation_key),
            is_dangerous = VALUES(is_dangerous),
            requires_permissions = VALUES(requires_permissions),
            sort_order = VALUES(sort_order),
            is_active = true
        `, [
          guildId,
          perm.key,
          perm.category,
          perm.name || perm.key,  // Fallback wenn name fehlt
          perm.description || null,
          perm.is_dangerous || 0,
          requiresJson,
          pluginName,
          perm.sort_order || 0
        ]);
        
        registeredCount++;
        
      } catch (error) {
        this.logger.error(`[PermissionManager] Failed to register permission "${perm.key}":`, error.message);
      }
    }
    
    this.logger.success(`[PermissionManager] Registered ${registeredCount}/${permissions.length} permissions for plugin "${pluginName}"`);
    
    return registeredCount;
  }

  /**
   * Entfernt alle Permissions eines Plugins für eine Guild
   * Wird automatisch beim Plugin-Disable aufgerufen
   * 
   * WICHTIG: Entfernt auch Permissions aus allen Gruppen (guild_groups.permissions JSON)
   * 
   * @param {string} pluginName - Plugin-Name
   * @param {string} guildId - Discord Guild ID
   * @returns {Promise<Object>} { permissionsDeleted, groupsUpdated }
   */
  async unregisterPluginPermissions(pluginName, guildId) {
    this._ensureInitialized();
    
    if (!pluginName || !guildId) {
      throw new Error('Invalid arguments: pluginName and guildId required');
    }
    
    this.logger.info(`[PermissionManager] Unregistering permissions for plugin "${pluginName}" in guild ${guildId}...`);
    
    try {
      // 1. Hole alle Permission-Keys dieses Plugins
      const [permissions] = await this.dbService.query(
        'SELECT permission_key FROM permission_definitions WHERE guild_id = ? AND plugin_name = ?',
        [guildId, pluginName]
      );
      
      if (!permissions || permissions.length === 0) {
        this.logger.warn(`[PermissionManager] No permissions found for plugin "${pluginName}" in guild ${guildId}`);
        return { permissionsDeleted: 0, groupsUpdated: 0 };
      }
      
      const permKeys = permissions.map(p => p.permission_key);
      this.logger.debug(`[PermissionManager] Found ${permKeys.length} permissions to remove: ${permKeys.join(', ')}`);
      
      // 2. Entferne aus allen Gruppen (JSON-Field bereinigen)
      const [groups] = await this.dbService.query(
        'SELECT id, permissions FROM guild_groups WHERE guild_id = ?',
        [guildId]
      );
      
      let groupsUpdated = 0;
      
      for (const group of groups) {
        try {
          const perms = JSON.parse(group.permissions || '{}');
          let modified = false;
          
          // Entferne alle Plugin-Permissions
          permKeys.forEach(key => {
            if (perms[key] !== undefined) {
              delete perms[key];
              modified = true;
            }
          });
          
          if (modified) {
            await this.dbService.query(
              'UPDATE guild_groups SET permissions = ? WHERE id = ?',
              [JSON.stringify(perms), group.id]
            );
            groupsUpdated++;
          }
        } catch (err) {
          this.logger.warn(`[PermissionManager] Failed to update group ${group.id}:`, err.message);
        }
      }
      
      // 3. Entferne Permissions aus permission_definitions
      const [result] = await this.dbService.query(
        'DELETE FROM permission_definitions WHERE guild_id = ? AND plugin_name = ?',
        [guildId, pluginName]
      );
      
      const permissionsDeleted = result.affectedRows || 0;
      
      this.logger.success(
        `[PermissionManager] Unregistered plugin "${pluginName}": ` +
        `${permissionsDeleted} permissions deleted, ${groupsUpdated} groups updated`
      );
      
      return { permissionsDeleted, groupsUpdated };
      
    } catch (error) {
      this.logger.error(`[PermissionManager] Failed to unregister plugin "${pluginName}":`, error);
      throw error;
    }
  }
}

// Singleton-Instanz
const permissionManager = new PermissionManager();

module.exports = permissionManager;
