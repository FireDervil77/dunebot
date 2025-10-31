/**
 * Migration 6.6.5: Seed Default Groups
 * 
 * Erstellt Standard-Gruppen (Moderator, Support, User) für Guilds,
 * die bisher nur die Administrator-Gruppe haben.
 * 
 * @author FireDervil + GitHub Copilot
 * @version 6.6.5
 * @date 30. Oktober 2025
 */

module.exports = {
    version: '6.6.5',
    name: 'Seed Default Permission Groups',
    
    /**
     * Migration ausführen
     * @param {object} dbService - Database Service
     * @param {string} guildId - Guild ID
     */
    async up(dbService, guildId) {
        const ServiceManager = require('dunebot-core').ServiceManager;
        const Logger = ServiceManager.get('Logger');
        
        Logger.info(`[Migration 6.6.5] Erstelle Standard-Gruppen für Guild ${guildId}...`);
        
        try {
            // Default-Gruppen Definition
            const defaultGroups = [
                {
                    name: 'Administrator',
                    slug: 'administrator',
                    description: 'Vollzugriff auf alle Dashboard-Funktionen',
                    color: '#dc3545',
                    icon: 'fa-solid fa-shield-halved',
                    is_protected: true,
                    priority: 100,
                    permissions: {
                        'permissions.view': true,
                        'permissions.users.view': true,
                        'permissions.users.invite': true,
                        'permissions.users.edit': true,
                        'permissions.users.remove': true,
                        'permissions.groups.view': true,
                        'permissions.groups.create': true,
                        'permissions.groups.edit': true,
                        'permissions.groups.delete': true,
                        'permissions.matrix.view': true,
                        'permissions.matrix.edit': true,
                        'gameserver.view': true,
                        'gameserver.create': true,
                        'gameserver.edit': true,
                        'gameserver.delete': true,
                        'gameserver.start': true,
                        'gameserver.stop': true,
                        'gameserver.restart': true,
                        'gameserver.console': true,
                        'gameserver.files': true,
                        'gameserver.logs': true,
                        'moderation.view': true,
                        'moderation.kick': true,
                        'moderation.ban': true,
                        'moderation.mute': true,
                        'moderation.warn': true,
                        'core.settings.view': true,
                        'core.settings.edit': true,
                        'core.plugins.manage': true,
                    }
                },
                {
                    name: 'Moderator',
                    slug: 'moderator',
                    description: 'Verwaltung von Servern und grundlegende Moderation',
                    color: '#007bff',
                    icon: 'fa-solid fa-user-shield',
                    is_protected: false,
                    priority: 50,
                    permissions: {
                        'permissions.view': true,
                        'permissions.users.view': true,
                        'permissions.groups.view': true,
                        'gameserver.view': true,
                        'gameserver.edit': true,
                        'gameserver.start': true,
                        'gameserver.stop': true,
                        'gameserver.restart': true,
                        'gameserver.console': true,
                        'gameserver.logs': true,
                        'moderation.view': true,
                        'moderation.kick': true,
                        'moderation.mute': true,
                        'moderation.warn': true,
                    }
                },
                {
                    name: 'Support',
                    slug: 'support',
                    description: 'Hilfestellung und Server-Monitoring',
                    color: '#28a745',
                    icon: 'fa-solid fa-headset',
                    is_protected: false,
                    priority: 25,
                    permissions: {
                        'permissions.view': true,
                        'gameserver.view': true,
                        'gameserver.console': true,
                        'gameserver.logs': true,
                        'moderation.view': true,
                    }
                },
                {
                    name: 'User',
                    slug: 'user',
                    description: 'Basis-Zugriff auf Dashboard',
                    color: '#6c757d',
                    icon: 'fa-solid fa-user',
                    is_protected: false,
                    is_default: true,
                    priority: 1,
                    permissions: {
                        'gameserver.view': true,
                        'gameserver.logs': true,
                    }
                }
            ];
            
            let created = 0;
            let skipped = 0;
            
            for (const groupData of defaultGroups) {
                // Prüfe ob Gruppe bereits existiert
                const [existing] = await dbService.query(
                    'SELECT id FROM guild_groups WHERE guild_id = ? AND slug = ?',
                    [guildId, groupData.slug]
                );
                
                if (existing) {
                    Logger.info(`[Migration 6.6.5] Gruppe "${groupData.name}" existiert bereits`);
                    skipped++;
                    continue;
                }
                
                // Erstelle Gruppe
                await dbService.query(`
                    INSERT INTO guild_groups 
                    (guild_id, name, slug, description, color, icon, is_protected, is_default, priority, permissions)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    guildId,
                    groupData.name,
                    groupData.slug,
                    groupData.description,
                    groupData.color,
                    groupData.icon,
                    groupData.is_protected || false,
                    groupData.is_default || false,
                    groupData.priority || 0,
                    JSON.stringify(groupData.permissions)
                ]);
                
                Logger.success(`[Migration 6.6.5] ✅ Gruppe "${groupData.name}" erstellt`);
                created++;
            }
            
            Logger.success(`[Migration 6.6.5] Fertig! ${created} erstellt, ${skipped} übersprungen`);
            return { success: true };
            
        } catch (error) {
            Logger.error(`[Migration 6.6.5] Fehler:`, error);
            throw error;
        }
    },
    
    /**
     * Rollback
     * @param {object} dbService 
     * @param {string} guildId 
     */
    async down(dbService, guildId) {
        const ServiceManager = require('dunebot-core').ServiceManager;
        const Logger = ServiceManager.get('Logger');
        
        Logger.info(`[Migration 6.6.5] ROLLBACK für Guild ${guildId}...`);
        
        try {
            // Lösche nur die neu erstellten Gruppen (nicht Administrator)
            const slugsToDelete = ['moderator', 'support', 'user'];
            
            for (const slug of slugsToDelete) {
                await dbService.query(
                    'DELETE FROM guild_groups WHERE guild_id = ? AND slug = ?',
                    [guildId, slug]
                );
                Logger.info(`[Migration 6.6.5] Gruppe "${slug}" gelöscht`);
            }
            
            Logger.success(`[Migration 6.6.5] Rollback erfolgreich`);
            
        } catch (error) {
            Logger.error(`[Migration 6.6.5] Rollback fehlgeschlagen:`, error);
            throw error;
        }
    }
};
