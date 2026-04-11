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
                    // IPC-Calls für Channels und Roles parallel
                    const [channelsResponses, rolesResponses] = await Promise.all([
                        ipcServer.broadcast('dashboard:GET_GUILD_CHANNELS', { guildId }),
                        ipcServer.broadcast('dashboard:GET_GUILD_ROLES', { guildId, includeAll: true })
                    ]);
                    const channelsResp = channelsResponses && channelsResponses.length > 0 ? channelsResponses[0] : null;
                    const rolesResp = rolesResponses && rolesResponses.length > 0 ? rolesResponses[0] : null;
                    const channels = channelsResp?.channels || [];
                    const roles = rolesResp?.roles || [];
                    
                    // Parallel DB-Queries
                    const [settingsRows, protectedRolesRows, logsRows, logsCountRows, channelRulesRows] = await Promise.all([
                        dbService.query(`SELECT * FROM moderation_settings WHERE guild_id = ?`, [guildId]),
                        dbService.query(`SELECT * FROM moderation_protected_roles WHERE guild_id = ? ORDER BY created_at DESC`, [guildId]),
                        dbService.query(`SELECT * FROM moderation_logs WHERE guild_id = ? ORDER BY created_at DESC LIMIT 50`, [guildId]),
                        dbService.query(`SELECT COUNT(*) as total FROM moderation_logs WHERE guild_id = ?`, [guildId]),
                        dbService.query(`SELECT * FROM moderation_channel_rules WHERE guild_id = ? ORDER BY created_at DESC`, [guildId])
                    ]);
                    
                    const moderationSettings = settingsRows[0] || {
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
                        roles,
                        settings: moderationSettings,
                        protectedRoles: protectedRolesRows || [],
                        channelRules: channelRulesRows || [],
                        logs: logsRows || [],
                        logsTotal: logsCountRows[0]?.total || 0,
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
                        default_reason: req.body.default_reason || null,
                        dm_embed_description: req.body.dm_embed_description || null
                    };
                }
                
                const Logger = ServiceManager.get('Logger');
                
                try {
                    // INSERT ON DUPLICATE KEY UPDATE Pattern
                    const result = await dbService.query(`
                        INSERT INTO moderation_settings 
                        (guild_id, modlog_channel, max_warn_limit, max_warn_action, modlog_events, 
                         dm_on_warn, dm_on_kick, dm_on_ban, dm_on_timeout, default_reason, dm_embed_description, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
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
                            dm_embed_description = VALUES(dm_embed_description),
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
                        data.default_reason || null,
                        data.dm_embed_description || null
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
                const { log_channel, maxwarn_count, maxwarn_action, modlog_events, dm_on_warn, dm_on_kick, dm_on_ban, dm_on_timeout, default_reason, dm_embed_description } = req.body;
                const Logger = ServiceManager.get('Logger');
                
                try {
                    const result = await dbService.query(`
                        INSERT INTO moderation_settings 
                        (guild_id, modlog_channel, max_warn_limit, max_warn_action, modlog_events, 
                         dm_on_warn, dm_on_kick, dm_on_ban, dm_on_timeout, default_reason, dm_embed_description, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
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
                            dm_embed_description = VALUES(dm_embed_description),
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
                        default_reason || null,
                        dm_embed_description || null
                    ]);
                    
                    res.json({ success: true });
                } catch (error) {
                    Logger.error('[Moderation] Fehler beim Speichern der Settings:', error);
                    res.status(500).json({ success: false, error: error.message });
                }
            });

            // ==================== PROTECTED ROLES API ====================

            // GET /protected-roles - Liste geschützter Rollen
            this.guildRouter.get('/protected-roles', requirePermission('MODERATION.VIEW'), async (req, res) => {
                const guildId = req.params.guildId || res.locals.guildId;
                try {
                    const rows = await dbService.query(
                        `SELECT * FROM moderation_protected_roles WHERE guild_id = ? ORDER BY created_at DESC`,
                        [guildId]
                    );
                    res.json({ success: true, protectedRoles: rows });
                } catch (error) {
                    Logger.error('[Moderation] Fehler beim Laden der Protected Roles:', error);
                    res.status(500).json({ success: false, error: error.message });
                }
            });

            // POST /protected-roles - Geschützte Rolle hinzufügen
            this.guildRouter.post('/protected-roles', requirePermission('MODERATION.PROTECTED_ROLES_MANAGE'), async (req, res) => {
                const guildId = req.params.guildId || res.locals.guildId;
                const { role_id } = req.body;

                if (!role_id) {
                    return res.status(400).json({ success: false, error: 'role_id ist erforderlich' });
                }

                try {
                    await dbService.query(
                        `INSERT IGNORE INTO moderation_protected_roles (guild_id, role_id) VALUES (?, ?)`,
                        [guildId, role_id]
                    );
                    res.json({ success: true, message: 'Geschützte Rolle hinzugefügt' });
                } catch (error) {
                    Logger.error('[Moderation] Fehler beim Hinzufügen der Protected Role:', error);
                    res.status(500).json({ success: false, error: error.message });
                }
            });

            // DELETE /protected-roles/:roleId - Geschützte Rolle entfernen
            this.guildRouter.delete('/protected-roles/:roleId', requirePermission('MODERATION.PROTECTED_ROLES_MANAGE'), async (req, res) => {
                const guildId = req.params.guildId || res.locals.guildId;
                const roleId = req.params.roleId;

                try {
                    await dbService.query(
                        `DELETE FROM moderation_protected_roles WHERE guild_id = ? AND role_id = ?`,
                        [guildId, roleId]
                    );
                    res.json({ success: true, message: 'Geschützte Rolle entfernt' });
                } catch (error) {
                    Logger.error('[Moderation] Fehler beim Entfernen der Protected Role:', error);
                    res.status(500).json({ success: false, error: error.message });
                }
            });

            // ==================== MODERATION LOGS API ====================

            // GET /logs - Moderation-Logs (mit Pagination)
            this.guildRouter.get('/logs', requirePermission('MODERATION.LOGS_VIEW'), async (req, res) => {
                const guildId = req.params.guildId || res.locals.guildId;
                const page = Math.max(1, parseInt(req.query.page) || 1);
                const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
                const offset = (page - 1) * limit;
                const typeFilter = req.query.type || null;

                try {
                    let whereClause = 'WHERE guild_id = ?';
                    const params = [guildId];

                    if (typeFilter) {
                        whereClause += ' AND type = ?';
                        params.push(typeFilter);
                    }

                    const [logs, countRows] = await Promise.all([
                        dbService.query(
                            `SELECT * FROM moderation_logs ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
                            [...params, limit, offset]
                        ),
                        dbService.query(
                            `SELECT COUNT(*) as total FROM moderation_logs ${whereClause}`,
                            params
                        )
                    ]);

                    const total = countRows[0]?.total || 0;
                    res.json({
                        success: true,
                        logs,
                        pagination: {
                            page,
                            limit,
                            total,
                            totalPages: Math.ceil(total / limit)
                        }
                    });
                } catch (error) {
                    Logger.error('[Moderation] Fehler beim Laden der Logs:', error);
                    res.status(500).json({ success: false, error: error.message });
                }
            });

            // ==================== MOD NOTES API ====================

            // GET /notes/:userId - Notizen für einen User
            this.guildRouter.get('/notes/:userId', requirePermission('MODERATION.NOTES_VIEW'), async (req, res) => {
                const guildId = req.params.guildId || res.locals.guildId;
                const userId = req.params.userId;

                try {
                    const notes = await dbService.query(
                        `SELECT * FROM moderation_notes WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC`,
                        [guildId, userId]
                    );
                    res.json({ success: true, notes });
                } catch (error) {
                    Logger.error('[Moderation] Fehler beim Laden der Notes:', error);
                    res.status(500).json({ success: false, error: error.message });
                }
            });

            // POST /notes - Notiz erstellen
            this.guildRouter.post('/notes', requirePermission('MODERATION.NOTES_MANAGE'), async (req, res) => {
                const guildId = req.params.guildId || res.locals.guildId;
                const { user_id, note } = req.body;
                const authorId = res.locals.user?.id || req.user?.id;

                if (!user_id || !note) {
                    return res.status(400).json({ success: false, error: 'user_id und note sind erforderlich' });
                }

                try {
                    await dbService.query(
                        `INSERT INTO moderation_notes (guild_id, user_id, author_id, note) VALUES (?, ?, ?, ?)`,
                        [guildId, user_id, authorId, note.substring(0, 1000)]
                    );
                    res.json({ success: true, message: 'Notiz erstellt' });
                } catch (error) {
                    Logger.error('[Moderation] Fehler beim Erstellen der Note:', error);
                    res.status(500).json({ success: false, error: error.message });
                }
            });

            // DELETE /notes/:noteId - Notiz löschen
            this.guildRouter.delete('/notes/:noteId', requirePermission('MODERATION.NOTES_MANAGE'), async (req, res) => {
                const guildId = req.params.guildId || res.locals.guildId;
                const noteId = parseInt(req.params.noteId);

                if (isNaN(noteId)) {
                    return res.status(400).json({ success: false, error: 'Ungültige Note-ID' });
                }

                try {
                    await dbService.query(
                        `DELETE FROM moderation_notes WHERE id = ? AND guild_id = ?`,
                        [noteId, guildId]
                    );
                    res.json({ success: true, message: 'Notiz gelöscht' });
                } catch (error) {
                    Logger.error('[Moderation] Fehler beim Löschen der Note:', error);
                    res.status(500).json({ success: false, error: error.message });
                }
            });

            // ==================== CHANNEL RULES API ====================

            // GET /channel-rules - Liste aller Channel-Regeln
            this.guildRouter.get('/channel-rules', requirePermission('MODERATION.VIEW'), async (req, res) => {
                const guildId = req.params.guildId || res.locals.guildId;
                try {
                    const rows = await dbService.query(
                        `SELECT * FROM moderation_channel_rules WHERE guild_id = ? ORDER BY created_at DESC`,
                        [guildId]
                    );
                    res.json({ success: true, channelRules: rows });
                } catch (error) {
                    Logger.error('[Moderation] Fehler beim Laden der Channel-Rules:', error);
                    res.status(500).json({ success: false, error: error.message });
                }
            });

            // POST /channel-rules - Channel-Regel erstellen/aktualisieren
            this.guildRouter.post('/channel-rules', requirePermission('MODERATION.CHANNEL_RULES_MANAGE'), async (req, res) => {
                const guildId = req.params.guildId || res.locals.guildId;
                const { channel_id, max_warn_limit, max_warn_action, automod_exempt, notes } = req.body;

                if (!channel_id) {
                    return res.status(400).json({ success: false, error: 'channel_id ist erforderlich' });
                }

                try {
                    await dbService.query(`
                        INSERT INTO moderation_channel_rules (guild_id, channel_id, max_warn_limit, max_warn_action, automod_exempt, notes)
                        VALUES (?, ?, ?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE
                            max_warn_limit = VALUES(max_warn_limit),
                            max_warn_action = VALUES(max_warn_action),
                            automod_exempt = VALUES(automod_exempt),
                            notes = VALUES(notes),
                            updated_at = NOW()
                    `, [
                        guildId,
                        channel_id,
                        max_warn_limit ? parseInt(max_warn_limit) : null,
                        max_warn_action || null,
                        automod_exempt ? 1 : 0,
                        notes ? notes.substring(0, 500) : null
                    ]);
                    res.json({ success: true, message: 'Channel-Regel gespeichert' });
                } catch (error) {
                    Logger.error('[Moderation] Fehler beim Speichern der Channel-Rule:', error);
                    res.status(500).json({ success: false, error: error.message });
                }
            });

            // DELETE /channel-rules/:ruleId - Channel-Regel löschen
            this.guildRouter.delete('/channel-rules/:ruleId', requirePermission('MODERATION.CHANNEL_RULES_MANAGE'), async (req, res) => {
                const guildId = req.params.guildId || res.locals.guildId;
                const ruleId = parseInt(req.params.ruleId);

                if (isNaN(ruleId)) {
                    return res.status(400).json({ success: false, error: 'Ungültige Rule-ID' });
                }

                try {
                    await dbService.query(
                        `DELETE FROM moderation_channel_rules WHERE id = ? AND guild_id = ?`,
                        [ruleId, guildId]
                    );
                    res.json({ success: true, message: 'Channel-Regel entfernt' });
                } catch (error) {
                    Logger.error('[Moderation] Fehler beim Löschen der Channel-Rule:', error);
                    res.status(500).json({ success: false, error: error.message });
                }
            });

            // GET /notes-all - Alle Notizen der Guild (für Dashboard-Tab)
            this.guildRouter.get('/notes-all', requirePermission('MODERATION.NOTES_VIEW'), async (req, res) => {
                const guildId = req.params.guildId || res.locals.guildId;
                try {
                    const notes = await dbService.query(
                        `SELECT * FROM moderation_notes WHERE guild_id = ? ORDER BY created_at DESC LIMIT 100`,
                        [guildId]
                    );
                    res.json({ success: true, notes });
                } catch (error) {
                    Logger.error('[Moderation] Fehler beim Laden aller Notes:', error);
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
            await dbService.query("DELETE FROM guild_nav_items WHERE plugin = ? AND guildId = ?", [this.name, guildId]);
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
            parent: `/guild/${guildId}`,
            type: 'main',
            visible: true,
            capability: 'MODERATION.VIEW'
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
