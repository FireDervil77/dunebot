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
 * @author FireBot Team
 */

/**
 * Ereignisse, die zeilenweise Ausgabe transportieren.
 *
 * Sie laufen waehrend eines Vorgangs dauerhaft und werden nur dort ausgewertet,
 * wo sie auch angezeigt werden. Fehlt ein Handler, ist das kein Hinweis auf
 * einen Verdrahtungsfehler — anders als bei allen uebrigen Ereignissen.
 */
const STROM_AKTIONEN = new Set(['console', 'install_output', 'modpack_stand']);

/**
 * Ereignisse des Kanals selbst, nicht eines Servers. Sie tragen keine
 * `server_id` und gehen deshalb auch durch `fuerServer()`.
 */
const KANAL_AKTIONEN = new Set(['connected', 'verbindung_verloren']);

/**
 * So lange darf ein verdeckter Tab seinen Kanal halten (Baustelle 217, K256).
 *
 * Jeder offene Kanal belegt einen Platz in der HTTP/2-Verbindung des Browsers
 * und einen Worker im Apache (`MaxRequestWorkers 150`, für alle Benutzer
 * zusammen). Die Frist erspart einem schnellen Tabwechsel das Neuverbinden.
 */
const FRIST_VERDECKT_MS = 30000;

class GameserverSSEClient {
    /**
     * Der Kanal dieser Seite. Mehr als einen gibt es nicht (Baustelle 217).
     *
     * Bis zum 2026-11-02 oeffneten Live-Anzeige, Serverseite, Konsole und
     * Uebersicht je einen eigenen Kanal, eine Serverseite also drei. Alle Tabs
     * teilen sich eine HTTP/2-Verbindung, und schon drei Tabs liessen das Panel
     * fuer diesen Browser stehen.
     *
     * Der Kanal ist ungefiltert. Eine Seite, die nur einen Server zeigt, nimmt
     * `fuerServer()`.
     *
     * @param {string} guildId - Discord Guild ID
     * @returns {GameserverSSEClient}
     */
    static fuerSeite(guildId) {
        if (!window.gameserverSSE) {
            window.gameserverSSE = new GameserverSSEClient(guildId);
        }
        return window.gameserverSSE;
    }

