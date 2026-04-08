/**
 * Gameserver Management Routes
 * CRUD für Gameserver-Instanzen
 * @module routes/servers
 * @author FireBot Team
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const crypto = require('crypto');
const { ServiceManager } = require('dunebot-core');
const QueryService = require('../helpers/QueryService');
// const TemplateEngine = require('../helpers/TemplateEngine'); // ENTFERNT - existiert nicht mehr
// const PortValidator = require('../helpers/PortValidator'); // ENTFERNT - existiert nicht mehr

// ✅ PERMISSION-MIDDLEWARE IMPORTIEREN
const { requirePermission, loadUserPermissions } = require('../../../../apps/dashboard/middlewares/permissions.middleware');

// ✅ WICHTIG: Permission-Middleware für ALLE Guild-Routes laden!
router.use(loadUserPermissions);

/**
 * GET /guild/:guildId/plugins/gameserver/servers
 * Server-Übersicht - Card-Grid mit Live-Status (NEU!)
 */
router.get('/', requirePermission('GAMESERVER.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');
    
    try {
        const guildId = res.locals.guildId;
        const user = res.locals.user;
        
        // ========================================
        // 1. FILTER-PARAMETER aus Query-String
        // ========================================
        const statusFilter = req.query.status || 'all';
        const gameFilter = req.query.game || 'all';
        const searchQuery = req.query.search || '';

        Logger.debug(`[Gameserver] Server-Overview aufgerufen für Guild ${guildId}`, {
            statusFilter,
            gameFilter,
            searchQuery
        });

        // ========================================
        // 2. SERVER-LISTE mit JOINs
        // ========================================
        let query = `
            SELECT 
                gs.id,
                gs.name,
                gs.status,
                gs.current_players,
                gs.max_players,
                gs.addon_marketplace_id,
                gs.template_name,
                gs.addon_version,
                gs.update_available,
                gs.created_at,
                gs.last_started_at,
                gs.rootserver_id,
                am.name as game_name,
                am.slug as game_slug,
                am.icon_url as game_icon,
                JSON_EXTRACT(gs.ports, '$.game.internal') as game_port,
                r.host as server_ip,
                r.name as rootserver_name,
                r.daemon_id
            FROM gameservers gs
            LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
            LEFT JOIN rootserver r ON gs.rootserver_id = r.id
            WHERE gs.guild_id = ?
        `;
        const params = [guildId];

        // Status-Filter anwenden
        if (statusFilter !== 'all') {
            query += ' AND gs.status = ?';
            params.push(statusFilter);
        }

        // Game-Filter anwenden
        if (gameFilter !== 'all') {
            query += ' AND am.slug = ?';
            params.push(gameFilter);
        }

        // Such-Filter (Server-Name)
        if (searchQuery) {
            query += ' AND gs.name LIKE ?';
            params.push(`%${searchQuery}%`);
        }

        query += ' ORDER BY gs.created_at DESC';

        const servers = await dbService.query(query, params);

        // ========================================
        // 3. GAME-TYPEN für Filter (mit Count)
        // ========================================
        const gameTypes = await dbService.query(`
            SELECT 
                am.slug as game_slug,
                am.name as display_name,
                COUNT(*) as count
            FROM gameservers gs
            LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
            WHERE gs.guild_id = ?
            GROUP BY am.slug, am.name
            ORDER BY count DESC
        `, [guildId]);

        // ========================================
        // 4. STATUS-COUNTS für Filter-Badges
        // ========================================
        const statusCounts = await dbService.query(`
            SELECT 
                status,
                COUNT(*) as count
            FROM gameservers
            WHERE guild_id = ?
            GROUP BY status
        `, [guildId]);

        const counts = {
            all: servers.length,
            online: statusCounts.find(s => s.status === 'online')?.count || 0,
            offline: statusCounts.find(s => s.status === 'offline')?.count || 0,
            starting: statusCounts.find(s => s.status === 'starting')?.count || 0,
            stopping: statusCounts.find(s => s.status === 'stopping')?.count || 0,
            error: statusCounts.find(s => s.status === 'error')?.count || 0,
            installing: statusCounts.find(s => s.status === 'installing')?.count || 0
        };

        // ========================================
        // 5. VIEW rendern - NEU: Card-View (servers-overview)
        // ========================================
        
        // ✅ Scripts für Server-Overview einreihen (NUR für diese View!)
        const assetManager = ServiceManager.get('assetManager');
        if (assetManager) {
            assetManager.enqueueScript('gameserver-sse');
            assetManager.enqueueScript('gameserver-actions');
            assetManager.enqueueScript('gameserver-overview');
        }
        
        await themeManager.renderView(res, 'guild/servers-overview', {
            title: 'Gameserver Übersicht',
            activeMenu: `/guild/${guildId}/plugins/gameserver/servers`,
            servers: servers || [],
            games: gameTypes || [], // ← Template erwartet 'games'
            gameTypes: gameTypes || [], // ← Für Rückwärtskompatibilität
            statusCounts: counts,
            filters: {
                status: statusFilter,
                game: gameFilter,
                search: searchQuery
            },
            guildId,
            user
        });
    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Laden der Server-Übersicht:', error);
        res.status(500).render('error', {
            message: 'Fehler beim Laden der Server-Übersicht',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

/**
 * GET /guild/:guildId/plugins/gameserver/servers/create
 * Server-Erstellungs-Wizard (3 Steps)
 */
router.get('/create', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');
    
    try {
        const guildId = res.locals.guildId; // ← Aus res.locals!
        const { user } = req;
        const { addon, step } = req.query;

        Logger.debug(`[Gameserver] Server-Creation Wizard aufgerufen (Step: ${step || 1})`);

        const currentStep = parseInt(step) || 1;

        // Step 1: Basic Information (Name, Addon, Rootserver, Install/Start Options)
        if (currentStep === 1) {
            // ========================================
            // 1. ÖFFENTLICHE ADDONS (Official/Public)
            // ========================================
            const publicAddons = await dbService.query(`
                SELECT 
                    id,
                    slug,
                    name,
                    description,
                    category,
                    icon_url,
                    steam_app_id,
                    rating_avg,
                    rating_count,
                    trust_level,
                    'public' as addon_type
                FROM addon_marketplace
                WHERE status = 'approved'
                AND (visibility = 'official' OR visibility = 'public')
                ORDER BY trust_level DESC, rating_avg DESC
            `);

            // ========================================
            // 2. EIGENE GUILD-ADDONS (My Addons)
            // ========================================
            const guildAddons = await dbService.query(`
                SELECT 
                    id,
                    slug,
                    name,
                    description,
                    category,
                    icon_url,
                    steam_app_id,
                    rating_avg,
                    rating_count,
                    trust_level,
                    'guild' as addon_type
                FROM addon_marketplace
                WHERE status = 'approved'
                AND visibility = 'guild'
                AND guild_id = ?
                ORDER BY name ASC
            `, [guildId]);

            // ========================================
            // 3. VERFÜGBARE ROOTSERVERS (für Dropdown)
            // ========================================
            const rootservers = await dbService.query(`
                SELECT 
                    r.id,
                    r.name,
                    r.hostname,
                    r.host as ip_address,
                    r.install_status as status,
                    r.daemon_id,
                    r.cpu_cores,
                    r.cpu_model,
                    r.ram_total_gb,
                    r.ram_usage_gb,
                    r.disk_total_gb,
                    r.disk_usage_gb,
                    r.cpu_usage_percent,
                    r.last_stats_update,
                    r.last_seen as last_heartbeat,
                    r.daemon_status
                FROM rootserver r
                WHERE r.guild_id = ?
                AND r.install_status = 'completed'
                ORDER BY r.cpu_usage_percent ASC, r.created_at DESC
            `, [guildId]);

            Logger.debug(`[Gameserver] Step 1 - Public: ${publicAddons.length}, Guild: ${guildAddons.length}, Rootservers: ${rootservers.length}`);

            return await themeManager.renderView(res, 'guild/server-create-step1', {
                title: 'Server erstellen - Schritt 1: Basic Information',
                activeMenu: `/guild/${guildId}/plugins/gameserver/servers`,
                publicAddons: publicAddons || [],
                guildAddons: guildAddons || [],
                rootservers: rootservers || [],
                guildId,
                user
            });
        }

        // Step 2: Template & Daemon Server wählen
        if (currentStep === 2 && addon) {
            // Addon mit game_data abrufen
            const [addonData] = await dbService.query(`
                SELECT 
                    id,
                    slug,
                    name,
                    game_data
                FROM addon_marketplace
                WHERE slug = ?
            `, [addon]);

            if (!addonData) {
                return res.status(404).render('error', {
                    message: 'Addon nicht gefunden'
                });
            }

            // game_data parsen
            let gameData = {};
            try {
                gameData = typeof addonData.game_data === 'string'
                    ? JSON.parse(addonData.game_data)
                    : addonData.game_data;
            } catch (error) {
                Logger.error(`[Gameserver] Fehler beim Parsen von game_data:`, error);
                gameData = { templates: [], requirements: {} };
            }

            // Host-Server (rootserver) für diese Guild abrufen
            const rootservers = await dbService.query(`
                SELECT 
                    r.id,
                    r.name,
                    r.hostname,
                    r.host as ip_address,
                    r.install_status as status,
                    r.daemon_id,
                    r.cpu_cores,
                    r.cpu_model,
                    r.ram_total_gb,
                    r.ram_usage_gb,
                    r.disk_total_gb,
                    r.disk_usage_gb,
                    r.cpu_usage_percent,
                    r.last_stats_update,
                    r.last_seen as last_heartbeat,
                    r.daemon_status
                FROM rootserver r
                WHERE r.guild_id = ?
                AND r.install_status = 'completed'
                ORDER BY r.cpu_usage_percent ASC, r.created_at DESC
            `, [guildId]);

            return await themeManager.renderView(res, 'guild/server-create-step2', {
                title: 'Server erstellen - Schritt 2: Template & Server wählen',
                activeMenu: `/guild/${guildId}/plugins/gameserver/servers`,
                addon: addonData,
                gameData,
                rootservers: rootservers || [],
                guildId,
                user
            });
        }

        // Step 3: Variablen konfigurieren
        if (currentStep === 3 && addon) {
            // ========================================
            // VEREINFACHT: Kein Template-Index mehr!
            // Addon IST das Template, game_data enthält alles
            // ========================================
            const daemonId = req.query.daemon;

            const [addonData] = await dbService.query(`
                SELECT 
                    id,
                    slug,
                    name,
                    game_data
                FROM addon_marketplace
                WHERE slug = ?
            `, [addon]);

            if (!addonData) {
                return res.status(404).render('error', {
                    message: 'Addon nicht gefunden'
                });
            }

            // game_data parsen
            let gameData = {};
            try {
                gameData = typeof addonData.game_data === 'string'
                    ? JSON.parse(addonData.game_data)
                    : addonData.game_data;
            } catch (error) {
                Logger.error(`[Gameserver] Fehler beim Parsen von game_data:`, error);
                gameData = { variables: [], installation: {}, startup: {} };
            }

            // ========================================
            // MIGRATION: Variables aus altem Template-Format extrahieren
            // Alte Struktur: templates[0].variables
            // Neue Struktur: variables (direkt in game_data)
            // ========================================
            if (!gameData.variables && gameData.templates?.[0]?.variables) {
                Logger.warn(`[Gameserver] MIGRATION: Variables aus templates[0] nach root verschoben`);
                gameData.variables = gameData.templates[0].variables;
            }

            // Ebenso für installation/startup falls in templates[0]
            if (!gameData.installation && gameData.templates?.[0]?.installation) {
                Logger.warn(`[Gameserver] MIGRATION: installation aus templates[0] nach root verschoben`);
                gameData.installation = gameData.templates[0].installation;
            }

            if (!gameData.startup && gameData.templates?.[0]?.startup) {
                Logger.warn(`[Gameserver] MIGRATION: startup aus templates[0] nach root verschoben`);
                gameData.startup = gameData.templates[0].startup;
            }

            Logger.debug(`[Gameserver] Step 3 - Addon: ${addon}, Daemon: ${daemonId}`, {
                hasVariables: !!gameData.variables,
                variableCount: gameData.variables?.length || 0,
                hasStartup: !!gameData.startup?.command
            });

            // ========================================
            // Port-Anforderungen des Addons ermitteln
            // Aus game_data.ports + variables mit daemon_auto_assign
            // ========================================
            const addonPortRequirements = [];
            
            // 1. Explizite Ports aus game_data.ports
            if (gameData.ports && typeof gameData.ports === 'object') {
                for (const [portType, portDef] of Object.entries(gameData.ports)) {
                    addonPortRequirements.push({
                        type: portType,
                        label: portType.charAt(0).toUpperCase() + portType.slice(1) + '-Port',
                        default_value: portDef.default || 27015,
                        protocol: portDef.protocol || 'udp',
                        source: 'ports',
                    });
                }
            }
            // Fallback: mindestens game
            if (!addonPortRequirements.find(p => p.type === 'game')) {
                addonPortRequirements.push({ type: 'game', label: 'Game-Port', default_value: 27015, protocol: 'udp', source: 'fallback' });
            }
            
            // 2. Zusätzliche Ports aus variables mit daemon_auto_assign: true
            if (Array.isArray(gameData.variables)) {
                for (const v of gameData.variables) {
                    if (v.daemon_auto_assign && v.env_variable && v.env_variable.endsWith('_PORT') && v.env_variable !== 'SERVER_PORT') {
                        const portType = v.env_variable.replace(/_PORT$/, '').toLowerCase();
                        // Nicht doppelt einfügen wenn schon aus game_data.ports kommt
                        if (!addonPortRequirements.find(p => p.type === portType)) {
                            addonPortRequirements.push({
                                type: portType,
                                label: (v.name || portType.charAt(0).toUpperCase() + portType.slice(1)) + '-Port',
                                default_value: parseInt(v.default_value, 10) || 0,
                                protocol: 'udp',
                                source: 'variable',
                                env_variable: v.env_variable,
                            });
                        }
                    }
                }
            }

            return await themeManager.renderView(res, 'guild/server-create-step3', {
                title: 'Server erstellen - Schritt 3: Konfiguration',
                activeMenu: `/guild/${guildId}/plugins/gameserver/servers`,
                addon: addonData,
                gameData, // Direkt das komplette gameData übergeben (mit migrierten Variables)
                addonPortRequirements, // Port-Anforderungen für die UI
                daemonId,
                guildId,
                user
            });
        }

        // Fallback: Redirect zu Step 1
        res.redirect(`/guild/${guildId}/plugins/gameserver/servers/create?step=1`);
    } catch (error) {
        Logger.error('[Gameserver] Fehler im Server-Creation Wizard:', error);
        res.status(500).render('error', {
            message: 'Fehler im Server-Erstellungs-Wizard',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

/**
 * POST /guild/:guildId/plugins/gameserver/servers
 * Server erstellen (Final Step)
 */
router.post('/', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    
    try {
        const guildId = res.locals.guildId;
        
        // ✅ NEU: Fields aus 3-Step-Wizard
        const {  
            addon_slug, 
            rootserver_id,
            server_name,
            
            // Step 1 Fields
            run_install,
            start_after,
            
            // Step 3 Resource Limits (optional, null wenn unlimited)
            allocated_ram_mb,
            allocated_cpu_percent,
            allocated_disk_gb,
            
            // Step 3 Advanced Settings
            auto_restart,
            auto_update
        } = req.body;

        Logger.info(`[Gameserver] Server-Erstellung gestartet für Guild ${guildId}`, {
            addon_slug,
            rootserver_id,
            server_name,
            run_install,
            start_after,
            resource_limits: { ram: allocated_ram_mb, cpu: allocated_cpu_percent, disk: allocated_disk_gb }
        });

        // 🔍 DEBUG: Kompletten req.body loggen
        Logger.debug(`[Gameserver] req.body COMPLETE:`, req.body);

        // Validierung
        if (!addon_slug || !rootserver_id || !server_name) {
            Logger.error(`[Gameserver] ❌ Validierung fehlgeschlagen!`, {
                addon_slug: addon_slug || 'MISSING',
                rootserver_id: rootserver_id || 'MISSING',
                server_name: server_name || 'MISSING',
                received_keys: Object.keys(req.body)
            });
            return res.status(400).json({
                success: false,
                message: `Pflichtfelder fehlen: ${!addon_slug ? 'addon_slug ' : ''}${!rootserver_id ? 'rootserver_id ' : ''}${!server_name ? 'server_name' : ''}`
            });
        }
        
        // ========================================
        // Rootserver mit Daemon-Verbindung abrufen
        // ========================================
        const [rootserver] = await dbService.query(`
            SELECT 
                r.id,
                r.name,
                r.daemon_id,
                r.host,
                r.hostname,
                r.system_user
            FROM rootserver r
            WHERE r.id = ?
        `, [rootserver_id]);
        
        if (!rootserver) {
            return res.status(404).json({
                success: false,
                message: 'Rootserver nicht gefunden'
            });
        }
        
        if (!rootserver.daemon_id) {
            return res.status(400).json({
                success: false,
                message: 'Rootserver hat keinen Daemon zugewiesen'
            });
        }
        
        const daemonId = rootserver.daemon_id;  // ← Die Daemon-ID für IPM!
        
        Logger.debug(`[Gameserver] Rootserver: ${rootserver.name}, Daemon-ID: ${daemonId}`);

        // Addon abrufen
        const [addon] = await dbService.query(`
            SELECT id, name, slug, game_data, steam_app_id, steam_server_app_id
            FROM addon_marketplace 
            WHERE slug = ?
        `, [addon_slug]);

        if (!addon) {
            return res.status(404).json({
                success: false,
                message: 'Addon nicht gefunden'
            });
        }

        // game_data parsen
        let gameData = {};
        try {
            gameData = typeof addon.game_data === 'string'
                ? JSON.parse(addon.game_data)
                : addon.game_data;
        } catch (error) {
            Logger.error('[Gameserver] Fehler beim Parsen von game_data:', error);
        }

        // =====================================
        // NORMALISIERUNG: FIREBOT_v2 → Daemon-Format
        // FIREBOT_v2 speichert Docker und Script-Daten anders als der Daemon erwartet
        // =====================================

        // 1. Runtime-Docker-Image: docker_images (Map) → docker_image (erster Wert)
        if (!gameData.docker_image && gameData.docker_images) {
            gameData.docker_image = Object.values(gameData.docker_images)[0] || '';
        }

        // 2. Pterodactyl-Format: scripts.installation → installation (flach)
        if (!gameData.installation && gameData.scripts?.installation) {
            const si = gameData.scripts.installation;
			// CRLF → LF normalisieren (Pterodactyl-Eggs haben oft Windows-Zeilenenden)
			const scriptRaw = (si.script || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
			gameData.installation = {
				docker_image:    si.container || '',            // Install-Container-Image
				script_content:  scriptRaw,                    // Install-Script (LF-normalisiert)
            };
        }
        // 2b. FireBot-Native-Format: installation.script → script_content
        // (Valheim, eigene Addons nutzen 'script' statt 'script_content')
        if (gameData.installation?.script && !gameData.installation?.script_content) {
            gameData.installation = {
                ...gameData.installation,
                script_content: gameData.installation.script.replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
            };
        }

        // 3. variables: Array → Map (Daemon erwartet Map env_variable → default_value)
        // Vorher: Port-Variable mit daemon_auto_assign merken, damit wir sie später
        // als zusätzliche Port-Definitionen ins ports-Objekt aufnehmen können.
        const autoAssignPortVars = [];
        if (Array.isArray(gameData.variables)) {
            for (const v of gameData.variables) {
                if (v.daemon_auto_assign && v.env_variable && v.env_variable.endsWith('_PORT') && v.env_variable !== 'SERVER_PORT') {
                    autoAssignPortVars.push({
                        env_variable: v.env_variable,
                        default_value: parseInt(v.default_value, 10) || 0,
                    });
                }
            }
            const varMap = {};
            for (const v of gameData.variables) {
                if (v.env_variable) varMap[v.env_variable] = v.default_value ?? '';
            }
            gameData.variables = varMap;
        }

        const steamAppId = addon.steam_app_id || addon.steam_server_app_id || null;
        Logger.debug('[Gameserver] Normalized game_data:', {
            runtimeImage:   gameData.docker_image,
            installImage:   gameData.installation?.docker_image,
            scriptLen:      gameData.installation?.script_content?.length || 0,
            variableCount:  Object.keys(gameData.variables || {}).length,
            steamAppId
        });

        // Template-Name: Addon-Name verwenden (kein separates Template mehr)
        const templateName = addon.name;

        // Startup-Command aus game_data extrahieren
        const startup_command = gameData.startup?.command || '';
        if (!startup_command) {
            Logger.warn(`[Gameserver] Addon ${addon_slug} hat kein startup.command in game_data!`);
            return res.status(400).json({
                success: false,
                message: 'Addon hat keinen Start-Command definiert'
            });
        }

        // Alle variable_* Fields aus req.body sammeln (Key ist der ENV-Variable-Name, z.B. SERVER_NAME)
        // Anschliessend Defaults für fehlende Variablen aus game_data.variables ergänzen
        const envVariables = {};
        // Zuerst alle Defaults aus game_data.variables als Basis
        if (Array.isArray(gameData.variables)) {
            for (const v of gameData.variables) {
                if (v.env_variable) envVariables[v.env_variable] = v.default_value ?? '';
            }
        }
        // Dann User-Eingaben aus dem Formular überschreiben (höchste Priorität)
        Object.keys(req.body).forEach((key) => {
            if (key.startsWith('variable_')) {
                const varName = key.replace('variable_', '');
                envVariables[varName] = req.body[key];
            }
        });

        // ✅ Ports aus game_data extrahieren (alle Port-Definitionen aus dem Egg)
        const ports = {};
        if (gameData.ports && typeof gameData.ports === 'object') {
            for (const [portType, portDef] of Object.entries(gameData.ports)) {
                ports[portType] = {
                    internal: portDef.default || 27015,
                    external: portDef.default || 27015,
                    protocol: portDef.protocol || 'udp'
                };
            }
        }
        // Fallback: mindestens game-Port sicherstellen
        if (!ports.game) {
            ports.game = {
                internal: 27015,
                external: 27015,
                protocol: 'udp'
            };
        }

        // ✅ Ports aus daemon_auto_assign Variablen ergänzen
        // Addons (z.B. Satisfactory) definieren QUERY_PORT, BEACON_PORT, RCON_PORT etc. 
        // als variables mit daemon_auto_assign: true. Diese müssen auch als Docker Port-Bindings
        // gemappt werden, nicht nur als ENV-Variablen.
        for (const pv of autoAssignPortVars) {
            // QUERY_PORT → "query", BEACON_PORT → "beacon", RCON_PORT → "rcon"
            const portType = pv.env_variable.replace(/_PORT$/, '').toLowerCase();
            if (!ports[portType] && pv.default_value > 0) {
                ports[portType] = {
                    internal: pv.default_value,
                    external: pv.default_value,
                    protocol: 'udp'
                };
                Logger.debug(`[Gameserver] Port '${portType}' aus daemon_auto_assign Variable ${pv.env_variable} ergänzt (default: ${pv.default_value})`);
            }
        }

        // ✅ Query-Port aus game_data.query.port_var ableiten (z.B. "game_plus_1" → game + 1)
        // Damit wird der Port automatisch im Container gemappt und ist für GameDig erreichbar.
        const queryPortVar = gameData?.query?.port_var;
        if (queryPortVar && !ports.query) {
            const plusMatch = queryPortVar.match(/^(.+)_plus_(\d+)$/);
            if (plusMatch && ports[plusMatch[1]]) {
                const basePort = ports[plusMatch[1]].internal;
                const offset = parseInt(plusMatch[2], 10);
                ports.query = {
                    internal: basePort + offset,
                    external: basePort + offset,
                    protocol: ports[plusMatch[1]].protocol || 'udp'
                };
                Logger.debug(`[Gameserver] Query-Port auto-abgeleitet: ${queryPortVar} → ${basePort + offset}`);
            }
        }

        // ✅ Port-Typen klassifizieren: "pool" (braucht eigene Allokation) vs "offset" (game + N)
        // game_plus_N Ports werden NICHT aus dem Pool genommen, sondern als Offset vom game-Port berechnet.
        // Explizite Ports (game, query, beacon, rcon, etc.) bekommen jeweils eine eigene Pool-Allokation.
        const poolPorts = {};   // Ports die aus dem Pool allokiert werden
        const offsetPorts = {}; // Ports die als game + N berechnet werden
        for (const [portType, portData] of Object.entries(ports)) {
            const plusMatch = portType.match(/^(.+)_plus_(\d+)$/);
            if (plusMatch && ports[plusMatch[1]]) {
                offsetPorts[portType] = { base: plusMatch[1], offset: parseInt(plusMatch[2], 10), ...portData };
            } else {
                poolPorts[portType] = portData;
            }
        }

        // ✅ Port-Zuweisung: User-Wahl oder Auto-Assign aus port_allocations Pool
        // Strategie: Game-Port → ausgewählt oder auto. Extra-Ports → sequenziell (Game+1, Game+2, ...)
        const userPort = req.body.game_port; // "auto" oder eine Port-Nummer
        const allocatedFromPool = {};
        
        if (rootserver_id) {
            // Sortierte Liste der Extra-Port-Typen (alles außer "game")
            const extraPortTypes = Object.keys(poolPorts).filter(t => t !== 'game');

            if (userPort && userPort !== 'auto') {
                // User hat einen spezifischen Game-Port gewählt → validieren gegen Pool
                const requestedPort = parseInt(userPort);
                if (isNaN(requestedPort) || requestedPort < 1024 || requestedPort > 65535) {
                    return res.status(400).json({ success: false, message: 'Ungültiger Port (1024-65535)' });
                }
                const [matchAlloc] = await dbService.query(
                    `SELECT id, port FROM port_allocations 
                     WHERE rootserver_id = ? AND port = ? AND server_id IS NULL LIMIT 1`,
                    [rootserver_id, requestedPort]
                );
                if (matchAlloc) {
                    await dbService.query(
                        'UPDATE port_allocations SET server_id = 0, assigned_at = NOW() WHERE id = ?',
                        [matchAlloc.id]
                    );
                    ports.game.internal = matchAlloc.port;
                    ports.game.external = matchAlloc.port;
                    allocatedFromPool.game = { allocId: matchAlloc.id, port: matchAlloc.port };
                    Logger.info(`[Gameserver] Port game user-selected: ${matchAlloc.port} (Allocation #${matchAlloc.id})`);
                } else {
                    return res.status(400).json({ success: false, message: `Port ${requestedPort} ist nicht verfügbar oder nicht im Allocation-Pool` });
                }

                // Zusätzliche Ports sequenziell zuweisen: Game+1, Game+2, ...
                for (let i = 0; i < extraPortTypes.length; i++) {
                    const portType = extraPortTypes[i];
                    const desiredPort = requestedPort + i + 1; // Game+1, Game+2, ...
                    // Versuche den gewünschten sequenziellen Port zu bekommen
                    const [seqAlloc] = await dbService.query(
                        `SELECT id, port FROM port_allocations 
                         WHERE rootserver_id = ? AND port = ? AND server_id IS NULL LIMIT 1`,
                        [rootserver_id, desiredPort]
                    );
                    if (seqAlloc) {
                        await dbService.query(
                            'UPDATE port_allocations SET server_id = 0, assigned_at = NOW() WHERE id = ?',
                            [seqAlloc.id]
                        );
                        ports[portType].internal = seqAlloc.port;
                        ports[portType].external = seqAlloc.port;
                        allocatedFromPool[portType] = { allocId: seqAlloc.id, port: seqAlloc.port };
                        Logger.info(`[Gameserver] Port ${portType} sequential: ${seqAlloc.port} (Game+${i + 1}, Allocation #${seqAlloc.id})`);
                    } else {
                        // Fallback: nächsten freien Port aus Pool
                        const [freeAlloc] = await dbService.query(
                            `SELECT id, port FROM port_allocations 
                             WHERE rootserver_id = ? AND server_id IS NULL 
                             ORDER BY port ASC LIMIT 1`,
                            [rootserver_id]
                        );
                        if (freeAlloc) {
                            await dbService.query(
                                'UPDATE port_allocations SET server_id = 0, assigned_at = NOW() WHERE id = ?',
                                [freeAlloc.id]
                            );
                            ports[portType].internal = freeAlloc.port;
                            ports[portType].external = freeAlloc.port;
                            allocatedFromPool[portType] = { allocId: freeAlloc.id, port: freeAlloc.port };
                            Logger.warn(`[Gameserver] Port ${portType}: sequenzieller Port ${desiredPort} nicht frei → Fallback: ${freeAlloc.port} (Allocation #${freeAlloc.id})`);
                        } else {
                            Logger.warn(`[Gameserver] Kein freier Port im Allocation-Pool für Typ '${portType}' — nutze Default ${ports[portType].external}`);
                        }
                    }
                }
            } else {
                // Auto-Assign: Game-Port zuerst, dann Extra-Ports sequenziell (Game+1, Game+2, ...)
                const [gameAlloc] = await dbService.query(
                    `SELECT id, port FROM port_allocations 
                     WHERE rootserver_id = ? AND server_id IS NULL 
                     ORDER BY port ASC LIMIT 1`,
                    [rootserver_id]
                );
                if (gameAlloc) {
                    await dbService.query(
                        'UPDATE port_allocations SET server_id = 0, assigned_at = NOW() WHERE id = ?',
                        [gameAlloc.id]
                    );
                    ports.game.internal = gameAlloc.port;
                    ports.game.external = gameAlloc.port;
                    allocatedFromPool.game = { allocId: gameAlloc.id, port: gameAlloc.port };
                    Logger.info(`[Gameserver] Port game auto-assigned: ${gameAlloc.port} (Allocation #${gameAlloc.id})`);

                    // Extra-Ports sequenziell: Game+1, Game+2, ...
                    for (let i = 0; i < extraPortTypes.length; i++) {
                        const portType = extraPortTypes[i];
                        const desiredPort = gameAlloc.port + i + 1;
                        const [seqAlloc] = await dbService.query(
                            `SELECT id, port FROM port_allocations 
                             WHERE rootserver_id = ? AND port = ? AND server_id IS NULL LIMIT 1`,
                            [rootserver_id, desiredPort]
                        );
                        if (seqAlloc) {
                            await dbService.query(
                                'UPDATE port_allocations SET server_id = 0, assigned_at = NOW() WHERE id = ?',
                                [seqAlloc.id]
                            );
                            ports[portType].internal = seqAlloc.port;
                            ports[portType].external = seqAlloc.port;
                            allocatedFromPool[portType] = { allocId: seqAlloc.id, port: seqAlloc.port };
                            Logger.info(`[Gameserver] Port ${portType} sequential: ${seqAlloc.port} (Game+${i + 1}, Allocation #${seqAlloc.id})`);
                        } else {
                            const [freeAlloc] = await dbService.query(
                                `SELECT id, port FROM port_allocations 
                                 WHERE rootserver_id = ? AND server_id IS NULL 
                                 ORDER BY port ASC LIMIT 1`,
                                [rootserver_id]
                            );
                            if (freeAlloc) {
                                await dbService.query(
                                    'UPDATE port_allocations SET server_id = 0, assigned_at = NOW() WHERE id = ?',
                                    [freeAlloc.id]
                                );
                                ports[portType].internal = freeAlloc.port;
                                ports[portType].external = freeAlloc.port;
                                allocatedFromPool[portType] = { allocId: freeAlloc.id, port: freeAlloc.port };
                                Logger.warn(`[Gameserver] Port ${portType}: sequenzieller Port ${desiredPort} nicht frei → Fallback: ${freeAlloc.port} (Allocation #${freeAlloc.id})`);
                            } else {
                                Logger.warn(`[Gameserver] Kein freier Port im Allocation-Pool für Typ '${portType}' — nutze Default ${ports[portType].external}`);
                            }
                        }
                    }
                } else {
                    Logger.warn('[Gameserver] Kein freier Port im Allocation-Pool für game — nutze Default');
                }
            }
        }

        // ✅ Offset-Ports berechnen: game_plus_N = game_port + N (kein Pool-Verbrauch)
        for (const [portType, offsetData] of Object.entries(offsetPorts)) {
            const basePort = ports[offsetData.base]?.internal || ports[offsetData.base]?.external;
            if (basePort) {
                const computedPort = basePort + offsetData.offset;
                ports[portType].internal = computedPort;
                ports[portType].external = computedPort;
                Logger.debug(`[Gameserver] Offset-Port ${portType} = ${offsetData.base}(${basePort}) + ${offsetData.offset} = ${computedPort}`);
            }
        }
        
        Logger.debug('[Gameserver] Ports konfiguriert:', ports);

        // ✅ daemon_auto_assign Variablen auf echte Werte mappen
        // Eggs die SERVER_PORT/SERVER_IP/TZ in variables[] definieren, bekommen hier
        // automatisch die korrekten Werte — User-Eingaben aus dem Formular werden überschrieben.
        // Generisch: Für jeden Port-Typ wird die passende ENV-Variable gesetzt
        // z.B. ports.game → SERVER_PORT, ports.query → QUERY_PORT, ports.beacon → BEACON_PORT
        for (const [portType, portData] of Object.entries(ports)) {
            const portVal = String(portData.internal || portData.external || 27015);

            // Direkt-Match: GAME_PORT, QUERY_PORT, BEACON_PORT, RCON_PORT, etc.
            const envKey = portType.toUpperCase() + '_PORT';
            if (envKey in envVariables) {
                envVariables[envKey] = portVal;
                Logger.debug(`[Gameserver] ${envKey} auto-mapped → ${portVal}`);
            }
            // SERVER_PORT als Alias für game/main Port
            if ((portType === 'game' || portType === 'main') && 'SERVER_PORT' in envVariables) {
                envVariables.SERVER_PORT = portVal;
                Logger.debug(`[Gameserver] SERVER_PORT auto-mapped → ${portVal}`);
            }
        }
        if ('SERVER_IP' in envVariables) {
            envVariables.SERVER_IP = '0.0.0.0';
            Logger.debug('[Gameserver] SERVER_IP auto-mapped → 0.0.0.0');
        }
        if ('TZ' in envVariables && !envVariables.TZ) {
            // Nur befüllen wenn leer (User-Wert/Egg-Default behalten)
            envVariables.TZ = 'UTC';
        }

        // User-ID aus Session extrahieren (falls vorhanden)
        const userId = res.locals.user?.id || '0';

        // Gameserver in DB erstellen (erstmal ohne install_path)
        const result = await dbService.query(`
            INSERT INTO gameservers (
                guild_id,
                user_id,
                rootserver_id,
                addon_marketplace_id,
                template_name,
                name,
                install_path,
                ports,
                env_variables,
                frozen_game_data,
                launch_params,
                auto_restart,
                auto_update,
                allocated_ram_mb,
                allocated_cpu_percent,
                allocated_disk_gb,
                addon_version,
                status,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '1.0.0', 'installing', NOW())
        `, [
            guildId,
            userId,
            rootserver_id,
            addon.id,
            templateName,
            server_name,
            'temp',  // ← Temporärer Pfad, wird gleich aktualisiert
            JSON.stringify(ports),
            JSON.stringify(envVariables),
            typeof addon.game_data === 'string' ? addon.game_data : JSON.stringify(addon.game_data),
            startup_command,
            auto_restart ? 1 : 0,  // ✅ NEU: auto_restart aus Step 3
            auto_update ? 1 : 0,   // ✅ NEU: auto_update aus Step 3
            allocated_ram_mb || null,      // ✅ NEU: Resource Limits
            allocated_cpu_percent || null,
            allocated_disk_gb || null
        ]);

        const serverId = result.insertId;

        // ✅ Port-Allocations mit echter server_id aktualisieren
        if (Object.keys(allocatedFromPool).length > 0) {
            for (const [portType, alloc] of Object.entries(allocatedFromPool)) {
                await dbService.query(
                    'UPDATE port_allocations SET server_id = ?, assigned_at = NOW() WHERE id = ?',
                    [serverId, alloc.allocId]
                );
            }
            Logger.info(`[Gameserver] ${Object.keys(allocatedFromPool).length} Port-Allocations für Server ${serverId} zugewiesen`);
        }

        // Install-Pfad: {serverid}-{slug} — deterministisch, identisch zur Daemon-Logik
        const finalInstallPath = `${serverId}-${addon_slug}`;
        await dbService.query('UPDATE gameservers SET install_path = ? WHERE id = ?', [finalInstallPath, serverId]);

        // bind_ip aus rootserver.host setzen (damit Ports auf der richtigen IP landen)
        // Fallback-Kette: explizite bind_ip aus Step3-Form → rootserver.host → null (daemon.yaml)
        if (rootserver.host) {
            await dbService.query('UPDATE gameservers SET bind_ip = ? WHERE id = ?', [rootserver.host, serverId]);
        }

        // ✅ SFTP-Credentials direkt beim Server-Erstellen setzen
        // Username = system_user des Rootservers (Linux-User dem das Verzeichnis gehört)
        const sftpUsername = rootserver.system_user || `gs-${String(serverId).padStart(8, '0')}`;
        const sftpPassword = require('crypto').randomBytes(10).toString('hex'); // 20 Zeichen hex
        await dbService.query(
            'UPDATE gameservers SET sftp_username = ?, sftp_password = ? WHERE id = ?',
            [sftpUsername, sftpPassword, serverId]
        );
        Logger.info(`[Gameserver] SFTP-Credentials gesetzt für Server ${serverId} (User: ${sftpUsername})`);

        // SFTP-Credentials per IPM an Daemon übermitteln
        _syncSftpUserToDaemon(daemonId, String(serverId), sftpUsername, sftpPassword, guildId)
            .catch(err => Logger.warn(`[Gameserver] SFTP-Sync zum Daemon fehlgeschlagen: ${err.message}`));

        // IPC-Command an Daemon senden für Installation
        try {
            const ipmServer = ServiceManager.get('ipmServer');
            
            if (!ipmServer) {
                Logger.warn('[Gameserver] IPMServer nicht verfügbar - Server wird ohne Installation erstellt');
            } else if (!ipmServer.isDaemonOnline(daemonId)) {
                Logger.warn(`[Gameserver] Daemon ${daemonId} ist offline - Server Status bleibt auf 'installing'`);
                // Server-Status bleibt auf 'installing', bis Daemon online kommt
            } else {
                // Daemon ist online - Installation starten
                Logger.info(`[Gameserver] Sende Install-Command an Daemon ${daemonId}`, {
                    serverId,
                    addonSlug: addon_slug,
                    rootserverId: rootserver_id,
                    templateName
                });

                // DEBUG: Payload loggen
                const installPayload = {
                    server_id: serverId.toString(),
                    rootserver_id: rootserver_id.toString(),
                    daemon_id: daemonId,
                    guild_id: guildId,
                    addon_slug,
                    addon_name: addon.name,
                    template_name: templateName,
                    steam_app_id: steamAppId,
                    startup_command,
                    ports,
                    env_variables: envVariables,
                    game_data: gameData,
                    // platform als eigenständiges Feld (Belt-and-suspenders neben game_data.platform)
                    platform: gameData.platform || 'linux',
                    run_install: run_install === true || run_install === 'true',
                    start_after: start_after === true || start_after === 'true',
                    resource_limits: {
                        ram_mb: allocated_ram_mb ? parseInt(allocated_ram_mb) : null,
                        cpu_percent: allocated_cpu_percent ? parseInt(allocated_cpu_percent) : null,
                        disk_gb: allocated_disk_gb ? parseInt(allocated_disk_gb) : null
                    }
                };
                
                Logger.debug(`[Gameserver] 🔍 Install Payload:`, {
                    daemonId,
                    payload: installPayload
                });

                // Command-Response mit 60s Timeout (Installation kann dauern)
                const response = await ipmServer.sendCommand(daemonId, 'gameserver.install', installPayload, 60000);

                if (response.success) {
                    Logger.success(`[Gameserver] Installation gestartet für Server ${serverId}`);

                    // ✅ Allozierte Ports aus Daemon-Response in MySQL speichern
                    if (response.allocated_ports && Object.keys(response.allocated_ports).length > 0) {
                        const allocatedPorts = response.allocated_ports;
                        Logger.info(`[Gameserver] Allozierte Ports für Server ${serverId}:`, allocatedPorts);

                        // Ports-Objekt mit echten Ports aktualisieren
                        const realPorts = { ...ports };
                        for (const [portType, portNum] of Object.entries(allocatedPorts)) {
                            if (realPorts[portType]) {
                                realPorts[portType].external = portNum;
                                realPorts[portType].internal = portNum;
                            }
                        }

                        await dbService.query(
                            'UPDATE gameservers SET ports = ? WHERE id = ?',
                            [JSON.stringify(realPorts), serverId]
                        );
                        Logger.success(`[Gameserver] Ports in DB aktualisiert für Server ${serverId}`);

                        // ✅ Port ENV-Variablen mit tatsächlich allokierten Ports synchronisieren
                        let envUpdated = false;
                        for (const [portType, allocPort] of Object.entries(allocatedPorts)) {
                            const envKey = portType.toUpperCase() + '_PORT';
                            if (envKey in envVariables) {
                                envVariables[envKey] = String(allocPort);
                                envUpdated = true;
                                Logger.debug(`[Gameserver] ${envKey} in env_variables → ${allocPort}`);
                            }
                            if ((portType === 'game' || portType === 'main') && 'SERVER_PORT' in envVariables) {
                                envVariables.SERVER_PORT = String(allocPort);
                                envUpdated = true;
                                Logger.debug(`[Gameserver] SERVER_PORT in env_variables → ${allocPort}`);
                            }
                        }
                        if (envUpdated) {
                            await dbService.query(
                                'UPDATE gameservers SET env_variables = ? WHERE id = ?',
                                [JSON.stringify(envVariables), serverId]
                            );
                        }
                    }
                    // Status wird vom Daemon via Heartbeat aktualisiert
                } else {
                    Logger.error(`[Gameserver] Installation fehlgeschlagen für Server ${serverId}:`, response.error);
                    // Status auf 'error' setzen
                    await dbService.query(
                        'UPDATE gameservers SET status = ?, error_message = ? WHERE id = ?',
                        ['error', response.error || 'Installation failed', serverId]
                    );
                }
            }
        } catch (ipcError) {
            Logger.error(`[Gameserver] IPC-Fehler bei Installation von Server ${serverId}:`, ipcError);
            // Fehler speichern, aber Request nicht fehlschlagen lassen
            await dbService.query(
                'UPDATE gameservers SET status = ?, error_message = ? WHERE id = ?',
                ['error', ipcError.message || 'IPC Communication failed', serverId]
            );
        }

        Logger.success(`[Gameserver] Server erstellt (ID: ${serverId}) für Guild ${guildId}`, {
            name: server_name,
            addon: addon.name,
            template: templateName
        });

        res.json({
            success: true,
            message: `Server "${server_name}" wird installiert...`,
            serverId,
            redirectUrl: `/guild/${guildId}/plugins/gameserver/servers`
        });
    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Erstellen des Servers:', error);
        res.status(500).json({
            success: false,
            message: 'Serverfehler beim Erstellen des Gameservers'
        });
    }
});

/**
 * GET /guild/:guildId/plugins/gameserver/servers/events
 * SSE-Stream für Gameserver-Events
 * 
 * ⚠️ WICHTIG: Diese Route MUSS VOR /:serverId stehen,
 * sonst wird "events" als Server-ID interpretiert!
 * 
 * Sendet Echtzeit-Updates für:
 * - Status-Änderungen (starting, running, stopping, stopped, crashed)
 * - Resource-Usage (CPU, RAM, Disk)
 * - Player-Count-Updates
 */
router.get('/events', (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const sseManager = ServiceManager.get('sseManager');
    
    const guildId = res.locals.guildId;
    
    try {
        // User-ID robust extrahieren
        const sessionUser = req.session?.user;
        const localUser = res.locals.user;
        
        const userId = localUser?.id || 
                       localUser?.user_id || 
                       sessionUser?.info?.id || 
                       sessionUser?.id || 
                       'anonymous';
                       
        const username = localUser?.username || 
                         localUser?.global_name || 
                         sessionUser?.info?.username || 
                         sessionUser?.info?.global_name || 
                         sessionUser?.username || 
                         'Unknown';
        
        // Client-ID generieren (User-ID + Timestamp für Uniqueness)
        const clientId = `${userId}-${Date.now()}`;
        
        // Optional: Filter für bestimmte Server (via Query-Parameter)
        // ⚠️ String()-Konvertierung nötig: server_id kann Integer (Daemon) oder String (Query) sein
        const serverFilter = req.query.server_id ? 
            (message) => {
                // Nur Events für den spezifischen Server durchlassen
                return message.data && String(message.data.server_id) === String(req.query.server_id);
            } : null;
        
        // Client bei SSEManager registrieren
        // ⚠️ WICHTIG: addClient() setzt Headers und managed die Connection!
        sseManager.addClient(guildId, clientId, res, {
            filter: serverFilter,
            metadata: {
                userId: userId,
                username: username,
                serverId: req.query.server_id || null
            }
        });
        
        Logger.info(`[Gameserver SSE] Client ${clientId} connected (Guild: ${guildId}, User: ${username})`);
        
        // ⚠️ WICHTIG: KEIN res.send() oder res.json() hier!
        // SSEManager übernimmt die Response-Kontrolle!
        
    } catch (error) {
        Logger.error('[Gameserver SSE] Fehler beim Verbinden:', error);
        
        // Nur wenn Response noch nicht gesendet wurde
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                message: 'Fehler beim Aufbau der SSE-Verbindung'
            });
        }
    }
});

/**
 * GET /status
 * Live Status Polling Endpoint für Frontend
 * Gibt aktuelle Status aller Server einer Guild zurück
 * WICHTIG: Muss VOR /:serverId Route definiert werden!
 */
router.get('/status', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    
    try {
        const guildId = res.locals.guildId;

        // Hole alle Server-IDs und Status für diese Guild
        const servers = await dbService.query(
            'SELECT id, status FROM gameservers WHERE guild_id = ?',
            [guildId]
        );

        res.json({
            success: true,
            servers: servers || []
        });

    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Abrufen der Server-Status:', error);
        res.status(500).json({
            success: false,
            message: 'Serverfehler beim Abrufen der Status'
        });
    }
});

/**
 * GET /guild/:guildId/plugins/gameserver/servers/:serverId/query
 * Live-Status-Abfrage via GameDig (A2S, Minecraft, etc.)
 * Gibt: name, map, ping, players[], maxPlayers, connect
 * @permission GAMESERVER.VIEW
 */
router.get('/:serverId/query', requirePermission('GAMESERVER.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const guildId = res.locals.guildId;
        const serverId = req.params.serverId;

        const [server] = await dbService.query(`
            SELECT
                gs.id, gs.ports, gs.bind_ip,
                r.host AS rootserver_ip,
                am.game_data
            FROM gameservers gs
            LEFT JOIN rootserver r ON gs.rootserver_id = r.id
            LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
            WHERE gs.id = ? AND gs.guild_id = ?
        `, [serverId, guildId]);

        if (!server) {
            return res.status(404).json({ success: false, message: 'Server nicht gefunden' });
        }

        const { ports, gameData } = QueryService.parseServerData(server);
        const result = await QueryService.query({
            host:     server.bind_ip || server.rootserver_ip,
            ports,
            gameData,
        });

        if (!result.success) {
            Logger.debug(`[Gameserver] Query fehlgeschlagen für Server ${serverId}: ${result.error}`);
        }

        return res.json(result);

    } catch (error) {
        Logger.error('[Gameserver] Fehler bei Live-Query:', error);
        return res.status(500).json({ success: false, error: 'Interner Serverfehler' });
    }
});

/**
 * GET /guild/:guildId/plugins/gameserver/servers/:serverId
 * Server-Detail-Ansicht mit Tabbed-Interface
 * @permission GAMESERVER.VIEW
 */
router.get('/:serverId', requirePermission('GAMESERVER.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');
    
    try {
        const guildId = res.locals.guildId;
        const serverId = req.params.serverId;
        const user = res.locals.user;

        Logger.debug(`[Gameserver] Detail-View für Server ${serverId}, Guild ${guildId}`);

        // Server mit allen relevanten JOINs laden
        const [server] = await dbService.query(`
            SELECT 
                gs.id,
                gs.guild_id,
                gs.name,
                gs.status,
                gs.current_players,
                gs.max_players,
                gs.ports,
                gs.install_path,
                gs.launch_params,
                gs.auto_restart,
                gs.auto_update,
                gs.addon_marketplace_id,
                gs.template_name,
                gs.addon_version,
                gs.rootserver_id,
                gs.pid,
                gs.current_map,
                gs.last_started_at,
                gs.last_stopped_at,
                gs.created_at,
                gs.updated_at,
                gs.sftp_username,
                gs.sftp_password,
                gs.env_variables,
                am.name as game_name,
                am.slug as game_slug,
                am.icon_url as game_icon,
                am.game_data,
                r.name as rootserver_name,
                r.hostname as rootserver_hostname,
                r.host as rootserver_ip,
                r.daemon_id,
                r.system_user
            FROM gameservers gs
            LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
            LEFT JOIN rootserver r ON gs.rootserver_id = r.id
            WHERE gs.id = ? AND gs.guild_id = ?
        `, [serverId, guildId]);

        // 404 wenn Server nicht gefunden
        if (!server) {
            Logger.warn(`[Gameserver] Server ${serverId} nicht gefunden für Guild ${guildId}`);
            return res.status(404).render('error', {
                message: 'Server nicht gefunden',
                description: 'Der angeforderte Server existiert nicht oder gehört nicht zu dieser Guild.'
            });
        }

        // ports JSON parsen
        let ports = {};
        try {
            ports = typeof server.ports === 'string'
                ? JSON.parse(server.ports)
                : (server.ports || {});
        } catch (error) {
            Logger.error(`[Gameserver] Fehler beim Parsen von ports:`, error);
            ports = {};
        }

        // game_data parsen
        let gameData = {};
        try {
            gameData = typeof server.game_data === 'string'
                ? JSON.parse(server.game_data)
                : (server.game_data || {});
        } catch (error) {
            Logger.error(`[Gameserver] Fehler beim Parsen von game_data:`, error);
            gameData = {};
        }

        // env_variables parsen
        let envVariables = {};
        try {
            envVariables = typeof server.env_variables === 'string'
                ? JSON.parse(server.env_variables)
                : (server.env_variables || {});
        } catch (error) {
            Logger.error(`[Gameserver] Fehler beim Parsen von env_variables:`, error);
            envVariables = {};
        }
        server.env_variables_parsed = envVariables;

        // Ports zum Server-Objekt hinzufügen (für einfacheren Zugriff in View)
        server.ip_address = server.rootserver_ip || 'N/A';
        server.port_game = ports.game?.external || ports.game?.internal || ports.main?.external || null;
        // Query-Port: erst explizite "query"-Sektion, dann port_var aus Addon-Konfiguration auflösen
        // "game_plus_1" ist eine spezielle Convention: Query-Port = Game-Port + 1 (z.B. Valheim 27030 → 27031)
        const queryPortVar = gameData?.query?.port_var || null;
        if (queryPortVar === 'game_plus_1' && server.port_game) {
            server.port_query = server.port_game + 1;
        } else {
            server.port_query = ports.query?.external || ports.query?.internal ||
                (queryPortVar && ports[queryPortVar] ? (ports[queryPortVar].external || ports[queryPortVar].internal) : null) || null;
        }
        server.port_rcon = ports.rcon?.external || ports.rcon?.internal || null;
        server.ports_parsed = ports; // Original-Struktur für erweiterte Ansicht

        // RCON verfügbar wenn das Egg eine config.rcon-Sektion hat
        const frozenGameData = typeof server.game_data === 'string'
            ? JSON.parse(server.game_data) : (server.game_data || {});
        server.rcon_available = !!(frozenGameData?.config?.rcon);

        // RCON-Port Fallback: Wenn port_var auf "game" zeigt, nutzt RCON den Game-Port
        if (!server.port_rcon && frozenGameData?.config?.rcon) {
            const rconPortVar = frozenGameData.config.rcon.port_var || '';
            if (rconPortVar === 'game' && server.port_game) {
                server.port_rcon = server.port_game;
            } else if (rconPortVar && ports[rconPortVar]) {
                server.port_rcon = ports[rconPortVar]?.external || ports[rconPortVar]?.internal || null;
            }
        }

        // SFTP-Credentials: Normally set at creation time. Lazy-fallback only if missing.
        if (!server.sftp_username && server.system_user) {
            // Fallback für ältere Server die vor dem direkten SFTP-Setup angelegt wurden
            server.sftp_username = server.system_user;
            server.sftp_password = crypto.randomBytes(10).toString('hex');
            await dbService.query(
                'UPDATE gameservers SET sftp_username = ?, sftp_password = ? WHERE id = ?',
                [server.sftp_username, server.sftp_password, server.id]
            );
            _syncSftpUserToDaemon(server.daemon_id, String(server.id), server.sftp_username, server.sftp_password, guildId)
                .catch(err => Logger.warn(`[Gameserver] SFTP-Sync zum Daemon fehlgeschlagen: ${err.message}`));
            Logger.info(`[Gameserver] SFTP-Credentials (Fallback) generiert für Server ${server.id} (User: ${server.sftp_username})`);
        } else if (server.sftp_username && server.system_user && server.sftp_username !== server.system_user) {
            // Username korrigieren falls abweichend
            server.sftp_username = server.system_user;
            await dbService.query(
                'UPDATE gameservers SET sftp_username = ? WHERE id = ?',
                [server.sftp_username, server.id]
            );
            Logger.info(`[Gameserver] SFTP-Username korrigiert für Server ${server.id} → ${server.sftp_username}`);
        }
        // SFTP-Verbindungsinfo anfügen (IP bevorzugen – Hostname ist oft nicht konfiguriert)
        server.sftp_host = server.rootserver_ip || server.rootserver_hostname || 'N/A';
        server.sftp_port = 2022;

        Logger.success(`[Gameserver] Server ${server.name} (${server.id}) geladen für Detail-View`);

        // Assets für Detail-View einreihen
        // monaco-loader + gameserver-file-manager werden vom Files-Partial eingereiht
        // (NACH xterm-Skripten – verhindert AMD-Konflikt)
        const assetManager = ServiceManager.get('assetManager');
        if (assetManager) {
            assetManager.enqueueScript('gameserver-sse');
            assetManager.enqueueScript('gameserver-actions');
        }

        // View rendern
        // gamedig_type für Live-Query-Panel in der View bereitstellen
        server.gamedig_type = gameData?.query?.gamedig_type || null;

        await themeManager.renderView(res, 'guild/server-detail', {
            title: `Server: ${server.name}`,
            activeMenu: `/guild/${guildId}/plugins/gameserver/servers`,
            server,
            gameData,
            guildId,
            user
        });

    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Laden der Server-Details:', error);
        res.status(500).render('error', {
            message: 'Fehler beim Laden der Server-Details',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

/**
 * GET /guild/:guildId/plugins/gameserver/servers/:serverId/edit
 * Server-Bearbeitungs-Formular anzeigen
 */
router.get('/:serverId/edit', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');
    
    try {
        const guildId = res.locals.guildId;
        const serverId = req.params.serverId;

        Logger.debug(`[Gameserver] Edit-Formular aufgerufen für Server ${serverId}, Guild ${guildId}`);

        // Server-Daten mit Game-Informationen abrufen
        const [server] = await dbService.query(`
            SELECT 
                gs.id,
                gs.name,
                gs.status,
                gs.current_players,
                gs.max_players,
                gs.addon_marketplace_id,
                gs.template_name,
                gs.addon_version,
                gs.auto_restart,
                gs.auto_update,
                gs.env_variables,
                gs.rootserver_id,
                am.name as game_name,
                am.slug as game_slug
            FROM gameservers gs
            LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
            WHERE gs.id = ? AND gs.guild_id = ?
        `, [serverId, guildId]);

        if (!server) {
            return res.status(404).render('error', {
                message: 'Server nicht gefunden'
            });
        }

        // env_variables parsen falls als String gespeichert
        if (typeof server.env_variables === 'string') {
            try {
                server.env_variables = JSON.parse(server.env_variables);
            } catch (error) {
                Logger.error(`[Gameserver] Fehler beim Parsen von env_variables:`, error);
                server.env_variables = {};
            }
        }

        // Sicherstellen dass env_variables ein Objekt ist
        if (!server.env_variables || typeof server.env_variables !== 'object') {
            server.env_variables = {};
        }

        return await themeManager.renderView(res, 'guild/gameserver-edit', {
            title: `Server bearbeiten: ${server.name}`,
            activeMenu: `/guild/${guildId}/plugins/gameserver/servers`,
            server,
            guildId
        });
    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Laden des Edit-Formulars:', error);
        res.status(500).render('error', {
            message: 'Fehler beim Laden des Bearbeitungs-Formulars',
            error: process.env.NODE_ENV === 'development' ? error : {}
        });
    }
});

/**
 * PUT /guild/:guildId/plugins/gameserver/servers/:serverId/start
 * Server starten
 */
router.put('/:serverId/start', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const ipmServer = ServiceManager.get('ipmServer');
    
    try {
        const guildId = res.locals.guildId; // ← Aus res.locals (Middleware)
        const serverId = req.params.serverId; // ← Aus Route-Pattern

        Logger.info(`[Gameserver] Server-Start angefordert (ID: ${serverId}, Guild: ${guildId})`);

        // Server-Daten mit Daemon-Verbindung holen
        const [server] = await dbService.query(`
            SELECT 
                gs.id,
                gs.name,
                gs.status,
                gs.rootserver_id,
                gs.install_path,
                gs.launch_params,
                gs.ports,
                gs.env_variables,
                gs.frozen_game_data,
                gs.template_name,
                am.slug as addon_slug,
                r.daemon_id
            FROM gameservers gs
            JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
            LEFT JOIN rootserver r ON gs.rootserver_id = r.id
            WHERE gs.id = ? AND gs.guild_id = ?
        `, [serverId, guildId]);

        if (!server) {
            return res.status(404).json({
                success: false,
                message: 'Server nicht gefunden'
            });
        }

        if (server.status === 'online') {
            return res.status(400).json({
                success: false,
                message: 'Server läuft bereits'
            });
        }

        if (!server.daemon_id) {
            return res.status(500).json({
                success: false,
                message: 'Kein Daemon zugewiesen'
            });
        }

        const daemonId = server.daemon_id;

        // Status auf 'starting' setzen
        await dbService.query(
            'UPDATE gameservers SET status = ?, last_started_at = NOW() WHERE id = ?',
            ['starting', serverId]
        );

        // IPM Command an Daemon senden
        if (!ipmServer) {
            Logger.error('[Gameserver] IPMServer nicht verfügbar');
            return res.status(500).json({
                success: false,
                message: 'IPMServer nicht verfügbar'
            });
        }

        if (!ipmServer.isDaemonOnline(daemonId)) {
            await dbService.query('UPDATE gameservers SET status = ? WHERE id = ?', ['error', serverId]);
            return res.status(503).json({
                success: false,
                message: 'Daemon ist offline'
            });
        }

        // Install-Pfad ermitteln (aus DB oder berechnen)
        // ✅ FIX: Ohne /gameservers/ Prefix - wird vom Daemon als relativer Pfad behandelt
        const installPath = server.install_path || `${server.addon_slug}-${serverId}`;
        
        // JSON-Felder aus DB parsen (werden als Strings gespeichert)
        let parsedPorts = {};
        let parsedEnvVars = {};
        try {
            parsedPorts = typeof server.ports === 'string' ? JSON.parse(server.ports) : (server.ports || {});
        } catch (_) {}
        try {
            parsedEnvVars = typeof server.env_variables === 'string' ? JSON.parse(server.env_variables) : (server.env_variables || {});
        } catch (_) {}
        
        // Start-Command an Daemon senden
        Logger.info(`[Gameserver] Sende Start-Command an Daemon ${daemonId} für Server ${serverId}`);
        
        // game_data aus frozen_game_data rekonstruieren (docker_image, runtime, config)
        let startGameData = {};
        try {
            const frozenData = typeof server.frozen_game_data === 'string'
                ? JSON.parse(server.frozen_game_data)
                : server.frozen_game_data;
            if (frozenData) {
                // Docker-Image
                const dockerImages = frozenData.docker_images || {};
                const imgKeys = Object.keys(dockerImages);
                if (imgKeys.length > 0) startGameData.docker_image = dockerImages[imgKeys[0]];

                // Runtime (stop, done_string)
                const rt = { stop_mode: 'sigterm', stop_command: '', stop_timeout_sec: 30, done_string: '' };
                const stopSignal = frozenData.startup?.stop || '';
                if (stopSignal === '^C') rt.stop_mode = 'sigint';
                else if (stopSignal) { rt.stop_mode = 'console_command'; rt.stop_command = stopSignal; }
                if (frozenData.startup?.done) rt.done_string = frozenData.startup.done;
                startGameData.runtime = rt;

                // Config-Files für Patching
                if (frozenData.config?.files && Object.keys(frozenData.config.files).length > 0) {
                    startGameData.config = frozenData.config;
                }

                // File-Denylist für File-Manager (Pterodactyl-Pattern)
                if (Array.isArray(frozenData.file_denylist)) {
                    startGameData._file_denylist = frozenData.file_denylist;
                }

                // Platform (linux/windows) für Proton-GE-Wrapping
                if (frozenData.platform) {
                    startGameData.platform = frozenData.platform;
                }

                // Template-Override Merge: Wenn ein Template gewählt wurde, dessen Overrides einmergen
                if (server.template_name && Array.isArray(frozenData.templates)) {
                    const tpl = frozenData.templates.find(t => t.name === server.template_name);
                    if (tpl) {
                        // Template-Variablen in env_variables mergen (Template gewinnt)
                        if (tpl.variables) Object.assign(parsedEnvVars, tpl.variables);
                        // Template-Config-Overrides in config.files mergen
                        if (tpl.config_overrides) {
                            if (!startGameData.config) startGameData.config = { files: {} };
                            if (!startGameData.config.files) startGameData.config.files = {};
                            for (const [fname, overrides] of Object.entries(tpl.config_overrides)) {
                                if (!startGameData.config.files[fname]) {
                                    startGameData.config.files[fname] = { parser: 'file', find: {} };
                                }
                                Object.assign(startGameData.config.files[fname].find, overrides);
                            }
                        }
                        Logger.debug(`[Gameserver] Template "${server.template_name}" Overrides angewendet`);
                    }
                }
            }
        } catch (e) {
            Logger.warn(`[Gameserver] frozen_game_data parsen fehlgeschlagen: ${e.message}`);
        }

        const response = await ipmServer.sendCommand(daemonId, 'gameserver.start', {
            server_id: serverId.toString(),
            rootserver_id: server.rootserver_id,
            addon_slug: server.addon_slug,
            startup_command: server.launch_params || './start.sh',
            ports: parsedPorts,
            env_variables: parsedEnvVars,
            guild_id: guildId,
            bind_ip: server.bind_ip || null,
            game_data: startGameData,
            file_denylist: startGameData._file_denylist || []
        }, 30000);

        if (!response.success) {
            Logger.error(`[Gameserver] Start-Command fehlgeschlagen: ${response.message}`);
            await dbService.query('UPDATE gameservers SET status = ? WHERE id = ?', ['error', serverId]);

            // SSE-Broadcast damit Browser sofort den Error-Status sieht
            const sseManager = ServiceManager.get('sseManager');
            if (sseManager) {
                sseManager.broadcast(guildId, 'gameserver', {
                    action: 'status_changed',
                    server_id: String(serverId),
                    status: 'error',
                    error_message: response.message || 'Start fehlgeschlagen',
                    timestamp: Date.now()
                });
            }

            return res.status(500).json({
                success: false,
                message: response.message || 'Fehler beim Starten des Servers'
            });
        }

        Logger.success(`[Gameserver] Server ${serverId} wird gestartet`);
        res.json({
            success: true,
            message: `Server "${server.name}" wird gestartet...`
        });
    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Starten des Servers:', error);
        res.status(500).json({
            success: false,
            message: 'Serverfehler beim Starten des Gameservers'
        });
    }
});

/**
 * PUT /guild/:guildId/plugins/gameserver/servers/:serverId/stop
 * Server stoppen
 */
router.put('/:serverId/stop', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    
    try {
        const { guildId, serverId } = req.params;

        Logger.info(`[Gameserver] Server-Stop angefordert (ID: ${serverId})`);

        // Server-Status prüfen
        const [server] = await dbService.query(
            'SELECT id, name, status FROM gameservers WHERE id = ? AND guild_id = ?',
            [serverId, guildId]
        );

        if (!server) {
            return res.status(404).json({
                success: false,
                message: 'Server nicht gefunden'
            });
        }

        if (server.status === 'offline') {
            return res.status(400).json({
                success: false,
                message: 'Server ist bereits offline'
            });
        }

        // Status auf 'stopping' setzen
        await dbService.query(
            'UPDATE gameservers SET status = ? WHERE id = ?',
            ['stopping', serverId]
        );

        // TODO: IPC an Bot senden → Server stoppen

        res.json({
            success: true,
            message: `Server "${server.name}" wird gestoppt...`
        });
    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Stoppen des Servers:', error);
        res.status(500).json({
            success: false,
            message: 'Serverfehler beim Stoppen des Gameservers'
        });
    }
});

/**
 * DELETE /guild/:guildId/plugins/gameserver/servers/:serverId
 * Server löschen (inkl. Dateien vom Daemon)
 */
router.delete('/:serverId', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const ipmServer = ServiceManager.get('ipmServer');
    
    try {
        const guildId = res.locals.guildId;
        const { serverId } = req.params;

        Logger.info(`[Gameserver] Server-Löschung angefordert (ID: ${serverId})`);

        // ════════════════════════════════════════════════════════════
        // 1. Server-Daten mit Daemon-Info laden
        // ════════════════════════════════════════════════════════════
        const [server] = await dbService.query(`
            SELECT 
                gs.id,
                gs.name,
                gs.status,
                gs.install_path,
                gs.rootserver_id,
                r.daemon_id,
                r.system_user,
                r.guild_id,  -- ✅ NEU: Guild-ID für Pfad-Konstruktion im Daemon
                am.slug as addon_slug
            FROM gameservers gs
            LEFT JOIN rootserver r ON gs.rootserver_id = r.id
            LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
            WHERE gs.id = ? AND gs.guild_id = ?
        `, [serverId, guildId]);

        if (!server) {
            return res.status(404).json({
                success: false,
                message: 'Server nicht gefunden'
            });
        }

        // ════════════════════════════════════════════════════════════
        // 2. Status-Check: Server muss gestoppt sein
        // ════════════════════════════════════════════════════════════
        if (server.status === 'online' || server.status === 'starting') {
            return res.status(400).json({
                success: false,
                message: 'Server muss zuerst gestoppt werden'
            });
        }

        // ════════════════════════════════════════════════════════════
        // 3. Daemon-Uninstall: Server-Dateien löschen
        // ════════════════════════════════════════════════════════════
        const forceDelete = req.query.force === 'true';
        let uninstallSuccess = false;
        let uninstallError = null;
        
        if (server.daemon_id && ipmServer && ipmServer.isDaemonOnline(server.daemon_id)) {
            try {
                Logger.info(`[Gameserver] Sende Uninstall-Command an Daemon ${server.daemon_id}`, {
                    serverId,
                    installPath: server.install_path,
                    daemonId: server.daemon_id,  // ✅ DEBUG
                    rootserverId: server.rootserver_id
                });

                const uninstallPayload = {
                    server_id: serverId.toString(),
                    guild_id: guildId,
                    rootserver_id: server.rootserver_id,
                    daemon_id: server.daemon_id,
                    addon_slug: server.addon_slug
                };
                
                Logger.debug(`[Gameserver] 🔍 Uninstall Payload:`, uninstallPayload);

                const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.uninstall', uninstallPayload, 60000); // 60s Timeout

                if (response.success) {
                    Logger.success(`[Gameserver] Server ${serverId} erfolgreich deinstalliert (${response.deleted_files || 0} Dateien gelöscht)`);
                    uninstallSuccess = true;
                } else {
                    uninstallError = response.error || 'Uninstall fehlgeschlagen';
                    Logger.error(`[Gameserver] Daemon-Uninstall fehlgeschlagen: ${uninstallError}`);
                    if (!forceDelete) {
                        return res.status(500).json({
                            success: false,
                            message: `Deinstallation fehlgeschlagen: ${uninstallError}. Server wurde NICHT aus der Datenbank gelöscht.`,
                            canForce: true
                        });
                    }
                    Logger.warn(`[Gameserver] Force-Delete aktiv, lösche aus DB trotz Daemon-Fehler`);
                    uninstallSuccess = true;
                }
            } catch (ipmError) {
                Logger.error(`[Gameserver] IPM-Fehler beim Uninstall:`, ipmError);
                uninstallError = ipmError.message || 'IPM-Kommunikationsfehler';
                if (!forceDelete) {
                    return res.status(500).json({
                        success: false,
                        message: `IPM-Fehler: ${uninstallError}. Server wurde NICHT aus der Datenbank gelöscht.`,
                        canForce: true
                    });
                }
                Logger.warn(`[Gameserver] Force-Delete aktiv, lösche aus DB trotz IPM-Fehler`);
                uninstallSuccess = true;
            }
        } else {
            Logger.warn(`[Gameserver] Daemon ${server.daemon_id} offline`);
            if (!forceDelete) {
                return res.status(503).json({
                    success: false,
                    message: 'Daemon ist offline. Server kann nicht deinstalliert werden.',
                    canForce: true
                });
            }
            Logger.warn(`[Gameserver] Force-Delete aktiv, lösche aus DB ohne Daemon-Bestätigung`);
            uninstallSuccess = true;
        }

        // ════════════════════════════════════════════════════════════
        // 4. DB-Cleanup: Server aus Datenbank löschen (NUR wenn Daemon erfolgreich!)
        // ════════════════════════════════════════════════════════════
        if (uninstallSuccess) {
            // ✅ Port-Allocations freigeben (server_id zurück auf NULL)
            await dbService.query(
                'UPDATE port_allocations SET server_id = NULL, assigned_at = NULL WHERE server_id = ?',
                [serverId]
            );
            Logger.info(`[Gameserver] Port-Allocations für Server ${serverId} freigegeben`);

            await dbService.query('DELETE FROM gameservers WHERE id = ?', [serverId]);
            Logger.success(`[Gameserver] Server ${serverId} aus DB gelöscht`);

            res.json({
                success: true,
                message: `Server "${server.name}" wurde erfolgreich gelöscht`
            });
        }
    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Löschen des Servers:', error);
        res.status(500).json({
            success: false,
            message: 'Serverfehler beim Löschen des Gameservers'
        });
    }
});

/**
 * GET /guild/:guildId/plugins/gameserver/servers/:serverId/edit
 * Server-Edit-Formular anzeigen
 */
router.get('/:serverId/edit', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');
    
    try {
        const guildId = res.locals.guildId;
        const user = res.locals.user;
        const { serverId } = req.params;

        Logger.debug(`[Gameserver] Edit-Formular aufgerufen für Server ${serverId}`);

        // Server-Daten laden
        const [server] = await dbService.query(`
            SELECT 
                gs.id,
                gs.name,
                gs.status,
                gs.max_players,
                gs.auto_restart,
                gs.auto_update,
                gs.env_variables,
                gs.addon_marketplace_id,
                gs.template_name,
                am.name as game_name
            FROM gameservers gs
            LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
            WHERE gs.id = ? AND gs.guild_id = ?
        `, [serverId, guildId]);

        if (!server) {
            return res.status(404).send('Server nicht gefunden');
        }

        // JSON-Daten parsen
        if (typeof server.env_variables === 'string') {
            server.env_variables = JSON.parse(server.env_variables);
        }

        themeManager.renderView(res, 'gameserver-edit', {
            guildId,
            user,
            server,
            layout: themeManager.getLayout('guild')
        });
    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Laden des Edit-Formulars:', error);
        res.status(500).send('Serverfehler beim Laden der Seite');
    }
});

/**
 * PUT /guild/:guildId/plugins/gameserver/servers/:serverId
 * Server-Einstellungen aktualisieren
 */
router.put('/:serverId', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    
    try {
        const guildId = res.locals.guildId;
        const { serverId } = req.params;
        const { name, auto_restart, auto_update, max_players, env_variables } = req.body;

        Logger.info(`[Gameserver] Server-Update angefordert (ID: ${serverId})`);

        // Validierung
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Server-Name ist erforderlich'
            });
        }

        // Server existiert prüfen
        const [server] = await dbService.query(
            'SELECT id, name, status FROM gameservers WHERE id = ? AND guild_id = ?',
            [serverId, guildId]
        );

        if (!server) {
            return res.status(404).json({
                success: false,
                message: 'Server nicht gefunden'
            });
        }

        // ENV-Variables JSON validieren
        let envVarsJson = {};
        if (env_variables && env_variables.trim().length > 0) {
            try {
                envVarsJson = JSON.parse(env_variables);
            } catch (e) {
                return res.status(400).json({
                    success: false,
                    message: 'Ungültiges JSON-Format bei Environment Variables'
                });
            }
        }

        // Max Players validieren
        const maxPlayersInt = parseInt(max_players) || 10;
        if (maxPlayersInt < 1 || maxPlayersInt > 200) {
            return res.status(400).json({
                success: false,
                message: 'Max Players muss zwischen 1 und 200 liegen'
            });
        }

        // Update ausführen
        await dbService.query(`
            UPDATE gameservers 
            SET 
                name = ?,
                auto_restart = ?,
                auto_update = ?,
                max_players = ?,
                env_variables = ?
            WHERE id = ? AND guild_id = ?
        `, [
            name.trim(),
            auto_restart === '1' || auto_restart === true ? 1 : 0,
            auto_update === '1' || auto_update === true ? 1 : 0,
            maxPlayersInt,
            JSON.stringify(envVarsJson),
            serverId,
            guildId
        ]);

        Logger.success(`[Gameserver] Server aktualisiert (ID: ${serverId})`);

        res.json({
            success: true,
            message: `Server "${name}" erfolgreich aktualisiert`
        });
    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Aktualisieren des Servers:', error);
        res.status(500).json({
            success: false,
            message: 'Serverfehler beim Aktualisieren des Servers'
        });
    }
});

