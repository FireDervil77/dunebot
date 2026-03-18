/**
 * Masterserver Plugin - Guild Routes
 * 
 * Alle guild-spezifischen Routen für das Masterserver-Plugin
 * - Dashboard (Übersicht)
 * - Daemon-Setup (Wizard)
 * - Token-Verwaltung
 * - Server-Registry
 * - Daemon-Logs
 * 
 * @module masterserver/routes/guild
 * @author FireBot Team
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const DaemonToken = require('../models/DaemonToken');
const RootServer = require('../models/RootServer');

// Helper: themeManager.renderView() wrapper
const renderView = async (res, viewPath, data) => {
    const themeManager = ServiceManager.get('themeManager');
    return await themeManager.renderView(res, viewPath, data);
};

// Helper: "Daemon" für eine Guild = erster/primärer RootServer
// Rückgabe hat daemon_id, daemon_status als status, daemon_version als version etc.
const getDaemonForGuild = async (guildId) => {
    const rootservers = await RootServer.getByGuild(guildId);
    if (!rootservers.length) return null;
    const rs = rootservers[0];
    // Backwards-compat Aliase für bestehenden Code
    rs.status           = rs.daemon_status;
    rs.version          = rs.daemon_version;
    rs.last_heartbeat   = rs.last_seen;
    rs.last_ping_latency = rs.last_ping_ms;
    return rs;
};

// =====================================================
// Route: Hauptmenü-Redirect
// URL: /guild/:guildId/plugins/masterserver
// Redirected zu: /dashboard
// =====================================================
router.get('/', (req, res) => {
    const guildId = res.locals.guildId;
    res.redirect(`/guild/${guildId}/plugins/masterserver/dashboard`);
});

// =====================================================
// Route 1: Masterserver Dashboard (Hauptseite)
// URL: /guild/:guildId/plugins/masterserver/dashboard
// =====================================================
router.get('/dashboard', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const ipmServer = ServiceManager.get('ipmServer');
    const guildId = res.locals.guildId;

    try {
        // Plugin-Kontext für i18n
        res.locals.pluginName = 'masterserver';
        req.params.pluginName = 'masterserver';

        // Daemon-Daten laden
        const daemon = await getDaemonForGuild(guildId);
        
        // Server-Statistiken für physische RootServer (nicht Gameserver!)
        const serverStats = await RootServer.getStats(guildId);

        // Online-Status vom IPMServer
        const isOnline = daemon ? ipmServer.isDaemonOnline(daemon.daemon_id) : false;

        await renderView(res, 'guild/masterserver-dashboard', {
            title: 'Masterserver Dashboard',
            activeMenu: `/guild/${guildId}/plugins/masterserver/dashboard`,
            daemon,
            isOnline,
            serverStats,
            guildId
        });

    } catch (error) {
        Logger.error('[Masterserver] Dashboard Error:', error);
        res.status(500).render('error', { 
            message: 'Fehler beim Laden des Dashboards',
            error: error.message 
        });
    }
});

// =====================================================
// Route 2: Daemon-Setup (Wizard)
// URL: /guild/:guildId/plugins/masterserver/daemon
// =====================================================
// Legacy: /daemon → redirect to /rootservers
router.get('/daemon', (req, res) => {
    const guildId = res.locals.guildId;
    res.redirect(301, `/guild/${guildId}/plugins/masterserver/rootservers`);
});

// =====================================================
// Route 2b: Daemon Update-Info abrufen (API)
// URL: GET /guild/:guildId/plugins/masterserver/daemon/update-info
// =====================================================
router.get('/daemon/update-info', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;

    try {
        // Daemon-Daten laden
        const daemon = await getDaemonForGuild(guildId);
        if (!daemon) {
            return res.status(404).json({
                success: false,
                message: 'Kein Daemon für diese Guild gefunden'
            });
        }

        // IPMServer abrufen und Update-Info aus Connection-Metadata holen
        const ipmServer = ServiceManager.get('ipmServer');
        if (!ipmServer) {
            return res.status(503).json({
                success: false,
                message: 'IPM-Server nicht verfügbar'
            });
        }

        const connection = ipmServer.connections.get(daemon.daemon_id);
        if (!connection || !connection.metadata.updateInfo) {
            return res.json({
                success: true,
                updateInfo: null, // Daemon offline oder keine Update-Info vorhanden
                daemonOnline: !!connection
            });
        }

        res.json({
            success: true,
            updateInfo: connection.metadata.updateInfo,
            daemonOnline: true
        });

    } catch (error) {
        Logger.error('[Masterserver] Update-Info Error:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Abrufen der Update-Info'
        });
    }
});

// =====================================================
// Route 2c: Daemon-Update triggern (POST)
// URL: POST /guild/:guildId/plugins/masterserver/daemon/trigger-update
// =====================================================
router.post('/daemon/trigger-update', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;

    try {
        // Daemon-Daten laden
        const daemon = await getDaemonForGuild(guildId);
        if (!daemon) {
            return res.status(404).json({
                success: false,
                message: 'Kein Daemon für diese Guild gefunden'
            });
        }

        // IPMServer abrufen
        const ipmServer = ServiceManager.get('ipmServer');
        if (!ipmServer) {
            return res.status(503).json({
                success: false,
                message: 'IPM-Server nicht verfügbar'
            });
        }

        // Prüfen ob Daemon online
        const connection = ipmServer.connections.get(daemon.daemon_id);
        if (!connection) {
            return res.status(400).json({
                success: false,
                message: 'Daemon ist offline - Update nicht möglich'
            });
        }

        // Command an Daemon senden
        Logger.info(`[Masterserver] Triggere Daemon-Update für ${daemon.daemon_id}`);
        
        const response = await ipmServer.sendCommand(daemon.daemon_id, 'daemon.update', {});
        
        if (response.success) {
            res.json({
                success: true,
                message: 'Update wird durchgeführt - Daemon startet neu'
            });
        } else {
            res.status(500).json({
                success: false,
                message: response.error || 'Update-Command fehlgeschlagen'
            });
        }

    } catch (error) {
        Logger.error('[Masterserver] Trigger Update Error:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Triggern des Updates'
        });
    }
});

// =====================================================
// Route 2d: Erster RootServer (= Daemon) für Guild anlegen
// =====================================================
router.post('/daemon/create', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;

    try {
        const { displayName, host, daemonPort } = req.body;
        const name = displayName?.trim() || 'Mein RootServer';

        // Ersten RootServer als "primären Daemon" anlegen
        const result = await RootServer.create({
            guildId,
            ownerUserId: res.locals.user?.id || null,
            name,
            host: host?.trim() || '127.0.0.1',
            daemonPort: parseInt(daemonPort) || 9340
        });

        // Setup-Status aktualisieren
        await dbService.setConfig('masterserver', 'SETUP_WIZARD_STEP', '1', 'shared', guildId);

        Logger.info(`[Masterserver] RootServer ${result.daemonId} für Guild ${guildId} erstellt`);

        res.json({
            success: true,
            message: 'RootServer erfolgreich erstellt',
            daemonId: result.daemonId,
            rootserverId: result.id,
            apiKey: result.apiKey
        });

    } catch (error) {
        Logger.error('[Masterserver] Daemon/RootServer Create Error:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Erstellen des RootServers'
        });
    }
});

// =====================================================
// Route 3: Token-Verwaltung
// URL: /guild/:guildId/plugins/masterserver/tokens
// =====================================================
router.get('/tokens', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;

    try {
        res.locals.pluginName = 'masterserver';
        req.params.pluginName = 'masterserver';

        // Daemon prüfen
        const daemon = await getDaemonForGuild(guildId);
        if (!daemon) {
            return res.redirect(`/guild/${guildId}/plugins/masterserver/rootservers`);
        }

                // Tokens für diese Guild abrufen
        const activeTokens = await DaemonToken.getByGuild(guildId, true);
        const expiredTokens = await DaemonToken.getByGuild(guildId, false);

        await renderView(res, 'guild/masterserver-tokens', {
            title: 'Token-Verwaltung',
            activeMenu: `/guild/${guildId}/plugins/masterserver/tokens`,
            daemon,
            activeTokens,
            expiredTokens: expiredTokens.filter(t => new Date(t.expires_at) < new Date()),
            guildId
        });

    } catch (error) {
        Logger.error('[Masterserver] Tokens Error:', error);
        res.status(500).render('error', { 
            message: 'Fehler beim Laden der Tokens',
            error: error.message 
        });
    }
});

// =====================================================
// Route 3a: Token generieren (POST)
// =====================================================
router.post('/tokens/generate', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;

    try {
        const { expiresInDays, description } = req.body;

        // Daemon prüfen
        const daemon = await getDaemonForGuild(guildId);
        if (!daemon) {
            return res.status(400).json({
                success: false,
                message: 'Kein Daemon konfiguriert'
            });
        }

        // Ablaufzeit in Stunden umrechnen
        const expiresInHours = parseInt(expiresInDays || 365) * 24;

        // Token generieren für diese Guild (nicht für Daemon!)
        const { token, tokenId } = await DaemonToken.generate(
            guildId,  // ✅ Guild-ID, nicht daemon_id!
            expiresInHours,
            description || null,
            res.locals.user?.id || null  // ✅ res.locals.user ist bereits das info-Objekt
        );

        Logger.info(`[Masterserver] Token #${tokenId} für Guild ${guildId} generiert`);

        res.json({
            success: true,
            message: 'Token erfolgreich generiert',
            token,
            tokenId
        });

    } catch (error) {
        Logger.error('[Masterserver] Token Generate Error:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Generieren des Tokens'
        });
    }
});

// =====================================================
// Route 3b: Token widerrufen (DELETE)
// =====================================================
router.delete('/tokens/:tokenId', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const { tokenId } = req.params;

    try {
        // Daemon prüfen
        const daemon = await getDaemonForGuild(guildId);
        if (!daemon) {
            return res.status(400).json({
                success: false,
                message: 'Kein Daemon konfiguriert'
            });
        }

        // Token laden und Ownership prüfen
        const token = await DaemonToken.getById(tokenId);
        if (!token || token.daemon_id !== daemon.daemon_id) {
            return res.status(404).json({
                success: false,
                message: 'Token nicht gefunden'
            });
        }

        // Token widerrufen
        await DaemonToken.revoke(tokenId);

        Logger.info(`[Masterserver] Token ${tokenId} widerrufen`);

        res.json({
            success: true,
            message: 'Token erfolgreich widerrufen'
        });

    } catch (error) {
        Logger.error('[Masterserver] Token Revoke Error:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Widerrufen des Tokens'
        });
    }
});

// =====================================================
// Route 4: Server-Registry (Physische Server)
// URL: /guild/:guildId/plugins/masterserver/servers
// =====================================================
router.get('/servers', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipmServer = ServiceManager.get('ipmServer');
    const guildId = res.locals.guildId;

    try {
        res.locals.pluginName = 'masterserver';
        req.params.pluginName = 'masterserver';

        // Daemon prüfen
        const daemon = await getDaemonForGuild(guildId);
        if (!daemon) {
            return res.redirect(`/guild/${guildId}/plugins/masterserver/rootservers`);
        }

        // RootServer laden (physische/virtuelle Server)
        const servers = await RootServer.getByGuild(guildId);

        // Server-Statistiken
        const serverStats = await RootServer.getStats(guildId);

        // Online-Status vom IPMServer
        const daemonOnline = ipmServer.isDaemonOnline(daemon.daemon_id);

        // Hardware-Stats vom Daemon abrufen (inkl. Network-Interfaces)
        const daemonHardware = daemonOnline ? ipmServer.getDaemonHardware(daemon.daemon_id) : null;

        await renderView(res, 'guild/masterserver-servers', {
            title: 'Server-Verwaltung',
            activeMenu: `/guild/${guildId}/plugins/masterserver/servers`,
            daemon,
            servers,
            serverStats,
            daemonOnline,
            daemonHardware,
            guildId
        });

    } catch (error) {
        Logger.error('[Masterserver] Servers Error:', error);
        res.status(500).render('error', { 
            message: 'Fehler beim Laden der Server-Registry',
            error: error.message 
        });
    }
});

// =====================================================
// Route 4a: Server erstellen (GET - Create Form)
// URL: /guild/:guildId/plugins/masterserver/servers/create
// =====================================================
router.get('/servers/create', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipmServer = ServiceManager.get('ipmServer');
    const guildId = res.locals.guildId;

    try {
        res.locals.pluginName = 'masterserver';
        req.params.pluginName = 'masterserver';

        // Daemon prüfen
        const daemon = await getDaemonForGuild(guildId);
        if (!daemon) {
            return res.redirect(`/guild/${guildId}/plugins/masterserver/rootservers`);
        }

        // Online-Status prüfen
        const daemonOnline = ipmServer.isDaemonOnline(daemon.daemon_id);
        if (!daemonOnline) {
            req.flash('error', 'Daemon ist offline - Server kann nicht erstellt werden');
            return res.redirect(`/guild/${guildId}/plugins/masterserver/servers`);
        }

        // Hardware-Stats vom Daemon abrufen (für Netzwerk-Interfaces)
        const daemonHardware = ipmServer.getDaemonHardware(daemon.daemon_id);

        await renderView(res, 'guild/masterserver-server-create', {
            title: 'Neuen Server erstellen',
            activeMenu: `/guild/${guildId}/plugins/masterserver/servers`,
            daemon,
            daemonHardware,
            guildId
        });

    } catch (error) {
        Logger.error('[Masterserver] Server Create Form Error:', error);
        res.status(500).render('error', { 
            message: 'Fehler beim Laden des Erstellungs-Formulars',
            error: error.message 
        });
    }
});

// =====================================================
// Route 4b: Server bearbeiten (GET - Edit Form)
// =====================================================
router.get('/servers/:serverId/edit', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const ipmServer = ServiceManager.get('ipmServer');
    const guildId = res.locals.guildId;
    const { serverId } = req.params;

    try {
        res.locals.pluginName = 'masterserver';
        req.params.pluginName = 'masterserver';

        // Server laden
        const server = await RootServer.getById(serverId);
        if (!server || String(server.guild_id) !== String(guildId)) {
            return res.status(404).render('error', {
                message: 'Server nicht gefunden',
                error: { status: 404 }
            });
        }

        // Daemon-Daten laden
        const daemon = await getDaemonForGuild(guildId);
        if (!daemon) {
            return res.redirect(`/guild/${guildId}/plugins/masterserver/rootservers`);
        }

        // Online-Status vom IPMServer
        const daemonOnline = ipmServer.isDaemonOnline(daemon.daemon_id);

        await renderView(res, 'guild/masterserver-server-edit', {
            title: `Server bearbeiten: ${server.server_name}`,
            activeMenu: `/guild/${guildId}/plugins/masterserver/servers`,
            server,
            daemon,
            daemonOnline,
            guildId
        });

    } catch (error) {
        Logger.error('[Masterserver] Server Edit Load Error:', error);
        res.status(500).render('error', {
            message: 'Fehler beim Laden des Servers',
            error: error.message
        });
    }
});

// =====================================================
// Route 4b: RootServer erstellen (POST)
// Beschreibt den physischen Server (Daemon muss bereits registriert sein!)
// Verknüpft RootServer mit existierendem Daemon (daemon_id)
// =====================================================
router.post('/servers/create', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const userId = res.locals.user?.id || res.locals.userId || null;

    console.log('[DEBUG] POST /servers/create aufgerufen');
    console.log('[DEBUG] Body:', req.body);

    try {
        // Formular sendet diese Felder (siehe Network Tab):
        const {
            serverName,      // Server-Name (name="serverName")
            hostname,        // FQDN (z.B. server01.example.com)
            description,     // Beschreibung (optional)
            ipAddress,       // IP-Adresse (name="ipAddress") - Fallback
            host,            // IP-Adresse (name="host") - Create-View
            cpuCores,        // CPU-Kerne (name="cpuCores")
            ramTotal,        // RAM in GB (name="ramTotal")
            diskTotal,       // Disk in GB (name="diskTotal")
            datacenter,      // Datacenter-Name
            countryCode,     // Ländercode (z.B. "DE")
            quotaProfileId   // Quota-Profil ID (optional)
        } = req.body;

        // Variablen für SQL
        const name = serverName;
        const resolvedIp = host || ipAddress; // Create-View: "host", Edit-View: "ipAddress"
        const ramLimitGb = ramTotal;
        const diskLimitGb = diskTotal;

        // Validierung
        if (!name || name.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Server-Name ist erforderlich'
            });
        }

        // ✅ Daemon muss bereits existieren (aus Setup-Prozess!)
        const daemon = await getDaemonForGuild(guildId);
        if (!daemon) {
            return res.status(400).json({
                success: false,
                message: 'Kein Daemon konfiguriert! Bitte zuerst Daemon-Setup durchführen.'
            });
        }

        // IP-Adresse: explizit gewählt oder automatisch vom Daemon
        let finalIp = (resolvedIp && resolvedIp.trim().length > 0)
            ? resolvedIp.trim()
            : (daemon.host_ip || null);

        // Fallback: public_ip oder erste öffentliche IPv4 aus den Daemon-Hardware-Stats
        if (!finalIp) {
            const ipmServerForIp = ServiceManager.get('ipmServer');
            const hw = ipmServerForIp.getDaemonHardware(daemon.daemon_id);
            if (hw && hw.network) {
                // Direkter public_ip Fallback (vom Daemon berechnet)
                if (hw.network.public_ip) {
                    finalIp = hw.network.public_ip;
                } else if (hw.network.interfaces) {
                    // Erste nicht-Loopback IPv4 aus Interfaces (addresses sind plain strings)
                    for (const iface of hw.network.interfaces) {
                        if (iface.is_loopback) continue;
                        for (const addr of (iface.addresses || [])) {
                            if (addr.indexOf(':') === -1 && addr !== '127.0.0.1') {
                                finalIp = addr;
                                break;
                            }
                        }
                        if (finalIp) break;
                    }
                }
            }
        }

        if (!finalIp) {
            return res.status(400).json({
                success: false,
                message: 'IP-Adresse konnte nicht ermittelt werden. Bitte wähle eine IP manuell aus oder stelle sicher, dass der Daemon online ist und Hardware-Daten übermittelt wurden.'
            });
        }

        // ❌ ENTFERNT: 1:1 Check (Multi-Server Setup erlaubt!)
        // Ein Daemon kann mehrere virtuelle Rootserver verwalten

        // Name-Duplikat prüfen (innerhalb der Guild)
        const nameExists = await RootServer.nameExists(guildId, name.trim());
        if (nameExists) {
            return res.status(400).json({
                success: false,
                message: 'Ein Server mit diesem Namen existiert bereits'
            });
        }

        // ✅ RootServer in DB erstellen (nutzt EXISTIERENDEN daemon_id!)
        const dbService = ServiceManager.get('dbService');
        const crypto = require('crypto');
        
        // System-User aus Guild-ID generieren (wie im Setup)
        const systemUser = `guild_${guildId.substring(0, 10)}`;
        const baseDirectory = '/opt/firebot';
        
        // ✅ API-Key generieren (für Daemon-Auth)
        const apiKey = crypto.randomBytes(32).toString('hex');
        
        // ⚠️ DEBUG: Alle Parameter vor SQL-Insert loggen
        console.log('[DEBUG] SQL Parameters:', {
            daemon_id: daemon.daemon_id,
            guildId,
            userId,
            systemUser,
            name: name?.trim(),
            ipAddress: finalIp,
            hostname,
            port: 9340,
            baseDirectory,
            apiKey: apiKey.substring(0, 16) + '...', // Nur ersten Teil loggen
            cpu_cores: null,
            cpu_threads: null,
            ramTotal,
            diskTotal,
            datacenter,
            countryCode,
            description
        });
        
        // RootServer-Eintrag erstellen
        const result = await dbService.query(
            `INSERT INTO rootserver 
             (daemon_id, guild_id, owner_user_id, system_user, name, host, hostname,
              daemon_port, base_directory, api_key,
              cpu_cores, cpu_threads, ram_total_gb, disk_total_gb,
              datacenter, country_code, description,
              install_status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', NOW(), NOW())`,
            [
                daemon.daemon_id,
                guildId,
                userId,
                systemUser,
                name.trim(),
                finalIp,
                hostname ? hostname.trim() : null, // FQDN (optional)
                9340, // Daemon WebSocket Port (fest)
                baseDirectory,
                apiKey, // ✅ Neu generierter API-Key
                null, // cpu_cores - wird vom Daemon via Heartbeat gefüllt
                null, // cpu_threads - wird vom Daemon via Heartbeat gefüllt
                ramTotal ? parseFloat(ramTotal) : null, // User-Limit (optional)
                diskTotal ? parseFloat(diskTotal) : null, // User-Limit (optional)
                datacenter || null, // Datacenter-Standort
                countryCode || null, // ISO-Ländercode (DE, US, etc.)
                description || null // User-Beschreibung
            ]
        );
        
        console.log('[DEBUG] INSERT Result:', result);

        const rootserverId = result.insertId;
        Logger.info(`[Masterserver] RootServer erstellt: ${rootserverId} (${name}) für Daemon ${daemon.daemon_id}`);

        // ✅ Optional: Quota-Profil zuweisen
        if (quotaProfileId) {
            await dbService.query(
                `INSERT INTO rootserver_quotas 
                 (rootserver_id, profile_id, reserved_ram_mb, reserved_cpu_cores, reserved_disk_gb)
                 VALUES (?, ?, 2048, 1, 50)`,
                [rootserverId, parseInt(quotaProfileId)]
            );
            Logger.info(`[Masterserver] Quota-Profil ${quotaProfileId} zugewiesen`);
        }

        // ✅ Virtual Server im Daemon erstellen (wenn Daemon online)
        const ipmServer = ServiceManager.get('ipmServer');
        
        if (daemon && ipmServer.isDaemonOnline(daemon.daemon_id)) {
            try {
                Logger.info(`[Masterserver] Erstelle Virtual Server für RootServer ${rootserverId} im Daemon...`);
                
                const vServerResponse = await ipmServer.sendCommand(daemon.daemon_id, 'virtual.create', {
                    daemon_id: daemon.daemon_id,     // UUID für Basis-Verzeichnis
                    rootserver_id: rootserverId,     // ✅ RootServer DB-ID für Unterverzeichnis
                    guild_id: guildId,               // ✅ Für SQLite-Cache im Daemon
                    server_name: name.trim(),
                    username: systemUser,
                    ram_limit_gb: ramTotal ? parseFloat(ramTotal) : 0,
                    disk_limit_gb: diskTotal ? parseFloat(diskTotal) : 0
                }, 30000);

                if (vServerResponse.success) {
                    await dbService.query(
                        'UPDATE rootserver SET install_status = ? WHERE id = ?',
                        ['completed', rootserverId]
                    );
                } else {
                    Logger.error(`[Masterserver] Virtual Server Setup fehlgeschlagen: ${vServerResponse.error}`);
                    // Nicht kritisch - RootServer wurde erstellt, Virtual Server kann später erstellt werden
                }
            } catch (vServerError) {
                Logger.error('[Masterserver] Virtual Server Creation Error:', vServerError);
                // Nicht kritisch - RootServer wurde erstellt
            }
        } else {
            Logger.warn('[Masterserver] Daemon offline - Virtual Server muss später erstellt werden');
        }

        // ✅ Erfolg!
        res.json({
            success: true,
            message: 'RootServer erfolgreich erstellt',
            rootserver: {
                id: rootserverId,
                name: name.trim(),
                host: finalIp,
                daemon_id: daemon.daemon_id,
                system_user: systemUser
            }
        });

    } catch (error) {
        Logger.error('[Masterserver] RootServer Create Error:', error);
        res.status(500).json({
            success: false,
            message: 'Interner Serverfehler: ' + error.message
        });
    }
});

// =====================================================
// Route 4b: Server aktualisieren (PUT)
// =====================================================
router.put('/servers/:serverId', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const { serverId } = req.params;

    try {
        // Server laden und Ownership prüfen
        const server = await RootServer.getById(serverId);
        if (!server || String(server.guild_id) !== String(guildId)) {
            return res.status(404).json({
                success: false,
                message: 'Server nicht gefunden'
            });
        }

        const {
            serverName,
            description,
            cpuLimitPercent,
            ramLimitGb,
            diskLimitGb,
            hostname,
            ipAddress,
            datacenter,
            countryCode,
            status
        } = req.body;

        // Name-Duplikat prüfen (falls geändert)
        if (serverName && serverName !== server.name) {
            const nameExists = await RootServer.nameExists(guildId, serverName.trim(), serverId);
            if (nameExists) {
                return res.status(400).json({
                    success: false,
                    message: 'Ein Server mit diesem Namen existiert bereits'
                });
            }
        }

        // Server aktualisieren - Field Mapping zu DB-Spalten
        const updates = {};
        if (serverName) updates.name = serverName.trim();
        if (description !== undefined) updates.description = description?.trim() || null;
        if (hostname !== undefined) updates.hostname = hostname?.trim() || null;
        if (ipAddress !== undefined) updates.host = ipAddress?.trim() || null; // DB-Spalte: host
        if (ramLimitGb !== undefined) updates.ram_total_gb = ramLimitGb ? parseFloat(ramLimitGb) : null;
        if (diskLimitGb !== undefined) updates.disk_total_gb = diskLimitGb ? parseFloat(diskLimitGb) : null;
        if (datacenter !== undefined) updates.datacenter = datacenter?.trim() || null;
        if (countryCode !== undefined) updates.country_code = countryCode?.trim() || null;
        
        // Status kann nicht über GUI geändert werden (wird vom Daemon gesetzt)

        await RootServer.update(serverId, updates);

        Logger.info(`[Masterserver] Server ${serverId} aktualisiert`);

        res.json({
            success: true,
            message: 'Server erfolgreich aktualisiert'
        });

    } catch (error) {
        Logger.error('[Masterserver] Server Update Error:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Aktualisieren des Servers'
        });
    }
});

// =====================================================
// Route 4c: Server löschen (DELETE)
// =====================================================
router.delete('/servers/:serverId', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const { serverId } = req.params;

    try {
        // Server laden und Ownership prüfen
        const server = await RootServer.getById(serverId);
        if (!server || String(server.guild_id) !== String(guildId)) {
            return res.status(404).json({
                success: false,
                message: 'Server nicht gefunden'
            });
        }

        // Prüfen ob Gameserver drauf laufen
        if (server.gameserver_count > 0) {
            return res.status(400).json({
                success: false,
                message: `Server kann nicht gelöscht werden: ${server.gameserver_count} Gameserver sind noch aktiv`
            });
        }

        // Server aus DB löschen
        await RootServer.delete(serverId);

        Logger.info(`[Masterserver] Server ${serverId} gelöscht`);

        // IPM-Call an Daemon: Virtual Server Verzeichnis löschen
        const ipmServer = ServiceManager.get('ipmServer');
        if (ipmServer.isDaemonOnline(server.daemon_id)) {
            try {
                const ipmResult = await ipmServer.sendCommand(
                    server.daemon_id,
                    'virtual.delete',
                    {
                        daemon_id: server.daemon_id,      // ✅ UUID für Basis-Verzeichnis
                        rootserver_id: parseInt(serverId) // ✅ RootServer-ID für Unterverzeichnis
                    },
                    10000 // 10s Timeout
                );

                if (!ipmResult.success) {
                    Logger.warn(`[Masterserver] Virtual Server Verzeichnis-Löschung fehlgeschlagen: ${ipmResult.error}`);
                    // Nicht fatal - Server ist aus DB, Verzeichnis bleibt aber (manuell löschen)
                }
            } catch (ipmError) {
                Logger.error(`[Masterserver] IPM-Call virtual.delete fehlgeschlagen:`, ipmError);
                // Nicht fatal - Server ist aus DB
            }
        } else {
            Logger.warn(`[Masterserver] Daemon offline - Virtual Server ${serverId} ohne Verzeichnis-Löschung`);
        }

        res.json({
            success: true,
            message: 'Server erfolgreich gelöscht'
        });

    } catch (error) {
        Logger.error('[Masterserver] Server Delete Error:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Löschen des Servers'
        });
    }
});

// =====================================================
// Route 5: Daemon-Logs
// URL: /guild/:guildId/plugins/masterserver/logs
// =====================================================
router.get('/logs', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;

    try {
        res.locals.pluginName = 'masterserver';
        req.params.pluginName = 'masterserver';

        // Daemon prüfen
        const daemon = await getDaemonForGuild(guildId);
        if (!daemon) {
            return res.redirect(`/guild/${guildId}/plugins/masterserver/rootservers`);
        }

        // Filter aus Query-Params
        const level = req.query.level || null;
        const limit = parseInt(req.query.limit) || 100;

        // Logs laden
        let query = `
            SELECT * FROM daemon_logs 
            WHERE daemon_id = ?
        `;
        const params = [daemon.daemon_id];

        if (level) {
            query += ' AND level = ?';
            params.push(level);
        }

        query += ' ORDER BY created_at DESC LIMIT ?';
        params.push(limit);

        const logs = await dbService.query(query, params);

        // Stats berechnen
        const statsQuery = `
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) as errors,
                SUM(CASE WHEN level = 'warn' THEN 1 ELSE 0 END) as warnings,
                SUM(CASE WHEN level = 'info' THEN 1 ELSE 0 END) as info
            FROM daemon_logs 
            WHERE daemon_id = ?
        `;
        const statsResult = await dbService.query(statsQuery, [daemon.daemon_id]);
        const stats = statsResult[0] || { total: 0, errors: 0, warnings: 0, info: 0 };

        // Retention-Days aus Config
        const retentionDays = parseInt(await dbService.getConfig('masterserver', 'LOG_RETENTION_DAYS', 'shared', guildId) || '30');

        await renderView(res, 'guild/masterserver-logs', {
            title: 'Daemon-Logs',
            activeMenu: `/guild/${guildId}/plugins/masterserver/logs`,
            daemon,
            logs,
            level,
            limit,
            stats,
            retentionDays,
            guildId
        });

    } catch (error) {
        Logger.error('[Masterserver] Logs Error:', error);
        res.status(500).render('error', { 
            message: 'Fehler beim Laden der Logs',
            error: error.message 
        });
    }
});

// =====================================================
// Route 6: Token generieren (POST)
// URL: /guild/:guildId/plugins/masterserver/tokens/generate
// =====================================================
router.post('/tokens/generate', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;

    try {
        const { expiresInDays, description } = req.body;

        // Validierung
        if (!expiresInDays || isNaN(parseInt(expiresInDays))) {
            return res.status(400).json({
                success: false,
                message: 'Ungültige Gültigkeitsdauer'
            });
        }

        // Daemon für diese Guild laden
        const daemon = await getDaemonForGuild(guildId);
        if (!daemon) {
            return res.status(404).json({
                success: false,
                message: 'Kein Daemon für diese Guild gefunden'
            });
        }

        // Token generieren
        const token = await DaemonToken.generate(
            daemon.daemon_id,
            guildId,
            parseInt(expiresInDays),
            description || null
        );

        Logger.info(`[Masterserver] Token generiert für Guild ${guildId}: ID ${token.id}`);

        // Erfolg mit Token zurückgeben (für guild.js Handler)
        res.json({
            success: true,
            message: 'Token erfolgreich generiert',
            tokenId: token.id,
            token: token.token, // ⚠️ Nur hier anzeigen, nie wieder!
            expiresAt: token.expires_at,
            description: token.description
        });

    } catch (error) {
        Logger.error('[Masterserver] Token Generation Error:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Generieren des Tokens: ' + error.message
        });
    }
});

// =====================================================
// Route 7: Hauptseite Redirect
// URL: /guild/:guildId/plugins/masterserver
// =====================================================
router.get('/', (req, res) => {
    const guildId = res.locals.guildId;
    res.redirect(`/guild/${guildId}/plugins/masterserver/dashboard`);
});

module.exports = router;
