/**
 * Gameserver Console Client
 * Verbindet xterm.js Terminal mit Dashboard Console-API
 * Nutzt SSE (Server-Sent Events) für Live-Output-Streaming
 * 
 * @author FireBot Team
 * @requires xterm.js
 * @requires xterm-addon-fit
 */

class GameserverConsoleClient {
    constructor(config) {
        this.config = config;
        this.terminal = null;
        this.fitAddon = null;
        this.resizeObserver = null;
        this.clientId = null;
        this.connected = false;
        this.eventSource = null;  // SSE EventSource
        this.commandHistory = [];
        this.historyIndex = -1;
        this.currentCommand = '';
        
        this.init();
    }

    /**
     * Initialisiere xterm.js Terminal
     */
    init() {
        console.log('[Console] Initialisiere Console-Client...', this.config);

        // xterm.js Terminal erstellen
        this.terminal = new Terminal({
            cursorBlink: true,
            cursorStyle: 'block',
            fontFamily: 'Consolas, "Courier New", monospace',
            fontSize: 14,
            theme: {
                background: '#000000',
                foreground: '#ffffff',
                cursor: '#ffffff',
                cursorAccent: '#000000',
                selection: 'rgba(255, 255, 255, 0.3)',
                black: '#000000',
                red: '#e06c75',
                green: '#98c379',
                yellow: '#d19a66',
                blue: '#61afef',
                magenta: '#c678dd',
                cyan: '#56b6c2',
                white: '#abb2bf',
                brightBlack: '#5c6370',
                brightRed: '#e06c75',
                brightGreen: '#98c379',
                brightYellow: '#d19a66',
                brightBlue: '#61afef',
                brightMagenta: '#c678dd',
                brightCyan: '#56b6c2',
                brightWhite: '#ffffff'
            },
            rows: 25,
            scrollback: 10000,
            convertEol: true
        });

        // FitAddon für Auto-Resize
        this.fitAddon = new FitAddon.FitAddon();
        this.terminal.loadAddon(this.fitAddon);

        // Terminal an DOM-Element mounten
        const termEl = document.getElementById('xterm-terminal');
        this.terminal.open(termEl);
        this.fitAddon.fit();

        // Resize-Handler
        window.addEventListener('resize', () => {
            if (this.fitAddon) {
                this.fitAddon.fit();
            }
        });

        // ResizeObserver für Container-Änderungen (wenn Tab sichtbar wird / Größe sich ändert)
        if (window.ResizeObserver) {
            this.resizeObserver = new ResizeObserver(() => {
                try {
                    this.fitAddon.fit();
                    // Komplettes Repaint forcieren, falls Viewport schwarz blieb
                    if (this.terminal && typeof this.terminal.refresh === 'function') {
                        this.terminal.refresh(0, this.terminal.rows - 1);
                    }
                } catch (e) {
                    console.debug('[Console] ResizeObserver refresh error (ignoriere):', e?.message || e);
                }
            });
            this.resizeObserver.observe(termEl);
        }

        // Tab-Visibility Hook (Bootstrap 4/5: shown.bs.tab Event)
        const consoleTabLink = document.querySelector('a#console-tab');
        if (consoleTabLink) {
            consoleTabLink.addEventListener('shown.bs.tab', () => {
                setTimeout(() => {
                    try {
                        this.fitAddon.fit();
                        if (this.terminal && typeof this.terminal.refresh === 'function') {
                            this.terminal.refresh(0, this.terminal.rows - 1);
                        }
                        this.terminal?.scrollToBottom?.();
                    } catch (e) {
                        console.debug('[Console] tab shown fit/refresh error:', e?.message || e);
                    }
                }, 50);
            });
        }

        // Command-Input: Enter-Key
        const inputEl = document.getElementById('console-input');
        if (inputEl) {
            inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.sendCommand();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    this.historyUp();
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    this.historyDown();
                }
            });
        }

        // Welcome-Message
        this.terminal.writeln('\x1b[1;32m╔═══════════════════════════════════════════════════════════╗\x1b[0m');
        this.terminal.writeln('\x1b[1;32m║\x1b[0m      \x1b[1;36mFireBot Gameserver Live-Console\x1b[0m                   \x1b[1;32m║\x1b[0m');
        this.terminal.writeln('\x1b[1;32m╚═══════════════════════════════════════════════════════════╝\x1b[0m');
        this.terminal.writeln('');
        this.terminal.writeln('\x1b[90mℹ️  Console verbindet automatisch wenn der Tab aktiv ist...\x1b[0m');
        this.terminal.writeln('');

        console.log('[Console] Terminal initialisiert');
    }

    /**
     * Console verbinden (SSE-Stream starten)
     */
    async connect() {
        if (this.connected) {
            console.warn('[Console] Bereits verbunden!');
            return;
        }

        console.log('[Console] Verbinde mit Server...');
        this.updateStatus('Verbinde...', 'warning');

        try {
            // 1. Attach-Request an API
            const response = await fetch(`${this.config.apiBase}/attach`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            console.log('[Console] Attach-Response:', data);

            if (!data.success) {
                // Benutzerfreundliche Error-Message im Terminal anzeigen
                this.terminal.writeln('');
                this.terminal.writeln('\x1b[1;31m+-----------------------------------------------------------+\x1b[0m');
                this.terminal.writeln('\x1b[1;31m|\x1b[0m      \x1b[1;33mConsole nicht verfuegbar\x1b[0m                         \x1b[1;31m|\x1b[0m');
                this.terminal.writeln('\x1b[1;31m+-----------------------------------------------------------+\x1b[0m');
                this.terminal.writeln('');
                
                // Spezifische Hinweise basierend auf Error-Message
                if (data.message && (data.message.includes('nicht gestartet') || data.message.includes('PTY nicht verfügbar'))) {
                    this.terminal.writeln('\x1b[33mGameserver ist offline\x1b[0m');
                    this.terminal.writeln('');
                    this.terminal.writeln('\x1b[90mDie Console ist nur verfuegbar wenn der Server laeuft.\x1b[0m');
                    this.terminal.writeln('\x1b[90mStarte den Server um die Live-Console zu nutzen.\x1b[0m');
                    this.updateStatus('Server offline', 'secondary');
                } else {
                    // Fallback für andere Fehler
                    this.terminal.writeln('\x1b[31mFehler: ' + (data.message || 'Unbekannter Fehler') + '\x1b[0m');
                    this.updateStatus('Fehler', 'danger');
                }
                this.terminal.writeln('');
                
                // Error nicht werfen - benutzerfreundliche Message ist genug
                return;
            }

            this.clientId = data.client_id;

            // 2. History anzeigen (falls vorhanden)
            if (data.history && data.history.length > 0) {
                this.terminal.writeln('\x1b[36m[History: Letzte ' + data.history.length + ' Zeilen]\x1b[0m');
                data.history.forEach(entry => {
                    const text = (typeof entry === 'string') ? entry : (entry && entry.line ? entry.line : '');
                    // write() statt writeln() – History-Zeilen enthalten bereits \r\n vom PTY
                    if (text) this.terminal.write(text);
                });
                this.terminal.writeln('');
                // Nach History sicherstellen, dass Terminal korrekt gerendert ist
                try {
                    this.fitAddon.fit();
                    this.terminal.refresh(0, this.terminal.rows - 1);
                    this.terminal.scrollToBottom();
                } catch (e) {
                    console.debug('[Console] fit/refresh nach History fehlgeschlagen (ignoriere):', e?.message || e);
                }
            }

            // 3. SSE-Verbindung für Live-Console-Output + Status-Events
            this.setupSSE();
            
            // Hinweis: WebSocket wurde entfernt - SSE ist performant genug!

            this.connected = true;
            this.updateStatus('Verbunden', 'success');
            this.terminal.writeln('\x1b[32mOK Verbunden! Live-Output wird gestreamt...\x1b[0m');
            this.terminal.writeln('');

            // Nach dem Verbinden nochmals fit + refresh (falls Tab nun sichtbar ist)
            try {
                this.fitAddon.fit();
                this.terminal.refresh(0, this.terminal.rows - 1);
                this.terminal.scrollToBottom();
            } catch (e) {
                console.debug('[Console] fit/refresh nach Connect fehlgeschlagen (ignoriere):', e?.message || e);
            }

            // UI-Update (optional - Buttons existieren nicht mehr, da Auto-Connect)
            const connectBtn = document.getElementById('console-connect-btn');
            const disconnectBtn = document.getElementById('console-disconnect-btn');
            if (connectBtn) connectBtn.style.display = 'none';
            if (disconnectBtn) disconnectBtn.style.display = 'inline-block';

        } catch (error) {
            console.error('[Console] Verbindung fehlgeschlagen:', error);
            
            // Bei HTTP-Fehlern benutzerfreundliche Message anzeigen
            if (error.message.includes('HTTP 500') || error.message.includes('Internal Server Error')) {
                this.terminal.writeln('');
                this.terminal.writeln('\x1b[1;31m╔═══════════════════════════════════════════════════════════╗\x1b[0m');
                this.terminal.writeln('\x1b[1;31m║\x1b[0m      \x1b[1;33mWARNING  Console nicht verfügbar\x1b[0m                       \x1b[1;31m║\x1b[0m');
                this.terminal.writeln('\x1b[1;31m╚═══════════════════════════════════════════════════════════╝\x1b[0m');
                this.terminal.writeln('');
                this.terminal.writeln('\x1b[33m! Gameserver ist offline\x1b[0m');
                this.terminal.writeln('');
                this.terminal.writeln('\x1b[90mDie Console ist nur verfügbar wenn der Server läuft.\x1b[0m');
                this.terminal.writeln('\x1b[90mStarte den Server um die Live-Console zu nutzen.\x1b[0m');
                this.terminal.writeln('');
                this.updateStatus('Server offline', 'secondary');
            } else {
                // Andere Fehler (Netzwerk, etc.)
                this.terminal.writeln('');
                this.terminal.writeln('\x1b[31mERROR Verbindungsfehler:\x1b[0m');
                this.terminal.writeln(`   ${error.message}`);
                this.terminal.writeln('');
                this.terminal.writeln('\x1b[90m💡 Tipp: Prüfe deine Internetverbindung und versuche es erneut.\x1b[0m');
                this.terminal.writeln('');
                this.updateStatus('Fehler', 'danger');
            }
        }
    }

    /**
     * SSE-Verbindung für Live-Output aufbauen
     * Eigene EventSource-Connection für Console (wie Pterodactyl)
     */
    setupSSE() {
        console.log('[Console] Setup SSE...');

        // Eigene EventSource für diese Console
        let sseUrl = `/guild/${this.config.guildId}/plugins/gameserver/servers/events`;
        if (this.config.serverId) {
            sseUrl += `?server_id=${encodeURIComponent(this.config.serverId)}`;
        }
        console.log('[Console] Verbinde zu SSE:', sseUrl);

        try {
            this.eventSource = new EventSource(sseUrl);

            // Connection-Event
            this.eventSource.addEventListener('connected', (e) => {
                const data = JSON.parse(e.data);
                console.log('[Console] SSE verbunden:', data);
                // Bei erfolgreichem SSE-Connect sicherheitshalber refitten
                try {
                    this.fitAddon.fit();
                    this.terminal.refresh(0, this.terminal.rows - 1);
                    this.terminal.scrollToBottom();
                } catch (err) {
                    console.debug('[Console] fit/refresh nach SSE-connect fehlgeschlagen (ignoriere):', err?.message || err);
                }
            });

            // Gameserver-Events (für Status-Echos)
            this.eventSource.addEventListener('gameserver', (e) => {
                try {
                    const message = JSON.parse(e.data);

                    // Nur Events für unseren Server
                    const sameServer = (String(message.data?.server_id || message.server_id) === String(this.config.serverId));
                    if (!sameServer) return;

                    // Payload extrahieren (kann in data oder direkt sein)
                    const payload = message.data || message;

                    // 1) Nützliche Status-Echos ins Terminal schreiben
                    if (payload.action === 'status_changed' && payload.status) {
                        const map = { running: 'online', stopped: 'offline' };
                        const normalized = map[payload.status] || payload.status;
                        this.handleOutputLine(`\x1b[36m[STATUS]\x1b[0m Server ist jetzt: ${normalized}`);
                        return;
                    }

                    // 2) Optional: Ressourcen-Echo
                    if (payload.action === 'resource_usage' && (payload.cpu !== undefined || payload.ram !== undefined)) {
                        const cpu = (payload.cpu !== undefined) ? `${Number(payload.cpu).toFixed(1)}%` : '?';
                        const ram = (payload.ram !== undefined) ? `${payload.ram} MB` : '?';
                        this.handleOutputLine(`\x1b[90m[RES]\x1b[0m CPU: ${cpu}, RAM: ${ram}`);
                        return;
                    }

                } catch (error) {
                    console.error('[Console] Fehler beim Parsen der Gameserver-SSE-Message:', error);
                }
            });

            // OK Console-Events (namespace='console')
            this.eventSource.addEventListener('console', (e) => {
                try {
                    const message = JSON.parse(e.data);
                    console.log('[Console][SSE] Console Event empfangen:', message);

                    // Payload extrahieren (kann in data oder direkt sein)
                    const payload = message.data || message;

                    // Nur Events für unseren Server
                    const sameServer = (String(payload.server_id) === String(this.config.serverId));
                    if (!sameServer) {
                        console.log('[Console][SSE] Ignoriere Event für anderen Server:', payload.server_id);
                        return;
                    }

                    // Console-Output
                    // Action kann 'console' oder 'output' sein (je nach Dashboard-Version)
                    if ((payload.action === 'console' || payload.action === 'output') && payload.line) {
                        this.handleOutputLine(payload.line);
                        return;
                    }

                } catch (error) {
                    console.error('[Console] Fehler beim Parsen der Console-SSE-Message:', error);
                }
            });

            // Error-Handler mit Auto-Reconnect
            this.eventSource.onerror = (error) => {
                console.error('[Console] SSE Connection error:', error);
                
                // Connection schließen
                this.eventSource.close();
                this.eventSource = null;
                
                // Auto-Reconnect nach 5 Sekunden (wenn noch connected)
                if (this.connected) {
                    console.log('[Console] SSE Reconnect in 5s...');
                    setTimeout(() => {
                        if (this.connected) {
                            this.setupSSE();
                        }
                    }, 5000);
                }
            };

            console.log('[Console] SSE-Connection etabliert');

        } catch (error) {
            console.error('[Console] Fehler beim Aufbauen der SSE-Connection:', error);
        }
    }

    /**
     * Output-Zeile im Terminal anzeigen
     * @param {string} line 
     */
    handleOutputLine(line) {
        // Zeilenende normalisieren: \r\n falls noch kein Newline am Ende
        const hasNewline = line.endsWith('\n') || line.endsWith('\r\n');
        const formatted = this.colorizeLogLine(line.replace(/\r?\n$/, ''));
        this.terminal.write(formatted + (hasNewline ? '\r\n' : '\r\n'));
        this.terminal.scrollToBottom();
    }

    /**
     * Einfärben von Log-Level-Keywords via ANSI-Escape-Codes.
     * Unterstützt gängige Muster: [ERROR], ERROR:, (Filename:), etc.
     * xterm.js rendert die Codes nativ.
     * @param {string} line
     * @returns {string}
     */
    colorizeLogLine(line) {
        // Bereits ANSI-codiert (Daemon schickt schon Farbe) → unverändert lassen
        if (line.includes('\x1b[')) return line;

        // Farb-Konstanten (ANSI)
        const R  = '\x1b[1;31m'; // bright red
        const Y  = '\x1b[1;33m'; // bright yellow
        const G  = '\x1b[1;32m'; // bright green
        const B  = '\x1b[1;34m'; // bright blue
        const C  = '\x1b[0;36m'; // cyan
        const P  = '\x1b[0;35m'; // magenta
        const DK = '\x1b[0;90m'; // dark grey
        const RS = '\x1b[0m';    // reset

        // ERROR / FATAL → rot
        if (/\b(FATAL|fatal)\b|\[FATAL\]/.test(line)) {
            return R + line + RS;
        }
        if (/\b(ERROR|error)\b|\[ERROR\]|Error response|NullReferenceException|Exception:|Traceback/.test(line)) {
            return R + line + RS;
        }
        // WARNING / WARN → gelb
        if (/\b(WARNING|WARN|warning|warn)\b|\[WARN(ING)?\]/.test(line)) {
            return Y + line + RS;
        }
        // SUCCESS / OK → grün
        if (/\b(SUCCESS|OK|DONE|STARTED|CONNECTED)\b|\[OK\]|\[SUCCESS\]/.test(line)) {
            return G + line + RS;
        }
        // INFO → cyan
        if (/\[INFO\]|\bINFO\b/.test(line)) {
            return C + line + RS;
        }
        // DEBUG → dunkelgrau
        if (/\[DEBUG\]|\bDEBUG\b/.test(line)) {
            return DK + line + RS;
        }

        // Valheim-spezifische Muster
        // "Game server connected" / "DungeonDB" / "Start" etc. → leicht blau
        if (/^(DungeonDB|ZNet|ZSteamSocket|Steam game server|Connections|Spawning|Valheim|Version:|Game version:)/.test(line)) {
            return B + line + RS;
        }
        // SteamCMD-Schritte (Installation)
        if (/^\[.*\] /.test(line) && /Downloading|Validating|Installing|Update state/.test(line)) {
            return P + line + RS;
        }
        // Timestamp-Zeilen (z.B. "03/13/2026 09:09:56: ...") → grau für die Zeit, normal für den Rest
        const tsMatch = line.match(/^(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}): (.*)$/);
        if (tsMatch) {
            return DK + tsMatch[1] + ': ' + RS + tsMatch[2];
        }

        // Keine Sonderregel → unverändert
        return line;
    }

    /**
     * Console trennen (SSE-Stream beenden)
     */
    async disconnect() {
        if (!this.connected) {
            console.warn('[Console] Nicht verbunden!');
            return;
        }

        console.log('[Console] Trenne Verbindung...');
        
        // State SOFORT auf false setzen (bevor API-Calls!)
        this.connected = false;
        this.updateStatus('Trenne...', 'warning');

        try {
            // SSE-Connection schließen
            if (this.eventSource) {
                console.log('[Console] Schließe SSE-Connection...');
                this.eventSource.close();
                this.eventSource = null;
            }

            // Detach-Request an API (nur wenn clientId existiert)
            if (this.clientId) {
                const response = await fetch(`${this.config.apiBase}/detach`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ client_id: this.clientId })
                });

                if (!response.ok) {
                    // Ignoriere 400 Bad Request - könnte bedeuten Session ist schon abgelaufen
                    if (response.status === 400) {
                        console.warn('[Console] Detach returned 400 - Session already closed');
                    } else {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }
                } else {
                    const data = await response.json();
                    console.log('[Console] Detach-Response:', data);
                }
            }

            this.clientId = null;
            this.updateStatus('Getrennt', 'secondary');
            this.terminal.writeln('');
            this.terminal.writeln('\x1b[33mWARNING  Verbindung getrennt\x1b[0m');
            this.terminal.writeln('');

            // UI-Update (optional - Buttons existieren nicht mehr)
            const connectBtn = document.getElementById('console-connect-btn');
            const disconnectBtn = document.getElementById('console-disconnect-btn');
            if (connectBtn) connectBtn.style.display = 'inline-block';
            if (disconnectBtn) disconnectBtn.style.display = 'none';

        } catch (error) {
            console.error('[Console] Fehler beim Trennen:', error);
            // Terminal-Ausgabe nur bei echten Fehlern (nicht bei 400)
            if (!error.message.includes('400')) {
                this.terminal.writeln('\x1b[31mERROR Fehler beim Trennen: ' + error.message + '\x1b[0m');
                this.terminal.writeln('');
            }
        }
    }

    /**
     * Command senden
     */
    async sendCommand() {
        const inputEl = document.getElementById('console-input');
        if (!inputEl) return;

        const command = inputEl.value.trim();
        if (!command) return;

        if (!this.config.canExecute) {
            this.terminal.writeln('\x1b[31mERROR Keine Berechtigung zum Senden von Commands\x1b[0m');
            return;
        }

        if (!this.connected) {
            this.terminal.writeln('\x1b[31mERROR Nicht verbunden! Bitte zuerst verbinden.\x1b[0m');
            return;
        }

        console.log('[Console] Sende Command:', command);

        // Command in History speichern
        this.commandHistory.push(command);
        this.historyIndex = this.commandHistory.length;

        // Im Terminal anzeigen (Echo)
        this.terminal.writeln(`\x1b[1;37m> ${command}\x1b[0m`);

        // Command senden
        try {
            const response = await fetch(`${this.config.apiBase}/send`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ command })
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.message || `HTTP ${response.status}`);
            }

            const data = await response.json();
            console.log('[Console] Command-Response:', data);

            // Input leeren
            inputEl.value = '';

        } catch (error) {
            console.error('[Console] Command fehlgeschlagen:', error);
            this.terminal.writeln(`\x1b[31mERROR Fehler: ${error.message}\x1b[0m`);
        }
    }

    /**
     * History: Vorheriger Command
     */
    historyUp() {
        if (this.commandHistory.length === 0) return;

        const inputEl = document.getElementById('console-input');
        if (!inputEl) return;

        // Aktuellen Input speichern (falls erster Aufruf)
        if (this.historyIndex === this.commandHistory.length) {
            this.currentCommand = inputEl.value;
        }

        if (this.historyIndex > 0) {
            this.historyIndex--;
            inputEl.value = this.commandHistory[this.historyIndex];
        }
    }

    /**
     * History: Nächster Command
     */
    historyDown() {
        if (this.commandHistory.length === 0) return;

        const inputEl = document.getElementById('console-input');
        if (!inputEl) return;

        if (this.historyIndex < this.commandHistory.length - 1) {
            this.historyIndex++;
            inputEl.value = this.commandHistory[this.historyIndex];
        } else if (this.historyIndex === this.commandHistory.length - 1) {
            this.historyIndex++;
            inputEl.value = this.currentCommand;
        }
    }

    /**
     * Terminal löschen
     */
    clear() {
        if (this.terminal) {
            this.terminal.clear();
            this.terminal.writeln('\x1b[33mTerminal gelöscht\x1b[0m');
            this.terminal.writeln('');
            try {
                this.fitAddon.fit();
                this.terminal.refresh(0, this.terminal.rows - 1);
            } catch (e) {}
        }
    }

    /**
     * Status-Badge aktualisieren
     * @param {string} text 
     * @param {string} color - success|warning|danger|secondary
     */
    updateStatus(text, color) {
        const statusEl = document.getElementById('console-status');
        if (!statusEl) return;

        statusEl.textContent = text;
        statusEl.className = 'badge bg-' + color;
    }
}

// HINWEIS: Globale Instanz wird jetzt im Template erstellt
// (damit CONSOLE_CONFIG zur Verfügung steht)
// Siehe: server-detail-console.ejs