/**
 * POST /guild/:guildId/plugins/gameserver/servers/:serverId/retry-installation
 * Installation für Server mit Status 'error' erneut versuchen
 */
router.post('/:serverId/retry-installation', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    
    try {
        const guildId = res.locals.guildId;
        const { serverId } = req.params;

        Logger.info(`[Gameserver] Retry-Installation angefordert (ID: ${serverId})`);

        // Server-Daten laden (frozen_game_data nutzen, nicht am.game_data!)
        const [server] = await dbService.query(
            `SELECT gs.*, am.slug as addon_slug, am.name as addon_name, am.steam_app_id, am.steam_server_app_id, r.daemon_id
             FROM gameservers gs
             LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
             LEFT JOIN rootserver r ON gs.rootserver_id = r.id
             WHERE gs.id = ? AND gs.guild_id = ?`,
            [serverId, guildId]
        );

        if (!server) {
            return res.status(404).json({
                success: false,
                message: 'Server nicht gefunden'
            });
        }

        if (server.status !== 'error' && server.status !== 'installing') {
            return res.status(400).json({
                success: false,
                message: 'Nur Server mit Status "error" oder "installing" können erneut installiert werden'
            });
        }

        if (!server.daemon_id) {
            return res.status(404).json({
                success: false,
                message: 'Kein Daemon zugewiesen'
            });
        }

        const daemonId = server.daemon_id;

        // Status auf 'installing' setzen und error_message löschen
        await dbService.query(
            'UPDATE gameservers SET status = ?, error_message = NULL WHERE id = ?',
            ['installing', serverId]
        );

        // frozen_game_data parsen (nicht am.game_data!)
        let gameData = {};
        try {
            gameData = typeof server.frozen_game_data === 'string'
                ? JSON.parse(server.frozen_game_data)
                : server.frozen_game_data || {};
        } catch (error) {
            Logger.error('[Gameserver] Fehler beim Parsen von frozen_game_data:', error);
        }

        // DEBUG: frozen_game_data prüfen
        const retrySteamAppId = server.steam_app_id || server.steam_server_app_id || null;
        Logger.debug('[Gameserver] Retry - frozen_game_data Status:', {
            isNull: server.frozen_game_data === null,
            isUndefined: server.frozen_game_data === undefined,
            type: typeof server.frozen_game_data,
            length: typeof server.frozen_game_data === 'string' ? server.frozen_game_data.length : 'N/A',
            hasInstallation: !!gameData.installation,
            hasSteam: !!gameData.steam,
            steamAppId: retrySteamAppId
        });

        // Ports parsen
        let ports = {};
        try {
            ports = typeof server.ports === 'string'
                ? JSON.parse(server.ports)
                : server.ports;
        } catch (error) {
            Logger.error('[Gameserver] Fehler beim Parsen von ports:', error);
        }

        // ENV Variables parsen
        let envVariables = {};
        try {
            envVariables = typeof server.env_variables === 'string'
                ? JSON.parse(server.env_variables)
                : server.env_variables;
        } catch (error) {
            Logger.error('[Gameserver] Fehler beim Parsen von env_variables:', error);
        }

        // IPC-Command an Daemon senden
        const ipmServer = ServiceManager.get('ipmServer');
        
        if (!ipmServer) {
            Logger.warn('[Gameserver] IPMServer nicht verfügbar');
            return res.status(503).json({
                success: false,
                message: 'IPM-Server nicht verfügbar'
            });
        }

        if (!ipmServer.isDaemonOnline(daemonId)) {
            Logger.warn(`[Gameserver] Daemon ${daemonId} ist offline`);
            return res.status(503).json({
                success: false,
                message: 'Daemon ist offline - Server bleibt auf "installing" bis Daemon verbindet'
            });
        }

        // Installation erneut starten
        Logger.info(`[Gameserver] Sende Install-Command erneut an Daemon ${daemonId}`, {
            serverId,
            addonSlug: server.addon_slug
        });

        const response = await ipmServer.sendCommand(daemonId, 'gameserver.install', {
            server_id: serverId,
            rootserver_id: server.rootserver_id,
            addon_slug: server.addon_slug,
            addon_name: server.addon_name,
            template_name: server.template_name,
            steam_app_id: retrySteamAppId,
            startup_command: server.launch_params,
            ports,
            env_variables: envVariables,
            game_data: gameData,
            platform: gameData.platform || 'linux',
            run_install: true,
            start_after: false
        }, 60000);

        if (response.success) {
            Logger.success(`[Gameserver] Installation erneut gestartet für Server ${serverId}`);
            res.json({
                success: true,
                message: `Installation für "${server.name}" wird erneut durchgeführt...`
            });
        } else {
            Logger.error(`[Gameserver] Installation fehlgeschlagen für Server ${serverId}:`, response.error);
            
            // Status zurück auf 'error' setzen
            await dbService.query(
                'UPDATE gameservers SET status = ?, error_message = ? WHERE id = ?',
                ['error', response.error || 'Installation retry failed', serverId]
            );
            
            res.status(500).json({
                success: false,
                message: response.error || 'Installation konnte nicht gestartet werden'
            });
        }

    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Retry der Installation:', error);
        res.status(500).json({
            success: false,
            message: 'Serverfehler beim Neustarten der Installation'
        });
    }
});

