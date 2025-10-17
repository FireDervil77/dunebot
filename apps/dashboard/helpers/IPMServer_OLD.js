/**
 * Registry Service - WebSocket Server für Daemon-Kommunikation
 * 
 * Verwaltet Verbindungen zu User-seitigen Daemons (Go-basiert)
 * - WebSocket-Server für bidirektionale Kommunikation
 * - Token-basierte Authentifizierung
 * - Heartbeat-Monitoring
 * - Command-Routing (Dashboard/Bot → Daemon)
 * - Event-Broadcasting (Daemon → Dashboard/Bot)
 * 
 * @module RegistryService
 * @author FireBot Team
 */

const WebSocket = require('ws');
const crypto = require('crypto');
const { ServiceManager } = require('dunebot-core');

class RegistryService {
    constructor(options = {}) {
        this.port = options.port || process.env.REGISTRY_PORT || 9340;
        this.host = options.host || '0.0.0.0';
        
        // WebSocket-Server Instanz
        this.wss = null;
        
        // Connection-Pool: Map<daemon_id, WebSocket>
        this.connections = new Map();
        
        // Heartbeat-Monitoring
        this.heartbeatInterval = null;
        this.heartbeatTimeout = 90000; // 90s (3x Heartbeat)
        
        // Event-Handler Callbacks
        this.eventHandlers = new Map();
    }

    /**
     * Startet den WebSocket-Server
     */
    async start() {
        const Logger = ServiceManager.get('Logger');
        
        return new Promise((resolve, reject) => {
            try {
                // WebSocket-Server initialisieren
                this.wss = new WebSocket.Server({
                    host: this.host,
                    port: this.port,
                    clientTracking: true,
                    perMessageDeflate: {
                        zlibDeflateOptions: {
                            chunkSize: 1024,
                            memLevel: 7,
                            level: 3
                        },
                        zlibInflateOptions: {
                            chunkSize: 10 * 1024
                        },
                        clientNoContextTakeover: true,
                        serverNoContextTakeover: true,
                        serverMaxWindowBits: 10,
                        concurrencyLimit: 10,
                        threshold: 1024
                    }
                });

                // Connection-Handler
                this.wss.on('connection', (ws, req) => {
                    this._handleConnection(ws, req);
                });

                // Server-Events
                this.wss.on('listening', () => {
                    Logger.info(`[RegistryService] WebSocket-Server läuft auf ${this.host}:${this.port}`);
                    resolve();
                });

                this.wss.on('error', (error) => {
                    Logger.error('[RegistryService] WebSocket-Server Fehler:', error);
                    reject(error);
                });

                // Heartbeat-Monitor starten
                this._startHeartbeatMonitor();

            } catch (error) {
                Logger.error('[RegistryService] Start fehlgeschlagen:', error);
                reject(error);
            }
        });
    }

