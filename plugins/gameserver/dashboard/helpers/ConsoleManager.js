/**
 * ConsoleManager - Backend Service für Live-Console-Management
 * 
 * Funktionalität:
 * - attach() - Subscribe zu Console-Output von Gameserver
 * - sendCommand() - RCON-Commands an Gameserver senden
 * - detach() - Unsubscribe von Console-Output
 * - SSE-Broadcasting für Live-Updates
 * 
 * Integration:
 * - Kommuniziert mit Daemon via IPMServer (IPM WebSocket)
 * - Broadcasting via SSEManager an Browser-Clients
 * - MySQL für Gameserver-Daten und Permissions
 * 
 * @author FireBot Team
 */

const {ServiceManager} = require('dunebot-core');
const { NS_CONSOLE, CONSOLE_ATTACH, CONSOLE_DETACH, CONSOLE_INPUT } = require('dunebot-sdk/lib/ipm/MessageTypes');

class ConsoleManager {
    constructor() {
        this.Logger = ServiceManager.get('Logger');
        this.dbService = ServiceManager.get('dbService');
        this.ipmServer = ServiceManager.get('ipmServer');
        this.sseManager = ServiceManager.get('sseManager');
        this.eventRouter = ServiceManager.get('eventRouter');
        
        // Client-Tracking: serverId → Set<clientId>
        this.activeClients = new Map();
        
        // WebSocket-Clients: serverId → Set<WebSocket>
        this.wsClients = new Map();

        // Console-History Buffer: serverId → Array<{line, timestamp}>
        this.consoleHistory = new Map();
        this.maxHistoryLines = 100; // Letzte 100 Zeilen buffern
        
        this.Logger.info('[ConsoleManager] Service initialisiert');
        
        // Event-Handler für Console-Output vom Daemon registrieren
        this._registerEventHandlers();
    }
    
    /**
     * Registriere Event-Handler für Daemon-Events
     * @private
     */
    _registerEventHandlers() {
        // Console-Output Events vom Daemon abonnieren
        this.eventRouter.register(NS_CONSOLE, 'output', this._handleConsoleOutput.bind(this), {
            priority: 1
        });
        
        this.Logger.info('[ConsoleManager] Event-Handler registriert');
    }

    /**
     * WS-Client registrieren (bekommt Live-Output als JSON)
     * @param {string} serverId
     * @param {WebSocket} ws
     */
    addWSClient(serverId, ws) {
        if (!this.wsClients.has(serverId)) {
            this.wsClients.set(serverId, new Set());
        }
        this.wsClients.get(serverId).add(ws);

        // Beim Close entfernen
        ws.on('close', () => {
            try {
                const set = this.wsClients.get(serverId);
                if (set) {
                    set.delete(ws);
                    if (set.size === 0) this.wsClients.delete(serverId);
                }
            } catch (_) {}
        });
    }
    
    /**
     * Öffentliche API: Console-Output-Event verarbeiten
     * Wird vom Gameserver-Plugin-Event-Handler aufgerufen
     *
     * @param {object} payload
     * @param {object} message
     * @param {object} context
     */
    async handleOutputEvent(payload, message, context) {
        return this._handleConsoleOutput(payload, message, context);
    }