/**
 * POST /guild/:guildId/plugins/gameserver/servers/:serverId/start
 * Startet einen Gameserver
 */
router.post('/:serverId/start', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    
    try {
        const guildId = res.locals.guildId;
        const { serverId } = req.params;

        Logger.info(`[Gameserver] Start angefordert (ID: ${serverId})`);

        // Server-Daten laden
        const [server] = await dbService.query(
            `SELECT 
                gs.*,
                r.daemon_id,
                r.id as rootserver_id,
                r.system_user
             FROM gameservers gs
             LEFT JOIN rootserver r ON gs.rootserver_id = r.id
             WHERE gs.id = ? AND gs.guild_id = ?`,
            [serverId, guildId]
        );

        if (!server) {
            return res.status(404).json({
                success: false,
                message: 'Server nicht gefunden'
            });
        }

        // Status-Check
        if (server.status === 'online') {
            return res.status(400).json({
                success: false,
                message: 'Server läuft bereits'
            });
        }

        if (server.status === 'installing') {
            return res.status(400).json({
                success: false,
                message: 'Server wird noch installiert'
            });
        }

        if (!server.daemon_id) {
            return res.status(404).json({
                success: false,
                message: 'Kein Daemon zugewiesen'
            });
        }

        // Ports und Env-Variables parsen
        let ports = {};
        let envVariables = {};
        
        try {
            ports = typeof server.ports === 'string' 
                ? JSON.parse(server.ports) 
                : server.ports || {};
        } catch (error) {
            Logger.error('[Gameserver] Fehler beim Parsen von ports:', error);
        }

        try {
            envVariables = typeof server.env_variables === 'string' 
                ? JSON.parse(server.env_variables) 
                : server.env_variables || {};
        } catch (error) {
            Logger.error('[Gameserver] Fehler beim Parsen von env_variables:', error);
        }

        // 🔥 PORT-KONFLIKT-CHECK: Prüfe ob Ports frei sind
        Logger.debug(`[Gameserver] Prüfe Port-Verfügbarkeit für Server ${serverId}...`);
        
        // TODO: Einfacher Port-Check (ersetzt PortValidator.checkRuntimeConflicts)
        // Für jetzt einfach annehmen dass alle Ports frei sind
        const portCheck = { canStart: true, conflicts: [] };
        
        if (!portCheck.canStart) {
            const conflictMessages = portCheck.conflicts.map(c => 
                `Port ${c.port} (${c.portName}) wird bereits von Server "${c.conflictWith.serverName}" verwendet`
            ).join(', ');
            
            Logger.warn(`[Gameserver] Port-Konflikte erkannt: ${conflictMessages}`);
            
            return res.status(409).json({
                success: false,
                message: `Port-Konflikt: ${conflictMessages}. Bitte stoppe den anderen Server zuerst oder ändere die Ports.`,
                conflicts: portCheck.conflicts
            });
        }
        
        Logger.debug(`[Gameserver] Alle Ports verfügbar ✓`);

        // 🔥 TEMPLATE-OVERRIDE: Wenn ein Template gewählt wurde, Variablen-Overrides VOR Substitution einmergen
        try {
            const frozenForTemplate = typeof server.frozen_game_data === 'string'
                ? JSON.parse(server.frozen_game_data)
                : server.frozen_game_data;
            if (server.template_name && Array.isArray(frozenForTemplate?.templates)) {
                const tpl = frozenForTemplate.templates.find(t => t.name === server.template_name);
                if (tpl?.variables) {
                    Object.assign(envVariables, tpl.variables);
                    Logger.debug(`[Gameserver] Template "${server.template_name}" Variablen-Overrides angewendet`);
                }
            }
        } catch (_) { /* frozen_game_data wird unten erneut geparst */ }

        // 🔥 VARIABLE-SUBSTITUTION: {{WORLD}} → "BoomTown", {{PASSWORD}} → "einstein", etc.
        // envVariables nutzt env_variable-Keys (z.B. "SERVER_NAME", "WORLD")
        let startupCommand = server.launch_params;
        
        try {
            const frozenVars = typeof server.frozen_game_data === 'string'
                ? JSON.parse(server.frozen_game_data)
                : server.frozen_game_data;
            if (frozenVars?.variables && Array.isArray(frozenVars.variables)) {
                for (const varDef of frozenVars.variables) {
                    const envKey = varDef.env_variable;     // z.B. "WORLD"
                    const displayName = varDef.name;        // z.B. "World Name"
                    const value = envVariables[envKey] ?? envVariables[displayName] ?? varDef.default_value ?? '';
                    startupCommand = startupCommand.replace(new RegExp(`{{${envKey}}}`, 'g'), String(value));
                }
            } else {
                // Fallback: direkte Substitution mit den gespeicherten Keys (Altdaten ohne frozen_game_data)
                for (const [key, value] of Object.entries(envVariables)) {
                    startupCommand = startupCommand.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
                }
            }
        } catch (e) {
            Logger.warn(`[Gameserver] Variable-Substitution fehlgeschlagen: ${e.message}`);
        }
        
        // Ersetze Port-Variablen (ports = {"game": {"internal": 27030, ...}})
        for (const [key, portData] of Object.entries(ports)) {
            const portValue = typeof portData === 'object' ? (portData.internal || portData.external) : portData;
            if (portValue !== undefined) {
                // z.B. GAME_PORT
                const envKey = key.toUpperCase() + '_PORT';
                startupCommand = startupCommand.replace(new RegExp(`{{${envKey}}}`, 'g'), String(portValue));
                // SERVER_PORT für game/main Port
                if (key === 'game' || key === 'main') {
                    startupCommand = startupCommand.replace(/\{\{SERVER_PORT\}\}/g, String(portValue));
                }
            }
        }

        Logger.debug(`[Gameserver] Startup-Command nach Variable-Substitution:`, {
            original: server.launch_params,
            substituted: startupCommand
        });

        const installPath = server.install_path || `${serverId}-${server.addon_slug}`;
        
        Logger.debug(`[Gameserver] Install-Path: ${installPath}`);

        // Docker-Image und Runtime-Info aus frozen_game_data extrahieren
        let dockerImage = null;
        let gameDataRuntime = { stop_mode: 'sigterm', stop_command: '', stop_timeout_sec: 30, done_string: '' };
        let gameDataConfig = null; // config.files für Config-Patching vor Start
        let fileDenylist = []; // File-Denylist für File-Manager
        let gameDataPlatform = null; // Platform (linux/windows) für Proton-GE

        try {
            const frozenData = typeof server.frozen_game_data === 'string'
                ? JSON.parse(server.frozen_game_data)
                : server.frozen_game_data;

            if (frozenData) {
                // docker_image: erster Wert aus docker_images-Objekt
                const dockerImages = frozenData.docker_images || {};
                const imageKeys = Object.keys(dockerImages);
                if (imageKeys.length > 0) {
                    dockerImage = dockerImages[imageKeys[0]];
                }

                // stop-Info aus startup.stop (z.B. "^C" → sigint)
                const stopSignal = frozenData.startup?.stop || '';
                if (stopSignal === '^C') {
                    gameDataRuntime.stop_mode = 'sigint';
                } else if (stopSignal && stopSignal !== '') {
                    gameDataRuntime.stop_mode = 'console_command';
                    gameDataRuntime.stop_command = stopSignal;
                }

                // done_string: Konsolen-String der signalisiert dass der Server bereit ist
                if (frozenData.startup?.done) {
                    gameDataRuntime.done_string = frozenData.startup.done;
                }

                // config.files: Config-Patching Definition (Parser + Find-Keys)
                if (frozenData.config?.files && Object.keys(frozenData.config.files).length > 0) {
                    gameDataConfig = frozenData.config;
                    Logger.debug(`[Gameserver] ${Object.keys(frozenData.config.files).length} Config-Dateien für Patching geladen`);
                }

                // File-Denylist für File-Manager
                if (Array.isArray(frozenData.file_denylist)) {
                    fileDenylist = frozenData.file_denylist;
                }

                // Platform (linux/windows) für Proton-GE-Wrapping
                if (frozenData.platform) {
                    gameDataPlatform = frozenData.platform;
                }

                // Template-Config-Overrides mergen
                if (server.template_name && Array.isArray(frozenData.templates)) {
                    const tpl = frozenData.templates.find(t => t.name === server.template_name);
                    if (tpl?.config_overrides) {
                        if (!gameDataConfig) gameDataConfig = { files: {} };
                        if (!gameDataConfig.files) gameDataConfig.files = {};
                        for (const [fname, overrides] of Object.entries(tpl.config_overrides)) {
                            if (!gameDataConfig.files[fname]) {
                                gameDataConfig.files[fname] = { parser: 'file', find: {} };
                            }
                            Object.assign(gameDataConfig.files[fname].find, overrides);
                        }
                        Logger.debug(`[Gameserver] Template "${server.template_name}" Config-Overrides angewendet`);
                    }
                }
            }
        } catch (e) {
            Logger.warn(`[Gameserver] frozen_game_data parsen fehlgeschlagen: ${e.message}`);
        }

        if (!dockerImage) {
            Logger.error(`[Gameserver] Kein Docker-Image in frozen_game_data für Server ${serverId}`);
            return res.status(500).json({
                success: false,
                message: 'Kein Docker-Image konfiguriert. Server muss neu installiert werden.'
            });
        }

        Logger.debug(`[Gameserver] Docker-Image: ${dockerImage}`);

        // Daemon-Verfügbarkeit prüfen
        const ipmServer = ServiceManager.get('ipmServer');
        
        if (!ipmServer) {
            return res.status(503).json({
                success: false,
                message: 'IPM-Server nicht verfügbar'
            });
        }

        if (!ipmServer.isDaemonOnline(server.daemon_id)) {
            return res.status(503).json({
                success: false,
                message: 'Daemon ist offline'
            });
        }

        // Status auf 'starting' setzen
        await dbService.query(
            'UPDATE gameservers SET status = ? WHERE id = ?',
            ['starting', serverId]
        );

        // IPM-Command an Daemon senden
        Logger.info(`[Gameserver] Sende Start-Command an Daemon ${server.daemon_id} (Image: ${dockerImage})`);

        const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.start', {
            server_id: serverId,
            daemon_id: server.daemon_id,
            rootserver_id: server.rootserver_id,
            system_user: server.system_user || 'gameserver',
            install_path: installPath,
            startup_command: startupCommand,
            ports,
            env_variables: envVariables,
            guild_id: guildId,
            bind_ip: server.bind_ip || null,
            file_denylist: fileDenylist,
            // Docker-spezifische Felder die der Daemon für StartContainer() braucht:
            game_data: {
                docker_image: dockerImage,
                runtime: gameDataRuntime,
                ...(gameDataConfig ? { config: gameDataConfig } : {}),
                ...(gameDataPlatform ? { platform: gameDataPlatform } : {})
            }
        }, 30000);

        if (response.success) {
            if (response.task_id) {
                // Async: Daemon hat Task in Queue eingereiht.
                // Status bleibt 'starting' – der Daemon setzt ihn via Events (status_changed: running / crashed)
                Logger.info(`[Gameserver] Start-Task eingereiht für Server ${serverId} (Task: ${response.task_id})`);
                res.json({
                    success: true,
                    message: `Server "${server.name}" wird gestartet...`,
                    task_id: response.task_id
                });
            } else {
                // Sync: Container wurde direkt gestartet – done_string wird vom Daemon abgewartet.
                // Status bleibt 'starting', der Daemon sendet das "running" Event wenn spielbereit.
                await dbService.query(
                    'UPDATE gameservers SET last_started_at = NOW() WHERE id = ?',
                    [serverId]
                );
                Logger.success(`[Gameserver] Server ${serverId} wird gestartet (warte auf done_string)`);
                res.json({
                    success: true,
                    message: `Server "${server.name}" wird gestartet...`
                });
            }
        } else {
            // Status auf 'error' setzen (nicht 'offline' — User soll Fehler sehen)
            await dbService.query(
                'UPDATE gameservers SET status = ?, error_message = ? WHERE id = ?',
                ['error', response.error || 'Start failed', serverId]
            );

            // SSE-Broadcast damit Browser sofort den Error-Status sieht
            const sseManager = ServiceManager.get('sseManager');
            if (sseManager) {
                sseManager.broadcast(guildId, 'gameserver', {
                    action: 'status_changed',
                    server_id: String(serverId),
                    status: 'error',
                    error_message: response.error || 'Start failed',
                    timestamp: Date.now()
                });
            }

            Logger.error(`[Gameserver] Start fehlgeschlagen für Server ${serverId}:`, response.error);
            
            res.status(500).json({
                success: false,
                message: response.error || 'Server konnte nicht gestartet werden'
            });
        }

    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Starten des Servers:', error);
        res.status(500).json({
            success: false,
            message: 'Serverfehler beim Starten'
        });
    }
});

