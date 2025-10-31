/**
 * Migration 6.6.1: Fix Navigation URLs
 * 
 * Problem: Navigation-URLs fehlt das Plugin-Prefix "/plugins/core/"
 * 
 * Falsch: /guild/:guildId/permissions
 * Richtig: /guild/:guildId/plugins/core/permissions
 * 
 * @author FireDervil
 * @version 6.6.1
 */

module.exports = {
    version: '6.6.1',
    name: 'Fix Navigation URLs (Plugin-Prefix)',
    
    /**
     * Migration ausführen
     * @param {object} dbService - Database Service
     * @param {string} guildId - Guild ID
     */
    async up(dbService, guildId) {
        const Logger = require('dunebot-core').ServiceManager.get('Logger');
        
        Logger.info(`[Core Migration 6.6.1] Fixe Navigation-URLs für Guild ${guildId}...`);
        
        try {
            // URL-Mapping: Alt → Neu
            const urlFixes = [
                // Permissions-Routen
                {
                    old: `/guild/${guildId}/permissions`,
                    new: `/guild/${guildId}/plugins/core/permissions`
                },
                {
                    old: `/permissions/users`,
                    new: `/guild/${guildId}/plugins/core/permissions/users`
                },
                {
                    old: `/permissions/groups`,
                    new: `/guild/${guildId}/plugins/core/permissions/groups`
                },
                {
                    old: `/permissions/matrix`,
                    new: `/guild/${guildId}/plugins/core/permissions/matrix`
                },
                // User-Management-Routen
                {
                    old: `/guild/${guildId}/user-management`,
                    new: `/guild/${guildId}/plugins/core/user-management`
                },
                {
                    old: `/user-management/overview`,
                    new: `/guild/${guildId}/plugins/core/user-management/overview`
                },
                {
                    old: `/user-management/invite`,
                    new: `/guild/${guildId}/plugins/core/user-management/invite`
                },
                {
                    old: `/user-management/activity`,
                    new: `/guild/${guildId}/plugins/core/user-management/activity`
                }
            ];
            
            let updatedCount = 0;
            
            for (const fix of urlFixes) {
                const result = await dbService.query(
                    `UPDATE nav_items 
                     SET url = ?, updatedAt = NOW() 
                     WHERE guildId = ? AND url = ? AND plugin = 'core'`,
                    [fix.new, guildId, fix.old]
                );
                
                if (result.affectedRows > 0) {
                    updatedCount += result.affectedRows;
                    Logger.debug(`[Core Migration 6.6.1] ✅ ${fix.old} → ${fix.new}`);
                }
            }
            
            // Auch parent-URLs fixen
            const parentFixes = [
                {
                    old: `/guild/${guildId}/permissions`,
                    new: `/guild/${guildId}/plugins/core/permissions`
                },
                {
                    old: `/guild/${guildId}/user-management`,
                    new: `/guild/${guildId}/plugins/core/user-management`
                }
            ];
            
            for (const fix of parentFixes) {
                const result = await dbService.query(
                    `UPDATE nav_items 
                     SET parent = ?, updatedAt = NOW() 
                     WHERE guildId = ? AND parent = ? AND plugin = 'core'`,
                    [fix.new, guildId, fix.old]
                );
                
                if (result.affectedRows > 0) {
                    updatedCount += result.affectedRows;
                    Logger.debug(`[Core Migration 6.6.1] ✅ Parent: ${fix.old} → ${fix.new}`);
                }
            }
            
            Logger.success(`[Core Migration 6.6.1] Navigation-URLs erfolgreich aktualisiert! (${updatedCount} Einträge)`);
            
            return { success: true };
            
        } catch (error) {
            Logger.error(`[Core Migration 6.6.1] Migration fehlgeschlagen:`, error);
            throw error;
        }
    },
    
    /**
     * Rollback (URLs zurück auf alte Form)
     * @param {object} dbService 
     * @param {string} guildId 
     */
    async down(dbService, guildId) {
        const Logger = require('dunebot-core').ServiceManager.get('Logger');
        
        Logger.info(`[Core Migration 6.6.1] ROLLBACK: Setze alte Navigation-URLs zurück...`);
        
        try {
            // Umgekehrtes Mapping
            const urlFixes = [
                {
                    old: `/guild/${guildId}/plugins/core/permissions`,
                    new: `/guild/${guildId}/permissions`
                },
                {
                    old: `/guild/${guildId}/plugins/core/permissions/users`,
                    new: `/permissions/users`
                },
                {
                    old: `/guild/${guildId}/plugins/core/permissions/groups`,
                    new: `/permissions/groups`
                },
                {
                    old: `/guild/${guildId}/plugins/core/permissions/matrix`,
                    new: `/permissions/matrix`
                },
                {
                    old: `/guild/${guildId}/plugins/core/user-management`,
                    new: `/guild/${guildId}/user-management`
                },
                {
                    old: `/guild/${guildId}/plugins/core/user-management/overview`,
                    new: `/user-management/overview`
                },
                {
                    old: `/guild/${guildId}/plugins/core/user-management/invite`,
                    new: `/user-management/invite`
                },
                {
                    old: `/guild/${guildId}/plugins/core/user-management/activity`,
                    new: `/user-management/activity`
                }
            ];
            
            for (const fix of urlFixes) {
                await dbService.query(
                    `UPDATE nav_items 
                     SET url = ?, updatedAt = NOW() 
                     WHERE guildId = ? AND url = ? AND plugin = 'core'`,
                    [fix.new, guildId, fix.old]
                );
            }
            
            // Parent-URLs
            const parentFixes = [
                {
                    old: `/guild/${guildId}/plugins/core/permissions`,
                    new: `/guild/${guildId}/permissions`
                },
                {
                    old: `/guild/${guildId}/plugins/core/user-management`,
                    new: `/guild/${guildId}/user-management`
                }
            ];
            
            for (const fix of parentFixes) {
                await dbService.query(
                    `UPDATE nav_items 
                     SET parent = ?, updatedAt = NOW() 
                     WHERE guildId = ? AND parent = ? AND plugin = 'core'`,
                    [fix.new, guildId, fix.old]
                );
            }
            
            Logger.success(`[Core Migration 6.6.1] Rollback erfolgreich!`);
            
        } catch (error) {
            Logger.error(`[Core Migration 6.6.1] Rollback fehlgeschlagen:`, error);
            throw error;
        }
    }
};
