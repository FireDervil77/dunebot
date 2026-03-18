const { DashboardPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');
const path = require('path');
const { requirePermission } = require('../../../apps/dashboard/middlewares/permissions.middleware');

class TicketPlugin extends DashboardPlugin {
    constructor(app) {
        super({
            name: 'ticket',
            displayName: 'Ticket Plugin',
            description: 'Das Ticket Plugin für FireBot',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
            icon: 'fa-solid fa-ticket',
            baseDir: __dirname,
            ownerOnly: false,
            publicAssets: true
        });
        
        this.app = app;
        this.guildRouter = require('express').Router({ mergeParams: true });
    }

    async onEnable(app, dbService) {
        const Logger = ServiceManager.get('Logger');
        Logger.info('Aktiviere [Ticket] Dashboard-Plugin...');

        this._setupRoutes();
        this._registerHooks();
        this._registerWidgets();
        this._registerShortcodes();
        this._registerAssets();
        
        Logger.success('[Ticket] Dashboard-Plugin aktiviert');
        return true;
    }

    _registerAssets() {
        const Logger = ServiceManager.get('Logger');
        Logger.debug('[Ticket] Assets registriert');
    }

    _setupRoutes() {
        const Logger = ServiceManager.get('Logger');
        const themeManager = ServiceManager.get('themeManager');
        const ipcServer = ServiceManager.get('ipcServer');
        const { TicketSettings, TicketCategories, Tickets } = require('../shared/models');

        Logger.info('Registriere Routen für [Ticket] Plugin ...');

        // ============================================================
        // GET / - Hauptseite mit Tabs (Settings, Kategorien, Tickets)
        // ============================================================
        this.guildRouter.get('/', requirePermission('TICKET.VIEW'), async (req, res) => {
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
                const [settings, categories, tickets, openCount, closedCount] = await Promise.all([
                    TicketSettings.getSettings(guildId),
                    TicketCategories.getAll(guildId),
                    Tickets.getAll(guildId, { limit: 50 }),
                    Tickets.getCount(guildId, 'open'),
                    Tickets.getCount(guildId, 'closed')
                ]);

                await themeManager.renderView(res, 'guild/ticket-settings', {
                    title: 'Ticket Settings',
                    activeMenu: `/guild/${guildId}/plugins/ticket`,
                    guildId,
                    channels,
                    roles,
                    settings,
                    categories,
                    tickets,
                    stats: {
                        open: openCount,
                        closed: closedCount,
                        total: openCount + closedCount
                    },
                    plugin: this
                });
            } catch (error) {
                Logger.error('[Ticket] Fehler beim Laden der Settings:', error);
                res.status(500).json({ error: 'Internal Server Error' });
            }
        });

        // ============================================================
        // PUT /settings - Einstellungen speichern
        // ============================================================
        this.guildRouter.put('/settings', requirePermission('TICKET.SETTINGS_EDIT'), async (req, res) => {
            const guildId = req.params.guildId || res.locals.guildId;
            const { log_channel, ticket_limit, embed_color_create, embed_color_close } = req.body;

            try {
                const updates = {};
                if (log_channel !== undefined) updates.log_channel = log_channel || null;
                if (ticket_limit !== undefined) updates.ticket_limit = parseInt(ticket_limit, 10) || 50;
                if (embed_color_create !== undefined) updates.embed_color_create = embed_color_create || '#068ADD';
                if (embed_color_close !== undefined) updates.embed_color_close = embed_color_close || '#068ADD';

                await TicketSettings.updateSettings(guildId, updates);
                res.json({ success: true });
            } catch (error) {
                Logger.error('[Ticket] Fehler beim Speichern der Settings:', error);
                res.status(500).json({ error: 'Internal Server Error' });
            }
        });

        // ============================================================
        // CATEGORIES CRUD
        // ============================================================

        // GET /categories
        this.guildRouter.get('/categories', requirePermission('TICKET.CATEGORIES_MANAGE'), async (req, res) => {
            const guildId = req.params.guildId || res.locals.guildId;
            try {
                const categories = await TicketCategories.getAll(guildId);
                res.json({ success: true, categories });
            } catch (error) {
                Logger.error('[Ticket] Fehler beim Laden der Kategorien:', error);
                res.status(500).json({ error: 'Internal Server Error' });
            }
        });

        // POST /categories
        this.guildRouter.post('/categories', requirePermission('TICKET.CATEGORIES_MANAGE'), async (req, res) => {
            const guildId = req.params.guildId || res.locals.guildId;
            const { name, description, parent_id, channel_style, staff_roles, member_roles,
                    open_msg_title, open_msg_description, open_msg_footer,
                    button_label, button_emoji, button_color, max_open_per_user, form_fields } = req.body;

            if (!name || typeof name !== 'string' || name.trim().length === 0) {
                return res.status(400).json({ error: 'Name ist erforderlich' });
            }

            try {
                const existing = await TicketCategories.getByName(guildId, name.trim());
                if (existing) {
                    return res.status(409).json({ error: 'Kategorie mit diesem Namen existiert bereits' });
                }

                const id = await TicketCategories.create(guildId, {
                    name: name.trim(),
                    description: description || null,
                    parent_id: parent_id || null,
                    channel_style: channel_style || 'NUMBER',
                    staff_roles: Array.isArray(staff_roles) ? staff_roles : [],
                    member_roles: Array.isArray(member_roles) ? member_roles : [],
                    open_msg_title: open_msg_title || null,
                    open_msg_description: open_msg_description || null,
                    open_msg_footer: open_msg_footer || null,
                    button_label: button_label || 'Ticket erstellen',
                    button_emoji: button_emoji || '🎫',
                    button_color: button_color || 'PRIMARY',
                    max_open_per_user: parseInt(max_open_per_user, 10) || 1,
                    form_fields: Array.isArray(form_fields) ? form_fields : null
                });

                res.json({ success: true, id });
            } catch (error) {
                Logger.error('[Ticket] Fehler beim Erstellen der Kategorie:', error);
                res.status(500).json({ error: 'Internal Server Error' });
            }
        });

        // PUT /categories/:id
        this.guildRouter.put('/categories/:id', requirePermission('TICKET.CATEGORIES_MANAGE'), async (req, res) => {
            const guildId = req.params.guildId || res.locals.guildId;
            const categoryId = parseInt(req.params.id, 10);
            const updates = {};

            const allowedFields = ['name', 'description', 'parent_id', 'channel_style',
                'staff_roles', 'member_roles', 'open_msg_title', 'open_msg_description',
                'open_msg_footer', 'button_label', 'button_emoji', 'button_color',
                'max_open_per_user', 'is_active', 'form_fields'];

            for (const field of allowedFields) {
                if (req.body[field] !== undefined) {
                    if (field === 'max_open_per_user') {
                        updates[field] = parseInt(req.body[field], 10) || 1;
                    } else if (field === 'is_active') {
                        updates[field] = req.body[field] ? 1 : 0;
                    } else if (field === 'staff_roles' || field === 'member_roles') {
                        updates[field] = Array.isArray(req.body[field]) ? req.body[field] : [];
                    } else if (field === 'form_fields') {
                        updates[field] = Array.isArray(req.body[field]) ? req.body[field] : null;
                    } else {
                        updates[field] = req.body[field] || null;
                    }
                }
            }

            try {
                const success = await TicketCategories.update(categoryId, guildId, updates);
                if (!success) return res.status(404).json({ error: 'Kategorie nicht gefunden' });
                res.json({ success: true });
            } catch (error) {
                Logger.error('[Ticket] Fehler beim Aktualisieren der Kategorie:', error);
                res.status(500).json({ error: 'Internal Server Error' });
            }
        });

        // DELETE /categories/:id
        this.guildRouter.delete('/categories/:id', requirePermission('TICKET.CATEGORIES_MANAGE'), async (req, res) => {
            const guildId = req.params.guildId || res.locals.guildId;
            const categoryId = parseInt(req.params.id, 10);

            try {
                const success = await TicketCategories.delete(categoryId, guildId);
                if (!success) return res.status(404).json({ error: 'Kategorie nicht gefunden' });
                res.json({ success: true });
            } catch (error) {
                Logger.error('[Ticket] Fehler beim Löschen der Kategorie:', error);
                res.status(500).json({ error: 'Internal Server Error' });
            }
        });

        // ============================================================
        // TICKETS API
        // ============================================================

        // GET /tickets
        this.guildRouter.get('/tickets', requirePermission('TICKET.TICKETS_VIEW'), async (req, res) => {
            const guildId = req.params.guildId || res.locals.guildId;
            const status = req.query.status || null;
            const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
            const offset = parseInt(req.query.offset, 10) || 0;

            try {
                const tickets = await Tickets.getAll(guildId, { status, limit, offset });
                res.json({ success: true, tickets });
            } catch (error) {
                Logger.error('[Ticket] Fehler beim Laden der Tickets:', error);
                res.status(500).json({ error: 'Internal Server Error' });
            }
        });

        // GET /tickets/:ticketId/transcript
        this.guildRouter.get('/tickets/:ticketId/transcript', requirePermission('TICKET.TICKETS_VIEW'), async (req, res) => {
            const ticketDbId = parseInt(req.params.ticketId, 10);

            try {
                const transcript = await Tickets.getTranscript(ticketDbId);
                if (!transcript) return res.status(404).json({ error: 'Transkript nicht gefunden' });
                res.json({ success: true, transcript });
            } catch (error) {
                Logger.error('[Ticket] Fehler beim Laden des Transkripts:', error);
                res.status(500).json({ error: 'Internal Server Error' });
            }
        });

        Logger.info('Routen Registriert für [Ticket] Plugin!');
    }

    async onDisable() {
        const Logger = ServiceManager.get('Logger');
        Logger.info('Deaktiviere [Ticket] Plugin...');
        Logger.success('[Ticket] Plugin deaktiviert');
        return true;
    }
    
    async onGuildEnable(guildId) {
        const Logger = ServiceManager.get('Logger');
        Logger.debug(`Registriere Navigation für [Ticket] in Guild ${guildId}`);
        await this._registerNavigation(guildId);
    }

    async onGuildDisable(guildId) {
        const Logger = ServiceManager.get('Logger');
        const navigationManager = ServiceManager.get('navigationManager');
        const dbService = ServiceManager.get('dbService');
        
        try {
            Logger.info(`Deaktiviere [Ticket] Plugin für Guild ${guildId}...`);
            
            // Navigation entfernen
            await navigationManager.removeNavigation(this.name, guildId);

            // Ticket-Daten löschen (Reihenfolge wegen Foreign Keys beachten)
            await dbService.query('DELETE FROM ticket_transcripts WHERE guild_id = ?', [guildId]);
            await dbService.query('DELETE FROM tickets WHERE guild_id = ?', [guildId]);
            await dbService.query('DELETE FROM ticket_categories WHERE guild_id = ?', [guildId]);
            await dbService.query('DELETE FROM ticket_settings WHERE guild_id = ?', [guildId]);

            Logger.success(`[Ticket] Daten für Guild ${guildId} erfolgreich entfernt`);
            return true;
        } catch (error) {
            Logger.error(`Fehler beim Entfernen der [Ticket] Daten für Guild ${guildId}:`, error);
            throw error;
        }
    }

    async _registerNavigation(guildId) {
        const Logger = ServiceManager.get('Logger');
        const navigationManager = ServiceManager.get('navigationManager');

        const navItems = [
            {
                title: 'TICKET:TITLE',
                path: `/guild/${guildId}/plugins/ticket`,
                icon: 'fa-solid fa-ticket',
                order: null,
                parent: `/guild/${guildId}`,
                type: 'main',
                visible: true,
                capability: 'TICKET.VIEW'
            }
        ];

        try {
            await navigationManager.registerNavigation(this.name, guildId, navItems);
            Logger.debug('[Ticket] Navigation registriert (Settings unter Core)');
        } catch (error) {
            Logger.error('[Ticket] Fehler beim Registrieren der Navigation:', error);
        }
    }

    _registerHooks() {
        const Logger = ServiceManager.get('Logger');
        Logger.debug('[Ticket] Hooks registriert');
    }

    _registerWidgets() {
        const Logger = ServiceManager.get('Logger');
        Logger.debug('[Ticket] Widgets registriert');
    }

    _registerShortcodes() {
        const Logger = ServiceManager.get('Logger');
        Logger.debug('[Ticket] Shortcodes registriert');
    }
}

module.exports = TicketPlugin;