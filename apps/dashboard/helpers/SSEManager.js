/**
 * SSEManager - Server-Sent Events Manager für Browser-Push
 * 
 * Ermöglicht Echtzeit-Updates im Browser ohne Polling.
 * 
 * Features:
 * - Client-Management (per Guild/User)
 * - Event-Broadcasting mit Namespaces
 * - Auto-Cleanup bei Connection-Close
 * - Heartbeat für Keep-Alive
 * - Filter-Support (z.B. nur bestimmte Server)
 * 
 * @module helpers/SSEManager
 * @author FireBot Team
 */

const { ServiceManager } = require('dunebot-core');
const EventEmitter = require('events');

/**
 * SSEManager - Verwaltet SSE-Connections zu Browsern
 * @extends EventEmitter
 */
class SSEManager extends EventEmitter {
  constructor() {
    super();
    
    /**
     * Client-Connections: Map<guildId, Map<clientId, ClientConnection>>
     * @type {Map<string, Map<string, Object>>}
     */
    this.clients = new Map();
    
    /**
     * Client-Filter: Map<clientId, FilterFunction>
     * @type {Map<string, Function>}
     */
    this.filters = new Map();
    
    /**
     * Heartbeat-Intervalle: Map<clientId, IntervalId>
     * @type {Map<string, NodeJS.Timeout>}
     */
    this.heartbeats = new Map();
    
    /**
     * Statistiken
     * @type {Object}
     */
    this.stats = {
      totalConnections: 0,
      activeConnections: 0,
      messagesSent: 0,
      messagesFiltered: 0,
      connectionsClosed: 0
    };
    
    this.Logger = ServiceManager.get('Logger');
    
    // Heartbeat-Intervall (30 Sekunden)
    this.heartbeatInterval = 30000;
  }

  /**
   * Fügt einen neuen SSE-Client hinzu
   * 
   * @param {string} guildId - Discord Guild ID
   * @param {string} clientId - Eindeutige Client-ID
   * @param {Response} res - Express Response-Object
   * @param {Object} [options] - Optionen
   * @param {Function} [options.filter] - Filter-Funktion (message => boolean)
   * @param {Object} [options.metadata] - Client-Metadaten (userId, etc.)
   */
  addClient(guildId, clientId, res, options = {}) {
    // SSE-Headers setzen
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Nginx-Buffering deaktivieren
    
    // CORS-Headers für Cross-Origin-Requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    // ⚠️ WICHTIG: Timeout deaktivieren (SSE ist langlebig!)
    res.setTimeout(0);
    
    // ⚠️ Request-Socket offen halten
    if (res.socket) {
      res.socket.setKeepAlive(true);
      res.socket.setNoDelay(true);
    }
    
    // Guild-Map erstellen falls nicht vorhanden
    if (!this.clients.has(guildId)) {
      this.clients.set(guildId, new Map());
    }
    
    // Client-Connection speichern
    const connection = {
      res,
      clientId,
      guildId,
      connectedAt: Date.now(),
      lastMessageAt: null,
      messageCount: 0,
      metadata: options.metadata || {}
    };
    
    this.clients.get(guildId).set(clientId, connection);
    
    // Filter registrieren (falls vorhanden)
    if (options.filter && typeof options.filter === 'function') {
      this.filters.set(clientId, options.filter);
    }
    
    // Heartbeat starten
    this._startHeartbeat(clientId, res);
    
    // Connection-Close-Handler
    res.on('close', () => {
      this._handleClientDisconnect(guildId, clientId);
    });
    
    // Error-Handler (wichtig für Debugging!)
    res.on('error', (error) => {
      this.Logger.error(`[SSEManager] Response-Error für Client ${clientId}:`, error);
      this._handleClientDisconnect(guildId, clientId);
    });
    
    // Statistiken aktualisieren
    this.stats.totalConnections++;
    this.stats.activeConnections++;
    
    this.Logger.info(`[SSEManager] Client verbunden: ${clientId} (Guild: ${guildId}, Total: ${this.stats.activeConnections})`);
    
    // Initial-Event senden (Connection erfolgreich)
    this._sendEvent(res, 'connected', {
      client_id: clientId,
      guild_id: guildId,
      user_id: connection.metadata.userId || null,
      timestamp: Date.now()
    });
  }