    /**
     * Subscribe zu Console-Output eines Gameservers
     * 
     * @param {string} guildId - Guild ID
     * @param {string} serverId - Server ID
     * @param {string} clientId - Eindeutige Client-ID
     * @param {string} userId - User ID (für Permissions)
     * @returns {Promise<Array>} History der letzten Console-Zeilen
     * @throws {Error} Bei Fehlern
     */
    async attach(guildId, serverId, clientId, userId) {
        try {
            this.Logger.info(`[ConsoleManager] Attach: Server ${serverId}, Client ${clientId}, User ${userId}`);
            
            // 1. Server-Daten aus MySQL abrufen
            const server = await this._getServerData(guildId, serverId);
            if (!server) {
                throw new Error(`Server ${serverId} nicht gefunden`);
            }
            
            // 2. Permissions prüfen (bereits durch Middleware, aber double-check)
            // TODO: Zusätzliche Permission-Prüfung hier wenn nötig
            
            // 3. Client zu aktiven Clients hinzufügen
            if (!this.activeClients.has(serverId)) {
                this.activeClients.set(serverId, new Set());
            }
            this.activeClients.get(serverId).add(clientId);
            
            // 4. Daemon-Attach senden (wenn erster Client) UND History holen
            const clientCount = this.activeClients.get(serverId).size;
            let attachResponse = null;
            
            // IMMER Daemon-Attach senden wenn erster Client
            if (clientCount === 1) {
                try {
                    attachResponse = await this._sendDaemonCommand(server.daemon_id, CONSOLE_ATTACH, {
                        server_id: serverId,
                        client_id: clientId,
                        attach: true
                    });
                    this.Logger.info(`[ConsoleManager] Daemon attach gesendet: Server ${serverId}`);
                } catch (daemonErr) {
                    // Nicht fatal: Server läuft möglicherweise noch nicht / kein PTY aktiv.
                    // Console-View trotzdem laden, History bleibt leer.
                    this.Logger.warn(`[ConsoleManager] Daemon attach nicht verfügbar (Server ${serverId}): ${daemonErr?.message || daemonErr}`);
                }
            }
            // ODER History vom Daemon holen wenn lokaler Buffer leer ist
            else if (!this.consoleHistory.has(serverId) || this.consoleHistory.get(serverId).length === 0) {
                this.Logger.info(`[ConsoleManager] Lokaler Buffer leer - hole History vom Daemon`);
                try {
                    attachResponse = await this._sendDaemonCommand(server.daemon_id, CONSOLE_ATTACH, {
                        server_id: serverId,
                        client_id: clientId,
                        attach: true,
                        history_only: true // Flag für Daemon: Nur History zurückgeben, nicht neu subscriben
                    });
                } catch (daemonErr) {
                    this.Logger.warn(`[ConsoleManager] Daemon history nicht verfügbar (Server ${serverId}): ${daemonErr?.message || daemonErr}`);
                }
            }
            
            // 5. History aus Daemon-Response (falls vorhanden) in lokalen Buffer übernehmen
            try {
                const daemonHistory = attachResponse?.data?.history
                    || attachResponse?.history
                    || attachResponse?.data?.lines
                    || attachResponse?.lines
                    || [];

                if (Array.isArray(daemonHistory) && daemonHistory.length > 0) {
                    daemonHistory.forEach((line) => {
                        const text = typeof line === 'string' ? line : (line?.line || '');
                        const ts = typeof line === 'object' && line?.timestamp ? line.timestamp : Date.now();
                        if (text) this._addToHistory(serverId, text, ts, 'output');
                    });
                }
            } catch (mergeErr) {
                this.Logger.warn('[ConsoleManager] Konnte Daemon-History nicht zusammenführen:', mergeErr?.message || mergeErr);
            }

            // 6. History zurückgeben (lokaler Buffer)
            const history = this.consoleHistory.get(serverId) || [];
            
            this.Logger.success(`[ConsoleManager] Attach erfolgreich: Server ${serverId}, Clients: ${clientCount}`);
            
            return history.map(entry => ({
                line: entry.line,
                timestamp: entry.timestamp
            }));
            
        } catch (error) {
            this.Logger.error(`[ConsoleManager] Attach fehlgeschlagen:`, error);
            throw error;
        }
    }
    
    /**
     * Command an Gameserver senden (RCON)
     * 
     * @param {string} guildId - Guild ID
     * @param {string} serverId - Server ID
     * @param {string} command - Command-String
     * @param {string} userId - User ID (für Permissions und Logging)
     * @returns {Promise<boolean>} Erfolg
     * @throws {Error} Bei Fehlern
     */
    async sendCommand(guildId, serverId, command, userId) {
        try {
            this.Logger.info(`[ConsoleManager] SendCommand: Server ${serverId}, User ${userId}, Command: "${command}"`);
            
            // 1. Server-Daten abrufen
            const server = await this._getServerData(guildId, serverId);
            if (!server) {
                throw new Error(`Server ${serverId} nicht gefunden`);
            }
            
            // 2. Server-Status prüfen
            if (server.status !== 'online') {
                throw new Error(`Server ist nicht online (Status: ${server.status})`);
            }
            
            // 3. Command-Validation (Security)
            if (!command || typeof command !== 'string' || command.trim().length === 0) {
                throw new Error('Ungültiger Command');
            }
            
            // TODO: Blacklist für gefährliche Commands (shutdown, rm, etc.)
            
            // 4. IPM-Command an Daemon senden
            const response = await this._sendDaemonCommand(server.daemon_id, CONSOLE_INPUT, {
                server_id: serverId,
                command: command.trim()
            });
            
            // 5. Command zu History hinzufügen (für eigene Nachverfolgung)
            this._addToHistory(serverId, `> ${command}`, Date.now(), 'command');
            
            this.Logger.success(`[ConsoleManager] Command gesendet: Server ${serverId}, Command: "${command}"`);
            
            return true;
            
        } catch (error) {
            this.Logger.error(`[ConsoleManager] SendCommand fehlgeschlagen:`, error);
            throw error;
        }
    }
    
