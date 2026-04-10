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
    
    // Permission-Cache: Map<"userId:guildId", { permissions, isOwner, timestamp }>
    this._permissionCache = new Map();
    this._CACHE_TTL = 5 * 60 * 1000; // 5 Minuten
  }

  /**
   * Normalisiert einen Permission-Key auf UPPERCASE (Trim)
   * @param {string} key
   * @returns {string}
   */
  _normalizeKey(key) {
    return (key || '').toString().toUpperCase().trim();
  }

  /**
   * Normalisiert ein Permissions-Objekt: Keys → UPPERCASE, Werte → boolean, wildcard bleibt erhalten
   * @param {object|string|null} perms
   * @returns {object}
   */
  _normalizePerms(perms) {
    let obj = perms;
    if (!perms) return {};
    if (typeof perms === 'string') {
      try {
        obj = JSON.parse(perms);
      } catch (_) {
        // Falls es eine konkatenierte Darstellung ist ("{}|||{}"), später zusammenführen
        obj = perms;
      }
    }
    if (typeof obj === 'string') {
      // Konkatenierte Strings unterstützen: "{...}|||{...}"
      const merged = {};
      const parts = obj.split('|||').filter(Boolean);
      for (const part of parts) {
        try {
          const p = JSON.parse(part);
          Object.assign(merged, p);
        } catch (_) {
          // ignorieren
        }
      }
      obj = merged;
    }
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'wildcard') {
        out.wildcard = v === true || v === 'true';
      } else {
        out[this._normalizeKey(k)] = v === true || v === 'true';
      }
    }
    return out;
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
  // PERMISSION CACHE (In-Memory, TTL-basiert)
  // ============================================================================

  /**
   * Cache für einen bestimmten User+Guild invalidieren
   * Aufrufen bei: Gruppen-Zuweisung, Direct-Permission-Änderung, User-Remove
   */
  invalidateCache(userId, guildId) {
    const key = `${userId}:${guildId}`;
    this._permissionCache.delete(key);
    if (this._initialized) {
      this.logger.debug(`[PermissionManager] Cache invalidiert: ${key}`);
    }
  }

  /**
   * Cache für eine ganze Guild invalidieren
   * Aufrufen bei: Gruppen-Permission-Änderung, Gruppen-Löschung
   */
  invalidateGuildCache(guildId) {
    let count = 0;
    for (const key of this._permissionCache.keys()) {
      if (key.endsWith(`:${guildId}`)) {
        this._permissionCache.delete(key);
        count++;
      }
    }
    if (this._initialized && count > 0) {
      this.logger.debug(`[PermissionManager] Guild-Cache invalidiert: ${guildId} (${count} Einträge)`);
    }
  }

  /**
   * Baut die vollständige Permission-Map für einen User auf (mit Hierarchie)
   * und cached das Ergebnis.
   * 
   * Hierarchie-Logik:
   *   1. Finde die höchste Gruppen-Priorität des Users (max_priority)
   *   2. Lade ALLE Guild-Gruppen mit priority <= max_priority
   *   3. Merge aufsteigend (niedrigste zuerst → höhere überschreiben)
   *   4. Direct Permissions überschreiben Gruppen (allow + deny)
   * 
   * Beispiel: User ist "Moderator" (priority=50)
   *   → erbt User(1) + Support(25) + Moderator(50) automatisch
   */
  async _buildAndCachePermissions(userId, guildId) {
    const cacheKey = `${userId}:${guildId}`;

    // Cache prüfen
    const cached = this._permissionCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this._CACHE_TTL) {
      return cached;
    }

    // 1. Guild-Owner?
    const [guild] = await this.dbService.query(
      'SELECT owner_id FROM guilds WHERE _id = ?', [guildId]
    );
    const isOwner = guild && guild.owner_id === userId;

    if (isOwner) {
      const result = { permissions: { wildcard: true }, isOwner: true, timestamp: Date.now() };
      this._permissionCache.set(cacheKey, result);
      return result;
    }

    // 2. User in Guild?
    const user = await this.dbService.query(
      'SELECT * FROM v_guild_user_permissions WHERE user_id = ? AND guild_id = ?',
      [userId, guildId]
    );

    if (!user || !Array.isArray(user) || user.length === 0 || !user[0]) {
      const result = { permissions: {}, isOwner: false, timestamp: Date.now() };
      this._permissionCache.set(cacheKey, result);
      return result;
    }

    const userData = user[0];

    // 3. Hierarchie-Permissions laden
    let permissions = {};
    const maxPriority = userData.max_priority;

    if (maxPriority !== null && maxPriority !== undefined) {
      // HIERARCHIE: Alle Gruppen der Guild mit priority <= User's höchste Priorität
      const groups = await this.dbService.query(
        'SELECT permissions, priority FROM guild_groups WHERE guild_id = ? AND priority <= ? ORDER BY priority ASC',
        [guildId, maxPriority]
      );
      for (const group of (groups || [])) {
        const perms = this._normalizePerms(group.permissions);
        permissions = { ...permissions, ...perms };
      }
    } else if (userData.group_permissions) {
      // Fallback: Alte Logik (View ohne max_priority / User hat keine Gruppen)
      permissions = this._normalizePerms(userData.group_permissions);
    }

    // 4. Direct Permissions überschreiben Gruppen (allow + deny)
    if (userData.direct_permissions) {
      const directPerms = this._normalizePerms(userData.direct_permissions);
      permissions = { ...permissions, ...directPerms };
    }

    const result = { permissions, isOwner: false, timestamp: Date.now() };
    this._permissionCache.set(cacheKey, result);
    return result;
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
      const normalizedKey = this._normalizeKey(permissionKey);

      // Permissions laden (mit Hierarchie + Cache)
      const result = await this._buildAndCachePermissions(userId, guildId);

      // Owner hat immer alle Rechte
      if (result.isOwner) {
        this.logger.debug(`[Permission] ✅ User ${userId} ist Guild-Owner → Alle Permissions`);
        return true;
      }

      const perms = result.permissions;

      // Wildcard → alles erlaubt
      if (perms.wildcard === true) return true;

      // Explizit erlaubt
      if (perms[normalizedKey] === true) return true;

      // Explizit verweigert (direct_permissions deny)
      if (perms[normalizedKey] === false) return false;

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
   * Prüft ob User Guild-Owner ist
   * 
   * @param {string} userId - Discord User ID
   * @param {string} guildId - Discord Guild ID
   * @returns {Promise<boolean>}
   */
  async isGuildOwner(userId, guildId) {
    this._ensureInitialized();
    
    try {
      const [guild] = await this.dbService.query(
        'SELECT owner_id FROM guilds WHERE _id = ?',
        [guildId]
      );
      
      if (!guild) {
        return false;
      }
      
      return guild.owner_id === userId;
    } catch (error) {
      this.logger.error(`[PermissionManager] Error checking guild owner ${userId} in guild ${guildId}:`, error);
      return false;
    }
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
      const guildRows = await this.dbService.query(
        'SELECT owner_id FROM guilds WHERE _id = ?',
        [guildId]
      );
      
      const isOwner = Array.isArray(guildRows) && guildRows[0]?.owner_id === userId;
      
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

      // 3. Permissions mit Hierarchie laden
      let permissions = {};
      const maxPriority = userData.max_priority;

      if (maxPriority !== null && maxPriority !== undefined) {
        // HIERARCHIE: Alle Gruppen der Guild mit priority <= User's höchste Priorität
        const hierarchyGroups = await this.dbService.query(
          'SELECT permissions, priority FROM guild_groups WHERE guild_id = ? AND priority <= ? ORDER BY priority ASC',
          [guildId, maxPriority]
        );
        for (const group of (hierarchyGroups || [])) {
          const perms = this._normalizePerms(group.permissions);
          permissions = { ...permissions, ...perms };
        }
      } else if (userData.group_permissions) {
        // Fallback: Alte Logik (View ohne max_priority)
        permissions = this._normalizePerms(userData.group_permissions);
      }

      // Direct Permissions (überschreiben Gruppen)
      if (userData.direct_permissions) {
        const directPerms = this._normalizePerms(userData.direct_permissions);
        permissions = { ...permissions, ...directPerms };
      }

      // Owner hat Wildcard UND alle expliziten Permissions
      if (isOwner) {
        permissions.wildcard = true;
        
        // ✅ FIX: Owner bekommt ALLE registrierten Permissions explizit
        // Das ist wichtig für die UI (z.B. Permissions-Seite zeigt alle verfügbaren Rechte)
        const allPermissions = await this.dbService.query(
          'SELECT permission_key FROM permission_definitions WHERE is_active = 1',
          []
        );
        
        if (allPermissions && allPermissions.length > 0) {
          for (const perm of allPermissions) {
            permissions[this._normalizeKey(perm.permission_key)] = true;
          }
        }
      }

      // Keys final normalisieren (UPPERCASE), Werte → boolean
      permissions = this._normalizePerms(permissions);

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

    // Prüfe ob Guild überhaupt existiert (FK-Guard)
    const guilds = await this.dbService.query(
      'SELECT owner_id FROM guilds WHERE _id = ?',
      [guildId]
    );
    if (!guilds || guilds.length === 0) {
      this.logger.warn(`[PermissionManager] upsertGuildUser: Guild ${guildId} existiert nicht in guilds-Tabelle – übersprungen`);
      return null;
    }
    const isOwner = guilds[0]?.owner_id === userId ? 1 : 0;

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

    // Cache invalidieren
    this.invalidateCache(userId, guildId);

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
    const guildRows = await this.dbService.query(
      'SELECT owner_id FROM guilds WHERE _id = ?',
      [guildId]
    );
    
    if (Array.isArray(guildRows) && guildRows[0]?.owner_id === userId) {
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

    // Cache invalidieren
    this.invalidateCache(userId, guildId);

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

    // Cache invalidieren (Gruppe → Guild ermitteln)
    const assignedGroup = await this.dbService.query('SELECT guild_id FROM guild_groups WHERE id = ?', [groupId]);
    if (assignedGroup?.[0]?.guild_id) this.invalidateCache(userId, assignedGroup[0].guild_id);

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

    // Cache invalidieren
    const removedGroup = await this.dbService.query('SELECT guild_id FROM guild_groups WHERE id = ?', [groupId]);
    if (removedGroup?.[0]?.guild_id) this.invalidateCache(userId, removedGroup[0].guild_id);

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
   * WICHTIG: Permissions werden als JSON in guild_groups.permissions gespeichert!
   * 
   * @param {number} groupId - Group ID
   * @param {Object} updates - Felder zum Aktualisieren (inkl. permissions)
   * @returns {Promise<boolean>}
   */
  async updateGroup(groupId, updates) {
    this._ensureInitialized();
    
    // Prüfe ob Gruppe protected ist
    const groups = await this.dbService.query(
      'SELECT is_protected, guild_id FROM guild_groups WHERE id = ?',
      [groupId]
    );

    if (!groups || groups.length === 0) {
      throw new Error('Group not found');
    }

    const group = groups[0];

    if (group.is_protected) {
      // Protected Gruppen: Nur permissions dürfen geändert werden
      if (Object.keys(updates).some(key => key !== 'permissions')) {
        throw new Error('Cannot modify protected group (only permissions can be changed)');
      }
    }

    // ✅ Permissions als JSON in guild_groups.permissions speichern (NEW SYSTEM!)
    if (updates.permissions) {
      // Filter: Nur true-Werte speichern
      const truePermissions = {};
      for (const [key, value] of Object.entries(updates.permissions)) {
        if (value === true || value === 'true' || value === '1') {
          truePermissions[key] = true;
        }
      }
      
      this.logger.info(`[PermissionManager] Aktualisiere Permissions für Gruppe ${groupId}: ${Object.keys(truePermissions).length} Permissions`);
      
      // Als JSON in guild_groups.permissions speichern
      await this.dbService.query(
        'UPDATE guild_groups SET permissions = ?, updated_at = NOW() WHERE id = ?',
        [JSON.stringify(truePermissions), groupId]
      );
      
      delete updates.permissions; // Nicht in zweitem UPDATE statement
    }

    // Nur Meta-Daten updaten (name, slug, description, color, icon, priority)
    const allowedFields = ['name', 'slug', 'description', 'color', 'icon', 'priority'];
    const updateFields = [];
    const updateValues = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        updateFields.push(`${key} = ?`);
        updateValues.push(value);
      }
    }

    if (updateFields.length === 0) {
      this.logger.info(`[PermissionManager] Group ${groupId} - Keine Meta-Updates, nur Permissions`);
      return true; // Nur Permissions wurden aktualisiert
    }

    updateValues.push(groupId);

    await this.dbService.query(
      `UPDATE guild_groups SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ?`,
      updateValues
    );

    // Cache für die ganze Guild invalidieren (Gruppen-Änderung betrifft alle User)
    this.invalidateGuildCache(group.guild_id);

    this.logger.info(`[PermissionManager] Updated group ${groupId} meta-data`);
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
    const groups = await this.dbService.query(
      'SELECT is_protected, name, guild_id FROM guild_groups WHERE id = ?',
      [groupId]
    );

    if (!groups || groups.length === 0) {
      throw new Error('Group not found');
    }

    if (groups[0].is_protected) {
      throw new Error(`Cannot delete protected group: ${groups[0].name}`);
    }

    // DELETE CASCADE entfernt automatisch guild_user_groups Einträge
    await this.dbService.query(
      'DELETE FROM guild_groups WHERE id = ?',
      [groupId]
    );

    // Cache für die ganze Guild invalidieren
    this.invalidateGuildCache(groups[0].guild_id);

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
        
        // INSERT or UPDATE (ON DUPLICATE KEY UPDATE) — global, kein guild_id
        await this.dbService.query(`
          INSERT INTO permission_definitions 
          (permission_key, category, name_translation_key, description_translation_key, 
           is_dangerous, requires_permissions, plugin_name, sort_order, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, true)
          ON DUPLICATE KEY UPDATE
            category = VALUES(category),
            name_translation_key = VALUES(name_translation_key),
            description_translation_key = VALUES(description_translation_key),
            is_dangerous = VALUES(is_dangerous),
            requires_permissions = VALUES(requires_permissions),
            sort_order = VALUES(sort_order),
            is_active = true
        `, [
          perm.key,
          perm.category,
          perm.name || perm.key,
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
      // 1. Hole alle Permission-Keys dieses Plugins (global)
      const permissions = await this.dbService.query(
        'SELECT id, permission_key FROM permission_definitions WHERE plugin_name = ?',
        [pluginName]
      );
      
      if (!permissions || permissions.length === 0) {
        this.logger.warn(`[PermissionManager] No permissions found for plugin "${pluginName}"`);
        return { permissionsDeleted: 0, groupAssignmentsDeleted: 0 };
      }
      
      const permKeys = permissions.map(p => p.permission_key);
      this.logger.debug(`[PermissionManager] Found ${permKeys.length} permissions to remove: ${permKeys.join(', ')}`);
      
      // 2. DELETE aus permission_definitions (UI-Registry-Cleanup, global)
      const result = await this.dbService.query(
        'DELETE FROM permission_definitions WHERE plugin_name = ?',
        [pluginName]
      );
      
      const permissionsDeleted = result.affectedRows || 0;

      // 3. Permissions aus allen Gruppen-JSONs der Guild entfernen
      let groupAssignmentsDeleted = 0;
      if (permKeys.length > 0) {
        const groups = await this.dbService.query(
          'SELECT id, permissions FROM guild_groups WHERE guild_id = ?',
          [guildId]
        );
        for (const group of groups) {
          const perms = typeof group.permissions === 'string'
            ? JSON.parse(group.permissions || '{}')
            : (group.permissions || {});
          let changed = false;
          for (const key of permKeys) {
            if (Object.prototype.hasOwnProperty.call(perms, key)) {
              delete perms[key];
              changed = true;
              groupAssignmentsDeleted++;
            }
          }
          if (changed) {
            await this.dbService.query(
              'UPDATE guild_groups SET permissions = ?, updated_at = NOW() WHERE id = ?',
              [JSON.stringify(perms), group.id]
            );
          }
        }
      }
      
      // Cache für die Guild invalidieren (Permissions haben sich geändert)
      this.invalidateGuildCache(guildId);
      
      this.logger.success(
        `[PermissionManager] Unregistered plugin "${pluginName}": ` +
        `${permissionsDeleted} permissions deleted from registry, ` +
        `${groupAssignmentsDeleted} group assignments cleaned up`
      );
      
      return { permissionsDeleted, groupAssignmentsDeleted };
      
    } catch (error) {
      this.logger.error(`[PermissionManager] Failed to unregister plugin "${pluginName}":`, error);
      throw error;
    }
  }
  /**
   * Lädt und registriert Kern-Permissions aus packages/dunebot-core/config/permissions.json
   * Wird beim Beitritt einer Guild und beim Dashboard-Start aufgerufen.
   *
   * @param {string} guildId - Discord Guild ID
   * @returns {Promise<number>} Anzahl registrierter Permissions
   */
  async loadKernelPermissions(guildId) {
    this._ensureInitialized();

    const path = require('path');
    const permissionsFile = path.join(__dirname, '../../dunebot-core/config/permissions.json');

    let permissionsData;
    try {
      permissionsData = require(permissionsFile);
    } catch (e) {
      this.logger.warn(`[PermissionManager] Kern-permissions.json nicht gefunden: ${permissionsFile}`);
      return 0;
    }

    if (!permissionsData || !Array.isArray(permissionsData.permissions)) {
      this.logger.warn('[PermissionManager] Kern-permissions.json hat ungültiges Format');
      return 0;
    }

    return this.registerPluginPermissions('kern', guildId, permissionsData.permissions);
  }

  // ============================================================================
  // SYSTEM PERMISSION CHECKS (für /admin/ Bereich)
  // ============================================================================

  /**
   * Prüft ob ein User eine SYSTEM.* Permission hat.
   * 
   * Logik:
   *  - OWNER_IDS (ENV): Komma-getrennte User-IDs → haben alle SYSTEM.* Rechte
   *  - CONTROL_GUILD_ID (ENV): Optional — prüft SYSTEM.* Permissions in dieser
   *    speziellen Kontroll-Guild (ermöglicht granulare System-Rechte für Staff)
   * 
   * @param {string} userId            - Discord User ID
   * @param {string} systemPermKey     - z.B. "SYSTEM.ACCESS", "SYSTEM.NEWS.EDIT"
   * @returns {Promise<boolean>}
   */
  async hasSystemPermission(userId, systemPermKey) {
    this._ensureInitialized();

    try {
      const normalizedKey = this._normalizeKey(systemPermKey);

      // 1. OWNER_IDS direkt aus ENV → immer alle SYSTEM.* Rechte
      const ownerIds = process.env.OWNER_IDS
        ? process.env.OWNER_IDS.split(',').map(id => id.trim()).filter(Boolean)
        : [];

      if (ownerIds.includes(String(userId))) {
        this.logger.debug(`[PermissionManager] ✅ SYSTEM User ${userId} ist in OWNER_IDS → ${normalizedKey} gewährt`);
        return true;
      }

      // 2. CONTROL_GUILD_ID (optional): Granulare Staff-Rechte über Guild-Permissions
      const controlGuildId = process.env.CONTROL_GUILD_ID;
      if (controlGuildId) {
        const hasGuildPerm = await this.hasPermission(userId, controlGuildId, normalizedKey);
        if (hasGuildPerm) {
          this.logger.debug(`[PermissionManager] ✅ User ${userId} hat ${normalizedKey} in Control-Guild ${controlGuildId}`);
          return true;
        }
      }

      this.logger.debug(`[PermissionManager] ❌ User ${userId} hat keine SYSTEM-Permission "${normalizedKey}"`);
      return false;

    } catch (error) {
      this.logger.error(`[PermissionManager] Fehler bei hasSystemPermission für User ${userId}:`, error);
      return false;
    }
  }

  /**
   * Prüft ob ein User überhaupt Zugriff auf den /admin/ Bereich hat (SYSTEM.ACCESS)
   * 
   * @param {string} userId - Discord User ID
   * @returns {Promise<boolean>}
   */
  async isSystemUser(userId) {
    return this.hasSystemPermission(userId, 'SYSTEM.ACCESS');
  }

}

// Singleton-Instanz
const permissionManager = new PermissionManager();

module.exports = permissionManager;
