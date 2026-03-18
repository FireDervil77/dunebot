const { Server, ServerStatus } = require("veza");
const { ServiceManager } = require("dunebot-core");

class IPCServer {
    constructor() {
        this.server = new Server("Dashboard");
        this.host = process.env.IPC_SERVER_HOST;
        this.port = process.env.IPC_SERVER_PORT;
    }

    getSockets() {
        return Array.from(this.server.sockets).filter((c) => /\d+$/.test(c[0]));
    }

    async broadcast(event, data, receptive = true) {
        const Logger = ServiceManager.get('Logger');

        const startTime = Date.now();
        Logger.debug(`[IPC] Broadcasting event '${event}' to all sockets`);

        try {
            const sockets = this.getSockets();
            if (!sockets.length) {
                Logger.warn("[IPC] No available sockets for broadcast");
                return [];
            }

            const results = await Promise.allSettled(
                sockets.map((s) =>
                    s[1]
                        .send(
                            {
                                event,
                                payload: data,
                            },
                            { receptive },
                        )
                        .catch((error) => {
                            Logger.error(
                                `[IPC] Failed to send message to socket ${s[0]}: ${error.message}`,
                            );
                            return null;
                        }),
                ),
            );

            const endTime = Date.now();
            Logger.debug(`[IPC] Broadcast '${event}' completed in ${endTime - startTime}ms`);

            return results
                .filter((r) => r.status === "fulfilled" && r.value !== null)
                .map((r) => r.value)
                .flat();
        } catch (error) {
            const endTime = Date.now();
            Logger.error(`[IPC] Broadcast error (took ${endTime - startTime}ms):`, error);
            return [];
        }
    }

    async broadcastOne(event, data, receptive = true) {
        const Logger = ServiceManager.get('Logger');
        
        const startTime = Date.now();
        Logger.debug(`[IPC] Broadcasting event '${event}' to one socket`);

        try {
            const sockets = this.getSockets();
            if (!sockets.length) {
                Logger.warn("[IPC] No available sockets for broadcast");
                return { success: false, data: null };
            }

            const result = await sockets[0][1]
                .send(
                    {
                        event,
                        payload: data,
                    },
                    { receptive },
                )
                .catch((error) => {
                    Logger.error(`[IPC] Failed to send message to socket: ${error.message}`);
                    return { success: false, data: null };
                });

            const endTime = Date.now();
            Logger.debug(`[IPC] BroadcastOne '${event}' completed in ${endTime - startTime}ms`);

            return result;
        } catch (error) {
            const endTime = Date.now();
            Logger.error(`[IPC] BroadcastOne error (took ${endTime - startTime}ms):`, error);
            return { success: false, data: null };
        }
    }

    async initialize() {
        const Logger = ServiceManager.get('Logger');

        this.server.on("connect", (client) => {
            Logger.success(`[IPC] Client connected: ${client.name}`);
        });

        this.server.on("disconnect", (client) => {
            Logger.warn(`[IPC] Client disconnected: ${client.name}`);
        });

        this.server.on("error", (error, client) => {
            Logger.error(`[IPC] Client error: ${client?.name ?? "unknown"}`, error);
        });
        
        // Ping-Nachrichten behandeln
        this.server.on("ping", (message) => {
            // Einfach mit einem Pong antworten
            message.reply({ success: true, ping: "pong", timestamp: Date.now() });
            Logger.debug(`[IPC] Ping received from ${message.sender.name}`);
        });
        
        // Event-Handler für Ping-Nachrichten, die über das normale Message-System kommen
        this.server.on("message", (message) => {
            if (message?.data?.event === "ping") {
                // Keine Antwort senden, wenn nicht receptive
                if (message.receptive) {
                    message.reply({ success: true, ping: "pong", timestamp: Date.now() });
                }
                Logger.debug(`[IPC] Ping received via message from ${message.sender.name}`);
                return;
            }

            // Bot → Dashboard: Plugin-Event-Routing
            const event = message?.data?.event;
            if (event && message.receptive) {
                this._routePluginMessage(event, message.data.payload || {}, message)
                    .catch(err => {
                        Logger.error(`[IPC] Plugin-Message-Error (${event}):`, err);
                        message.reply({ success: false, error: err.message });
                    });
            }
        });

        await this.server.listen(this.port, this.host);
        Logger.success(`[IPC] Server listening on ${this.host}:${this.port}`);

        this.startHealthCheck();
        return this.server;
    }

    startHealthCheck() {
        const Logger = ServiceManager.get('Logger');
        
        setInterval(() => {
            if (this.server.status != ServerStatus.Opened) {
                this.server.listen(this.port, this.host).catch((ex) => {
                    Logger.error("[IPC] Server error", ex);
                });
            }
        }, 1000 * 10);
    }

