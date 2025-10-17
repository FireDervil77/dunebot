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
     * Daemon-Registrierung (Token-Validierung)
     * @private
     */
    async _handleRegister(ws, payload) {
        const { token, daemon_id, version } = payload;

        if (!token || !daemon_id) {
            return { success: false, error: 'Missing token or daemon_id' };
        }

        try {
            // Token aus DB laden
            const [tokenData] = await this.dbService.query(
                `SELECT dt.*, di.guild_id, di.display_name, di.config
                 FROM daemon_tokens dt
                 JOIN daemon_instances di ON dt.daemon_id = di.daemon_id
                 WHERE dt.daemon_id = ? AND dt.expires_at > NOW()
                 ORDER BY dt.created_at DESC
                 LIMIT 1`,
                [daemon_id]
            );

            if (!tokenData) {
                return { success: false, error: 'Invalid or expired token' };
            }

            // Token hashen und vergleichen (bcrypt/argon2)
            const bcrypt = require('bcrypt');
            const isValid = await bcrypt.compare(token, tokenData.token_hash);

            if (!isValid) {
                return { success: false, error: 'Invalid token' };
            }

            // Session-Token generieren
            const sessionId = crypto.randomBytes(32).toString('hex');

            // Daemon-Status aktualisieren
            await this.dbService.query(
                `UPDATE daemon_instances 
                 SET status = 'online', 
                     last_seen = NOW(),
                     version = ?,
                     session_token = ?
                 WHERE daemon_id = ?`,
                [version || 'unknown', sessionId, daemon_id]
            );

            // Audit-Log
            await this._logDaemonEvent(daemon_id, 'connected', { version, sessionId });

            ws.send(JSON.stringify({ 
                type: 'registered', 
                sessionId,
                config: JSON.parse(tokenData.config || '{}')
            }));

            return { 
                success: true, 
                daemonId: daemon_id, 
                sessionId,
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

        // DB-Update (last_seen)
        await this.dbService.query(
            'UPDATE daemon_instances SET last_seen = NOW() WHERE daemon_id = ?',
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

        await this.dbService.query(
            `INSERT INTO daemon_logs (daemon_id, level, message, context, created_at)
             VALUES (?, ?, ?, ?, NOW())`,
            [daemonId, level, message, JSON.stringify(context || {})]
        );
    }

    /**
     * Daemon-Event loggen
     * @private
     */
    async _logDaemonEvent(daemonId, event, data) {
        await this.dbService.query(
            `INSERT INTO daemon_logs (daemon_id, level, message, context, created_at)
             VALUES (?, 'info', ?, ?, NOW())`,
            [daemonId, `Event: ${event}`, JSON.stringify(data || {})]
        );
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
            lastHeartbeat: conn.lastHeartbeat
        }));
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