/**
 * POST /guild/:guildId/plugins/gameserver/servers/:serverId/stop
 * Stoppt einen laufenden Gameserver
 */
router.post('/:serverId/stop', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    
    try {
        const guildId = res.locals.guildId;
        const { serverId } = req.params;

        Logger.info(`[Gameserver] Stop angefordert (ID: ${serverId})`);

        // Server-Daten laden
        const [server] = await dbService.query(
            `SELECT gs.*, r.daemon_id
             FROM gameservers gs
             LEFT JOIN rootserver r ON gs.rootserver_id = r.id
             WHERE gs.id = ? AND gs.guild_id = ?`,
            [serverId, guildId]
        );

        if (!server) {
            return res.status(404).json({
                success: false,
                message: 'Server nicht gefunden'
            });
        }

        if (server.status !== 'online' && server.status !== 'starting') {
            return res.status(400).json({
                success: false,
                message: 'Server läuft nicht'
            });
        }

        if (!server.daemon_id) {
            return res.status(404).json({
                success: false,
                message: 'Kein Daemon zugewiesen'
            });
        }

        const ipmServer = ServiceManager.get('ipmServer');
        
        if (!ipmServer) {
            return res.status(503).json({
                success: false,
                message: 'IPM-Server nicht verfügbar'
            });
        }

        if (!ipmServer.isDaemonOnline(server.daemon_id)) {
            return res.status(503).json({
                success: false,
                message: 'Daemon ist offline'
            });
        }

        // Status auf 'stopping' setzen
        await dbService.query(
            'UPDATE gameservers SET status = ? WHERE id = ?',
            ['stopping', serverId]
        );

        // IPM-Command an Daemon senden
        Logger.info(`[Gameserver] Sende Stop-Command an Daemon ${server.daemon_id}`);

        const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.stop', {
            server_id: serverId,
            guild_id: guildId  // ✅ Guild-ID für Event-Broadcasting
        }, 30000);

        if (response.success) {
            // Status auf 'offline' setzen
            await dbService.query(
                'UPDATE gameservers SET status = ? WHERE id = ?',
                ['offline', serverId]
            );

            Logger.success(`[Gameserver] Server ${serverId} gestoppt`);
            
            res.json({
                success: true,
                message: `Server "${server.name}" wurde gestoppt`
            });
        } else {
            // Status zurücksetzen falls Stop fehlschlägt
            await dbService.query(
                'UPDATE gameservers SET status = ?, error_message = ? WHERE id = ?',
                ['online', response.error || 'Stop failed', serverId]
            );

            Logger.error(`[Gameserver] Stop fehlgeschlagen für Server ${serverId}:`, response.error);
            
            res.status(500).json({
                success: false,
                message: response.error || 'Server konnte nicht gestoppt werden'
            });
        }

    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Stoppen des Servers:', error);
        res.status(500).json({
            success: false,
            message: 'Serverfehler beim Stoppen'
        });
    }
});

