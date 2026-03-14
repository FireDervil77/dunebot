/**
 * GameserverSSEClient - Server-Sent Events Client für Browser
 * 
 * Ermöglicht Echtzeit-Updates für Gameserver-Events:
 * - Status-Änderungen
 * - Resource-Usage
 * - Crashes
 * 
 * Features:
 * - EventSource-Wrapper mit Auto-Reconnect
 * - Event-Handler-Registry
 * - Exponential Backoff bei Reconnects
 * - Error-Handling und Logging
 * 
 * @class GameserverSSEClient
 * @author DuneBot Team
 */
class GameserverSSEClient {
    /**
     * @param {string} guildId - Discord Guild ID
     * @param {Object} [options] - Optionen
     * @param {string} [options.serverId] - Optional: Filter für bestimmten Server
     */
    constructor(guildId, options = {}) {
        this.guildId = guildId;
        this.serverId = options.serverId || null;
        this.eventSource = null;
        
        /**
         * Event-Handler: Map<action, Array<HandlerFunction>>
         * @type {Map<string, Array<Function>>}
         */
        this.handlers = new Map();
        
        /**
         * Reconnect-Konfiguration
         */
        this.reconnectDelay = 1000; // Start: 1s
        this.maxReconnectDelay = 30000; // Max: 30s
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectTimer = null;
        
        /**
         * Connection-Status
         */
        this.connected = false;
        this.manuallyDisconnected = false;
        
        /**
         * Statistiken
         */
        this.stats = {
            messagesReceived: 0,
            reconnects: 0,
            errors: 0
        };
        
        console.log('[GameserverSSE] Client erstellt für Guild:', guildId);
    }

    /**
     * Verbindung herstellen
     */
    connect() {
        if (this.eventSource) {
            console.warn('[GameserverSSE] Bereits verbunden');
            return;
        }

        this.manuallyDisconnected = false;

        // SSE-Endpoint URL
        let url = `/guild/${this.guildId}/plugins/gameserver/servers/events`;
        if (this.serverId) {
            url += `?server_id=${this.serverId}`;
        }

        console.log('[GameserverSSE] Verbinde zu:', url);

        try {
            this.eventSource = new EventSource(url);

            // Connection-Event (Custom von Server)
            this.eventSource.addEventListener('connected', (e) => {
                const data = JSON.parse(e.data);
                console.log('[GameserverSSE] Verbunden:', data);
                this.connected = true;
                this.reconnectDelay = 1000; // Reset delay
                this.reconnectAttempts = 0;
            });

            // Gameserver-Events
            this.eventSource.addEventListener('gameserver', (e) => {
                try {
                    const message = JSON.parse(e.data);
                    this._handleEvent(message);
                } catch (error) {
                    console.error('[GameserverSSE] Fehler beim Parsen der Message:', error);
                }
            });

            // ✅ Console-Events (separater Event-Type!)
            this.eventSource.addEventListener('console', (e) => {
                try {
                    const message = JSON.parse(e.data);
                    console.log('[GameserverSSE] Console Event empfangen:', message);
                    
                    // Console-Events werden direkt über Handler verarbeitet
                    // Die action ist 'console' (nicht 'output'), das ist OK
                    this._handleEvent(message);
                } catch (error) {
                    console.error('[GameserverSSE] Fehler beim Parsen der Console-Message:', error);
                }
            });

            // Shutdown-Event
            this.eventSource.addEventListener('shutdown', (e) => {
                const data = JSON.parse(e.data);
                console.warn('[GameserverSSE] Server shutdown:', data.message);
                this.disconnect();
            });

            // Error-Handler
            this.eventSource.onerror = (error) => {
                console.error('[GameserverSSE] Connection error:', error);
                this.stats.errors++;
                this.connected = false;
                
                // EventSource schließt automatisch bei Fehler
                this.eventSource.close();
                this.eventSource = null;
                
                // Auto-Reconnect (wenn nicht manuell disconnected)
                if (!this.manuallyDisconnected) {
                    this._reconnect();
                }
            };

        } catch (error) {
            console.error('[GameserverSSE] Fehler beim Verbinden:', error);
            this._reconnect();
        }
    }