    /**
     * Unsubscribe von Console-Output
     * 
     * @param {string} guildId - Guild ID
     * @param {string} serverId - Server ID
     * @param {string} clientId - Client-ID
     * @returns {Promise<boolean>} Erfolg
     */
    async detach(guildId, serverId, clientId) {
        try {
            this.Logger.info(`[ConsoleManager] Detach: Server ${serverId}, Client ${clientId}`);
            
            // 1. Client aus aktiven Clients entfernen
            if (this.activeClients.has(serverId)) {
                this.activeClients.get(serverId).delete(clientId);
                
                // 2. Wenn keine Clients mehr: IPM-Detach an Daemon
                const clientCount = this.activeClients.get(serverId).size;
                if (clientCount === 0) {
                    // Server-Daten für daemon_id abrufen
                    const server = await this._getServerData(guildId, serverId);
                    if (server) {
                        await this._sendDaemonCommand(server.daemon_id, CONSOLE_DETACH, {
                            server_id: serverId,
                            client_id: clientId,
                            detach: true
                        });
                        
                        this.Logger.info(`[ConsoleManager] Daemon detach gesendet: Server ${serverId}`);
                    }
                    
                    // Map-Entry entfernen wenn leer
                    this.activeClients.delete(serverId);
                }
                
                this.Logger.success(`[ConsoleManager] Detach erfolgreich: Server ${serverId}, verbleibende Clients: ${clientCount}`);
            }
            
            return true;
            
        } catch (error) {
            this.Logger.error(`[ConsoleManager] Detach fehlgeschlagen:`, error);
            return false;
        }
    }
    
    /**
     * Event-Handler für Console-Output vom Daemon
     * 
     * @param {object} payload - { server_id, line, timestamp }
     * @param {object} message - Vollständige IPM-Message
     * @param {object} context - { daemonId }
     * @private
     */
    async _handleConsoleOutput(payload, message, context) {
        const { server_id, line, timestamp } = payload;
        
        try {
            this.Logger.debug(`[ConsoleManager] Console Output: Server ${server_id}, Line: "${line}"`);
            
            // 1. Zu History hinzufügen
            this._addToHistory(server_id, line, timestamp || Date.now(), 'output');
            
            // 2. Guild-ID für SSE-Broadcasting ermitteln
            const guildId = await this._getGuildIdForServer(server_id);
            if (!guildId) {
                this.Logger.warn(`[ConsoleManager] Guild-ID für Server ${server_id} nicht gefunden`);
                return;
            }
            
            // 3. SSE-Broadcast an alle Browser-Clients (nur wenn KEIN WS-Client verbunden ist)
            // Dadurch vermeiden wir doppelte Zeilen (WS + SSE).
            const wsSetForServer = this.wsClients.get(String(server_id));
            const hasWSClients = !!wsSetForServer && wsSetForServer.size > 0;
            if (!hasWSClients) {
                this.sseManager.broadcast(guildId, 'console', {  // ← FIX: Event-Name muss 'console' sein!
                    action: 'console',
                    server_id,
                    line,
                    timestamp: timestamp || Date.now()
                });
            }
            
            // 4. WebSocket-Broadcast an verbundene WS-Clients (direktes Streaming)
            const wsSet = wsSetForServer;
            if (wsSet && wsSet.size > 0) {
                const msg = JSON.stringify({ type: 'output', server_id, line, timestamp: timestamp || Date.now() });
                for (const ws of wsSet) {
                    try { ws.send(msg); } catch (_) {}
                }
            }

            this.Logger.debug(`[ConsoleManager] Console Output broadcasted: Server ${server_id}`);
            
        } catch (error) {
            this.Logger.error(`[ConsoleManager] Console Output Handler fehlgeschlagen:`, error);
        }
    }
    
    /**
     * Server-Daten aus MySQL abrufen
     * 
     * @param {string} guildId - Guild ID
     * @param {string} serverId - Server ID
     * @returns {Promise<object|null>} Server-Daten oder null
     * @private
     */
    async _getServerData(guildId, serverId) {
        try {
            // Step 1: Read core gameserver fields (avoid selecting daemon_id directly to be compatible
            // with different schema versions)
            const gsRows = await this.dbService.query(`
                SELECT id, name, status, guild_id, rootserver_id
                FROM gameservers
                WHERE id = ? AND guild_id = ?
            `, [serverId, guildId]);

            if (!Array.isArray(gsRows) || !gsRows[0]) return null;

            const server = Object.assign({}, gsRows[0]);

            // Step 2: If we have a rootserver_id, try to fetch daemon_id from rootserver table.
            if (server.rootserver_id) {
                try {
                    const rRows = await this.dbService.query(`
                        SELECT id, daemon_id
                        FROM rootserver
                        WHERE id = ?
                    `, [server.rootserver_id]);

                    if (Array.isArray(rRows) && rRows[0]) {
                        server.daemon_id = rRows[0].daemon_id;
                    }
                } catch (innerErr) {
                    // Non-fatal: log and continue without daemon_id
                    this.Logger.warn('[ConsoleManager] Konnte daemon_id aus rootserver nicht lesen:', innerErr?.message || innerErr);
                }
            }

            return server;
            
        } catch (error) {
            this.Logger.error(`[ConsoleManager] _getServerData fehlgeschlagen:`, error);
            return null;
        }
    }
    