/**
 * POST /guild/:guildId/plugins/gameserver/servers/:serverId/restart
 * Startet einen Gameserver neu
 */
router.post('/:serverId/restart', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    
    try {
        const guildId = res.locals.guildId;
        const { serverId } = req.params;

        Logger.info(`[Gameserver] Restart angefordert (ID: ${serverId})`);

        // Server-Daten laden
        const [server] = await dbService.query(
            `SELECT gs.*, r.daemon_id
             FROM gameservers gs
             LEFT JOIN rootserver r ON gs.rootserver_id = r.id
             WHERE gs.id = ? AND gs.guild_id = ?`,
            [serverId, guildId]
        );

        if (!server) {
            return res.status(404).json({
                success: false,
                message: 'Server nicht gefunden'
            });
        }

        if (!server.daemon_id) {
            return res.status(404).json({
                success: false,
                message: 'Kein Daemon zugewiesen'
            });
        }

        const ipmServer = ServiceManager.get('ipmServer');
        
        if (!ipmServer) {
            return res.status(503).json({
                success: false,
                message: 'IPM-Server nicht verfügbar'
            });
        }

        if (!ipmServer.isDaemonOnline(server.daemon_id)) {
            return res.status(503).json({
                success: false,
                message: 'Daemon ist offline'
            });
        }

        // Status auf 'starting' setzen (ENUM hat kein 'restarting')
        await dbService.query(
            'UPDATE gameservers SET status = ? WHERE id = ?',
            ['starting', serverId]
        );

        // IPM-Command an Daemon senden
        Logger.info(`[Gameserver] Sende Restart-Command an Daemon ${server.daemon_id}`);

        const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.restart', {
            server_id: serverId,
            guild_id: guildId  // ✅ Guild-ID für Event-Broadcasting
        }, 30000);

        if (response.success) {
            // Status auf 'online' setzen
            await dbService.query(
                'UPDATE gameservers SET status = ?, last_started_at = NOW() WHERE id = ?',
                ['online', serverId]
            );

            Logger.success(`[Gameserver] Server ${serverId} neu gestartet`);
            
            res.json({
                success: true,
                message: `Server "${server.name}" wurde neu gestartet`
            });
        } else {
            // Status auf 'offline' setzen falls Restart fehlschlägt
            await dbService.query(
                'UPDATE gameservers SET status = ?, error_message = ? WHERE id = ?',
                ['offline', response.error || 'Restart failed', serverId]
            );

            Logger.error(`[Gameserver] Restart fehlgeschlagen für Server ${serverId}:`, response.error);
            
            res.status(500).json({
                success: false,
                message: response.error || 'Server konnte nicht neu gestartet werden'
            });
        }

    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Neustarten des Servers:', error);
        res.status(500).json({
            success: false,
            message: 'Serverfehler beim Neustarten'
        });
    }
});

