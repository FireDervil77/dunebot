/**
 * Greeting Plugin - Guild Settings Router
 * Handles guild-specific greeting settings (Welcome, Farewell, Autorole)
 * 
 * @module greeting/dashboard/routes/guild
 * @author DuneBot Team
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');

/**
 * GET /guild/:guildId/plugins/greeting/settings
 * Zeigt Guild-spezifische Greeting-Einstellungen
 */
router.get('/settings', async (req, res) => {
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
            autorole_id: null
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
            autorole_id: dbSettings.autorole_id || ''
        };
        
        await themeManager.renderView(res, 'guild/greeting-settings', {
            title: 'Greeting Settings',
            activeMenu: `/guild/${guildId}/plugins/greeting/settings`,
            guildId,
            channels: (channelsResp && channelsResp.success) ? channelsResp.channels : [],
            roles: (rolesResp && rolesResp.success) ? rolesResp.roles : [],
            settings: greetingSettings,
            tabs: ['Welcome', 'Farewell', 'Autorole']
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
router.put('/settings', async (req, res) => {
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
            autorole_id: null
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
        
        // ============================================================================
        // WELCOME SETTINGS
        // ============================================================================
        if (body.type === 'welcome') {
            Logger.info('[Greeting] Processing Welcome settings:', { action: body.action });
            
            if (body.action === 'save') {
                // Speichern der Message-Daten
                if (body.welcome_channel) settings.welcome_channel = body.welcome_channel;
                if (body.welcome_content !== undefined) settings.welcome_content = body.welcome_content;
                
                // Automatisch aktivieren beim ersten Speichern (wenn noch nicht konfiguriert)
                if (!settings.welcome_content || settings.welcome_content === '') {
                    settings.welcome_enabled = true;
                }
                
                Logger.info('[Greeting] Welcome message saved (auto-enabled: true)');
            }
            if (body.action === 'enable') {
                settings.welcome_enabled = true;
            }
            if (body.action === 'disable') {
                settings.welcome_enabled = false;
            }
            
            // Embed Updates (falls vorhanden)
            if (body.welcome_embed_enabled) {
                if (body.welcome_embed_title !== undefined) settings.welcome_embed.title = body.welcome_embed_title;
                if (body.welcome_embed_description !== undefined) settings.welcome_embed.description = body.welcome_embed_description;
                if (body.welcome_embed_color !== undefined) settings.welcome_embed.color = body.welcome_embed_color;
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
        // AUTOROLE SETTINGS
        // ============================================================================
        if (body.type === 'autorole') {
            Logger.info('[Greeting] Processing Autorole settings:', { action: body.action, autorole_id: body.autorole_id });
            
            if (body.action === 'save') {
                if (body.autorole_id && body.autorole_id !== '') {
                    settings.autorole_id = body.autorole_id;
                } else {
                    settings.autorole_id = null; // Keine Rolle = Autorole deaktivieren
                }
            }
            if (body.action === 'disable') {
                settings.autorole_id = null;
            }
            
            Logger.info('[Greeting] Autorole updated:', { autorole_id: settings.autorole_id });
        }
        
        /* OLD AUTOROLE CODE
        if (['autorole', 'autorole_update'].includes(body.action)) {
            if (body.autorole_id !== undefined) {
                // Leerer String = Autorole entfernen
                settings.autorole_id = body.autorole_id === '' ? null : body.autorole_id;
            }
        }
        */
        
        // ============================================================================
        // SAVE TO DATABASE
        // ============================================================================
        await dbService.query(`
            INSERT INTO greeting_settings (
                guild_id, 
                autorole_id,
                welcome_enabled, welcome_channel, welcome_content, welcome_embed,
                farewell_enabled, farewell_channel, farewell_content, farewell_embed
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                autorole_id = VALUES(autorole_id),
                welcome_enabled = VALUES(welcome_enabled),
                welcome_channel = VALUES(welcome_channel),
                welcome_content = VALUES(welcome_content),
                welcome_embed = VALUES(welcome_embed),
                farewell_enabled = VALUES(farewell_enabled),
                farewell_channel = VALUES(farewell_channel),
                farewell_content = VALUES(farewell_content),
                farewell_embed = VALUES(farewell_embed),
                updated_at = CURRENT_TIMESTAMP
        `, [
            guildId,
            settings.autorole_id,
            settings.welcome_enabled ? 1 : 0,
            settings.welcome_channel,
            settings.welcome_content,
            JSON.stringify(settings.welcome_embed),
            settings.farewell_enabled ? 1 : 0,
            settings.farewell_channel,
            settings.farewell_content,
            JSON.stringify(settings.farewell_embed)
        ]);
        
        Logger.info(`[Greeting] Settings für Guild ${guildId} gespeichert`);
        res.json({ success: true, message: 'Settings gespeichert' });
        
    } catch (error) {
        Logger.error('[Greeting] Fehler beim Speichern der Settings:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;