    /**
     * Guild-ID für Server-ID ermitteln (für SSE-Broadcasting)
     * 
     * @param {string} serverId - Server ID
     * @returns {Promise<string|null>} Guild-ID oder null
     * @private
     */
    async _getGuildIdForServer(serverId) {
        try {
            const rows = await this.dbService.query(`
                SELECT guild_id 
                FROM gameservers 
                WHERE id = ?
            `, [serverId]);
            
            return Array.isArray(rows) && rows[0] ? rows[0].guild_id : null;
            
        } catch (error) {
            this.Logger.error(`[ConsoleManager] _getGuildIdForServer fehlgeschlagen:`, error);
            return null;
        }
    }
    
    /**
     * IPM-Command an Daemon senden
     * 
     * @param {string} daemonId - Daemon ID
     * @param {string} action - Console Action (attach/detach/input)
     * @param {object} payload - Command-Payload
     * @returns {Promise<object>} Response vom Daemon
     * @private
     */
    async _sendDaemonCommand(daemonId, action, payload) {
        try {
            // IPMServer erwartet einen Command-String wie 'console:attach' | 'console:detach' | 'console:send'
            // Die MessageTypes liefern nur die Action ('attach' | 'detach' | 'input'), daher hier mappen.
            let command = null;
            switch (action) {
                case CONSOLE_ATTACH:
                    command = 'console:attach';
                    break;
                case CONSOLE_DETACH:
                    command = 'console:detach';
                    break;
                case CONSOLE_INPUT:
                    command = 'console:send';
                    break;
                default:
                    // Falls bereits vollständiger Command übergeben wurde
                    command = action && action.startsWith('console:') ? action : `console:${action}`;
                    break;
            }

            const response = await this.ipmServer.sendCommand(daemonId, command, payload);

            if (!response || !response.success) {
                throw new Error(response?.error || response?.message || 'Daemon-Command fehlgeschlagen');
            }

            return response;

        } catch (error) {
            this.Logger.error(`[ConsoleManager] _sendDaemonCommand fehlgeschlagen:`, error);
            throw error;
        }
    }
    
    /**
     * Zeile zu Console-History hinzufügen
     * 
     * @param {string} serverId - Server ID
     * @param {string} line - Console-Zeile
     * @param {number} timestamp - Timestamp (ms)
     * @param {string} type - 'output' oder 'command'
     * @private
     */
    _addToHistory(serverId, line, timestamp, type = 'output') {
        if (!this.consoleHistory.has(serverId)) {
            this.consoleHistory.set(serverId, []);
        }
        
        const history = this.consoleHistory.get(serverId);
        
        // Neue Zeile hinzufügen
        history.push({
            line,
            timestamp,
            type
        });
        
        // Buffer-Limit einhalten (FIFO)
        while (history.length > this.maxHistoryLines) {
            history.shift();
        }
    }
    
    /**
     * Aktive Clients für einen Server abrufen
     * 
     * @param {string} serverId - Server ID
     * @returns {number} Anzahl aktiver Clients
     */
    getActiveClientCount(serverId) {
        return this.activeClients.get(serverId)?.size || 0;
    }
    
    /**
     * Alle aktiven Console-Sessions abrufen (für Debugging)
     * 
     * @returns {object} { serverId: clientCount }
     */
    getActiveSessions() {
        const sessions = {};
        
        this.activeClients.forEach((clients, serverId) => {
            sessions[serverId] = clients.size;
        });
        
        return sessions;
    }
    
    /**
     * Cleanup bei Shutdown
     */
    async shutdown() {
        this.Logger.info('[ConsoleManager] Shutdown initiated...');
        
        // Alle aktiven Sessions detachen
        for (const [serverId, clients] of this.activeClients.entries()) {
            this.Logger.info(`[ConsoleManager] Cleanup: Server ${serverId}, ${clients.size} clients`);
            
            try {
                // TODO: Guild-ID ermitteln und Daemon-Detach senden
                // Hier würde normalerweise ein detach an alle Daemons gesendet
            } catch (error) {
                this.Logger.error(`[ConsoleManager] Cleanup-Fehler für Server ${serverId}:`, error);
            }
        }
        
        // Maps leeren
        this.activeClients.clear();
        this.consoleHistory.clear();
        
        this.Logger.success('[ConsoleManager] Shutdown completed');
    }
}

module.exports = ConsoleManager;