  /**
   * Entfernt einen Client
   * 
   * @param {string} guildId - Guild ID
   * @param {string} clientId - Client ID
   */
  removeClient(guildId, clientId) {
    const guildClients = this.clients.get(guildId);
    if (!guildClients) return;
    
    const connection = guildClients.get(clientId);
    if (!connection) return;
    
    // Connection schließen
    try {
      connection.res.end();
    } catch (error) {
      // Ignorieren - Connection bereits geschlossen
    }
    
    // Cleanup
    this._handleClientDisconnect(guildId, clientId);
  }

  /**
   * Broadcast an alle Clients einer Guild
   * 
   * @param {string} guildId - Guild ID
   * @param {string} namespace - Event-Namespace (z.B. 'gameserver')
   * @param {Object} data - Event-Daten
   */
  broadcast(guildId, namespace, data) {
    const guildClients = this.clients.get(guildId);
    if (!guildClients || guildClients.size === 0) {
      this.Logger.debug(`[SSEManager] Keine Clients für Guild ${guildId}`);
      return;
    }
    
    const message = {
      namespace,
      data,
      timestamp: Date.now()
    };
    
    let sentCount = 0;
    let filteredCount = 0;
    
    for (const [clientId, connection] of guildClients.entries()) {
      // Filter prüfen (falls vorhanden)
      const filter = this.filters.get(clientId);
      if (filter && !filter(message)) {
        filteredCount++;
        continue;
      }
      
      // Event senden
      try {
        this._sendEvent(connection.res, namespace, data);
        connection.lastMessageAt = Date.now();
        connection.messageCount++;
        sentCount++;
      } catch (error) {
        this.Logger.error(`[SSEManager] Fehler beim Senden an Client ${clientId}:`, error);
        // Client entfernen bei Fehler
        this.removeClient(guildId, clientId);
      }
    }
    
    this.stats.messagesSent += sentCount;
    this.stats.messagesFiltered += filteredCount;
    
    this.Logger.debug(`[SSEManager] Broadcast ${namespace}: ${sentCount} gesendet, ${filteredCount} gefiltert`);
  }

  /**
   * Broadcast an spezifischen Client
   * 
   * @param {string} clientId - Client ID
   * @param {string} namespace - Event-Namespace
   * @param {Object} data - Event-Daten
   */
  sendToClient(clientId, namespace, data) {
    // Client in allen Guilds suchen
    for (const [guildId, guildClients] of this.clients.entries()) {
      const connection = guildClients.get(clientId);
      if (connection) {
        try {
          this._sendEvent(connection.res, namespace, data);
          connection.lastMessageAt = Date.now();
          connection.messageCount++;
          this.stats.messagesSent++;
          return true;
        } catch (error) {
          this.Logger.error(`[SSEManager] Fehler beim Senden an Client ${clientId}:`, error);
          this.removeClient(guildId, clientId);
          return false;
        }
      }
    }
    
    this.Logger.warn(`[SSEManager] Client ${clientId} nicht gefunden`);
    return false;
  }