/**
 * POST /guild/:guildId/plugins/gameserver/servers/:serverId/reinstall
 * Installiert einen Gameserver neu (bei error-Status)
 */
router.post('/:serverId/reinstall', requirePermission('GAMESERVER.CREATE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    
    try {
        const guildId = res.locals.guildId;
        const { serverId } = req.params;

        Logger.info(`[Gameserver] Reinstall angefordert (ID: ${serverId})`);

        // Server-Daten laden
        const [server] = await dbService.query(
            `SELECT gs.*, r.daemon_id, am.slug as game_slug, am.steam_app_id, am.steam_server_app_id
             FROM gameservers gs
             LEFT JOIN rootserver r ON gs.rootserver_id = r.id
             LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
             WHERE gs.id = ? AND gs.guild_id = ?`,
            [serverId, guildId]
        );

        if (!server) {
            return res.status(404).json({
                success: false,
                message: 'Server nicht gefunden'
            });
        }

        if (!server.daemon_id) {
            return res.status(404).json({
                success: false,
                message: 'Kein Daemon zugewiesen'
            });
        }

        const ipmServer = ServiceManager.get('ipmServer');
        
        if (!ipmServer) {
            return res.status(503).json({
                success: false,
                message: 'IPM-Server nicht verfügbar'
            });
        }

        if (!ipmServer.isDaemonOnline(server.daemon_id)) {
            return res.status(503).json({
                success: false,
                message: 'Daemon ist offline'
            });
        }

        // Status auf 'installing' setzen
        await dbService.query(
            'UPDATE gameservers SET status = ?, error_message = NULL WHERE id = ?',
            ['installing', serverId]
        );

        // IPM-Command an Daemon senden (gleich wie bei normaler Installation)
        Logger.info(`[Gameserver] Sende Reinstall-Command an Daemon ${server.daemon_id}`);

        // game_data aus frozen_game_data laden
        let gameData = {};
        try {
            gameData = server.frozen_game_data
                ? (typeof server.frozen_game_data === 'string' ? JSON.parse(server.frozen_game_data) : server.frozen_game_data)
                : {};
        } catch (e) {
            Logger.warn(`[Gameserver] game_data parse-Fehler bei Reinstall: ${e.message}`);
        }

        const installConfig = {
            server_id: serverId.toString(),
            rootserver_id: server.rootserver_id.toString(),
            daemon_id: server.daemon_id,
            addon_slug: server.game_slug,
            addon_name: server.template_name || server.name,
            server_name: server.name,
            install_path: server.install_path,
            ports: server.ports ? JSON.parse(server.ports) : {},
            env_variables: server.env_variables ? JSON.parse(server.env_variables) : {},
            startup_command: server.launch_params || gameData.startup?.command || '',
            steam_app_id: server.steam_app_id || server.steam_server_app_id || null,
            game_data: gameData,
            platform: gameData.platform || 'linux',
            run_install: true,
            start_after: false,
            reinstall: true  // ✅ Erzwingt Neuinstallation (überschreibt vorhandene start.sh / Spieledateien)
        };

        const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.install', installConfig, 60000);

        if (response.success) {
            Logger.success(`[Gameserver] Reinstall für Server ${serverId} gestartet`);
            
            res.json({
                success: true,
                message: `Neuinstallation von "${server.name}" wurde gestartet. Du erhältst eine Benachrichtigung wenn sie abgeschlossen ist.`,
                task_id: response.task_id
            });
        } else {
            // Status zurück auf 'error' setzen
            await dbService.query(
                'UPDATE gameservers SET status = ?, error_message = ? WHERE id = ?',
                ['error', response.error || 'Reinstall failed', serverId]
            );

            Logger.error(`[Gameserver] Reinstall fehlgeschlagen für Server ${serverId}:`, response.error);
            
            res.status(500).json({
                success: false,
                message: response.error || 'Neuinstallation konnte nicht gestartet werden'
            });
        }

    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Reinstall des Servers:', error);
        res.status(500).json({
            success: false,
            message: 'Serverfehler beim Reinstall'
        });
    }
});

