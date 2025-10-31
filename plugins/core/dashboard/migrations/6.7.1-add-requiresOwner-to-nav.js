/**
 * Migration 6.7.1: Add requiresOwner to nav_items
 * 
 * Fügt requiresOwner Spalte zu nav_items hinzu für Bot-Owner-Only Navigation (SuperAdmin Plugin)
 * 
 * @author FireDervil
 * @version 6.7.1
 */

module.exports = {
    version: '6.7.1',
    name: 'Add requiresOwner to nav_items',
    
    /**
     * Migration ausführen
     * @param {object} dbService - Database Service
     * @param {string} guildId - Guild ID (kann NULL sein für globale Migrations)
     */
    async up(dbService, guildId) {
        const Logger = require('dunebot-core').ServiceManager.get('Logger');
        
        Logger.info(`[Core Migration 6.7.1] Füge requiresOwner Spalte zu nav_items hinzu${guildId ? ` für Guild ${guildId}` : ''}...`);
        
        try {
            // Prüfe ob Spalte bereits existiert
            const columns = await dbService.query(`
                SELECT COLUMN_NAME 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_SCHEMA = DATABASE() 
                AND TABLE_NAME = 'nav_items' 
                AND COLUMN_NAME = 'requiresOwner'
            `);
            
            if (columns.length > 0) {
                Logger.info('[Core Migration 6.7.1] Spalte requiresOwner existiert bereits - überspringe');
                return { success: true };
            }
            
            // Füge requiresOwner Spalte hinzu
            await dbService.query(`
                ALTER TABLE nav_items 
                ADD COLUMN requiresOwner BOOLEAN DEFAULT FALSE 
                COMMENT 'Wenn TRUE: Nur Bot-Owner (OWNER_IDS) können dieses Nav-Item sehen'
            `);
            
            Logger.success('[Core Migration 6.7.1] requiresOwner Spalte erfolgreich hinzugefügt!');
            
            return { success: true };
            
        } catch (error) {
            Logger.error(`[Core Migration 6.7.1] Migration fehlgeschlagen:`, error);
            throw error;
        }
    },
    
    /**
     * Rollback (optional)
     * @param {object} dbService 
     * @param {string} guildId 
     */
    async down(dbService, guildId) {
        const Logger = require('dunebot-core').ServiceManager.get('Logger');
        
        Logger.info(`[Core Migration 6.7.1] ROLLBACK - Entferne requiresOwner Spalte${guildId ? ` für Guild ${guildId}` : ''}...`);
        
        try {
            await dbService.query(`
                ALTER TABLE nav_items 
                DROP COLUMN requiresOwner
            `);
            
            Logger.success(`[Core Migration 6.7.1] Rollback erfolgreich!`);
            
        } catch (error) {
            Logger.error(`[Core Migration 6.7.1] Rollback fehlgeschlagen:`, error);
            throw error;
        }
    }
};
