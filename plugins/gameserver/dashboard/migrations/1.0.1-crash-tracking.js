/**
 * Migration 1.0.1: Crash-Tracking für Gameserver
 * 
 * Fügt Spalten für Crash-Tracking zur gameservers Tabelle hinzu:
 * - crash_count: Anzahl der Crashes
 * - last_crash_at: Zeitpunkt des letzten Crashes
 * - last_crash_reason: Grund des letzten Crashes
 * 
 * @author FireBot Team
 * @version 1.0.1
 * @date 2025-11-04
 */

module.exports = {
    version: '1.0.1',
    name: 'Crash-Tracking für Gameserver',
    
    /**
     * Migration ausführen
     * @param {object} dbService - Database Service
     * @param {string} guildId - Guild ID (kann NULL sein für globale Migrations)
     */
    async up(dbService, guildId) {
        const Logger = require('dunebot-core').ServiceManager.get('Logger');
        
        Logger.info(`[Plugin Migration 1.0.1] Füge Crash-Tracking Spalten hinzu...`);
        
        try {
            // Prüfe ob Spalten bereits existieren
            const columnsCheck = await dbService.query(`
                SELECT COLUMN_NAME 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_SCHEMA = DATABASE() 
                AND TABLE_NAME = 'gameservers' 
                AND COLUMN_NAME IN ('crash_count', 'last_crash_at', 'last_crash_reason')
            `);
            
            if (columnsCheck.length === 0) {
                // Spalten hinzufügen
                await dbService.query(`
                    ALTER TABLE gameservers 
                    ADD COLUMN crash_count INT DEFAULT 0 AFTER auto_update,
                    ADD COLUMN last_crash_at DATETIME DEFAULT NULL AFTER crash_count,
                    ADD COLUMN last_crash_reason TEXT DEFAULT NULL AFTER last_crash_at
                `);
                
                Logger.success(`[Plugin Migration 1.0.1] Crash-Tracking Spalten erfolgreich hinzugefügt!`);
            } else {
                Logger.info(`[Plugin Migration 1.0.1] Crash-Tracking Spalten existieren bereits (${columnsCheck.length}/3)`);
            }
            
            return { success: true };
            
        } catch (error) {
            Logger.error(`[Plugin Migration 1.0.1] Migration fehlgeschlagen:`, error);
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
        
        Logger.info(`[Plugin Migration 1.0.1] ROLLBACK - Entferne Crash-Tracking Spalten...`);
        
        try {
            await dbService.query(`
                ALTER TABLE gameservers 
                DROP COLUMN IF EXISTS crash_count,
                DROP COLUMN IF EXISTS last_crash_at,
                DROP COLUMN IF EXISTS last_crash_reason
            `);
            
            Logger.success(`[Plugin Migration 1.0.1] Rollback erfolgreich!`);
            
        } catch (error) {
            Logger.error(`[Plugin Migration 1.0.1] Rollback fehlgeschlagen:`, error);
            throw error;
        }
    }
};