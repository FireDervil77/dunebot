const { DashboardPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../apps/dashboard/middlewares/permissions.middleware');

class GiveawayDashboardPlugin extends DashboardPlugin {
    constructor() {
        super({
            name: 'giveaway',
            displayName: 'Giveaway',
            description: 'Giveaway-System für Discord',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
            icon: 'fa-solid fa-gift',
            baseDir: __dirname,
            ownerOnly: false,
            publicAssets: true,
        });

        this.guildRouter = require('express').Router({ mergeParams: true });
    }

    async onEnable(app, dbService) {
        const Logger = ServiceManager.get('Logger');
        Logger.info('Aktiviere [Giveaway] Dashboard-Plugin...');

        this.app = app;
        this._setupRoutes();

        Logger.success('[Giveaway] Dashboard-Plugin aktiviert');
        return true;
    }

    _setupRoutes() {
        const Logger = ServiceManager.get('Logger');
        const themeManager = ServiceManager.get('themeManager');
        const ipcServer = ServiceManager.get('ipcServer');
        const dbService = ServiceManager.get('dbService');

        // ════════════════════════════════════════════
        // GET / - Giveaway Overview (List + Create)
        // ════════════════════════════════════════════
        this.guildRouter.get('/', requirePermission('GIVEAWAY.VIEW'), async (req, res) => {
            const guildId = req.params.guildId || res.locals.guildId;

            try {
                const [channelsResponses, rolesResponses] = await Promise.all([
                    ipcServer.broadcast('dashboard:GET_GUILD_CHANNELS', { guildId }),
                    ipcServer.broadcast('dashboard:GET_GUILD_ROLES', { guildId, includeAll: true }),
                ]);
                const channels = channelsResponses?.[0]?.channels || [];
                const roles = rolesResponses?.[0]?.roles || [];

                const [active, recent, scheduled, templates, blacklist] = await Promise.all([
                    dbService.query(
                        'SELECT * FROM giveaways WHERE guild_id = ? AND status IN (?, ?) ORDER BY created_at DESC',
                        [guildId, 'active', 'paused']
                    ),
                    dbService.query(
                        'SELECT * FROM giveaways WHERE guild_id = ? AND status = ? ORDER BY ended_at DESC LIMIT 20',
                        [guildId, 'ended']
                    ),
                    dbService.query(
                        'SELECT * FROM giveaways WHERE guild_id = ? AND starts_at > NOW() AND status = ? ORDER BY starts_at ASC',
                        [guildId, 'active']
                    ),
                    dbService.query(
                        'SELECT * FROM giveaway_templates WHERE guild_id = ? ORDER BY name ASC',
                        [guildId]
                    ),
                    dbService.query(
                        'SELECT * FROM giveaway_blacklist WHERE guild_id = ? ORDER BY created_at DESC',
                        [guildId]
                    ),
                ]);

                // Get entry counts for active giveaways
                for (const g of active) {
                    const [countRow] = await dbService.query(
                        'SELECT COUNT(*) as cnt FROM giveaway_entries WHERE giveaway_id = ?',
                        [g.id]
                    );
                    g.entry_count = countRow?.cnt || 0;
                }

                for (const g of recent) {
                    const winners = await dbService.query(
                        'SELECT user_id, claim_status FROM giveaway_winners WHERE giveaway_id = ?',
                        [g.id]
                    );
                    g.winners = winners.map(w => w.user_id);
                    g.winner_details = winners;
                }

                // Parse template configs
                for (const t of templates) {
                    t.config = typeof t.config === 'string' ? JSON.parse(t.config) : t.config;
                }

                // Analytics
                let analytics = null;
                try {
                    const analyticsResponses = await ipcServer.broadcast('giveaway:getAnalytics', { guildId });
                    analytics = analyticsResponses?.[0]?.analytics || null;
                } catch (e) { /* ignore */ }

                await themeManager.renderView(res, 'guild/giveaway', {
                    title: 'Giveaway Manager',
                    activeMenu: `/guild/${guildId}/plugins/giveaway`,
                    guildId,
                    channels,
                    roles,
                    active,
                    recent,
                    scheduled,
                    templates,
                    blacklist,
                    analytics,
                    plugin: this,
                });
            } catch (error) {
                Logger.error('[Giveaway] Fehler beim Laden:', error);
                res.status(500).json({ error: 'Internal Server Error' });
            }
        });

        // ════════════════════════════════════════════
        // POST /create - Create Giveaway via IPC
        // ════════════════════════════════════════════
        this.guildRouter.post('/create', requirePermission('GIVEAWAY.CREATE'), async (req, res) => {
            const guildId = req.params.guildId || res.locals.guildId;
            const { channel_id, prize, duration, winner_count, host_id, allowed_roles, scheduled_start, claim_duration, requirements } = req.body;

            if (!channel_id || !prize || !duration) {
                return res.status(400).json({ error: 'channel_id, prize and duration are required' });
            }

            try {
                const responses = await ipcServer.broadcast('giveaway:createGiveaway', {
                    guildId,
                    channelId: channel_id,
                    prize: String(prize).substring(0, 256),
                    duration: parseInt(duration),
                    winnerCount: parseInt(winner_count) || 1,
                    createdBy: req.user?.id || null,
                    hostedBy: host_id || req.user?.id || null,
                    allowedRoles: Array.isArray(allowed_roles) ? allowed_roles : null,
                    scheduledStart: scheduled_start || null,
                    claimDurationMs: claim_duration ? parseInt(claim_duration) : null,
                    requirements: Array.isArray(requirements) ? requirements : [],
                });

                const result = responses?.[0];
                if (result?.success) {
                    return res.json({ success: true });
                }
                return res.status(500).json({ error: result?.error || 'Failed to create giveaway' });
            } catch (error) {
                Logger.error('[Giveaway] Create Fehler:', error);
                res.status(500).json({ error: 'Internal Server Error' });
            }
        });

        // ════════════════════════════════════════════
        // POST /:id/end - End Giveaway
        // ════════════════════════════════════════════
        this.guildRouter.post('/:id/end', requirePermission('GIVEAWAY.MANAGE'), async (req, res) => {
            const giveawayId = parseInt(req.params.id, 10);

            try {
                const responses = await ipcServer.broadcast('giveaway:endGiveaway', { giveawayId });
                const result = responses?.[0];
                if (result?.success) return res.json({ success: true });
                return res.status(500).json({ error: result?.error || 'Failed to end giveaway' });
            } catch (error) {
                Logger.error('[Giveaway] End Fehler:', error);
                res.status(500).json({ error: 'Internal Server Error' });
            }
        });

        // ════════════════════════════════════════════
        // POST /:id/pause - Pause Giveaway
        // ════════════════════════════════════════════
        this.guildRouter.post('/:id/pause', requirePermission('GIVEAWAY.MANAGE'), async (req, res) => {
            const giveawayId = parseInt(req.params.id, 10);

            try {
                const responses = await ipcServer.broadcast('giveaway:pauseGiveaway', { giveawayId });
                const result = responses?.[0];
                if (result?.success) return res.json({ success: true });
                return res.status(500).json({ error: result?.error || 'Failed to pause giveaway' });
            } catch (error) {
                Logger.error('[Giveaway] Pause Fehler:', error);
                res.status(500).json({ error: 'Internal Server Error' });
            }
        });

        // ════════════════════════════════════════════
        // POST /:id/resume - Resume Giveaway
        // ════════════════════════════════════════════
        this.guildRouter.post('/:id/resume', requirePermission('GIVEAWAY.MANAGE'), async (req, res) => {
            const giveawayId = parseInt(req.params.id, 10);

            try {
                const responses = await ipcServer.broadcast('giveaway:resumeGiveaway', { giveawayId });
                const result = responses?.[0];
                if (result?.success) return res.json({ success: true });
                return res.status(500).json({ error: result?.error || 'Failed to resume giveaway' });
            } catch (error) {
                Logger.error('[Giveaway] Resume Fehler:', error);
                res.status(500).json({ error: 'Internal Server Error' });
            }
        });

        // ════════════════════════════════════════════
        // POST /:id/reroll - Reroll Winner
        // ════════════════════════════════════════════
        this.guildRouter.post('/:id/reroll', requirePermission('GIVEAWAY.MANAGE'), async (req, res) => {
            const giveawayId = parseInt(req.params.id, 10);

            try {
                const responses = await ipcServer.broadcast('giveaway:rerollGiveaway', { giveawayId });
                const result = responses?.[0];
                if (result?.success) return res.json({ success: true });
                return res.status(500).json({ error: result?.error || 'Failed to reroll' });
            } catch (error) {
                Logger.error('[Giveaway] Reroll Fehler:', error);
                res.status(500).json({ error: 'Internal Server Error' });
            }
        });

        // ════════════════════════════════════════════
        // DELETE /:id - Delete Giveaway
        // ════════════════════════════════════════════
        this.guildRouter.delete('/:id', requirePermission('GIVEAWAY.DELETE'), async (req, res) => {
            const giveawayId = parseInt(req.params.id, 10);

            try {
                const responses = await ipcServer.broadcast('giveaway:deleteGiveaway', { giveawayId });
                const result = responses?.[0];
                if (result?.success) return res.json({ success: true });
                return res.status(500).json({ error: result?.error || 'Failed to delete giveaway' });
            } catch (error) {
                Logger.error('[Giveaway] Delete Fehler:', error);
                res.status(500).json({ error: 'Internal Server Error' });
            }
        });

        // ════════════════════════════════════════════
        // TEMPLATE ROUTES
        // ════════════════════════════════════════════
        this.guildRouter.post('/templates', requirePermission('GIVEAWAY.MANAGE'), async (req, res) => {
            const guildId = req.params.guildId || res.locals.guildId;
            const { name, config } = req.body;

            if (!name || !config) {
                return res.status(400).json({ error: 'name and config are required' });
            }

            try {
                const responses = await ipcServer.broadcast('giveaway:templateAction', {
                    action: 'create',
                    guildId,
                    name: String(name).substring(0, 100),
                    config,
                    createdBy: req.user?.id || null,
                });
                const result = responses?.[0];
                if (result?.success) return res.json({ success: true, template: result.template });
                return res.status(500).json({ error: result?.error || 'Failed to create template' });
            } catch (error) {
                Logger.error('[Giveaway] Template Create Fehler:', error);
                res.status(500).json({ error: 'Internal Server Error' });
            }
        });

        this.guildRouter.delete('/templates/:templateId', requirePermission('GIVEAWAY.MANAGE'), async (req, res) => {
            const guildId = req.params.guildId || res.locals.guildId;
            const templateId = parseInt(req.params.templateId, 10);

            try {
                const responses = await ipcServer.broadcast('giveaway:templateAction', {
                    action: 'delete',
                    guildId,
                    templateId,
                });
                const result = responses?.[0];
                if (result?.success) return res.json({ success: true });
                return res.status(500).json({ error: result?.error || 'Failed to delete template' });
            } catch (error) {
                Logger.error('[Giveaway] Template Delete Fehler:', error);
                res.status(500).json({ error: 'Internal Server Error' });
            }
        });

        // ════════════════════════════════════════════
        // BLACKLIST ROUTES
        // ════════════════════════════════════════════
        this.guildRouter.post('/blacklist', requirePermission('GIVEAWAY.MANAGE'), async (req, res) => {
            const guildId = req.params.guildId || res.locals.guildId;
            const { user_id, reason } = req.body;

            if (!user_id) {
                return res.status(400).json({ error: 'user_id is required' });
            }

            try {
                const responses = await ipcServer.broadcast('giveaway:blacklistAction', {
                    action: 'add',
                    guildId,
                    userId: user_id,
                    reason: reason ? String(reason).substring(0, 256) : null,
                    addedBy: req.user?.id || null,
                });
                const result = responses?.[0];
                if (result?.success) return res.json({ success: true });
                return res.status(500).json({ error: result?.error || 'Failed to add to blacklist' });
            } catch (error) {
                Logger.error('[Giveaway] Blacklist Add Fehler:', error);
                res.status(500).json({ error: 'Internal Server Error' });
            }
        });

        this.guildRouter.delete('/blacklist/:userId', requirePermission('GIVEAWAY.MANAGE'), async (req, res) => {
            const guildId = req.params.guildId || res.locals.guildId;
            const userId = req.params.userId;

            try {
                const responses = await ipcServer.broadcast('giveaway:blacklistAction', {
                    action: 'remove',
                    guildId,
                    userId,
                });
                const result = responses?.[0];
                if (result?.success) return res.json({ success: true });
                return res.status(500).json({ error: result?.error || 'Failed to remove from blacklist' });
            } catch (error) {
                Logger.error('[Giveaway] Blacklist Remove Fehler:', error);
                res.status(500).json({ error: 'Internal Server Error' });
            }
        });

        Logger.info('Routen Registriert für [Giveaway] Plugin!');
    }

    async onDisable() {
        const Logger = ServiceManager.get('Logger');
        Logger.info('Deaktiviere [Giveaway] Plugin...');
        return true;
    }

    async onGuildEnable(guildId) {
        const Logger = ServiceManager.get('Logger');
        Logger.debug(`Registriere Navigation für [Giveaway] in Guild ${guildId}`);
        await this._registerNavigation(guildId);
    }

    async onGuildDisable(guildId) {
        const Logger = ServiceManager.get('Logger');
        const navigationManager = ServiceManager.get('navigationManager');
        const dbService = ServiceManager.get('dbService');

        try {
            Logger.info(`Deaktiviere [Giveaway] Plugin für Guild ${guildId}...`);
            await navigationManager.removeNavigation(this.name, guildId);

            // CASCADE-fähige Tabellen: giveaways löschen kaskadiert entries, winners, requirements
            const tables = [
                { sql: 'DELETE FROM giveaway_requirements WHERE giveaway_id IN (SELECT id FROM giveaways WHERE guild_id = ?)', params: [guildId] },
                { sql: 'DELETE FROM giveaway_winners WHERE giveaway_id IN (SELECT id FROM giveaways WHERE guild_id = ?)', params: [guildId] },
                { sql: 'DELETE FROM giveaway_entries WHERE giveaway_id IN (SELECT id FROM giveaways WHERE guild_id = ?)', params: [guildId] },
                { sql: 'DELETE FROM giveaways WHERE guild_id = ?', params: [guildId] },
                { sql: 'DELETE FROM giveaway_templates WHERE guild_id = ?', params: [guildId] },
                { sql: 'DELETE FROM giveaway_blacklist WHERE guild_id = ?', params: [guildId] },
            ];

            for (const { sql, params } of tables) {
                try {
                    await dbService.query(sql, params);
                } catch (e) {
                    if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
                }
            }

            Logger.success(`[Giveaway] Daten für Guild ${guildId} entfernt`);
            return true;
        } catch (error) {
            Logger.error(`[Giveaway] Fehler beim Deaktivieren für Guild ${guildId}:`, error);
            throw error;
        }
    }

    async _registerNavigation(guildId) {
        const Logger = ServiceManager.get('Logger');
        const navigationManager = ServiceManager.get('navigationManager');

        const navItems = [
            {
                title: 'giveaway:TITLE',
                path: `/guild/${guildId}/plugins/giveaway`,
                icon: 'fa-solid fa-gift',
                order: null,
                parent: `/guild/${guildId}`,
                type: 'main',
                visible: true,
                capability: 'GIVEAWAY.VIEW',
            },
        ];

        try {
            await navigationManager.registerNavigation(this.name, guildId, navItems);
            Logger.debug('[Giveaway] Navigation registriert');
        } catch (error) {
            Logger.error('[Giveaway] Fehler beim Registrieren der Navigation:', error);
        }
    }
}

module.exports = GiveawayDashboardPlugin;