  /**
   * Sendet ein SSE-Event an Client
   * 
   * @private
   * @param {Response} res - Express Response
   * @param {string} event - Event-Name
   * @param {Object} data - Event-Daten
   */
  _sendEvent(res, event, data) {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      this.Logger.error(`[SSEManager] Fehler beim Senden von Event "${event}":`, error);
      // Connection ist wahrscheinlich tot - wird vom close-Handler behandelt
    }
  }

  /**
   * Startet Heartbeat für einen Client
   * 
   * @private
   * @param {string} clientId - Client ID
   * @param {Response} res - Express Response
   */
  _startHeartbeat(clientId, res) {
    const interval = setInterval(() => {
      try {
        // Heartbeat als Kommentar senden (wird von Browser ignoriert)
        res.write(': heartbeat\n\n');
      } catch (error) {
        // Connection tot - Heartbeat stoppen
        clearInterval(interval);
        this.heartbeats.delete(clientId);
      }
    }, this.heartbeatInterval);
    
    this.heartbeats.set(clientId, interval);
  }

  /**
   * Behandelt Client-Disconnect
   * 
   * @private
   * @param {string} guildId - Guild ID
   * @param {string} clientId - Client ID
   */
  _handleClientDisconnect(guildId, clientId) {
    // Heartbeat stoppen
    const heartbeat = this.heartbeats.get(clientId);
    if (heartbeat) {
      clearInterval(heartbeat);
      this.heartbeats.delete(clientId);
    }
    
    // Filter entfernen
    this.filters.delete(clientId);
    
    // Client aus Map entfernen
    const guildClients = this.clients.get(guildId);
    if (guildClients) {
      guildClients.delete(clientId);
      
      // Wenn keine Clients mehr, Guild-Map löschen
      if (guildClients.size === 0) {
        this.clients.delete(guildId);
      }
    }
    
    // Statistiken aktualisieren
    this.stats.activeConnections = Math.max(0, this.stats.activeConnections - 1);
    this.stats.connectionsClosed++;
    
    this.Logger.info(`[SSEManager] Client disconnected: ${clientId} (Guild: ${guildId}, Verbleibend: ${this.stats.activeConnections})`);
  }

  /**
   * Gibt Anzahl Clients für eine Guild zurück
   * 
   * @param {string} guildId - Guild ID
   * @returns {number} Anzahl Clients
   */
  getClientCount(guildId) {
    const guildClients = this.clients.get(guildId);
    return guildClients ? guildClients.size : 0;
  }

  /**
   * Gibt alle Client-IDs einer Guild zurück
   * 
   * @param {string} guildId - Guild ID
   * @returns {Array<string>} Client-IDs
   */
  getClientIds(guildId) {
    const guildClients = this.clients.get(guildId);
    return guildClients ? Array.from(guildClients.keys()) : [];
  }

  /**
   * Gibt Statistiken zurück
   * 
   * @returns {Object} Statistiken
   */
  getStats() {
    return {
      ...this.stats,
      guildsWithClients: this.clients.size,
      heartbeatsActive: this.heartbeats.size
    };
  }

  /**
   * Gibt Client-Informationen zurück (für Debugging)
   * 
   * @returns {Array<Object>} Client-Infos
   */
  getClientInfo() {
    const info = [];
    
    for (const [guildId, guildClients] of this.clients.entries()) {
      for (const [clientId, connection] of guildClients.entries()) {
        info.push({
          clientId,
          guildId,
          connectedAt: connection.connectedAt,
          lastMessageAt: connection.lastMessageAt,
          messageCount: connection.messageCount,
          uptime: Date.now() - connection.connectedAt,
          metadata: connection.metadata
        });
      }
    }
    
    return info;
  }

  /**
   * Schließt alle Connections (z.B. beim Shutdown)
   */
  closeAll() {
    this.Logger.info(`[SSEManager] Schließe alle Connections (${this.stats.activeConnections})...`);
    
    for (const [guildId, guildClients] of this.clients.entries()) {
      for (const [clientId, connection] of guildClients.entries()) {
        try {
          // Shutdown-Event senden
          this._sendEvent(connection.res, 'shutdown', {
            message: 'Server wird heruntergefahren',
            timestamp: Date.now()
          });
          
          connection.res.end();
        } catch (error) {
          // Ignorieren
        }
      }
    }
    
    // Alle Heartbeats stoppen
    for (const heartbeat of this.heartbeats.values()) {
      clearInterval(heartbeat);
    }
    
    // Maps clearen
    this.clients.clear();
    this.filters.clear();
    this.heartbeats.clear();
    
    this.stats.activeConnections = 0;
    
    this.Logger.info('[SSEManager] Alle Connections geschlossen');
  }
}

// Singleton-Instanz
let instance = null;

/**
 * Gibt die Singleton-Instanz zurück
 * 
 * @returns {SSEManager} Manager-Instanz
 */
function getInstance() {
  if (!instance) {
    instance = new SSEManager();
  }
  return instance;
}

module.exports = getInstance();
module.exports.SSEManager = SSEManager; // Für Tests
