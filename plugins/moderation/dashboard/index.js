const { DashboardPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');
const path = require('path');
const { requirePermission } = require('../../../apps/dashboard/middlewares/permissions.middleware');

class ModerationPlugin extends DashboardPlugin {
    constructor(app) {
        super({
            name: 'moderation',
            displayName: 'Moderation Plugin',
            description: 'Das Moderation Plugin für FireBot',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
            icon: 'fa-solid fa-shield-halved',
            baseDir: __dirname,
            ownerOnly: false,
            publicAssets: true
        });
        
    this.app = app;
    // mergeParams stellt sicher, dass :guildId und :pluginName aus dem Parent-Router verfügbar sind
    this.guildRouter = require('express').Router({ mergeParams: true });
    }

    async onEnable(app, dbService) {
        const Logger = ServiceManager.get('Logger');
        Logger.info('Aktiviere Moderation Dashboard-Plugin...');

        this._setupRoutes();
        this._registerHooks();
        this._registerWidgets();
        this._registerShortcodes();
        this._registerAssets();
        
        Logger.success('Moderation Dashboard-Plugin aktiviert');
        return true;
    }

    _registerAssets() {
        const Logger = ServiceManager.get('Logger');
        Logger.debug('[Moderation] Assets registriert');
    }

    _setupRoutes() {
        const Logger = ServiceManager.get('Logger');
        const themeManager = ServiceManager.get('themeManager');
        const dbService = ServiceManager.get('dbService');
        const ipcServer = ServiceManager.get('ipcServer');

        try {
            // GET / - View Moderation Settings
            this.guildRouter.get('/', requirePermission('MODERATION.VIEW'), async (req, res) => {
                const guildId = req.params.guildId || res.locals.guildId;
                
                try {
                    const channelsResponses = await ipcServer.broadcast('dashboard:GET_GUILD_CHANNELS', { guildId });
                    const channelsResp = channelsResponses && channelsResponses.length > 0 ? channelsResponses[0] : null;
                    const channels = channelsResp?.channels || [];
                    
                    const [settings] = await dbService.query(`SELECT * FROM moderation_settings WHERE guild_id = ?`, [guildId]);
                    
                    const moderationSettings = settings || {
                        modlog_channel: null,
                        max_warn_limit: 5,
                        max_warn_action: 'KICK',
                        modlog_events: '["WARN","KICK","BAN","TIMEOUT","UNTIMEOUT","SOFTBAN","UNBAN"]',
                        dm_on_warn: 1,
                        dm_on_kick: 1,
                        dm_on_ban: 1,
                        dm_on_timeout: 1,
                        default_reason: null
                    };
                    
                    await themeManager.renderView(res, 'guild/moderation', {
                        title: 'Moderation Settings',
                        activeMenu: `/guild/${guildId}/plugins/moderation`,
                        guildId,
                        channels,
                        settings: moderationSettings,
                        plugin: this
                    });
                } catch (error) {
                    Logger.error('[Moderation] Fehler beim Laden der Settings:', error);
                    res.status(500).send('Fehler beim Laden der Moderation Settings');
                }
            });

            // POST /save - Save Moderation Settings (Alternative zu PUT)
            this.guildRouter.post('/save', requirePermission('MODERATION.SETTINGS.EDIT'), async (req, res) => {
                const guildId = req.params.guildId || res.locals.guildId;
                
                // Unterstütze beide Content-Types: JSON und Form-Data
                let data;
                if (req.is('application/json')) {
                    data = req.body;
                } else {
                    // Form-Data: Konvertiere zu passendem Format
                    // modlog_events kann als Array oder als einzelner Wert kommen
                    let modlogEvents = [];
                    if (req.body.modlog_events) {
                        // Kommt als Array direkt (von guild.js oder modernen Browsern)
                        modlogEvents = Array.isArray(req.body.modlog_events) 
                            ? req.body.modlog_events 
                            : [req.body.modlog_events];
                    } else if (req.body['modlog_events[]']) {
                        // Kommt mit [] im Namen (klassische Form-Submission)
                        modlogEvents = Array.isArray(req.body['modlog_events[]']) 
                            ? req.body['modlog_events[]'] 
                            : [req.body['modlog_events[]']];
                    }
                    
                    data = {
                        log_channel: req.body.log_channel || null,
                        maxwarn_count: req.body.maxwarn_count || 5,
                        maxwarn_action: req.body.maxwarn_action || 'KICK',
                        modlog_events: modlogEvents,
                        dm_on_warn: req.body.dm_on_warn === '1' || req.body.dm_on_warn === 'on',
                        dm_on_kick: req.body.dm_on_kick === '1' || req.body.dm_on_kick === 'on',
                        dm_on_ban: req.body.dm_on_ban === '1' || req.body.dm_on_ban === 'on',
                        dm_on_timeout: req.body.dm_on_timeout === '1' || req.body.dm_on_timeout === 'on',
                        default_reason: req.body.default_reason || null
                    };
                }
                
                const Logger = ServiceManager.get('Logger');
                
                try {
                    // INSERT ON DUPLICATE KEY UPDATE Pattern
                    const result = await dbService.query(`
                        INSERT INTO moderation_settings 
                        (guild_id, modlog_channel, max_warn_limit, max_warn_action, modlog_events, 
                         dm_on_warn, dm_on_kick, dm_on_ban, dm_on_timeout, default_reason, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
                        ON DUPLICATE KEY UPDATE
                            modlog_channel = VALUES(modlog_channel),
                            max_warn_limit = VALUES(max_warn_limit),
                            max_warn_action = VALUES(max_warn_action),
                            modlog_events = VALUES(modlog_events),
                            dm_on_warn = VALUES(dm_on_warn),
                            dm_on_kick = VALUES(dm_on_kick),
                            dm_on_ban = VALUES(dm_on_ban),
                            dm_on_timeout = VALUES(dm_on_timeout),
                            default_reason = VALUES(default_reason),
                            updated_at = NOW()
                    `, [
                        guildId,
                        data.log_channel || null,
                        parseInt(data.maxwarn_count) || 5,
                        data.maxwarn_action || 'KICK',
                        JSON.stringify(data.modlog_events || []),
                        data.dm_on_warn ? 1 : 0,
                        data.dm_on_kick ? 1 : 0,
                        data.dm_on_ban ? 1 : 0,
                        data.dm_on_timeout ? 1 : 0,
                        data.default_reason || null
                    ]);
                    
                    res.json({ success: true, message: 'Moderation-Einstellungen erfolgreich gespeichert' });
                } catch (error) {
                    Logger.error('[Moderation] Fehler beim Speichern der Settings:', error);
                    res.status(500).json({ success: false, error: error.message });
                }
            });

            // PUT / - Save Moderation Settings (Legacy)
            this.guildRouter.put('/', requirePermission('MODERATION.SETTINGS.EDIT'), async (req, res) => {
                const guildId = req.params.guildId || res.locals.guildId;
                const { log_channel, maxwarn_count, maxwarn_action, modlog_events, dm_on_warn, dm_on_kick, dm_on_ban, dm_on_timeout, default_reason } = req.body;
                const Logger = ServiceManager.get('Logger');
                
                try {
                    const result = await dbService.query(`
                        INSERT INTO moderation_settings 
                        (guild_id, modlog_channel, max_warn_limit, max_warn_action, modlog_events, 
                         dm_on_warn, dm_on_kick, dm_on_ban, dm_on_timeout, default_reason, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
                        ON DUPLICATE KEY UPDATE
                            modlog_channel = VALUES(modlog_channel),
                            max_warn_limit = VALUES(max_warn_limit),
                            max_warn_action = VALUES(max_warn_action),
                            modlog_events = VALUES(modlog_events),
                            dm_on_warn = VALUES(dm_on_warn),
                            dm_on_kick = VALUES(dm_on_kick),
                            dm_on_ban = VALUES(dm_on_ban),
                            dm_on_timeout = VALUES(dm_on_timeout),
                            default_reason = VALUES(default_reason),
                            updated_at = NOW()
                    `, [
                        guildId,
                        log_channel || null,
                        parseInt(maxwarn_count) || 5,
                        maxwarn_action || 'KICK',
                        JSON.stringify(modlog_events || []),
                        dm_on_warn ? 1 : 0,
                        dm_on_kick ? 1 : 0,
                        dm_on_ban ? 1 : 0,
                        dm_on_timeout ? 1 : 0,
                        default_reason || null
                    ]);
                    
                    res.json({ success: true });
                } catch (error) {
                    Logger.error('[Moderation] Fehler beim Speichern der Settings:', error);
                    res.status(500).json({ success: false, error: error.message });
                }
            });
            
            Logger.info('[Moderation] Routen eingerichtet für guildRouter');
        } catch (error) {
            Logger.error('Fehler beim Einrichten der [Moderation] Plugin Routen:', error);
            throw error;
        }
    }

    async onDisable() {
        const Logger = ServiceManager.get('Logger');
        Logger.info('Deaktiviere [Moderation] Plugin...');
        Logger.success('[Moderation] Plugin deaktiviert');
        return true;
    }
    
    async onGuildEnable(guildId) {
        const Logger = ServiceManager.get('Logger');
        Logger.debug(`Registriere Navigation für [Moderation] in Guild ${guildId}`);
        await this._registerNavigation(guildId);
    }

    async onGuildDisable(guildId) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        
        try {
            Logger.info(`Entferne Navigation für [Moderation] aus Guild ${guildId}`);
            await dbService.query("DELETE FROM nav_items WHERE plugin = ? AND guildId = ?", [this.name, guildId]);
            Logger.success(`[Moderation] Navigation für Guild ${guildId} entfernt`);
            return true;
        } catch (error) {
            Logger.error(`Fehler beim Entfernen der [Moderation] Navigation für Guild ${guildId}:`, error);
            throw error;
        }
    }

    async _registerNavigation(guildId) {
        const Logger = ServiceManager.get('Logger');
        const navigationManager = ServiceManager.get('navigationManager');

        const navItems = [{
            title: 'moderation:NAV.MODERATION',
            path: `/guild/${guildId}/plugins/moderation`,
            icon: 'fa-solid fa-shield-halved',
            order: null,
            parent: `/guild/${guildId}/plugins/core/settings`,
            type: 'main',
            visible: true
        }];

        try {
            await navigationManager.registerNavigation(this.name, guildId, navItems);
            Logger.debug('[Moderation] Navigation registriert');
        } catch (error) {
            Logger.error('[Moderation] Fehler beim Registrieren der Navigation:', error);
        }
    }

    _registerHooks() {
        const Logger = ServiceManager.get('Logger');
        Logger.debug('[Moderation] Hooks registriert');
    }

    _registerWidgets() {
        const Logger = ServiceManager.get('Logger');
        Logger.debug('[Moderation] Widgets registriert');
    }

    _registerShortcodes() {
        const Logger = ServiceManager.get('Logger');
        Logger.debug('[Moderation] Shortcodes registriert');
    }
}

module.exports = ModerationPlugin;