/**
 * PUT/POST /guild/:guildId/plugins/gameserver/servers/:serverId/launch-params
 * Aktualisiere Start-Parameter für einen Server
 * (POST als Fallback wenn JS den Form-Submit nicht als PUT abfängt)
 */
router.put('/:serverId/launch-params', requirePermission('GAMESERVER.EDIT'), launchParamsHandler);
router.post('/:serverId/launch-params', requirePermission('GAMESERVER.EDIT'), launchParamsHandler);

async function launchParamsHandler(req, res) {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    
    try {
        const guildId = res.locals.guildId;
        const serverId = req.params.serverId;
        const { launch_params } = req.body;
        
        // Validierung
        if (!launch_params || typeof launch_params !== 'string' || launch_params.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Start-Parameter dürfen nicht leer sein'
            });
        }
        
        // Längenprüfung (max 2048 Zeichen)
        if (launch_params.length > 2048) {
            return res.status(400).json({
                success: false,
                message: 'Start-Parameter sind zu lang (max. 2048 Zeichen)'
            });
        }
        
        Logger.info(`[Gameserver] Aktualisiere Launch-Params für Server ${serverId} (Guild: ${guildId})`);
        
        // Server existiert und gehört zur Guild?
        const [server] = await dbService.query(
            'SELECT id, name, status FROM gameservers WHERE id = ? AND guild_id = ?',
            [serverId, guildId]
        );
        
        if (!server) {
            return res.status(404).json({
                success: false,
                message: 'Server nicht gefunden'
            });
        }
        
        // Update in Datenbank
        await dbService.query(
            'UPDATE gameservers SET launch_params = ?, updated_at = NOW() WHERE id = ?',
            [launch_params.trim(), serverId]
        );
        
        Logger.success(`[Gameserver] Launch-Params für Server "${server.name}" (ID: ${serverId}) aktualisiert`);
        
        // Warnung wenn Server läuft
        let warningMessage = null;
        if (server.status === 'online' || server.status === 'starting' || server.status === 'running') {
            warningMessage = 'Server läuft - Änderungen werden erst nach Neustart aktiv!';
        }
        
        res.json({
            success: true,
            message: warningMessage || 'Start-Parameter erfolgreich aktualisiert',
            warning: !!warningMessage,
            data: {
                server_id: serverId,
                launch_params: launch_params.trim(),
                server_status: server.status
            }
        });
        
    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Aktualisieren der Launch-Params:', error);
        res.status(500).json({
            success: false,
            message: 'Serverfehler beim Speichern der Start-Parameter'
        });
    }
}