    /**
     * Stoppt den WebSocket-Server
     */
    async stop() {
        const Logger = ServiceManager.get('Logger');
        
        return new Promise((resolve) => {
            // Heartbeat-Monitor stoppen
            if (this.heartbeatInterval) {
                clearInterval(this.heartbeatInterval);
                this.heartbeatInterval = null;
            }

            // Alle Verbindungen schließen
            for (const [daemonId, ws] of this.connections.entries()) {
                ws.close(1000, 'Server shutting down');
                Logger.debug(`[RegistryService] Verbindung zu Daemon ${daemonId} geschlossen`);
            }
            this.connections.clear();

            // WebSocket-Server schließen
            if (this.wss) {
                this.wss.close(() => {
                    Logger.info('[RegistryService] WebSocket-Server gestoppt');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    /**
     * Behandelt neue WebSocket-Verbindungen
     * @private
     */
    async _handleConnection(ws, req) {
        const Logger = ServiceManager.get('Logger');
        const clientIp = req.socket.remoteAddress;
        
        Logger.debug(`[RegistryService] Neue Verbindung von ${clientIp}`);

        // Temporärer State (bis Authentifizierung erfolgt)
        ws.isAuthenticated = false;
        ws.daemonId = null;
        ws.guildId = null;
        ws.isAlive = true;

        // Ping-Pong für Heartbeat
        ws.on('pong', () => {
            ws.isAlive = true;
        });

        // Message-Handler
        ws.on('message', async (data) => {
            try {
                const message = JSON.parse(data.toString());
                await this._handleMessage(ws, message);
            } catch (error) {
                Logger.error('[RegistryService] Message-Parsing Fehler:', error);
                this._sendError(ws, 'INVALID_MESSAGE', 'Nachricht konnte nicht geparst werden');
            }
        });

        // Close-Handler
        ws.on('close', (code, reason) => {
            this._handleDisconnect(ws, code, reason);
        });

        // Error-Handler
        ws.on('error', (error) => {
            Logger.error(`[RegistryService] WebSocket Fehler (${ws.daemonId}):`, error);
        });
    }

    /**
     * Behandelt eingehende Messages
     * @private
     */
    async _handleMessage(ws, message) {
        const Logger = ServiceManager.get('Logger');
        const { type, payload } = message;

        // Nicht-authentifizierte Verbindung → nur 'register' erlaubt
        if (!ws.isAuthenticated && type !== 'register') {
            return this._sendError(ws, 'UNAUTHORIZED', 'Authentifizierung erforderlich');
        }

        switch (type) {
            case 'register':
                await this._handleRegister(ws, payload);
                break;

            case 'heartbeat':
                await this._handleHeartbeat(ws, payload);
                break;

            case 'status_update':
                await this._handleStatusUpdate(ws, payload);
                break;

            case 'command_response':
                await this._handleCommandResponse(ws, payload);
                break;

            case 'log':
                await this._handleLog(ws, payload);
                break;

            default:
                Logger.warn(`[RegistryService] Unbekannter Message-Typ: ${type}`);
                this._sendError(ws, 'UNKNOWN_TYPE', `Unbekannter Message-Typ: ${type}`);
        }
    }

    /**
     * Behandelt Daemon-Registrierung
     * @private
     */
    async _handleRegister(ws, payload) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        const bcrypt = require('bcrypt');

        try {
            const { token, daemon_id, version, os_info } = payload;

            if (!token || !daemon_id || !version) {
                return this._sendError(ws, 'INVALID_PAYLOAD', 'Token, daemon_id und version erforderlich');
            }

            // Token in DB suchen
            const tokens = await dbService.query(
                'SELECT * FROM daemon_tokens WHERE used = 0 AND expires_at > NOW()',
                []
            );

            let validToken = null;
            for (const t of tokens) {
                if (await bcrypt.compare(token, t.token_hash)) {
                    validToken = t;
                    break;
                }
            }

            if (!validToken) {
                Logger.warn(`[RegistryService] Ungültiger Token von ${daemon_id}`);
                return this._sendError(ws, 'INVALID_TOKEN', 'Token ungültig oder abgelaufen');
            }

            // Prüfen ob Daemon bereits registriert
            const existing = await dbService.query(
                'SELECT * FROM daemon_instances WHERE daemon_id = ?',
                [daemon_id]
            );

            if (existing.length > 0) {
                // Bereits registriert → Session-Token erneuern
                const sessionToken = crypto.randomBytes(32).toString('hex');
                const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // +24h

                await dbService.query(
                    `UPDATE daemon_instances 
                     SET session_token = ?, session_token_expires_at = ?, 
                         status = 'online', version = ?, os_info = ?,
                         host_ip = ?, last_heartbeat = NOW(), updated_at = NOW()
                     WHERE daemon_id = ?`,
                    [sessionToken, expiresAt, version, os_info, ws._socket.remoteAddress, daemon_id]
                );

                ws.daemonId = daemon_id;
                ws.guildId = existing[0].guild_id;
                ws.isAuthenticated = true;
                this.connections.set(daemon_id, ws);

                this._sendSuccess(ws, 'REGISTERED', {
                    session_token: sessionToken,
                    guild_id: existing[0].guild_id,
                    message: 'Erfolgreich wiederverbunden'
                });

                Logger.info(`[RegistryService] Daemon ${daemon_id} wiederverbunden (Guild: ${existing[0].guild_id})`);

            } else {
                // Neue Registrierung
                const sessionToken = crypto.randomBytes(32).toString('hex');
                const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

                await dbService.query(
                    `INSERT INTO daemon_instances (
                        daemon_id, guild_id, session_token, session_token_expires_at,
                        status, version, os_info, host_ip, last_heartbeat
                    ) VALUES (?, ?, ?, ?, 'online', ?, ?, ?, NOW())`,
                    [daemon_id, validToken.guild_id, sessionToken, expiresAt, version, os_info, ws._socket.remoteAddress]
                );

                // Token als verwendet markieren
                await dbService.query(
                    'UPDATE daemon_tokens SET used = 1, used_at = NOW(), used_by_daemon_id = ? WHERE id = ?',
                    [daemon_id, validToken.id]
                );

                ws.daemonId = daemon_id;
                ws.guildId = validToken.guild_id;
                ws.isAuthenticated = true;
                this.connections.set(daemon_id, ws);

                this._sendSuccess(ws, 'REGISTERED', {
                    session_token: sessionToken,
                    guild_id: validToken.guild_id,
                    message: 'Erfolgreich registriert'
                });

                // Audit-Log
                await this._logEvent(validToken.guild_id, daemon_id, null, 'register', 'Daemon erfolgreich registriert', {
                    version,
                    os_info,
                    token_id: validToken.id
                });

                Logger.success(`[RegistryService] Daemon ${daemon_id} registriert (Guild: ${validToken.guild_id})`);
            }

        } catch (error) {
            Logger.error('[RegistryService] Registrierung fehlgeschlagen:', error);
            this._sendError(ws, 'REGISTRATION_FAILED', error.message);
        }
    }

    /**
     * Behandelt Heartbeat-Messages
     * @private
     */
    async _handleHeartbeat(ws, payload) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        try {
            const { latency } = payload;

            await dbService.query(
                `UPDATE daemon_instances 
                 SET last_heartbeat = NOW(), last_ping_latency = ?, missed_heartbeats = 0
                 WHERE daemon_id = ?`,
                [latency || null, ws.daemonId]
            );

            ws.isAlive = true;

            this._sendSuccess(ws, 'HEARTBEAT_ACK', {
                server_time: Date.now()
            });

            Logger.debug(`[RegistryService] Heartbeat von ${ws.daemonId} (Latenz: ${latency}ms)`);

        } catch (error) {
            Logger.error('[RegistryService] Heartbeat-Verarbeitung fehlgeschlagen:', error);
        }
    }

    /**
     * Behandelt Status-Updates
     * @private
     */
    async _handleStatusUpdate(ws, payload) {
        const Logger = ServiceManager.get('Logger');
        
        // TODO: Status-Update an Dashboard weiterleiten (via IPC an Dashboard)
        Logger.debug(`[RegistryService] Status-Update von ${ws.daemonId}:`, payload);

        await this._logEvent(ws.guildId, ws.daemonId, payload.server_id, 'status_change', 
            `Status geändert: ${payload.status}`, payload);
    }

    /**
     * Behandelt Command-Responses
     * @private
     */
    async _handleCommandResponse(ws, payload) {
        const Logger = ServiceManager.get('Logger');
        
        // TODO: Response an Dashboard/Bot weiterleiten
        Logger.debug(`[RegistryService] Command-Response von ${ws.daemonId}:`, payload);
    }

    /**
     * Behandelt Log-Messages
     * @private
     */
    async _handleLog(ws, payload) {
        const Logger = ServiceManager.get('Logger');
        
        await this._logEvent(ws.guildId, ws.daemonId, payload.server_id, 'command', 
            payload.message, payload.metadata);
    }

    /**
     * Behandelt Disconnect
     * @private
     */
    async _handleDisconnect(ws, code, reason) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        if (ws.daemonId) {
            this.connections.delete(ws.daemonId);

            await dbService.query(
                `UPDATE daemon_instances 
                 SET status = 'offline', last_disconnect = NOW()
                 WHERE daemon_id = ?`,
                [ws.daemonId]
            );

            await this._logEvent(ws.guildId, ws.daemonId, null, 'disconnect', 
                `Verbindung getrennt (Code: ${code})`, { reason: reason?.toString() });

            Logger.info(`[RegistryService] Daemon ${ws.daemonId} getrennt (Code: ${code})`);
        }
    }

    /**
     * Heartbeat-Monitor (prüft alle 30s auf tote Verbindungen)
     * @private
     */
    _startHeartbeatMonitor() {
        const Logger = ServiceManager.get('Logger');
        
        this.heartbeatInterval = setInterval(() => {
            this.wss.clients.forEach((ws) => {
                if (ws.isAlive === false) {
                    Logger.warn(`[RegistryService] Daemon ${ws.daemonId} antwortet nicht → Verbindung trennen`);
                    return ws.terminate();
                }

                ws.isAlive = false;
                ws.ping();
            });
        }, 30000); // Alle 30s
    }

    /**
     * Schreibt Event in Audit-Log
     * @private
     */
    async _logEvent(guildId, daemonId, serverId, eventType, message, metadata = null) {
        const dbService = ServiceManager.get('dbService');
        
        try {
            await dbService.query(
                `INSERT INTO daemon_logs (guild_id, daemon_id, server_id, event_type, message, metadata)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [guildId, daemonId, serverId, eventType, message, JSON.stringify(metadata)]
            );
        } catch (error) {
            // Silent fail (Logs sind nicht kritisch)
        }
    }

    /**
     * Sendet Success-Response an Client
     * @private
     */
    _sendSuccess(ws, type, data = {}) {
        ws.send(JSON.stringify({
            success: true,
            type,
            data
        }));
    }

    /**
     * Sendet Error-Response an Client
     * @private
     */
    _sendError(ws, code, message) {
        ws.send(JSON.stringify({
            success: false,
            error: {
                code,
                message
            }
        }));
    }

    /**
     * Sendet Command an spezifischen Daemon
     * @public
     */
    async sendCommand(daemonId, command, payload = {}) {
        const Logger = ServiceManager.get('Logger');
        const ws = this.connections.get(daemonId);

        if (!ws) {
            throw new Error(`Daemon ${daemonId} ist nicht verbunden`);
        }

        return new Promise((resolve, reject) => {
            const messageId = crypto.randomUUID();
            const timeout = setTimeout(() => {
                reject(new Error('Command-Timeout'));
            }, 30000); // 30s Timeout

            // Response-Handler (einmalig)
            const responseHandler = (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    if (message.type === 'command_response' && message.data.message_id === messageId) {
                        clearTimeout(timeout);
                        ws.removeListener('message', responseHandler);
                        resolve(message.data);
                    }
                } catch (error) {
                    // Ignore parsing errors
                }
            };

            ws.on('message', responseHandler);

            // Command senden
            ws.send(JSON.stringify({
                type: 'command',
                data: {
                    message_id: messageId,
                    command,
                    payload
                }
            }));

            Logger.debug(`[RegistryService] Command '${command}' an Daemon ${daemonId} gesendet`);
        });
    }

    /**
     * Gibt Status aller Verbindungen zurück
     * @public
     */
    getConnectionStatus() {
        const status = [];
        
        for (const [daemonId, ws] of this.connections.entries()) {
            status.push({
                daemon_id: daemonId,
                guild_id: ws.guildId,
                is_alive: ws.isAlive,
                is_authenticated: ws.isAuthenticated
            });
        }

        return status;
    }
}

module.exports = RegistryService;