    /**
     * Routed eingehende Bot→Dashboard Plugin-Events an den zuständigen Handler
     * Format: "pluginName:ACTION"  z.B. "masterserver:DAEMON_INFO"
     * @private
     */
    async _routePluginMessage(event, payload, message) {
        const Logger = ServiceManager.get('Logger');
        const [pluginName, action] = event.split(':');

        if (!pluginName || !action) {
            return message.reply({ success: false, error: 'Ungültiges Event-Format' });
        }

        Logger.debug(`[IPC] Plugin-Message: ${pluginName}:${action}`);

        switch (pluginName) {
            case 'masterserver':
                return this._handleMasterserverEvent(action, payload, message);
            case 'gameserver':
                return this._handleGameserverEvent(action, payload, message);
            default:
                return message.reply({ success: false, error: `Unbekanntes Plugin: ${pluginName}` });
        }
    }

    /**
     * Masterserver-Events vom Bot verarbeiten (Bot→Dashboard→IPM)
     * @private
     */
    async _handleMasterserverEvent(action, payload, message) {
        const Logger    = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        const ipmServer = ServiceManager.get('ipmServer');
        const RootServer = require('../../../plugins/masterserver/dashboard/models/RootServer');

        const { guild_id: guildId, rootserver_id: rootserverId } = payload;

        try {
            switch (action) {

                // ── Status aller RootServer der Guild ──────────────────────
                case 'DAEMON_LIST': {
                    if (!guildId) return message.reply({ success: false, error: 'guild_id fehlt' });
                    const servers = await RootServer.getByGuild(guildId);
                    const result = await Promise.all(servers.map(async rs => {
                        // Quota + allokierte Ressourcen laden
                        let freeRamMB = null, freeDiskGB = null;
                        try {
                            const quota = await RootServer.getQuota(rs.id);
                            if (quota) {
                                const [alloc] = await dbService.query(
                                    `SELECT COALESCE(SUM(gq.allocated_ram_mb),0) AS ram,
                                            COALESCE(SUM(gq.allocated_disk_gb),0) AS disk
                                     FROM gameserver_quotas gq WHERE gq.rootserver_id = ?`,
                                    [rs.id]
                                );
                                const overRam  = quota.overallocate_ram_percent  ?? 0;
                                const overDisk = quota.overallocate_disk_percent ?? 0;
                                const totalRam  = Math.round(quota.effective_ram_mb  * (1 + overRam  / 100));
                                const totalDisk = Math.round(quota.effective_disk_gb * (1 + overDisk / 100));
                                freeRamMB  = Math.max(0, totalRam  - (quota.reserved_ram_mb  ?? 0) - (alloc?.ram  ?? 0));
                                freeDiskGB = Math.max(0, totalDisk - (quota.reserved_disk_gb ?? 0) - (alloc?.disk ?? 0));
                            }
                        } catch (_) { /* Quota nicht verfügbar → null bleibt */ }

                        return {
                            id:        rs.id,
                            name:      rs.name,
                            daemon_id: rs.daemon_id,
                            host:      rs.host,
                            status:    rs.daemon_status,
                            isOnline:  ipmServer.isDaemonOnline(rs.daemon_id),
                            version:   rs.daemon_version,
                            gameserver_count: rs.gameserver_count || 0,
                            freeRamMB,
                            freeDiskGB,
                        };
                    }));
                    return message.reply({ success: true, data: result });
                }

                // ── Einzel-Status + Hardware eines RootServers ─────────────
                case 'DAEMON_STATUS': {
                    if (!guildId || !rootserverId) return message.reply({ success: false, error: 'guild_id und rootserver_id erforderlich' });
                    const rs = await RootServer.getById(rootserverId);
                    if (!rs || rs.guild_id !== guildId) return message.reply({ success: false, error: 'RootServer nicht gefunden' });

                    const isOnline = ipmServer.isDaemonOnline(rs.daemon_id);
                    const hw = isOnline ? (ipmServer.getDaemonHardware(rs.daemon_id) || {}) : {};

                    return message.reply({
                        success: true,
                        data: {
                            id:        rs.id,
                            name:      rs.name,
                            daemon_id: rs.daemon_id,
                            host:      rs.host,
                            status:    rs.daemon_status,
                            isOnline,
                            version:   rs.daemon_version,
                            gameserver_count: rs.gameserver_count || 0,
                            hardware: isOnline ? {
                                cpu_percent:  hw.cpu?.usage_percent  ?? null,
                                ram_used_gb:  hw.ram?.used_gb        ?? null,
                                ram_total_gb: hw.ram?.total_gb       ?? null,
                                disk_used_gb: hw.disk?.used_gb       ?? null,
                                disk_total_gb:hw.disk?.total_gb      ?? null,
                            } : null,
                        }
                    });
                }

                // ── Neuen RootServer registrieren ──────────────────────────
                case 'DAEMON_REGISTER': {
                    const { name, host, ram_gb, disk_gb, owner_user_id } = payload;
                    if (!guildId || !name || !ram_gb || !disk_gb) {
                        return message.reply({ success: false, error: 'guild_id, name, ram_gb und disk_gb sind erforderlich' });
                    }
                    const shortGuildId = guildId.substring(0, 10);
                    const result = await RootServer.create({
                        guildId,
                        ownerUserId:    owner_user_id || null,
                        name,
                        host:            host || null,
                        daemonPort:      9340,
                        systemUser:      `guild_${shortGuildId}`,
                        baseDirectory:   '/opt/firebot',
                        ramTotalGb:      parseFloat(ram_gb),
                        diskTotalGb:     parseFloat(disk_gb),
                    });
                    Logger.info(`[IPC/Masterserver] RootServer erstellt via Bot: ${result.id} (Guild: ${guildId})`);
                    return message.reply({
                        success: true,
                        data: {
                            id:        result.id,
                            daemon_id: result.daemonId,
                            api_key:   result.apiKey,
                        }
                    });
                }

                // ── RootServer löschen ────────────────────────────────────
                case 'DAEMON_DELETE': {
                    if (!guildId || !rootserverId) return message.reply({ success: false, error: 'guild_id und rootserver_id erforderlich' });
                    const rs = await RootServer.getById(rootserverId);
                    if (!rs || rs.guild_id !== guildId) return message.reply({ success: false, error: 'RootServer nicht gefunden' });

                    const [{ count }] = await dbService.query(
                        'SELECT COUNT(*) as count FROM gameservers WHERE rootserver_id = ?', [rootserverId]
                    );
                    if (count > 0) return message.reply({ success: false, error: `${count} Gameserver noch aktiv – zuerst löschen!` });

                    if (ipmServer.isDaemonOnline(rs.daemon_id)) {
                        await ipmServer.sendCommand(rs.daemon_id, 'virtual.delete', {
                            daemon_id: rs.daemon_id, rootserver_id: rootserverId
                        }, 30000).catch(() => {});
                    }
                    await dbService.query('DELETE FROM rootserver WHERE id = ? AND guild_id = ?', [rootserverId, guildId]);
                    Logger.info(`[IPC/Masterserver] RootServer ${rootserverId} gelöscht via Bot`);
                    return message.reply({ success: true });
                }

                // ── API-Key des RootServers anzeigen ──────────────────────
                case 'DAEMON_APIKEY': {
                    if (!guildId || !rootserverId) return message.reply({ success: false, error: 'guild_id und rootserver_id erforderlich' });
                    const rs = await RootServer.getById(rootserverId);
                    if (!rs || rs.guild_id !== guildId) return message.reply({ success: false, error: 'RootServer nicht gefunden' });
                    return message.reply({
                        success: true,
                        data: { daemon_id: rs.daemon_id, api_key: rs.api_key }
                    });
                }

                default:
                    return message.reply({ success: false, error: `Unbekannte Aktion: ${action}` });
            }
        } catch (err) {
            Logger.error(`[IPC/Masterserver] ${action} Fehler:`, err);
            return message.reply({ success: false, error: err.message });
        }
    }

