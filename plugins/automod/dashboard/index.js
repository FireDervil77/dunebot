const { DashboardPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../apps/dashboard/middlewares/permissions.middleware');

const path = require('path');

class AutoModPlugin extends DashboardPlugin {
    constructor(app) {
        super({
            name: 'automod',
            displayName: 'AutoMod',
            description: 'Das AutoModeartions Plugin',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
            icon: 'fa-solid fa-map',
            baseDir: __dirname,
            publicAssets: true  // Assets aus /public/ bereitstellen /public sollte aus dem view ornder gerenderrt werden
        });
        
        this.app = app;
        this.guildRouter = require('express').Router();
    }


    /**
     * Plugin aktivieren - Wird vom PluginManager aufgerufen
     * @param {Object} app - Express App-Instanz
     * @param {Object} dbService - Datenbank-Service
     */
    async onEnable(app, dbService) {
        const Logger = ServiceManager.get('Logger');
        Logger.info('Aktiviere [AutoMod] Dashboard-Plugin...');

        this._setupRoutes();
        this._registerHooks();
        this._registerWidgets();
        this._registerShortcodes();
        this._registerAssets(); // NEU: Assets registrieren
        
        Logger.success('[AutoMod] Dashboard-Plugin aktiviert');
        return true;
    }

    /**
     * WordPress-Style Asset Registration
     * @author FireBot Team
     */
    _registerAssets() {
        const assetManager = ServiceManager.get('assetManager');
        const Logger = ServiceManager.get('Logger');
        
        if (!assetManager) {
            Logger.warn('[AutoMod] AssetManager nicht verfügbar!');
            return;
        }
        
        // AutoMod Tab-System CSS registrieren
        assetManager.registerStyle('automod-tabs', 'css/automod.css', {
            plugin: 'automod',
            deps: [], // Keine Abhängigkeiten (standalone)
            version: this.version,
            media: 'all'
        });
        
        Logger.debug('[Automod] Assets registriert (automod.css)');
    }


    /**
     * Routen für AutoMod einrichten
     */
    _setupRoutes() {
        const Logger = ServiceManager.get('Logger');
        const themeManager = ServiceManager.get('themeManager');
        const { AutoModSettings } = require('../shared/models');
        const { AutoModExemptions, AutoModRegexRules, AutoModEscalation, AutoModCompoundRules } = require('../shared/models');
        const { getAvailableKeywordLists } = require('../bot/keywordLoader');

        Logger.info('Registriere Routen für [AutoMod] Plugin ...');

        // === SETTINGS SEITE (Unter Core-Settings) ===
        this.guildRouter.get('/settings', requirePermission('AUTOMOD.VIEW'), async (req, res) => {
            const guildId = res.locals.guildId;
            const Logger = ServiceManager.get('Logger');
            
            // Sichere Übersetzungsfunktion
            const t = (key, options = {}) => {
                try {
                    if (req.translate && typeof req.translate === 'function') {
                        return req.translate(key, options);
                    }
                    const i18n = ServiceManager.get('i18n');
                    if (i18n && i18n.i18next) {
                        return i18n.i18next.t(key, { ...options, lng: res.locals?.locale || 'de-DE' });
                    }
                    Logger.warn(`[AutoMod] Translation failed for key: ${key}`);
                    return key;
                } catch (err) {
                    Logger.error(`[AutoMod] Translation error for ${key}:`, err);
                    return key;
                }
            };
            
            Logger.info(`[AutoMod] /settings Route aufgerufen für Guild ${guildId}`);
            
            try {
                // Settings laden (nutzt Model mit Fallback auf Defaults)
                const settings = await AutoModSettings.getSettings(guildId);
                
                Logger.info(`[AutoMod] Settings geladen für Guild ${guildId}`);
                
                // Guild-Channels für Dropdown
                const ipcServer = ServiceManager.get('ipcServer');
                let guildChannels = [];
                
                if (ipcServer) {
                    try {
                        const channelResponses = await ipcServer.broadcast('dashboard:GET_GUILD_CHANNELS', { guildId });
                        const channelResp = channelResponses && channelResponses.length > 0 ? channelResponses[0] : null;
                        
                        if (channelResp && channelResp.channels) {
                            guildChannels = channelResp.channels;
                        }
                    } catch (err) {
                        Logger.warn(`[AutoMod] IPC channel fetch failed:`, err.message);
                    }
                }
                
                // View rendern
                const [exemptions, regexRules, escalationConfig, guildRoles] = await Promise.all([
                    AutoModExemptions.getAll(guildId),
                    AutoModRegexRules.getRules(guildId),
                    AutoModEscalation.getConfig(guildId),
                    (async () => {
                        try {
                            const roleResponses = await ipcServer.broadcast('dashboard:GET_GUILD_ROLES', { guildId, includeAll: true });
                            const roleResp = roleResponses && roleResponses.length > 0 ? roleResponses[0] : null;
                            return roleResp?.roles || [];
                        } catch { return []; }
                    })()
                ]);

                let compoundRules = [];
                try {
                    compoundRules = await AutoModCompoundRules.getRules(guildId);
                } catch { compoundRules = []; }

                const keywordLists = getAvailableKeywordLists();

                // active_keyword_lists parsen
                let activeKeywordLists = [];
                if (settings.active_keyword_lists) {
                    try {
                        activeKeywordLists = typeof settings.active_keyword_lists === 'string'
                            ? JSON.parse(settings.active_keyword_lists)
                            : settings.active_keyword_lists;
                    } catch {
                        activeKeywordLists = [];
                    }
                }

                await themeManager.renderView(res, 'guild/automod-settings', {
                    tr: t,
                    settings,
                    guildChannels,
                    guildRoles,
                    guildId,
                    exemptions,
                    regexRules,
                    escalationConfig,
                    keywordLists,
                    activeKeywordLists,
                    compoundRules,
                    conditionTypes: AutoModCompoundRules.CONDITION_TYPES
                });
                
            } catch (error) {
                Logger.error('[AutoMod] Fehler beim Laden der Settings:', error);
                res.status(500).send('Fehler beim Laden der [AutoMod]-Einstellungen');
            }
        });

        // === SETTINGS SPEICHERN ===
        this.guildRouter.put('/settings', requirePermission('AUTOMOD.SETTINGS_EDIT'), async (req, res) => {
            const guildId = res.locals.guildId;
            const Logger = ServiceManager.get('Logger');
            const i18n = ServiceManager.get('i18n');
            
            // Sichere Übersetzungsfunktion
            const t = (key, options = {}) => {
                try {
                    if (req.translate && typeof req.translate === 'function') {
                        return req.translate(key, options);
                    }
                    if (i18n && i18n.i18next) {
                        return i18n.i18next.t(key, { ...options, lng: res.locals?.locale || 'de-DE' });
                    }
                    return key;
                } catch (err) {
                    Logger.error(`[AutoMod] Translation error for ${key}:`, err);
                    return key;
                }
            };
            
            try {
                Logger.info(`[AutoMod] Settings speichern für Guild ${guildId}`, req.body);
                
                // Validierung
                const {
                    log_channel,
                    max_strikes,
                    action,
                    debug_mode,
                    anti_ghostping,
                    anti_spam,
                    anti_massmention,
                    anti_massmention_threshold,
                    anti_attachments,
                    anti_invites,
                    anti_links,
                    max_lines,
                    max_mentions,
                    max_role_mentions,
                    whitelisted_channels,
                    active_keyword_lists,
                    // Raid Protection
                    raid_protection_enabled,
                    raid_join_threshold,
                    raid_join_timespan,
                    raid_min_account_age_days,
                    raid_action,
                    raid_lockdown_enabled,
                    raid_alert_channel,
                    raid_alert_mention_mods,
                    raid_trusted_invites
                } = req.body;
                
                // Baue Update-Object
                const updates = {};
                
                if (log_channel !== undefined) updates.log_channel = log_channel || null;
                if (max_strikes !== undefined) updates.max_strikes = parseInt(max_strikes) || 10;
                if (action !== undefined && ['TIMEOUT', 'KICK', 'BAN'].includes(action)) {
                    updates.action = action;
                }
                
                // Boolean-Checkboxen: String '1' oder '0' zu Boolean konvertieren
                const toBool = (val) => val === '1' || val === 1 || val === true || val === 'true';
                
                if (debug_mode !== undefined) updates.debug_mode = toBool(debug_mode);
                if (anti_ghostping !== undefined) updates.anti_ghostping = toBool(anti_ghostping);
                if (anti_spam !== undefined) updates.anti_spam = toBool(anti_spam);
                if (anti_massmention !== undefined) updates.anti_massmention = toBool(anti_massmention);
                if (anti_massmention_threshold !== undefined) updates.anti_massmention_threshold = parseInt(anti_massmention_threshold) || 3;
                if (anti_attachments !== undefined) updates.anti_attachments = toBool(anti_attachments);
                if (anti_invites !== undefined) updates.anti_invites = toBool(anti_invites);
                if (anti_links !== undefined) updates.anti_links = toBool(anti_links);
                if (max_lines !== undefined) updates.max_lines = parseInt(max_lines) || 0;
                if (max_mentions !== undefined) updates.max_mentions = parseInt(max_mentions) || 0;
                if (max_role_mentions !== undefined) updates.max_role_mentions = parseInt(max_role_mentions) || 0;
                
                // Whitelisted Channels (JSON Array)
                if (whitelisted_channels !== undefined) {
                    if (Array.isArray(whitelisted_channels)) {
                        updates.whitelisted_channels = whitelisted_channels;
                    } else if (typeof whitelisted_channels === 'string') {
                        try {
                            updates.whitelisted_channels = JSON.parse(whitelisted_channels);
                        } catch {
                            updates.whitelisted_channels = [];
                        }
                    }
                }

                // Active Keyword Lists (JSON Array von IDs)
                if (active_keyword_lists !== undefined) {
                    if (Array.isArray(active_keyword_lists)) {
                        updates.active_keyword_lists = JSON.stringify(active_keyword_lists);
                    } else if (typeof active_keyword_lists === 'string') {
                        try {
                            JSON.parse(active_keyword_lists); // Validierung
                            updates.active_keyword_lists = active_keyword_lists;
                        } catch {
                            updates.active_keyword_lists = '[]';
                        }
                    } else {
                        updates.active_keyword_lists = '[]';
                    }
                }
                
                // ========================================
                // RAID PROTECTION SETTINGS
                // ========================================
                
                if (raid_protection_enabled !== undefined) updates.raid_protection_enabled = toBool(raid_protection_enabled);
                if (raid_join_threshold !== undefined) updates.raid_join_threshold = parseInt(raid_join_threshold) || 5;
                if (raid_join_timespan !== undefined) updates.raid_join_timespan = parseInt(raid_join_timespan) || 10;
                if (raid_min_account_age_days !== undefined) updates.raid_min_account_age_days = parseInt(raid_min_account_age_days) || 0;
                
                if (raid_action !== undefined && ['KICK', 'BAN'].includes(raid_action)) {
                    updates.raid_action = raid_action;
                }
                
                if (raid_lockdown_enabled !== undefined) updates.raid_lockdown_enabled = toBool(raid_lockdown_enabled);
                if (raid_alert_channel !== undefined) updates.raid_alert_channel = raid_alert_channel || null;
                if (raid_alert_mention_mods !== undefined) updates.raid_alert_mention_mods = toBool(raid_alert_mention_mods);
                
                // Trusted Invites (Textarea → Array)
                if (raid_trusted_invites !== undefined) {
                    if (typeof raid_trusted_invites === 'string') {
                        // Split by newline, trim, filter empty
                        const invites = raid_trusted_invites
                            .split(/\r?\n/)
                            .map(line => line.trim())
                            .filter(line => line.length > 0)
                            .map(line => {
                                // Extract code from full URL if provided
                                const match = line.match(/discord\.gg\/([A-Za-z0-9]+)/);
                                return match ? match[1] : line;
                            });
                        updates.raid_trusted_invites = invites;
                    } else if (Array.isArray(raid_trusted_invites)) {
                        updates.raid_trusted_invites = raid_trusted_invites;
                    } else {
                        updates.raid_trusted_invites = [];
                    }
                }
                
                // Settings speichern
                await AutoModSettings.updateSettings(guildId, updates);
                
                Logger.info(`[AutoMod] Settings gespeichert für Guild ${guildId}`);
                
                res.json({ 
                    success: true, 
                    message: t('automod:MESSAGES.SETTINGS_SAVED') || 'Einstellungen gespeichert'
                });
                
            } catch (error) {
                Logger.error('[AutoMod] Fehler beim Speichern der Settings:', error);
                res.status(500).json({ 
                    success: false, 
                    message: t('automod:MESSAGES.SETTINGS_ERROR') || 'Fehler beim Speichern der Einstellungen'
                });
            }
        });

        // ============================================================
        // EXEMPTIONS API
        // ============================================================

        // GET: Alle Exemptions laden
        this.guildRouter.get('/exemptions', requirePermission('AUTOMOD.WHITELIST_MANAGE'), async (req, res) => {
            try {
                const exemptions = await AutoModExemptions.getAll(res.locals.guildId);
                res.json({ success: true, exemptions });
            } catch (error) {
                res.status(500).json({ success: false, message: 'Fehler beim Laden der Exemptions' });
            }
        });

        // POST: Exemption hinzufügen
        this.guildRouter.post('/exemptions', requirePermission('AUTOMOD.WHITELIST_MANAGE'), async (req, res) => {
            const { type, target_id } = req.body;

            if (!type || !target_id || !['role', 'channel'].includes(type)) {
                return res.status(400).json({ success: false, message: 'Ungültige Parameter (type: role|channel, target_id erforderlich)' });
            }

            try {
                const id = await AutoModExemptions.add(res.locals.guildId, type, target_id);
                res.json({ success: true, id });
            } catch (error) {
                res.status(500).json({ success: false, message: 'Fehler beim Hinzufügen der Exemption' });
            }
        });

        // DELETE: Exemption entfernen
        this.guildRouter.delete('/exemptions/:id', requirePermission('AUTOMOD.WHITELIST_MANAGE'), async (req, res) => {
            const id = parseInt(req.params.id);
            if (isNaN(id)) return res.status(400).json({ success: false, message: 'Ungültige ID' });

            try {
                const success = await AutoModExemptions.remove(id, res.locals.guildId);
                res.json({ success });
            } catch (error) {
                res.status(500).json({ success: false, message: 'Fehler beim Entfernen der Exemption' });
            }
        });

        // ============================================================
        // REGEX RULES API
        // ============================================================

        // GET: Alle Regex-Regeln
        this.guildRouter.get('/regex-rules', requirePermission('AUTOMOD.RULES_CREATE'), async (req, res) => {
            try {
                const rules = await AutoModRegexRules.getRules(res.locals.guildId);
                res.json({ success: true, rules });
            } catch (error) {
                res.status(500).json({ success: false, message: 'Fehler beim Laden der Regex-Regeln' });
            }
        });

        // POST: Neue Regex-Regel
        this.guildRouter.post('/regex-rules', requirePermission('AUTOMOD.RULES_CREATE'), async (req, res) => {
            const { name, pattern, action: ruleAction } = req.body;

            if (!name || !pattern || !ruleAction) {
                return res.status(400).json({ success: false, message: 'Name, Pattern und Aktion sind erforderlich' });
            }

            if (!['DELETE', 'WARN', 'STRIKE'].includes(ruleAction)) {
                return res.status(400).json({ success: false, message: 'Ungültige Aktion (DELETE, WARN, STRIKE)' });
            }

            try {
                const result = await AutoModRegexRules.addRule(res.locals.guildId, name, pattern, ruleAction);
                if (result.error) {
                    return res.status(400).json({ success: false, message: result.error });
                }
                res.json({ success: true, id: result.id });
            } catch (error) {
                res.status(500).json({ success: false, message: 'Fehler beim Erstellen der Regex-Regel' });
            }
        });

        // PUT: Regex-Regel aktualisieren
        this.guildRouter.put('/regex-rules/:id', requirePermission('AUTOMOD.RULES_EDIT'), async (req, res) => {
            const id = parseInt(req.params.id);
            if (isNaN(id)) return res.status(400).json({ success: false, message: 'Ungültige ID' });

            const { name, pattern, action: ruleAction, enabled } = req.body;
            const updates = {};
            if (name !== undefined) updates.name = name;
            if (pattern !== undefined) updates.pattern = pattern;
            if (ruleAction !== undefined && ['DELETE', 'WARN', 'STRIKE'].includes(ruleAction)) updates.action = ruleAction;
            if (enabled !== undefined) updates.enabled = enabled ? 1 : 0;

            if (Object.keys(updates).length === 0) {
                return res.status(400).json({ success: false, message: 'Keine Updates angegeben' });
            }

            try {
                const result = await AutoModRegexRules.updateRule(id, res.locals.guildId, updates);
                if (result.error) {
                    return res.status(400).json({ success: false, message: result.error });
                }
                res.json({ success: result.success });
            } catch (error) {
                res.status(500).json({ success: false, message: 'Fehler beim Aktualisieren der Regex-Regel' });
            }
        });

        // DELETE: Regex-Regel löschen
        this.guildRouter.delete('/regex-rules/:id', requirePermission('AUTOMOD.RULES_DELETE'), async (req, res) => {
            const id = parseInt(req.params.id);
            if (isNaN(id)) return res.status(400).json({ success: false, message: 'Ungültige ID' });

            try {
                const success = await AutoModRegexRules.deleteRule(id, res.locals.guildId);
                res.json({ success });
            } catch (error) {
                res.status(500).json({ success: false, message: 'Fehler beim Löschen der Regex-Regel' });
            }
        });

        // ============================================================
        // ESCALATION CONFIG API
        // ============================================================

        // GET: Alle Eskalationsstufen
        this.guildRouter.get('/escalation', requirePermission('AUTOMOD.SETTINGS_EDIT'), async (req, res) => {
            try {
                const config = await AutoModEscalation.getConfig(res.locals.guildId);
                res.json({ success: true, config });
            } catch (error) {
                res.status(500).json({ success: false, message: 'Fehler beim Laden der Eskalations-Config' });
            }
        });

        // POST: Eskalationsstufe hinzufügen
        this.guildRouter.post('/escalation', requirePermission('AUTOMOD.SETTINGS_EDIT'), async (req, res) => {
            const { threshold, action: escAction, duration } = req.body;

            if (!threshold || !escAction || !['TIMEOUT', 'KICK', 'BAN'].includes(escAction)) {
                return res.status(400).json({ success: false, message: 'Threshold und Aktion (TIMEOUT/KICK/BAN) sind erforderlich' });
            }

            const parsedThreshold = parseInt(threshold);
            if (isNaN(parsedThreshold) || parsedThreshold < 1) {
                return res.status(400).json({ success: false, message: 'Threshold muss eine positive Zahl sein' });
            }

            try {
                const id = await AutoModEscalation.addLevel(
                    res.locals.guildId,
                    parsedThreshold,
                    escAction,
                    escAction === 'TIMEOUT' ? (parseInt(duration) || 10) : null
                );
                res.json({ success: true, id });
            } catch (error) {
                res.status(500).json({ success: false, message: 'Fehler beim Hinzufügen der Eskalationsstufe' });
            }
        });

        // PUT: Eskalationsstufe aktualisieren
        this.guildRouter.put('/escalation/:id', requirePermission('AUTOMOD.SETTINGS_EDIT'), async (req, res) => {
            const id = parseInt(req.params.id);
            if (isNaN(id)) return res.status(400).json({ success: false, message: 'Ungültige ID' });

            const { threshold, action: escAction, duration } = req.body;
            const updates = {};
            if (threshold !== undefined) updates.threshold = parseInt(threshold);
            if (escAction !== undefined && ['TIMEOUT', 'KICK', 'BAN'].includes(escAction)) updates.action = escAction;
            if (duration !== undefined) updates.duration = parseInt(duration) || null;

            if (Object.keys(updates).length === 0) {
                return res.status(400).json({ success: false, message: 'Keine Updates angegeben' });
            }

            try {
                const success = await AutoModEscalation.updateLevel(id, res.locals.guildId, updates);
                res.json({ success });
            } catch (error) {
                res.status(500).json({ success: false, message: 'Fehler beim Aktualisieren der Eskalationsstufe' });
            }
        });

        // DELETE: Eskalationsstufe löschen
        this.guildRouter.delete('/escalation/:id', requirePermission('AUTOMOD.SETTINGS_EDIT'), async (req, res) => {
            const id = parseInt(req.params.id);
            if (isNaN(id)) return res.status(400).json({ success: false, message: 'Ungültige ID' });

            try {
                const success = await AutoModEscalation.deleteLevel(id, res.locals.guildId);
                res.json({ success });
            } catch (error) {
                res.status(500).json({ success: false, message: 'Fehler beim Löschen der Eskalationsstufe' });
            }
        });

        // POST: Default-Eskalation erstellen
        this.guildRouter.post('/escalation/defaults', requirePermission('AUTOMOD.SETTINGS_EDIT'), async (req, res) => {
            try {
                await AutoModEscalation.createDefaults(res.locals.guildId);
                const config = await AutoModEscalation.getConfig(res.locals.guildId);
                res.json({ success: true, config });
            } catch (error) {
                res.status(500).json({ success: false, message: 'Fehler beim Erstellen der Default-Eskalation' });
            }
        });

        // ==================== COMPOUND RULES API ====================

        // GET /compound-rules
        this.guildRouter.get('/compound-rules', requirePermission('AUTOMOD.VIEW'), async (req, res) => {
            try {
                const rules = await AutoModCompoundRules.getRules(res.locals.guildId);
                res.json({ success: true, rules });
            } catch (error) {
                res.status(500).json({ success: false, message: error.message });
            }
        });

        // POST /compound-rules
        this.guildRouter.post('/compound-rules', requirePermission('AUTOMOD.SETTINGS_EDIT'), async (req, res) => {
            const { name, description, conditions, logic, action, duration } = req.body;
            if (!name || !conditions || !Array.isArray(conditions) || conditions.length === 0) {
                return res.status(400).json({ success: false, message: 'Name und mindestens eine Bedingung erforderlich' });
            }
            try {
                const id = await AutoModCompoundRules.createRule(res.locals.guildId, { name, description, conditions, logic, action, duration });
                const rule = await AutoModCompoundRules.getRule(id, res.locals.guildId);
                res.json({ success: true, rule });
            } catch (error) {
                res.status(400).json({ success: false, message: error.message });
            }
        });

        // PUT /compound-rules/:id
        this.guildRouter.put('/compound-rules/:id', requirePermission('AUTOMOD.SETTINGS_EDIT'), async (req, res) => {
            const id = parseInt(req.params.id);
            if (isNaN(id)) return res.status(400).json({ success: false, message: 'Ungültige ID' });
            try {
                await AutoModCompoundRules.updateRule(id, res.locals.guildId, req.body);
                const rule = await AutoModCompoundRules.getRule(id, res.locals.guildId);
                res.json({ success: true, rule });
            } catch (error) {
                res.status(400).json({ success: false, message: error.message });
            }
        });

        // DELETE /compound-rules/:id
        this.guildRouter.delete('/compound-rules/:id', requirePermission('AUTOMOD.SETTINGS_EDIT'), async (req, res) => {
            const id = parseInt(req.params.id);
            if (isNaN(id)) return res.status(400).json({ success: false, message: 'Ungültige ID' });
            try {
                await AutoModCompoundRules.deleteRule(id, res.locals.guildId);
                res.json({ success: true });
            } catch (error) {
                res.status(500).json({ success: false, message: error.message });
            }
        });

        Logger.info('Routen Registriert für [AutoMod] Plugin!');
    }

    /**
     * Plugin deaktivieren und Tabellen entfernen
     */
    async onDisable() {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        
        try {
            Logger.info('Deaktiviere [AutoMod] Plugin und entferne Tabellen...');

            // Tabellen in umgekehrter Reihenfolge löschen (wegen Foreign Keys)
            //await dbService.query('DROP TABLE IF EXISTS dunemap_storm_timer');
            //await dbService.query('DROP TABLE IF EXISTS dunemap_markers');
            
            Logger.success('[AutoMod] Tabellen erfolgreich entfernt');
            return true;
        } catch (error) {
            Logger.error('Fehler beim Entfernen der [AutoMod] Tabellen:', error);
            throw error;
        }
    }
    
    /**
     * Registriert guild-spezifische Navigation
     * Wird aufgerufen, wenn das Plugin in einer Guild aktiviert wird
     * @param {string} guildId - Discord Guild ID
     */
    async onGuildEnable(guildId) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        Logger.debug(`Registriere Navigation für [AutoMod] in Guild ${guildId}`);
        await this._registerNavigation(guildId);

        // DB Models registrieren
        Logger.debug(`Registriere Models für [AutoMod] in Guild ${guildId}`);
        // TODO: Models wieder aktivieren wenn benötigt
        // await this.registerModel(require('./models/Marker'));
        // await this.registerModel(require('./models/StormTimer'));

        Logger.info(`[AutoMod] Plugin für Guild ${guildId} aktiviert`);
    }


    /**
     * Wird aufgerufen, wenn das Plugin in einer Guild deaktiviert wird
     * Entfernt guild-spezifische Daten
     * @param {string} guildId - Discord Guild ID
     */
    async onGuildDisable(guildId) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        const navigationManager = ServiceManager.get('navigationManager');
        
        try {
            Logger.info(`Deaktiviere [AutoMod] Plugin für Guild ${guildId}...`);
            
            // Navigation über NavigationManager entfernen
            await navigationManager.removeNavigation(this.name, guildId);
            
            // Guild-spezifische Daten aus ALLEN DuneMap-Tabellen löschen
            //await dbService.query('DELETE FROM dunemap_storm_timer WHERE guild_id = ?', [guildId]);
            //await dbService.query('DELETE FROM dunemap_markers WHERE guild_id = ?', [guildId]);
            
            // Configs löschen
            /*
            await dbService.query(
                'DELETE FROM configs WHERE plugin_name = ? AND guild_id = ?',
                [this.name, guildId]
            );
            */
            Logger.success(`[AutoMod] Daten für Guild ${guildId} erfolgreich entfernt (storm_timer, markers, gps_markers, configs)`);
            return true;
        } catch (error) {
            Logger.error(`Fehler beim Entfernen der [AutoMod] Daten für Guild ${guildId}:`, error);
            throw error;
        }
    }

    /**
     * Registriert die Navigation für das Plugin
     * @private
     */
    async _registerNavigation(guildId) {
        const Logger = ServiceManager.get('Logger');
        const navigationManager = ServiceManager.get('navigationManager');

        // AutoMod Settings unter Dashboard
        const navItems = [
            {
                title: 'automod:NAV.AUTOMOD',
                path: `/guild/${guildId}/plugins/automod/settings`,
                icon: 'fa-solid fa-shield-halved',
                order: null,
                parent: `/guild/${guildId}`,
                type: 'main',
                visible: true,
                capability: 'AUTOMOD.VIEW'
            }
        ];

        try {
            await navigationManager.registerNavigation(this.name, guildId, navItems);
            Logger.debug('[AutoMod] Navigation registriert (unter Dashboard)');
        } catch (error) {
            Logger.error('[AutoMod] Fehler beim Registrieren der Navigation:', error);
        }
    }


    /**
     * Hooks registrieren
     */
    _registerHooks() {
        const Logger = ServiceManager.get('Logger');
        // Aktuell keine Hooks benötigt (Leaflet entfernt)
        Logger.debug('[AutoMod] Hooks registriert');
    }

    /**
     * Dashboard-Widgets registrieren
     */
    _registerWidgets() {
        const Logger = ServiceManager.get('Logger');
        const pluginManager = ServiceManager.get('pluginManager');
        const themeManager = ServiceManager.get("themeManager");

        Logger.debug('[AutoMod] Plugin Widgets registriert');
    }

    /**
     * Shortcodes registrieren
     */
    _registerShortcodes() {
        // Shortcode für Guild-Namen registrieren
        this.app.shortcodeParser.register(this.name, 'guild-name', (attrs, content, context) => {
        const guildId = context.guildId || attrs.id;
        if (!guildId) return '[Keine Guild-ID]';
        
        // Guild-Namen aus dem Cache holen
        const guild = this.app.client?.guilds.cache.get(guildId);
        return guild ? guild.name : '[Unbekannte Guild]';
        });
    }
        
}

module.exports = AutoModPlugin;