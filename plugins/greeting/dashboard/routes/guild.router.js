/**
 * Greeting Plugin - Guild Settings Router
 * Handles guild-specific greeting settings (Welcome, Farewell, Autorole)
 * 
 * @module greeting/dashboard/routes/guild
 * @author FireBot Team
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');

/**
 * GET /guild/:guildId/plugins/greeting/settings
 * Zeigt Guild-spezifische Greeting-Einstellungen
 */
router.get('/settings', requirePermission('GREETING.VIEW'), async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    const dbService = ServiceManager.get('dbService');
    const ipcServer = ServiceManager.get('ipcServer');
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    
    try {
        // IPC-Calls für Channels und Roles parallel ausführen
        const [channelsResponses, rolesResponses] = await Promise.all([
            ipcServer.broadcast('dashboard:GET_GUILD_CHANNELS', { guildId }),
            ipcServer.broadcast('dashboard:GET_GUILD_ROLES', { guildId })
        ]);
        
        // broadcast() gibt Array zurück - nehme erstes Element
        const channelsResp = channelsResponses && channelsResponses.length > 0 ? channelsResponses[0] : null;
        const rolesResp = rolesResponses && rolesResponses.length > 0 ? rolesResponses[0] : null;
        
        Logger.info('[Greeting] IPC Channels Response:', {
            received: channelsResponses ? channelsResponses.length : 0,
            first: channelsResp,
            channels: channelsResp?.channels?.length || 0
        });
        
        Logger.info('[Greeting] IPC Roles Response:', {
            received: rolesResponses ? rolesResponses.length : 0,
            first: rolesResp,
            roles: rolesResp?.roles?.length || 0
        });
        
        // Greeting Settings aus DB laden
        const settings = await dbService.query(
            'SELECT * FROM greeting_settings WHERE guild_id = ?',
            [guildId]
        );
        
        Logger.info('[Greeting] DB Query Result:', {
            guildId,
            rowCount: settings.length,
            firstRow: settings[0] ? 'EXISTS' : 'NULL',
            data: settings[0] || 'NO DATA'
        });
        
        const dbSettings = settings[0] || {
            welcome_enabled: false,
            welcome_channel: null,
            welcome_content: null,
            welcome_embed: null,
            farewell_enabled: false,
            farewell_channel: null,
            farewell_content: null,
            farewell_embed: null,
            autorole_id: null,
            autorole_ids: null,
            dm_welcome_enabled: false,
            dm_welcome_content: null,
            dm_welcome_embed: null,
            welcome_image_enabled: false,
            welcome_image_bg: 'default',
            welcome_image_text: null,
            welcome_image_color: '#5865f2',
            boost_enabled: false,
            boost_channel: null,
            boost_content: null,
            boost_embed: null
        };
        
        // Parse JSON-Felder
        let welcomeEmbed = {
            title: null,
            description: null,
            color: null,
            thumbnail: null,
            image: null,
            fields: [],
            author: { name: null, iconURL: null },
            footer: { text: null, iconURL: null },
            timestamp: false
        };
        
        let farewellEmbed = {
            title: null,
            description: null,
            color: null,
            thumbnail: null,
            image: null,
            fields: [],
            author: { name: null, iconURL: null },
            footer: { text: null, iconURL: null },
            timestamp: false
        };
        
        if (dbSettings.welcome_embed) {
            try {
                welcomeEmbed = typeof dbSettings.welcome_embed === 'string' 
                    ? JSON.parse(dbSettings.welcome_embed) 
                    : dbSettings.welcome_embed;
            } catch (e) {
                Logger.error('[Greeting] Fehler beim Parsen von welcome_embed:', e);
            }
        }
        
        if (dbSettings.farewell_embed) {
            try {
                farewellEmbed = typeof dbSettings.farewell_embed === 'string' 
                    ? JSON.parse(dbSettings.farewell_embed) 
                    : dbSettings.farewell_embed;
            } catch (e) {
                Logger.error('[Greeting] Fehler beim Parsen von farewell_embed:', e);
            }
        }
        
        // Parse DM welcome embed
        let dmWelcomeEmbed = {
            title: null, description: null, color: null, thumbnail: null, image: null,
            fields: [], author: { name: null, iconURL: null }, footer: { text: null, iconURL: null }, timestamp: false
        };
        if (dbSettings.dm_welcome_embed) {
            try {
                dmWelcomeEmbed = typeof dbSettings.dm_welcome_embed === 'string'
                    ? JSON.parse(dbSettings.dm_welcome_embed)
                    : dbSettings.dm_welcome_embed;
            } catch (e) {
                Logger.error('[Greeting] Fehler beim Parsen von dm_welcome_embed:', e);
            }
        }

        // Parse boost embed
        let boostEmbed = {
            title: null, description: null, color: null, thumbnail: null, image: null,
            fields: [], author: { name: null, iconURL: null }, footer: { text: null, iconURL: null }, timestamp: false
        };
        if (dbSettings.boost_embed) {
            try {
                boostEmbed = typeof dbSettings.boost_embed === 'string'
                    ? JSON.parse(dbSettings.boost_embed)
                    : dbSettings.boost_embed;
            } catch (e) {
                Logger.error('[Greeting] Fehler beim Parsen von boost_embed:', e);
            }
        }

        // Parse autorole_ids
        let autoroleIds = [];
        if (dbSettings.autorole_ids) {
            try {
                autoroleIds = typeof dbSettings.autorole_ids === 'string'
                    ? JSON.parse(dbSettings.autorole_ids)
                    : dbSettings.autorole_ids;
            } catch { /* ignore */ }
        }
        if (autoroleIds.length === 0 && dbSettings.autorole_id) {
            autoroleIds = [dbSettings.autorole_id];
        }
        
        // Struktur für die View (nested objects wie in guild.ejs erwartet)
        const greetingSettings = {
            welcome: {
                enabled: Boolean(dbSettings.welcome_enabled),
                channel: dbSettings.welcome_channel || '',
                content: dbSettings.welcome_content || '',
                embed: welcomeEmbed
            },
            farewell: {
                enabled: Boolean(dbSettings.farewell_enabled),
                channel: dbSettings.farewell_channel || '',
                content: dbSettings.farewell_content || '',
                embed: farewellEmbed
            },
            dm_welcome: {
                enabled: Boolean(dbSettings.dm_welcome_enabled),
                content: dbSettings.dm_welcome_content || '',
                embed: dmWelcomeEmbed
            },
            autorole_id: dbSettings.autorole_id || '',
            autorole_ids: autoroleIds,
            welcome_image: {
                enabled: Boolean(dbSettings.welcome_image_enabled),
                bg: dbSettings.welcome_image_bg || 'default',
                text: dbSettings.welcome_image_text || '',
                color: dbSettings.welcome_image_color || '#5865f2'
            },
            boost: {
                enabled: Boolean(dbSettings.boost_enabled),
                channel: dbSettings.boost_channel || '',
                content: dbSettings.boost_content || '',
                embed: boostEmbed
            },
            verification: {
                enabled: Boolean(dbSettings.verification_enabled),
                channel: dbSettings.verification_channel || '',
                role_id: dbSettings.verification_role_id || '',
                type: dbSettings.verification_type || 'button',
                message: dbSettings.verification_message || '',
                remove_role_id: dbSettings.verification_remove_role_id || ''
            }
        };

        // Load invite mappings
        let inviteMappings = [];
        try {
            inviteMappings = await dbService.query(
                'SELECT * FROM greeting_invite_mappings WHERE guild_id = ? ORDER BY created_at DESC',
                [guildId]
            );
        } catch { /* table might not exist yet */ }
        
        await themeManager.renderView(res, 'guild/greeting-settings', {
            title: 'Greeting Settings',
            activeMenu: `/guild/${guildId}/plugins/greeting/settings`,
            guildId,
            channels: (channelsResp && channelsResp.success) ? channelsResp.channels : [],
            roles: (rolesResp && rolesResp.success) ? rolesResp.roles : [],
            settings: greetingSettings,
            inviteMappings,
            tabs: ['Welcome', 'Farewell', 'DM Welcome', 'Autorole', 'Boost', 'Verification', 'Invite Tracking']
        });
        
    } catch (error) {
        const Logger = ServiceManager.get('Logger');
        Logger.error('[Greeting] Fehler beim Laden der Settings:', error);
        res.status(500).send('Fehler beim Laden der Einstellungen');
    }
});

