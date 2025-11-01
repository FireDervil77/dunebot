/**
 * Migration 6.6.3: Fix Permissions View - Add group_permissions Column
 * 
 * Die View v_guild_user_permissions fehlte die group_permissions Spalte,
 * die vom PermissionManager erwartet wird. Diese Migration fügt die Spalte hinzu
 * durch Aggregation der permissions aus allen Gruppen des Users.
 * 
 * @author FireDervil
 * @version 6.6.3
 */

module.exports = {
    version: '6.6.3',
    name: 'Fix Permissions View - Add group_permissions',
    
    /**
     * Migration ausführen
     * @param {object} dbService - Database Service
     * @param {string} guildId - Guild ID (kann NULL sein für globale Migrations)
     */
    async up(dbService, guildId) {
        const Logger = require('dunebot-core').ServiceManager.get('Logger');
        
        Logger.info(`[Core Migration 6.6.3] Aktualisiere v_guild_user_permissions View...`);
        
        try {
            // ========================================
            // VIEW ERWEITERN (EINFACHE VERSION)
            // ========================================
            
            // View neu erstellen mit group_permissions_raw Spalte
            // (PermissionManager muss dann manuell mergen)
            await dbService.query(`
                CREATE OR REPLACE VIEW v_guild_user_permissions AS
                SELECT 
                    gu.id AS guild_user_id,
                    gu.guild_id,
                    gu.user_id,
                    gu.is_owner,
                    gu.status,
                    gu.direct_permissions,
                    gu.last_login_at,
                    GROUP_CONCAT(DISTINCT gg.id ORDER BY gg.priority DESC) AS group_ids,
                    GROUP_CONCAT(DISTINCT gg.name ORDER BY gg.priority DESC SEPARATOR ', ') AS group_names,
                    GROUP_CONCAT(DISTINCT gg.slug ORDER BY gg.priority DESC SEPARATOR ', ') AS group_slugs,
                    GROUP_CONCAT(DISTINCT gg.permissions ORDER BY gg.priority DESC SEPARATOR '|||') AS group_permissions
                FROM guild_users gu
                LEFT JOIN guild_user_groups gug ON gu.id = gug.guild_user_id
                LEFT JOIN guild_groups gg ON gug.group_id = gg.id
                GROUP BY gu.id, gu.guild_id, gu.user_id, gu.is_owner, gu.status, gu.direct_permissions, gu.last_login_at
            `);
            
            Logger.success('[Core Migration 6.6.3] View v_guild_user_permissions erfolgreich aktualisiert!');
            Logger.info('[Core Migration 6.6.3] group_permissions enthält jetzt: "perm1|||perm2|||..." (muss im Code gesplittet werden)');
            
            Logger.success(`[Core Migration 6.6.3] Migration erfolgreich!`);
            return { success: true };
            
        } catch (error) {
            Logger.error(`[Core Migration 6.6.3] Migration fehlgeschlagen:`, error);
            throw error;
        }
    },
    
    /**
     * Rollback
     * @param {object} dbService 
     * @param {string} guildId 
     */
    async down(dbService, guildId) {
        const Logger = require('dunebot-core').ServiceManager.get('Logger');
        
        Logger.info(`[Core Migration 6.6.3] Rollback: Stelle alte View wieder her...`);
        
        try {
            // Alte View ohne group_permissions wiederherstellen
            await dbService.query(`
                CREATE OR REPLACE VIEW v_guild_user_permissions AS
                SELECT 
                    gu.id AS guild_user_id,
                    gu.guild_id,
                    gu.user_id,
                    gu.is_owner,
                    gu.status,
                    gu.direct_permissions,
                    gu.last_login_at,
                    GROUP_CONCAT(gg.id) AS group_ids,
                    GROUP_CONCAT(gg.name SEPARATOR ', ') AS group_names,
                    GROUP_CONCAT(gg.slug SEPARATOR ', ') AS group_slugs
                FROM guild_users gu
                LEFT JOIN guild_user_groups gug ON gu.id = gug.guild_user_id
                LEFT JOIN guild_groups gg ON gug.group_id = gg.id
                GROUP BY gu.id, gu.guild_id, gu.user_id, gu.is_owner, gu.status, gu.direct_permissions, gu.last_login_at
            `);
            
            Logger.success(`[Core Migration 6.6.3] Rollback erfolgreich!`);
            
        } catch (error) {
            Logger.error(`[Core Migration 6.6.3] Rollback fehlgeschlagen:`, error);
            throw error;
        }
    }
};
