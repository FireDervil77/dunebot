const { DashboardPlugin } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');

const path = require('path');

class DuneMapPlugin extends DashboardPlugin {
    constructor(app) {
        super({
            name: 'dunemap',
            displayName: 'DuneMap Plugin',
            description: 'Das lägendäre dunemap plugin',
            version: '1.0.0',
            author: 'DuneBot Team',
            icon: 'fa-solid fa-map',
            baseDir: __dirname,
            publicAssets: true  // Assets aus /public/ bereitstellen
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
        Logger.info('Aktiviere DuneMap Dashboard-Plugin...');

        this._setupRoutes();
        this._registerHooks();
        this._registerWidgets();
        this._registerShortcodes();
        this._registerAssets(); // NEU: Assets registrieren
        
        Logger.success('DuneMap Dashboard-Plugin aktiviert');
        return true;
    }
    
    /**
     * WordPress-Style Asset Registration
     * @author DuneBot Team
     */
    _registerAssets() {
        const assetManager = ServiceManager.get('assetManager');
        const Logger = ServiceManager.get('Logger');
        
        if (!assetManager) {
            Logger.warn('[DuneMap] AssetManager nicht verfügbar!');
            return;
        }
        
        // DuneMap Admin Script mit Abhängigkeiten registrieren
        assetManager.registerScript('dunemap-admin', 'js/dunemap-admin.js', {
            plugin: 'dunemap',
            deps: [], // Keine Abhängigkeiten (standalone)
            version: this.version,
            inFooter: true,
            defer: false
            // HINWEIS: debugSrc entfernt, da dunemap-admin.dev.js nicht existiert
            // Die normale dunemap-admin.js wird auch im Debug-Modus verwendet
        });
        
        // CSS ist inline im Template (kein separates File)
        
        Logger.debug('[DuneMap] Assets registriert (dunemap-admin.js)');
    }
    
    /**
     * Routen für DuneMap einrichten
     */
    _setupRoutes() {
        const Logger = ServiceManager.get('Logger');
        const themeManager = ServiceManager.get('themeManager');
        
        try {
            // === HAUPTSEITE (Dashboard/Übersicht) ===
            this.guildRouter.get('/', async (req, res) => {
                const guildId = res.locals.guildId;
                const dbService = ServiceManager.get('dbService');
                const i18n = ServiceManager.get('i18n');
                const Logger = ServiceManager.get('Logger');
                
                // Sichere Übersetzungsfunktion
                const t = (key, options = {}) => {
                    try {
                        if (req.translate && typeof req.translate === 'function') {
                            return req.translate(key, options);
                        }
                        if (i18n && i18n.i18next) {
                            return i18n.i18next.t(key, { ...options, lng: res.locals?.locale || 'de-DE' });
                        }
                        Logger.warn(`[DuneMap] Translation failed for key: ${key}`);
                        return key;
                    } catch (err) {
                        Logger.error(`[DuneMap] Translation error for ${key}:`, err);
                        return key;
                    }
                };
                
                try {
                    // Statistiken laden
                    const markerCountResult = await dbService.query(`
                        SELECT COUNT(*) as count 
                        FROM dunemap_markers 
                        WHERE guild_id = ?
                    `, [guildId]);
                    
                    // FIX: Array destructuring - Query liefert Array zurück!
                    const markerCount = markerCountResult && markerCountResult.length > 0 
                        ? markerCountResult[0].count 
                        : 0;
                    
                    // Letzte Marker
                    const recentMarkers = await dbService.query(`
                        SELECT * FROM dunemap_markers 
                        WHERE guild_id = ? 
                        ORDER BY placed_at DESC 
                        LIMIT 5
                    `, [guildId]);
                    
                    // User-IDs auflösen via IPC
                    const userIds = [...new Set(recentMarkers.map(m => m.placed_by).filter(Boolean))];
                    let memberNames = {};
                    
                    if (userIds.length > 0) {
                        try {
                            const ipcServer = ServiceManager.get('ipcServer');
                            const responses = await ipcServer.broadcast('dashboard:GET_GUILD_MEMBERS', {
                                guildId: guildId,
                                userIds: userIds
                            });
                            
                            // broadcast() gibt Array zurück - nehme erstes Element
                            const response = responses && responses.length > 0 ? responses[0] : null;
                            
                            if (response && response.success) {
                                memberNames = response.members;
                                Logger.debug(`[DuneMap] ${Object.keys(memberNames).length} Members aufgelöst`);
                            } else {
                                Logger.warn('[DuneMap] IPC GET_GUILD_MEMBERS: Keine Members erhalten', response);
                            }
                        } catch (err) {
                            Logger.error('[DuneMap] IPC GET_GUILD_MEMBERS fehlgeschlagen:', err);
                        }
                    }
                    
                    // Member-Namen zu Markern hinzufügen
                    recentMarkers.forEach(marker => {
                        const member = memberNames[marker.placed_by];
                        marker.placedByName = member 
                            ? (member.displayName || member.username)
                            : (marker.placed_by || 'Bot');
                    });
                    
                    // Marker-Typen laden
                    const { getMarkerTypesByCategory } = require('../shared/markerTypes');
                    const markerTypes = getMarkerTypesByCategory();
                    
                    Logger.debug('[DuneMap] Marker-Typen geladen:', {
                        resources: markerTypes.resources?.length,
                        tactical: markerTypes.tactical?.length,
                        other: markerTypes.other?.length
                    });
                    
                    await themeManager.renderView(res, 'guild/dunemap-dashboard', {
                        title: 'DuneMap Übersicht',
                        activeMenu: `/guild/${guildId}/plugins/dunemap`,
                        guildId,
                        markerCount: markerCount,  // FIX: Direkt die Zahl übergeben
                        recentMarkers,
                        markerTypes,  // Nach Kategorie gruppierte Marker-Typen
                        plugin: this
                    });
                } catch (error) {
                    Logger.error('[DuneMap] Fehler bei /:', error);
                    res.status(500).render('error', { 
                        message: t('dunemap:MESSAGES.ERROR_LOADING_DASHBOARD'), 
                        error 
                    });
                }
            });
            
            // Settings-Route
            this.guildRouter.get('/settings', async (req, res) => {
                const guildId = res.locals.guildId;
                const dbService = ServiceManager.get('dbService');
                
                // Standard-Settings (Defaults aus config.json)
                const settings = {
                    STORM_TIMER_FORMAT: 'HH:mm:ss',
                    STROM_TIMER_TIMEZONE: 'Europe/Berlin',
                    STORM_TIME_RECALCULATE_TIME: false,
                    STROM_TIMER_DURATION: '6d',
                    MAP_CHANNEL_ID: ''
                };
                
                try {
                    const configs = await dbService.query(`
                        SELECT config_key, config_value 
                        FROM configs 
                        WHERE plugin_name = 'dunemap' 
                        AND guild_id = ? 
                        AND context = 'shared'
                    `, [guildId]);
                    
                    configs.forEach(row => {
                        const key = row.config_key;
                        let value = row.config_value;
                        
                        // WICHTIG: Channel IDs NICHT parsen - Discord Snowflakes sind zu groß für JS Numbers!
                        if (key !== 'MAP_CHANNEL_ID' && typeof value === 'string') {
                            try {
                                value = JSON.parse(value);
                            } catch (e) {
                                // Bleibt String
                            }
                        }
                        
                        settings[key] = value;
                    });
                    
                    Logger.info('[DuneMap] Settings geladen:', {
                        MAP_CHANNEL_ID: settings.MAP_CHANNEL_ID,
                        totalConfigs: configs.length,
                        configKeys: configs.map(c => c.config_key)
                    });
                } catch (err) {
                    Logger.error('[DuneMap] Fehler beim Laden der Settings:', err);
                }
                
                // Guild-Channels via IPC laden
                let guildChannels = [];
                try {
                    const ipcServer = ServiceManager.get('ipcServer');
                    const responses = await ipcServer.broadcast('dashboard:GET_GUILD_CHANNELS', {
                        guildId: guildId
                    });
                    
                    Logger.debug('[DuneMap] IPC GET_GUILD_CHANNELS Response:', responses);
                    
                    // broadcast() gibt Array zurück - nehme erstes Element
                    const response = responses && responses.length > 0 ? responses[0] : null;
                    
                    if (response && response.success) {
                        guildChannels = response.channels;
                        Logger.info(`[DuneMap] ${guildChannels.length} Channels von IPC erhalten`);
                    } else {
                        Logger.warn('[DuneMap] IPC GET_GUILD_CHANNELS: Keine Channels erhalten', response);
                    }
                } catch (err) {
                    Logger.error('[DuneMap] IPC GET_GUILD_CHANNELS fehlgeschlagen:', err);
                }
                
                // DEBUG: Finale Daten vor dem Rendern
                Logger.info('[DuneMap] Vor renderView:', {
                    MAP_CHANNEL_ID: settings.MAP_CHANNEL_ID,
                    MAP_CHANNEL_ID_type: typeof settings.MAP_CHANNEL_ID,
                    channels_count: guildChannels.length,
                    first_channel_id: guildChannels[0]?.id,
                    first_channel_id_type: typeof guildChannels[0]?.id,
                    comparison_result: guildChannels.length > 0 ? 
                        String(guildChannels[0].id) === String(settings.MAP_CHANNEL_ID) : 
                        'no channels'
                });
                
                await themeManager.renderView(res, 'guild/dunemap-settings', {
                    title: 'DuneMap Einstellungen',
                    activeMenu: `/guild/${guildId}/plugins/dunemap/settings`,
                    guildId,
                    settings,
                    guildChannels,  // Channels für Dropdown
                    plugin: this
                });
            });
            
            // POST: Settings speichern
            this.guildRouter.post('/settings', async (req, res) => {
                const guildId = res.locals.guildId;
                const dbService = ServiceManager.get('dbService');
                const i18n = ServiceManager.get('i18n');
                const Logger = ServiceManager.get('Logger');
                
                // Sichere Übersetzungsfunktion
                const t = (key, options = {}) => {
                    try {
                        if (req.translate && typeof req.translate === 'function') {
                            return req.translate(key, options);
                        }
                        if (i18n && i18n.i18next) {
                            return i18n.i18next.t(key, { ...options, lng: res.locals?.locale || 'de-DE' });
                        }
                        Logger.warn(`[DuneMap] Translation failed for key: ${key}`);
                        return key;
                    } catch (err) {
                        Logger.error(`[DuneMap] Translation error for ${key}:`, err);
                        return key;
                    }
                };
                
                const { 
                    MAP_CHANNEL_ID,
                    coriolis_region  // Einzige Storm-Einstellung
                } = req.body;
                
                try {
                    const settingsToSave = {
                        MAP_CHANNEL_ID: MAP_CHANNEL_ID || '',
                        coriolis_region: coriolis_region || 'EU'
                    };
                    
                    // FIX: INSERT ... ON DUPLICATE KEY UPDATE für alle Settings
                    // Stellt sicher, dass Settings auch angelegt werden wenn sie noch nicht existieren
                    for (const [key, value] of Object.entries(settingsToSave)) {
                        const configValue = typeof value === 'boolean' || typeof value === 'number' 
                            ? JSON.stringify(value) 
                            : value;
                        
                        // INSERT mit ON DUPLICATE KEY UPDATE
                        await dbService.query(`
                            INSERT INTO configs 
                                (plugin_name, config_key, config_value, guild_id, context)
                            VALUES 
                                ('dunemap', ?, ?, ?, 'shared')
                            ON DUPLICATE KEY UPDATE 
                                config_value = VALUES(config_value)
                        `, [key, configValue, guildId]);
                    }
                    
                    Logger.info(`[DuneMap] ✅ Settings gespeichert für Guild ${guildId}`);
                    res.json({ 
                        success: true, 
                        message: t('dunemap:MESSAGES.SETTINGS_SAVED') 
                    });
                } catch (error) {
                    Logger.error('[DuneMap] Fehler beim Speichern der Settings:', error);
                    res.status(500).json({ success: false, message: error.message });
                }
            });
            
            // === ADMIN-INTERFACE (Sektor-Karte mit Marker-Editor) ===
            this.guildRouter.get('/admin', async (req, res) => {
                const Logger = ServiceManager.get('Logger');
                const guildId = res.locals.guildId;
                const dbService = ServiceManager.get('dbService');
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
                        Logger.warn(`[DuneMap] Translation failed for key: ${key}`);
                        return key;
                    } catch (err) {
                        Logger.error(`[DuneMap] Translation error for ${key}:`, err);
                        return key;
                    }
                };
                
                Logger.info(`[DuneMap] 🗺️ /admin Route aufgerufen für Guild ${guildId}`);
                
                try {
                    // Lade alle Marker für diese Guild
                    const markers = await dbService.query(`
                        SELECT * FROM dunemap_markers 
                        WHERE guild_id = ? 
                        ORDER BY placed_at DESC
                    `, [guildId]);
                    
                    Logger.info(`[DuneMap] Gefundene Marker: ${markers.length}`);
                    
                    // Lade Settings (SHARED für coriolis_region!)
                    const settings = await dbService.query(`
                        SELECT config_key, config_value 
                        FROM configs 
                        WHERE plugin_name = 'dunemap' 
                        AND guild_id = ? 
                        AND context IN ('guild', 'shared')
                    `, [guildId]);
                    
                    Logger.info(`[DuneMap] Gefundene Settings: ${settings.length}`);
                    
                    const config = {};
                    settings.forEach(row => {
                        try {
                            config[row.config_key] = JSON.parse(row.config_value);
                        } catch (e) {
                            config[row.config_key] = row.config_value;
                        }
                    });
                    
                    Logger.info(`[DuneMap] Rendering View mit ${markers.length} Markern`);
                    
                    // Assets für diese Seite einreihen
                    const assetManager = ServiceManager.get('assetManager');
                    if (assetManager) {
                        // Nur Script, kein CSS (inline im Template)
                        
                        // Script mit localisierten Daten registrieren (wie wp_localize_script)
                        assetManager.registerScript('dunemap-admin-data', 'js/dunemap-admin.js', {
                            plugin: 'dunemap',
                            version: this.version,
                            inFooter: true,
                            localize: {
                                guildId: guildId,
                                markers: markers,
                                ajaxUrl: `/guild/${guildId}/plugins/dunemap/admin/marker`,
                                nonce: req.session.csrfToken || '',  // Falls CSRF verwendet wird
                                i18n: {
                                    markerAdded: req.t('dunemap:ADMIN.JS.MARKER_ADDED'),
                                    errorAdd: req.t('dunemap:ADMIN.JS.ERROR_ADD'),
                                    networkError: req.t('dunemap:ADMIN.JS.NETWORK_ERROR'),
                                    confirmDelete: req.t('dunemap:ADMIN.JS.CONFIRM_DELETE'),
                                    markerRemoved: req.t('dunemap:ADMIN.JS.MARKER_REMOVED'),
                                    errorRemove: req.t('dunemap:ADMIN.JS.ERROR_REMOVE')
                                }
                            }
                        });
                        assetManager.enqueueScript('dunemap-admin-data');
                        Logger.debug('[DuneMap] Assets enqueued für /admin');
                    }
                    
                    await themeManager.renderView(res, 'guild/dunemap-admin', {
                        title: 'DuneMap - Sektor-Karte verwalten',
                        activeMenu: `/guild/${guildId}/plugins/dunemap/admin`,
                        guildId,
                        markers,
                        config,
                        plugin: this
                    });
                    
                    Logger.info('[DuneMap] View erfolgreich gerendert');
                } catch (error) {
                    Logger.error('[DuneMap] ❌ Fehler bei /admin:', error);
                    res.status(500).render('error', { 
                        message: t('dunemap:MESSAGES.ERROR_LOADING_MAP'), 
                        error 
                    });
                }
            });
            
            // POST: Marker erstellen/löschen
            this.guildRouter.post('/admin/marker', async (req, res) => {
                const guildId = res.locals.guildId;
                const dbService = ServiceManager.get('dbService');
                const Logger = ServiceManager.get('Logger');
                const i18n = ServiceManager.get('i18n');
                
                // Hilfsfunktion für sichere Übersetzung
                const t = (key, options = {}) => {
                    try {
                        // Versuche req.translate (von base.middleware gesetzt)
                        if (req.translate && typeof req.translate === 'function') {
                            return req.translate(key, options);
                        }
                        // Fallback: Direkter i18n-Zugriff
                        if (i18n && i18n.i18next) {
                            return i18n.i18next.t(key, { ...options, lng: res.locals?.locale || 'de-DE' });
                        }
                        // Letzter Fallback: Key zurückgeben
                        Logger.warn(`[DuneMap] Translation failed for key: ${key}`);
                        return key;
                    } catch (err) {
                        Logger.error(`[DuneMap] Translation error for ${key}:`, err);
                        return key;
                    }
                };
                
                // JavaScript sendet camelCase, SQL erwartet snake_case
                const { 
                    sectorX, sectorY, markerType, action, placedBy,
                    markerId  // Für remove by ID
                } = req.body;
                
                Logger.debug('[DuneMap] POST /admin/marker:', req.body);
                
                try {
                    if (action === 'add') {
                        // Validierung
                        if (!sectorX || !sectorY || !markerType) {
                            return res.status(400).json({ 
                                success: false, 
                                message: t('dunemap:MESSAGES.MISSING_PARAMS')
                            });
                        }
                        
                        // Prüfe ob bereits 6 Marker in diesem Sektor existieren
                        const [count] = await dbService.query(`
                            SELECT COUNT(*) as count 
                            FROM dunemap_markers 
                            WHERE guild_id = ? AND sector_x = ? AND sector_y = ?
                        `, [guildId, sectorX, sectorY]);
                        
                        if (count.count >= 6) {
                            return res.status(400).json({ 
                                success: false, 
                                message: t('dunemap:MESSAGES.MAX_MARKERS')
                            });
                        }
                        
                        // Marker hinzufügen
                        const insertResult = await dbService.query(`
                            INSERT INTO dunemap_markers 
                            (guild_id, sector_x, sector_y, marker_type, placed_by, placed_at)
                            VALUES (?, ?, ?, ?, ?, NOW())
                        `, [guildId, sectorX, sectorY, markerType, placedBy || 'Dashboard']);
                        
                        // Neuen Marker abrufen für Client-Update
                        const [newMarker] = await dbService.query(`
                            SELECT id, guild_id, sector_x, sector_y, marker_type, placed_by, placed_at, updated_at
                            FROM dunemap_markers
                            WHERE id = ?
                        `, [insertResult.insertId]);
                        
                        Logger.info(`[DuneMap] ✅ Marker ${markerType} in ${sectorX}${sectorY} gesetzt`);
                        res.json({ 
                            success: true, 
                            message: t('dunemap:MESSAGES.MARKER_SET', { 
                                type: markerType, 
                                sector: `${sectorX}${sectorY}` 
                            }),
                            marker: newMarker
                        });
                        
                    } else if (action === 'remove') {
                        // Remove by ID (bevorzugt)
                        if (markerId) {
                            await dbService.query(`
                                DELETE FROM dunemap_markers 
                                WHERE id = ? AND guild_id = ?
                            `, [markerId, guildId]);
                            
                            Logger.info(`[DuneMap] ✅ Marker ID ${markerId} entfernt`);
                            res.json({ 
                                success: true, 
                                message: t('dunemap:MESSAGES.MARKER_REMOVED')
                            });
                        } 
                        // Fallback: Remove by sector + type
                        else if (sectorX && sectorY && markerType) {
                            await dbService.query(`
                                DELETE FROM dunemap_markers 
                                WHERE guild_id = ? AND sector_x = ? AND sector_y = ? AND marker_type = ?
                                LIMIT 1
                            `, [guildId, sectorX, sectorY, markerType]);
                            
                            Logger.info(`[DuneMap] ✅ Marker ${markerType} aus ${sectorX}${sectorY} entfernt`);
                            res.json({ 
                                success: true, 
                                message: t('dunemap:MESSAGES.MARKER_TYPE_REMOVED', { type: markerType })
                            });
                        } else {
                            return res.status(400).json({ 
                                success: false, 
                                message: t('dunemap:MESSAGES.MISSING_REMOVE_PARAMS')
                            });
                        }
                    } else {
                        res.status(400).json({ 
                            success: false, 
                            message: t('dunemap:MESSAGES.INVALID_ACTION')
                        });
                    }
                } catch (error) {
                    Logger.error('[DuneMap] ❌ Fehler beim Marker-Update:', error);
                    res.status(500).json({ 
                        success: false, 
                        message: t('dunemap:MESSAGES.ERROR_MARKER_OPERATION'),
                        error: error.message 
                    });
                }
            });
            
            // === API: CORIOLIS STORM TIMER ===
            this.guildRouter.get('/api/storm-timer', async (req, res) => {
                const Logger = ServiceManager.get('Logger');
                const guildId = res.locals.guildId;
                const dbService = ServiceManager.get('dbService');
                const { getNextStormTiming, getRegionConfig } = require('../shared/coriolisStormConfig');
                
                try {
                    // Lade gespeicherte Region aus Config
                    const regionResult = await dbService.query(`
                        SELECT config_value 
                        FROM configs 
                        WHERE plugin_name = 'dunemap' 
                        AND config_key = 'coriolis_region' 
                        AND guild_id = ? 
                        AND context = 'guild'
                    `, [guildId]);
                    
                    // Default: EU, falls nichts gespeichert
                    const region = regionResult.length > 0 
                        ? JSON.parse(regionResult[0].config_value) 
                        : 'EU';
                    
                    Logger.debug(`[DuneMap] Storm-Timer für Region: ${region}`);
                    
                    // Berechne nächsten Storm
                    const stormData = getNextStormTiming(region);
                    const regionConfig = getRegionConfig(region);
                    
                    res.json({
                        success: true,
                        region,
                        regionConfig,
                        stormData: {
                            nextStormStart: stormData.nextStormStart.toISOString(),
                            nextStormEnd: stormData.nextStormEnd.toISOString(),
                            daysUntil: stormData.daysUntil,
                            hoursUntil: stormData.hoursUntil,
                            minutesUntil: stormData.minutesUntil,
                            isActive: stormData.isActive
                        }
                    });
                } catch (error) {
                    Logger.error('[DuneMap] Fehler beim Storm-Timer-Abruf:', error);
                    res.status(500).json({ 
                        success: false, 
                        message: error.message 
                    });
                }
            });
            
            Logger.debug('[DuneMap] Routen eingerichtet');
        } catch (error) {
            Logger.error('[DuneMap] Fehler beim Einrichten der Routen:', error);
            throw error;
        }
    }  
    