    /**
     * @param {string} guildId - Discord Guild ID
     */
    constructor(guildId) {
        this.guildId = guildId;
        this.eventSource = null;

        /**
         * Rohe Zuhoerer je SSE-Ereignisname, siehe `hoere()`.
         * @type {Map<string, Set<Function>>}
         */
        this.hoerer = new Map();
        
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
        this.aufgegebenGemeldet = false;
        
        /**
         * Connection-Status
         */
        this.connected = false;
        this.manuallyDisconnected = false;

        /**
         * Pause im verdeckten Tab: `gewollt` heisst, jemand hat verbunden und
         * nicht getrennt. `pausiert` heisst, der Kanal ist nur wegen des
         * verdeckten Tabs zu. `schonVerbunden` unterscheidet das erste
         * `connected` von jedem weiteren, nach dem die Seiten nachholen.
         */
        this.gewollt = false;
        this.pausiert = false;
        this.pauseTimer = null;
        this.schonVerbunden = false;
        if (typeof document !== 'undefined' && document.addEventListener) {
            document.addEventListener('visibilitychange', () => this._sichtbarkeit());
        }

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
        this.gewollt = true;
        this.manuallyDisconnected = false;

        // Jeder Nutzer der Seite ruft das, der erste oeffnet den Kanal. Im
        // pausierten Tab oeffnet erst das Sichtbarwerden.
        if (this.eventSource || this.pausiert) return;

        // SSE-Endpoint URL
        const url = `/guild/${this.guildId}/plugins/gameserver/servers/events`;

        console.log('[GameserverSSE] Verbinde zu:', url);

        try {
            this.eventSource = new EventSource(url);
            this.gebunden = new Set();
            for (const typ of this.hoerer.keys()) this._binde(typ);

            // Connection-Event (Custom von Server)
            this.eventSource.addEventListener('connected', (e) => {
                const data = JSON.parse(e.data);
                console.log('[GameserverSSE] Verbunden:', data);
                this.connected = true;
                this.reconnectDelay = 1000; // Reset delay
                this.reconnectAttempts = 0;
                this.aufgegebenGemeldet = false;

                // Auch an die `on()`-Handler. `wieder` ist wahr ab dem zweiten
                // Verbinden (Dashboard-Neustart, Ende einer Pause): Was in der
                // Luecke kam, ist an der Seite vorbeigegangen, sie holt nach.
                // Bis 2026-11-08 kam `connected` nur bei `hoere()` an, und
                // `gameserver-live.js` holte nach einem Wiederverbinden nie nach.
                const wieder = this.schonVerbunden;
                this.schonVerbunden = true;
                this._handleEvent({ ...data, action: 'connected', wieder });
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

            // Install-Events (completed, failed, status, output)
            this.eventSource.addEventListener('install', (e) => {
                try {
                    const message = JSON.parse(e.data);
                    console.log('[GameserverSSE] Install Event empfangen:', message);
                    // Prefix 'install_' damit Handlers eindeutig sind (z.B. 'install_completed', 'install_failed')
                    message.action = 'install_' + message.action;
                    this._handleEvent(message);
                } catch (error) {
                    console.error('[GameserverSSE] Fehler beim Parsen der Install-Message:', error);
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

            // Shutdown-Event: Das Dashboard startet neu. Die Leitung reisst gleich,
            // und `onerror` baut sie wieder auf. Bis 2026-11-02 trennte das hier
            // endgueltig, die Seite blieb nach jedem Neustart ohne Live-Daten.
            this.eventSource.addEventListener('shutdown', (e) => {
                const data = JSON.parse(e.data);
                console.warn('[GameserverSSE] Server shutdown:', data.message);
            });

            // Metrics-Event (CPU, RAM, Players pro Gameserver)
            this.eventSource.addEventListener('metrics', (e) => {
                try {
                    const message = JSON.parse(e.data);
                    this._handleEvent(message);
                } catch (error) {
                    console.error('[GameserverSSE] Fehler beim Parsen der Metrics-Message:', error);
                }
            });

            // Migration-Events (Server-Umzug zwischen RootServern)
            // Dispatch unter fester Action 'gameserver_migration' — der Untertyp
            // (migration_started/progress/completed/failed) steckt in message.type
            this.eventSource.addEventListener('gameserver_migration', (e) => {
                try {
                    const message = JSON.parse(e.data);
                    console.log('[GameserverSSE] Migration Event empfangen:', message);
                    message.action = 'gameserver_migration';
                    this._handleEvent(message);
                } catch (error) {
                    console.error('[GameserverSSE] Fehler beim Parsen der Migration-Message:', error);
                }
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
        this.gewollt = false;
        this.pausiert = false;
        if (this.pauseTimer) {
            clearTimeout(this.pauseTimer);
            this.pauseTimer = null;
        }
        this._schliesse();
    }

    /**
     * Schliesst die Leitung und haelt einen geplanten Neuversuch an.
     * @private
     */
    _schliesse() {
        this.connected = false;

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
    }

    /**
     * Verdeckter Tab: nach der Frist den Kanal freigeben. Sichtbarer Tab: einen
     * pausierten Kanal wieder oeffnen, die Seiten holen auf `connected` nach.
     * @private
     */
    _sichtbarkeit() {
        if (document.hidden) {
            if (!this.gewollt || this.pausiert || this.pauseTimer) return;
            this.pauseTimer = setTimeout(() => {
                this.pauseTimer = null;
                if (!document.hidden || !this.gewollt) return;
                console.log('[GameserverSSE] Tab verdeckt, Kanal pausiert');
                this.pausiert = true;
                this._schliesse();
            }, FRIST_VERDECKT_MS);
            return;
        }

        if (this.pauseTimer) {
            clearTimeout(this.pauseTimer);
            this.pauseTimer = null;
        }
        if (this.pausiert) {
            console.log('[GameserverSSE] Tab sichtbar, Kanal wieder offen');
            this.pausiert = false;
            this.reconnectDelay = 1000;
            this.connect();
        }
    }

    /**
     * Hoert roh auf ein SSE-Ereignis, fuer Nutzer, die `e.data` selbst lesen.
     * Bleibt ueber Neuverbindungen bestehen.
     *
     * @param {string} typ - SSE-Ereignisname (z.B. 'console')
     * @param {Function} fn - Bekommt das MessageEvent
     * @returns {Function} Abmelden
     */
    hoere(typ, fn) {
        if (!this.hoerer.has(typ)) this.hoerer.set(typ, new Set());
        this.hoerer.get(typ).add(fn);
        if (this.eventSource) this._binde(typ);
        return () => this.hoerer.get(typ).delete(fn);
    }

    /**
     * @private
     * @param {string} typ - SSE-Ereignisname
     */
    _binde(typ) {
        if (this.gebunden.has(typ)) return;
        this.gebunden.add(typ);
        this.eventSource.addEventListener(typ, (e) => {
            for (const fn of this.hoerer.get(typ)) {
                try {
                    fn(e);
                } catch (error) {
                    console.error(`[GameserverSSE] Zuhoerer-Fehler (${typ}):`, error);
                }
            }
        });
    }

    /**
     * Der Kanal, gesehen von einer Seite, die nur einen Server zeigt.
     *
     * Dieselbe Regel, die bisher `?server_id=` im Dashboard anwandte: Durch geht
     * nur, was diese Kennung traegt, dazu die Ereignisse des Kanals selbst.
     *
     * @param {string|number} serverId
     * @returns {{on: Function, connect: Function, disconnect: Function}}
     */
    fuerServer(serverId) {
        const id = String(serverId);
        return {
            on: (action, handler) => this.on(action, (message) => {
                if (KANAL_AKTIONEN.has(action) || String(message.server_id) === id) handler(message);
            }),
            connect: () => this.connect(),
            disconnect: () => this.disconnect()
        };
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
        } else if (!STROM_AKTIONEN.has(action) && !KANAL_AKTIONEN.has(action)) {
            // Die Warnung soll falsch verdrahtete Ereignisse aufdecken. Reine
            // Ausgabestroeme gehoeren nicht dazu: Sie laufen zeilenweise und
            // werden nur auf den Seiten ausgewertet, die sie auch anzeigen —
            // eine Seite ohne Anzeige ist kein Fehler. Ohne diese Ausnahme
            // meldete eine einzige Installation hunderte Male "Kein Handler".
            console.warn(`[GameserverSSE] Kein Handler für Action: ${action}`);
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

        // Der Nutzer erfaehrt es einmal, der Kanal versucht es weiter: Die
        // Uebersicht verband sich schon immer ohne Grenze neu.
        if (this.reconnectAttempts >= this.maxReconnectAttempts && !this.aufgegebenGemeldet) {
            console.error('[GameserverSSE] Max Reconnect-Versuche erreicht');
            this.aufgegebenGemeldet = true;
            (this.handlers.get('verbindung_verloren') || []).forEach(handler => handler());
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

// ℹ️ Keine automatische Instanziierung: guildId ist beim Laden dieser Datei noch
// nicht bekannt. Den Kanal holt sich jeder Nutzer mit `fuerSeite(guildId)`.
