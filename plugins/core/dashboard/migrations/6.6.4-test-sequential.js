/**
 * Migration 6.6.4: Test Sequential Migration System
 * 
 * Einfache Test-Migration um zu verifizieren, dass das Sequential-System
 * nur NEUE Migrationen ausführt (nicht alle erneut).
 * 
 * @author FireDervil
 * @version 6.6.4
 */

module.exports = {
    version: '6.6.4',
    name: 'Test Sequential Migration System',
    
    /**
     * Migration ausführen
     * @param {object} dbService - Database Service
     * @param {string} guildId - Guild ID (kann NULL sein für globale Migrations)
     */
    async up(dbService, guildId) {
        const Logger = require('dunebot-core').ServiceManager.get('Logger');
        
        Logger.info(`[Core Migration 6.6.4] 🧪 TEST-MIGRATION für Guild ${guildId || 'GLOBAL'}...`);
        
        try {
            // ========================================
            // EINFACHER TEST: Nur Logging
            // ========================================
            
            Logger.info(`
╔════════════════════════════════════════════════════════════════╗
║           🧪 MIGRATION 6.6.4 - SEQUENTIAL TEST 🧪             ║
╚════════════════════════════════════════════════════════════════╝

✅ Diese Migration sollte NUR laufen wenn:
   - current_version < 6.6.4
   - Migration 6.6.4 noch nicht in plugin_migrations

❌ Diese Migration sollte NICHT laufen wenn:
   - current_version bereits 6.6.4
   - Migration 6.6.4 bereits in plugin_migrations

📊 Aktueller Status:
   - Guild ID: ${guildId || 'GLOBAL'}
   - Migration läuft: JA (du siehst diese Nachricht!)
   - Timestamp: ${new Date().toISOString()}
   
🎯 Test erfolgreich wenn:
   - Beim ersten Restart: Diese Migration läuft ✅
   - Beim zweiten Restart: Diese Migration läuft NICHT ❌
   
            `);
            
            // Optional: Dummy-Update in DB um zu zeigen dass Migration läuft
            if (guildId) {
                const [guild] = await dbService.query(
                    'SELECT _id FROM guilds WHERE _id = ?',
                    [guildId]
                );
                
                if (guild.length > 0) {
                    Logger.success(`[Core Migration 6.6.4] ✅ Guild ${guildId} gefunden - Test erfolgreich!`);
                } else {
                    Logger.warn(`[Core Migration 6.6.4] ⚠️ Guild ${guildId} nicht gefunden in DB`);
                }
            }
            
            Logger.success(`[Core Migration 6.6.4] 🎉 Test-Migration erfolgreich abgeschlossen!`);
            return { success: true };
            
        } catch (error) {
            Logger.error(`[Core Migration 6.6.4] ❌ Test-Migration fehlgeschlagen:`, error);
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
        
        Logger.info(`[Core Migration 6.6.4] Rollback: Keine Änderungen vorgenommen, nichts zu tun.`);
        return { success: true };
    }
};
