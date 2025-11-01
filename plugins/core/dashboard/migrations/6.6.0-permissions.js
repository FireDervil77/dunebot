/**
 * Migration 6.6.0: Permission System Implementation
 * 
 * Dieses Migration-Script wird automatisch beim Update auf v6.6.0+ ausgeführt.
 * 
 * Features:
 * - Neue Tabellen: guild_users, guild_groups, guild_user_groups, permission_definitions
 * - Standard-Gruppen für alle Guilds erstellen
 * - 40 Permission-Definitions einfügen
 * - Owner-User automatisch zur Administrator-Gruppe hinzufügen
 * 
 * @author FireDervil
 * @version 6.6.0
 */

const path = require('path');
const fs = require('fs');

module.exports = {
    version: '6.6.0',
    name: 'Permission System Implementation',
    
    /**
     * Migration ausführen
     * @param {object} dbService - Database Service
     * @param {string} guildId - Guild ID (optional, kann null sein für globale Updates)
     * @returns {Promise<{success: boolean, message?: string, error?: string}>}
     */
    async up(dbService, guildId = null) {
        const Logger = require('dunebot-core').ServiceManager.get('Logger');
        const PermissionManager = require('dunebot-sdk/lib/PermissionManager');
        
        try {
            Logger.info(`[Core Migration 6.6.0] Starte Permission-System Migration${guildId ? ' für Guild ' + guildId : ' (global)'}...`);
            
            // ============================
            // PHASE 1: Tabellen erstellen
            // ============================
            Logger.info('[Core Migration 6.6.0] Phase 1: Erstelle Tabellen...');
            
            const schemaPath = path.join(__dirname, '../sql/permissions_system.sql');
            
            if (!fs.existsSync(schemaPath)) {
                throw new Error(`Schema-File nicht gefunden: ${schemaPath}`);
            }
            
            const schema = fs.readFileSync(schemaPath, 'utf8');
            
            // SQL in einzelne Statements splitten (an Semikolon AUSSERHALB von Trigger-Definitionen)
            const statements = this._splitSQL(schema);
            
            for (const statement of statements) {
                if (statement.trim()) {
                    try {
                        await dbService.query(statement);
                    } catch (err) {
                        // Ignoriere "Table already exists" Fehler (Code 1050)
                        if (err.code !== 'ER_TABLE_EXISTS_ERROR' && err.errno !== 1050) {
                            throw err;
                        }
                        Logger.debug(`[Core Migration 6.6.0] Tabelle existiert bereits, überspringe...`);
                    }
                }
            }
            
            Logger.success('[Core Migration 6.6.0] Phase 1 abgeschlossen: Tabellen erstellt');
            
            // ====================================
            // PHASE 2: Permission-Definitions
            // ====================================
            Logger.info('[Core Migration 6.6.0] Phase 2: Füge Permission-Definitions ein...');
            
            const permissionsPath = path.join(__dirname, '../sql/seed_permissions.sql');
            
            if (fs.existsSync(permissionsPath)) {
                const permissionsSql = fs.readFileSync(permissionsPath, 'utf8');
                const permStatements = this._splitSQL(permissionsSql);
                
                for (const statement of permStatements) {
                    if (statement.trim() && statement.includes('INSERT')) {
                        try {
                            await dbService.query(statement);
                        } catch (err) {
                            // Ignoriere Duplicate Key Errors
                            if (err.code !== 'ER_DUP_ENTRY' && err.errno !== 1062) {
                                Logger.warn(`[Core Migration 6.6.0] Fehler beim Einfügen von Permissions:`, err.message);
                            }
                        }
                    }
                }
                
                Logger.success('[Core Migration 6.6.0] Phase 2 abgeschlossen: Permission-Definitions eingefügt');
            } else {
                Logger.warn('[Core Migration 6.6.0] seed_permissions.sql nicht gefunden, überspringe...');
            }
            
            // ===================================
            // PHASE 3: Standard-Gruppen anlegen
            // ===================================
            if (guildId) {
                Logger.info(`[Core Migration 6.6.0] Phase 3: Erstelle Standard-Gruppen für Guild ${guildId}...`);
                
                await PermissionManager.seedDefaultGroups(guildId);
                
                Logger.success('[Core Migration 6.6.0] Phase 3 abgeschlossen: Standard-Gruppen erstellt');
                
                // ===================================
                // PHASE 4: Owner zur Admin-Gruppe
                // ===================================
                Logger.info(`[Core Migration 6.6.0] Phase 4: Füge Guild-Owner zur Administrator-Gruppe hinzu...`);
                
                try {
                    // Owner aus guilds-Tabelle holen
                    const [guild] = await dbService.query(
                        'SELECT owner_id FROM guilds WHERE _id = ?',
                        [guildId]
                    );
                    
                    if (guild && guild.owner_id) {
                        const ownerId = guild.owner_id;
                        
                        // Owner als guild_user erstellen (falls nicht existiert)
                        await PermissionManager.upsertGuildUser(ownerId, guildId, {
                            is_owner: true,
                            status: 'active'
                        });
                        
                        // Administrator-Gruppe finden
                        const [adminGroup] = await dbService.query(
                            'SELECT id FROM guild_groups WHERE guild_id = ? AND slug = ?',
                            [guildId, 'administrator']
                        );
                        
                        if (adminGroup) {
                            // Owner zur Admin-Gruppe hinzufügen
                            await PermissionManager.assignUserToGroup(ownerId, adminGroup.id, 'system');
                            
                            Logger.success(`[Core Migration 6.6.0] Owner ${ownerId} zur Administrator-Gruppe hinzugefügt`);
                        } else {
                            Logger.warn('[Core Migration 6.6.0] Administrator-Gruppe nicht gefunden!');
                        }
                    } else {
                        Logger.warn('[Core Migration 6.6.0] Guild-Owner nicht gefunden in DB!');
                    }
                } catch (err) {
                    Logger.error('[Core Migration 6.6.0] Fehler beim Hinzufügen des Owners:', err);
                    // Nicht abbrechen, Migration ist trotzdem erfolgreich
                }
                
                Logger.success('[Core Migration 6.6.0] Phase 4 abgeschlossen');
                
                // ===================================
                // PHASE 5: Navigation aktualisieren
                // ===================================
                Logger.info(`[Core Migration 6.6.0] Phase 5: Aktualisiere Navigation für Guild ${guildId}...`);
                
                try {
                    // Lösche alte Core-Navigation für diese Guild
                    await dbService.query(
                        "DELETE FROM nav_items WHERE plugin = ? AND guildId = ?",
                        ['core', guildId]
                    );
                    Logger.debug('[Core Migration 6.6.0] Alte Navigation gelöscht');
                    
                    // Registriere neue Navigation (inkl. Permissions-Menü)
                    // WICHTIG: Core-Plugin-Instanz laden um _registerNavigation() aufzurufen
                    const ServiceManager = require('dunebot-core').ServiceManager;
                    const pluginManager = ServiceManager.get('pluginManager');
                    
                    if (pluginManager && pluginManager.isPluginEnabled('core')) {
                        const corePlugin = pluginManager.getPlugin('core');
                        
                        if (corePlugin && typeof corePlugin._registerNavigation === 'function') {
                            // Navigation neu registrieren
                            await corePlugin._registerNavigation(guildId);
                            
                            // Verifizieren
                            const navCount = await dbService.query(
                                "SELECT COUNT(*) as count FROM nav_items WHERE plugin = ? AND guildId = ?",
                                ['core', guildId]
                            );
                            
                            Logger.success(`[Core Migration 6.6.0] Navigation aktualisiert: ${navCount[0].count} Einträge`);
                        } else {
                            Logger.warn('[Core Migration 6.6.0] Core-Plugin _registerNavigation() nicht verfügbar');
                        }
                    } else {
                        Logger.warn('[Core Migration 6.6.0] Core-Plugin nicht im PluginManager gefunden, Navigation manuell erstellen...');
                        
                        // Fallback: Navigation manuell einfügen (nur die wichtigsten)
                        const navItems = [
                            // Dashboard (Haupt-Item)
                            { title: 'NAV.DASHBOARD', url: `/guild/${guildId}`, icon: 'fa-solid fa-home', order: 1000, parent: null },
                            
                            // Einstellungen (Haupt-Item)
                            { title: 'NAV.SETTINGS', url: `/guild/${guildId}/settings`, icon: 'fa-solid fa-cog', order: 2000, parent: null },
                            
                            // Berechtigungen (NEU - Haupt-Item)
                            { title: 'NAV.PERMISSIONS', url: `/guild/${guildId}/plugins/core/permissions`, icon: 'fa-solid fa-user-lock', order: 2500, parent: null },
                            { title: 'NAV.PERMISSIONS_USERS', url: `/guild/${guildId}/plugins/core/permissions/users`, icon: 'fa-solid fa-users', order: 10, parent: `/guild/${guildId}/plugins/core/permissions` },
                            { title: 'NAV.PERMISSIONS_GROUPS', url: `/guild/${guildId}/plugins/core/permissions/groups`, icon: 'fa-solid fa-users-cog', order: 20, parent: `/guild/${guildId}/plugins/core/permissions` },
                            { title: 'NAV.PERMISSIONS_MATRIX', url: `/guild/${guildId}/plugins/core/permissions/matrix`, icon: 'fa-solid fa-table', order: 30, parent: `/guild/${guildId}/plugins/core/permissions` },
                            
                            // Plugins (Haupt-Item)
                            { title: 'NAV.PLUGINS', url: `/guild/${guildId}/plugins`, icon: 'fa-solid fa-puzzle-piece', order: 3000, parent: null }
                        ];
                        
                        for (const item of navItems) {
                            await dbService.query(
                                `INSERT INTO nav_items (title, url, icon, \`order\`, parent, plugin, guildId, createdAt, updatedAt) 
                                 VALUES (?, ?, ?, ?, ?, 'core', ?, NOW(), NOW())`,
                                [item.title, item.url, item.icon, item.order, item.parent, guildId]
                            );
                        }
                        
                        Logger.success('[Core Migration 6.6.0] Navigation manuell erstellt (Fallback)');
                    }
                } catch (err) {
                    Logger.error('[Core Migration 6.6.0] Fehler beim Aktualisieren der Navigation:', err);
                    // Nicht abbrechen, Migration ist trotzdem erfolgreich
                }
                
                Logger.success('[Core Migration 6.6.0] Phase 5 abgeschlossen');
            } else {
                Logger.info('[Core Migration 6.6.0] Phase 3+4+5: Überspringe (keine guildId angegeben)');
            }
            
            // ===================================
            // MIGRATION ERFOLGREICH
            // ===================================
            Logger.success(`[Core Migration 6.6.0] Migration erfolgreich abgeschlossen!`);
            
            return {
                success: true,
                message: 'Permission-System erfolgreich migriert (Tabellen, Permissions, Standard-Gruppen, Navigation)'
            };
            
        } catch (error) {
            Logger.error('[Core Migration 6.6.0] Migration fehlgeschlagen:', error);
            
            return {
                success: false,
                error: `Migration fehlgeschlagen: ${error.message}`
            };
        }
    },
    
    /**
     * Migration rückgängig machen (optional)
     * WARNUNG: Löscht alle Permission-Daten!
     * 
     * @param {object} dbService 
     * @param {string} guildId 
     */
    async down(dbService, guildId = null) {
        const Logger = require('dunebot-core').ServiceManager.get('Logger');
        
        Logger.warn('[Core Migration 6.6.0] ROLLBACK: Entferne Permission-System...');
        
        try {
            // Guild-spezifische Daten löschen
            if (guildId) {
                await dbService.query('DELETE FROM guild_user_groups WHERE guild_user_id IN (SELECT id FROM guild_users WHERE guild_id = ?)', [guildId]);
                await dbService.query('DELETE FROM guild_groups WHERE guild_id = ?', [guildId]);
                await dbService.query('DELETE FROM guild_users WHERE guild_id = ?', [guildId]);
                Logger.info(`[Core Migration 6.6.0] Rollback für Guild ${guildId} abgeschlossen`);
            } else {
                // Globaler Rollback (GEFÄHRLICH!)
                await dbService.query('SET FOREIGN_KEY_CHECKS = 0');
                await dbService.query('DROP TABLE IF EXISTS guild_user_groups');
                await dbService.query('DROP TABLE IF EXISTS guild_groups');
                await dbService.query('DROP TABLE IF EXISTS guild_users');
                await dbService.query('DROP TABLE IF EXISTS permission_definitions');
                await dbService.query('DROP VIEW IF EXISTS v_guild_user_permissions');
                await dbService.query('DROP VIEW IF EXISTS v_guild_groups_summary');
                await dbService.query('SET FOREIGN_KEY_CHECKS = 1');
                Logger.info('[Core Migration 6.6.0] Globaler Rollback abgeschlossen (alle Tabellen gelöscht)');
            }
            
            return { success: true, message: 'Rollback erfolgreich' };
            
        } catch (error) {
            Logger.error('[Core Migration 6.6.0] Rollback fehlgeschlagen:', error);
            return { success: false, error: error.message };
        }
    },
    
    /**
     * Helper: SQL-String in einzelne Statements splitten
     * Berücksichtigt Trigger-Definitionen (nicht an jedem Semikolon splitten!)
     * 
     * @param {string} sql 
     * @returns {string[]}
     * @private
     */
    _splitSQL(sql) {
        const statements = [];
        let current = '';
        let inTrigger = false;
        
        const lines = sql.split('\n');
        
        for (const line of lines) {
            const trimmed = line.trim();
            
            // Kommentare ignorieren
            if (trimmed.startsWith('--') || trimmed.startsWith('#')) {
                continue;
            }
            
            // Trigger-Block erkennen
            if (trimmed.toUpperCase().includes('CREATE TRIGGER') || trimmed.toUpperCase().includes('DELIMITER')) {
                inTrigger = true;
            }
            
            if (trimmed.toUpperCase().includes('END;') && inTrigger) {
                current += line + '\n';
                statements.push(current.trim());
                current = '';
                inTrigger = false;
                continue;
            }
            
            current += line + '\n';
            
            // Statement-Ende (nur wenn NICHT in Trigger)
            if (!inTrigger && trimmed.endsWith(';') && !trimmed.toUpperCase().includes('END;')) {
                statements.push(current.trim());
                current = '';
            }
        }
        
        // Letztes Statement hinzufügen (falls vorhanden)
        if (current.trim()) {
            statements.push(current.trim());
        }
        
        return statements.filter(s => s && !s.startsWith('--') && !s.startsWith('DELIMITER'));
    }
};
