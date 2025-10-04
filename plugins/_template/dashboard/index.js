/**
 * Template Plugin für DuneBot - Dashboard-Teil
 * 
 * Dieses Plugin dient als Vorlage für neue Dashboard-Plugins.
 * Alle wichtigen Lifecycle-Methoden und Best Practices sind demonstriert.
 * 
 * @author DuneBot Team
 * @version 1.0.0
 */
const path = require('path');
const express = require('express');
const { DashboardPlugin } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

/**
 * Template-Plugin für den Dashboard-Teil von DuneBot
 * 
 * WICHTIGE LIFECYCLE-METHODEN:
 * - enable(): Wird beim Plugin-Enable aufgerufen
 * - disable(): Wird beim Plugin-Disable aufgerufen
 * - onGuildEnable(guildId): Wird beim Guild-Enable aufgerufen
 * - onGuildDisable(guildId): Wird beim Guild-Disable aufgerufen
 * 
 * @extends {DashboardPlugin}
 * @author DuneBot Team
 */
class TemplateDashboardPlugin extends DashboardPlugin {
    /**
     * Erstellt eine neue Instanz des Template-Dashboard-Plugins
     * 
     * HINWEIS: Passe die Metadaten für dein Plugin an!
     */
    constructor() {
        super({
            name: 'template',                           // Plugin-ID (lowercase)
            displayName: 'Template Plugin',             // Anzeigename
            description: 'Ein Template-Plugin als Vorlage für neue Plugins',
            version: '1.0.0',                           // Semantic Versioning
            author: 'DuneBot Team',                     // Dein Name
            icon: 'fa-solid fa-puzzle-piece',          // Font Awesome Icon
            baseDir: __dirname                          // Basis-Verzeichnis (NICHT ändern!)
        });
        
        const Logger = ServiceManager.get('Logger');
        Logger.debug('Template-Dashboard-Plugin initialisiert');
    }
    
    /**
     * Wird beim Plugin-Enable aufgerufen
     * 
     * Hier solltest du:
     * - Routen registrieren
     * - Widgets registrieren
     * - Middleware registrieren (optional)
     * 
     * @returns {Promise<void>}
     * @author DuneBot Team
     */
    async enable() {
        const Logger = ServiceManager.get('Logger');
        Logger.info('Template-Dashboard-Plugin wird aktiviert...');
        
        try {
            // Routen einrichten
            this._setupRoutes();
            
            // Widgets registrieren
            this._registerWidgets();
            
            Logger.success('Template-Dashboard-Plugin aktiviert');
        } catch (error) {
            Logger.error('Fehler beim Aktivieren des Template-Dashboard-Plugins:', error);
            throw error;
        }
    }

    /**
     * Wird beim Plugin-Disable aufgerufen
     * 
     * @returns {Promise<void>}
     * @author DuneBot Team
     */
    async disable() {
        const Logger = ServiceManager.get('Logger');
        Logger.info('Template-Dashboard-Plugin wird deaktiviert...');
        
        // Cleanup (falls benötigt)
        
        Logger.success('Template-Dashboard-Plugin deaktiviert');
    }

    /**
     * Richtet Express-Routen ein
     * 
     * @private
     */
    _setupRoutes() {
        const Logger = ServiceManager.get('Logger');
        const router = express.Router();
        
        // Hauptseite
        router.get('/', async (req, res) => {
            try {
                const { guildId } = req.params;
                
                // IPC-Call zum Bot für Stats
                const statsResult = await req.ipcClient.send('template:GET_STATS', { guildId });
                
                res.render('template/views/index', {
                    title: 'Template Plugin',
                    stats: statsResult.success ? statsResult.data : null,
                    guild: req.guild
                });
            } catch (error) {
                Logger.error('Fehler beim Laden der Template-Seite:', error);
                res.status(500).render('error', { error });
            }
        });
        
        // Einstellungen-Seite
        router.get('/settings', async (req, res) => {
            try {
                const { guildId } = req.params;
                const dbService = ServiceManager.get('dbService');
                
                // Einstellungen aus DB laden
                const settings = await dbService.query(
                    'SELECT settings FROM template_guilds WHERE guild_id = ?',
                    [guildId]
                );
                
                res.render('template/views/settings', {
                    title: 'Template Einstellungen',
                    settings: settings[0]?.settings || {},
                    guild: req.guild
                });
            } catch (error) {
                Logger.error('Fehler beim Laden der Einstellungen:', error);
                res.status(500).render('error', { error });
            }
        });
        
        // Einstellungen speichern (POST)
        router.post('/settings', async (req, res) => {
            try {
                const { guildId } = req.params;
                const { feature_enabled, max_items, cooldown_seconds } = req.body;
                const dbService = ServiceManager.get('dbService');
                
                const settings = {
                    feature_enabled: feature_enabled === 'on',
                    max_items: parseInt(max_items) || 100,
                    cooldown_seconds: parseInt(cooldown_seconds) || 60
                };
                
                // In Datenbank speichern
                await dbService.query(
                    'UPDATE template_guilds SET settings = ? WHERE guild_id = ?',
                    [JSON.stringify(settings), guildId]
                );
                
                req.flash('success', 'Einstellungen gespeichert!');
                res.redirect(`/guild/${guildId}/template/settings`);
            } catch (error) {
                Logger.error('Fehler beim Speichern der Einstellungen:', error);
                req.flash('error', 'Fehler beim Speichern');
                res.redirect(`/guild/${guildId}/template/settings`);
            }
        });
        
        this.router = router;
        Logger.debug('Template-Plugin Routen registriert');
    }

