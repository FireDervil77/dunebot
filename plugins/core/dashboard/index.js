const { DashboardPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');
const { registerKernNavigation } = require('../../../apps/dashboard/helpers/KernNavigation');


class CoreDashboardPlugin extends DashboardPlugin {
  constructor(app) {
        super({
            name: 'core',
            displayName: 'Kern-Plugin',
            description: 'Grundlegende Funktionen für FireBot Dashboard',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
            icon: 'fa-solid fa-cog',
            baseDir: __dirname
        });
        
        this.app = app;
    }

  /**
   * Plugin aktivieren (Stub - Widgets/Hooks werden vom Kern direkt registriert)
   */
  async enable() {
      const Logger = ServiceManager.get('Logger');
      Logger.debug('[Core] CoreDashboardPlugin.enable() aufgerufen (Stub)');
      return true;
  }

  /**
   * Shortcode für Guild-Namen registrieren
   */
  _registerShortcodes() {
      this.app.shortcodeParser.register(this.name, 'guild-name', (attrs, content, context) => {
          const guildId = context.guildId || attrs.id;
          if (!guildId) return '[Keine Guild-ID]';
          const guild = this.app.client?.guilds.cache.get(guildId);
          return guild ? guild.name : '[Unbekannte Guild]';
      });
  }
  
    /**
     * Wird nach einem Plugin-Update ausgeführt
     * 
     * @param {string} oldVersion - Alte Plugin-Version  
     * @param {string} newVersion - Neue Plugin-Version
     * @param {string} guildId - Guild ID (optional)
     */
    async onUpdate(oldVersion, newVersion, guildId = null) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        const PermissionManager = require('dunebot-sdk/lib/PermissionManager');
        const semver = require('semver');
        
        Logger.info(`[Core] Update-Hook: ${oldVersion} → ${newVersion}${guildId ? ' (Guild: ' + guildId + ')' : ' (global)'}`);
        
        try {
            // Version 6.6.0: Permission-System
            if (semver.gte(newVersion, '6.6.0') && semver.lt(oldVersion, '6.6.0') && guildId) {
                Logger.info('[Core] Erkannte Migration: Permission-System (v6.6.0)');

                const [groups] = await dbService.query(
                    'SELECT COUNT(*) as count FROM guild_groups WHERE guild_id = ?',
                    [guildId]
                );
                
                if (!groups || groups.count === 0) {
                    Logger.warn(`[Core] Keine Gruppen für Guild ${guildId}, erstelle Standard-Gruppen...`);
                    await PermissionManager.seedDefaultGroups(guildId);
                }

                const [guild] = await dbService.query(
                    'SELECT owner_id FROM guilds WHERE _id = ?',
                    [guildId]
                );
                
                if (guild && guild.owner_id) {
                    const [userExists] = await dbService.query(
                        'SELECT id FROM guild_users WHERE user_id = ? AND guild_id = ?',
                        [guild.owner_id, guildId]
                    );
                    
                    if (!userExists) {
                        await PermissionManager.upsertGuildUser(guild.owner_id, guildId, {
                            is_owner: true,
                            status: 'active'
                        });

                        const [adminGroup] = await dbService.query(
                            'SELECT id FROM guild_groups WHERE guild_id = ? AND slug = ?',
                            [guildId, 'administrator']
                        );
                        
                        if (adminGroup) {
                            await PermissionManager.assignUserToGroup(guild.owner_id, adminGroup.id, 'system');
                        }
                    }
                }
                
                Logger.success('[Core] Permission-System Update abgeschlossen');
            }

            // Generell: Navigation bei Core-Updates aktualisieren
            if (guildId) {
                Logger.info(`[Core] Aktualisiere Navigation für Guild ${guildId}...`);
                await registerKernNavigation(guildId);
                Logger.success(`[Core] Navigation für Guild ${guildId} aktualisiert`);
            }
            
            return { success: true, message: `Core-Plugin erfolgreich aktualisiert auf ${newVersion}` };
            
        } catch (error) {
            Logger.error('[Core] Fehler in onUpdate():', error);
            return { success: false, error: `Update fehlgeschlagen: ${error.message}` };
        }
    }

    /**
                    // Sicherstellen, dass Standard-Gruppen existieren
                    const [groups] = await dbService.query(
                        'SELECT COUNT(*) as count FROM guild_groups WHERE guild_id = ?',
                        [guildId]
                    );
                    
                    if (!groups || groups.count === 0) {
                        Logger.warn(`[Core] Keine Gruppen für Guild ${guildId}, erstelle Standard-Gruppen...`);
                        await PermissionManager.seedDefaultGroups(guildId);
                    }
                    
                    // Owner zur Admin-Gruppe hinzufügen (falls nicht schon passiert)
                    const [guild] = await dbService.query(
                        'SELECT owner_id FROM guilds WHERE _id = ?',
                        [guildId]
                    );
                    
                    if (guild && guild.owner_id) {
                        const [userExists] = await dbService.query(
                            'SELECT id FROM guild_users WHERE user_id = ? AND guild_id = ?',
                            [guild.owner_id, guildId]
                        );
                        
                        if (!userExists) {
                            Logger.info(`[Core] Erstelle Owner-User für Guild ${guildId}`);
                            await PermissionManager.upsertGuildUser(guild.owner_id, guildId, {
                                is_owner: true,
                                status: 'active'
                            });
                            
                            // Zur Admin-Gruppe hinzufügen
                            const [adminGroup] = await dbService.query(
                                'SELECT id FROM guild_groups WHERE guild_id = ? AND slug = ?',
                                [guildId, 'administrator']
                            );
                            
                            if (adminGroup) {
                                await PermissionManager.assignUserToGroup(guild.owner_id, adminGroup.id, 'system');
                                Logger.success(`[Core] Owner zur Administrator-Gruppe hinzugefügt`);
                            }
                        }
                    }
                    
                    // Navigation aktualisieren (WICHTIG: Core kann nicht deaktiviert werden!)
                    Logger.info(`[Core] Aktualisiere Navigation für Guild ${guildId}...`);
                    try {
                        // Alte Navigation löschen
                        await dbService.query(
                            "DELETE FROM guild_nav_items WHERE plugin = ? AND guildId = ?",
                            ['core', guildId]
                        );
                        
                        // Neue Navigation registrieren
                        await this._registerNavigation(guildId);
                        
                        const [navCount] = await dbService.query(
                            "SELECT COUNT(*) as count FROM guild_nav_items WHERE plugin = ? AND guildId = ?",
                            ['core', guildId]
                        );
                        
                        Logger.success(`[Core] Navigation aktualisiert: ${navCount.count} Einträge`);
                    } catch (navError) {
                        Logger.error('[Core] Fehler beim Aktualisieren der Navigation:', navError);
                        // Nicht abbrechen, Update ist trotzdem erfolgreich
                    }
                }
                
                Logger.success('[Core] Permission-System Update abgeschlossen');
            }
            
            // ====================================
            // GENERELLES: Navigation IMMER aktualisieren bei Core-Updates
            // ====================================
            if (guildId) {
                Logger.info(`[Core] Aktualisiere Navigation für Guild ${guildId} (generell bei Core-Updates)...`);
                try {
                    // Alte Navigation löschen
                    await dbService.query(
                        "DELETE FROM guild_nav_items WHERE plugin = ? AND guildId = ?",
                        ['core', guildId]
                    );
                    
                    // Neue Navigation registrieren
                    await this._registerNavigation(guildId);
                    
                    const [navCount] = await dbService.query(
                        "SELECT COUNT(*) as count FROM guild_nav_items WHERE plugin = ? AND guildId = ?",
                        ['core', guildId]
                    );
                    
                    Logger.success(`[Core] Navigation aktualisiert: ${navCount.count} Einträge (genereller Update-Hook)`);
                } catch (navError) {
                    Logger.error('[Core] Fehler beim Aktualisieren der Navigation:', navError);
                    // Nicht abbrechen, Update ist trotzdem erfolgreich
                }
            }
            
            // ====================================
            // Weitere Versions-Checks hier...
            // ====================================
            
            return {
                success: true,
                message: `Core-Plugin erfolgreich aktualisiert auf ${newVersion}`
            };
            
        } catch (error) {
            Logger.error('[Core] Fehler in onUpdate():', error);
            return {
                success: false,
                error: `Update fehlgeschlagen: ${error.message}`
            };
        }
    }

    /**
     * Registriert guild-spezifische Navigation
     * Wird aufgerufen, wenn das Plugin in einer Guild aktiviert wird
     * @param {string} guildId - Discord Guild ID
     */
    async onGuildEnable(guildId) {
        const Logger = ServiceManager.get('Logger');
        Logger.info(`[Core] Aktiviere Core-Plugin für Guild ${guildId}`);

        try {
            await registerKernNavigation(guildId);
            Logger.info(`[Core] Navigation für Guild ${guildId} registriert`);
        } catch (error) {
            Logger.error(`[Core] Fehler bei Guild-Aktivierung für ${guildId}:`, error);
            throw error;
        }
    }

}
module.exports = CoreDashboardPlugin;