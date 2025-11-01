/**
 * Migration 6.7.0: Dynamic Plugin-Based Permission System
 * 
 * Erweitert das Permission-System um dynamische, guild-spezifische Permissions:
 * - Fügt guild_id zu permission_definitions hinzu (Pro-Guild Permissions)
 * - Permissions werden dynamisch aus plugin/permissions.json geladen
 * - Beim Plugin-Enable: Permissions registrieren
 * - Beim Plugin-Disable: Permissions entfernen
 * 
 * Breaking Change: permission_key ist jetzt pro Guild unique (nicht mehr global)
 * 
 * @author FireDervil
 * @version 6.7.0
 * @date 2025-10-31
 */

module.exports = {
    version: '6.7.0',
    name: 'Dynamic Plugin-Based Permission System',
    
    /**
     * Migration ausführen
     * @param {object} dbService - Database Service
     * @param {string} guildId - Guild ID
     */
    async up(dbService, guildId) {
        const Logger = require('dunebot-core').ServiceManager.get('Logger');
        
        try {
            Logger.info(`[Core Migration 6.7.0] Starte Dynamic Permissions Migration für Guild ${guildId}...`);
            
            // ========================================
            // PHASE 1: Schema-Änderungen
            // ========================================
            Logger.info('[Core Migration 6.7.0] Phase 1: Schema-Anpassungen...');
            
            // 1.1 guild_id Spalte hinzufügen (falls noch nicht vorhanden)
            try {
                await dbService.query(`
                    ALTER TABLE permission_definitions
                    ADD COLUMN guild_id VARCHAR(20) DEFAULT NULL AFTER id
                `);
                Logger.success('[Core Migration 6.7.0] guild_id Spalte hinzugefügt');
            } catch (err) {
                if (err.errno === 1060) {
                    Logger.debug('[Core Migration 6.7.0] guild_id Spalte existiert bereits');
                } else {
                    throw err;
                }
            }
            
            // 1.2 Unique-Constraint anpassen (permission_key → guild_id + permission_key)
            try {
                // Alten Constraint entfernen
                await dbService.query(`
                    ALTER TABLE permission_definitions
                    DROP INDEX permission_key
                `);
                Logger.debug('[Core Migration 6.7.0] Alter permission_key Constraint entfernt');
            } catch (err) {
                if (err.errno !== 1091) {  // 1091 = Can't DROP index
                    Logger.warn('[Core Migration 6.7.0] Warnung beim Entfernen des alten Constraints:', err.message);
                }
            }
            
            // Neuen Constraint hinzufügen
            try {
                await dbService.query(`
                    ALTER TABLE permission_definitions
                    ADD UNIQUE KEY unique_guild_permission (guild_id, permission_key)
                `);
                Logger.success('[Core Migration 6.7.0] Neuer unique_guild_permission Constraint erstellt');
            } catch (err) {
                if (err.errno !== 1061) {  // 1061 = Duplicate key name
                    throw err;
                }
                Logger.debug('[Core Migration 6.7.0] Constraint existiert bereits');
            }
            
            // 1.3 Performance-Index für guild_id + plugin_name
            try {
                await dbService.query(`
                    ALTER TABLE permission_definitions
                    ADD INDEX idx_guild_plugin (guild_id, plugin_name)
                `);
                Logger.success('[Core Migration 6.7.0] Index idx_guild_plugin erstellt');
            } catch (err) {
                if (err.errno !== 1061) {
                    throw err;
                }
                Logger.debug('[Core Migration 6.7.0] Index existiert bereits');
            }
            
            Logger.success('[Core Migration 6.7.0] Phase 1 abgeschlossen: Schema aktualisiert');
            
            // ========================================
            // PHASE 2: Bestehende Permissions migrieren
            // ========================================
            Logger.info(`[Core Migration 6.7.0] Phase 2: Migriere bestehende Permissions für Guild ${guildId}...`);
            
            // Prüfe ob bereits guild-spezifische Permissions existieren
            const existing = await dbService.query(
                'SELECT COUNT(*) as count FROM permission_definitions WHERE guild_id = ?',
                [guildId]
            );
            
            if (existing.length > 0 && existing[0].count > 0) {
                Logger.info(`[Core Migration 6.7.0] Guild ${guildId} hat bereits ${existing[0].count} Permissions, überspringe Duplizierung`);
            } else {
                // Hole alle globalen Permissions (guild_id = NULL)
                const globalPermissions = await dbService.query(
                    'SELECT * FROM permission_definitions WHERE guild_id IS NULL'
                );
                
                if (globalPermissions.length > 0) {
                    Logger.info(`[Core Migration 6.7.0] Kopiere ${globalPermissions.length} globale Permissions für Guild ${guildId}...`);
                    
                    for (const perm of globalPermissions) {
                        try {
                            await dbService.query(`
                                INSERT INTO permission_definitions 
                                (guild_id, permission_key, category, name_translation_key, description_translation_key, 
                                 is_dangerous, requires_permissions, plugin_name, sort_order, is_active)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            `, [
                                guildId,
                                perm.permission_key,
                                perm.category,
                                perm.name_translation_key,
                                perm.description_translation_key,
                                perm.is_dangerous,
                                perm.requires_permissions,
                                perm.plugin_name,
                                perm.sort_order,
                                perm.is_active
                            ]);
                        } catch (err) {
                            if (err.errno !== 1062) {  // 1062 = Duplicate entry
                                Logger.warn(`[Core Migration 6.7.0] Fehler beim Kopieren von ${perm.permission_key}:`, err.message);
                            }
                        }
                    }
                    
                    Logger.success(`[Core Migration 6.7.0] ${globalPermissions.length} Permissions für Guild ${guildId} kopiert`);
                } else {
                    Logger.info('[Core Migration 6.7.0] Keine globalen Permissions gefunden (Fresh Install)');
                }
            }
            
            Logger.success('[Core Migration 6.7.0] Phase 2 abgeschlossen: Permissions migriert');
            
            // ========================================
            // PHASE 3: Plugin-Permissions aus JSON laden
            // ========================================
            Logger.info('[Core Migration 6.7.0] Phase 3: Lade Plugin-Permissions aus permissions.json...');
            
            const permissionManager = require('dunebot-core').ServiceManager.get('permissionManager');
            const pluginManager = require('dunebot-core').ServiceManager.get('pluginManager');
            
            // Hole alle aktivierten Plugins für diese Guild aus guild_plugins Tabelle
            const enabledPluginsResult = await dbService.query(
                'SELECT plugin_name FROM guild_plugins WHERE guild_id = ? AND is_enabled = 1',
                [guildId]
            );
            
            for (const { plugin_name: pluginName } of enabledPluginsResult) {
                // Plugin-Instanz vom PluginManager holen
                const plugin = pluginManager.getPlugin(pluginName);
                
                if (!plugin) {
                    Logger.warn(`[Core Migration 6.7.0] Plugin "${pluginName}" nicht gefunden (enabled in DB, aber nicht geladen)`);
                    continue;
                }
                try {
                    // Versuche permissions.json zu laden
                    const permissionsJson = plugin.getPermissions();
                    
                    if (permissionsJson && permissionsJson.length > 0) {
                        Logger.info(`[Core Migration 6.7.0] Registriere ${permissionsJson.length} Permissions für Plugin "${pluginName}"...`);
                        
                        await permissionManager.registerPluginPermissions(
                            pluginName,
                            guildId,
                            permissionsJson
                        );
                        
                        Logger.success(`[Core Migration 6.7.0] Plugin "${pluginName}": ${permissionsJson.length} Permissions registriert`);
                    } else {
                        Logger.debug(`[Core Migration 6.7.0] Plugin "${pluginName}" hat keine permissions.json`);
                    }
                } catch (error) {
                    Logger.warn(`[Core Migration 6.7.0] Fehler beim Laden von Permissions für Plugin "${pluginName}":`, error.message);
                }
            }
            
            Logger.success('[Core Migration 6.7.0] Phase 3 abgeschlossen: Plugin-Permissions geladen');
            
            // ========================================
            // PHASE 4: Cleanup (Optional)
            // ========================================
            Logger.info('[Core Migration 6.7.0] Phase 4: Cleanup...');
            
            // Optional: Lösche globale Permissions (guild_id = NULL) nach erfolgreicher Migration
            // VORSICHT: Nur löschen wenn ALLE Guilds migriert wurden!
            // Daher: Vorerst NICHT löschen (werden beim nächsten Enable überschrieben)
            
            Logger.info('[Core Migration 6.7.0] Cleanup übersprungen (globale Permissions bleiben als Fallback)');
            
            Logger.success(`[Core Migration 6.7.0] Migration erfolgreich abgeschlossen für Guild ${guildId}!`);
            
            return { success: true };
            
        } catch (error) {
            Logger.error(`[Core Migration 6.7.0] Migration fehlgeschlagen für Guild ${guildId}:`, error);
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
        
        Logger.info(`[Core Migration 6.7.0] ROLLBACK für Guild ${guildId}...`);
        
        try {
            // Lösche guild-spezifische Permissions
            await dbService.query(
                'DELETE FROM permission_definitions WHERE guild_id = ?',
                [guildId]
            );
            
            if (Logger.success) {
                Logger.success('[Core Migration 6.7.0] Guild-spezifische Permissions gelöscht');
            } else {
                Logger.info('[Core Migration 6.7.0] Guild-spezifische Permissions gelöscht');
            }
            
            // Hinweis: Schema-Änderungen (guild_id Spalte) werden NICHT rückgängig gemacht
            // da andere Guilds diese bereits nutzen könnten
            
            if (Logger.success) {
                Logger.success(`[Core Migration 6.7.0] Rollback erfolgreich für Guild ${guildId}`);
            } else {
                Logger.info(`[Core Migration 6.7.0] Rollback erfolgreich für Guild ${guildId}`);
            }
            
        } catch (error) {
            Logger.error(`[Core Migration 6.7.0] Rollback fehlgeschlagen:`, error);
            throw error;
        }
    }
};