    /**
     * Registriert Dashboard-Widgets
     * 
     * @private
     */
    _registerWidgets() {
        const Logger = ServiceManager.get('Logger');
        
        this.widgets = [
            {
                id: 'template-stats',
                title: 'Template Stats',
                description: 'Zeigt Template-Plugin Statistiken',
                viewPath: 'template/views/widgets/stats',
                position: 'main',  // main, sidebar, full
                size: 'medium',    // small, medium, large
                order: 100
            },
            {
                id: 'template-recent-activity',
                title: 'Letzte Aktivität',
                description: 'Zeigt die letzten Aktivitäten',
                viewPath: 'template/views/widgets/recentActivity',
                position: 'sidebar',
                size: 'small',
                order: 200
            }
        ];
        
        Logger.debug(`Template-Plugin: ${this.widgets.length} Widgets registriert`);
    }

    /**
     * Wird beim Guild-Enable aufgerufen
     * 
     * Hier solltest du:
     * - Navigation registrieren
     * - Guild-spezifische Daten initialisieren
     * 
     * @param {string} guildId - Guild-ID
     * @returns {Promise<void>}
     * @author DuneBot Team
     */
    async onGuildEnable(guildId) {
        const Logger = ServiceManager.get('Logger');
        Logger.info(`Template-Dashboard-Plugin für Guild ${guildId} aktiviert`);
        
        try {
            const navigationManager = ServiceManager.get('navigationManager');
            
            // Navigation registrieren
            await navigationManager.registerNavigation(guildId, [
                {
                    label: 'Template',
                    href: `/guild/${guildId}/template`,
                    icon: 'fa-solid fa-puzzle-piece',
                    order: 100,
                    children: [
                        {
                            label: 'Übersicht',
                            href: `/guild/${guildId}/template`,
                            icon: 'fa-solid fa-home'
                        },
                        {
                            label: 'Einstellungen',
                            href: `/guild/${guildId}/template/settings`,
                            icon: 'fa-solid fa-cog'
                        }
                    ]
                }
            ], 'template');
            
            // Guild-Eintrag in DB erstellen
            const dbService = ServiceManager.get('dbService');
            await dbService.query(
                'INSERT IGNORE INTO template_guilds (guild_id, settings) VALUES (?, ?)',
                [guildId, JSON.stringify({ feature_enabled: true, max_items: 100 })]
            );
            
            Logger.success(`Template-Navigation für Guild ${guildId} registriert`);
        } catch (error) {
            Logger.error(`Fehler beim Guild-Enable für ${guildId}:`, error);
            throw error;
        }
    }

    /**
     * Wird beim Guild-Disable aufgerufen
     * 
     * @param {string} guildId - Guild-ID
     * @returns {Promise<void>}
     * @author DuneBot Team
     */
    async onGuildDisable(guildId) {
        const Logger = ServiceManager.get('Logger');
        Logger.info(`Template-Dashboard-Plugin für Guild ${guildId} deaktiviert`);
        
        try {
            // Navigation entfernen geschieht automatisch
            
            // Optional: Guild als inaktiv markieren
            const dbService = ServiceManager.get('dbService');
            await dbService.query(
                'UPDATE template_guilds SET active = 0, disabled_at = NOW() WHERE guild_id = ?',
                [guildId]
            );
            
            Logger.success(`Template-Plugin für Guild ${guildId} deaktiviert`);
        } catch (error) {
            Logger.error(`Fehler beim Guild-Disable für ${guildId}:`, error);
        }
    }
}

module.exports = new TemplateDashboardPlugin();
