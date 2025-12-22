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
                res.render('guild/automod-settings', {
                    tr: t,
                    settings,
                    guildChannels,
                    guildId,
                    layout: themeManager.getLayout('guild')
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

        // AutoMod Settings UNTER Core-Einstellungen!
        const navItems = [
            {
                title: 'automod:NAV.AUTOMOD',
                path: `/guild/${guildId}/plugins/automod/settings`,
                icon: 'fa-solid fa-shield-halved',
                order: null,  
                parent: `/guild/${guildId}/plugins/core/settings`,  // ← Parent ist Core-Settings!
                type: 'main',
                visible: true,
                capability: 'AUTOMOD.SETTINGS'
            }
        ];

        try {
            await navigationManager.registerNavigation(this.name, guildId, navItems);
            Logger.debug('[AutoMod] Navigation registriert (Settings unter Core)');
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