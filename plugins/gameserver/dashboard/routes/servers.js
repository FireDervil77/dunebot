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
const bcrypt = require('bcrypt');
const { ServiceManager } = require('dunebot-core');
const StatusService = require('../helpers/StatusService');
const { buildStartPayload, loadServerForStart, paketFuerInstall } = require('../helpers/StartPayload');
const { resolveStatusConfig } = require('../helpers/StatusSchema');
const PanelService = require('../helpers/PanelService');
const { validateCommand, rateLimiter } = require('../helpers/CommandFilter');
const { resolveConsoleTransport } = require('../helpers/ConsoleTransport');
const { beurteileVariablen } = require('../helpers/EggVariables');
// const TemplateEngine = require('../helpers/TemplateEngine'); // ENTFERNT - existiert nicht mehr
// const PortValidator = require('../helpers/PortValidator'); // ENTFERNT - existiert nicht mehr

// ✅ PERMISSION-MIDDLEWARE IMPORTIEREN
const { requirePermission, loadUserPermissions } = require('../../../../apps/dashboard/middlewares/permissions.middleware');

// ✅ WICHTIG: Permission-Middleware für ALLE Guild-Routes laden!
router.use(loadUserPermissions);

/**
 * Formular-Wert in einen Boolean übersetzen.
 *
 * Selects/Hidden-Felder liefern Strings – "0", "false" und "" sind in JS aber
 * truthy bzw. uneinheitlich. Ohne diese Normalisierung landen Schalter falsch
 * in der DB (auto_update stand deshalb immer auf 1).
 *
 * @param {*} value
 * @param {boolean} [fallback=false] - Wert wenn nichts übergeben wurde
 * @returns {boolean}
 */
