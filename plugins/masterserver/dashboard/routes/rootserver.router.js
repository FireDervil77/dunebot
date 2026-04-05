/**
 * Masterserver Plugin - RootServer Routes
 * 
 * Alle Routen für RootServer-Management
 * - Liste aller RootServer
 * - RootServer Details
 * - RootServer erstellen/bearbeiten/löschen
 * - Status-Management
 * 
 * @module masterserver/routes/rootserver
 * @author FireBot Team
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const RootServer = require('../models/RootServer');
const RootServer_getDaemon = async (guildId) => { const rows = await require('../models/RootServer').getByGuild(guildId); const rs = rows[0] || null; if (rs) { rs.status = rs.daemon_status; rs.version = rs.daemon_version; } return rs; };

// Helper: themeManager.renderView() wrapper
const renderView = async (res, viewPath, data) => {
    const themeManager = ServiceManager.get('themeManager');
    return await themeManager.renderView(res, viewPath, data);
};

// =====================================================
// Route: Rootserver-Liste
// GET /guild/:guildId/plugins/masterserver/rootservers
// =====================================================
router.get('/', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipmServer = ServiceManager.get('ipmServer');
    const guildId = res.locals.guildId;

    try {
        res.locals.pluginName = 'masterserver';
        req.params.pluginName = 'masterserver';

        // Noch kein RootServer → direkt zum Onboarding-Wizard
        const rootservers = await RootServer.getByGuild(guildId);
        if (!rootservers || rootservers.length === 0) {
            return res.redirect(`/guild/${guildId}/plugins/masterserver/rootservers/create`);
        }

        // Daemon Online-Status anhand des primären RootServers prüfen
        const primaryDaemonId = rootservers[0].daemon_id;
        const daemonOnline = ipmServer.isDaemonOnline(primaryDaemonId);
        
        // Daemon Hardware-Daten holen (falls online)
        const daemonHardware = daemonOnline ? ipmServer.getDaemonHardware(primaryDaemonId) : null;

        // Online-Status für jeden RootServer prüfen
        const rootserversWithStatus = rootservers.map(rs => ({
            ...rs,
            isOnline: ipmServer.isDaemonOnline(rs.daemon_id)
        }));

        // Status-Zusammenfassung berechnen
        const serverStats = {
            total: rootservers.length,
            active: rootservers.filter(rs => rs.daemon_status === 'online').length,
            maintenance: rootservers.filter(rs => rs.daemon_status === 'offline' || rs.install_status === 'installing').length,
            totalGameservers: rootservers.reduce((sum, rs) => sum + (parseInt(rs.gameserver_count) || 0), 0)
        };

        await renderView(res, 'guild/masterserver-rootservers', {
            title: 'RootServer',
            activeMenu: `/guild/${guildId}/plugins/masterserver/rootservers`,
            servers: rootserversWithStatus,
            serverStats,
            daemonOnline,
            daemonHardware,
            guildId
        });

    } catch (error) {
        Logger.error('[Masterserver] RootServer List Error:', error);
        res.status(500).render('error', { 
            message: 'Fehler beim Laden der RootServer-Liste',
            error: error.message 
        });
    }
});

// =====================================================
// Route: SSE-Events für RootServer-Metriken (Live-Push)
// GET /guild/:guildId/plugins/masterserver/rootservers/events
// ⚠️ MUSS VOR /:id stehen, sonst wird "events" als ID interpretiert!
// =====================================================
router.get('/events', (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const sseManager = ServiceManager.get('sseManager');
    const guildId = res.locals.guildId;

    try {
        const sessionUser = req.session?.user;
        const localUser = res.locals.user;
        const userId = localUser?.id || sessionUser?.info?.id || 'anonymous';
        const clientId = `ms-${userId}-${Date.now()}`;

        // Optional: Filter auf bestimmten RootServer
        const daemonFilter = req.query.daemon_id ?
            (message) => {
                return message.data && message.data.daemon_id === req.query.daemon_id;
            } : null;

        sseManager.addClient(guildId, clientId, res, {
            filter: daemonFilter,
            metadata: {
                userId,
                source: 'masterserver',
                daemonId: req.query.daemon_id || null
            }
        });

        Logger.info(`[Masterserver SSE] Client ${clientId} connected (Guild: ${guildId})`);
    } catch (error) {
        Logger.error('[Masterserver SSE] Fehler:', error);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'SSE-Fehler' });
        }
    }
});

// =====================================================
// Route: RootServer erstellen (Wizard)
// GET /guild/:guildId/plugins/masterserver/rootservers/create
// =====================================================
router.get('/create', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;

    try {
        res.locals.pluginName = 'masterserver';
        req.params.pluginName = 'masterserver';

        // Quota-Profile laden
        const quotaProfiles = await dbService.query(
            `SELECT * FROM quota_profiles WHERE is_active = 1 ORDER BY ram_mb ASC`
        );

        // Daemon-Hardware-Daten (falls ein primärer RootServer schon online)
        const ipmServer = ServiceManager.get('ipmServer');
        const existingRS = (await RootServer.getByGuild(guildId))[0] || null;
        const daemonOnline = existingRS ? ipmServer.isDaemonOnline(existingRS.daemon_id) : false;
        const daemonHardware = daemonOnline ? (ipmServer.getDaemonHardware(existingRS.daemon_id) || null) : null;

        await renderView(res, 'guild/masterserver-rootserver-create', {
            title: 'RootServer erstellen',
            activeMenu: `/guild/${guildId}/plugins/masterserver/rootservers`,
            guildId,
            quotaProfiles,
            daemonHardware,
            daemonOnline
        });

    } catch (error) {
        Logger.error('[Masterserver] RootServer Create Wizard Error:', error);
        res.status(500).render('error', { 
            message: 'Fehler beim Laden des Setup-Wizards',
            error: error.message 
        });
    }
});

// =====================================================
// Route: RootServer erstellen (POST - Simplified)
// POST /guild/:guildId/plugins/masterserver/rootservers
// =====================================================
router.post('/', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;

    try {
        const { 
            name, host, daemonPort, description, hostname,
            cpuCores, ramTotal, diskTotal,
            quotaProfileId,
            backupLimit, mysqlEnabled, mysqlDbLimit, webDomain,
            datacenter, countryCode,
            fqdn, fastdlEnabled, fastdlUrl
        } = req.body;

        // Validierung
        if (!name || !ramTotal || !diskTotal) {
            return res.status(400).json({
                success: false,
                message: 'Pflichtfelder fehlen: Name, RAM, Disk'
            });
        }

        // ✅ Auto-Generated Values (NEW Format - gs-guild_ Prefix!)
        // WICHTIG: Guild-ID auf 10 Zeichen kürzen (Linux Username Limit bei System-Usern)
        const shortGuildId = guildId.substring(0, 10);
        const systemUser = `guild_${shortGuildId}`;  // Daemon fügt "gs-" Präfix hinzu!
        const baseDirectory = '/opt/firebot';
        const guildDirectory = `/opt/firebot/guilds/${guildId}`;

        // RootServer erstellen
        const result = await RootServer.create({
            guildId,
            ownerUserId: res.locals.user?.id || null, // Discord User ID aus Session (optional)
            name,
            host,
            daemonPort: parseInt(daemonPort) || 9340,
            systemUser,
            baseDirectory,
            description: description || null,
            hostname: hostname || null,
            fqdn: fqdn || null,
            fastdlEnabled: fastdlEnabled === 'true' || fastdlEnabled === true,
            fastdlUrl: fastdlUrl || null,
            // Hardware-Specs (CPU optional, wird vom Daemon auto-detected)
            cpuCores: cpuCores ? parseFloat(cpuCores) : null,
            cpuThreads: null, // Auto-detected
            cpuModel: null,   // Auto-detected
            ramTotalGb: parseFloat(ramTotal),
            diskTotalGb: parseFloat(diskTotal),
            // Neue Features
            backupLimit: parseInt(backupLimit) || 3,
            mysqlEnabled: mysqlEnabled === 'true' || mysqlEnabled === true,
            mysqlDbLimit: parseInt(mysqlDbLimit) || 0,
            webDomain: webDomain || null
        });

        Logger.info(`[Masterserver] RootServer created: ${result.id} (${result.daemonId}) by ${systemUser}`);

        // ✅ Virtual Server im Daemon erstellen (wenn Daemon online)
        const ipmServer = ServiceManager.get('ipmServer');
        const daemon = await RootServer_getDaemon(guildId);
        
        if (daemon && ipmServer.isDaemonOnline(daemon.daemon_id)) {
            try {
                Logger.info(`[Masterserver] Erstelle Virtual Server für RootServer ${result.id} im Daemon...`);
                Logger.debug(`[Masterserver] systemUser: "${systemUser}" (Länge: ${systemUser.length})`);
                Logger.debug(`[Masterserver] guildId: "${guildId}" (Länge: ${guildId.length})`);
                
                // Neue Filesystem-Struktur: {base_dir}/{username}/rootserver_{id}/
                const vServerResponse = await ipmServer.sendCommand(daemon.daemon_id, 'virtual.create', {
                    daemon_id: daemon.daemon_id,     // ✅ NEUER Parameter: daemon_id (nicht server_id!)
                    rootserver_id: result.id,        // RootServer DB-ID für Unterverzeichnis
                    guild_id: guildId,               // Guild-ID für SQLite-Cache
                    server_name: name,               // Display-Name
                    username: systemUser,            // gs-guild_XXXXX
                    ram_limit_gb: parseFloat(ramTotal),
                    disk_limit_gb: parseFloat(diskTotal),
                    custom_path: null,
                    // Neue Features an Daemon übergeben
                    mysql_enabled: mysqlEnabled === 'true' || mysqlEnabled === true,
                    web_domain: webDomain || null
                }, 180000);  // 3 Minuten Timeout (SteamCMD Installation!)

                if (vServerResponse.success) {
                    Logger.success(`[Masterserver] Virtual Server erstellt: ${vServerResponse.data?.server_path || 'unknown'}`);
                    
                    // Install-Status auf 'completed' setzen
                    await dbService.query(
                        'UPDATE rootserver SET install_status = ? WHERE id = ?',
                        ['completed', result.id]
                    );
                } else {
                    Logger.error(`[Masterserver] Virtual Server Setup fehlgeschlagen: ${vServerResponse.error}`);
                    // Nicht kritisch - User kann Setup später manuell triggern
                }
            } catch (vServerError) {
                Logger.error('[Masterserver] Virtual Server Creation Error:', vServerError);
                // Nicht kritisch - RootServer wurde erstellt, Virtual Server kann später erstellt werden
            }
        } else {
            Logger.warn('[Masterserver] Daemon offline - Virtual Server muss später erstellt werden');
        }

        // Quota-Profil zuweisen (wenn vorhanden UND nicht "none")
        if (quotaProfileId && quotaProfileId !== '' && quotaProfileId !== 'none') {
            try {
                // Quota-Profil-Daten laden
                const [profile] = await dbService.query(
                    'SELECT * FROM quota_profiles WHERE id = ?',
                    [quotaProfileId]
                );

                if (profile) {
                    // Quota-Eintrag in rootserver_quotas erstellen (ohne custom overrides)
                    await dbService.query(
                        `INSERT INTO rootserver_quotas 
                         (rootserver_id, profile_id, custom_ram_mb, custom_cpu_cores, custom_disk_gb, created_at, updated_at)
                         VALUES (?, ?, NULL, NULL, NULL, NOW(), NOW())`,
                        [result.id, quotaProfileId]
                    );

                    Logger.info(`[Masterserver] Quota Profile ${quotaProfileId} assigned to RootServer ${result.id}`);
                }
            } catch (quotaError) {
                Logger.error('[Masterserver] Quota assignment failed:', quotaError);
                // Nicht kritisch - RootServer wurde erstellt
            }
        }

        res.json({
            success: true,
            message: 'RootServer erfolgreich erstellt! Sie werden zur Details-Seite weitergeleitet...',
            data: {
                id: result.id,
                daemonId: result.daemonId,
                apiKey: result.apiKey,
                host: host || null,
                redirectUrl: `/guild/${guildId}/plugins/masterserver/rootservers/${result.id}`
            }
        });

    } catch (error) {
        Logger.error('[Masterserver] RootServer Create Error:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Erstellen des RootServers',
            error: error.message
        });
    }
});

// =====================================================
// Route: RootServer Details
// GET /guild/:guildId/plugins/masterserver/rootservers/:id
// =====================================================
router.get('/:id', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipmServer = ServiceManager.get('ipmServer');
    const guildId = res.locals.guildId;
    const rootserverId = req.params.id;

    try {
        res.locals.pluginName = 'masterserver';
        req.params.pluginName = 'masterserver';

        // RootServer laden
        const rootserver = await RootServer.getById(rootserverId);

        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).render('error', {
                message: 'RootServer nicht gefunden'
            });
        }

        // Online-Status prüfen
        const isOnline = ipmServer.isDaemonOnline(rootserver.daemon_id);

        // Gameserver-Statistiken und Liste für diesen RootServer laden
        const dbService = ServiceManager.get('dbService');
        const gameservers = await dbService.query(
            `SELECT sr.server_id, sr.server_name, sr.server_type, sr.status,
                    sr.current_players, sr.cpu_percent, sr.ram_used_mb, sr.ram_total_mb,
                    sr.last_heartbeat,
                    gs.name AS display_name, gs.template_name AS game_name, gs.max_players
             FROM server_registry sr
             LEFT JOIN gameservers gs ON gs.id = sr.server_id
             WHERE sr.daemon_id = ?
             ORDER BY sr.server_name ASC`,
            [rootserver.daemon_id]
        );

        const gameserverStats = {
            total: gameservers.length,
            running: gameservers.filter(g => g.status === 'online').length,
            stopped: gameservers.filter(g => g.status === 'offline').length
        };

        await renderView(res, 'guild/masterserver-rootserver-detail', {
            title: `RootServer: ${rootserver.name}`,
            activeMenu: `/guild/${guildId}/plugins/masterserver/rootservers`,
            rootserver,
            isOnline,
            gameserverStats,
            gameservers,
            guildId
        });

    } catch (error) {
        Logger.error('[Masterserver] RootServer Details Error:', error);
        res.status(500).render('error', { 
            message: 'Fehler beim Laden der RootServer-Details',
            error: error.message 
        });
    }
});

// =====================================================
// Route: RootServer bearbeiten (PUT)
// PUT /guild/:guildId/plugins/masterserver/rootservers/:id
// =====================================================
router.put('/:id', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const rootserverId = req.params.id;

    try {
        // RootServer laden und Berechtigung prüfen
        const rootserver = await RootServer.getById(rootserverId);

        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).json({
                success: false,
                message: 'RootServer nicht gefunden'
            });
        }

        const { name, host, daemon_port, hostname, datacenter, country_code, description, ram_total_gb, disk_total_gb } = req.body;

        // RootServer aktualisieren
        await RootServer.update(rootserverId, {
            name,
            host,
            daemon_port,
            hostname,
            datacenter,
            country_code,
            description,
            ram_total_gb:  ram_total_gb ? parseFloat(ram_total_gb) : undefined,
            disk_total_gb: disk_total_gb ? parseFloat(disk_total_gb) : undefined,
        });

        Logger.info(`[Masterserver] RootServer updated: ${rootserverId}`);

        res.json({
            success: true,
            message: 'RootServer erfolgreich aktualisiert'
        });

    } catch (error) {
        Logger.error('[Masterserver] RootServer Update Error:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Aktualisieren des RootServers',
            error: error.message
        });
    }
});

// =====================================================
// Route: RootServer löschen (DELETE)
// DELETE /guild/:guildId/plugins/masterserver/rootservers/:id
// =====================================================
router.delete('/:id', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const rootserverId = req.params.id;

    try {
        // RootServer laden und Berechtigung prüfen
        const rootserver = await RootServer.getById(rootserverId);

        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).json({
                success: false,
                message: 'RootServer nicht gefunden'
            });
        }

        // TODO: Prüfe ob noch Gameserver aktiv sind

        // RootServer löschen
        await RootServer.delete(rootserverId);

        Logger.info(`[Masterserver] RootServer deleted: ${rootserverId}`);

        res.json({
            success: true,
            message: 'RootServer erfolgreich gelöscht'
        });

    } catch (error) {
        Logger.error('[Masterserver] RootServer Delete Error:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Löschen des RootServers',
            error: error.message
        });
    }
});

// =====================================================
// Route: RootServer Status (Live-Daten)
// GET /guild/:guildId/plugins/masterserver/rootservers/:id/status
// =====================================================
router.get('/:id/status', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipmServer = ServiceManager.get('ipmServer');
    const guildId = res.locals.guildId;
    const rootserverId = req.params.id;

    try {
        // RootServer laden
        const rootserver = await RootServer.getById(rootserverId);

        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).json({
                success: false,
                message: 'RootServer nicht gefunden'
            });
        }

        // Online-Status prüfen
        const isOnline = ipmServer.isDaemonOnline(rootserver.daemon_id);

        // Live Hardware-Daten aus IPM-Verbindung
        const hw = isOnline ? (ipmServer.getDaemonHardware(rootserver.daemon_id) || {}) : {};
        const systemResources = {
            cpu_percent:  hw.cpu?.usage_percent  ?? rootserver.cpu_usage_percent  ?? null,
            ram_used_gb:  hw.ram?.used_gb        ?? rootserver.ram_usage_gb        ?? null,
            ram_total_gb: hw.ram?.total_gb       ?? rootserver.ram_total_gb        ?? null,
            disk_used_gb: hw.disk?.used_gb       ?? rootserver.disk_usage_gb       ?? null,
            disk_total_gb:hw.disk?.total_gb      ?? rootserver.disk_total_gb       ?? null,
            network:      hw.network             ?? null,
        };

        res.json({
            success: true,
            data: {
                status:          rootserver.daemon_status,
                isOnline,
                lastPingMs:      rootserver.last_ping_ms,
                version:         rootserver.daemon_version,
                osInfo:          rootserver.os_info,
                systemResources,
            }
        });

    } catch (error) {
        Logger.error('[Masterserver] RootServer Status Error:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Abrufen des Status',
            error: error.message
        });
    }
});

// =====================================================
// Route: RootServer löschen
// DELETE /guild/:guildId/plugins/masterserver/rootservers/:id
// =====================================================
router.delete('/:id', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const ipmServer = ServiceManager.get('ipmServer');
    const guildId = res.locals.guildId;
    const rootserverId = req.params.id;

    try {
        Logger.info(`[Masterserver] RootServer ${rootserverId} wird gelöscht...`);

        // 1. RootServer aus DB laden
        const rootserver = await RootServer.getById(rootserverId);

        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).json({
                success: false,
                message: 'RootServer nicht gefunden oder keine Berechtigung'
            });
        }

        // 2. Prüfen ob Gameserver darauf laufen
        const gameserverCount = await dbService.query(
            'SELECT COUNT(*) as count FROM gameservers WHERE rootserver_id = ?',
            [rootserverId]
        );

        if (gameserverCount[0].count > 0) {
            return res.status(400).json({
                success: false,
                message: `RootServer kann nicht gelöscht werden: ${gameserverCount[0].count} Gameserver noch aktiv!`
            });
        }

        // 3. Virtual Server im Daemon löschen (wenn online)
        const daemon = await RootServer_getDaemon(guildId);
        
        if (daemon && ipmServer.isDaemonOnline(daemon.daemon_id)) {
            try {
                Logger.info(`[Masterserver] Sende virtual.delete Command an Daemon für RootServer ${rootserverId}`);
                
                const deleteResponse = await ipmServer.sendCommand(daemon.daemon_id, 'virtual.delete', {
                    daemon_id: rootserver.daemon_id,
                    rootserver_id: rootserverId
                }, 30000);

                if (deleteResponse.success) {
                    Logger.success(`[Masterserver] Virtual Server ${rootserverId} im Daemon gelöscht`);
                } else {
                    Logger.warn(`[Masterserver] Virtual Server konnte nicht gelöscht werden: ${deleteResponse.error}`);
                }
            } catch (deleteError) {
                Logger.error('[Masterserver] Virtual Server Delete Error:', deleteError);
                // Nicht kritisch - RootServer wird trotzdem aus DB gelöscht
            }
        } else {
            Logger.warn(`[Masterserver] Daemon offline - Virtual Server ${rootserverId} muss manuell gelöscht werden`);
        }

        // 4. RootServer aus Datenbank löschen
        await dbService.query(
            'DELETE FROM rootserver WHERE id = ? AND guild_id = ?',
            [rootserverId, guildId]
        );

        Logger.success(`[Masterserver] RootServer ${rootserverId} erfolgreich gelöscht`);

        res.json({
            success: true,
            message: 'RootServer erfolgreich gelöscht!'
        });

    } catch (error) {
        Logger.error('[Masterserver] RootServer Delete Error:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Löschen des RootServers',
            error: error.message
        });
    }
});

// =====================================================
// Route: Vom Daemon bekannte Host-IPs (aus HardwareStats.Network)
// GET /guild/:guildId/plugins/masterserver/rootservers/:id/host-ips
// =====================================================
router.get('/:id/host-ips', async (req, res) => {
    const ipmServer = ServiceManager.get('ipmServer');
    const guildId = res.locals.guildId;
    const rootserverId = req.params.id;
    try {
        const rootserver = await RootServer.getById(rootserverId);
        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).json({ success: false, message: 'RootServer nicht gefunden' });
        }
        const hardware = ipmServer.getDaemonHardware(rootserver.daemon_id);
        if (!hardware || !hardware.network || !hardware.network.interfaces) {
            return res.json({ success: true, data: [] });
        }
        // Alle IPv4-Adressen aus physischen/echten Interfaces sammeln
        // Docker/virtuelle Bridge-Interfaces ausschließen
        const VIRTUAL_IFACE_PREFIXES = ['docker', 'br-', 'veth', 'virbr', 'cni', 'flannel', 'cali', 'tunl', 'weave'];
        const ips = [];
        for (const iface of hardware.network.interfaces) {
            if (iface.is_loopback || !iface.is_up) continue;
            // Virtuelle/Docker-Interfaces überspringen
            const name = (iface.name || '').toLowerCase();
            if (VIRTUAL_IFACE_PREFIXES.some(p => name.startsWith(p))) continue;
            for (const addr of (iface.addresses || [])) {
                // Nur IPv4 (kein ":" = kein IPv6), kein 127.x
                if (!addr.includes(':') && !addr.startsWith('127.')) {
                    // CIDR-Notation entfernen falls vorhanden
                    const ip = addr.split('/')[0];
                    ips.push({ ip, interface: iface.name });
                }
            }
        }
        res.json({ success: true, data: ips });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// =====================================================
// Route: IP-Adressen eines RootServers auflisten
// GET /guild/:guildId/plugins/masterserver/rootservers/:id/ips
// =====================================================
router.get('/:id/ips', async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const rootserverId = req.params.id;
    try {
        const rootserver = await RootServer.getById(rootserverId);
        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).json({ success: false, message: 'RootServer nicht gefunden' });
        }
        const ips = await dbService.query(
            'SELECT * FROM rootserver_ips WHERE rootserver_id = ? ORDER BY is_primary DESC, created_at ASC',
            [rootserverId]
        );
        res.json({ success: true, data: ips });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// =====================================================
// Route: IP-Adresse hinzufügen
// POST /guild/:guildId/plugins/masterserver/rootservers/:id/ips
// =====================================================
router.post('/:id/ips', async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const rootserverId = req.params.id;
    try {
        const rootserver = await RootServer.getById(rootserverId);
        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).json({ success: false, message: 'RootServer nicht gefunden' });
        }
        const { ip_address, label, is_primary } = req.body;
        if (!ip_address || !/^[\d.:a-fA-F]+$/.test(ip_address)) {
            return res.status(400).json({ success: false, message: 'Ungültige IP-Adresse' });
        }
        // Wenn neue IP primär → alle anderen nicht-primär setzen
        if (is_primary) {
            await dbService.query(
                'UPDATE rootserver_ips SET is_primary = 0 WHERE rootserver_id = ?',
                [rootserverId]
            );
        }
        const result = await dbService.query(
            'INSERT INTO rootserver_ips (rootserver_id, ip_address, label, is_primary) VALUES (?, ?, ?, ?)',
            [rootserverId, ip_address.trim(), label || null, is_primary ? 1 : 0]
        );
        res.json({ success: true, data: { id: result.insertId, ip_address, label, is_primary: !!is_primary } });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, message: 'Diese IP ist bereits eingetragen' });
        }
        res.status(500).json({ success: false, message: error.message });
    }
});

// =====================================================
// Route: IP-Adresse entfernen
// DELETE /guild/:guildId/plugins/masterserver/rootservers/:id/ips/:ipId
// =====================================================
router.delete('/:id/ips/:ipId', async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const { id: rootserverId, ipId } = req.params;
    try {
        const rootserver = await RootServer.getById(rootserverId);
        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).json({ success: false, message: 'RootServer nicht gefunden' });
        }
        // Prüfen ob die IP noch von einem Gameserver genutzt wird
        const [used] = await dbService.query(
            'SELECT id FROM rootserver_ips WHERE id = ? AND rootserver_id = ?',
            [ipId, rootserverId]
        );
        if (!used) {
            return res.status(404).json({ success: false, message: 'IP nicht gefunden' });
        }
        await dbService.query('DELETE FROM rootserver_ips WHERE id = ?', [ipId]);
        res.json({ success: true, message: 'IP-Adresse entfernt' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// =====================================================
// Route: IP als primär setzen
// PUT /guild/:guildId/plugins/masterserver/rootservers/:id/ips/:ipId/primary
// =====================================================
router.put('/:id/ips/:ipId/primary', async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const { id: rootserverId, ipId } = req.params;
    try {
        const rootserver = await RootServer.getById(rootserverId);
        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).json({ success: false, message: 'RootServer nicht gefunden' });
        }
        await dbService.query('UPDATE rootserver_ips SET is_primary = 0 WHERE rootserver_id = ?', [rootserverId]);
        await dbService.query('UPDATE rootserver_ips SET is_primary = 1 WHERE id = ? AND rootserver_id = ?', [ipId, rootserverId]);
        res.json({ success: true, message: 'Primäre IP gesetzt' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// =====================================================
// PORT ALLOCATIONS (Pterodactyl-Style)
// =====================================================

// GET /guild/:guildId/plugins/masterserver/rootservers/:id/allocations
// Liste aller Port-Allocations für einen RootServer
router.get('/:id/allocations', async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const rootserverId = req.params.id;
    try {
        const rootserver = await RootServer.getById(rootserverId);
        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).json({ success: false, message: 'RootServer nicht gefunden' });
        }

        const allocations = await dbService.query(
            `SELECT pa.*, g.name AS server_name 
             FROM port_allocations pa 
             LEFT JOIN gameservers g ON pa.server_id = g.id
             WHERE pa.rootserver_id = ? 
             ORDER BY pa.ip ASC, pa.port ASC`,
            [rootserverId]
        );

        // Zusammenfassung
        const total = allocations.length;
        const assigned = allocations.filter(a => a.server_id !== null).length;
        const free = total - assigned;

        res.json({ 
            success: true, 
            data: allocations,
            summary: { total, assigned, free }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /guild/:guildId/plugins/masterserver/rootservers/:id/allocations
// Port-Allocations hinzufügen (IP + Port-Range → wird zu Einzel-Rows expandiert)
router.post('/:id/allocations', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const rootserverId = req.params.id;

    try {
        const rootserver = await RootServer.getById(rootserverId);
        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).json({ success: false, message: 'RootServer nicht gefunden' });
        }

        const { ip, ip_alias, ports } = req.body;

        // Validierung: IP
        if (!ip || !/^[\d.]+$/.test(ip)) {
            return res.status(400).json({ success: false, message: 'Ungültige IP-Adresse' });
        }

        // Validierung: Ports (komma-separiert, einzelne Ports oder Ranges wie "25565-25600")
        if (!ports || typeof ports !== 'string') {
            return res.status(400).json({ success: false, message: 'Ports fehlen (z.B. "25565-25600" oder "25565,25566,25567")' });
        }

        // Ports parsen (wie Pterodactyl AssignmentService)
        const PORT_FLOOR = 1024;
        const PORT_CEIL = 65535;
        const PORT_RANGE_LIMIT = 10000;

        const portList = [];
        const parts = ports.split(',').map(p => p.trim()).filter(Boolean);

        for (const part of parts) {
            const rangeMatch = part.match(/^(\d{1,5})-(\d{1,5})$/);
            if (rangeMatch) {
                const start = parseInt(rangeMatch[1]);
                const end = parseInt(rangeMatch[2]);
                if (start < PORT_FLOOR || end > PORT_CEIL || start > end) {
                    return res.status(400).json({ success: false, message: `Ungültiger Port-Range: ${part} (erlaubt: ${PORT_FLOOR}-${PORT_CEIL})` });
                }
                if (end - start + 1 > PORT_RANGE_LIMIT) {
                    return res.status(400).json({ success: false, message: `Port-Range zu groß: ${part} (max. ${PORT_RANGE_LIMIT} Ports pro Range)` });
                }
                for (let p = start; p <= end; p++) {
                    portList.push(p);
                }
            } else {
                const port = parseInt(part);
                if (isNaN(port) || port < PORT_FLOOR || port > PORT_CEIL) {
                    return res.status(400).json({ success: false, message: `Ungültiger Port: ${part}` });
                }
                portList.push(port);
            }
        }

        if (portList.length === 0) {
            return res.status(400).json({ success: false, message: 'Keine gültigen Ports gefunden' });
        }

        // Duplikate entfernen
        const uniquePorts = [...new Set(portList)];

        // Insert mit INSERT IGNORE (vorhandene überspringen)
        const values = uniquePorts.map(port => [rootserverId, ip.trim(), ip_alias || null, port]);
        const placeholders = values.map(() => '(?, ?, ?, ?)').join(', ');
        const flatValues = values.flat();

        const result = await dbService.query(
            `INSERT IGNORE INTO port_allocations (rootserver_id, ip, ip_alias, port) VALUES ${placeholders}`,
            flatValues
        );

        const created = result.affectedRows || 0;
        const skipped = uniquePorts.length - created;

        Logger.info(`[Masterserver] Port-Allocations: ${created} erstellt, ${skipped} übersprungen für RS ${rootserverId} (${ip}, ${uniquePorts.length} Ports)`);

        res.json({
            success: true,
            message: `${created} Allocations erstellt${skipped > 0 ? `, ${skipped} bereits vorhanden` : ''}`,
            data: { created, skipped, total: uniquePorts.length }
        });

    } catch (error) {
        Logger.error('[Masterserver] Port-Allocation Create Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE /guild/:guildId/plugins/masterserver/rootservers/:id/allocations/:allocId
// Einzelne Allocation löschen (nur wenn nicht zugewiesen)
router.delete('/:id/allocations/:allocId', async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const { id: rootserverId, allocId } = req.params;

    try {
        const rootserver = await RootServer.getById(rootserverId);
        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).json({ success: false, message: 'RootServer nicht gefunden' });
        }

        // Prüfen ob Allocation existiert und frei ist
        const [alloc] = await dbService.query(
            'SELECT * FROM port_allocations WHERE id = ? AND rootserver_id = ?',
            [allocId, rootserverId]
        );
        if (!alloc) {
            return res.status(404).json({ success: false, message: 'Allocation nicht gefunden' });
        }
        if (alloc.server_id) {
            return res.status(400).json({ success: false, message: 'Allocation ist einem Gameserver zugewiesen und kann nicht gelöscht werden' });
        }

        await dbService.query('DELETE FROM port_allocations WHERE id = ?', [allocId]);
        res.json({ success: true, message: 'Allocation gelöscht' });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE /guild/:guildId/plugins/masterserver/rootservers/:id/allocations-bulk
// Alle freien Allocations für eine IP löschen
router.delete('/:id/allocations-bulk', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const rootserverId = req.params.id;

    try {
        const rootserver = await RootServer.getById(rootserverId);
        if (!rootserver || rootserver.guild_id !== guildId) {
            return res.status(404).json({ success: false, message: 'RootServer nicht gefunden' });
        }

        const { ip } = req.body;
        if (!ip) {
            return res.status(400).json({ success: false, message: 'IP-Adresse fehlt' });
        }

        const result = await dbService.query(
            'DELETE FROM port_allocations WHERE rootserver_id = ? AND ip = ? AND server_id IS NULL',
            [rootserverId, ip]
        );

        Logger.info(`[Masterserver] ${result.affectedRows} freie Allocations für IP ${ip} gelöscht (RS ${rootserverId})`);

        res.json({
            success: true,
            message: `${result.affectedRows} freie Allocations gelöscht`,
            data: { deleted: result.affectedRows }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
