/**
 * Migration 6.8.0: Dashboard-Access-Permission für bestehende guild_users
 * 
 * Fügt allen bestehenden guild_users die Permission "CORE.DASHBOARD.ACCESS" hinzu,
 * um Rückwärtskompatibilität zu gewährleisten. Neue Middleware verlangt diese Permission
 * für guild_users ohne Discord-Admin-Rechte.
 * 
 * @author FireDervil
 * @version 6.8.0
 * @date 2025-11-01
 */

module.exports = {
    version: '6.8.0',
    name: 'Dashboard-Access-Permission Migration',
    
    /**
     * Migration ausführen
     * @param {object} dbService - Database Service
     * @param {string} guildId - Guild ID (global migration, guildId ist NULL)
     */
    async up(dbService, guildId) {
        const Logger = require('dunebot-core').ServiceManager.get('Logger');
        
        // Diese Migration läuft nur EINMAL global (nicht pro Guild)
        if (guildId) {
            Logger.debug(`[Migration 6.8.0] Guild-spezifischer Call für ${guildId} → Skip`);
            return { success: true, skipped: true };
        }
        
        Logger.info(`[Migration 6.8.0] Starte Migration: Dashboard-Access-Permission...`);
        
        try {
            // ========================================
            // 1. Prüfe wie viele Users betroffen sind
            // ========================================
            const [countResult] = await dbService.query(`
                SELECT COUNT(*) as total 
                FROM guild_users 
                WHERE status = 'active'
            `);
            
            const totalUsers = countResult.total;
            Logger.info(`[Migration 6.8.0] Gefundene aktive guild_users: ${totalUsers}`);
            
            if (totalUsers === 0) {
                Logger.info(`[Migration 6.8.0] Keine guild_users vorhanden → Migration übersprungen`);
                return { success: true, skipped: true };
            }
            
            // ========================================
            // 2. Alle guild_users laden (mit korrekten Spaltennamen!)
            // ========================================
            const users = await dbService.query(`
                SELECT user_id, guild_id, direct_permissions 
                FROM guild_users 
                WHERE status = 'active'
            `);
            
            let updatedCount = 0;
            let skippedCount = 0;
            
            // ========================================
            // 3. Für jeden User die Permission hinzufügen
            // ========================================
            for (const user of users) {
                let perms = {};
                
                // Bestehende Permissions laden
                if (user.direct_permissions) {
                    try {
                        perms = typeof user.direct_permissions === 'string' 
                            ? JSON.parse(user.direct_permissions) 
                            : user.direct_permissions;
                    } catch (e) {
                        Logger.warn(`[Migration 6.8.0] Fehler beim Parsen von direct_permissions für User ${user.user_id}:`, e.message);
                        perms = {};
                    }
                }
                
                // Permission bereits vorhanden? (boolean oder string)
                if (perms['DASHBOARD.ACCESS'] === true || perms['DASHBOARD.ACCESS'] === 'true') {
                    // Wenn es ein String ist, konvertieren wir es zu boolean
                    if (perms['DASHBOARD.ACCESS'] === 'true') {
                        perms['DASHBOARD.ACCESS'] = true;
                        
                        // Update ausführen (Korrektur)
                        await dbService.query(`
                            UPDATE guild_users 
                            SET direct_permissions = ? 
                            WHERE user_id = ? AND guild_id = ?
                        `, [JSON.stringify(perms), user.user_id, user.guild_id]);
                        
                        updatedCount++;
                        Logger.debug(`[Migration 6.8.0] User ${user.user_id}: String 'true' → Boolean true`);
                        continue;
                    }
                    
                    skippedCount++;
                    continue;
                }
                
                // Permission hinzufügen
                perms['DASHBOARD.ACCESS'] = true;
                
                // Update ausführen
                await dbService.query(`
                    UPDATE guild_users 
                    SET direct_permissions = ? 
                    WHERE user_id = ? AND guild_id = ?
                `, [JSON.stringify(perms), user.user_id, user.guild_id]);
                
                updatedCount++;
            }
            
            Logger.success(`[Migration 6.8.0] Migration erfolgreich!`);
            Logger.success(`   - Aktualisiert: ${updatedCount} Users`);
            Logger.success(`   - Übersprungen: ${skippedCount} Users (hatten bereits die Permission)`);
            
            return { 
                success: true, 
                updated: updatedCount,
                skipped: skippedCount,
                total: totalUsers
            };
            
        } catch (error) {
            Logger.error(`[Migration 6.8.0] Migration fehlgeschlagen:`, error);
            throw error;
        }
    },
    
    /**
     * Rollback (Optional)
     * @param {object} dbService 
     * @param {string} guildId 
     */
    async down(dbService, guildId) {
        const Logger = require('dunebot-core').ServiceManager.get('Logger');
        
        if (guildId) {
            Logger.debug(`[Migration 6.8.0 Rollback] Guild-spezifisch → Skip`);
            return { success: true };
        }
        
        Logger.info(`[Migration 6.8.0 Rollback] Entferne core.dashboard.access Permission...`);
        
        try {
            const users = await dbService.query(`
                SELECT user_id, guild_id, direct_permissions 
                FROM guild_users 
                WHERE status = 'active'
            `);
            
            let removedCount = 0;
            
            for (const user of users) {
                if (!user.direct_permissions) continue;
                
                let perms = {};
                try {
                    perms = typeof user.direct_permissions === 'string' 
                        ? JSON.parse(user.direct_permissions) 
                        : user.direct_permissions;
                } catch (e) {
                    continue;
                }
                
                // Permission entfernen
                if (perms['DASHBOARD.ACCESS']) {
                    delete perms['DASHBOARD.ACCESS'];
                    
                    await dbService.query(`
                        UPDATE guild_users 
                        SET direct_permissions = ? 
                        WHERE user_id = ? AND guild_id = ?
                    `, [JSON.stringify(perms), user.user_id, user.guild_id]);
                    
                    removedCount++;
                }
            }
            
            Logger.success(`[Migration 6.8.0 Rollback] ${removedCount} Permissions entfernt`);
            return { success: true, removed: removedCount };
            
        } catch (error) {
            Logger.error(`[Migration 6.8.0 Rollback] Fehler:`, error);
            throw error;
        }
    }
};
