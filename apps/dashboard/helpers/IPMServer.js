/**
 * IPM Server - WebSocket Server für Daemon-Kommunikation
 * (Inter-Process-Message Server für externe Go-Daemons)
 * 
 * Verwaltet Verbindungen zu User-seitigen Daemons (Go-basiert)
 * - WebSocket-Server für bidirektionale Kommunikation
 * - Token-basierte Authentifizierung
 * - Heartbeat-Monitoring
 * - Command-Routing (Dashboard/Bot → Daemon)
 * - Event-Broadcasting (Daemon → Dashboard/Bot)
 * 
 * @module IPMServer
 * @author FireBot Team
 */

const WebSocket = require('ws');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { ServiceManager } = require('dunebot-core');
const { MessageValidator, MessageBuilder } = require('dunebot-sdk');
const eventRouter = require('./IPMEventRouter');

class IPMServer {
    /**
     * @param {number} port - WebSocket Port (Standard: 9340)
     */
    constructor(port = 9340) {
        this.port = port;
        this.wss = null;
        this.connections = new Map(); // daemon_id -> {ws, lastHeartbeat, sessionId, metadata}
        this.connectionCounts = new Map(); // daemon_id -> connection_count (für Limit-Tracking)
        this.pendingCommands = new Map(); // commandId -> {resolve, reject, timeout}
        this.Logger = null;
        this.dbService = null;
        
        // JWT Secret aus ENV (oder generieren falls nicht vorhanden)
        this.jwtSecret = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
        this.jwtExpiry = '30d'; // Session-Token gültig für 30 Tage
        
        // ✅ SECURITY: Connection-Limits
        this.maxConnectionsPerDaemon = 3; // Max 3 parallele Verbindungen pro Daemon
    }

    /**
     * Server starten
     */
    async start() {
        this.Logger = ServiceManager.get('Logger');
        this.dbService = ServiceManager.get('dbService');

        this.wss = new WebSocket.Server({ 
            port: this.port,
            perMessageDeflate: false // Performance
        });

        this.wss.on('connection', this._handleConnection.bind(this));
        this.wss.on('error', (error) => {
            this.Logger.error('[IPMServer] WebSocket Server Error:', error);
        });

        // Heartbeat-Monitor (alle 30s prüfen)
        this._startHeartbeatMonitor();
        
        // ✅ Event-Handler für gameserver.status_changed registrieren
        this._registerEventHandlers();

        this.Logger.info(`[IPMServer] WebSocket Server gestartet auf Port ${this.port}`);
    }

    /**
     * Server stoppen
     */
    async stop() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        // Alle Verbindungen sauber schließen
        for (const [daemonId, conn] of this.connections.entries()) {
            conn.ws.close(1000, 'Server shutdown');
        }
        this.connections.clear();

        if (this.wss) {
            await new Promise((resolve) => {
                this.wss.close(() => resolve());
            });
        }