    /**
     * Plugin deaktivieren und Tabellen entfernen
     */
    async onDisable() {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        
        try {
            Logger.info('Deaktiviere DuneMap Plugin und entferne Tabellen...');
            
            // Tabellen in umgekehrter Reihenfolge löschen (wegen Foreign Keys)
            //await dbService.query('DROP TABLE IF EXISTS dunemap_storm_timer');
            //await dbService.query('DROP TABLE IF EXISTS dunemap_markers');
            
            Logger.success('DuneMap Tabellen erfolgreich entfernt');
            return true;
        } catch (error) {
            Logger.error('Fehler beim Entfernen der DuneMap Tabellen:', error);
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
        
        Logger.debug(`Registriere Navigation für dunemap in Guild ${guildId}`);
        await this._registerNavigation(guildId);

        // DB Models registrieren
        Logger.debug(`Registriere Models für dunemap in Guild ${guildId}`);
        // TODO: Models wieder aktivieren wenn benötigt
        // await this.registerModel(require('./models/Marker'));
        // await this.registerModel(require('./models/StormTimer'));

        // Standard-Marker für A1-A9 Sektoren erstellen
        await this._seedDefaultMarkers(guildId);
    }

    /**
     * Erstellt Standard-Marker für A1-A9 Sektoren (falls noch nicht vorhanden)
     * @param {string} guildId - Discord Guild ID
     */
    async _seedDefaultMarkers(guildId) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        const fs = require('fs');
        const path = require('path');

        try {
            // Lade Seed-Daten
            const seedPath = path.join(__dirname, '..', 'shared', 'seeds', 'default-markers.json');
            
            if (!fs.existsSync(seedPath)) {
                Logger.debug(`[DuneMap] Seed-Datei nicht gefunden: ${seedPath}`);
                return;
            }
            
            const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
            const markers = seedData.markers;
            
            Logger.info(`[DuneMap] Erstelle ${markers.length} Standard-Marker für Guild ${guildId}...`);
            
            let markersCreated = 0;
            
            for (const marker of markers) {
                // Sektor aufteilen (z.B. "A1" -> sector_x='A', sector_y=1)
                const sectorX = marker.sector.charAt(0);
                const sectorY = parseInt(marker.sector.substring(1));
                
                // Prüfe ob Marker bereits existiert
                const existing = await dbService.query(`
                    SELECT id FROM dunemap_markers 
                    WHERE guild_id = ? AND sector_x = ? AND sector_y = ? AND marker_type = ?
                `, [guildId, sectorX, sectorY, marker.type]);
                
                if (existing.length === 0) {
                    // Marker erstellen
                    await dbService.query(`
                        INSERT INTO dunemap_markers 
                        (guild_id, sector_x, sector_y, marker_type, placed_by, is_permanent)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `, [
                        guildId,
                        sectorX,
                        sectorY,
                        marker.type,
                        'Dashboard', // placed_by für automatisch erstellte Marker
                        marker.is_permanent ? 1 : 0
                    ]);
                    
                    markersCreated++;
                }
            }
            
            if (markersCreated > 0) {
                Logger.info(`[DuneMap] ${markersCreated} Standard-Marker für Guild ${guildId} erstellt`);
            } else {
                Logger.debug(`[DuneMap] Standard-Marker für Guild ${guildId} bereits vorhanden`);
            }
            
        } catch (error) {
            Logger.error(`[DuneMap] Fehler beim Erstellen der Standard-Marker für Guild ${guildId}:`, error);
        }
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
            Logger.info(`Deaktiviere DuneMap Plugin für Guild ${guildId}...`);
            
            // Navigation über NavigationManager entfernen
            await navigationManager.removeNavigation(this.name, guildId);
            
            // Guild-spezifische Daten aus ALLEN DuneMap-Tabellen löschen
            await dbService.query('DELETE FROM dunemap_storm_timer WHERE guild_id = ?', [guildId]);
            await dbService.query('DELETE FROM dunemap_markers WHERE guild_id = ?', [guildId]);
            await dbService.query('DELETE FROM dunemap_gps_markers WHERE guild_id = ?', [guildId]);
            
            // Configs löschen
            await dbService.query(
                'DELETE FROM configs WHERE plugin_name = ? AND guild_id = ?',
                [this.name, guildId]
            );
            
            Logger.success(`DuneMap Daten für Guild ${guildId} erfolgreich entfernt (storm_timer, markers, gps_markers, configs)`);
            return true;
        } catch (error) {
            Logger.error(`Fehler beim Entfernen der DuneMap Daten für Guild ${guildId}:`, error);
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

        // Haupt-Plugin-Navigation
        const navItems = [
            {
                title: 'DuneMap',
                path: `/guild/${guildId}/plugins/dunemap`,
                icon: 'fa-solid fa-map',
                order: 50,
                type: 'main',
                visible: true
            },
            {
                title: 'Sektor-Karte',
                path: `/guild/${guildId}/plugins/dunemap/admin`,
                icon: 'fa-solid fa-map-marked-alt',
                order: 51,
                parent: `/guild/${guildId}/plugins/dunemap`,
                type: 'main',
                visible: true
            },
            // Settings als Subnav UNTER CORE-EINSTELLUNGEN!
            {
                title: 'DuneMap',
                path: `/guild/${guildId}/plugins/dunemap/settings`,
                icon: 'fa-solid fa-map',
                order: 24,  // Nach Core-Settings (21, 22, 23)
                parent: `/guild/${guildId}/plugins/core/settings`,  // ← Parent ist Core-Settings!
                type: 'main',
                visible: true
            }
        ];

        try {
            await navigationManager.registerNavigation(this.name, guildId, navItems);
            Logger.debug('[DuneMap] Navigation registriert (inkl. Settings unter Core)');
        } catch (error) {
            Logger.error('[DuneMap] Fehler beim Registrieren der Navigation:', error);
        }
    }

    /**
     * Hooks registrieren
     */
    _registerHooks() {
        const Logger = ServiceManager.get('Logger');
        // Aktuell keine Hooks benötigt (Leaflet entfernt)
        Logger.debug('[DuneMap] Hooks registriert');
    }

    /**
     * Dashboard-Widgets registrieren
     */
    _registerWidgets() {
        const Logger = ServiceManager.get('Logger');
        const pluginManager = ServiceManager.get('pluginManager');
        const themeManager = ServiceManager.get("themeManager");
        
        Logger.debug('Core Plugin Widgets registriert');
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

module.exports = DuneMapPlugin;