    /**
     * Verbindung trennen
     */
    disconnect() {
        console.log('[GameserverSSE] Disconnecting...');
        this.manuallyDisconnected = true;
        this.connected = false;

        // Reconnect-Timer stoppen
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        // EventSource schließen
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
    }

    /**
     * Registriert einen Event-Handler
     * 
     * @param {string} action - Action-Name (z.B. 'status_changed')
     * @param {Function} handler - Handler-Funktion (data => {...})
     * @returns {Function} Unregister-Funktion
     */
    on(action, handler) {
        if (!this.handlers.has(action)) {
            this.handlers.set(action, []);
        }
        
        this.handlers.get(action).push(handler);
        
        // Unregister-Funktion zurückgeben
        return () => this.off(action, handler);
    }

    /**
     * Entfernt einen Event-Handler
     * 
     * @param {string} action - Action-Name
     * @param {Function} handler - Handler-Funktion
     */
    off(action, handler) {
        const handlers = this.handlers.get(action);
        if (!handlers) return;
        
        const index = handlers.indexOf(handler);
        if (index !== -1) {
            handlers.splice(index, 1);
        }
    }

    /**
     * Verarbeitet ein Event
     * 
     * @private
     * @param {Object} message - Event-Message (bereits geparst)
     */
    _handleEvent(message) {
        // Message ist bereits die Data (JSON.parse wurde im EventListener gemacht)
        const action = message.action;
        
        this.stats.messagesReceived++;
        
        console.log('[GameserverSSE] Event:', action, message);
        
        // Handler ausführen
        const handlers = this.handlers.get(action);
        if (handlers && handlers.length > 0) {
            handlers.forEach(handler => {
                try {
                    handler(message);
                } catch (error) {
                    console.error(`[GameserverSSE] Handler-Fehler (${action}):`, error);
                }
            });
        } else {
            // Console-Events haben normalerweise keinen Handler hier
            // (werden von console-client.js separat behandelt)
            if (action !== 'console') {
                console.warn(`[GameserverSSE] Kein Handler für Action: ${action}`);
            }
        }
    }

    /**
     * Reconnect mit Exponential Backoff
     * 
     * @private
     */
    _reconnect() {
        if (this.manuallyDisconnected) {
            console.log('[GameserverSSE] Manuell disconnected - kein Reconnect');
            return;
        }

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('[GameserverSSE] Max Reconnect-Versuche erreicht');
            return;
        }

        this.reconnectAttempts++;
        this.stats.reconnects++;

        console.log(`[GameserverSSE] Reconnect in ${this.reconnectDelay}ms (Versuch ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

        this.reconnectTimer = setTimeout(() => {
            this.connect();
            // Exponential Backoff
            this.reconnectDelay = Math.min(
                this.reconnectDelay * 2,
                this.maxReconnectDelay
            );
        }, this.reconnectDelay);
    }

    /**
     * Gibt Statistiken zurück
     * 
     * @returns {Object} Statistiken
     */
    getStats() {
        return {
            ...this.stats,
            connected: this.connected,
            reconnectAttempts: this.reconnectAttempts
        };
    }

    /**
     * Prüft ob verbunden
     * 
     * @returns {boolean} Verbunden?
     */
    isConnected() {
        return this.connected;
    }
}

// Export für global
window.GameserverSSEClient = GameserverSSEClient;

// ℹ️ Keine automatische Instanziierung mehr!
// Die Instanz wird im jeweiligen EJS-Template erstellt:
//   const guildId = '<%= guildId %>';
//   window.gameserverSSE = new GameserverSSEClient(guildId);
//
// Grund: guildId ist beim Laden dieser Datei noch nicht verfügbar,
// da EJS-Template-Variablen erst im Inline-Script im HTML verfügbar sind.
