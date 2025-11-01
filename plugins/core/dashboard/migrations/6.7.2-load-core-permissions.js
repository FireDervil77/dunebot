/**
 * Migration 6.7.2: Load Core Permissions per Guild
 * 
 * Lädt alle Core-Permissions aus permissions.json für die Guild.
 * WICHTIG: Permissions sind IMMER guild-spezifisch (kein guild_id = NULL mehr!)
 * 
 * @author FireDervil
 * @version 6.7.2
 * @date 2025-10-31
 */

module.exports = {
    version: '6.7.2',
    name: 'Load Core Permissions per Guild',
    
    /**
     * Migration ausführen
     * @param {object} dbService - Database Service
     * @param {string} guildId - Guild ID
     */
    async up(dbService, guildId) {
        const Logger = require('dunebot-core').ServiceManager.get('Logger');
        const PermissionManager = require('dunebot-core').ServiceManager.get('permissionManager');
        const fs = require('fs');
        const path = require('path');
        
        try {
            Logger.info(`[Core Migration 6.7.2] Lade Core-Permissions für Guild ${guildId}...`);
            
            // permissions.json laden
            const permissionsJsonPath = path.join(__dirname, '../permissions.json');
            
            if (!fs.existsSync(permissionsJsonPath)) {
                Logger.warn('[Core Migration 6.7.2] permissions.json nicht gefunden - überspringe Migration');
                return { success: true };
            }
            
            const permissionsData = JSON.parse(fs.readFileSync(permissionsJsonPath, 'utf8'));
            
            if (!permissionsData.permissions || permissionsData.permissions.length === 0) {
                Logger.warn('[Core Migration 6.7.2] Keine Permissions in permissions.json gefunden');
                return { success: true };
            }
            
            Logger.info(`[Core Migration 6.7.2] Gefunden: ${permissionsData.permissions.length} Permissions`);
            
            // Lösche alte Core-Permissions für diese Guild (Clean Slate)
            await dbService.query(
                'DELETE FROM permission_definitions WHERE plugin_name = ? AND guild_id = ?',
                ['core', guildId]
            );
            
            Logger.info('[Core Migration 6.7.2] Alte Core-Permissions gelöscht');
            
            // Registriere Permissions via PermissionManager (macht JSON-Array-Konvertierung automatisch!)
            const registered = await PermissionManager.registerPluginPermissions(
                'core',
                guildId,
                permissionsData.permissions
            );
            
            Logger.success(`[Core Migration 6.7.2] ✅ ${registered} Core-Permissions für Guild ${guildId} registriert!`);
            
            return { success: true };
            
        } catch (error) {
            Logger.error(`[Core Migration 6.7.2] Migration fehlgeschlagen für Guild ${guildId}:`, error);
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
        
        Logger.info(`[Core Migration 6.7.2] ROLLBACK für Guild ${guildId}...`);
        
        try {
            // Lösche alle Core-Permissions für diese Guild
            await dbService.query(
                'DELETE FROM permission_definitions WHERE plugin_name = ? AND guild_id = ?',
                ['core', guildId]
            );
            
            Logger.success(`[Core Migration 6.7.2] Rollback erfolgreich - Core-Permissions gelöscht`);
            
        } catch (error) {
            Logger.error(`[Core Migration 6.7.2] Rollback fehlgeschlagen:`, error);
            throw error;
        }
    }
};
