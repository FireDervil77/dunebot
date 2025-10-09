/**
 * DuneMap v2.0.0 Migration
 * 
 * Änderungen:
 * - Fügt coriolis_region Setting hinzu (Default: EU)
 * - Entfernt alte manuelle Storm-Timer Settings
 * - Automatisches Storm-Timer-System basierend auf Region
 * 
 * @author FireDervil
 * @version 2.0.0
 */

const { ServiceManager } = require('dunebot-core');

module.exports = {
    name: 'DuneMap v2.0.0 Migration',
    version: '2.0.0',
    description: 'Migrates from manual storm timer to automatic region-based system',
    
    /**
     * Upgrade auf v2.0.0
     * @param {DBService} dbService 
     * @param {string} guildId - Guild ID (null = alle Guilds)
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async up(dbService, guildId = null) {
        const Logger = ServiceManager.get('Logger');
        
        try {
            Logger.info(`[DuneMap Migration] Starting v2.0.0 migration${guildId ? ` for Guild ${guildId}` : ' for all guilds'}`);
            
            // Wenn keine guildId, dann alle Guilds mit DuneMap
            if (!guildId) {
                const guilds = await dbService.query(`
                    SELECT DISTINCT guild_id 
                    FROM configs 
                    WHERE plugin_name = 'dunemap'
                `);
                
                Logger.info(`[DuneMap Migration] Found ${guilds.length} guilds with DuneMap`);
                
                for (const { guild_id } of guilds) {
                    const result = await this.up(dbService, guild_id);
                    if (!result.success) {
                        Logger.error(`[DuneMap Migration] Failed for Guild ${guild_id}:`, result.error);
                    }
                }
                
                return { success: true, guilds: guilds.length };
            }
            
            // Guild-spezifische Migration
            
            // 1. coriolis_region Setting anlegen (falls nicht vorhanden)
            await dbService.query(`
                INSERT INTO configs 
                    (plugin_name, config_key, config_value, guild_id, context)
                VALUES 
                    ('dunemap', 'coriolis_region', 'EU', ?, 'shared')
                ON DUPLICATE KEY UPDATE 
                    config_key = config_key
            `, [guildId]);
            
            Logger.info(`[DuneMap Migration] ✅ coriolis_region set to EU for Guild ${guildId}`);
            
            // 2. Alte manuelle Timer-Settings entfernen
            const oldSettings = [
                'STORM_TIMER_FORMAT',
                'STROM_TIMER_TIMEZONE', 
                'STORM_TIME_RECALCULATE_TIME',
                'STROM_TIMER_DURATION'
            ];
            
            const result = await dbService.query(`
                DELETE FROM configs 
                WHERE plugin_name = 'dunemap' 
                AND config_key IN (?, ?, ?, ?)
                AND guild_id = ?
            `, [...oldSettings, guildId]);
            
            Logger.info(`[DuneMap Migration] ✅ Removed ${result.affectedRows} old settings for Guild ${guildId}`);
            
            // 3. Alte dunemap_storm_timer Einträge als deprecated markieren (nicht löschen für Rollback)
            await dbService.query(`
                UPDATE dunemap_storm_timer 
                SET created_by = CONCAT('DEPRECATED_v1_', created_by)
                WHERE guild_id = ?
                AND created_by NOT LIKE 'DEPRECATED_%'
            `, [guildId]);
            
            Logger.success(`[DuneMap Migration] ✅ v2.0.0 migration completed for Guild ${guildId}`);
            
            return { success: true };
            
        } catch (error) {
            Logger.error(`[DuneMap Migration] ❌ Migration failed:`, error);
            return { 
                success: false, 
                error: error.message,
                stack: error.stack 
            };
        }
    },
    
    /**
     * Rollback zu v1.x
     * @param {DBService} dbService 
     * @param {string} guildId 
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async down(dbService, guildId = null) {
        const Logger = ServiceManager.get('Logger');
        
        try {
            Logger.warn(`[DuneMap Migration] Rolling back v2.0.0 to v1.x${guildId ? ` for Guild ${guildId}` : ''}`);
            
            // Wenn keine guildId, alle Guilds
            if (!guildId) {
                const guilds = await dbService.query(`
                    SELECT DISTINCT guild_id 
                    FROM configs 
                    WHERE plugin_name = 'dunemap'
                `);
                
                for (const { guild_id } of guilds) {
                    await this.down(dbService, guild_id);
                }
                
                return { success: true };
            }
            
            // 1. coriolis_region Setting entfernen
            await dbService.query(`
                DELETE FROM configs 
                WHERE plugin_name = 'dunemap' 
                AND config_key = 'coriolis_region'
                AND guild_id = ?
            `, [guildId]);
            
            // 2. Alte Settings wiederherstellen (mit Defaults)
            const defaultSettings = [
                ['STORM_TIMER_FORMAT', 'compact'],
                ['STROM_TIMER_TIMEZONE', 'Europe/Berlin'],
                ['STORM_TIME_RECALCULATE_TIME', '04:00'],
                ['STROM_TIMER_DURATION', '10']
            ];
            
            for (const [key, value] of defaultSettings) {
                await dbService.query(`
                    INSERT INTO configs 
                        (plugin_name, config_key, config_value, guild_id, context)
                    VALUES 
                        ('dunemap', ?, ?, ?, 'shared')
                    ON DUPLICATE KEY UPDATE 
                        config_value = VALUES(config_value)
                `, [key, value, guildId]);
            }
            
            // 3. dunemap_storm_timer Einträge reaktivieren
            await dbService.query(`
                UPDATE dunemap_storm_timer 
                SET created_by = REPLACE(created_by, 'DEPRECATED_v1_', '')
                WHERE guild_id = ?
                AND created_by LIKE 'DEPRECATED_v1_%'
            `, [guildId]);
            
            Logger.success(`[DuneMap Migration] ✅ Rollback to v1.x completed for Guild ${guildId}`);
            
            return { success: true };
            
        } catch (error) {
            Logger.error(`[DuneMap Migration] ❌ Rollback failed:`, error);
            return { 
                success: false, 
                error: error.message 
            };
        }
    }
};
