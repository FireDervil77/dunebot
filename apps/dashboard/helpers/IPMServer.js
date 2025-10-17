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

class IPMServer {
    /**
     * @param {number} port - WebSocket Port (Standard: 9340)
     */
    constructor(port = 9340) {
        this.port = port;
        this.wss = null;
        this.connections = new Map(); // daemon_id -> {ws, lastHeartbeat, sessionId, metadata}
        this.pendingCommands = new Map(); // commandId -> {resolve, reject, timeout}
        this.Logger = null;
        this.dbService = null;
        
        // JWT Secret aus ENV (oder generieren falls nicht vorhanden)
        this.jwtSecret = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
        this.jwtExpiry = '30d'; // Session-Token gültig für 30 Tage
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
                    const result = await this._handleRegister(ws, message.payload);
                    if (result.success) {
                        daemonId = result.daemonId;
                        authenticated = true;
                        this.connections.set(daemonId, {
                            ws,
                            lastHeartbeat: Date.now(),
                            sessionId: result.sessionId,
                            metadata: result.metadata
                        });
                        this.Logger.info(`[IPMServer] Daemon ${daemonId} registriert (Guild: ${result.metadata.guild_id})`);
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
                this.Logger.info(`[IPMServer] Daemon ${daemonId} disconnected`);
            }
        });

        ws.on('error', (error) => {
            this.Logger.error(`[IPMServer] WebSocket Error (Daemon: ${daemonId}):`, error);
        });
    }

    /**
     * Daemon-Registrierung mit 2-Token-System (Setup-Token + JWT Session-Token)
     * 
     * Flow:
     * 1. Erste Registrierung: Setup-Token (bcrypt) → JWT Session-Token generieren
     * 2. Reconnect: JWT validieren → Neuen JWT generieren (Token-Rotation)
     * 
     * @private
     */
    async _handleRegister(ws, payload) {
        const { token, daemon_id, version } = payload;

        if (!token || !daemon_id) {
            return { success: false, error: 'Missing token or daemon_id' };
        }

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
                        'SELECT * FROM daemon_instances WHERE daemon_id = ?',
                        [daemon_id]
                    );
                    
                    if (!daemon) {
                        return { success: false, error: 'Daemon not found' };
                    }
                    
                    // Neuen Session-Token generieren (Token-Rotation!)
                    const newSessionToken = jwt.sign({
                        daemon_id: daemon.daemon_id,
                        guild_id: daemon.guild_id,
                        version: version || daemon.version
                    }, this.jwtSecret, { expiresIn: this.jwtExpiry });
                    
                    // Daemon-Status aktualisieren
                    await this.dbService.query(
                        `UPDATE daemon_instances 
                         SET status = 'online', 
                             last_heartbeat = NOW(),
                             version = ?,
                             session_token = ?,
                             session_token_expires_at = DATE_ADD(NOW(), INTERVAL 30 DAY)
                         WHERE daemon_id = ?`,
                        [version || daemon.version, newSessionToken, daemon_id]
                    );
                    
                    await this._logDaemonEvent(daemon_id, 'reconnected', { version });
                    
                    ws.send(JSON.stringify({ 
                        type: 'registered', 
                        sessionToken: newSessionToken
                    }));
                    
                    return { 
                        success: true, 
                        daemonId: daemon_id, 
                        sessionId: newSessionToken,
                        metadata: {
                            guild_id: daemon.guild_id,
                            display_name: daemon.display_name,
                            version: version || daemon.version
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
            // FALL 2: Setup-Token (Erste Registrierung)
            // ================================================
            
            // Setup-Token aus DB laden (Guild-basiert)
            const [tokenData] = await this.dbService.query(
                `SELECT dt.*, di.guild_id, di.display_name
                 FROM daemon_tokens dt
                 JOIN daemon_instances di ON dt.guild_id = di.guild_id
                 WHERE di.daemon_id = ? AND dt.expires_at > NOW() AND dt.used = 0
                 ORDER BY dt.created_at DESC
                 LIMIT 1`,
                [daemon_id]
            );

            if (!tokenData) {
                return { success: false, error: 'Invalid or expired token' };
            }

            // Setup-Token validieren (bcrypt)
            const bcrypt = require('bcrypt');
            const isValid = await bcrypt.compare(token, tokenData.token_hash);

            if (!isValid) {
                return { success: false, error: 'Invalid token' };
            }

            // Token als verwendet markieren
            await this.dbService.query(
                `UPDATE daemon_tokens 
                 SET used = 1, 
                     used_at = NOW(), 
                     used_by_daemon_id = ?
                 WHERE id = ?`,
                [daemon_id, tokenData.id]
            );

            // JWT Session-Token generieren
            const sessionToken = jwt.sign({
                daemon_id,
                guild_id: tokenData.guild_id,
                version: version || 'unknown'
            }, this.jwtSecret, { expiresIn: this.jwtExpiry });

            // Daemon-Status aktualisieren mit Session-Token
            await this.dbService.query(
                `UPDATE daemon_instances 
                 SET status = 'online', 
                     last_heartbeat = NOW(),
                     version = ?,
                     session_token = ?,
                     session_token_expires_at = DATE_ADD(NOW(), INTERVAL 30 DAY)
                 WHERE daemon_id = ?`,
                [version || 'unknown', sessionToken, daemon_id]
            );

            // Audit-Log
            await this._logDaemonEvent(daemon_id, 'first_registration', { version });

            ws.send(JSON.stringify({ 
                type: 'registered', 
                sessionToken
            }));

            return { 
                success: true, 
                daemonId: daemon_id, 
                sessionId: sessionToken,
                metadata: {
                    guild_id: tokenData.guild_id,
                    display_name: tokenData.display_name,
                    version
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

        switch (type) {
            case 'heartbeat':
                await this._handleHeartbeat(daemonId, payload);
                break;

            case 'response':
                // Antwort auf Command (Command-ID in payload.commandId)
                this._resolveCommand(payload.commandId, payload);
                break;

            case 'event':
                // Event vom Daemon (Server-Status, Error, etc.)
                await this._handleDaemonEvent(daemonId, payload);
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

        // Hardware-Stats in Connection-Metadata speichern
        if (payload.hardware) {
            conn.metadata.hardware = payload.hardware;
        }

        // DB-Update (last_heartbeat)
        await this.dbService.query(
            'UPDATE daemon_instances SET last_heartbeat = NOW() WHERE daemon_id = ?',
            [daemonId]
        );

        // ACK senden
        conn.ws.send(JSON.stringify({ 
            type: 'heartbeat_ack',
            timestamp: Date.now()
        }));

        // Optional: Server-Registry-Status aktualisieren
        if (payload.servers) {
            await this._updateServerRegistry(daemonId, payload.servers);
        }
    }

    /**
     * Server-Registry aktualisieren
     * @private
     */
    async _updateServerRegistry(daemonId, servers) {
        for (const server of servers) {
            await this.dbService.query(
                `UPDATE server_registry 
                 SET status = ?, 
                     current_players = ?,
                     last_heartbeat = NOW()
                 WHERE daemon_id = ? AND server_id = ?`,
                [server.status, server.players, daemonId, server.server_id]
            );
        }
    }

    /**
     * Daemon-Event verarbeiten
     * @private
     */
    async _handleDaemonEvent(daemonId, payload) {
        const { event, data } = payload;

        this.Logger.debug(`[IPMServer] Event from Daemon ${daemonId}: ${event}`, data);

        // Event an IPC-Server weiterleiten (Bot benachrichtigen)
        const ipcServer = ServiceManager.get('ipcServer');
        if (ipcServer) {
            ipcServer.broadcast('daemon:event', { daemonId, event, data });
        }

        // Event in DB loggen
        await this._logDaemonEvent(daemonId, event, data);
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
                'SELECT guild_id FROM daemon_instances WHERE daemon_id = ?',
                [daemonId]
            );
            
            if (!daemon) return;
            
            // Level zu event_type mappen (error → error, rest → status_change)
            const eventType = level === 'error' ? 'error' : 'status_change';

            await this.dbService.query(
                `INSERT INTO daemon_logs (guild_id, daemon_id, event_type, action, message, metadata, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                [daemon.guild_id, daemonId, eventType, level, message, JSON.stringify(context || {})]
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
                'SELECT guild_id FROM daemon_instances WHERE daemon_id = ?',
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
            
            await this.dbService.query(
                `INSERT INTO daemon_logs (guild_id, daemon_id, event_type, action, message, metadata, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                [
                    daemon.guild_id,
                    daemonId,
                    eventType,
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
     * @param {number} timeout - Timeout in ms (Standard: 30s)
     * @returns {Promise<object>} Command-Response
     */
    async sendCommand(daemonId, command, payload = {}, timeout = 30000) {
        const conn = this.connections.get(daemonId);
        
        if (!conn) {
            throw new Error(`Daemon ${daemonId} not connected`);
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

        if (response.success) {
            pending.resolve(response.data);
        } else {
            pending.reject(new Error(response.error || 'Command failed'));
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
                        'UPDATE daemon_instances SET status = \'offline\' WHERE daemon_id = ?',
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
}

module.exports = IPMServer;