    /**
     * Gameserver-Events vom Bot verarbeiten (Bot→Dashboard→IPM)
     * @private
     */
    async _handleGameserverEvent(action, payload, message) {
        const Logger    = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        const ipmServer = ServiceManager.get('ipmServer');

        const { guild_id: guildId, server_id: serverId, rootserver_id: rootserverId } = payload;

        try {
            switch (action) {

                // ── Liste aller Gameserver der Guild (mit Filtern) ──────────────────────
                case 'SERVER_LIST': {
                    if (!guildId) return message.reply({ success: false, error: 'guild_id fehlt' });
                    const { status_filter, rootserver_filter, search } = payload;
                    let query = `
                        SELECT gs.id, gs.name, gs.status,
                               gs.current_players, gs.max_players,
                               gs.rootserver_id,
                               am.name  AS game_name,
                               am.slug  AS game_slug,
                               r.name   AS rootserver_name,
                               r.daemon_id
                        FROM gameservers gs
                        LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
                        LEFT JOIN rootserver r ON gs.rootserver_id = r.id
                        WHERE gs.guild_id = ?`;
                    const params = [guildId];
                    if (status_filter && status_filter !== 'all') { query += ' AND gs.status = ?'; params.push(status_filter); }
                    if (rootserver_filter) { query += ' AND gs.rootserver_id = ?'; params.push(rootserver_filter); }
                    if (search) { query += ' AND gs.name LIKE ?'; params.push(`%${search}%`); }
                    query += ' ORDER BY gs.created_at DESC LIMIT 25';
                    const servers = await dbService.query(query, params);
                    return message.reply({ success: true, data: servers });
                }

                // ── Einzelner Gameserver-Status ─────────────────────────────────────────
                case 'SERVER_STATUS': {
                    if (!guildId || !serverId) return message.reply({ success: false, error: 'guild_id und server_id erforderlich' });
                    const [srv] = await dbService.query(
                        `SELECT gs.*, am.name AS game_name, am.slug AS game_slug,
                                r.name AS rootserver_name, r.daemon_id, r.host
                         FROM gameservers gs
                         LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
                         LEFT JOIN rootserver r ON gs.rootserver_id = r.id
                         WHERE gs.id = ? AND gs.guild_id = ? LIMIT 1`,
                        [serverId, guildId]
                    );
                    if (!srv) return message.reply({ success: false, error: 'Gameserver nicht gefunden' });
                    const daemonOnline = srv.daemon_id ? ipmServer.isDaemonOnline(srv.daemon_id) : false;
                    return message.reply({ success: true, data: { ...srv, daemon_online: daemonOnline } });
                }

                // ── Gameserver erstellen ────────────────────────────────────────────────
                case 'SERVER_CREATE': {
                    const { addon_slug, server_name, owner_user_id } = payload;
                    if (!guildId || !addon_slug || !rootserverId || !server_name)
                        return message.reply({ success: false, error: 'guild_id, addon_slug, rootserver_id und server_name erforderlich' });

                    const [rootserver] = await dbService.query(
                        `SELECT id, name, daemon_id, host, system_user
                         FROM rootserver WHERE id = ? AND guild_id = ? LIMIT 1`,
                        [rootserverId, guildId]
                    );
                    if (!rootserver) return message.reply({ success: false, error: 'RootServer nicht gefunden' });
                    if (!rootserver.daemon_id) return message.reply({ success: false, error: 'RootServer hat keinen Daemon' });

                    const [addon] = await dbService.query(
                        `SELECT id, name, slug, version, game_data, steam_app_id, steam_server_app_id
                         FROM addon_marketplace WHERE slug = ? AND status = 'approved' LIMIT 1`,
                        [addon_slug]
                    );
                    if (!addon) return message.reply({ success: false, error: `Addon \`${addon_slug}\` nicht gefunden` });

                    // game_data parsen + normalisieren (identisch zum Dashboard-POST)
                    let gameData = typeof addon.game_data === 'string' ? JSON.parse(addon.game_data) : (addon.game_data || {});

                    // 1. docker_image aus docker_images (erster Wert)
                    if (!gameData.docker_image && gameData.docker_images) {
                        gameData.docker_image = Object.values(gameData.docker_images)[0] || '';
                    }
                    // 2. Pterodactyl-Format: scripts.installation → installation
                    if (!gameData.installation && gameData.scripts?.installation) {
                        const si = gameData.scripts.installation;
                        gameData.installation = {
                            docker_image:   si.container || '',
                            script_content: (si.script || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
                        };
                    }
                    // 2b. DuneBot-Native-Format: installation.script → script_content
                    // (Valheim, eigene Addons nutzen 'script' statt 'script_content')
                    if (gameData.installation?.script && !gameData.installation?.script_content) {
                        gameData.installation = {
                            ...gameData.installation,
                            script_content: gameData.installation.script.replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
                        };
                    }
                    // 3. variables: Array → Map mit Defaults
                    const envVariables = {};
                    if (Array.isArray(gameData.variables)) {
                        for (const v of gameData.variables) {
                            if (v.env_variable) envVariables[v.env_variable] = v.default_value ?? '';
                        }
                        gameData.variables = { ...envVariables };
                    }

                    // Benutzer-Overrides aus dem Discord-Modal anwenden (überschreiben Defaults)
                    const { env_overrides } = payload;
                    if (env_overrides && typeof env_overrides === 'object') {
                        for (const [key, val] of Object.entries(env_overrides)) {
                            // Nur bekannte ENV-Variable-Keys erlauben (Sicherheit: kein Einschleusen beliebiger Vars)
                            if (typeof key === 'string' && /^[A-Z_][A-Z0-9_]*$/.test(key)) {
                                envVariables[key] = String(val);
                            }
                        }
                    }
                    // gameData.variables mit finalen Werten synchronisieren (inkl. Modal-Overrides)
                    gameData.variables = { ...envVariables };

                    // startup_command
                    const startup_command = gameData.startup?.command || '';
                    if (!startup_command) return message.reply({ success: false, error: `Addon \`${addon_slug}\` hat keinen startup.command` });

                    // Ports aus game_data
                    const ports = {};
                    if (gameData.ports && typeof gameData.ports === 'object') {
                        for (const [portType, portDef] of Object.entries(gameData.ports)) {
                            ports[portType] = { internal: portDef.default || 27015, external: portDef.default || 27015, protocol: portDef.protocol || 'udp' };
                        }
                    }
                    if (!ports.game) ports.game = { internal: 27015, external: 27015, protocol: 'udp' };

                    // ✅ Port-Auto-Assign aus port_allocations Pool (wie Dashboard-Route)
                    const allocatedFromPool = {};
                    const portTypes = Object.keys(ports);
                    for (const portType of portTypes) {
                        const [freeAlloc] = await dbService.query(
                            `SELECT id, port FROM port_allocations 
                             WHERE rootserver_id = ? AND server_id IS NULL 
                             ORDER BY port ASC LIMIT 1`,
                            [rootserverId]
                        );
                        if (freeAlloc) {
                            await dbService.query(
                                'UPDATE port_allocations SET server_id = 0, assigned_at = NOW() WHERE id = ?',
                                [freeAlloc.id]
                            );
                            ports[portType].internal = freeAlloc.port;
                            ports[portType].external = freeAlloc.port;
                            allocatedFromPool[portType] = { allocId: freeAlloc.id, port: freeAlloc.port };
                            Logger.info(`[IPC/Gameserver] Port ${portType} auto-assigned: ${freeAlloc.port} (Allocation #${freeAlloc.id})`);
                        } else {
                            Logger.warn(`[IPC/Gameserver] Kein freier Port im Allocation-Pool für Typ '${portType}' — nutze Default ${ports[portType].external}`);
                        }
                    }

                    // Automatische Variablen-Belegung (generisch für alle Port-Typen)
                    for (const [portType, portData] of Object.entries(ports)) {
                        const envKey = portType.toUpperCase() + '_PORT';
                        if (envKey in envVariables) {
                            envVariables[envKey] = String(portData.internal || portData.external || 27015);
                        }
                        if ((portType === 'game' || portType === 'main') && 'SERVER_PORT' in envVariables) {
                            envVariables.SERVER_PORT = String(portData.internal || portData.external || 27015);
                        }
                    }
                    if ('SERVER_IP'   in envVariables) envVariables.SERVER_IP   = '0.0.0.0';
                    if ('TZ' in envVariables && !envVariables.TZ) envVariables.TZ = 'UTC';

                    const steamAppId = addon.steam_app_id || addon.steam_server_app_id || null;

                    // DB-Insert
                    const result = await dbService.query(
                        `INSERT INTO gameservers
                            (guild_id, user_id, rootserver_id, addon_marketplace_id, template_name,
                             name, install_path, ports, env_variables, frozen_game_data,
                             launch_params, auto_restart, auto_update,
                             allocated_ram_mb, allocated_cpu_percent, allocated_disk_gb,
                             addon_version, status, created_at)
                         VALUES (?, ?, ?, ?, ?, ?, 'temp', ?, ?, ?, ?, 0, 0, NULL, NULL, NULL, ?, 'installing', NOW())`,
                        [guildId, owner_user_id || '0', rootserverId, addon.id, addon.name,
                         server_name,
                         JSON.stringify(ports), JSON.stringify(envVariables),
                         typeof addon.game_data === 'string' ? addon.game_data : JSON.stringify(addon.game_data),
                         startup_command, addon.version]
                    );
                    const newServerId = result.insertId;

                    // ✅ Port-Allocations mit echter server_id aktualisieren
                    if (Object.keys(allocatedFromPool).length > 0) {
                        for (const [portType, alloc] of Object.entries(allocatedFromPool)) {
                            await dbService.query(
                                'UPDATE port_allocations SET server_id = ?, assigned_at = NOW() WHERE id = ?',
                                [newServerId, alloc.allocId]
                            );
                        }
                        Logger.info(`[IPC/Gameserver] ${Object.keys(allocatedFromPool).length} Port-Allocations für Server ${newServerId} zugewiesen`);
                    }

                    // Install-Pfad setzen
                    const installPath = `${newServerId}-${addon_slug}`;
                    await dbService.query('UPDATE gameservers SET install_path = ? WHERE id = ?', [installPath, newServerId]);

                    // bind_ip aus rootserver.host setzen (damit Ports auf der richtigen IP landen)
                    if (rootserver.host) {
                        await dbService.query('UPDATE gameservers SET bind_ip = ? WHERE id = ?', [rootserver.host, newServerId]);
                    }

                    // SFTP-Credentials
                    const sftpUsername = rootserver.system_user || `gs-${String(newServerId).padStart(8, '0')}`;
                    const sftpPassword = require('crypto').randomBytes(10).toString('hex');
                    await dbService.query('UPDATE gameservers SET sftp_username = ?, sftp_password = ? WHERE id = ?', [sftpUsername, sftpPassword, newServerId]);

                    // SFTP-User an Daemon synchronisieren (identisch zum Dashboard-Flow)
                    if (ipmServer?.isDaemonOnline(rootserver.daemon_id)) {
                        ipmServer.sendCommand(rootserver.daemon_id, 'sftp.user.sync', {
                            server_id: String(newServerId),
                            guild_id:  guildId,
                            username:  sftpUsername,
                            password:  sftpPassword,
                        }).catch(e => Logger.warn(`[IPC/Gameserver] SFTP-Sync fehlgeschlagen für ${newServerId}:`, e));
                    }

                    // Installation an Daemon schicken
                    if (ipmServer?.isDaemonOnline(rootserver.daemon_id)) {
                        const installPayload = {
                            server_id:      String(newServerId),
                            rootserver_id:  String(rootserverId),
                            daemon_id:      rootserver.daemon_id,
                            guild_id:       guildId,
                            addon_slug:     addon.slug,
                            addon_name:     addon.name,
                            template_name:  addon.name,
                            steam_app_id:   steamAppId,
                            startup_command,
                            ports,
                            env_variables:  envVariables,
                            game_data:      gameData,
                            platform:       gameData.platform || 'linux',
                            run_install:    true,
                            start_after:    false,
                            resource_limits: { ram_mb: null, cpu_percent: null, disk_gb: null },
                        };

                        // DEBUG: Payload mit Dashboard-Route vergleichbar loggen
                        Logger.debug(`[IPC/Gameserver] 🔍 Install Payload (Bot-Pfad):`, {
                            daemonId: rootserver.daemon_id,
                            server_id: newServerId,
                            addon_slug,
                            env_variables_keys: Object.keys(envVariables),
                            env_variables: envVariables,
                            game_data_vars: gameData.variables,
                            script_len: gameData.installation?.script_content?.length ?? 0,
                            install_image: gameData.installation?.docker_image,
                            runtime_image: gameData.docker_image,
                        });

                        ipmServer.sendCommand(rootserver.daemon_id, 'gameserver.install', installPayload, 60000)
                            .then(r => {
                                if (!r?.success) {
                                    Logger.error(`[IPC/Gameserver] Install failed for ${newServerId}:`, r?.error);
                                    return;
                                }
                                // Allozierte Ports aus Daemon-Response in DB speichern
                                if (r.allocated_ports && Object.keys(r.allocated_ports).length > 0) {
                                    const realPorts = { ...ports };
                                    for (const [portType, portNum] of Object.entries(r.allocated_ports)) {
                                        if (realPorts[portType]) {
                                            realPorts[portType].external = portNum;
                                            realPorts[portType].internal = portNum;
                                        }
                                    }
                                    dbService.query('UPDATE gameservers SET ports = ? WHERE id = ?',
                                        [JSON.stringify(realPorts), newServerId]
                                    ).catch(e => Logger.warn(`[IPC/Gameserver] Port-Update fehlgeschlagen:`, e));
                                }
                            })
                            .catch(e => Logger.error(`[IPC/Gameserver] Install error for ${newServerId}:`, e));
                    } else {
                        await dbService.query("UPDATE gameservers SET status = 'installed' WHERE id = ?", [newServerId]);
                    }

                    return message.reply({ success: true, data: { id: newServerId, name: server_name, addon: addon.name } });
                }

                // ── Gameserver starten ──────────────────────────────────────────────────
                case 'SERVER_START': {
                    if (!guildId || !serverId) return message.reply({ success: false, error: 'guild_id und server_id erforderlich' });
                    const [srv] = await dbService.query(
                        `SELECT gs.id, gs.name, gs.status, gs.rootserver_id,
                                gs.install_path, gs.launch_params, gs.ports, gs.env_variables,
                                gs.frozen_game_data, gs.bind_ip,
                                am.slug AS addon_slug, r.daemon_id, r.system_user
                         FROM gameservers gs
                         JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
                         LEFT JOIN rootserver r ON gs.rootserver_id = r.id
                         WHERE gs.id = ? AND gs.guild_id = ? LIMIT 1`,
                        [serverId, guildId]
                    );
                    if (!srv) return message.reply({ success: false, error: 'Gameserver nicht gefunden' });
                    if (srv.status === 'online') return message.reply({ success: false, error: 'Server läuft bereits' });
                    if (!srv.daemon_id) return message.reply({ success: false, error: 'Kein Daemon zugewiesen' });
                    if (!ipmServer?.isDaemonOnline(srv.daemon_id)) return message.reply({ success: false, error: 'Daemon ist offline' });

                    // ports / env_variables parsen
                    let srvPorts = {};
                    let srvEnv = {};
                    try { srvPorts = typeof srv.ports === 'string' ? JSON.parse(srv.ports) : (srv.ports || {}); } catch (_) {}
                    try { srvEnv = typeof srv.env_variables === 'string' ? JSON.parse(srv.env_variables) : (srv.env_variables || {}); } catch (_) {}

                    // frozen_game_data: docker_image + runtime auslesen
                    let dockerImage = null;
                    let gameDataRuntime = { stop_mode: 'sigterm', stop_command: '', stop_timeout_sec: 30, done_string: '' };
                    let startupCommand = srv.launch_params || './start.sh';
                    try {
                        const frozenData = typeof srv.frozen_game_data === 'string' ? JSON.parse(srv.frozen_game_data) : srv.frozen_game_data;
                        if (frozenData) {
                            const dockerImages = frozenData.docker_images || {};
                            const imageKeys = Object.keys(dockerImages);
                            if (imageKeys.length > 0) dockerImage = dockerImages[imageKeys[0]];

                            const stopSignal = frozenData.startup?.stop || '';
                            if (stopSignal === '^C') { gameDataRuntime.stop_mode = 'sigint'; }
                            else if (stopSignal) { gameDataRuntime.stop_mode = 'console_command'; gameDataRuntime.stop_command = stopSignal; }
                            if (frozenData.startup?.done) gameDataRuntime.done_string = frozenData.startup.done;

                            // Variable-Substitution im startup command
                            if (frozenData.variables && Array.isArray(frozenData.variables)) {
                                for (const varDef of frozenData.variables) {
                                    const envKey = varDef.env_variable;
                                    const value = srvEnv[envKey] ?? srvEnv[varDef.name] ?? varDef.default_value ?? '';
                                    startupCommand = startupCommand.replace(new RegExp(`{{${envKey}}}`, 'g'), String(value));
                                }
                            }
                            for (const [key, value] of Object.entries(srvPorts)) {
                                startupCommand = startupCommand.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
                            }
                        }
                    } catch (_) {}

                    if (!dockerImage) return message.reply({ success: false, error: 'Kein Docker-Image konfiguriert – Server muss neu installiert werden' });

                    await dbService.query("UPDATE gameservers SET status = 'starting', last_started_at = NOW() WHERE id = ?", [serverId]);
                    const startPayload = {
                        server_id:      String(serverId),
                        rootserver_id:  srv.rootserver_id,
                        addon_slug:     srv.addon_slug,
                        startup_command: startupCommand,
                        install_path:   srv.install_path || `${serverId}-${srv.addon_slug}`,
                        system_user:    srv.system_user || 'gameserver',
                        ports:          srvPorts,
                        env_variables:  srvEnv,
                        guild_id:       guildId,
                        bind_ip:        srv.bind_ip || null,
                        game_data: {
                            docker_image: dockerImage,
                            runtime:      gameDataRuntime,
                        },
                    };
                    const startR = await ipmServer.sendCommand(srv.daemon_id, 'gameserver.start', startPayload, 30000);
                    if (!startR?.success) {
                        await dbService.query("UPDATE gameservers SET status = 'error' WHERE id = ?", [serverId]);
                        return message.reply({ success: false, error: startR?.message || 'Start fehlgeschlagen' });
                    }
                    return message.reply({ success: true, data: { name: srv.name } });
                }

                // ── Gameserver stoppen ──────────────────────────────────────────────────
                case 'SERVER_STOP': {
                    if (!guildId || !serverId) return message.reply({ success: false, error: 'guild_id und server_id erforderlich' });
                    const [srv] = await dbService.query(
                        `SELECT gs.id, gs.name, gs.status, r.daemon_id
                         FROM gameservers gs
                         LEFT JOIN rootserver r ON gs.rootserver_id = r.id
                         WHERE gs.id = ? AND gs.guild_id = ? LIMIT 1`,
                        [serverId, guildId]
                    );
                    if (!srv) return message.reply({ success: false, error: 'Gameserver nicht gefunden' });
                    if (srv.status === 'offline') return message.reply({ success: false, error: 'Server ist bereits offline' });
                    if (!srv.daemon_id) return message.reply({ success: false, error: 'Kein Daemon zugewiesen' });
                    if (!ipmServer?.isDaemonOnline(srv.daemon_id)) return message.reply({ success: false, error: 'Daemon ist offline' });

                    await dbService.query("UPDATE gameservers SET status = 'stopping' WHERE id = ?", [serverId]);
                    const stopR = await ipmServer.sendCommand(srv.daemon_id, 'gameserver.stop', {
                        server_id: String(serverId), guild_id: guildId,
                    }, 30000);
                    if (!stopR?.success) {
                        await dbService.query("UPDATE gameservers SET status = 'error' WHERE id = ?", [serverId]);
                        return message.reply({ success: false, error: stopR?.message || 'Stop fehlgeschlagen' });
                    }
                    return message.reply({ success: true, data: { name: srv.name } });
                }

                // ── Gameserver neustarten ───────────────────────────────────────────────
                case 'SERVER_RESTART': {
                    if (!guildId || !serverId) return message.reply({ success: false, error: 'guild_id und server_id erforderlich' });
                    const [srv] = await dbService.query(
                        `SELECT gs.id, gs.name, gs.status, r.daemon_id
                         FROM gameservers gs
                         LEFT JOIN rootserver r ON gs.rootserver_id = r.id
                         WHERE gs.id = ? AND gs.guild_id = ? LIMIT 1`,
                        [serverId, guildId]
                    );
                    if (!srv) return message.reply({ success: false, error: 'Gameserver nicht gefunden' });
                    if (!srv.daemon_id) return message.reply({ success: false, error: 'Kein Daemon zugewiesen' });
                    if (!ipmServer?.isDaemonOnline(srv.daemon_id)) return message.reply({ success: false, error: 'Daemon ist offline' });

                    await dbService.query("UPDATE gameservers SET status = 'starting' WHERE id = ?", [serverId]);
                    const restartR = await ipmServer.sendCommand(srv.daemon_id, 'gameserver.restart', {
                        server_id: String(serverId), guild_id: guildId,
                    }, 30000);
                    if (!restartR?.success) {
                        await dbService.query("UPDATE gameservers SET status = 'offline' WHERE id = ?", [serverId]);
                        return message.reply({ success: false, error: restartR?.message || 'Restart fehlgeschlagen' });
                    }
                    await dbService.query("UPDATE gameservers SET status = 'online', last_started_at = NOW() WHERE id = ?", [serverId]);
                    return message.reply({ success: true, data: { name: srv.name } });
                }

                // ── Addon-Liste (für Server-Erstellung per Autocomplete) ────────────────
                case 'ADDON_LIST': {
                    const rows = await dbService.query(
                        `SELECT id, name, slug, category, version
                         FROM addon_marketplace WHERE status = 'approved'
                         ORDER BY name ASC LIMIT 100`
                    );
                    return message.reply({ success: true, data: rows });
                }

                // ── Benutzer-editierbare Variablen eines Addons ────────────────────────
                case 'ADDON_VARIABLES': {
                    const { addon_slug } = payload;
                    if (!addon_slug) return message.reply({ success: false, error: 'addon_slug erforderlich' });

                    const [addon] = await dbService.query(
                        `SELECT game_data FROM addon_marketplace WHERE slug = ? AND status = 'approved' LIMIT 1`,
                        [addon_slug]
                    );
                    if (!addon) return message.reply({ success: false, error: `Addon \`${addon_slug}\` nicht gefunden` });

                    const gameData = typeof addon.game_data === 'string' ? JSON.parse(addon.game_data) : (addon.game_data || {});
                    const daemonAuto = new Set(['SERVER_IP', 'SERVER_PORT', 'TZ']);
                    // Wichtige Keywords: Diese Variablen kommen zuerst ins Modal
                    const PRIO = ['PASSWORD', 'PASS', 'SECRET', 'TOKEN', 'KEY', 'NAME', 'WORLD', 'MAP', 'SEED'];
                    const vars = (Array.isArray(gameData.variables) ? gameData.variables : [])
                        .filter(v => v.user_editable !== false && !daemonAuto.has(v.env_variable))
                        .sort((a, b) => {
                            const aEmpty    = a.default_value == null || a.default_value === '';
                            const bEmpty    = b.default_value == null || b.default_value === '';
                            const aNullable = typeof a.rules === 'string' ? a.rules.includes('nullable') : !a.rules;
                            const bNullable = typeof b.rules === 'string' ? b.rules.includes('nullable') : !b.rules;

                            // 1. Wirkliche Pflichtfelder zuerst (leer + nicht-nullable)
                            const aRequired = aEmpty && !aNullable;
                            const bRequired = bEmpty && !bNullable;
                            if (aRequired !== bRequired) return aRequired ? -1 : 1;

                            // 2. Wichtige Keywords (Passwort, Name, Welt ...)
                            const aKey  = a.env_variable.toUpperCase();
                            const bKey  = b.env_variable.toUpperCase();
                            const aPrio = PRIO.some(k => aKey.includes(k));
                            const bPrio = PRIO.some(k => bKey.includes(k));
                            if (aPrio !== bPrio) return aPrio ? -1 : 1;

                            // 3. Nullable + kein Default ans Ende (nur optionale Felder wie Beta Branch)
                            const aLast = aEmpty && aNullable;
                            const bLast = bEmpty && bNullable;
                            if (aLast !== bLast) return aLast ? 1 : -1;

                            return 0;
                        });
                    // Rückgabe aller Variablen – der Bot nimmt nur die ersten 5 (Discord-Limit)
                    return message.reply({ success: true, data: vars, total: vars.length });
                }

                default:
                    return message.reply({ success: false, error: `Unbekannte Aktion: ${action}` });
            }
        } catch (err) {
            Logger.error(`[IPC/Gameserver] ${action} Fehler:`, err);
            return message.reply({ success: false, error: err.message });
        }
    }
}

module.exports = IPCServer;