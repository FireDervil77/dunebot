/**
 * Migration 6.6.6: Fix Groups View
 * 
 * Aktualisiert v_guild_groups_summary View um description und permissions Spalten hinzuzufügen
 * 
 * @author FireDervil + GitHub Copilot
 * @version 6.6.6
 * @date 30. Oktober 2025
 */

module.exports = {
    version: '6.6.6',
    name: 'Fix Groups View - Add Description & Permissions',
    
    /**
     * Migration ausführen
     * @param {object} dbService - Database Service
     * @param {string} guildId - Guild ID
     */
    async up(dbService, guildId) {
        const ServiceManager = require('dunebot-core').ServiceManager;
        const Logger = ServiceManager.get('Logger');
        
        Logger.info(`[Migration 6.6.6] Aktualisiere v_guild_groups_summary View...`);
        
        try {
            // View mit description und permissions Spalten neu erstellen
            await dbService.query(`
                CREATE OR REPLACE VIEW v_guild_groups_summary AS
                SELECT 
                    gg.id,
                    gg.guild_id,
                    gg.name,
                    gg.slug,
                    gg.description,
                    gg.color,
                    gg.icon,
                    gg.is_default,
                    gg.is_protected,
                    gg.priority,
                    gg.permissions,
                    gg.member_count,
                    COUNT(gug.id) AS actual_member_count
                FROM guild_groups gg
                LEFT JOIN guild_user_groups gug ON gg.id = gug.group_id
                GROUP BY gg.id, gg.guild_id, gg.name, gg.slug, gg.description, gg.color, gg.icon, 
                         gg.is_default, gg.is_protected, gg.priority, gg.permissions, gg.member_count
            `);
            
            Logger.success(`[Migration 6.6.6] View v_guild_groups_summary erfolgreich aktualisiert!`);
            Logger.info(`[Migration 6.6.6] Hinzugefügt: description, permissions Spalten`);
            return { success: true };
            
        } catch (error) {
            Logger.error(`[Migration 6.6.6] Fehler:`, error);
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
        
        Logger.info(`[Migration 6.6.6] ROLLBACK - Stelle alte View wieder her...`);
        
        try {
            // Alte View ohne description und permissions
            await dbService.query(`
                CREATE OR REPLACE VIEW v_guild_groups_summary AS
                SELECT 
                    gg.id,
                    gg.guild_id,
                    gg.name,
                    gg.slug,
                    gg.color,
                    gg.icon,
                    gg.is_default,
                    gg.is_protected,
                    gg.priority,
                    gg.member_count,
                    COUNT(gug.id) AS actual_member_count
                FROM guild_groups gg
                LEFT JOIN guild_user_groups gug ON gg.id = gug.group_id
                GROUP BY gg.id, gg.guild_id, gg.name, gg.slug, gg.color, gg.icon, 
                         gg.is_default, gg.is_protected, gg.priority, gg.member_count
            `);
            
            Logger.success(`[Migration 6.6.6] Rollback erfolgreich`);
            
        } catch (error) {
            Logger.error(`[Migration 6.6.6] Rollback fehlgeschlagen:`, error);
            throw error;
        }
    }
};