function toBool(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const v = String(value).trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

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
router.get('/create', requirePermission('GAMESERVER.CREATE'), async (req, res) => {
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
router.post('/', requirePermission('GAMESERVER.CREATE'), async (req, res) => {
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

        // ════════════════════════════════════════════════════════════════════
        // Ressourcen: Pflichtangabe und Gegenprüfung gegen den RootServer
        //
        // Bis zum 2026-08-02 waren diese Felder optional und wurden nirgends
        // geprüft: alle Bestandsserver hatten NULL, der Daemon startete die
        // Container ohne Limit, und die Ressourcen-Seite zählte 0 % Auslastung,
        // während die Maschine voll lief. Ohne Angabe lässt sich weder buchen
        // noch begrenzen — deshalb sind die drei Werte jetzt verbindlich.
        // ════════════════════════════════════════════════════════════════════
        const ramMB      = parseInt(allocated_ram_mb, 10);
        const cpuPercent = parseInt(allocated_cpu_percent, 10);
        const diskGB     = parseInt(allocated_disk_gb, 10);

        const fehlend = [];
        if (!Number.isFinite(ramMB)      || ramMB      < 512) fehlend.push('Arbeitsspeicher (mind. 512 MiB)');
        if (!Number.isFinite(cpuPercent) || cpuPercent < 10 || cpuPercent > 1600) fehlend.push('CPU-Anteil (10–1600 %)');
        if (!Number.isFinite(diskGB)     || diskGB     < 1)   fehlend.push('Speicherplatz (mind. 1 GiB)');

        if (fehlend.length) {
            return res.status(400).json({
                success: false,
                message: `Ressourcen müssen angegeben werden: ${fehlend.join(', ')}`
            });
        }

        // Passt das noch auf die Maschine? `checkResourceAvailability` rechnet
        // gegen die Quota des RootServers inklusive Überallokation und Reserve
        // und berücksichtigt eine etwaige Obergrenze für die Serveranzahl.
        // CPU wird dort in Kernen geführt (100 % = 1 Kern).
        const RootServerModel = require('../../../masterserver/dashboard/models/RootServer');
        await RootServerModel.ensureQuota(rootserver.id);
        const platz = await RootServerModel.checkResourceAvailability(rootserver_id, {
            ramMB,
            cpuCores: cpuPercent / 100,
            diskGB
        });

        if (!platz.available) {
            const gruende = [];
            if (platz.missing?.ram) {
                gruende.push(`Arbeitsspeicher: ${ramMB} MiB angefordert, ${Math.max(0, Math.round(platz.missing.ram.available))} MiB frei`);
            }
            if (platz.missing?.cpu) {
                gruende.push(`CPU: ${cpuPercent} % angefordert, ${Math.max(0, Math.round(platz.missing.cpu.available * 100))} % frei`);
            }
            if (platz.missing?.disk) {
                gruende.push(`Speicherplatz: ${diskGB} GiB angefordert, ${Math.max(0, Math.round(platz.missing.disk.available))} GiB frei`);
            }
            if (platz.missing?.gameserver_limit) {
                gruende.push(`Serverzahl: ${platz.missing.gameserver_limit.current} von ${platz.missing.gameserver_limit.max} belegt`);
            }

            Logger.warn(`[Gameserver] Anlegen abgelehnt — RootServer ${rootserver.name} hat keinen Platz`, platz.missing);
            return res.status(409).json({
                success: false,
                message: gruende.length
                    ? `Auf "${rootserver.name}" ist nicht genug frei — ${gruende.join('; ')}.`
                    : `Auf "${rootserver.name}" ist nicht genug frei (${platz.reason || 'Kapazität erschöpft'}).`,
                missing: platz.missing || null
            });
        }

        // Addon abrufen
        const [addon] = await dbService.query(`
            SELECT id, name, slug, game_data, steam_app_id, steam_server_app_id, version
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

        // 1. Runtime-Docker-Image: docker_images (Map) → docker_image (erster KEY = Image-URL)
        if (!gameData.docker_image && gameData.docker_images) {
            gameData.docker_image = Object.keys(gameData.docker_images)[0] || '';
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
        // Zuerst alle Defaults aus game_data.variables als Basis.
        //
        // ── Warum hier beide Gestalten geprüft werden ────────────────────────
        //
        // Hier stand nur `Array.isArray(gameData.variables)` — und dieser Zweig
        // war UNERREICHBAR: Oben (Punkt 3 der Normalisierung) wird `variables`
        // von der Liste in eine Map umgewandelt, bevor diese Zeile läuft.
        //
        // Die Folge war nicht harmlos. Das Formular überspringt Variablen mit
        // `user_editable === false` (server-create-step2.ejs) und schickt sie
        // deshalb nicht mit. Ihre Vorgabe sollte von hier kommen — kam aber
        // nirgends her. Bei Valheim betrifft das unter anderem
        // LD_LIBRARY_PATH und CONSOLE_FILTER.
        //
        // Gemessen am 2026-08-19 beim Bau des Schritt-Ausführers, weil dessen
        // Platzhalter (z.B. {{SRCDS_BETAID}}) aus genau diesen Werten aufgelöst
        // werden.
        if (Array.isArray(gameData.variables)) {
            for (const v of gameData.variables) {
                if (v.env_variable) envVariables[v.env_variable] = v.default_value ?? '';
            }
        } else if (gameData.variables && typeof gameData.variables === 'object') {
            for (const [k, v] of Object.entries(gameData.variables)) {
                envVariables[k] = v ?? '';
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

            // ⚠️ Offset-Ports sind schon vergeben, bevor hier jemand zählt.
            //
            // Spiele wie ARK belegen neben dem Spielport zwingend `Spielport + 1`
            // für den Rohdaten-Socket. Dieser Port wird weiter unten berechnet und
            // verbraucht bewusst keinen Pool-Eintrag — die sequenzielle Vergabe
            // hier wusste davon aber nichts und hat dieselbe Nummer ein zweites
            // Mal ausgegeben. Bei Server 160 lagen `query` und `game_plus_1`
            // beide auf 7001: ARK bekam denselben Port für Steam-Abfrage und
            // Spieldaten, und der Beitritt lief in die Zeitüberschreitung.
            //
            // Vorher fiel es nicht auf, weil es von der Reihenfolge im Pool
            // abhing — bei Server 159 landete der Query-Port zufällig *unter*
            // dem Spielport und kollidierte deshalb nicht.
            const reservierteVersaetze = new Set(
                Object.values(offsetPorts)
                    .filter(o => o.base === 'game')
                    .map(o => o.offset)
            );

            // Zählt 1, 2, 3 … hoch und überspringt, was sich das Spiel selbst nimmt.
            const versatzGeber = () => {
                let versatz = 0;
                return () => {
                    do { versatz++; } while (reservierteVersaetze.has(versatz));
                    return versatz;
                };
            };

            // Dieselben Nummern müssen auch beim Ausweichen auf "irgendein freier
            // Port" gesperrt sein — sonst greift der Fallback genau danach.
            const sperrKlausel = (basisPort) => {
                const nummern = [...reservierteVersaetze].map(v => basisPort + v);
                return {
                    sql: nummern.length ? ` AND port NOT IN (${nummern.map(() => '?').join(',')})` : '',
                    werte: nummern
                };
            };

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
                // Versätze, die sich das Spiel selbst nimmt, werden übersprungen.
                const naechsterVersatz = versatzGeber();
                const sperre = sperrKlausel(requestedPort);
                for (let i = 0; i < extraPortTypes.length; i++) {
                    const portType = extraPortTypes[i];
                    const versatz = naechsterVersatz();
                    const desiredPort = requestedPort + versatz;
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
                        Logger.info(`[Gameserver] Port ${portType} sequential: ${seqAlloc.port} (Game+${versatz}, Allocation #${seqAlloc.id})`);
                    } else {
                        // Fallback: nächsten freien Port aus Pool — ohne die,
                        // die für Offset-Ports des Spiels reserviert sind.
                        const [freeAlloc] = await dbService.query(
                            `SELECT id, port FROM port_allocations
                             WHERE rootserver_id = ? AND server_id IS NULL${sperre.sql}
                             ORDER BY port ASC LIMIT 1`,
                            [rootserver_id, ...sperre.werte]
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
                    // Versätze, die sich das Spiel selbst nimmt, werden übersprungen.
                    const naechsterVersatz = versatzGeber();
                    const sperre = sperrKlausel(gameAlloc.port);
                    for (let i = 0; i < extraPortTypes.length; i++) {
                        const portType = extraPortTypes[i];
                        const versatz = naechsterVersatz();
                        const desiredPort = gameAlloc.port + versatz;
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
                            Logger.info(`[Gameserver] Port ${portType} sequential: ${seqAlloc.port} (Game+${versatz}, Allocation #${seqAlloc.id})`);
                        } else {
                            // Ohne die Nummern, die für Offset-Ports reserviert sind.
                            const [freeAlloc] = await dbService.query(
                                `SELECT id, port FROM port_allocations
                                 WHERE rootserver_id = ? AND server_id IS NULL${sperre.sql}
                                 ORDER BY port ASC LIMIT 1`,
                                [rootserver_id, ...sperre.werte]
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
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'installing', NOW())
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
            // Das Formular schickt die Strings "0"/"1" – und "0" ist in JS truthy.
            // Vorher landete deshalb IMMER 1 in der DB, egal was gewählt wurde.
            toBool(auto_restart, true) ? 1 : 0,
            toBool(auto_update, false) ? 1 : 0,
            // Geprüfte Werte, keine Rohdaten aus dem Formular: die drei Felder
            // sind Pflicht und wurden oben gegen die Kapazität des RootServers
            // gerechnet. Damit ist dieser INSERT zugleich die Buchung.
            ramMB,
            cpuPercent,
            diskGB,
            // Vorher stand '1.0.0' fest im VALUES-Teil: jeder Server merkte sich
            // diese Version, egal welche das Addon wirklich hatte.
            addon.version || '1.0.0'
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
        // Das Passwort wird hier nur gehasht abgelegt; der Nutzer holt es sich
        // über "Zurücksetzen" auf der Detailseite.
        const sftpUsername = rootserver.system_user || `gs-${String(serverId).padStart(8, '0')}`;
        _setzeSftpPasswort(dbService, {
            serverId,
            username: sftpUsername,
            daemonId,
            guildId
        })
            .then(({ synchronisiert, fehler }) => {
                if (synchronisiert) {
                    Logger.info(`[Gameserver] SFTP-Credentials gesetzt für Server ${serverId} (User: ${sftpUsername})`);
                } else {
                    Logger.warn(`[Gameserver] SFTP-Credentials für Server ${serverId} nicht zum Daemon übertragen: ${fehler?.message}`);
                }
            })
            .catch(err => Logger.warn(`[Gameserver] SFTP-Credentials fehlgeschlagen: ${err.message}`));

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

                // ── Das Spielpaket, wenn es eines gibt ──────────────────────
                //
                // Es entscheidet im Daemon über den ganzen Installationsweg:
                // Mit Paket läuft das Rezept im Laufzeit-Image nach game/, ohne
                // Paket das Egg-Skript im Fremd-Image nach /mnt/server.
                //
                // Der Umschalter ist die NUTZLAST und keine Einstellung — so
                // wandert jeder Server genau dann mit, wenn sein Paket steht,
                // und niemand muss einen Schalter nachziehen.
                const paket = await paketFuerInstall(
                    dbService, addon.id, Logger, `Server ${serverId} anlegen`);

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
                    // Das Paket. Ist es null, gilt im Daemon der alte Weg.
                    package: paket,
                    // platform als eigenständiges Feld (Belt-and-suspenders neben game_data.platform)
                    platform: gameData.platform || 'linux',
                    run_install: toBool(run_install, true),
                    start_after: toBool(start_after, false),
                    resource_limits: {
                        ram_mb:      ramMB,
                        cpu_percent: cpuPercent,
                        disk_gb:     diskGB
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
 *
 * ⚠️ Der Stream transportiert dieselben Daten wie die geschützten Ansichten
 * (Status, Auslastung, Spielerzahlen) und braucht deshalb dieselbe Berechtigung
 * wie sie. Ohne GAMESERVER.VIEW konnte bis dahin jedes eingeloggte Guild-Mitglied
 * mitlesen – als einzige Gameserver-Route.
 */
router.get('/events', requirePermission('GAMESERVER.VIEW'), (req, res) => {
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
router.get('/status', requirePermission('GAMESERVER.VIEW'), async (req, res) => {
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
                gs.id, gs.guild_id, gs.status, gs.ports, gs.env_variables, gs.bind_ip,
                r.host AS rootserver_ip,
                r.daemon_id,
                COALESCE(am.game_data, gs.frozen_game_data) AS game_data
            FROM gameservers gs
            LEFT JOIN rootserver r ON gs.rootserver_id = r.id
            LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
            WHERE gs.id = ? AND gs.guild_id = ?
        `, [serverId, guildId]);

        if (!server) {
            return res.status(404).json({ success: false, message: 'Server nicht gefunden' });
        }

        ServiceManager.get('gameserverStatusPoller')?.markInterest(server.id);

        // Frisches Ergebnis wiederverwenden statt den Gameserver erneut abzufragen –
        // der Poller hält den Wert ohnehin aktuell, solange die Seite offen ist.
        // Zwei Abfragen kurz hintereinander beantworten die meisten Spiele nicht.
        let result   = StatusService.getRecentQuery(serverId);
        let snapshot = null;

        if (!result) {
            // Über den StatusService, damit das Ergebnis im Snapshot landet und
            // Serverliste, Karten und Discord dieselbe Wahrheit sehen.
            snapshot = await StatusService.refresh(server);
            result = snapshot.query || { success: false, error: 'Server ist nicht online' };
        }

        // Die Query ist nur eine von zwei Quellen. Bleibt sie stumm, während RCON
        // antwortet, stehen die Spieler trotzdem im Snapshot – dann gewinnt der.
        // Ohne das zeigte die Detailseite bei Palworld dauerhaft den Query-Fehler,
        // obwohl ShowPlayers längst Namen lieferte.
        if (!result.success) {
            snapshot = snapshot || await StatusService.getSnapshot(serverId);
            if (snapshot?.online) {
                result = StatusService.toQueryShape(snapshot);
            }
        }

        if (!result.success) {
            Logger.debug(`[Gameserver] Keine Quelle erreichbar für Server ${serverId}: ${result.error}`);
        }

        return res.json(result);

    } catch (error) {
        Logger.error('[Gameserver] Fehler bei Live-Query:', error);
        return res.status(500).json({ success: false, error: 'Interner Serverfehler' });
    }
});

// ════════════════════════════════════════════════════════════════════════
// Öffentlicher Status (E5)
//
// Wie bei den Panels gilt: Ohne ausdrückliches Einschalten gibt es nichts zu
// sehen. Das Token wird erst beim Einschalten erzeugt – ein Server, der nie
// veröffentlicht wurde, hat auch keine Adresse, die irgendwo auftauchen könnte.
// ════════════════════════════════════════════════════════════════════════

/**
 * GET …/servers/:serverId/public-status
 * @permission GAMESERVER.VIEW
 */
router.get('/:serverId/public-status', requirePermission('GAMESERVER.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const [server] = await dbService.query(
            `SELECT public_status_token, public_status_enabled, public_status_players
             FROM gameservers WHERE id = ? AND guild_id = ? LIMIT 1`,
            [req.params.serverId, res.locals.guildId]
        );
        if (!server) return res.status(404).json({ success: false, error: 'Server nicht gefunden' });

        return res.json({
            success: true,
            enabled:      !!server.public_status_enabled,
            show_players: !!server.public_status_players,
            token:        server.public_status_token || null,
        });

    } catch (error) {
        Logger.error('[Gameserver] Öffentlicher Status nicht geladen:', error);
        return res.status(500).json({ success: false, error: 'Interner Serverfehler' });
    }
});

/**
 * PATCH …/servers/:serverId/public-status
 * Schaltet die öffentliche Seite und die Spielernamen. Nur mitgeschickte Felder
 * werden geändert.
 * @permission GAMESERVER.EDIT
 */
router.patch('/:serverId/public-status', requirePermission('GAMESERVER.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const { neuesToken } = require('../helpers/PublicStatus');

    try {
        const guildId = res.locals.guildId;
        const serverId = Number(req.params.serverId);
        const { enabled, show_players } = req.body;

        const [server] = await dbService.query(
            'SELECT id, public_status_token FROM gameservers WHERE id = ? AND guild_id = ? LIMIT 1',
            [serverId, guildId]
        );
        if (!server) return res.status(404).json({ success: false, error: 'Server nicht gefunden' });

        const sets = [], werte = [];

        if (enabled !== undefined) {
            sets.push('public_status_enabled = ?');
            werte.push(toBool(enabled) ? 1 : 0);

            // Token erst beim Einschalten erzeugen, nicht auf Vorrat.
            if (toBool(enabled) && !server.public_status_token) {
                sets.push('public_status_token = ?');
                werte.push(neuesToken());
            }
        }
        if (show_players !== undefined) {
            sets.push('public_status_players = ?');
            werte.push(toBool(show_players) ? 1 : 0);
        }

        if (sets.length) {
            werte.push(serverId);
            await dbService.query(`UPDATE gameservers SET ${sets.join(', ')} WHERE id = ?`, werte);
        }

        const [neu] = await dbService.query(
            `SELECT public_status_token, public_status_enabled, public_status_players
             FROM gameservers WHERE id = ? LIMIT 1`,
            [serverId]
        );

        Logger.info(`[Gameserver] Öffentlicher Status für Server ${serverId} geändert `
            + `(an: ${!!neu.public_status_enabled}, Namen: ${!!neu.public_status_players})`);

        return res.json({
            success: true,
            enabled:      !!neu.public_status_enabled,
            show_players: !!neu.public_status_players,
            token:        neu.public_status_token || null,
        });

    } catch (error) {
        Logger.error('[Gameserver] Öffentlicher Status nicht geändert:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST …/servers/:serverId/public-status/regenerate
 * Würfelt das Token neu – alte Einbindungen sind danach tot.
 * @permission GAMESERVER.EDIT
 */
router.post('/:serverId/public-status/regenerate', requirePermission('GAMESERVER.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const { neuesToken } = require('../helpers/PublicStatus');

    try {
        const token = neuesToken();
        const ergebnis = await dbService.query(
            'UPDATE gameservers SET public_status_token = ? WHERE id = ? AND guild_id = ?',
            [token, req.params.serverId, res.locals.guildId]
        );
        if (!ergebnis?.affectedRows) {
            return res.status(404).json({ success: false, error: 'Server nicht gefunden' });
        }

        Logger.warn(`[Gameserver] Öffentliches Token für Server ${req.params.serverId} neu gewürfelt – `
            + 'bestehende Einbindungen zeigen ab jetzt 404');

        return res.json({ success: true, token });

    } catch (error) {
        Logger.error('[Gameserver] Token nicht erneuert:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════
// Discord-Status-Panels (E4)
//
// Wichtig: Diese Routen stehen VOR `router.get('/:serverId')`. Express nimmt
// die erste passende Route, und `/:serverId` würde `/:serverId/panels` sonst
// nie erreichen lassen – dieselbe Falle wie früher bei den Migration-Routen
// hinter dem Catch-All in api.router.js.
// ════════════════════════════════════════════════════════════════════════

/**
 * GET …/servers/:serverId/panels
 * Panels des Servers samt Textkanal-Liste der Guild.
 * @permission GAMESERVER.VIEW
 */
router.get('/:serverId/panels', requirePermission('GAMESERVER.VIEW'), async (req, res) => {
    const Logger    = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const guildId  = res.locals.guildId;
        const serverId = req.params.serverId;

        const panels = await dbService.query(
            `SELECT id, channel_id, message_id, enabled, min_interval_s,
                    show_players, show_controls, show_refresh, last_pushed_at, last_error
             FROM gameserver_status_panels
             WHERE server_id = ? AND guild_id = ?
             ORDER BY id`,
            [serverId, guildId]
        );

        // Kanalnamen kennt nur der Bot. Dafür gibt es den Kern-Handler
        // GET_GUILD_CHANNELS – ein plugin-eigener wäre eine Dublette. Fällt der
        // Bot aus, bleibt die Liste leer; die vorhandenen Panels sind dann
        // trotzdem sichtbar und löschbar.
        let channels = [];
        if (ServiceManager.has('ipcServer')) {
            const responses = await ServiceManager.get('ipcServer')
                .broadcast('dashboard:GET_GUILD_CHANNELS', { guildId })
                .catch(() => []);
            const hit = (responses || []).find(r => r && r.success);
            if (hit) channels = hit.channels || [];
        }

        return res.json({ success: true, panels, channels });

    } catch (error) {
        Logger.error('[Gameserver] Panels nicht geladen:', error);
        return res.status(500).json({ success: false, error: 'Interner Serverfehler' });
    }
});

/**
 * POST …/servers/:serverId/panels
 * Legt ein Panel an und postet es sofort.
 * @permission GAMESERVER.EDIT
 */
router.post('/:serverId/panels', requirePermission('GAMESERVER.EDIT'), async (req, res) => {
    const Logger    = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const guildId  = res.locals.guildId;
        const serverId = Number(req.params.serverId);
        const { channel_id: channelId, show_players, show_controls, show_refresh, min_interval_s } = req.body;

        if (!channelId) {
            return res.status(400).json({ success: false, error: 'Kanal fehlt' });
        }

        // Server muss zur Guild gehören – die serverId kommt aus der URL.
        const [server] = await dbService.query(
            'SELECT id FROM gameservers WHERE id = ? AND guild_id = ? LIMIT 1',
            [serverId, guildId]
        );
        if (!server) {
            return res.status(404).json({ success: false, error: 'Server nicht gefunden' });
        }

        const panel = await PanelService.create({
            guildId,
            serverId,
            channelId:    String(channelId),
            showPlayers:  toBool(show_players),
            showControls: show_controls === undefined ? true : toBool(show_controls),
            showRefresh:  show_refresh  === undefined ? true : toBool(show_refresh),
            minIntervalS: Number(min_interval_s) || 60,
            createdBy:    res.locals.user?.id || null,
        });

        return res.json({ success: true, panel });

    } catch (error) {
        Logger.error('[Gameserver] Panel nicht angelegt:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PATCH …/servers/:serverId/panels/:panelId
 * Ändert die Schalter eines bestehenden Panels und aktualisiert die Nachricht.
 *
 * Nur mitgeschickte Felder werden angefasst – die Oberfläche schickt immer nur
 * den einen Schalter, den jemand umgelegt hat.
 *
 * @permission GAMESERVER.EDIT
 */
router.patch('/:serverId/panels/:panelId', requirePermission('GAMESERVER.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');

    try {
        const { show_players, show_controls, show_refresh, min_interval_s } = req.body;

        const panel = await PanelService.update({
            guildId:      res.locals.guildId,
            panelId:      Number(req.params.panelId),
            showPlayers:  show_players   === undefined ? undefined : toBool(show_players),
            showControls: show_controls  === undefined ? undefined : toBool(show_controls),
            showRefresh:  show_refresh   === undefined ? undefined : toBool(show_refresh),
            minIntervalS: min_interval_s === undefined ? undefined : Number(min_interval_s),
        });

        if (!panel) {
            return res.status(404).json({ success: false, error: 'Panel nicht gefunden' });
        }
        return res.json({ success: true, panel });

    } catch (error) {
        Logger.error('[Gameserver] Panel nicht geändert:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE …/servers/:serverId/panels/:panelId
 * Entfernt das Panel und löscht die Discord-Nachricht.
 * @permission GAMESERVER.EDIT
 */
router.delete('/:serverId/panels/:panelId', requirePermission('GAMESERVER.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');

    try {
        const removed = await PanelService.remove(Number(req.params.panelId), res.locals.guildId);
        if (!removed) {
            return res.status(404).json({ success: false, error: 'Panel nicht gefunden' });
        }
        return res.json({ success: true });

    } catch (error) {
        Logger.error('[Gameserver] Panel nicht entfernt:', error);
        return res.status(500).json({ success: false, error: error.message });
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

        Logger.info(`[Gameserver] ===== Detail-View START für Server ${serverId}, Guild ${guildId} =====`);

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
                gs.sftp_password_hash,
                gs.sftp_password_seen_at,
                gs.env_variables,
                am.name as game_name,
                am.slug as game_slug,
                am.icon_url as game_icon,
                am.game_data,
                r.name as rootserver_name,
                r.hostname as rootserver_hostname,
                r.host as rootserver_ip,
                r.daemon_id,
                r.sftp_fingerprint,
                r.sftp_port AS rootserver_sftp_port,
                r.system_user
            FROM gameservers gs
            LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
            LEFT JOIN rootserver r ON gs.rootserver_id = r.id
            WHERE gs.id = ? AND gs.guild_id = ?
        `, [serverId, guildId]);

        Logger.info(`[Gameserver] DB-Query abgeschlossen, Server gefunden: ${!!server}`);

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

        Logger.info(`[Gameserver] JSON-Parsing abgeschlossen (ports, game_data, env_variables)`);

        // Ports zum Server-Objekt hinzufügen (für einfacheren Zugriff in View)
        server.ip_address = server.rootserver_ip || 'N/A';
        server.port_game = ports.game?.external || ports.game?.internal || ports.main?.external || null;
        // Query-Port: nur zeigen, was tatsächlich allokiert ist.
        //
        // Der Daemon mappt ausschließlich Ports aus der ports-Spalte
        // (docker/container.go → BuildPortMap). Ein aus dem Addon errechneter Wert
        // ("game_plus_1" = Game-Port + 1) beschreibt also nur, was das Spiel
        // *erwartet* – nicht, was von außen erreichbar ist. Früher stand er
        // trotzdem als fertiger Port da, und die Abfrage lief ins Leere, während
        // die Oberfläche alles in Ordnung meldete.
        const queryPortVar = gameData?.query?.port_var || null;
        server.port_query = ports.query?.external || ports.query?.internal || null;
        // Merken, aus welchem Eintrag der Query-Port stammt: Die Ansicht listet
        // darunter alle übrigen Ports auf und würde ihn sonst ein zweites Mal
        // zeigen – bei Valheim als "Game_plus_1-Port" neben "Query-Port".
        server.port_query_key = server.port_query ? 'query' : null;

        if (!server.port_query && queryPortVar && ports[queryPortVar]) {
            server.port_query = ports[queryPortVar].external || ports[queryPortVar].internal || null;
            if (server.port_query) server.port_query_key = queryPortVar;
        }

        // Erwartet das Addon einen Port, der nicht allokiert ist, wird das benannt
        // statt verschwiegen – inklusive der Nummer, die angelegt werden muss.
        server.port_query_expected = null;
        if (!server.port_query && queryPortVar) {
            const plus = /^(.+)_plus_(\d+)$/.exec(queryPortVar);
            if (plus && ports[plus[1]]) {
                const base = ports[plus[1]].external || ports[plus[1]].internal;
                if (base) server.port_query_expected = base + parseInt(plus[2], 10);
            }
        }
        server.port_rcon = ports.rcon?.external || ports.rcon?.internal || null;
        server.ports_parsed = ports; // Original-Struktur für erweiterte Ansicht

        // RCON-Verfügbarkeit prüfen statt raten: Port muss auflösbar, Passwort gesetzt
        // und das Protokoll vom Daemon unterstützt sein. Vorher galt allein die
        // Existenz eines config.rcon-Blocks als "verfügbar" — die RCON-Konsole
        // erschien dadurch auch bei Servern, bei denen sie nicht funktionieren kann.
        const rcon = StatusService.resolveRcon({ gameData, ports, envVars: envVariables });
        server.rcon_available = rcon.available;
        server.rcon_configured = rcon.configured;
        server.rcon_reason = rcon.reason;
        server.rcon_protocol = rcon.protocol;
        server.port_rcon = server.port_rcon || rcon.port;

        // Letztes tatsächliches RCON-Ergebnis (aus Snapshot) für die Anzeige
        const statusSnapshot = await StatusService.getSnapshot(server.id);
        server.status_snapshot = statusSnapshot;
        server.rcon_last_ok = statusSnapshot?.rcon_ok ?? null;
        if (statusSnapshot) {
            // Live-Werte gewinnen über die Registry-Spalten
            server.current_players = statusSnapshot.players_current ?? server.current_players;
            server.max_players     = statusSnapshot.players_max     ?? server.max_players;
            server.current_map     = statusSnapshot.map             ?? server.current_map;
        }

        // Anzeige-Konfiguration (Spalten, Felder, Badges) aus dem Addon auflösen –
        // ersetzt die fest verdrahteten Tabellenspalten in der View
        server.status_display = resolveStatusConfig(gameData).display;

        // Detailseite offen → Poller darf diesen Server häufiger abfragen
        ServiceManager.get('gameserverStatusPoller')?.markInterest(server.id);

        // SFTP-Credentials: Normally set at creation time. Lazy-fallback only if missing.
        if (!server.sftp_username && server.system_user) {
            // Fallback für ältere Server die vor dem direkten SFTP-Setup angelegt wurden.
            // Das erzeugte Passwort wird bewusst nicht angezeigt — es taucht in
            // keiner Antwort auf, der Nutzer holt es sich über "Zurücksetzen".
            server.sftp_username = server.system_user;
            const nachgezogen = await _setzeSftpPasswort(dbService, {
                serverId: server.id,
                username: server.sftp_username,
                daemonId: server.daemon_id,
                guildId
            }).catch(err => {
                Logger.warn(`[Gameserver] SFTP-Credentials fehlgeschlagen: ${err.message}`);
                return null;
            });
            server.sftp_passwort_gesetzt = Boolean(nachgezogen);
            if (nachgezogen && !nachgezogen.synchronisiert) {
                Logger.warn(`[Gameserver] SFTP-Credentials (Fallback) für Server ${server.id} nicht zum Daemon übertragen: ${nachgezogen.fehler?.message}`);
            } else if (nachgezogen) {
                Logger.info(`[Gameserver] SFTP-Credentials (Fallback) generiert für Server ${server.id} (User: ${server.sftp_username})`);
            }
        } else if (server.sftp_username && server.system_user && server.sftp_username !== server.system_user) {
            // Username korrigieren falls abweichend
            server.sftp_username = server.system_user;
            await dbService.query(
                'UPDATE gameservers SET sftp_username = ? WHERE id = ?',
                [server.sftp_username, server.id]
            );

            // Der Daemon muss den neuen Namen auch erfahren. Ohne das zeigte
            // die Seite ab hier einen Benutzernamen an, den der Rootserver
            // nicht kennt — anmelden konnte man sich damit nicht.
            //
            // Auffallen kann das seit es den Umzug zwischen Rootservern gibt:
            // Der Name leitet sich vom system_user des Rootservers ab, und der
            // ist am Ziel oft ein anderer. Der Abgleich schickt den ganzen
            // Bestand, wodurch der alte Eintrag dort verschwindet; das
            // Passwort bleibt dasselbe.
            ServiceManager.get('ipmServer')?.syncSftpUsers(server.daemon_id)
                .catch(err => Logger.warn(`[Gameserver] SFTP-Abgleich nach Namensänderung fehlgeschlagen: ${err.message}`));

            Logger.info(`[Gameserver] SFTP-Username korrigiert für Server ${server.id} → ${server.sftp_username}`);
        }
        // Die View erfährt nur, OB ein Passwort gesetzt ist. Der Hash selbst hat
        // in der Antwort nichts verloren — er ist zwar nicht umkehrbar, aber
        // offline angreifbar, und die Seite braucht ihn für nichts.
        server.sftp_passwort_gesetzt = server.sftp_passwort_gesetzt || Boolean(server.sftp_password_hash);
        // Gesetzt heisst nicht bekannt: beim Anlegen wird der Klartext erzeugt
        // und sofort verworfen. Erst "Zuruecksetzen" zeigt ihn einmal.
        server.sftp_passwort_gesehen = Boolean(server.sftp_password_seen_at);
        delete server.sftp_password_hash;

        // SFTP-Verbindungsinfo anfügen (IP bevorzugen – Hostname ist oft nicht konfiguriert)
        server.sftp_host = server.rootserver_ip || server.rootserver_hostname || 'N/A';
        // Der Port kommt vom Daemon, der ihn aus seinem laufenden Listener liest.
        // Fehlt er, ist der Daemon zu alt oder SFTP dort abgeschaltet — dann gilt
        // 2022, der Wert, der hier bis dahin fest im Code stand.
        server.sftp_port = server.rootserver_sftp_port || 2022;
        // Der Fingerabdruck kommt vom Daemon bei jeder Anmeldung. Fehlt er, ist
        // der Daemon zu alt oder SFTP dort abgeschaltet — dann sagt die Anzeige
        // das auch, statt ein leeres Feld zu zeigen.

        Logger.info(`[Gameserver] SFTP-Config gesetzt, lade RootServers...`);
        Logger.success(`[Gameserver] Server ${server.name} (${server.id}) geladen für Detail-View`);

        // RootServers für Migration-Modal laden
        const rootServers = await dbService.query(
            `SELECT r.id, r.name, r.daemon_id, r.daemon_status
             FROM rootserver r
             WHERE r.guild_id = ?
             ORDER BY r.name ASC`,
            [guildId]
        );

        Logger.info(`[Gameserver] RootServers geladen (${rootServers.length}), registriere Assets...`);

        // Assets für Detail-View einreihen
        // monaco-loader + gameserver-file-manager werden vom Files-Partial eingereiht
        // (NACH xterm-Skripten – verhindert AMD-Konflikt)
        const assetManager = ServiceManager.get('assetManager');
        if (assetManager) {
            assetManager.enqueueScript('gameserver-sse');
            assetManager.enqueueScript('gameserver-actions');
        }

        Logger.info(`[Gameserver] Assets eingereiht, rendere View...`);

        // View rendern
        // gamedig_type für Live-Query-Panel in der View bereitstellen
        server.gamedig_type = gameData?.query?.gamedig_type || null;

        await themeManager.renderView(res, 'guild/server-detail', {
            title: `Server: ${server.name}`,
            activeMenu: `/guild/${guildId}/plugins/gameserver/servers`,
            server,
            gameData,
            guildId,
            user,
            rootServers,
            // Entscheidet, ob der Konsolen-Tab ein Eingabefeld zeigt (Konzept 23.3)
            consoleTransport: resolveConsoleTransport(gameData)
        });

    } catch (error) {
        Logger.error('[Gameserver] ===== FEHLER beim Laden der Server-Details =====');
        Logger.error('[Gameserver] Error Message:', error.message);
        Logger.error('[Gameserver] Error Stack:', error.stack);
        Logger.error('[Gameserver] Error Object:', error);
        
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
router.get('/:serverId/edit', requirePermission('GAMESERVER.EDIT'), async (req, res) => {
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
                gs.frozen_game_data,
                gs.rootserver_id,
                gs.allocated_ram_mb,
                gs.allocated_cpu_percent,
                gs.allocated_disk_gb,
                gs.disk_quota_enforced,
                gs.disk_quota_note,
                gs.backup_keep,
                gs.backup_keep_days,
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

        // frozen_game_data ist die Vorlage, gegen die der Server wirklich läuft –
        // nicht das Addon im Marktplatz, das inzwischen weitergezogen sein kann.
        let frozenData = {};
        try {
            frozenData = typeof server.frozen_game_data === 'string'
                ? JSON.parse(server.frozen_game_data) : (server.frozen_game_data || {});
        } catch (_) { /* unlesbar zählt als "nichts deklariert" */ }

        // Slot-Anzahl kommt aus der Addon-Variable, nicht aus der Spalte (Konzept 23.1).
        // Der Name der Variable wird nach derselben Reihenfolge gesucht wie der Wert,
        // Addon-Übersteuerung eingeschlossen – sonst zeigte die Anzeige einen Wert aus
        // der einen und einen Namen aus einer anderen Variable.
        const slots = StatusService.resolveMaxPlayers(server.env_variables, frozenData);
        const slotOverride = frozenData?.status?.merge?.max_players;
        const slotKandidaten = typeof slotOverride === 'string' && slotOverride.startsWith('variable:')
            ? [slotOverride.slice('variable:'.length), 'MAX_PLAYERS', 'MAXPLAYERS', 'SERVER_MAXPLAYERS', 'SLOTS']
            : ['MAX_PLAYERS', 'MAXPLAYERS', 'SERVER_MAXPLAYERS', 'SLOTS'];
        const slotVariable = slotKandidaten
            .find(k => parseInt(server.env_variables?.[k], 10) > 0) || null;

        // Welche Variablen kommen nirgends vor? (Konzept 23.2 – kennzeichnen, nicht verstecken)
        const variablen = beurteileVariablen(frozenData, server.env_variables);

        // ════════════════════════════════════════════════════════════════════
        // Wie viel darf dieser Server bekommen?
        //
        // Bis zum 2026-08-10 standen dort freie Zahlenfelder in MiB und Prozent,
        // und die Prüfung verlangte alle drei zusammen. Sechs von acht Servern
        // hatten NULL — wer dann nur den RAM eintrug, bekam beim Speichern
        // "CPU-Anteil, Speicherplatz fehlen" und kam nicht weiter.
        //
        // Jetzt bietet die Oberfläche nur an, was tatsächlich frei ist. Was der
        // Server heute schon hält, zählt dabei mit: es steckt in der Auslastung
        // des RootServers und darf ihm nicht ein zweites Mal fehlen.
        // ════════════════════════════════════════════════════════════════════
        let kapazitaet = null;
        try {
            const RootServerModel = require('../../../masterserver/dashboard/models/RootServer');
            const frei = await RootServerModel.getAvailableResources(server.rootserver_id);
            if (frei?.hasQuota) {
                kapazitaet = {
                    ramMB:    Math.floor(Number(frei.available_ram_mb    || 0)) + (server.allocated_ram_mb      || 0),
                    cpuCores: Number(frei.available_cpu_cores || 0) + ((server.allocated_cpu_percent || 0) / 100),
                    diskGB:   Math.floor(Number(frei.available_disk_gb   || 0)) + (server.allocated_disk_gb     || 0),
                };
            }
        } catch (err) {
            // Ohne Quota-Angaben bleibt die Oberfläche bei freien Feldern —
            // besser als eine Auswahl, die auf geratenen Obergrenzen beruht.
            Logger.warn(`[Gameserver] Kapazität für RootServer ${server.rootserver_id} nicht lesbar: ${err.message}`);
        }

        return await themeManager.renderView(res, 'guild/gameserver-edit', {
            kapazitaet,
            // "Einstellungen" ueberall gleich: der Knopf auf der Serverseite
            // heisst so, die Karte auf dieser Seite auch. Vorher stand hier
            // "Server bearbeiten" — drei Namen fuer dieselbe Sache, und der
            // User hat den Knopf deshalb nicht gefunden.
            title: `Einstellungen: ${server.name}`,
            activeMenu: `/guild/${guildId}/plugins/gameserver/servers`,
            server,
            guildId,
            slots,
            slotVariable,
            unbenutzteVariablen: variablen.filter(v => !v.verwendet)
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
router.put('/:serverId/start', requirePermission('GAMESERVER.START'), async (req, res) => {
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
                if (imgKeys.length > 0) startGameData.docker_image = imgKeys[0]; // KEY = Image-URL, nicht Value (Beschreibung)

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
router.put('/:serverId/stop', requirePermission('GAMESERVER.STOP'), async (req, res) => {
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
router.delete('/:serverId', requirePermission('GAMESERVER.DELETE'), async (req, res) => {
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

            // Der SFTP-Zugang muss mit dem Server verschwinden. Er lebt in der
            // Datenbank des Daemons weiter und würde sonst weiter angenommen:
            // Der Pfad-Auflöser setzt den Verzeichnisnamen nur zusammen und
            // meldet keinen Fehler, wenn es das Verzeichnis nicht mehr gibt.
            //
            // Der Abgleich schickt den verbliebenen Bestand des Rootservers und
            // löscht dort alles andere — deshalb genügt ein Aufruf ohne
            // eigenen Lösch-Befehl.
            if (server.daemon_id && ipmServer?.isDaemonOnline(server.daemon_id)) {
                ipmServer.syncSftpUsers(server.daemon_id)
                    .catch(err => Logger.warn(`[Gameserver] SFTP-Abgleich nach Löschen fehlgeschlagen: ${err.message}`));
            }

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
 * PUT /guild/:guildId/plugins/gameserver/servers/:serverId
 * Server-Einstellungen aktualisieren
 */
router.put('/:serverId', requirePermission('GAMESERVER.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    
    try {
        const guildId = res.locals.guildId;
        const { serverId } = req.params;
        // `max_players` wird bewusst NICHT mehr aus dem Formular übernommen
        // (Konzept 23.1): Die Slot-Anzahl steht in der Addon-Variable MAX_PLAYERS,
        // nur die landet im Startbefehl. Die Spalte ist eine abgeleitete Anzeige,
        // die der StatusPoller aus dem Snapshot pflegt. Wer sie hier von Hand
        // überschrieb, änderte am Spiel nichts - der Wert wanderte lautlos zurück,
        // sobald die nächste Abfrage durchlief.
        const {
            name, auto_restart, auto_update, env_variables,
            allocated_ram_mb, allocated_cpu_percent, allocated_disk_gb,
            backup_keep, backup_keep_days
        } = req.body;

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
            // `ports` gehoert dazu: die Portvariablen werden unten dagegen
            // geprueft. Ohne die Spalte liefe die Pruefung wirkungslos durch.
            `SELECT id, name, status, rootserver_id, ports, env_variables,
                    allocated_ram_mb, allocated_cpu_percent, allocated_disk_gb
             FROM gameservers WHERE id = ? AND guild_id = ?`,
            [serverId, guildId]
        );

        if (!server) {
            return res.status(404).json({
                success: false,
                message: 'Server nicht gefunden'
            });
        }

        // ════════════════════════════════════════════════════════════════════
        // Ressourcen ändern — inklusive Gegenprüfung gegen den RootServer
        //
        // Geprüft wird nur die *Differenz*: Was dieser Server bereits gebucht
        // hat, ist in der Auslastung schon enthalten und darf ihm nicht ein
        // zweites Mal angerechnet werden.
        // ════════════════════════════════════════════════════════════════════
        const ressourcenFelder = [allocated_ram_mb, allocated_cpu_percent, allocated_disk_gb];
        const ressourcenGesetzt = ressourcenFelder.some(v => v !== undefined && v !== null && v !== '');
        let neueRessourcen = null;

        if (ressourcenGesetzt) {
            const ramMB      = parseInt(allocated_ram_mb, 10);
            const cpuPercent = parseInt(allocated_cpu_percent, 10);
            const diskGB     = parseInt(allocated_disk_gb, 10);

            const fehlend = [];
            if (!Number.isFinite(ramMB)      || ramMB      < 512) fehlend.push('Arbeitsspeicher (mind. 512 MiB)');
            if (!Number.isFinite(cpuPercent) || cpuPercent < 10 || cpuPercent > 1600) fehlend.push('CPU-Anteil (10–1600 %)');
            if (!Number.isFinite(diskGB)     || diskGB     < 1)   fehlend.push('Speicherplatz (mind. 1 GiB)');

            if (fehlend.length) {
                return res.status(400).json({
                    success: false,
                    message: `Ungültige Ressourcenangabe: ${fehlend.join(', ')}`
                });
            }

            const mehrRamMB  = ramMB      - (server.allocated_ram_mb      || 0);
            const mehrCpuPct = cpuPercent - (server.allocated_cpu_percent || 0);
            const mehrDiskGB = diskGB     - (server.allocated_disk_gb     || 0);

            if (mehrRamMB > 0 || mehrCpuPct > 0 || mehrDiskGB > 0) {
                const RootServerModel = require('../../../masterserver/dashboard/models/RootServer');
                await RootServerModel.ensureQuota(server.rootserver_id);
                const platz = await RootServerModel.checkResourceAvailability(server.rootserver_id, {
                    ramMB:    Math.max(0, mehrRamMB),
                    cpuCores: Math.max(0, mehrCpuPct) / 100,
                    diskGB:   Math.max(0, mehrDiskGB)
                });

                if (!platz.available) {
                    const gruende = [];
                    if (platz.missing?.ram)  gruende.push(`${mehrRamMB} MiB mehr angefordert, ${Math.max(0, Math.round(platz.missing.ram.available))} MiB frei`);
                    if (platz.missing?.cpu)  gruende.push(`${mehrCpuPct} % mehr angefordert, ${Math.max(0, Math.round(platz.missing.cpu.available * 100))} % frei`);
                    if (platz.missing?.disk) gruende.push(`${mehrDiskGB} GiB mehr angefordert, ${Math.max(0, Math.round(platz.missing.disk.available))} GiB frei`);

                    return res.status(409).json({
                        success: false,
                        message: gruende.length
                            ? `Auf dem RootServer ist nicht genug frei — ${gruende.join('; ')}.`
                            : `Auf dem RootServer ist nicht genug frei (${platz.reason || 'Kapazität erschöpft'}).`,
                        missing: platz.missing || null
                    });
                }
            }

            neueRessourcen = { ramMB, cpuPercent, diskGB };
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

        // ════════════════════════════════════════════════════════════════════
        // Portvariablen gegen die Allocation prüfen (Baustellen 39)
        //
        // Eine Variable wie `RCON_PORT` trägt eine Portnummer. Wer sie von Hand
        // ändert, kann einen Port erwischen, den der RootServer gar nicht offen
        // hat — oder der einem anderen Server gehört. Das fiele erst beim
        // Verbinden auf, und dann sieht es nach einem kaputten Spiel aus.
        //
        // Erlaubt ist nur, was diesem Server als Allocation gehört. Beim Start
        // speist die Allocation die Variable ohnehin (`StartPayload`); diese
        // Prüfung sagt es dem Nutzer, statt seine Eingabe stillschweigend zu
        // überschreiben.
        // ════════════════════════════════════════════════════════════════════
        const serverPorts = (() => {
            try {
                return typeof server.ports === 'string' ? JSON.parse(server.ports) : (server.ports || {});
            } catch (_) { return {}; }
        })();
        const eigeneAllocations = new Set(
            Object.values(serverPorts)
                .map(p => String(p?.external ?? p?.internal ?? p))
                .filter(Boolean)
        );

        // Nur beanstanden, was in DIESEM Speichervorgang geaendert wurde.
        // Bestandsdaten tragen noch Portnummern aus der Zeit vor der Umstellung
        // (Server 159: RCON_PORT=27020, nie eine Allocation) — wer die pauschal
        // ablehnt, macht das Speichern genau der Server unmoeglich, die man
        // gerade reparieren will.
        const bisher = (() => {
            try {
                const roh = typeof server.env_variables === 'string'
                    ? JSON.parse(server.env_variables) : (server.env_variables || {});
                return roh || {};
            } catch (_) { return {}; }
        })();

        if (eigeneAllocations.size) {
            const verstoesse = [];
            for (const [name, wert] of Object.entries(envVarsJson)) {
                if (!/_PORT$/.test(name)) continue;
                const nummer = String(wert || '').trim();
                if (!nummer || !/^\d+$/.test(nummer)) continue;
                if (eigeneAllocations.has(nummer)) continue;
                if (String(bisher[name] ?? '').trim() === nummer) continue;  // unveraendert
                verstoesse.push({ name, nummer });
            }

            if (verstoesse.length) {
                const belegte = [...eigeneAllocations].sort((a, b) => Number(a) - Number(b)).join(', ');
                return res.status(400).json({
                    success: false,
                    message: verstoesse.map(v =>
                        `${v.name} = ${v.nummer} ist keiner der Ports dieses Servers`
                    ).join('; ') + `. Verfügbar sind: ${belegte}. `
                      + 'Portnummern kommen aus der Port-Verwaltung des RootServers, nicht aus dieser Variable.'
                });
            }
        }

        // Update ausführen
        const felder = ['name = ?', 'auto_restart = ?', 'auto_update = ?', 'env_variables = ?'];
        const werte  = [
            name.trim(),
            toBool(auto_restart) ? 1 : 0,
            toBool(auto_update) ? 1 : 0,
            JSON.stringify(envVarsJson)
        ];

        if (neueRessourcen) {
            felder.push('allocated_ram_mb = ?', 'allocated_cpu_percent = ?', 'allocated_disk_gb = ?');
            werte.push(neueRessourcen.ramMB, neueRessourcen.cpuPercent, neueRessourcen.diskGB);
        }

        // Backup-Aufbewahrung. Die Grenze haengt seit dem 2026-08-10 am Server,
        // damit sie auch dann gilt, wenn der Backup-Cronjob geloescht wird.
        // Ein leeres Feld heisst hier "unveraendert lassen", eine 0 heisst
        // "unbegrenzt" — deshalb keine Kurzform mit `|| 0`.
        const aufbewahrung = (wert) => {
            if (wert === undefined || wert === null || wert === '') return null;
            const n = Number.parseInt(wert, 10);
            if (!Number.isFinite(n) || n < 0) return 0;
            return Math.min(n, 65535);
        };
        const keep     = aufbewahrung(backup_keep);
        const keepDays = aufbewahrung(backup_keep_days);
        if (keep !== null)     { felder.push('backup_keep = ?');      werte.push(keep); }
        if (keepDays !== null) { felder.push('backup_keep_days = ?'); werte.push(keepDays); }

        werte.push(serverId, guildId);
        await dbService.query(
            `UPDATE gameservers SET ${felder.join(', ')} WHERE id = ? AND guild_id = ?`,
            werte
        );

        Logger.success(`[Gameserver] Server aktualisiert (ID: ${serverId})`);

        res.json({
            success: true,
            message: neueRessourcen
                ? `Server "${name}" aktualisiert — die neuen Ressourcen-Limits greifen beim nächsten Start.`
                : `Server "${name}" erfolgreich aktualisiert`
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
router.post('/:serverId/retry-installation', requirePermission('GAMESERVER.CREATE'), async (req, res) => {
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

        const paketErneut = await paketFuerInstall(
            dbService, server.addon_marketplace_id, Logger, `Server ${serverId} erneut installieren`);

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
            package: paketErneut,
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
router.post('/:serverId/start', requirePermission('GAMESERVER.START'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    
    try {
        const guildId = res.locals.guildId;
        const { serverId } = req.params;

        Logger.info(`[Gameserver] Start angefordert (ID: ${serverId})`);

        // Server-Daten laden (identisch zum Neustart-Pfad)
        const server = await loadServerForStart(dbService, serverId, guildId);

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

        // Payload zentral bauen: Template-Overrides, Variablen-Substitution,
        // Docker-Image, Runtime, Config-Patching und Auto-Update.
        // Dieselbe Funktion nutzen Neustart und Cronjob – sonst driften die Pfade
        // auseinander, wie es beim Restart bereits passiert war.
        const { payload: startPayload, error: payloadError, dockerImage } =
            buildStartPayload(server, guildId, Logger);

        if (payloadError) {
            Logger.error(`[Gameserver] ${payloadError} (Server ${serverId})`);
            return res.status(500).json({ success: false, message: payloadError });
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

        if (server.auto_update && !startPayload.steam_app_id) {
            Logger.warn(`[Gameserver] auto_update aktiv, aber keine Steam-AppID für Server ${serverId} – Update wird übersprungen`);
        }

        // IPM-Command an Daemon senden
        Logger.info(`[Gameserver] Sende Start-Command an Daemon ${server.daemon_id} (Image: ${dockerImage}${startPayload.auto_update ? ', mit Auto-Update' : ''})`);

        const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.start', startPayload, 30000);

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
router.post('/:serverId/stop', requirePermission('GAMESERVER.STOP'), async (req, res) => {
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
router.post('/:serverId/restart', requirePermission('GAMESERVER.RESTART'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    
    try {
        const guildId = res.locals.guildId;
        const { serverId } = req.params;

        Logger.info(`[Gameserver] Restart angefordert (ID: ${serverId})`);

        // Server-Daten laden (gleiche Felder wie beim Start – der Daemon braucht
        // beim Neustart dieselbe Konfiguration)
        const server = await loadServerForStart(dbService, serverId, guildId);

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

        // Vollständiges Payload wie beim Start: Image, Startup-Command, Ports und
        // Config leben nur im Speicher des Daemons. Nach einem Daemon-Neustart
        // stoppte ein Restart den Server sonst und scheiterte dann mit
        // "docker image not set".
        const { payload: restartPayload, error: payloadError } = buildStartPayload(server, guildId, Logger);
        if (payloadError) {
            return res.status(500).json({ success: false, message: payloadError });
        }

        const response = await ipmServer.sendCommand(server.daemon_id, 'gameserver.restart', restartPayload, 30000);

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
            // Auch die Neuinstallation läuft über das Paket, wenn es eines gibt.
            // Sie wird der Weg sein, über den die vorhandenen Server umziehen —
            // Datenerhalt ist dabei ausdrücklich NICHT gefordert (Betreiber,
            // 2026-08-19): Der Altbestand wird nicht gerettet.
            package: await paketFuerInstall(
                dbService, server.addon_marketplace_id, Logger, `Server ${serverId} neu installieren`),
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
// MIGRATION: Server zwischen RootServern verschieben
// POST /guild/:guildId/plugins/gameserver/servers/:serverId/migrate
// ============================================================
router.post('/:serverId/migrate', requirePermission('GAMESERVER.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const guildId = res.locals.guildId;
        const serverId = req.params.serverId;
        const { target_rootserver_id } = req.body;

        if (!target_rootserver_id) {
            return res.status(400).json({ success: false, message: 'target_rootserver_id erforderlich' });
        }

        const userId = req.user?.id || res.locals.userId || 'DASHBOARD';

        Logger.info(`[Gameserver] Migration-Request: Server ${serverId} -> RootServer ${target_rootserver_id} (User: ${userId})`);

        const MigrationManager = require('../helpers/MigrationManager.js');
        const result = await MigrationManager.startMigration(
            parseInt(serverId, 10),
            parseInt(target_rootserver_id, 10),
            String(userId),
            guildId
        );

        if (!result.success) {
            return res.status(400).json({ success: false, message: result.error });
        }

        return res.json({
            success: true,
            migration_id: result.migrationId,
            message: 'Migration gestartet. Du erhältst Live-Updates via SSE.'
        });

    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Starten der Migration:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler beim Starten der Migration' });
    }
});

// ============================================================
// MIGRATION STATUS: Abrufen des aktuellen Migration-Status
// GET /guild/:guildId/plugins/gameserver/servers/:serverId/migration/status
// ============================================================
router.get('/:serverId/migration/status', requirePermission('GAMESERVER.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const guildId = res.locals.guildId;
        const serverId = req.params.serverId;

        // Letzte Migration für diesen Server finden
        const [migration] = await dbService.query(
            `SELECT * FROM gameserver_migrations 
             WHERE server_id = ? 
             ORDER BY started_at DESC 
             LIMIT 1`,
            [serverId]
        );

        // Server-Infos hinzufügen
        const [server] = await dbService.query(
            'SELECT id, name, status FROM gameservers WHERE id = ? AND guild_id = ?',
            [serverId, guildId]
        );

        if (!server) {
            return res.status(404).json({ success: false, message: 'Server nicht gefunden' });
        }

        // "Noch nie migriert" ist der Normalfall, kein Fehler.
        //
        // Die Antwort war hier ein 404. Die Seite ruft den Status bei jedem
        // Aufruf ab, also erschien in den Entwicklerwerkzeugen bei praktisch
        // jedem Server ein roter Fehler — fuer einen voellig gesunden Zustand.
        // Das verdeckt echte Fehler, und genau dafuer schaut man dort hin.
        if (!migration) {
            return res.json({ success: true, migration: null, server: {
                id: server.id,
                name: server.name,
                status: server.status
            } });
        }

        return res.json({
            success: true,
            migration: {
                id: migration.id,
                status: migration.status,
                progress_percent: migration.progress_percent,
                current_step: migration.current_step,
                error_message: migration.error_message,
                started_at: migration.started_at,
                completed_at: migration.completed_at,
                source_rootserver_id: migration.source_rootserver_id,
                target_rootserver_id: migration.target_rootserver_id
            },
            server: {
                id: server.id,
                name: server.name,
                status: server.status
            }
        });

    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Abrufen des Migration-Status:', error);
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

        const { klartext, synchronisiert, fehler } = await _setzeSftpPasswort(dbService, {
            serverId: server.id,
            username: sftp_username,
            daemonId: server.daemon_id,
            guildId
        });

        if (!synchronisiert) {
            // Das alte Passwort gilt auf dem Rootserver weiter, das neue steht
            // schon in der Datenbank. Beides auszusprechen ist ehrlicher, als
            // ein Passwort auszugeben, das gerade nirgends funktioniert.
            Logger.warn(`[Gameserver] SFTP-Passwort für Server ${serverId} nicht zum Daemon übertragen: ${fehler?.message}`);
            return res.status(503).json({
                success: false,
                message: 'Der Rootserver war nicht erreichbar. Das neue Passwort ist noch nicht aktiv — '
                       + 'bitte erneut zurücksetzen, sobald er wieder online ist.'
            });
        }

        Logger.info(`[Gameserver] SFTP-Passwort zurückgesetzt für Server ${serverId}`);

        // Festhalten, dass der Klartext einmal sichtbar war. Ohne das steht auf
        // der Übersicht "Gesetzt" — auch für Passwörter, die beim Anlegen
        // erzeugt und sofort verworfen wurden und die nie jemand gesehen hat.
        await dbService.query(
            'UPDATE gameservers SET sftp_password_seen_at = NOW() WHERE id = ?',
            [serverId]
        );

        // Einzige Gelegenheit, den Klartext zu sehen — gespeichert ist nur der Hash.
        return res.json({ success: true, sftp_username, sftp_password: klartext });

    } catch (error) {
        Logger.error('[Gameserver] Fehler beim Zurücksetzen des SFTP-Passworts:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

// ============================================================
// SFTP-Helper: Credentials per IPM an Daemon synchronisieren
// ============================================================
// Übertragen wird der bcrypt-Hash, nicht das Passwort. Der Daemon vergleicht
// beim Anmelden dagegen — das Klartext-Passwort verlässt das Dashboard nie.
async function _syncSftpUserToDaemon(daemonId, serverId, username, passwordHash, guildId) {
    if (!daemonId) return;
    const ipmServer = ServiceManager.get('ipmServer');
    if (!ipmServer) return;
    await ipmServer.sendCommand(daemonId, 'sftp.user.sync', {
        server_id: serverId,
        guild_id: guildId,
        username,
        password_hash: passwordHash
    });
}

// Erzeugt ein neues SFTP-Passwort, legt nur dessen Hash ab und meldet ihn dem
// Daemon. Der zurückgegebene Klartext ist die einzige Gelegenheit, ihn zu
// zeigen — danach ist er nirgends mehr abrufbar.
//
// `synchronisiert` sagt, ob der Rootserver das neue Passwort auch bekommen hat.
// Ist er offline, gilt dort weiter das alte: Das Dashboard darf dann kein
// funktionierendes Passwort vortäuschen.
async function _setzeSftpPasswort(dbService, { serverId, username, daemonId, guildId }) {
    const klartext = crypto.randomBytes(10).toString('hex'); // 20 Zeichen hex
    const hash = await bcrypt.hash(klartext, 10);

    await dbService.query(
        'UPDATE gameservers SET sftp_username = ?, sftp_password_hash = ? WHERE id = ?',
        [username, hash, serverId]
    );

    let synchronisiert = true;
    let fehler = null;
    try {
        await _syncSftpUserToDaemon(daemonId, String(serverId), username, hash, guildId);
    } catch (err) {
        synchronisiert = false;
        fehler = err;
    }

    return { klartext, synchronisiert, fehler };
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

        // Discord-User für Rate-Limit und Protokoll - dieselbe Quelle wie in
        // routes/console.js, damit beide Wege auf denselben Zähler laufen.
        const userId = req.session?.user?.info?.id || res.locals.user?.info?.id || 'unknown';

        if (!command) {
            return res.status(400).json({ success: false, message: 'Befehl darf nicht leer sein' });
        }
        if (command.length > 512) {
            return res.status(400).json({ success: false, message: 'Befehl zu lang (max. 512 Zeichen)' });
        }

        // Rate-Limit vor der Datenbankarbeit: Ein Spammer soll keine Abfragen auslösen.
        const rateLimitCheck = rateLimiter.check(userId);
        if (!rateLimitCheck.allowed) {
            Logger.warn(`[RCON] Rate-Limit erreicht: User ${userId}`, { serverId, guildId });
            return res.status(429).json({ success: false, message: rateLimitCheck.error });
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

        // ports + env_variables parsen
        let ports = {};
        try { ports = typeof server.ports === 'string' ? JSON.parse(server.ports) : (server.ports || {}); } catch (_) { /* */ }
        let envVars = {};
        try { envVars = typeof server.env_variables === 'string' ? JSON.parse(server.env_variables) : (server.env_variables || {}); } catch (_) { /* */ }

        // Port, Passwort und Protokoll zentral auflösen (gleiche Prüfung wie in der View)
        const rcon = StatusService.resolveRcon({ gameData, ports, envVars });
        if (!rcon.available) {
            return res.status(400).json({ success: false, message: rcon.reason || 'RCON ist für diesen Gameserver nicht verfügbar' });
        }
        if (!server.daemon_id) {
            return res.status(400).json({ success: false, message: 'Kein Daemon für diesen Server konfiguriert' });
        }

        // Blacklist und Muster prüfen - erst hier, weil die Ausnahme aus dem Addon
        // kommt: Palworld stoppt per `shutdown 15`, und `shutdown` steht auf der
        // Blacklist. Der vom Spiel selbst deklarierte Stoppbefehl darf durch,
        // sonst sperrte der Schutzwall den regulären Weg.
        const stoppBefehl = String(gameData.startup?.stop || '').trim().split(/\s+/)[0];
        const validation = validateCommand(command, {
            userId,
            serverId,
            guildId,
            zusaetzlichErlaubt: stoppBefehl ? [stoppBefehl] : []
        });

        if (!validation.valid) {
            Logger.warn(`[RCON] Befehl blockiert: ${command}`, {
                userId, serverId, guildId, reason: validation.error
            });
            return res.status(400).json({ success: false, message: validation.error });
        }

        const rconPassword = envVars[gameData.config.rcon.password_var] || '';

        // sendCommand wirft, wenn der Daemon success:false meldet – die eigentliche
        // Meldung ("Verbindung abgelehnt", "falsches Passwort", …) steckt dann in
        // der Exception. Ohne dieses catch landete alles im generischen
        // "Serverfehler" und der Grund war nirgends sichtbar.
        let result;
        try {
            result = await ipmServer.sendCommand(server.daemon_id, 'gameserver.rcon', {
                guild_id: guildId,
                server_id: String(server.id),
                rcon_host: server.bind_ip || server.rootserver_ip || '127.0.0.1',
                rcon_port: rcon.port,
                rcon_password: rconPassword,
                rcon_protocol: rcon.protocol || 'srcds',
                rcon_command: validation.sanitized
            }, 15000);
        } catch (cmdError) {
            const reason = cmdError?.message || 'RCON-Befehl fehlgeschlagen';
            Logger.warn(`[Gameserver] RCON-Fehler für Server ${serverId}: ${reason}`);
            StatusService.recordRconResult(server.id, guildId, false, reason).catch(() => {});
            return res.json({ success: false, message: reason });
        }

        // Tatsächliches Ergebnis festhalten – davon lebt die RCON-Anzeige
        StatusService.recordRconResult(server.id, guildId, !!result?.success, result?.error)
            .catch(() => { /* Anzeige-Detail, kein Grund den Befehl scheitern zu lassen */ });

        if (!result?.success) {
            Logger.warn(`[Gameserver] RCON-Fehler für Server ${serverId}: ${result?.error}`);
            return res.json({ success: false, message: result?.error || 'RCON-Befehl fehlgeschlagen' });
        }

        Logger.info(`[Gameserver] RCON-Befehl ausgeführt (Server ${serverId}): ${validation.sanitized}`, {
            userId, remaining: rateLimitCheck.remaining
        });
        return res.json({ success: true, output: result.output || '' });

    } catch (error) {
        Logger.error('[Gameserver] RCON-Route Fehler:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler beim Ausführen des RCON-Befehls' });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// BACKUP ROUTEN
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /guild/:guildId/plugins/gameserver/servers/:serverId/backups
 * Backup-Liste für einen Server
 */
router.get('/:serverId/backups', requirePermission('GAMESERVER.BACKUPS.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const { serverId } = req.params;
        const guildId = res.locals.guildId;

        // Prüfen ob Server zur Guild gehört
        const [server] = await dbService.query(
            'SELECT id, name FROM gameservers WHERE id = ? AND guild_id = ?',
            [serverId, guildId]
        );
        if (!server) return res.status(404).json({ success: false, message: 'Server nicht gefunden' });

        const backups = await dbService.query(
            `SELECT id, name, size_bytes, status, note, created_by, created_at, completed_at, error_message
             FROM gameserver_backups
             WHERE server_id = ?
             ORDER BY created_at DESC`,
            [serverId]
        );

        return res.json({ success: true, backups: backups || [] });
    } catch (error) {
        Logger.error('[Gameserver/Backups] Fehler beim Laden der Backup-Liste:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

/**
 * POST /guild/:guildId/plugins/gameserver/servers/:serverId/backups
 * Neues Backup erstellen
 */
router.post('/:serverId/backups', requirePermission('GAMESERVER.BACKUPS.CREATE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const { serverId } = req.params;
        const guildId = res.locals.guildId;
        const userId = res.locals.user?.id || req.session?.user?.info?.id || 'unknown';
        const note = (req.body.note || '').substring(0, 500);

        // Server validieren
        const [server] = await dbService.query(
            'SELECT id, name, install_path FROM gameservers WHERE id = ? AND guild_id = ?',
            [serverId, guildId]
        );
        if (!server) return res.status(404).json({ success: false, message: 'Server nicht gefunden' });

        // Backup-Namen generieren: server-name_YYYY-MM-DD_HH-MM
        const now = new Date();
        const timestamp = now.toISOString().replace('T', '_').replace(/:/g, '-').slice(0, 16);
        const safeName = server.name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
        const backupName = `${safeName}_${timestamp}`;

        // Backup-Eintrag in DB erstellen
        const result = await dbService.query(
            `INSERT INTO gameserver_backups (server_id, guild_id, name, status, note, created_by)
             VALUES (?, ?, ?, 'pending', ?, ?)`,
            [serverId, guildId, backupName, note, userId]
        );
        const backupId = result.insertId;

        // Backup über IPM starten (asynchron – Status wird per SSE gemeldet)
        const ipmServer = ServiceManager.get('ipmServer');
        const [rootserver] = await dbService.query(
            'SELECT daemon_id FROM rootserver r JOIN gameservers gs ON gs.rootserver_id = r.id WHERE gs.id = ?',
            [serverId]
        );

        if (rootserver && ipmServer?.isDaemonOnline(rootserver.daemon_id)) {
            // Status auf 'running' setzen
            await dbService.query(
                "UPDATE gameserver_backups SET status = 'running' WHERE id = ?",
                [backupId]
            );

            ipmServer.sendCommand(rootserver.daemon_id, 'gameserver.backup', {
                server_id: String(serverId),
                backup_id: String(backupId),
                backup_name: backupName,
                install_path: server.install_path
            }, 300000)
                .then(async (r) => {
                    const size = r?.size_bytes || 0;
                    await dbService.query(
                        "UPDATE gameserver_backups SET status = 'completed', size_bytes = ?, completed_at = NOW() WHERE id = ?",
                        [size, backupId]
                    );
                    // SSE-Broadcast
                    const sseManager = ServiceManager.get('sseManager');
                    sseManager?.broadcast(guildId, 'gameserver', {
                        action: 'backup_completed', server_id: serverId, backup_id: backupId, backup_name: backupName
                    });
                })
                .catch(async (err) => {
                    await dbService.query(
                        "UPDATE gameserver_backups SET status = 'failed', error_message = ? WHERE id = ?",
                        [err.message || 'Backup fehlgeschlagen', backupId]
                    );
                    Logger.error(`[Gameserver/Backups] Backup ${backupId} fehlgeschlagen:`, err);
                });
        } else {
            // Daemon offline → als fehlgeschlagen markieren
            await dbService.query(
                "UPDATE gameserver_backups SET status = 'failed', error_message = 'Daemon offline' WHERE id = ?",
                [backupId]
            );
            Logger.warn(`[Gameserver/Backups] Daemon offline für Server ${serverId} – Backup ${backupId} fehlgeschlagen`);
        }

        return res.json({ success: true, message: 'Backup gestartet', backup_id: backupId, backup_name: backupName });
    } catch (error) {
        Logger.error('[Gameserver/Backups] Fehler beim Erstellen des Backups:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler beim Erstellen des Backups' });
    }
});

/**
 * DELETE /guild/:guildId/plugins/gameserver/servers/:serverId/backups/:backupId
 * Backup löschen
 */
router.delete('/:serverId/backups/:backupId', requirePermission('GAMESERVER.BACKUPS.DELETE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const { serverId, backupId } = req.params;
        const guildId = res.locals.guildId;

        const [backup] = await dbService.query(
            'SELECT id, name FROM gameserver_backups WHERE id = ? AND server_id = ? AND guild_id = ?',
            [backupId, serverId, guildId]
        );
        if (!backup) return res.status(404).json({ success: false, message: 'Backup nicht gefunden' });

        // Erst die Datei, dann die Zeile.
        //
        // Bis zum 2026-08-10 entfernte diese Route **nur** die DB-Zeile: das
        // tar.gz blieb auf dem Zielserver liegen, unsichtbar und für immer.
        // `DeleteBackupArchive` gab es im Daemon, es fehlte die Aktion dorthin.
        // Schlägt das Löschen fehl, bleibt auch die Zeile stehen – sonst
        // entsteht genau die verwaiste Datei wieder, die wir gerade abstellen.
        const ipmServer = ServiceManager.get('ipmServer');
        const [ziel] = await dbService.query(
            `SELECT r.daemon_id FROM gameservers gs
             LEFT JOIN rootserver r ON gs.rootserver_id = r.id
             WHERE gs.id = ?`,
            [serverId]
        );
        const daemonId = ziel?.daemon_id;

        if (!daemonId || !ipmServer?.isDaemonOnline(daemonId)) {
            return res.status(503).json({
                success: false,
                message: 'Der Daemon dieses Servers ist offline – das Backup lässt sich gerade nicht löschen.',
            });
        }

        const antwort = await ipmServer.sendCommand(daemonId, 'gameserver.backup_delete', {
            server_id: String(serverId),
            backup_name: backup.name,
        }, 30000);

        if (!antwort?.success) {
            Logger.warn(`[Gameserver/Backups] Archiv von Backup ${backupId} nicht gelöscht: ${antwort?.error || 'unbekannt'}`);
            return res.status(500).json({
                success: false,
                message: `Das Archiv konnte nicht gelöscht werden: ${antwort?.error || 'Der Daemon meldete keinen Erfolg'}`,
            });
        }

        await dbService.query('DELETE FROM gameserver_backups WHERE id = ?', [backupId]);

        Logger.info(`[Gameserver/Backups] Backup ${backupId} (${backup.name}) samt Archiv gelöscht`);
        return res.json({ success: true, message: 'Backup gelöscht' });
    } catch (error) {
        Logger.error('[Gameserver/Backups] Fehler beim Löschen des Backups:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

/**
 * POST /guild/:guildId/plugins/gameserver/servers/:serverId/backups/:backupId/restore
 * Backup wiederherstellen
 */
router.post('/:serverId/backups/:backupId/restore', requirePermission('GAMESERVER.BACKUPS.RESTORE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const { serverId, backupId } = req.params;
        const guildId = res.locals.guildId;

        const [backup] = await dbService.query(
            "SELECT id, name FROM gameserver_backups WHERE id = ? AND server_id = ? AND guild_id = ? AND status = 'completed'",
            [backupId, serverId, guildId]
        );
        if (!backup) return res.status(404).json({ success: false, message: 'Backup nicht gefunden oder nicht abgeschlossen' });

        const [server] = await dbService.query(
            'SELECT gs.id, gs.install_path, gs.status, r.daemon_id FROM gameservers gs LEFT JOIN rootserver r ON gs.rootserver_id = r.id WHERE gs.id = ? AND gs.guild_id = ?',
            [serverId, guildId]
        );
        if (!server) return res.status(404).json({ success: false, message: 'Server nicht gefunden' });

        if (server.status === 'online' || server.status === 'starting') {
            return res.status(400).json({ success: false, message: 'Server muss gestoppt sein bevor ein Backup wiederhergestellt werden kann' });
        }

        const ipmServer = ServiceManager.get('ipmServer');
        if (!ipmServer?.isDaemonOnline(server.daemon_id)) {
            return res.status(503).json({ success: false, message: 'Daemon ist offline' });
        }

        await dbService.query(
            "UPDATE gameserver_backups SET status = 'restoring' WHERE id = ?",
            [backupId]
        );

        ipmServer.sendCommand(server.daemon_id, 'gameserver.restore', {
            server_id: String(serverId),
            backup_id: String(backupId),
            backup_name: backup.name,
            install_path: server.install_path
        }, 300000)
            .then(async () => {
                await dbService.query(
                    "UPDATE gameserver_backups SET status = 'completed' WHERE id = ?",
                    [backupId]
                );
                const sseManager = ServiceManager.get('sseManager');
                sseManager?.broadcast(guildId, 'gameserver', {
                    action: 'restore_completed', server_id: serverId, backup_id: backupId
                });
            })
            .catch(async (err) => {
                await dbService.query(
                    "UPDATE gameserver_backups SET status = 'completed' WHERE id = ?",
                    [backupId]
                );
                Logger.error(`[Gameserver/Backups] Restore ${backupId} fehlgeschlagen:`, err);
            });

        return res.json({ success: true, message: 'Wiederherstellung gestartet' });
    } catch (error) {
        Logger.error('[Gameserver/Backups] Fehler beim Restore:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler beim Wiederherstellen' });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// CRONJOB ROUTEN
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /guild/:guildId/plugins/gameserver/servers/:serverId/cronjobs
 * Cronjob-Liste für einen Server
 */
router.get('/:serverId/cronjobs', requirePermission('GAMESERVER.CRONJOBS.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const { serverId } = req.params;
        const guildId = res.locals.guildId;

        const [server] = await dbService.query(
            'SELECT id, name FROM gameservers WHERE id = ? AND guild_id = ?',
            [serverId, guildId]
        );
        if (!server) return res.status(404).json({ success: false, message: 'Server nicht gefunden' });

        const cronjobs = await dbService.query(
            `SELECT id, name, cron_expr, action, command, run_once, enabled,
                    backup_keep, backup_keep_days,
                    last_run_at, next_run_at, last_status, last_message, created_at
             FROM gameserver_cronjobs
             WHERE server_id = ?
             ORDER BY created_at DESC`,
            [serverId]
        );

        return res.json({ success: true, cronjobs: cronjobs || [] });
    } catch (error) {
        Logger.error('[Gameserver/Cronjobs] Fehler beim Laden:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

/**
 * POST /guild/:guildId/plugins/gameserver/servers/:serverId/cronjobs
 * Neuen Cronjob erstellen
 */
router.post('/:serverId/cronjobs', requirePermission('GAMESERVER.CRONJOBS.MANAGE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const { serverId } = req.params;
        const guildId = res.locals.guildId;
        const userId = res.locals.user?.id || req.session?.user?.info?.id || 'unknown';

        const [server] = await dbService.query(
            'SELECT id FROM gameservers WHERE id = ? AND guild_id = ?',
            [serverId, guildId]
        );
        if (!server) return res.status(404).json({ success: false, message: 'Server nicht gefunden' });

        const { name, cron_expr, action, command, run_once, backup_keep, backup_keep_days } = req.body;

        // Validierung
        if (!name || !cron_expr || !action) {
            return res.status(400).json({ success: false, message: 'name, cron_expr und action sind Pflichtfelder' });
        }
        const allowedActions = ['start', 'stop', 'restart', 'backup', 'command'];
        if (!allowedActions.includes(action)) {
            return res.status(400).json({ success: false, message: 'Ungültige Aktion' });
        }
        if (action === 'command' && !command?.trim()) {
            return res.status(400).json({ success: false, message: 'command ist Pflichtfeld wenn action=command' });
        }
        // Einfache Cron-Validierung: 5 Felder
        if (cron_expr.trim().split(/\s+/).length !== 5) {
            return res.status(400).json({ success: false, message: 'Ungültige Cron-Expression (5 Felder erwartet, z.B. "0 4 * * *")' });
        }

        // Aufbewahrung gilt nur für Backup-Jobs. Eine Zahl an einem
        // Neustart-Job wäre stillschweigend wirkungslos, deshalb wird sie dort
        // gar nicht erst gespeichert.
        // NULL heisst "erbt die Servereinstellung", 0 heisst "ausdruecklich
        // unbegrenzt". Ein `|| 0` an dieser Stelle machte aus jedem geerbten
        // Wert ein "unbegrenzt", und niemand raeumte mehr auf.
        const grenze = (wert) => {
            if (wert === undefined || wert === null || wert === '') return null;
            const n = Number.parseInt(wert, 10);
            if (!Number.isFinite(n) || n < 0) return 0;
            return Math.min(n, 65535);
        };
        const keep     = action === 'backup' ? grenze(backup_keep) : null;
        const keepDays = action === 'backup' ? grenze(backup_keep_days) : null;

        const result = await dbService.query(
            `INSERT INTO gameserver_cronjobs (server_id, guild_id, name, cron_expr, action, command,
                                              backup_keep, backup_keep_days, run_once, enabled, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
            [serverId, guildId, name.substring(0, 128), cron_expr.trim(), action,
             action === 'command' ? command.trim() : null,
             keep, keepDays, run_once ? 1 : 0, userId]
        );

        Logger.info(`[Gameserver/Cronjobs] Cronjob ${result.insertId} erstellt für Server ${serverId}`);

        // CronWorker benachrichtigen
        const cronWorker = ServiceManager.get('gameserverCronWorker');
        if (cronWorker) {
            const [newJob] = await dbService.query(
                `SELECT cj.*, gs.name AS server_name, gs.install_path, r.daemon_id AS rootserver_daemon_id
                 FROM gameserver_cronjobs cj
                 JOIN gameservers gs ON gs.id = cj.server_id
                 LEFT JOIN rootserver r ON gs.rootserver_id = r.id
                 WHERE cj.id = ?`,
                [result.insertId]
            );
            if (newJob) cronWorker.add(newJob);
        }

        return res.json({ success: true, message: 'Cronjob erstellt', cronjob_id: result.insertId });
    } catch (error) {
        Logger.error('[Gameserver/Cronjobs] Fehler beim Erstellen:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

/**
 * PUT /guild/:guildId/plugins/gameserver/servers/:serverId/cronjobs/:cronjobId
 * Cronjob aktualisieren (Name, Cron-Expr, Enabled-State)
 */
router.put('/:serverId/cronjobs/:cronjobId', requirePermission('GAMESERVER.CRONJOBS.MANAGE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const { serverId, cronjobId } = req.params;
        const guildId = res.locals.guildId;

        const [job] = await dbService.query(
            'SELECT id FROM gameserver_cronjobs WHERE id = ? AND server_id = ? AND guild_id = ?',
            [cronjobId, serverId, guildId]
        );
        if (!job) return res.status(404).json({ success: false, message: 'Cronjob nicht gefunden' });

        const { name, cron_expr, action, command, enabled, run_once, backup_keep, backup_keep_days } = req.body;

        if (cron_expr && cron_expr.trim().split(/\s+/).length !== 5) {
            return res.status(400).json({ success: false, message: 'Ungültige Cron-Expression' });
        }
        if (action) {
            const allowedActions = ['start', 'stop', 'restart', 'backup', 'command'];
            if (!allowedActions.includes(action)) {
                return res.status(400).json({ success: false, message: 'Ungültige Aktion' });
            }
        }

        // `null` heisst hier "unverändert" (COALESCE). Eine 0 ist dagegen ein
        // gültiger Wert – "unbegrenzt" –, deshalb wird sie ausdrücklich
        // durchgereicht und nicht mit `|| null` verschluckt.
        const grenze = (wert) => {
            if (wert === undefined || wert === null || wert === '') return null;
            const n = Number.parseInt(wert, 10);
            if (!Number.isFinite(n) || n < 0) return 0;
            return Math.min(n, 65535);
        };

        await dbService.query(
            `UPDATE gameserver_cronjobs
             SET name = COALESCE(?, name),
                 cron_expr = COALESCE(?, cron_expr),
                 action = COALESCE(?, action),
                 command = COALESCE(?, command),
                 backup_keep = COALESCE(?, backup_keep),
                 backup_keep_days = COALESCE(?, backup_keep_days),
                 run_once = COALESCE(?, run_once),
                 enabled = COALESCE(?, enabled)
             WHERE id = ?`,
            [name?.substring(0, 128) || null, cron_expr?.trim() || null, action || null, command?.trim() || null,
             grenze(backup_keep), grenze(backup_keep_days),
             run_once !== undefined ? (run_once ? 1 : 0) : null, enabled !== undefined ? (enabled ? 1 : 0) : null, cronjobId]
        );

        // CronWorker benachrichtigen
        const cronWorker = ServiceManager.get('gameserverCronWorker');
        if (cronWorker) {
            const [updatedJob] = await dbService.query(
                `SELECT cj.*, gs.name AS server_name, gs.install_path, r.daemon_id AS rootserver_daemon_id
                 FROM gameserver_cronjobs cj
                 JOIN gameservers gs ON gs.id = cj.server_id
                 LEFT JOIN rootserver r ON gs.rootserver_id = r.id
                 WHERE cj.id = ?`,
                [cronjobId]
            );
            if (updatedJob) cronWorker.update(updatedJob);
        }

        return res.json({ success: true, message: 'Cronjob aktualisiert' });
    } catch (error) {
        Logger.error('[Gameserver/Cronjobs] Fehler beim Aktualisieren:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

/**
 * DELETE /guild/:guildId/plugins/gameserver/servers/:serverId/cronjobs/:cronjobId
 * Cronjob löschen
 */
router.delete('/:serverId/cronjobs/:cronjobId', requirePermission('GAMESERVER.CRONJOBS.MANAGE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const { serverId, cronjobId } = req.params;
        const guildId = res.locals.guildId;

        const [job] = await dbService.query(
            'SELECT id, name FROM gameserver_cronjobs WHERE id = ? AND server_id = ? AND guild_id = ?',
            [cronjobId, serverId, guildId]
        );
        if (!job) return res.status(404).json({ success: false, message: 'Cronjob nicht gefunden' });

        await dbService.query('DELETE FROM gameserver_cronjobs WHERE id = ?', [cronjobId]);

        // CronWorker benachrichtigen
        const cronWorker = ServiceManager.get('gameserverCronWorker');
        if (cronWorker) cronWorker.remove(Number(cronjobId));

        Logger.info(`[Gameserver/Cronjobs] Cronjob ${cronjobId} (${job.name}) gelöscht`);
        return res.json({ success: true, message: 'Cronjob gelöscht' });
    } catch (error) {
        Logger.error('[Gameserver/Cronjobs] Fehler beim Löschen:', error);
        return res.status(500).json({ success: false, message: 'Serverfehler' });
    }
});

module.exports = router;
