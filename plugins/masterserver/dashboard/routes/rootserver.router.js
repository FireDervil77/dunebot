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

        await renderView(res, 'guild/masterserver-servers', {
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
            portRangeStart, portRangeEnd
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
                    // ✅ Port-Pool für diesen Rootserver im Daemon registrieren
                    port_range_start: portRangeStart ? parseInt(portRangeStart) : null,
                    port_range_end: portRangeEnd ? parseInt(portRangeEnd) : null,
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

        // TODO: Gameserver-Statistiken für diesen RootServer laden
        const gameserverStats = {
            total: 0,
            running: 0,
            stopped: 0
        };

        await renderView(res, 'guild/masterserver-rootserver-detail', {
            title: `RootServer: ${rootserver.name}`,
            activeMenu: `/guild/${guildId}/plugins/masterserver/rootservers`,
            rootserver,
            isOnline,
            gameserverStats,
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

        const { name, host, daemonPort, systemUser, baseDirectory } = req.body;

        // RootServer aktualisieren
        await RootServer.update(rootserverId, {
            name,
            host,
            daemon_port: daemonPort,
            system_user: systemUser,
            base_directory: baseDirectory
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

        // TODO: System-Ressourcen vom Daemon abfragen (via IPM)
        const systemResources = {
            cpu: 0,
            ram: 0,
            disk: 0
        };

        res.json({
            success: true,
            data: {
                status: rootserver.daemon_status,
                isOnline,
                lastHeartbeat: rootserver.daemon_last_heartbeat,
                lastPingLatency: rootserver.daemon_last_ping_latency,
                missedHeartbeats: rootserver.daemon_missed_heartbeats,
                version: rootserver.daemon_version,
                osInfo: rootserver.daemon_os_info,
                systemResources
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

module.exports = router;
