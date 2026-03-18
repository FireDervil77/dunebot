/**
 * Migration 6.6.2: Verify Routes & Navigation Consistency
 * 
 * Stellt sicher dass Navigation-URLs mit Express-Routen übereinstimmen
 * Da Express automatisch /guild/:guildId/plugins/:pluginName/ voranstellt,
 * müssen die guildRouter-Routen OHNE dieses Prefix definiert sein.
 * 
 * @author FireDervil
 * @version 6.6.2
 */

module.exports = {
    version: '6.6.2',
    name: 'Verify Routes & Navigation Consistency',
    
    /**
     * Migration ausführen
     * @param {object} dbService - Database Service
     * @param {string} guildId - Guild ID (kann NULL sein für globale Migrations)
     */
    async up(dbService, guildId) {
        const Logger = require('dunebot-core').ServiceManager.get('Logger');
        
        Logger.info(`[Core Migration 6.6.2] Verifiziere Routen-Konsistenz${guildId ? ` für Guild ${guildId}` : ''}...`);
        
        try {
            // ========================================
            // NAVIGATION PRÜFEN
            // ========================================
            
            if (guildId) {
                // Navigation-Einträge prüfen
                const navItems = await dbService.query(
                    `SELECT id, title, url, parent 
                     FROM guild_nav_items 
                     WHERE plugin = 'core' 
                     AND guildId = ?
                     ORDER BY sort_order`,
                    [guildId]
                );
                
                Logger.info(`[Core Migration 6.6.2] Gefunden: ${navItems.length} Navigation-Einträge`);
                
                // Erwartete URLs (mit /plugins/core/ Prefix!)
                const expectedUrls = {
                    '/guild/{id}/plugins/core/settings': 'Einstellungen',
                    '/guild/{id}/plugins/core/permissions': 'Berechtigungen',
                    '/guild/{id}/plugins/core/permissions/groups': 'Gruppen',
                    '/guild/{id}/plugins/core/permissions/users': 'Benutzer',
                    '/guild/{id}/plugins/core/plugins': 'Plugins',
                    '/guild/{id}/plugins/core/locales': 'Übersetzungen',
                    '/guild/{id}/plugins/core/themes': 'Design',
                    '/guild/{id}/plugins/core/donate': 'Spenden',
                    '/guild/{id}/plugins/core/hall-of-fame': 'Hall of Fame'
                };
                
                // Prüfe ob alle URLs das Prefix haben
                let fixedCount = 0;
                for (const item of navItems) {
                    if (item.url && !item.url.includes('/plugins/core/')) {
                        Logger.warn(`[Core Migration 6.6.2] Navigation-URL fehlt Prefix: ${item.url}`);
                        fixedCount++;
                    }
                }
                
                if (fixedCount === 0) {
                    Logger.success(`[Core Migration 6.6.2] ✅ Alle Navigation-URLs korrekt (mit /plugins/core/ Prefix)`);
                } else {
                    Logger.warn(`[Core Migration 6.6.2] ⚠️ ${fixedCount} URLs haben fehlendes Prefix (sollte in 6.6.1 gefixt worden sein)`);
                }
            }
            
            // ========================================
            // EXPRESS-ROUTEN INFO AUSGEBEN
            // ========================================
            
            Logger.info(`
[Core Migration 6.6.2] Express-Routen-Struktur:

🔹 Automatisches Routing via guild.router.js:
   /guild/:guildId/plugins/:pluginName → plugin.guildRouter

🔹 Core-Plugin guildRouter-Routen (OHNE /plugins/core/ Prefix!):
   - GET  /                      → Settings Overview
   - GET  /settings              → Guild Settings
   - GET  /permissions           → Permission Management
   - GET  /permissions/groups    → Group Management
   - GET  /permissions/users     → User Management
   - GET  /plugins               → Plugin Management
   - GET  /locales               → Locale Management
   - GET  /themes                → Theme Management
   - GET  /donate                → Donation Page
   - GET  /hall-of-fame          → Hall of Fame
   - POST /plugin-reload/:name   → Plugin Reload

🔹 URL-Mapping-Beispiel:
   Navigation-URL: /guild/123/plugins/core/permissions
   Express registriert: /guild/:guildId/plugins/:pluginName → Core guildRouter
   Core guildRouter empfängt: /permissions
   
   ✅ Navigation-URL (mit Prefix) → Express-Route (ohne Prefix) = KORREKT!

🔹 Wichtig für Entwickler:
   - Navigation-URLs müssen IMMER /plugins/core/ enthalten
   - guildRouter-Routen NIEMALS /plugins/core/ nutzen
   - Express fügt das Prefix automatisch hinzu
            `);
            
            Logger.success(`[Core Migration 6.6.2] Migration erfolgreich! (Info-only, keine Änderungen)`);
            return { success: true };
            
        } catch (error) {
            Logger.error(`[Core Migration 6.6.2] Migration fehlgeschlagen:`, error);
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
        
        Logger.info(`[Core Migration 6.6.2] Rollback (keine Änderungen nötig - war Info-only)`);
        return { success: true };
    }
};