/**
 * PUT /guild/:guildId/plugins/greeting/settings
 * Speichert Guild-spezifische Greeting-Einstellungen
 */
router.put('/settings', requirePermission('GREETING.SETTINGS.EDIT'), async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const body = req.body;
    
    Logger.info('[Greeting] PUT /settings called:', {
        guildId,
        action: body.action,
        bodyKeys: Object.keys(body),
        body: JSON.stringify(body)
    });
    
    try {
        // Aktuelle Settings laden
        const [currentSettings] = await dbService.query(
            'SELECT * FROM greeting_settings WHERE guild_id = ?',
            [guildId]
        );
        
        // Settings-Objekt vorbereiten (mit Defaults)
        const settings = currentSettings || {
            guild_id: guildId,
            welcome_enabled: false,
            welcome_channel: null,
            welcome_content: null,
            welcome_embed: null,
            farewell_enabled: false,
            farewell_channel: null,
            farewell_content: null,
            farewell_embed: null,
            autorole_id: null,
            autorole_ids: null,
            dm_welcome_enabled: false,
            dm_welcome_content: null,
            dm_welcome_embed: null,
            welcome_image_enabled: false,
            welcome_image_bg: 'default',
            welcome_image_text: null,
            welcome_image_color: '#5865f2',
            boost_enabled: false,
            boost_channel: null,
            boost_content: null,
            boost_embed: null,
            verification_enabled: false,
            verification_channel: null,
            verification_role_id: null,
            verification_type: 'button',
            verification_message: null,
            verification_remove_role_id: null
        };
        
        // Parse existing JSON embeds
        if (settings.welcome_embed && typeof settings.welcome_embed === 'string') {
            settings.welcome_embed = JSON.parse(settings.welcome_embed);
        } else if (!settings.welcome_embed) {
            settings.welcome_embed = {
                title: null,
                description: null,
                color: null,
                thumbnail: null,
                image: null,
                fields: [],
                author: { name: null, iconURL: null },
                footer: { text: null, iconURL: null },
                timestamp: false
            };
        }
        
        if (settings.farewell_embed && typeof settings.farewell_embed === 'string') {
            settings.farewell_embed = JSON.parse(settings.farewell_embed);
        } else if (!settings.farewell_embed) {
            settings.farewell_embed = {
                title: null,
                description: null,
                color: null,
                thumbnail: null,
                image: null,
                fields: [],
                author: { name: null, iconURL: null },
                footer: { text: null, iconURL: null },
                timestamp: false
            };
        }

        // Parse dm_welcome_embed
        if (settings.dm_welcome_embed && typeof settings.dm_welcome_embed === 'string') {
            settings.dm_welcome_embed = JSON.parse(settings.dm_welcome_embed);
        } else if (!settings.dm_welcome_embed) {
            settings.dm_welcome_embed = {
                title: null, description: null, color: null, thumbnail: null, image: null,
                fields: [], author: { name: null, iconURL: null }, footer: { text: null, iconURL: null }, timestamp: false
            };
        }

        // Parse boost_embed
        if (settings.boost_embed && typeof settings.boost_embed === 'string') {
            settings.boost_embed = JSON.parse(settings.boost_embed);
        } else if (!settings.boost_embed) {
            settings.boost_embed = {
                title: null, description: null, color: null, thumbnail: null, image: null,
                fields: [], author: { name: null, iconURL: null }, footer: { text: null, iconURL: null }, timestamp: false
            };
        }

        // Parse autorole_ids
        if (settings.autorole_ids && typeof settings.autorole_ids === 'string') {
            settings.autorole_ids = JSON.parse(settings.autorole_ids);
        } else if (!settings.autorole_ids) {
            settings.autorole_ids = [];
        }
        
        // ============================================================================
        // WELCOME SETTINGS
        // ============================================================================
        if (body.type === 'welcome') {
            Logger.info('[Greeting] Processing Welcome settings:', { action: body.action });
            
            if (body.action === 'save') {
                // Speichern der Message-Daten
                if (body.welcome_channel) settings.welcome_channel = body.welcome_channel;
                if (body.welcome_content !== undefined) settings.welcome_content = body.welcome_content;
                
                // Embed als JSON-Objekt akzeptieren (vom Frontend collectEmbed())
                if (body.welcome_embed !== undefined) {
                    settings.welcome_embed = body.welcome_embed || {
                        title: null, description: null, color: null, thumbnail: null, image: null,
                        fields: [], author: { name: null, iconURL: null }, footer: { text: null, iconURL: null }, timestamp: false
                    };
                }
                
                // Automatisch aktivieren beim ersten Speichern (wenn noch nicht konfiguriert)
                if (!settings.welcome_content || settings.welcome_content === '') {
                    settings.welcome_enabled = true;
                }
                
                // Welcome Image Felder
                if (body.welcome_image_enabled !== undefined) {
                    settings.welcome_image_enabled = body.welcome_image_enabled === true || body.welcome_image_enabled === 'true';
                }
                if (body.welcome_image_bg !== undefined) settings.welcome_image_bg = body.welcome_image_bg || 'default';
                if (body.welcome_image_text !== undefined) settings.welcome_image_text = body.welcome_image_text || null;
                if (body.welcome_image_color !== undefined) settings.welcome_image_color = body.welcome_image_color || '#5865f2';
                
                Logger.info('[Greeting] Welcome message saved (auto-enabled: true)');
            }
            if (body.action === 'enable') {
                settings.welcome_enabled = true;
            }
            if (body.action === 'disable') {
                settings.welcome_enabled = false;
            }
            
            Logger.info('[Greeting] Welcome settings updated:', {
                enabled: settings.welcome_enabled,
                channel: settings.welcome_channel,
                hasContent: !!settings.welcome_content
            });
        }
        
        // OLD CODE (zum Vergleich - kann später entfernt werden)
        /*
        if (['welcome_enable', 'welcome_update', 'welcome_disable'].includes(body.action)) {
            if (body.action === 'welcome_enable') {
                settings.welcome_enabled = true;
            }
            if (body.action === 'welcome_disable') {
                settings.welcome_enabled = false;
                settings.welcome_channel = null;
            }
            if (body.welcome_channel && body.welcome_channel !== settings.welcome_channel) {
                settings.welcome_enabled = true;
                settings.welcome_channel = body.welcome_channel;
            }
            if (body.welcome_content !== undefined) {
                settings.welcome_content = body.welcome_content.trim().replace(/\r?\n/g, '\\n');
            }
            
            // Welcome Embed Updates
            if (body.welcome_embed_description !== undefined) {
                settings.welcome_embed.description = body.welcome_embed_description.trim().replace(/\r?\n/g, '\\n');
            }
            if (body.welcome_embed_footer !== undefined) {
                settings.welcome_embed.footer.text = body.welcome_embed_footer.trim();
            }
            if (body.welcome_embed_thumbnail !== undefined) {
                settings.welcome_embed.thumbnail = body.welcome_embed_thumbnail;
            }
            if (body.welcome_embed_color !== undefined) {
                settings.welcome_embed.color = body.welcome_embed_color;
            }
            if (body.welcome_embed_image !== undefined) {
                settings.welcome_embed.image = body.welcome_embed_image;
            }
            if (body.welcome_embed_title !== undefined) {
                settings.welcome_embed.title = body.welcome_embed_title;
            }
            if (body.welcome_embed_fields !== undefined) {
                settings.welcome_embed.fields = body.welcome_embed_fields;
            }
            if (body.welcome_embed_author !== undefined) {
                settings.welcome_embed.author.name = body.welcome_embed_author;
            }
            if (body.welcome_embed_author_icon !== undefined) {
                settings.welcome_embed.author.iconURL = body.welcome_embed_author_icon;
            }
            if (body.welcome_embed_footer_icon !== undefined) {
                settings.welcome_embed.footer.iconURL = body.welcome_embed_footer_icon;
            }
            if (body.welcome_embed_timestamp !== undefined) {
                settings.welcome_embed.timestamp = body.welcome_embed_timestamp === 'true' || body.welcome_embed_timestamp === true;
            }
        }
        */
        
        // ============================================================================
        // FAREWELL SETTINGS
        // ============================================================================
        if (body.type === 'farewell') {
            Logger.info('[Greeting] Processing Farewell settings:', { action: body.action });
            
            if (body.action === 'save') {
                // Speichern der Message-Daten
                if (body.farewell_channel) settings.farewell_channel = body.farewell_channel;
                if (body.farewell_content !== undefined) settings.farewell_content = body.farewell_content;
                
                // Embed als JSON-Objekt akzeptieren
                if (body.farewell_embed !== undefined) {
                    settings.farewell_embed = body.farewell_embed || {
                        title: null, description: null, color: null, thumbnail: null, image: null,
                        fields: [], author: { name: null, iconURL: null }, footer: { text: null, iconURL: null }, timestamp: false
                    };
                }
                
                // Automatisch aktivieren beim ersten Speichern
                if (!settings.farewell_content || settings.farewell_content === '') {
                    settings.farewell_enabled = true;
                }
                
                Logger.info('[Greeting] Farewell message saved (auto-enabled: true)');
            }
            if (body.action === 'enable') {
                settings.farewell_enabled = true;
            }
            if (body.action === 'disable') {
                settings.farewell_enabled = false;
            }
            
            Logger.info('[Greeting] Farewell settings updated:', {
                enabled: settings.farewell_enabled,
                channel: settings.farewell_channel
            });
        }
        
        /* OLD FAREWELL CODE
        if (['farewell_enable', 'farewell_update', 'farewell_disable'].includes(body.action)) {
            if (body.action === 'farewell_enable') {
                settings.farewell_enabled = true;
            }
            if (body.action === 'farewell_disable') {
                settings.farewell_enabled = false;
                settings.farewell_channel = null;
            }
            if (body.farewell_channel && body.farewell_channel !== settings.farewell_channel) {
                settings.farewell_enabled = true; // Enable when channel is set
                settings.farewell_channel = body.farewell_channel;
            }
            if (body.farewell_content !== undefined) {
                settings.farewell_content = body.farewell_content.trim().replace(/\r?\n/g, '\\n');
            }
            
            // Farewell Embed Updates
            if (body.farewell_embed_description !== undefined) {
                settings.farewell_embed.description = body.farewell_embed_description.trim().replace(/\r?\n/g, '\\n');
            }
            if (body.farewell_embed_footer !== undefined) {
                settings.farewell_embed.footer.text = body.farewell_embed_footer.trim();
            }
            if (body.farewell_embed_thumbnail !== undefined) {
                settings.farewell_embed.thumbnail = body.farewell_embed_thumbnail;
            }
            if (body.farewell_embed_color !== undefined) {
                settings.farewell_embed.color = body.farewell_embed_color;
            }
            if (body.farewell_embed_image !== undefined) {
                settings.farewell_embed.image = body.farewell_embed_image;
            }
            if (body.farewell_embed_title !== undefined) {
                settings.farewell_embed.title = body.farewell_embed_title;
            }
            if (body.farewell_embed_fields !== undefined) {
                settings.farewell_embed.fields = body.farewell_embed_fields;
            }
            if (body.farewell_embed_author !== undefined) {
                settings.farewell_embed.author.name = body.farewell_embed_author;
            }
            if (body.farewell_embed_author_icon !== undefined) {
                settings.farewell_embed.author.iconURL = body.farewell_embed_author_icon;
            }
            if (body.farewell_embed_footer_icon !== undefined) {
                settings.farewell_embed.footer.iconURL = body.farewell_embed_footer_icon;
            }
            if (body.farewell_embed_timestamp !== undefined) {
                settings.farewell_embed.timestamp = body.farewell_embed_timestamp === 'true' || body.farewell_embed_timestamp === true;
            }
        }
        */
        
        // ============================================================================
        // AUTOROLE SETTINGS (Multi-Role)
        // ============================================================================
        if (body.type === 'autorole') {
            Logger.info('[Greeting] Processing Autorole settings:', { action: body.action, autorole_ids: body.autorole_ids });
            
            if (body.action === 'save') {
                if (body.autorole_ids && Array.isArray(body.autorole_ids) && body.autorole_ids.length > 0) {
                    settings.autorole_ids = body.autorole_ids;
                    settings.autorole_id = body.autorole_ids[0]; // Backward compat
                } else {
                    settings.autorole_ids = [];
                    settings.autorole_id = null;
                }
            }
            if (body.action === 'disable') {
                settings.autorole_ids = [];
                settings.autorole_id = null;
            }
            
            Logger.info('[Greeting] Autorole updated:', { autorole_ids: settings.autorole_ids });
        }

        // ============================================================================
        // DM WELCOME SETTINGS
        // ============================================================================
        if (body.type === 'dm_welcome') {
            Logger.info('[Greeting] Processing DM Welcome settings:', { action: body.action });
            
            if (body.action === 'save') {
                if (body.dm_welcome_content !== undefined) settings.dm_welcome_content = body.dm_welcome_content;
                settings.dm_welcome_enabled = true;

                // Embed als JSON-Objekt akzeptieren
                if (body.dm_welcome_embed !== undefined) {
                    settings.dm_welcome_embed = body.dm_welcome_embed || {
                        title: null, description: null, color: null, thumbnail: null, image: null,
                        fields: [], author: { name: null, iconURL: null }, footer: { text: null, iconURL: null }, timestamp: false
                    };
                }
            }
            if (body.action === 'enable') settings.dm_welcome_enabled = true;
            if (body.action === 'disable') settings.dm_welcome_enabled = false;
        }

        // ============================================================================
        // WELCOME IMAGE SETTINGS
        // ============================================================================
        if (body.type === 'welcome_image') {
            Logger.info('[Greeting] Processing Welcome Image settings:', { action: body.action });
            
            if (body.action === 'save') {
                settings.welcome_image_enabled = body.welcome_image_enabled === true || body.welcome_image_enabled === 'true';
                if (body.welcome_image_bg !== undefined) settings.welcome_image_bg = body.welcome_image_bg || 'default';
                if (body.welcome_image_text !== undefined) settings.welcome_image_text = body.welcome_image_text || null;
                if (body.welcome_image_color !== undefined) settings.welcome_image_color = body.welcome_image_color || '#5865f2';
            }
        }

        // ============================================================================
        // BOOST SETTINGS
        // ============================================================================
        if (body.type === 'boost') {
            Logger.info('[Greeting] Processing Boost settings:', { action: body.action });
            
            if (body.action === 'save') {
                if (body.boost_channel) settings.boost_channel = body.boost_channel;
                if (body.boost_content !== undefined) settings.boost_content = body.boost_content;
                settings.boost_enabled = true;

                // Embed als JSON-Objekt akzeptieren
                if (body.boost_embed !== undefined) {
                    settings.boost_embed = body.boost_embed || {
                        title: null, description: null, color: null, thumbnail: null, image: null,
                        fields: [], author: { name: null, iconURL: null }, footer: { text: null, iconURL: null }, timestamp: false
                    };
                }
            }
            if (body.action === 'enable') settings.boost_enabled = true;
            if (body.action === 'disable') settings.boost_enabled = false;
        }

        // ============================================================================
        // VERIFICATION SETTINGS
        // ============================================================================
        if (body.type === 'verification') {
            Logger.info('[Greeting] Processing Verification settings:', { action: body.action });
            
            if (body.action === 'save') {
                settings.verification_enabled = body.verification_enabled === true || body.verification_enabled === 'true' ? 1 : 0;
                if (body.verification_channel !== undefined) settings.verification_channel = body.verification_channel || null;
                if (body.verification_role_id !== undefined) settings.verification_role_id = body.verification_role_id || null;
                if (body.verification_type !== undefined) settings.verification_type = body.verification_type || 'button';
                if (body.verification_message !== undefined) settings.verification_message = body.verification_message || null;
                if (body.verification_remove_role_id !== undefined) settings.verification_remove_role_id = body.verification_remove_role_id || null;
            }
            if (body.action === 'enable') settings.verification_enabled = 1;
            if (body.action === 'disable') settings.verification_enabled = 0;
        }
        
        // ============================================================================
        // SAVE TO DATABASE
        // ============================================================================
        await dbService.query(`
            INSERT INTO greeting_settings (
                guild_id, 
                autorole_id, autorole_ids,
                welcome_enabled, welcome_channel, welcome_content, welcome_embed,
                dm_welcome_enabled, dm_welcome_content, dm_welcome_embed,
                welcome_image_enabled, welcome_image_bg, welcome_image_text, welcome_image_color,
                farewell_enabled, farewell_channel, farewell_content, farewell_embed,
                boost_enabled, boost_channel, boost_content, boost_embed,
                verification_enabled, verification_channel, verification_role_id, verification_type, verification_message, verification_remove_role_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                autorole_id = VALUES(autorole_id),
                autorole_ids = VALUES(autorole_ids),
                welcome_enabled = VALUES(welcome_enabled),
                welcome_channel = VALUES(welcome_channel),
                welcome_content = VALUES(welcome_content),
                welcome_embed = VALUES(welcome_embed),
                dm_welcome_enabled = VALUES(dm_welcome_enabled),
                dm_welcome_content = VALUES(dm_welcome_content),
                dm_welcome_embed = VALUES(dm_welcome_embed),
                welcome_image_enabled = VALUES(welcome_image_enabled),
                welcome_image_bg = VALUES(welcome_image_bg),
                welcome_image_text = VALUES(welcome_image_text),
                welcome_image_color = VALUES(welcome_image_color),
                farewell_enabled = VALUES(farewell_enabled),
                farewell_channel = VALUES(farewell_channel),
                farewell_content = VALUES(farewell_content),
                farewell_embed = VALUES(farewell_embed),
                boost_enabled = VALUES(boost_enabled),
                boost_channel = VALUES(boost_channel),
                boost_content = VALUES(boost_content),
                boost_embed = VALUES(boost_embed),
                verification_enabled = VALUES(verification_enabled),
                verification_channel = VALUES(verification_channel),
                verification_role_id = VALUES(verification_role_id),
                verification_type = VALUES(verification_type),
                verification_message = VALUES(verification_message),
                verification_remove_role_id = VALUES(verification_remove_role_id),
                updated_at = CURRENT_TIMESTAMP
        `, [
            guildId,
            settings.autorole_id,
            JSON.stringify(settings.autorole_ids || []),
            settings.welcome_enabled ? 1 : 0,
            settings.welcome_channel,
            settings.welcome_content,
            JSON.stringify(settings.welcome_embed),
            settings.dm_welcome_enabled ? 1 : 0,
            settings.dm_welcome_content,
            JSON.stringify(settings.dm_welcome_embed),
            settings.welcome_image_enabled ? 1 : 0,
            settings.welcome_image_bg,
            settings.welcome_image_text,
            settings.welcome_image_color,
            settings.farewell_enabled ? 1 : 0,
            settings.farewell_channel,
            settings.farewell_content,
            JSON.stringify(settings.farewell_embed),
            settings.boost_enabled ? 1 : 0,
            settings.boost_channel,
            settings.boost_content,
            JSON.stringify(settings.boost_embed),
            settings.verification_enabled ? 1 : 0,
            settings.verification_channel,
            settings.verification_role_id,
            settings.verification_type,
            settings.verification_message,
            settings.verification_remove_role_id
        ]);
        
        Logger.info(`[Greeting] Settings für Guild ${guildId} gespeichert`);
        res.json({ success: true, message: 'Settings gespeichert' });
        
    } catch (error) {
        Logger.error('[Greeting] Fehler beim Speichern der Settings:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// INVITE MAPPING CRUD
// ============================================================================

router.get('/invite-mappings', requirePermission('GREETING.SETTINGS.EDIT'), async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    try {
        const rows = await dbService.query(
            'SELECT * FROM greeting_invite_mappings WHERE guild_id = ? ORDER BY created_at DESC',
            [guildId]
        );
        res.json({ success: true, mappings: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/invite-mappings', requirePermission('GREETING.SETTINGS.EDIT'), async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const { invite_code, label, welcome_content, welcome_embed } = req.body;

    if (!invite_code || typeof invite_code !== 'string' || invite_code.length > 50) {
        return res.status(400).json({ success: false, message: 'Invalid invite code' });
    }

    // Strip discord.gg/ prefix if present
    const code = invite_code.replace(/^(https?:\/\/)?(discord\.gg\/|discord\.com\/invite\/)/, '').trim();

    try {
        await dbService.query(`
            INSERT INTO greeting_invite_mappings (guild_id, invite_code, label, welcome_content, welcome_embed)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                label = VALUES(label),
                welcome_content = VALUES(welcome_content),
                welcome_embed = VALUES(welcome_embed),
                updated_at = CURRENT_TIMESTAMP
        `, [guildId, code, label || null, welcome_content || null, welcome_embed ? JSON.stringify(welcome_embed) : null]);

        Logger.info(`[Greeting] Invite mapping created/updated: ${code} for guild ${guildId}`);
        res.json({ success: true });
    } catch (error) {
        Logger.error('[Greeting] Error creating invite mapping:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

router.delete('/invite-mappings/:id', requirePermission('GREETING.SETTINGS.EDIT'), async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid ID' });

    try {
        await dbService.query(
            'DELETE FROM greeting_invite_mappings WHERE id = ? AND guild_id = ?',
            [id, guildId]
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// SEND VERIFICATION PANEL (IPC → Bot)
// ============================================================================

router.post('/send-verification-panel', requirePermission('GREETING.SETTINGS.EDIT'), async (req, res) => {
    const ipcServer = ServiceManager.get('ipcServer');
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;

    try {
        const responses = await ipcServer.broadcast('greeting:SEND_VERIFICATION_PANEL', { guildId });
        const resp = responses && responses.length > 0 ? responses[0] : null;
        if (resp && resp.success) {
            res.json({ success: true });
        } else {
            res.json({ success: false, message: resp?.error || 'Bot did not respond' });
        }
    } catch (error) {
        Logger.error('[Greeting] Error sending verification panel:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;