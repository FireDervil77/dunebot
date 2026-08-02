const { Server, ServerStatus } = require("veza");
const { ServiceManager } = require("dunebot-core");
// Welche Aktion in welchem Zustand erlaubt ist, steht an genau einer Stelle.
// Ein Discord-Knopf ist ein Abbild der Vergangenheit und kann jederzeit im
// ungünstigsten Moment geklickt werden – die Prüfung gehört deshalb hierher.
const { pruefeAktion: pruefeServerAktion } =
    require("../../../plugins/gameserver/dashboard/helpers/ServerState");

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
            case 'core':
                return this._handleCoreEvent(action, payload, message);
            case 'masterserver':
                return this._handleMasterserverEvent(action, payload, message);
            case 'gameserver':
                return this._handleGameserverEvent(action, payload, message);
            default:
                return message.reply({ success: false, error: `Unbekanntes Plugin: ${pluginName}` });
        }
    }

    /**
     * Core-Events vom Bot verarbeiten (Bot→Dashboard)
     * Aktuell: UPDATE_PLUGIN_STATUS – synchronisiert Plugin-Enable/Disable ans Dashboard
     * @private
     */
    async _handleCoreEvent(action, payload, message) {
        const Logger = ServiceManager.get('Logger');
        const pluginManager = ServiceManager.get('pluginManager');

        switch (action) {
            case 'UPDATE_PLUGIN_STATUS': {
                const { guildId, enabled = [], disabled = [] } = payload;
                if (!guildId) return message.reply({ success: false, error: 'guildId fehlt' });

                Logger.info(`[IPC/core] Plugin-Status-Update für Guild ${guildId}: +[${enabled.join(',')}] -[${disabled.join(',')}]`);

                for (const pluginName of enabled) {
                    try {
                        await pluginManager.enableInGuild(pluginName, guildId);
                    } catch (err) {
                        Logger.error(`[IPC/core] enableInGuild(${pluginName}) gescheitert:`, err);
                    }
                }
                for (const pluginName of disabled) {
                    try {
                        await pluginManager.disableInGuild(pluginName, guildId);
                    } catch (err) {
                        Logger.error(`[IPC/core] disableInGuild(${pluginName}) gescheitert:`, err);
                    }
                }

                return message.reply({ success: true });
            }
            default:
                return message.reply({ success: false, error: `Unbekannte core-Aktion: ${action}` });
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
                                // Gebucht wird in `gameservers` — `gameserver_quotas`
                                // stand hier bis zum 2026-08-02 und war nie befüllt,
                                // die Summe war also immer 0 und /daemon list meldete
                                // den vollen Speicher als frei.
                                const [alloc] = await dbService.query(
                                    `SELECT COALESCE(SUM(allocated_ram_mb),0)  AS ram,
                                            COALESCE(SUM(allocated_disk_gb),0) AS disk
                                     FROM gameservers WHERE rootserver_id = ?`,
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

        /**
         * Prüft die Berechtigung des Auslösers, wenn einer mitgeschickt wurde.
         *
         * Hintergrund: Der Slash-Befehl `/server` ist über
         * `userPermissions: ['ManageGuild']` gesperrt, ein Panel-Button dagegen
         * steht in einem Kanal, den jeder sehen kann. Kommt eine
         * `actor_user_id` mit, entscheidet derselbe PermissionManager, der das
         * Web-UI absichert – damit kann eine Guild "Starten" an eine
         * Moderatorenrolle geben, ohne ManageGuild zu verschenken.
         *
         * Ohne `actor_user_id` bleibt es beim bisherigen Verhalten (der
         * Slash-Pfad prüft auf Befehlsebene). Das ist bewusst kein
         * Pflichtfeld: Es scharf zu schalten würde Nutzer aussperren, die heute
         * `/server start` benutzen, ohne im Rechtesystem GAMESERVER.START zu
         * haben – das ist eine Entscheidung des Betreibers, kein Nebeneffekt.
         *
         * @param {string} permissionKey
         * @returns {Promise<boolean>} false = Antwort wurde schon gesendet
         */
        const actorMayNot = async (permissionKey) => {
            const actorId = payload.actor_user_id;
            if (!actorId) return false;

            const permissionManager = ServiceManager.get('permissionManager');
            if (!permissionManager) {
                // Kein Rechtesystem erreichbar → nicht durchlassen. Bei einer
                // Aktion, die einen Gameserver stoppt, ist Verweigern die
                // richtige Antwort auf Unwissenheit.
                await message.reply({ success: false, error: 'Rechteprüfung nicht verfügbar' });
                return true;
            }

            const allowed = await permissionManager.hasPermission(actorId, guildId, permissionKey);
            if (!allowed) {
                Logger.warn(`[IPC/Gameserver] ${action} abgelehnt: User ${actorId} ohne ${permissionKey} in Guild ${guildId}`);
                await message.reply({ success: false, error: `Dir fehlt die Berechtigung ${permissionKey}.` });
                return true;
            }

            // Auch die erlaubten Fälle protokollieren: Ein Panel-Button steht in
            // einem Kanal, und wer dort Rechte hat, kann einen Server auch aus
            // Langeweile durchschalten. Ohne diese Zeile ließe sich hinterher
            // nicht sagen, wer den Server um 3 Uhr gestoppt hat.
            Logger.info(`[IPC/Gameserver] ${action} durch User ${actorId} (Server ${serverId}, Guild ${guildId})`);
            return false;
        };

        try {
            switch (action) {

                // ── Liste aller Gameserver der Guild (mit Filtern) ──────────────────────
                case 'SERVER_LIST': {
                    if (!guildId) return message.reply({ success: false, error: 'guild_id fehlt' });
                    const { status_filter, rootserver_filter, search } = payload;
                    let query = `
                        SELECT gs.id, gs.name, gs.status,
                               COALESCE(st.players_current, gs.current_players) AS current_players,
                               COALESCE(st.players_max,     gs.max_players)     AS max_players,
                               st.map     AS live_map,
                               st.online  AS live_online,
                               st.queried_at,
                               gs.rootserver_id,
                               am.name  AS game_name,
                               am.slug  AS game_slug,
                               r.name   AS rootserver_name,
                               r.daemon_id
                        FROM gameservers gs
                        LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
                        LEFT JOIN rootserver r ON gs.rootserver_id = r.id
                        LEFT JOIN gameserver_status st ON st.server_id = gs.id
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
                    // Die Snapshot-Spalten stehen bewusst NACH gs.* – bei gleichem
                    // Alias gewinnt die letzte Spalte, der Live-Wert überschreibt
                    // also den Registry-Wert aus gameservers.
                    const [srv] = await dbService.query(
                        `SELECT gs.*, am.name AS game_name, am.slug AS game_slug,
                                r.name AS rootserver_name, r.daemon_id, r.host,
                                COALESCE(st.players_current, gs.current_players) AS current_players,
                                COALESCE(st.players_max,     gs.max_players)     AS max_players,
                                COALESCE(st.map,             gs.current_map)     AS current_map,
                                st.ping_ms, st.online AS live_online, st.queried_at
                         FROM gameservers gs
                         LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
                         LEFT JOIN rootserver r ON gs.rootserver_id = r.id
                         LEFT JOIN gameserver_status st ON st.server_id = gs.id
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
                    // 2b. FireBot-Native-Format: installation.script → script_content
                    // (Valheim, eigene Addons nutzen 'script' statt 'script_content')
                    if (gameData.installation?.script && !gameData.installation?.script_content) {
                        gameData.installation = {
                            ...gameData.installation,
                            script_content: gameData.installation.script.replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
                        };
                    }
                    // 3. variables: Array → Map mit Defaults
                    // Vorher: Port-Variablen mit daemon_auto_assign merken
                    const autoAssignPortVars = [];
                    const envVariables = {};
                    if (Array.isArray(gameData.variables)) {
                        for (const v of gameData.variables) {
                            if (v.daemon_auto_assign && v.env_variable && v.env_variable.endsWith('_PORT') && v.env_variable !== 'SERVER_PORT') {
                                autoAssignPortVars.push({
                                    env_variable: v.env_variable,
                                    default_value: parseInt(v.default_value, 10) || 0,
                                });
                            }
                        }
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

                    // ✅ Ports aus daemon_auto_assign Variablen ergänzen
                    for (const pv of autoAssignPortVars) {
                        const portType = pv.env_variable.replace(/_PORT$/, '').toLowerCase();
                        if (!ports[portType] && pv.default_value > 0) {
                            ports[portType] = { internal: pv.default_value, external: pv.default_value, protocol: 'udp' };
                            Logger.debug(`[IPC/Gameserver] Port '${portType}' aus daemon_auto_assign Variable ${pv.env_variable} ergänzt (default: ${pv.default_value})`);
                        }
                    }

                    // ✅ Port-Auto-Assign aus port_allocations Pool (sequenziell: Game, Game+1, Game+2, ...)
                    const allocatedFromPool = {};
                    const extraPortTypes = Object.keys(ports).filter(t => t !== 'game');

                    // Game-Port zuerst zuweisen
                    const [gameAlloc] = await dbService.query(
                        `SELECT id, port FROM port_allocations 
                         WHERE rootserver_id = ? AND server_id IS NULL 
                         ORDER BY port ASC LIMIT 1`,
                        [rootserverId]
                    );
                    if (gameAlloc) {
                        await dbService.query(
                            'UPDATE port_allocations SET server_id = 0, assigned_at = NOW() WHERE id = ?',
                            [gameAlloc.id]
                        );
                        ports.game.internal = gameAlloc.port;
                        ports.game.external = gameAlloc.port;
                        allocatedFromPool.game = { allocId: gameAlloc.id, port: gameAlloc.port };
                        Logger.info(`[IPC/Gameserver] Port game auto-assigned: ${gameAlloc.port} (Allocation #${gameAlloc.id})`);

                        // Extra-Ports sequenziell: Game+1, Game+2, ...
                        for (let i = 0; i < extraPortTypes.length; i++) {
                            const portType = extraPortTypes[i];
                            const desiredPort = gameAlloc.port + i + 1;
                            const [seqAlloc] = await dbService.query(
                                `SELECT id, port FROM port_allocations 
                                 WHERE rootserver_id = ? AND port = ? AND server_id IS NULL LIMIT 1`,
                                [rootserverId, desiredPort]
                            );
                            if (seqAlloc) {
                                await dbService.query(
                                    'UPDATE port_allocations SET server_id = 0, assigned_at = NOW() WHERE id = ?',
                                    [seqAlloc.id]
                                );
                                ports[portType].internal = seqAlloc.port;
                                ports[portType].external = seqAlloc.port;
                                allocatedFromPool[portType] = { allocId: seqAlloc.id, port: seqAlloc.port };
                                Logger.info(`[IPC/Gameserver] Port ${portType} sequential: ${seqAlloc.port} (Game+${i + 1}, Allocation #${seqAlloc.id})`);
                            } else {
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
                                    Logger.warn(`[IPC/Gameserver] Port ${portType}: sequenzieller Port ${desiredPort} nicht frei → Fallback: ${freeAlloc.port}`);
                                } else {
                                    Logger.warn(`[IPC/Gameserver] Kein freier Port im Allocation-Pool für Typ '${portType}'`);
                                }
                            }
                        }
                    } else {
                        Logger.warn('[IPC/Gameserver] Kein freier Port im Allocation-Pool für game — nutze Default');
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
                // Baut das Payload **nicht** selbst, sondern über `buildStartPayload` –
                // dieselbe Funktion, die Dashboard-Start, Neustart und Cronjob benutzen.
                //
                // Bis zum 2026-08-01 stand hier eine eigene Kopie, und sie war die letzte
                // abweichende. Ihre Port-Ersetzung suchte nach `{{game}}` und `{{query}}`,
                // weil das die Schlüssel der Portkarte sind – im Startbefehl stehen aber
                // `{{SERVER_PORT}}` und `{{QUERY_PORT}}`. Es passte nichts, also wurde
                // nichts ersetzt: Palworld startete über /server start mit literalem
                // `-port={{SERVER_PORT}}` auf der Kommandozeile. (Zweiter Fehler in
                // derselben Schleife: Ein Porteintrag ist ein Objekt, `String(...)` daraus
                // hätte `[object Object]` ergeben.) Nebenbei fehlten der Kopie auch
                // Template-Overrides, Config-Patching und Auto-Update.
                case 'SERVER_START': {
                    if (!guildId || !serverId) return message.reply({ success: false, error: 'guild_id und server_id erforderlich' });
                    if (await actorMayNot('GAMESERVER.START')) return;

                    const { buildStartPayload, loadServerForStart } =
                        require('../../../plugins/gameserver/dashboard/helpers/StartPayload');

                    const srv = await loadServerForStart(dbService, serverId, guildId);
                    if (!srv) return message.reply({ success: false, error: 'Gameserver nicht gefunden' });

                    const startErlaubt = pruefeServerAktion('start', srv.status, srv.last_status_update);
                    if (!startErlaubt.erlaubt) return message.reply({ success: false, error: startErlaubt.grund });

                    if (!srv.daemon_id) return message.reply({ success: false, error: 'Kein Daemon zugewiesen' });
                    if (!ipmServer?.isDaemonOnline(srv.daemon_id)) return message.reply({ success: false, error: 'Daemon ist offline' });

                    const { payload: startPayload, error: payloadError, dockerImage } =
                        buildStartPayload(srv, guildId, Logger);

                    if (payloadError) {
                        Logger.error(`[IPC/Gameserver] ${payloadError} (Server ${serverId})`);
                        return message.reply({ success: false, error: payloadError });
                    }

                    await dbService.query("UPDATE gameservers SET status = 'starting', last_started_at = NOW(), last_status_update = NOW() WHERE id = ?", [serverId]);
                    // Panel sofort auf "Startet ..." ziehen, statt bis zum
                    // naechsten Poll einen Stopp-Knopf anzubieten, der zu frueh kommt.
                    require('../../../plugins/gameserver/dashboard/helpers/PanelService').pushZustandswechsel(serverId);

                    Logger.info(`[IPC/Gameserver] Start-Command an Daemon ${srv.daemon_id} (Image: ${dockerImage}${startPayload.auto_update ? ', mit Auto-Update' : ''})`);

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
                    if (await actorMayNot('GAMESERVER.STOP')) return;
                    const [srv] = await dbService.query(
                        `SELECT gs.id, gs.name, gs.status, gs.last_status_update, r.daemon_id
                         FROM gameservers gs
                         LEFT JOIN rootserver r ON gs.rootserver_id = r.id
                         WHERE gs.id = ? AND gs.guild_id = ? LIMIT 1`,
                        [serverId, guildId]
                    );
                    if (!srv) return message.reply({ success: false, error: 'Gameserver nicht gefunden' });

                    const stopErlaubt = pruefeServerAktion('stop', srv.status, srv.last_status_update);
                    if (!stopErlaubt.erlaubt) return message.reply({ success: false, error: stopErlaubt.grund });

                    if (!srv.daemon_id) return message.reply({ success: false, error: 'Kein Daemon zugewiesen' });
                    if (!ipmServer?.isDaemonOnline(srv.daemon_id)) return message.reply({ success: false, error: 'Daemon ist offline' });

                    await dbService.query("UPDATE gameservers SET status = 'stopping', last_status_update = NOW() WHERE id = ?", [serverId]);
                    require('../../../plugins/gameserver/dashboard/helpers/PanelService').pushZustandswechsel(serverId);
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
                    if (await actorMayNot('GAMESERVER.RESTART')) return;
                    const [srv] = await dbService.query(
                        `SELECT gs.id, gs.name, gs.status, gs.last_status_update, r.daemon_id
                         FROM gameservers gs
                         LEFT JOIN rootserver r ON gs.rootserver_id = r.id
                         WHERE gs.id = ? AND gs.guild_id = ? LIMIT 1`,
                        [serverId, guildId]
                    );
                    if (!srv) return message.reply({ success: false, error: 'Gameserver nicht gefunden' });

                    const restartErlaubt = pruefeServerAktion('restart', srv.status, srv.last_status_update);
                    if (!restartErlaubt.erlaubt) return message.reply({ success: false, error: restartErlaubt.grund });

                    if (!srv.daemon_id) return message.reply({ success: false, error: 'Kein Daemon zugewiesen' });
                    if (!ipmServer?.isDaemonOnline(srv.daemon_id)) return message.reply({ success: false, error: 'Daemon ist offline' });

                    await dbService.query("UPDATE gameservers SET status = 'starting', last_status_update = NOW() WHERE id = ?", [serverId]);
                    require('../../../plugins/gameserver/dashboard/helpers/PanelService').pushZustandswechsel(serverId);
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

                // ── Status-Panel: sofortige Abfrage (Button "Neu laden") ─────────────────
                case 'PANEL_REFRESH': {
                    if (!guildId || !serverId) return message.reply({ success: false, error: 'guild_id und server_id erforderlich' });
                    // Wer den Status im Dashboard nicht sehen darf, darf ihn auch
                    // nicht über einen Button neu abrufen.
                    if (await actorMayNot('GAMESERVER.VIEW')) return;

                    const [srv] = await dbService.query(
                        'SELECT id FROM gameservers WHERE id = ? AND guild_id = ? LIMIT 1',
                        [serverId, guildId]
                    );
                    if (!srv) return message.reply({ success: false, error: 'Gameserver nicht gefunden' });

                    // Der Poller merkt sich das Interesse, damit die nächsten
                    // Minuten im 10-Sekunden-Takt laufen – jemand schaut ja hin.
                    // ServiceManager.get() wirft bei unbekanntem Namen, deshalb
                    // has(): ist das Gameserver-Plugin nicht geladen, ist das
                    // kein Grund, die Abfrage scheitern zu lassen.
                    if (ServiceManager.has('gameserverStatusPoller')) {
                        ServiceManager.get('gameserverStatusPoller').markInterest?.(serverId);
                    }

                    const PanelService = require('../../../plugins/gameserver/dashboard/helpers/PanelService');
                    const snapshot = await PanelService.refreshNow(serverId);
                    if (!snapshot) return message.reply({ success: false, error: 'Abfrage fehlgeschlagen' });

                    return message.reply({
                        success: true,
                        data: { online: snapshot.online, players_current: snapshot.players_current },
                    });
                }

                // ── Status-Panel anlegen (/server panel-add) ──────────────────────────────
                case 'PANEL_CREATE': {
                    if (!guildId || !serverId) return message.reply({ success: false, error: 'guild_id und server_id erforderlich' });
                    // Gleiche Hürde wie die Dashboard-Route: Ein Panel entscheidet,
                    // was in Discord öffentlich sichtbar ist.
                    if (await actorMayNot('GAMESERVER.EDIT')) return;

                    const { channel_id: channelId, show_players, show_controls, min_interval_s } = payload;
                    if (!channelId) return message.reply({ success: false, error: 'channel_id erforderlich' });

                    const [srv] = await dbService.query(
                        'SELECT id FROM gameservers WHERE id = ? AND guild_id = ? LIMIT 1',
                        [serverId, guildId]
                    );
                    if (!srv) return message.reply({ success: false, error: 'Gameserver nicht gefunden' });

                    const PanelService = require('../../../plugins/gameserver/dashboard/helpers/PanelService');
                    const panel = await PanelService.create({
                        guildId,
                        serverId:     Number(serverId),
                        channelId:    String(channelId),
                        showPlayers:  !!show_players,
                        showControls: show_controls === undefined ? true : !!show_controls,
                        showRefresh:  payload.show_refresh === undefined ? true : !!payload.show_refresh,
                        minIntervalS: Number(min_interval_s) || 60,
                        createdBy:    payload.actor_user_id || null,
                    });

                    return message.reply({
                        success: true,
                        data: {
                            panel_id:      panel?.id,
                            show_players:  !!panel?.show_players,
                            show_controls: !!panel?.show_controls,
                            show_refresh:  !!panel?.show_refresh,
                            last_error:    panel?.last_error || null,
                        },
                    });
                }

                // ── Status-Panel ändern (/server panel-edit) ──────────────────────────────
                case 'PANEL_UPDATE': {
                    if (!guildId || !serverId) return message.reply({ success: false, error: 'guild_id und server_id erforderlich' });
                    if (await actorMayNot('GAMESERVER.EDIT')) return;

                    if (!payload.channel_id) return message.reply({ success: false, error: 'channel_id erforderlich' });

                    const PanelService = require('../../../plugins/gameserver/dashboard/helpers/PanelService');
                    const panel = await PanelService.update({
                        guildId,
                        serverId:     Number(serverId),
                        channelId:    String(payload.channel_id),
                        // null/undefined heißt "unverändert lassen" – der Bot schickt
                        // für nicht angegebene Optionen null.
                        showPlayers:  payload.show_players,
                        showControls: payload.show_controls,
                        showRefresh:  payload.show_refresh,
                        minIntervalS: payload.min_interval_s,
                    });

                    if (!panel) return message.reply({ success: false, error: 'Für diesen Server und Kanal gibt es kein Panel' });

                    return message.reply({
                        success: true,
                        data: {
                            panel_id:       panel.id,
                            show_players:   !!panel.show_players,
                            show_controls:  !!panel.show_controls,
                            show_refresh:   !!panel.show_refresh,
                            min_interval_s: panel.min_interval_s,
                        },
                    });
                }

                // ── Status-Panel entfernen (/server panel-remove) ─────────────────────────
                case 'PANEL_DELETE': {
                    if (!guildId || !serverId) return message.reply({ success: false, error: 'guild_id und server_id erforderlich' });
                    if (await actorMayNot('GAMESERVER.EDIT')) return;

                    const { channel_id: channelId } = payload;
                    if (!channelId) return message.reply({ success: false, error: 'channel_id erforderlich' });

                    const [panel] = await dbService.query(
                        `SELECT id FROM gameserver_status_panels
                         WHERE server_id = ? AND channel_id = ? AND guild_id = ? LIMIT 1`,
                        [serverId, String(channelId), guildId]
                    );
                    if (!panel) return message.reply({ success: false, error: 'Für diesen Server und Kanal gibt es kein Panel' });

                    const PanelService = require('../../../plugins/gameserver/dashboard/helpers/PanelService');
                    await PanelService.remove(panel.id, guildId);
                    return message.reply({ success: true });
                }

                // ── Panel-Nachricht wurde in Discord gelöscht ─────────────────────────────
                //
                // Bis dahin fiel das erst beim nächsten Edit-Versuch auf (Fehlercode
                // 10008). In einem stillen Kanal kann das lange dauern: Die Hash-Bremse
                // verhindert Edits, solange sich am Status nichts ändert – ein nachts
                // gelöschtes Panel wäre also bis zum Morgen verschwunden gewesen.
                //
                // Kein `actorMayNot` hier: Auslöser ist ein Discord-Ereignis, kein
                // Nutzerbefehl. Wer die Nachricht löschen durfte, hat das Recht dazu
                // bereits von Discord bekommen. Geschrieben wird nur `message_id = NULL`,
                // also die Feststellung „die Nachricht gibt es nicht mehr".
                case 'PANEL_MESSAGE_GONE': {
                    const { channel_id: channelId, message_id: messageId } = payload;
                    if (!guildId || !channelId || !messageId) {
                        return message.reply({ success: false, error: 'guild_id, channel_id und message_id erforderlich' });
                    }

                    const result = await dbService.query(
                        `UPDATE gameserver_status_panels
                            SET message_id = NULL
                          WHERE guild_id = ? AND channel_id = ? AND message_id = ?`,
                        [guildId, String(channelId), String(messageId)]
                    );

                    const betroffen = result?.affectedRows ?? result?.changedRows ?? 0;
                    if (betroffen > 0) {
                        Logger.info(`[IPC/Gameserver] Panel-Nachricht ${messageId} in Guild ${guildId} gelöscht – wird neu gepostet`);
                    }
                    return message.reply({ success: true, data: { panels: betroffen } });
                }

                // ── Status-Panels auflisten (/server panel-list) ──────────────────────────
                case 'PANEL_LIST': {
                    if (!guildId) return message.reply({ success: false, error: 'guild_id fehlt' });
                    if (await actorMayNot('GAMESERVER.VIEW')) return;

                    const params = [guildId];
                    let where = 'p.guild_id = ?';
                    if (serverId) { where += ' AND p.server_id = ?'; params.push(serverId); }

                    const panels = await dbService.query(
                        `SELECT p.id, p.server_id, p.channel_id, p.enabled, p.min_interval_s,
                                p.show_players, p.show_controls, p.show_refresh,
                                p.last_pushed_at, p.last_error,
                                gs.name AS server_name
                         FROM gameserver_status_panels p
                         LEFT JOIN gameservers gs ON gs.id = p.server_id
                         WHERE ${where}
                         ORDER BY p.server_id, p.id
                         LIMIT 25`,
                        params
                    );
                    return message.reply({ success: true, data: panels });
                }

                // ── Server-Migration zwischen RootServern ────────────────────────────────
                case 'SERVER_MIGRATE': {
                    if (!guildId || !serverId) {
                        return message.reply({ success: false, error: 'guild_id und server_id erforderlich' });
                    }

                    const { target_rootserver_id, user_id } = payload;
                    if (!target_rootserver_id) {
                        return message.reply({ success: false, error: 'target_rootserver_id erforderlich' });
                    }
                    if (!user_id) {
                        return message.reply({ success: false, error: 'user_id erforderlich' });
                    }

                    this.Logger.info(`[IPCServer] SERVER_MIGRATE request: Server ${serverId} -> RootServer ${target_rootserver_id} (User: ${user_id})`);

                    try {
                        const MigrationManager = require(path.join(__dirname, '../../../plugins/gameserver/dashboard/helpers/MigrationManager.js'));
                        const result = await MigrationManager.startMigration(serverId, target_rootserver_id, user_id, guildId);

                        if (!result.success) {
                            return message.reply({ success: false, error: result.error });
                        }

                        return message.reply({
                            success: true,
                            data: {
                                migration_id: result.migrationId,
                                message: 'Migration gestartet. Du erhältst Updates via SSE.'
                            }
                        });
                    } catch (error) {
                        this.Logger.error('[IPCServer] SERVER_MIGRATE error:', error);
                        return message.reply({ success: false, error: error.message });
                    }
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