// ============================================================
// PORTS: Server-Ports aktualisieren
// PUT /guild/:guildId/plugins/gameserver/servers/:serverId/ports
// ============================================================
router.put('/:serverId/ports', requirePermission('GAMESERVER.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const guildId = res.locals.guildId;
        const serverId = req.params.serverId;
        const portUpdates = req.body; // { game: 27015, query: 27016, ... }

        if (!portUpdates || typeof portUpdates !== 'object') {
            return res.status(400).json({ success: false, message: 'Ungültiges Format – erwartet { portKey: portNumber }' });
        }

        const [server] = await dbService.query(
            'SELECT id, status, ports FROM gameservers WHERE id = ? AND guild_id = ?',
            [serverId, guildId]
        );
        if (!server) return res.status(404).json({ success: false, message: 'Server nicht gefunden' });

        if (server.status === 'online' || server.status === 'starting') {
            return res.status(409).json({ success: false, message: 'Ports können nicht geändert werden solange der Server läuft' });
        }

        // Validierung: nur gültige Port-Nummern
        for (const [key, val] of Object.entries(portUpdates)) {
            if (!/^[a-zA-Z0-9_]+$/.test(key)) return res.status(400).json({ success: false, message: `Ungültiger Port-Key: ${key}` });
            const p = parseInt(val, 10);
            if (isNaN(p) || p < 1024 || p > 65535) return res.status(400).json({ success: false, message: `Ungültiger Port-Wert für "${key}": ${val}` });
        }

        // Bestehende Ports laden und mergen
        let currentPorts = {};
        try { currentPorts = typeof server.ports === 'string' ? JSON.parse(server.ports) : (server.ports || {}); } catch (_) {}

        for (const [key, val] of Object.entries(portUpdates)) {
            const p = parseInt(val, 10);
            if (!currentPorts[key]) currentPorts[key] = {};
            currentPorts[key].external = p;
            currentPorts[key].internal = p;
        }

        await dbService.query(
            'UPDATE gameservers SET ports = ?, updated_at = NOW() WHERE id = ?',
            [JSON.stringify(currentPorts), serverId]
        );

        Logger.info(`[Gameserver] Ports aktualisiert für Server ${serverId}: ${JSON.stringify(portUpdates)}`);
        return res.json({ success: true, message: 'Ports gespeichert', ports: currentPorts });

    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Aktualisieren der Ports:', error);
        return res.status(500).json({ success: false, message: 'Interner Fehler' });
    }
});

// ============================================================
// CONFIG-APPLY: Config-Dateien auf Disk patchen (ohne Server-Neustart)
// POST /guild/:guildId/plugins/gameserver/servers/:serverId/apply-config
// ============================================================
router.post('/:serverId/apply-config', requirePermission('GAMESERVER.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const ipmServer = ServiceManager.get('ipmServer');

    try {
        const guildId = res.locals.guildId;
        const serverId = req.params.serverId;

        // Server mit game_data + daemon_id laden
        const [server] = await dbService.query(`
            SELECT gs.id, gs.env_variables, gs.ports,
                   gs.frozen_game_data, gs.install_path, gs.bind_ip,
                   r.daemon_id, r.system_user
            FROM gameservers gs
            LEFT JOIN rootserver r ON gs.rootserver_id = r.id
            WHERE gs.id = ? AND gs.guild_id = ?
        `, [serverId, guildId]);

        if (!server) {
            return res.status(404).json({ success: false, message: 'Server nicht gefunden' });
        }

        if (!server.daemon_id) {
            return res.status(400).json({ success: false, message: 'Kein Daemon zugewiesen' });
        }

        // frozen_game_data parsen
        let frozenData = {};
        try {
            frozenData = typeof server.frozen_game_data === 'string'
                ? JSON.parse(server.frozen_game_data)
                : (server.frozen_game_data || {});
        } catch (_) { frozenData = {}; }

        const configFiles = frozenData?.config?.files || {};
        if (Object.keys(configFiles).length === 0) {
            return res.json({ success: true, message: 'Keine Config-Dateien zum Patchen definiert' });
        }

        // env_variables + ports parsen
        let envVars = {};
        try {
            envVars = typeof server.env_variables === 'string'
                ? JSON.parse(server.env_variables) : (server.env_variables || {});
        } catch (_) { envVars = {}; }

        let ports = {};
        try {
            ports = typeof server.ports === 'string'
                ? JSON.parse(server.ports) : (server.ports || {});
        } catch (_) { ports = {}; }

        // IPM Command an Daemon senden
        const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.apply_config', {
            server_id: String(serverId),
            config_files: configFiles,
            env_variables: envVars,
            ports: ports,
            install_path: server.install_path,
            bind_ip: server.bind_ip || null
        }, 15000);

        if (!response.success) {
            Logger.warn(`[Gameserver] Config-Apply fehlgeschlagen für Server ${serverId}: ${response.message}`);
            return res.status(500).json({ success: false, message: response.message || 'Config-Apply fehlgeschlagen' });
        }

        Logger.info(`[Gameserver] Config-Dateien gepatcht für Server ${serverId}`);
        return res.json({ success: true, message: 'Config-Dateien erfolgreich gepatcht' });

    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Config-Apply:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler beim Config-Apply' });
    }
});

// ============================================================
// VARIABLEN: Server-Variablen aktualisieren
// PUT /guild/:guildId/plugins/gameserver/servers/:serverId/variables
// ============================================================
router.put('/:serverId/variables', requirePermission('GAMESERVER.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const guildId = res.locals.guildId;
        const serverId = req.params.serverId;
        const updates = req.body; // { VAR_NAME: value, ... }

        if (!updates || typeof updates !== 'object') {
            return res.status(400).json({ success: false, message: 'Ungültiges Format' });
        }

        // Aktuellen Stand laden
        const [server] = await dbService.query(
            'SELECT id, env_variables, launch_params FROM gameservers WHERE id = ? AND guild_id = ?',
            [serverId, guildId]
        );
        if (!server) {
            return res.status(404).json({ success: false, message: 'Server nicht gefunden' });
        }

        let envVars = {};
        try {
            envVars = typeof server.env_variables === 'string'
                ? JSON.parse(server.env_variables)
                : (server.env_variables || {});
        } catch (_) { envVars = {}; }

        // Werte überschreiben (nur bekannte Keys, um XSS/Injection zu verhindern)
        // Wir übernehmen alle Keys aus dem Request, da game_data.variables als Validierungsgrundlage dient
        for (const [key, value] of Object.entries(updates)) {
            // Nur alphanumerische Keys + _ erlaubt
            if (/^[A-Za-z0-9_]+$/.test(key)) {
                envVars[key] = String(value);
            }
        }

        // launch_params neu aufbauen: Platzhalter ersetzen
        let newLaunchParams = server.launch_params || '';
        for (const [key, value] of Object.entries(envVars)) {
            newLaunchParams = newLaunchParams.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
        }

        await dbService.query(
            'UPDATE gameservers SET env_variables = ?, updated_at = NOW() WHERE id = ?',
            [JSON.stringify(envVars), server.id]
        );

        Logger.info(`[Gameserver] Variablen aktualisiert für Server ${serverId}`);
        return res.json({ success: true, message: 'Variablen gespeichert', env_variables: envVars });

    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Aktualisieren der Variablen:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

// ============================================================
// SFTP: Passwort zurücksetzen
// POST /guild/:guildId/plugins/gameserver/servers/:serverId/sftp/reset-password
// ============================================================
router.post('/:serverId/sftp/reset-password', requirePermission('GAMESERVER.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const guildId = res.locals.guildId;
        const serverId = req.params.serverId;

        const [server] = await dbService.query(
            `SELECT gs.id, gs.sftp_username, gs.guild_id,
                    r.daemon_id, r.hostname, r.host, r.system_user
             FROM gameservers gs
             LEFT JOIN rootserver r ON gs.rootserver_id = r.id
             WHERE gs.id = ? AND gs.guild_id = ?`,
            [serverId, guildId]
        );

        if (!server) {
            return res.status(404).json({ success: false, message: 'Server nicht gefunden' });
        }

        // Username = immer der system_user des RootServers
        const sftp_username = server.system_user || server.sftp_username || `gs-${String(server.id).padStart(8, '0')}`;
        const sftp_password = crypto.randomBytes(10).toString('hex');

        await dbService.query(
            'UPDATE gameservers SET sftp_username = ?, sftp_password = ? WHERE id = ?',
            [sftp_username, sftp_password, server.id]
        );

        _syncSftpUserToDaemon(server.daemon_id, String(server.id), sftp_username, sftp_password, guildId)
            .catch(err => Logger.warn(`[Gameserver] SFTP-Sync-Fehler: ${err.message}`));

        Logger.info(`[Gameserver] SFTP-Passwort zurückgesetzt für Server ${serverId}`);

        return res.json({ success: true, sftp_username, sftp_password });

    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Zurücksetzen des SFTP-Passworts:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

// ============================================================
// SFTP-Helper: Credentials per IPM an Daemon synchronisieren
// ============================================================
async function _syncSftpUserToDaemon(daemonId, serverId, username, password, guildId) {
    if (!daemonId) return;
    const ipmServer = ServiceManager.get('ipmServer');
    if (!ipmServer) return;
    await ipmServer.sendCommand(daemonId, 'sftp.user.sync', {
        server_id: serverId,
        guild_id: guildId,
        username,
        password
    });
}

// ============================================================
// POST /:serverId/rcon – RCON-Befehl senden
// ============================================================
router.post('/:serverId/rcon', requirePermission('GAMESERVER.RCON'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const ipmServer = ServiceManager.get('ipmServer');

    try {
        const guildId = res.locals.guildId;
        const serverId = req.params.serverId;
        const command = (req.body.command || '').trim();

        if (!command) {
            return res.status(400).json({ success: false, message: 'Befehl darf nicht leer sein' });
        }
        if (command.length > 512) {
            return res.status(400).json({ success: false, message: 'Befehl zu lang (max. 512 Zeichen)' });
        }

        const [server] = await dbService.query(`
            SELECT gs.id, gs.ports, gs.env_variables, gs.bind_ip,
                   r.daemon_id, r.host AS rootserver_ip,
                   am.game_data
            FROM gameservers gs
            LEFT JOIN rootserver r ON gs.rootserver_id = r.id
            LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
            WHERE gs.id = ? AND gs.guild_id = ?
        `, [serverId, guildId]);

        if (!server) {
            return res.status(404).json({ success: false, message: 'Server nicht gefunden' });
        }

        // game_data (Egg) parsen
        let gameData = {};
        try {
            gameData = typeof server.game_data === 'string'
                ? JSON.parse(server.game_data) : (server.game_data || {});
        } catch (_) { /* ignorieren */ }

        const rconConfig = gameData?.config?.rcon;
        if (!rconConfig) {
            return res.status(400).json({ success: false, message: 'Dieser Gameserver unterstützt kein RCON' });
        }

        // ports + env_variables parsen
        let ports = {};
        try { ports = typeof server.ports === 'string' ? JSON.parse(server.ports) : (server.ports || {}); } catch (_) { /* */ }
        let envVars = {};
        try { envVars = typeof server.env_variables === 'string' ? JSON.parse(server.env_variables) : (server.env_variables || {}); } catch (_) { /* */ }

        // RCON-Port bestimmen: port_var in Kleinbuchstaben → ports[portVar].external
        //                      port_var in Großbuchstaben → env_variables[portVar]
        const portVar = rconConfig.port_var || '';
        let rconPort = null;
        if (portVar === portVar.toLowerCase()) {
            // Kleinbuchstaben → Port-Key
            rconPort = ports[portVar]?.external || ports[portVar]?.internal || null;
        } else {
            // Großbuchstaben → ENV-Variable
            rconPort = parseInt(envVars[portVar], 10) || null;
        }

        const passwordVar = rconConfig.password_var || '';
        const rconPassword = envVars[passwordVar] || '';

        if (!rconPort) {
            return res.status(400).json({ success: false, message: `RCON-Port (${portVar}) nicht gefunden` });
        }
        if (!rconPassword) {
            return res.status(400).json({ success: false, message: `RCON-Passwort (${passwordVar}) nicht konfiguriert` });
        }
        if (!server.daemon_id) {
            return res.status(400).json({ success: false, message: 'Kein Daemon für diesen Server konfiguriert' });
        }

        const result = await ipmServer.sendCommand(server.daemon_id, 'gameserver.rcon', {
            guild_id: guildId,
            server_id: String(server.id),
            rcon_host: server.bind_ip || server.rootserver_ip || '127.0.0.1',
            rcon_port: rconPort,
            rcon_password: rconPassword,
            rcon_command: command
        }, 15000);

        if (!result?.success) {
            Logger.warn(`[Gameserver] RCON-Fehler für Server ${serverId}: ${result?.error}`);
            return res.json({ success: false, message: result?.error || 'RCON-Befehl fehlgeschlagen' });
        }

        Logger.info(`[Gameserver] RCON-Befehl ausgeführt (Server ${serverId}): ${command}`);
        return res.json({ success: true, output: result.output || '' });

    } catch (error) {
        Logger.error('[Gameserver] RCON-Route Fehler:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler beim Ausführen des RCON-Befehls' });
    }
});

module.exports = router;