        this.Logger.info('[IPMServer] WebSocket Server gestoppt');
    }

    /**
     * Neue WebSocket-Verbindung
     * @private
     */
    _handleConnection(ws, req) {
        const clientIp = req.socket.remoteAddress;
        this.Logger.debug(`[IPMServer] Neue Verbindung von ${clientIp}`);

        let daemonId = null;
        let authenticated = false;

        ws.on('message', async (data) => {
            try {
                const message = JSON.parse(data.toString());
                
                // Registrierung (erste Nachricht)
                if (message.type === 'register' && !authenticated) {
                    const result = await this._handleRegister(ws, message.payload, clientIp);
                    if (result.success) {
                        daemonId = result.daemonId;
                        authenticated = true;
                        
                        // ✅ SECURITY: Connection-Limit prüfen
                        const currentConnections = this.connectionCounts.get(daemonId) || 0;
                        if (currentConnections >= this.maxConnectionsPerDaemon) {
                            this.Logger.warn(`[IPMServer Security] Daemon ${daemonId} hat zu viele Verbindungen: ${currentConnections}/${this.maxConnectionsPerDaemon}`);
                            ws.send(JSON.stringify({ 
                                type: 'error', 
                                error: `Zu viele Verbindungen (max: ${this.maxConnectionsPerDaemon})` 
                            }));
                            ws.close(4429, 'Too many connections');
                            return;
                        }
                        
                        // Connection registrieren
                        this.connections.set(daemonId, {
                            ws,
                            lastHeartbeat: Date.now(),
                            sessionId: result.sessionId,
                            metadata: result.metadata
                        });
                        
                        // Connection-Count erhöhen
                        this.connectionCounts.set(daemonId, currentConnections + 1);
                        
                        this.Logger.info(`[IPMServer] Daemon ${daemonId} registriert (Guild: ${result.metadata.guild_id}, Connections: ${currentConnections + 1}/${this.maxConnectionsPerDaemon})`);
                        
                        // ✅ RE-TRIGGER: Gameserver mit Status 'installing' erneut senden (NACH Connection-Registrierung!)
                        if (result.isReconnect) {
                            // Asynchron im Hintergrund ausführen, um Registration nicht zu blockieren
                            setImmediate(() => {
                                this._retriggerPendingInstallations(daemonId).catch(err => {
                                    this.Logger.error(`[IPMServer] Re-trigger Fehler für Daemon ${daemonId}:`, err);
                                });
                            });
                        }
                    } else {
                        ws.send(JSON.stringify({ type: 'error', error: result.error }));
                        ws.close(4001, result.error);
                    }
                    return;
                }

                // Alle weiteren Nachrichten erfordern Authentifizierung
                if (!authenticated) {
                    ws.send(JSON.stringify({ type: 'error', error: 'Not authenticated' }));
                    ws.close(4001, 'Authentication required');
                    return;
                }

                // Message-Routing
                await this._routeMessage(daemonId, message);

            } catch (error) {
                this.Logger.error('[IPMServer] Message Parse Error:', error);
                ws.send(JSON.stringify({ type: 'error', error: 'Invalid message format' }));
            }
        });

        ws.on('close', () => {
            if (daemonId) {
                this.connections.delete(daemonId);
                
                // ✅ SECURITY: Connection-Count verringern
                const currentConnections = this.connectionCounts.get(daemonId) || 0;
                const newCount = Math.max(0, currentConnections - 1);
                this.connectionCounts.set(daemonId, newCount);
                
                this.Logger.info(`[IPMServer] Daemon ${daemonId} disconnected (Connections: ${newCount}/${this.maxConnectionsPerDaemon})`);
            }
        });

        ws.on('error', (error) => {
            this.Logger.error(`[IPMServer] WebSocket Error (Daemon: ${daemonId}):`, error);
        });
    }

    /**
     * Message-Routing (Commands, Events, Responses)
     * @private
     */
    async _routeMessage(daemonId, message) {
        try {
            const { type, namespace, action } = message;
            
            // Response-Handling (für Commands von Dashboard → Daemon)
            if (type === 'response' || type === 'command_response') {
                this._resolveCommand(message.id, message);
                return;
            }
            
            // ✅ NEU: Event-Routing über IPMEventRouter
            if (type === 'event' && namespace && action) {
                this.Logger.debug(`[IPMServer] Event empfangen: ${namespace}.${action} von Daemon ${daemonId}`);
                
                // An EventRouter weiterleiten
                await eventRouter.route(message, { daemonId });
                // ⚠️  KEIN return hier - Legacy-Handler sollen auch laufen!
            }
            
            // ════════════════════════════════════════════════════════════
            // ⚠️  DEPRECATED: Legacy Event-Handling (für Backwards-Compat)
            // ════════════════════════════════════════════════════════════
            // TODO: Entfernen wenn Daemon vollständig auf protocol.Message umgestellt ist
            
            // Legacy-Format: message.event ODER namespace.action kombinieren
            const event = message.event || (namespace && action ? `${namespace}.${action}` : null);
            
            // Payload-Mapping: Neues Format nutzt message.payload, Legacy nutzt message.data
            const eventData = message.payload || message.data;
            
            if (!event) {
                this.Logger.warn('[IPMServer] Message ohne event/namespace:', message);
                return;
            }

            // Legacy-Event-Mapping (nur Events die NICHT vom EventRouter gehandled werden)
            switch (event) {
                case 'heartbeat':
                    this._handleHeartbeat(daemonId, message.data);
                    break;

                // install.progress, install.completed, install.failed → EventRouter handles these
                // gameserver.status_changed → EventRouter handles this

                default:
                    // Nur loggen wenn es kein Event ist, das der EventRouter handled
                    if (!namespace || !action) {
                        this.Logger.debug(`[IPMServer] Unbekanntes Event: ${event}`);
                    }
            }
        } catch (error) {
            this.Logger.error('[IPMServer] Fehler beim Message-Routing:', error);
        }
    }

    /**
     * Daemon-Registrierung mit 2-Token-System (Setup-Token + JWT Session-Token)
     * 
     * Flow:
     * 1. Erste Registrierung: Setup-Token (bcrypt) → JWT Session-Token generieren
     * 2. Reconnect: JWT validieren → Neuen JWT generieren (Token-Rotation)
     * 
     * @param {WebSocket} ws - WebSocket Connection
     * @param {object} payload - Register-Payload
     * @param {string} clientIp - Client IP-Adresse
     * @private
     */
    async _handleRegister(ws, payload, clientIp) {
        const { token, daemon_id, version, hardware } = payload; // ✅ Hardware-Info extrahieren

        if (!token || !daemon_id) {
            return { success: false, error: 'Missing token or daemon_id' };
        }
        
        // ✅ SECURITY: IP-Logging für Audit
        this.Logger.info(`[IPMServer] Registrierungsversuch von Daemon ${daemon_id} (IP: ${clientIp})`);


        try {
            // Prüfen ob Token ein JWT ist (Session-Token)
            const isJWT = token.startsWith('eyJ'); // JWT startet immer mit "eyJ"
            
            // ======================================
            // FALL 1: JWT Session-Token (Reconnect)
            // ======================================
            if (isJWT) {
                try {
                    // JWT validieren
                    const decoded = jwt.verify(token, this.jwtSecret);
                    
                    // Prüfen ob daemon_id übereinstimmt
                    if (decoded.daemon_id !== daemon_id) {
                        return { success: false, error: 'Token daemon_id mismatch' };
                    }
                    
                    // Daemon aus DB laden
                    const [daemon] = await this.dbService.query(
                        'SELECT * FROM rootserver WHERE daemon_id = ?',
                        [daemon_id]
                    );
                    
                    if (!daemon) {
                        return { success: false, error: 'Daemon not found' };
                    }
                    
                    // Neuen Session-Token generieren (Token-Rotation!)
                    const newSessionToken = jwt.sign({
                        daemon_id: daemon.daemon_id,
                        guild_id: daemon.guild_id,
                        version: version || daemon.daemon_version
                    }, this.jwtSecret, { expiresIn: this.jwtExpiry });
                    
                    // Daemon-Status aktualisieren
                    await this.dbService.query(
                        `UPDATE rootserver 
                         SET daemon_status = 'online', 
                             last_seen = NOW(),
                             daemon_version = ?,
                             session_token = ?,
                             session_token_expires_at = DATE_ADD(NOW(), INTERVAL 30 DAY)
                         WHERE daemon_id = ?`,
                        [version || daemon.daemon_version, newSessionToken, daemon_id]
                    );
                    
                    await this._logDaemonEvent(daemon_id, 'reconnected', { version });
                    
                    // Server-Registry für diesen RootServer laden
                    const reconnectServers = await this.dbService.query(
                        `SELECT id AS server_id, name,
                                ROUND(allocated_ram_mb / 1024.0, 2) AS ram_limit_gb,
                                allocated_disk_gb AS disk_limit_gb
                         FROM gameservers
                         WHERE rootserver_id = ?`,
                        [daemon.id]
                    );
                    
                    ws.send(JSON.stringify({ 
                        type: 'registered', 
                        sessionToken: newSessionToken,
                        rootserver: {
                            id: daemon.id,
                            name: daemon.name,
                            base_directory: daemon.base_directory,
                            system_user: daemon.system_user
                        },
                        serverRegistry: reconnectServers || []
                    }));
                    
                    return { 
                        success: true, 
                        daemonId: daemon_id, 
                        sessionId: newSessionToken,
                        isReconnect: true,
                        metadata: {
                            guild_id: daemon.guild_id,
                            display_name: daemon.name,
                            version: version || daemon.daemon_version,
                            hardware: hardware || null
                        }
                    };
                    
                } catch (jwtError) {
                    // JWT ungültig/abgelaufen
                    if (jwtError.name === 'TokenExpiredError') {
                        this.Logger.warn(`[IPMServer] Session token expired for daemon ${daemon_id}`);
                        return { success: false, error: 'Session token expired - use setup token' };
                    }
                    this.Logger.error('[IPMServer] JWT verification failed:', jwtError);
                    return { success: false, error: 'Invalid session token' };
                }
            }
            
            // ================================================
            // FALL 2: Setup-Token / API-Key (Erste Registrierung)
            // ================================================

            // RootServer anhand daemon_id + api_key direkt aus rootserver-Tabelle laden
            const [rootserverByToken] = await this.dbService.query(
                `SELECT * FROM rootserver WHERE daemon_id = ? AND api_key = ? LIMIT 1`,
                [daemon_id, token]
            );

            if (!rootserverByToken) {
                return { success: false, error: 'Invalid or expired token' };
            }

            // JWT Session-Token generieren
            const sessionToken = jwt.sign({
                daemon_id,
                guild_id: rootserverByToken.guild_id,
                version: version || 'unknown'
            }, this.jwtSecret, { expiresIn: this.jwtExpiry });

            // Daemon-Status + Session-Token in rootserver aktualisieren
            // install_status → 'completed' bei erster erfolgreicher Verbindung
            await this.dbService.query(
                `UPDATE rootserver 
                 SET daemon_status = 'online', 
                     install_status = 'completed',
                     last_seen = NOW(),
                     daemon_version = ?,
                     session_token = ?,
                     session_token_expires_at = DATE_ADD(NOW(), INTERVAL 30 DAY)
                 WHERE daemon_id = ?`,
                [version || 'unknown', sessionToken, daemon_id]
            );

            // Audit-Log
            await this._logDaemonEvent(daemon_id, 'first_registration', { version });

            // Server-Registry für diesen RootServer laden (kann leer sein bei Erst-Registrierung)
            const firstRegServers = await this.dbService.query(
                `SELECT id AS server_id, name,
                        ROUND(allocated_ram_mb / 1024.0, 2) AS ram_limit_gb,
                        allocated_disk_gb AS disk_limit_gb
                 FROM gameservers
                 WHERE rootserver_id = ?`,
                [rootserverByToken.id]
            );

            ws.send(JSON.stringify({ 
                type: 'registered', 
                sessionToken,
                rootserver: {
                    id: rootserverByToken.id,
                    name: rootserverByToken.name,
                    base_directory: rootserverByToken.base_directory,
                    system_user: rootserverByToken.system_user
                },
                serverRegistry: firstRegServers || []
            }));

            return { 
                success: true, 
                daemonId: daemon_id, 
                sessionId: sessionToken,
                metadata: {
                    guild_id: rootserverByToken.guild_id,
                    display_name: rootserverByToken.name,
                    version,
                    hardware: hardware || null
                }
            };

        } catch (error) {
            this.Logger.error('[IPMServer] Register Error:', error);
            return { success: false, error: 'Internal server error' };
        }
    }

    /**
     * Message-Routing
     * @private
     */
    async _routeMessage(daemonId, message) {
        const { type, payload, id } = message;

        // ✅ Case-insensitive Type-Matching (Go-Daemon sendet UPPERCASE)
        const normalizedType = type?.toLowerCase();

        // ✅ NEU: Standardisierte Messages über Event-Router routen
        // Validierung + Routing für Command/Event Messages
        if (message.namespace && message.action) {
            // Standardisierte IPM-Message → Event-Router
            await eventRouter.route(message, { daemonId });
            
            // Bei Commands: Auch alte Logik beibehalten (für Rückwärtskompatibilität)
            if (normalizedType === 'command' || normalizedType === 'response') {
                // Weiterhin durch switch-case laufen lassen
            } else {
                // Events wurden bereits geroutet, fertig
                return;
            }
        }

        switch (normalizedType) {
            case 'heartbeat':
                await this._handleHeartbeat(daemonId, payload);
                break;

            case 'response':
                // Antwort auf Command (Command-ID in payload.commandId)
                this._resolveCommand(payload.commandId, payload);
                break;

            case 'command_response':
                // ✅ Go-Daemon sendet unterschiedliche Formate:
                // Format 1: { type: "command_response", id: "...", success: true, data: {...} }
                // Format 2: { type: "command_response", id: "...", payload: { success: true, ... } }
                // Versuche payload zuerst, dann message als Fallback
                const responseData = message.payload || message;
                this._resolveCommand(id, responseData);
                break;

            case 'event':
                // Event vom Daemon (Server-Status, Error, etc.)
                // ✅ ALT: Legacy-Format (ohne namespace/action)
                if (!message.namespace) {
                    await this._handleDaemonEvent(daemonId, payload);
                }
                break;

            case 'log':
                // Log-Nachricht vom Daemon
                await this._handleDaemonLog(daemonId, payload);
                break;

            default:
                this.Logger.warn(`[IPMServer] Unknown message type: ${type} from Daemon ${daemonId}`);
        }
    }

    /**
     * Heartbeat verarbeiten
     * @private
     */
    async _handleHeartbeat(daemonId, payload) {
        const conn = this.connections.get(daemonId);
        if (!conn) return;

        conn.lastHeartbeat = Date.now();

        // Latenz aus Heartbeat-Timestamp berechnen (Daemon sendet Unix-Timestamp in Sekunden)
        const pingMs = payload.timestamp ? Math.max(0, Date.now() - (payload.timestamp * 1000)) : null;

        // Hardware-Stats in Connection-Metadata speichern
        if (payload.hardware) {
            conn.metadata.hardware = payload.hardware;
            
            // ✅ Hardware-Stats in rootserver Tabelle speichern
            const RootServer = require('../../../plugins/masterserver/dashboard/models/RootServer');
            
            try {
                await RootServer.updateHardwareStats(daemonId, payload.hardware);
                this.Logger.debug('[IPMServer] Hardware-Stats in DB gespeichert');
            } catch (error) {
                this.Logger.error('[IPMServer] Fehler beim Speichern der Hardware-Stats:', error);
            }

            // ✅ SSE-Broadcast: Hardware-Metriken an Browser pushen
            const guildId = conn.metadata.guild_id;
            if (guildId) {
                const sseManager = ServiceManager.get('sseManager');
                if (sseManager) {
                    const hw = payload.hardware;
                    sseManager.broadcast(guildId, 'metrics', {
                        action: 'host_stats',
                        daemon_id: daemonId,
                        cpu_percent:  hw.cpu?.usage_percent ?? null,
                        ram_used_gb:  hw.ram?.used_gb ?? null,
                        ram_total_gb: hw.ram?.total_gb ?? null,
                        disk_used_gb: hw.disk?.used_gb ?? null,
                        disk_total_gb: hw.disk?.total_gb ?? null,
                        network:      hw.network ?? null,
                        ping_ms:      pingMs,
                        timestamp:    Date.now()
                    });
                }
            }
        }

        // Update-Info in Connection-Metadata speichern
        if (payload.updateInfo) {
            conn.metadata.updateInfo = payload.updateInfo;
            this.Logger.debug(`[IPMServer] Update-Info: ${payload.updateInfo.currentVersion} → ${payload.updateInfo.latestVersion} (Available: ${payload.updateInfo.available})`);
        }

        // DB-Update (last_seen + last_ping_ms)
        await this.dbService.query(
            'UPDATE rootserver SET last_seen = NOW(), last_ping_ms = COALESCE(?, last_ping_ms) WHERE daemon_id = ?',
            [pingMs, daemonId]
        );

        // ACK senden
        conn.ws.send(JSON.stringify({ 
            type: 'heartbeat_ack',
            timestamp: Date.now()
        }));

        // Optional: Server-Registry-Status aktualisieren + SSE-Broadcast pro Gameserver
        if (payload.servers) {
            await this._updateServerRegistry(daemonId, payload.servers, conn.metadata.guild_id);
        }
    }

    /**
     * Server-Registry aktualisieren
     * @private
     */
    async _updateServerRegistry(daemonId, servers, guildId) {
        // Status-Mapping: Daemon-States → MySQL ENUM (online,offline,starting,stopping,error)
        const registryStatusMap = { running: 'online', stopped: 'offline', crashed: 'error' };
        const sseManager = ServiceManager.get('sseManager');

        for (const server of servers) {
            const rawStatus = server.status || 'offline';
            const dbStatus = registryStatusMap[rawStatus] ?? rawStatus;

            await this.dbService.query(
                `UPDATE server_registry 
                 SET status = ?, 
                     current_players = ?,
                     cpu_percent = ?,
                     ram_used_mb = ?,
                     ram_total_mb = ?,
                     last_heartbeat = NOW()
                 WHERE daemon_id = ? AND server_id = ?`,
                [
                    dbStatus,
                    server.players ?? null,
                    server.cpu_percent ?? null,
                    server.ram_used_mb ?? null,
                    server.ram_total_mb ?? null,
                    daemonId, 
                    server.server_id
                ]
            );

            // ✅ SSE-Broadcast: Per-Gameserver Metriken an Browser pushen
            if (guildId && sseManager) {
                sseManager.broadcast(guildId, 'metrics', {
                    action: 'server_stats',
                    server_id: server.server_id,
                    status: dbStatus,
                    cpu_percent: server.cpu_percent ?? null,
                    ram_used_mb: server.ram_used_mb ?? null,
                    ram_total_mb: server.ram_total_mb ?? null,
                    current_players: server.players ?? null,
                    max_players: server.max_players ?? null,
                    timestamp: Date.now()
                });
            }
        }
    }

    /**
     * Daemon-Event verarbeiten
     * @private
     */
    async _handleDaemonEvent(daemonId, payload) {
        const { event, data } = payload;

        this.Logger.debug(`[IPMServer] Event from Daemon ${daemonId}: ${event}`, data);

        // ✅ Dashboard-Events DIREKT verarbeiten (ohne IPC zum Bot)
        await this._processDashboardEvent(daemonId, event, data);

        // Event an IPC-Server weiterleiten (Bot benachrichtigen) - TODO: Später implementieren
        const ipcServer = ServiceManager.get('ipcServer');
        if (ipcServer) {
            ipcServer.broadcast('daemon:event', { daemonId, event, data });
        }

        // Event in DB loggen
        await this._logDaemonEvent(daemonId, event, data);
    }

    /**
     * Dashboard-Events direkt verarbeiten
     * @private
     */
    async _processDashboardEvent(daemonId, event, data) {
        switch (event) {
            case 'gameserver.install_complete':
                await this._handleGameserverInstallComplete(daemonId, data);
                break;

            case 'gameserver.install_failed':
                await this._handleGameserverInstallFailed(daemonId, data);
                break;

            case 'gameserver.status_changed':
                await this._handleGameserverStatusChanged(daemonId, data);
                break;

            // Weitere Events hier hinzufügen...
        }
    }

    /**
     * Gameserver Installation abgeschlossen
     * @private
     */
    async _handleGameserverInstallComplete(daemonId, data) {
        const { server_id } = data;
        
        this.Logger.info(`[IPMServer] Gameserver ${server_id} Installation abgeschlossen`);

        // ✅ Server-Status in DB auf 'offline' setzen (Installation fertig)
        await this.dbService.query(
            `UPDATE gameservers 
             SET status = 'offline', 
                 install_phase = NULL,
                 updated_at = NOW() 
             WHERE id = ?`,
            [server_id]
        );

        // ✅ Install-Counter in addon_marketplace erhöhen
        try {
            // addon_marketplace_id aus gameservers holen, dann slug über JOIN
            const [gsRow] = await this.dbService.query(
                'SELECT am.slug FROM gameservers gs LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id WHERE gs.id = ?',
                [server_id]
            );
            
            if (gsRow && gsRow.slug) {
                await this.dbService.query(
                    'UPDATE addon_marketplace SET install_count = install_count + 1 WHERE slug = ?',
                    [gsRow.slug]
                );
                this.Logger.success(`[IPMServer] Install-Counter für Addon '${gsRow.slug}' erhöht`);
            } else {
                this.Logger.warn(`[IPMServer] Server ${server_id} hat kein Addon zugewiesen - Counter nicht erhöht`);
            }
        } catch (error) {
            this.Logger.error(`[IPMServer] Fehler beim Erhöhen des Install-Counters:`, error);
            // Nicht kritisch - Installation war erfolgreich
        }

        this.Logger.success(`[IPMServer] Gameserver ${server_id} Status → offline`);
    }

    /**
     * Gameserver Installation fehlgeschlagen
     * @private
     */
    async _handleGameserverInstallFailed(daemonId, data) {
        const { server_id, error } = data;
        
        this.Logger.error(`[IPMServer] Gameserver ${server_id} Installation fehlgeschlagen: ${error}`);

        // ✅ Server-Status auf 'error' setzen
        await this.dbService.query(
            `UPDATE gameservers 
             SET status = 'error', 
                 install_phase = NULL,
                 updated_at = NOW() 
             WHERE id = ?`,
            [server_id]
        );
    }

    /**
     * Gameserver Status-Änderung (z.B. crashed, stopped)
     * Wird vom Daemon gesendet wenn Health-Check fehlschlägt
     * 
     * @param {string} daemonId - Daemon ID
     * @param {object} data - Event-Daten { server_id, status, timestamp }
     * @private
     */
    async _handleGameserverStatusChanged(daemonId, data) {
        const { server_id, status, timestamp } = data;
        
        this.Logger.info(`[IPMServer] 🔄 Gameserver ${server_id} Status-Änderung: ${status} (von Daemon ${daemonId})`);

        try {
            // ✅ Status-Mapping: Daemon-States → MySQL ENUM
            // Daemon-States: offline, starting, running, stopped, stopping, crashed, installing
            // MySQL ENUM:    offline, starting, online,  offline,  stopping, error,   installing, installed, updating
            const statusMap = { running: 'online', stopped: 'offline', crashed: 'error' };
            const dbStatus = statusMap[status] ?? status;

            // Guard: ungültige Status-Werte abfangen
            const validStatuses = ['installing', 'installed', 'starting', 'online', 'stopping', 'offline', 'error', 'updating'];
            if (!dbStatus || !validStatuses.includes(dbStatus)) {
                this.Logger.warn(`[IPMServer] ⚠️ Ungültiger Status '${status}' (mapped: '${dbStatus}') für Server ${server_id} – Update übersprungen`);
                return;
            }

            // Server-Status in MySQL aktualisieren
            const result = await this.dbService.query(
                `UPDATE gameservers 
                 SET status = ?, 
                     updated_at = NOW()
                     ${dbStatus === 'online' ? ', last_started_at = NOW()' : ''} 
                 WHERE id = ?`,
                [dbStatus, server_id]
            );

            if (result.affectedRows > 0) {
                this.Logger.success(`[IPMServer] ✅ Gameserver ${server_id} Status → ${dbStatus} (MySQL synchronized)`);
                
                // ✅ Guild-ID holen für SSE-Broadcast
                const [server] = await this.dbService.query(
                    'SELECT guild_id, name FROM gameservers WHERE id = ?',
                    [server_id]
                );
                
                if (server) {
                    // ✅ SSE-Broadcast an Browser-Clients
                    const sseManager = ServiceManager.get('sseManager');
                    if (sseManager) {
                        sseManager.broadcast(server.guild_id, 'gameserver', {
                            action: 'status_changed',
                            server_id: server_id,
                            status: dbStatus,
                            timestamp: timestamp || Date.now()
                        });
                        
                        this.Logger.debug(`[IPMServer] 📡 SSE-Broadcast gesendet für Server ${server_id} → ${dbStatus}`);
                    }
                } else {
                    this.Logger.warn(`[IPMServer] ⚠️ Konnte Server ${server_id} nicht für SSE-Broadcast laden`);
                }
            } else {
                this.Logger.warn(`[IPMServer] ⚠️ Gameserver ${server_id} nicht in MySQL gefunden`);
            }

        } catch (error) {
            this.Logger.error(`[IPMServer] ❌ Fehler beim Status-Update für Server ${server_id}:`, error);
        }
    }

    /**
     * Daemon-Log verarbeiten
     * @private
     */
    async _handleDaemonLog(daemonId, payload) {
        const { level, message, context } = payload;

        try {
            // Guild-ID für Log-Eintrag holen
            const [daemon] = await this.dbService.query(
                'SELECT guild_id FROM rootserver WHERE daemon_id = ?',
                [daemonId]
            );
            
            if (!daemon) return;
            
            // Level zu event_type mappen (error → error, rest → status_change)
            const eventType = level === 'error' ? 'error' : 'status_change';

            await this.dbService.query(
                `INSERT INTO daemon_logs (guild_id, daemon_id, event_type, level, action, message, metadata, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
                [daemon.guild_id, daemonId, eventType, level, level, message, JSON.stringify(context || {})]
            );
        } catch (error) {
            this.Logger.error('[IPMServer] Failed to log daemon message:', error);
        }
    }

    /**
     * Daemon-Event loggen
     * @private
     */
    async _logDaemonEvent(daemonId, event, data) {
        try {
            // Guild-ID für Log-Eintrag holen
            const [daemon] = await this.dbService.query(
                'SELECT guild_id FROM rootserver WHERE daemon_id = ?',
                [daemonId]
            );
            
            if (!daemon) return;
            
            // Event-Typ Mapping (ENUM: register, disconnect, command, error, status_change, heartbeat_lost, reconnect)
            const eventTypeMap = {
                'first_registration': 'register',
                'reconnected': 'reconnect',
                'connected': 'register'
            };
            const eventType = eventTypeMap[event] || 'status_change';
            
            // Level basierend auf Event-Typ bestimmen
            let level = 'info'; // Default
            if (eventType === 'error') level = 'error';
            else if (eventType === 'disconnect' || eventType === 'heartbeat_lost') level = 'warn';
            else if (eventType === 'register' || eventType === 'reconnect') level = 'info';
            
            await this.dbService.query(
                `INSERT INTO daemon_logs (guild_id, daemon_id, event_type, level, action, message, metadata, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    daemon.guild_id,
                    daemonId,
                    eventType,
                    level,
                    event, // action: 'first_registration', 'reconnected', 'connected'
                    `Daemon Event: ${event}`,
                    JSON.stringify(data || {})
                ]
            );
        } catch (error) {
            this.Logger.error('[IPMServer] Failed to log daemon event:', error);
        }
    }

    /**
     * Command an Daemon senden (async mit Promise)
     * 
     * @param {string} daemonId - Daemon ID
     * @param {string} command - Command-Name (z.B. 'server.start', 'server.stop')
     * @param {object} payload - Command-Daten
     * @param {number} timeout - Timeout in ms (wird automatisch basierend auf Command gesetzt)
     * @returns {Promise<object>} Command-Response
     */
    async sendCommand(daemonId, command, payload = {}, timeout = null) {
        // NOTE: Keine Payload-Validierung für Daemon-Commands!
        // IPMServer kommuniziert direkt mit Go-Daemon (firebot_daemon), NICHT mit Bot
        // WebSocket-Validator ist nur für Bot-Commands gedacht
        
        const conn = this.connections.get(daemonId);
        
        if (!conn) {
            throw new Error(`Daemon ${daemonId} not connected`);
        }

        // Intelligente Timeout-Auswahl basierend auf Command
        if (timeout === null) {
            // Commands mit SteamCMD-Installation brauchen VIEL mehr Zeit
            const longRunningCommands = [
                'gameserver.install',   // 2-5 Minuten (SteamCMD Download)
                'virtual.create'        // 1-3 Minuten (inkl. SteamCMD Installation)
            ];
            
            timeout = longRunningCommands.includes(command) 
                ? 300000  // 5 Minuten für SteamCMD-Operations
                : 60000;  // 60s für normale Commands
            
            this.Logger.debug(`[IPMServer] Auto-Timeout für ${command}: ${timeout}ms`);
        }

        const commandId = crypto.randomBytes(16).toString('hex');

        return new Promise((resolve, reject) => {
            // Timeout
            const timeoutHandle = setTimeout(() => {
                this.pendingCommands.delete(commandId);
                reject(new Error(`Command timeout after ${timeout}ms`));
            }, timeout);

            // Speichern für Response-Routing
            this.pendingCommands.set(commandId, {
                resolve: (result) => {
                    clearTimeout(timeoutHandle);
                    resolve(result);
                },
                reject: (error) => {
                    clearTimeout(timeoutHandle);
                    reject(error);
                },
                timeout: timeoutHandle
            });

            // Command senden
            conn.ws.send(JSON.stringify({
                type: 'command',
                id: commandId,
                command,
                payload
            }));

            this.Logger.debug(`[IPMServer] Command sent to Daemon ${daemonId}: ${command} (ID: ${commandId})`);
        });
    }

    /**
     * Command-Response verarbeiten
     * @private
     */
    _resolveCommand(commandId, response) {
        const pending = this.pendingCommands.get(commandId);
        
        if (!pending) {
            this.Logger.warn(`[IPMServer] Received response for unknown command: ${commandId}`);
            return;
        }

        this.pendingCommands.delete(commandId);

        if (response && response.success) {
            pending.resolve(response);
        } else {
            pending.reject(new Error(response?.error || 'Command failed'));
        }
    }

    /**
     * Heartbeat-Monitor (prüft tote Verbindungen)
     * @private
     */
    _startHeartbeatMonitor() {
        this.heartbeatInterval = setInterval(() => {
            const now = Date.now();
            const timeout = 60000; // 60s (2x Heartbeat-Interval)

            for (const [daemonId, conn] of this.connections.entries()) {
                if (now - conn.lastHeartbeat > timeout) {
                    this.Logger.warn(`[IPMServer] Daemon ${daemonId} heartbeat timeout - closing connection`);
                    conn.ws.close(4000, 'Heartbeat timeout');
                    this.connections.delete(daemonId);

                    // Status in DB auf offline setzen
                    this.dbService.query(
                        'UPDATE rootserver SET daemon_status = \'offline\' WHERE daemon_id = ?',
                        [daemonId]
                    ).catch(err => this.Logger.error('[IPMServer] DB Update Error:', err));
                }
            }
        }, 30000); // Alle 30s prüfen
    }

    /**
     * Alle verbundenen Daemons abrufen
     * @returns {Array<{daemonId: string, guildId: string, displayName: string}>}
     */
    getConnectedDaemons() {
        return Array.from(this.connections.entries()).map(([daemonId, conn]) => ({
            daemonId,
            guildId: conn.metadata.guild_id,
            displayName: conn.metadata.display_name,
            version: conn.metadata.version,
            lastHeartbeat: conn.lastHeartbeat,
            hardware: conn.metadata.hardware || null
        }));
    }

    /**
     * Hardware-Stats eines spezifischen Daemons abrufen
     * @param {string} daemonId - Daemon ID
     * @returns {object|null}
     */
    getDaemonHardware(daemonId) {
        const conn = this.connections.get(daemonId);
        return conn?.metadata?.hardware || null;
    }

    /**
     * Prüfen ob Daemon online ist
     * @param {string} daemonId - Daemon ID
     * @returns {boolean}
     */
    isDaemonOnline(daemonId) {
        return this.connections.has(daemonId);
    }

    /**
     * Broadcast an alle Daemons einer Guild
     * @param {string} guildId - Guild ID
     * @param {string} event - Event-Name
     * @param {object} data - Event-Daten
     */
    broadcastToGuild(guildId, event, data) {
        let sent = 0;
        
        for (const [daemonId, conn] of this.connections.entries()) {
            if (conn.metadata.guild_id === guildId) {
                conn.ws.send(JSON.stringify({
                    type: 'broadcast',
                    event,
                    data
                }));
                sent++;
            }
        }

        this.Logger.debug(`[IPMServer] Broadcast to Guild ${guildId}: ${event} (${sent} daemons)`);
        return sent;
    }

    /**
     * Re-trigger Gameserver-Installationen die auf 'installing' hängen
     * Wird bei Daemon-Reconnect aufgerufen
     * 
     * @param {string} daemonId - Daemon ID
     * @private
     */
    async _retriggerPendingInstallations(daemonId) {
        try {
            this.Logger.info(`[IPMServer] Prüfe hängende Installationen für Daemon ${daemonId}...`);

            // ⚠️ TODO: Gameserver-Plugin-Kompatibilität!
            // Wenn gameservers-Tabelle existiert, Installationen re-triggern
            const hasGameserversTable = await this.dbService.tableExists('gameservers');
            
            if (!hasGameserversTable) {
                this.Logger.debug(`[IPMServer] gameservers-Tabelle existiert nicht (Gameserver-Plugin nicht installiert)`);
                return;
            }

            // Gameserver mit Status 'installing' für diesen RootServer (via daemon_id)
            const pendingServers = await this.dbService.query(
                `SELECT 
                    gs.id as server_id,
                    gs.rootserver_id,
                    gs.addon_marketplace_id,
                    gs.name,
                    gs.ports,
                    gs.env_variables,
                    gs.launch_params as startup_command,
                    gs.frozen_game_data,
                    am.slug as addon_slug,
                    am.name as addon_name
                 FROM gameservers gs
                 LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
                 LEFT JOIN rootserver r ON gs.rootserver_id = r.id
                 WHERE r.daemon_id = ?
                 AND gs.status = 'installing'`,
                [daemonId]
            );

            if (!pendingServers || pendingServers.length === 0) {
                this.Logger.info(`[IPMServer] Keine hängenden Installationen für Daemon ${daemonId}`);
                return;
            }

            this.Logger.success(`[IPMServer] ${pendingServers.length} hängende Installation(en) gefunden, sende erneut...`);

            // Jede Installation erneut senden
            for (const server of pendingServers) {
                try {
                    // frozen_game_data parsen
                    let gameData = {};
                    try {
                        gameData = typeof server.frozen_game_data === 'string'
                            ? JSON.parse(server.frozen_game_data)
                            : (server.frozen_game_data || {});
                    } catch (e) {
                        this.Logger.warn(`[IPMServer] frozen_game_data parse error für Server ${server.server_id}:`, e);
                        this.Logger.warn(`[IPMServer] frozen_game_data raw:`, server.frozen_game_data);
                    }

                    // Validierung: frozen_game_data muss existieren
                    if (!gameData || Object.keys(gameData).length === 0) {
                        this.Logger.error(`[IPMServer] Server ${server.server_id} hat keine frozen_game_data - überspringe Re-trigger`);
                        
                        await this.dbService.query(
                            'UPDATE gameservers SET status = ?, error_message = ? WHERE id = ?',
                            ['error', 'Keine frozen_game_data vorhanden - Installation kann nicht fortgesetzt werden', server.server_id]
                        );
                        continue;
                    }

                    // Ports parsen
                    let ports = {};
                    try {
                        ports = typeof server.ports === 'string'
                            ? JSON.parse(server.ports)
                            : server.ports;
                    } catch (e) {
                        this.Logger.warn(`[IPMServer] ports parse error für Server ${server.server_id}`);
                    }

                    // ENV Variables parsen
                    let envVariables = {};
                    try {
                        envVariables = typeof server.env_variables === 'string'
                            ? JSON.parse(server.env_variables)
                            : server.env_variables;
                    } catch (e) {
                        this.Logger.warn(`[IPMServer] env_variables parse error für Server ${server.server_id}`);
                    }

                    // Install-Command mit 60s Timeout senden
                    this.Logger.info(`[IPMServer] Re-trigger Installation: ${server.name} (ID: ${server.server_id})`);

                    const response = await this.sendCommand(daemonId, 'gameserver.install', {
                        server_id: server.server_id,
                        rootserver_id: server.rootserver_id,
                        addon_slug: server.addon_slug,
                        addon_name: server.addon_name,
                        template_name: null,
                        steam_app_id: gameData.install?.steamcmd?.app_id,
                        startup_command: server.startup_command,
                        ports,
                        env_variables: envVariables,
                        game_data: gameData,
                        platform: gameData.platform || 'linux'
                    }, 60000);

                    if (response.success) {
                        this.Logger.success(`[IPMServer] Installation erneut gestartet: ${server.name}`);
                    } else {
                        this.Logger.error(`[IPMServer] Re-trigger fehlgeschlagen für ${server.name}:`, response.error);
                        
                        // Status auf 'error' setzen
                        await this.dbService.query(
                            'UPDATE gameservers SET status = ?, error_message = ? WHERE id = ?',
                            ['error', response.error || 'Re-trigger failed', server.server_id]
                        );
                    }

                } catch (serverError) {
                    this.Logger.error(`[IPMServer] Fehler beim Re-trigger für Server ${server.server_id}:`, serverError);
                    
                    // Status auf 'error' setzen
                    await this.dbService.query(
                        'UPDATE gameservers SET status = ?, error_message = ? WHERE id = ?',
                        ['error', serverError.message || 'Re-trigger error', server.server_id]
                    );
                }
            }

        } catch (error) {
            this.Logger.error('[IPMServer] Fehler beim Re-trigger von Installationen:', error);
        }
    }
    
    /**
     * Registriert Event-Handler im IPMEventRouter
     * @private
     */
    _registerEventHandlers() {
        // ✅ Handler für gameserver.status_changed + crashed
        // → Werden im Gameserver-Plugin registriert (plugins/gameserver/dashboard/index.js)
        //   Plugin-Handler sind autoritativ: machen Status-Mapping, SSE-Broadcast + Crash-Logging.
        
        // ✅ Handler für install.status (granulare Phasen: pulling_image, installing_game, cleanup)
        eventRouter.register('install', 'status', async (payload, message, context) => {
            const { server_id, phase, message: phaseMsg } = payload;
            if (!server_id || !phase) return;

            // install_phase in DB aktualisieren
            await this.dbService.query(
                'UPDATE gameservers SET install_phase = ? WHERE id = ?',
                [phase, server_id]
            );

            // SSE-Broadcast → Browser bekommt Phasen-Info live
            const [server] = await this.dbService.query(
                'SELECT guild_id FROM gameservers WHERE id = ?',
                [server_id]
            );
            if (server) {
                const sseManager = ServiceManager.get('sseManager');
                if (sseManager) {
                    sseManager.broadcast(server.guild_id, 'install', {
                        action:    'status',
                        server_id: String(server_id),
                        phase,
                        message:   phaseMsg || phase,
                    });
                }
            }
        }, { priority: 1 });

        // ✅ Handler für install.completed
        eventRouter.register('install', 'completed', async (payload, message, context) => {
            await this._handleGameserverInstallComplete(context.daemonId, payload);

            // SSE-Broadcast an Browser-Clients
            const [server] = await this.dbService.query(
                'SELECT guild_id FROM gameservers WHERE id = ?',
                [payload.server_id]
            );
            if (server) {
                const sseManager = ServiceManager.get('sseManager');
                if (sseManager) {
                    sseManager.broadcast(server.guild_id, 'install', {
                        action: 'completed',
                        server_id: String(payload.server_id),
                    });
                }
            }
        }, { priority: 1 });

        // ✅ Handler für install.failed
        eventRouter.register('install', 'failed', async (payload, message, context) => {
            await this._handleGameserverInstallFailed(context.daemonId, payload);

            const [server] = await this.dbService.query(
                'SELECT guild_id FROM gameservers WHERE id = ?',
                [payload.server_id]
            );
            if (server) {
                const sseManager = ServiceManager.get('sseManager');
                if (sseManager) {
                    sseManager.broadcast(server.guild_id, 'install', {
                        action: 'failed',
                        server_id: String(payload.server_id),
                        error: payload.error || 'Installation fehlgeschlagen',
                    });
                }
            }
        }, { priority: 1 });

        // ✅ Handler für install.output (Console-Lines während Installation)
        eventRouter.register('install', 'output', async (payload, message, context) => {
            const [server] = await this.dbService.query(
                'SELECT guild_id FROM gameservers WHERE id = ?',
                [payload.server_id]
            );
            if (server) {
                const sseManager = ServiceManager.get('sseManager');
                if (sseManager) {
                    sseManager.broadcast(server.guild_id, 'install', {
                        action: 'output',
                        server_id: String(payload.server_id),
                        line: payload.line,
                    });
                }
            }
        }, { priority: 1 });

        this.Logger.info('[IPMServer] Event-Handler registriert (gameserver.*, install.*)');

        // console.output → wird von ConsoleManager verarbeitet (nicht hier duplizieren)

        this.Logger.info('[IPMServer] Event-Handler registriert (gameserver.*, install.*)');
    }
}

module.exports = IPMServer;
