/**
 * Gameserver Overview - Live-Updates via SSE
 * 
 * Verwaltet SSE-Connection für Echtzeit-Updates:
 * - Status-Änderungen (starting, online, stopping, offline, error)
 * - Resource-Usage (CPU, RAM, Players)
 * - Auto-Reconnect bei Connection-Loss
 * 
 * SINGLETON: Nur eine Instanz pro Guild (verhindert doppelte SSE-Connections)
 * 
 * @author FireDervil
 * @version 1.1.0 (Singleton Pattern)
 */

class GameserverOverview {
    constructor(guildId) {
        // ✅ SINGLETON: Return existing instance wenn bereits initialisiert
        if (GameserverOverview.instances && GameserverOverview.instances[guildId]) {
            console.log('[GameserverOverview] ♻️ Verwende existierende Instanz für Guild:', guildId);
            return GameserverOverview.instances[guildId];
        }

        this.guildId = guildId;
        this.eventSource = null;
        this.reconnectDelay = 1000;
        this.maxReconnectDelay = 30000;
        this.isConnected = false;
        this.isTabVisible = true;
        this.reconnectTimeout = null;

        // ✅ SINGLETON: Speichere Instanz
        if (!GameserverOverview.instances) {
            GameserverOverview.instances = {};
        }
        GameserverOverview.instances[guildId] = this;
        
        console.log('[GameserverOverview] ✨ Neue Instanz erstellt für Guild:', guildId);
    }

    /**
     * Initialisiert SSE-Connection und Event-Handler
     */
    init() {
        // ✅ SINGLETON: Verhindere doppelte Initialisierung
        if (this.isConnected || this.eventSource) {
            console.log('[GameserverOverview] ⚠️ Bereits verbunden, überspringe init()');
            return;
        }

        console.log('[GameserverOverview] Initialisierung gestartet...');
        
        // Page Visibility API: Pausiere SSE bei inaktivem Tab
        document.addEventListener('visibilitychange', () => {
            this.isTabVisible = !document.hidden;
            
            if (this.isTabVisible) {
                console.log('[GameserverOverview] 👁️ Tab aktiv → SSE fortsetzen');
                // Bei Tab-Aktivierung: Reconnect wenn disconnected
                if (!this.isConnected && !this.reconnectTimeout) {
                    // Kleine Verzögerung um doppelte Reconnects zu vermeiden
                    setTimeout(() => {
                        if (this.isTabVisible && !this.isConnected) {
                            this.connectSSE();
                            
                            // ✅ NEU: Nach Reconnect → Status-Refresh für alle Server
                            // (Fall: Installation lief während Tab inaktiv)
                            this.refreshAllServerStates();
                        }
                    }, 100);
                }
            } else {
                console.log('[GameserverOverview] 😴 Tab inaktiv → SSE pausieren');
                // Bei Tab-Deaktivierung: Gracefully disconnect
                if (this.eventSource) {
                    this.eventSource.close();
                    this.eventSource = null;
                    this.isConnected = false;
                }
                // Cancel pending reconnects
                if (this.reconnectTimeout) {
                    clearTimeout(this.reconnectTimeout);
                    this.reconnectTimeout = null;
                }
            }
        });
        
        this.connectSSE();
    }

    /**
     * Stellt SSE-Verbindung her
     */
    connectSSE() {
        const url = `/guild/${this.guildId}/plugins/gameserver/servers/events`;
        console.log(`[GameserverOverview] Verbinde zu SSE: ${url}`);

        try {
            this.eventSource = new EventSource(url);

            // Connection-Event (Server-bestätigt)
            this.eventSource.addEventListener('connected', (e) => {
                const data = JSON.parse(e.data);
                console.log('[GameserverOverview] ✅ SSE-Verbindung hergestellt:', data);
                this.isConnected = true;
                this.reconnectDelay = 1000; // Reset delay bei erfolgreicher Verbindung
            });

            // Gameserver-Events (Status, Resources, etc.)
            this.eventSource.addEventListener('gameserver', (e) => {
                const data = JSON.parse(e.data);
                console.log('[GameserverOverview] Event empfangen:', data);
                this.handleGameserverEvent(data);
            });

            // Install-Events (Status, Completed, Failed)
            this.eventSource.addEventListener('install', (e) => {
                const data = JSON.parse(e.data);
                console.log('[GameserverOverview] Install-Event empfangen:', data);
                this.handleInstallEvent(data);
            });

            // Error-Handling
            this.eventSource.onerror = (e) => {
                console.error('[GameserverOverview] ❌ SSE-Fehler:', e);
                this.isConnected = false;
                this.eventSource.close();
                this.reconnect();
            };

        } catch (error) {
            console.error('[GameserverOverview] Fehler beim Aufbau der SSE-Connection:', error);
            this.reconnect();
        }
    }

    /**
     * Reconnect mit Exponential Backoff
     */
    reconnect() {
        // Reconnect nur wenn Tab aktiv ist
        if (!this.isTabVisible) {
            console.log('[GameserverOverview] ⏸️ Tab inaktiv → Reconnect übersprungen');
            return;
        }
        
        console.log(`[GameserverOverview] Reconnect in ${this.reconnectDelay}ms...`);
        
        // Cancel existing timeout
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
        }
        
        this.reconnectTimeout = setTimeout(() => {
            console.log('[GameserverOverview] Reconnecting...');
            this.reconnectTimeout = null;
            this.connectSSE();
            
            // Exponential Backoff
            this.reconnectDelay = Math.min(
                this.reconnectDelay * 2,
                this.maxReconnectDelay
            );
        }, this.reconnectDelay);
    }

    /**
     * Lädt aktuellen Status aller Server nach Tab-Reaktivierung
     * Wichtig für: Installation-Status, der sich während Tab inaktiv geändert hat
     */
    async refreshAllServerStates() {
        console.log('[GameserverOverview] 🔄 Refreshe alle Server-Stati nach Tab-Reaktivierung...');
        
        try {
            const response = await fetch(`/guild/${this.guildId}/plugins/gameserver/servers/status`);
            
            if (!response.ok) {
                console.warn('[GameserverOverview] Status-Refresh fehlgeschlagen:', response.status);
                return;
            }
            
            const data = await response.json();
            
            if (!data.success || !data.servers) {
                console.warn('[GameserverOverview] Ungültige Status-Response:', data);
                return;
            }
            
            console.log(`[GameserverOverview] ✅ ${data.servers.length} Server-Stati aktualisiert`);
            
            // Jeden Server-Status aktualisieren
            data.servers.forEach(server => {
                this.updateServerStatus({
                    server_id: server.id,
                    status: server.status
                });
                
                // Falls Resources vorhanden (nur bei online)
                if (server.status === 'online' && server.resources) {
                    this.updateServerResources({
                        server_id: server.id,
                        ...server.resources
                    });
                }
            });
            
        } catch (error) {
            console.error('[GameserverOverview] Fehler beim Status-Refresh:', error);
        }
    }

    /**
     * Handler für Gameserver-Events
     * @param {Object} data - Event-Daten vom SSE-Stream
     */
    handleGameserverEvent(data) {
        const action = data.action;
        
        // Daten können direkt in 'data' oder in 'data.data' sein
        const payload = data.data || data;

        switch (action) {
            case 'status_changed':
                this.updateServerStatus(payload);
                break;
            case 'resource_usage':
                this.updateServerResources(payload);
                break;
            case 'crashed':
                this.updateServerStatus({
                    server_id: payload.server_id,
                    status: 'error'
                });
                break;
            default:
                console.log(`[GameserverOverview] Unbekannte Action: ${action}`, payload);
        }
    }

    /**
     * Handler für Install-Events
     * @param {Object} data - Event-Daten vom SSE-Stream
     */
    handleInstallEvent(data) {
        const action = data.action;
        const payload = data.data || data;

        switch (action) {
            case 'completed':
                // Installation abgeschlossen → Status auf offline setzen
                this.updateServerStatus({
                    server_id: payload.server_id,
                    status: 'offline'
                });
                break;
            case 'failed':
                // Installation fehlgeschlagen → Status auf error setzen
                this.updateServerStatus({
                    server_id: payload.server_id,
                    status: 'error'
                });
                break;
            case 'status':
                // Install-Phase aktualisieren (z.B. "downloading", "extracting")
                console.log(`[GameserverOverview] Install-Phase: Server ${payload.server_id} → ${payload.phase || payload.message}`);
                break;
            default:
                console.log(`[GameserverOverview] Unbekannte Install-Action: ${action}`, payload);
        }
    }

    /**
     * Aktualisiert Server-Status in UI
     * Funktioniert für:
     * - Overview-Cards (data-server-id auf .card)
     * - Detail-Page (data-server-status Badge ohne Card)
     * 
     * @param {Object} payload - { server_id, status }
     */
    updateServerStatus(payload) {
        let { server_id, status } = payload;
        
        // Status-Mapping: running → online, stopped → offline (wie im Dashboard)
        if (status === 'running') {
            status = 'online';
        } else if (status === 'stopped') {
            status = 'offline';
        }
        
        // Badge-Color-Mapping
        const colors = {
            online: 'success',
            offline: 'secondary',
            starting: 'warning',
            stopping: 'warning',
            error: 'danger',
            installing: 'info'
        };
        
        const icons = {
            online: 'fa-check-circle',
            offline: 'fa-circle',
            starting: 'fa-spinner fa-spin',
            stopping: 'fa-spinner fa-spin',
            error: 'fa-exclamation-triangle',
            installing: 'fa-download'
        };

        const color = colors[status] || 'secondary';
        const icon = icons[status] || 'fa-circle';
        
        // ========================================
        // VERSUCH 1: Overview-Card (data-server-id auf Card)
        // ========================================
        const card = document.querySelector(`[data-server-id="${server_id}"]`);
        
        if (card) {
            const statusBadge = card.querySelector('.server-status-badge');
            const statusText = card.querySelector('.status-text');

            if (statusBadge && statusText) {
                statusBadge.className = `badge bg-${color} server-status-badge`;
                statusText.textContent = status;
                console.log(`[GameserverOverview] Card-Status aktualisiert: Server ${server_id} → ${status}`);
                
                // ========================================
                // Resource-Box nur bei online anzeigen
                // ========================================
                const resourceBox = card.querySelector('.server-resources');
                if (resourceBox) {
                    resourceBox.style.display = (status === 'online') ? '' : 'none';
                }
                
                // ========================================
                // Action-Buttons in Card aktualisieren
                // ========================================
                this.updateCardActionButtons(card, status);
            }
        } 
        
        // ========================================
        // VERSUCH 2: Detail-Page (data-server-status Badge)
        // ========================================
        const detailBadge = document.querySelector('[data-server-status]');
        
        if (detailBadge) {
            const statusTextDetail = detailBadge.querySelector('[data-status-text]');
            const iconElement = detailBadge.querySelector('i.fas');
            
            if (statusTextDetail) {
                detailBadge.className = `badge bg-${color}`;
                statusTextDetail.textContent = status;
                
                // Icon aktualisieren
                if (iconElement) {
                    iconElement.className = `fas ${icon} me-1`;
                }
                
                console.log(`[GameserverOverview] Detail-Status aktualisiert: Server ${server_id} → ${status}`);
                
                // ========================================
                // Action-Buttons auf Detail-Page aktualisieren
                // ========================================
                this.updateDetailActionButtons(status);
            }
        }
        
        // Warnung nur wenn BEIDES nicht gefunden
        if (!card && !detailBadge) {
            console.warn(`[GameserverOverview] Weder Card noch Detail-Badge für Server ${server_id} gefunden`);
        }
    }
    
    /**
     * Aktualisiert Action-Buttons auf Detail-Page basierend auf Status
     * @param {String} status - Server-Status (online, offline, starting, etc.)
     */
    updateDetailActionButtons(status) {
        // Button-Container finden
        const buttonGroup = document.querySelector('.btn-group[role="group"]');
        if (!buttonGroup) {
            return; // Keine Buttons gefunden (wahrscheinlich auf Overview-Page)
        }
        
        // Alle Action-Buttons finden
        const startBtn = buttonGroup.querySelector('button[onclick*="start"]');
        const stopBtn = buttonGroup.querySelector('button[onclick*="stop"]');
        const restartBtn = buttonGroup.querySelector('button[onclick*="restart"]');
        const reinstallBtn = buttonGroup.querySelector('button[onclick*="reinstallServer"]');
        const deleteBtn = buttonGroup.querySelector('button[onclick*="deleteServer"]');
        
        // Button-Sichtbarkeit basierend auf Status
        if (startBtn) {
            // Start: nur bei offline/error
            if (status === 'offline' || status === 'error') {
                startBtn.style.display = '';
            } else {
                startBtn.style.display = 'none';
            }
        }
        
        if (stopBtn) {
            // Stop: nur bei online/starting
            if (status === 'online' || status === 'starting') {
                stopBtn.style.display = '';
            } else {
                stopBtn.style.display = 'none';
            }
        }
        
        if (restartBtn) {
            // Restart: nur bei online
            if (status === 'online') {
                restartBtn.style.display = '';
            } else {
                restartBtn.style.display = 'none';
            }
        }
        
        if (reinstallBtn) {
            // Reinstall: nur bei error
            if (status === 'error') {
                reinstallBtn.style.display = '';
            } else {
                reinstallBtn.style.display = 'none';
            }
        }
        
        if (deleteBtn) {
            // Delete: nur bei offline/error
            if (status === 'offline' || status === 'error') {
                deleteBtn.style.display = '';
            } else {
                deleteBtn.style.display = 'none';
            }
        }
        
        console.log(`[GameserverOverview] Action-Buttons aktualisiert für Status: ${status}`);
    }
    
    /**
     * Aktualisiert Action-Buttons in Server-Card basierend auf Status
     * @param {HTMLElement} card - Card-Element
     * @param {String} status - Server-Status (online, offline, starting, etc.)
     */
    updateCardActionButtons(card, status) {
        // Button-Group in Card-Footer finden
        const buttonGroup = card.querySelector('.card-footer .btn-group');
        if (!buttonGroup) {
            return; // Keine Buttons in dieser Card
        }
        
        // Alle Action-Buttons finden - PRÄZISE Selektoren!
        const startBtn = buttonGroup.querySelector('button[onclick*="\'start\'"]');
        const stopBtn = buttonGroup.querySelector('button[onclick*="\'stop\'"]');
        const restartBtn = buttonGroup.querySelector('button[onclick*="\'restart\'"]');
        const reinstallBtn = buttonGroup.querySelector('button[onclick*="reinstallServer"]');
        const deleteBtn = buttonGroup.querySelector('button[onclick*="deleteServer"]');
        
        // Button-Sichtbarkeit basierend auf Status
        if (startBtn) {
            // Start: nur bei offline/error
            if (status === 'offline' || status === 'error') {
                startBtn.style.display = '';
            } else {
                startBtn.style.display = 'none';
            }
        }
        
        if (stopBtn) {
            // Stop: nur bei online/starting
            if (status === 'online' || status === 'starting') {
                stopBtn.style.display = '';
            } else {
                stopBtn.style.display = 'none';
            }
        }
        
        if (restartBtn) {
            // Restart: nur bei online
            if (status === 'online') {
                restartBtn.style.display = '';
            } else {
                restartBtn.style.display = 'none';
            }
        }
        
        if (reinstallBtn) {
            // Reinstall: nur bei error
            if (status === 'error') {
                reinstallBtn.style.display = '';
            } else {
                reinstallBtn.style.display = 'none';
            }
        }
        
        if (deleteBtn) {
            // Delete: nur bei offline/error
            if (status === 'offline' || status === 'error') {
                deleteBtn.style.display = '';
            } else {
                deleteBtn.style.display = 'none';
            }
        }
        
        console.log(`[GameserverOverview] Card-Buttons aktualisiert für Status: ${status}`, { 
            startBtn: !!startBtn, 
            stopBtn: !!stopBtn, 
            restartBtn: !!restartBtn,
            reinstallBtn: !!reinstallBtn,
            deleteBtn: !!deleteBtn 
        });
    }

    /**
     * Aktualisiert Server-Resources in UI
     * @param {Object} payload - { server_id, cpu, ram_used_mb, ram_total_mb, current_players, max_players }
     */
    updateServerResources(payload) {
        const { server_id, cpu, ram_used_mb, ram_total_mb, current_players, max_players } = payload;
        const card = document.querySelector(`[data-server-id="${server_id}"]`);
        
        if (!card) {
            console.warn(`[GameserverOverview] Card für Server ${server_id} nicht gefunden`);
            return;
        }

        // CPU Update
        if (cpu !== undefined) {
            const cpuText = card.querySelector('.server-cpu');
            const cpuBar = card.querySelector('.server-cpu-bar');
            
            if (cpuText && cpuBar) {
                cpuText.textContent = `${cpu.toFixed(1)}%`;
                cpuBar.style.width = `${cpu}%`;
                cpuBar.setAttribute('aria-valuenow', cpu);
            }
        }

        // RAM Update
        if (ram_used_mb !== undefined && ram_total_mb !== undefined) {
            const ramText = card.querySelector('.server-ram');
            const ramBar = card.querySelector('.server-ram-bar');
            
            if (ramText && ramBar) {
                const ramUsedGB = (ram_used_mb / 1024).toFixed(1);
                const ramTotalGB = (ram_total_mb / 1024).toFixed(1);
                const ramPercent = (ram_used_mb / ram_total_mb) * 100;
                
                ramText.textContent = `${ramUsedGB}GB / ${ramTotalGB}GB`;
                ramBar.style.width = `${ramPercent}%`;
                ramBar.setAttribute('aria-valuenow', ramPercent);
            }
        }

        // Players Update
        if (current_players !== undefined) {
            const playersText = card.querySelector('.server-players');
            
            if (playersText) {
                playersText.textContent = `${current_players} / ${max_players || '?'}`;
            }
        }

        console.log(`[GameserverOverview] Resources aktualisiert: Server ${server_id}`, payload);
    }

    /**
     * Trennt SSE-Verbindung
     */
    disconnect() {
        if (this.eventSource) {
            console.log('[GameserverOverview] Trenne SSE-Verbindung...');
            this.eventSource.close();
            this.isConnected = false;
        }
    }
}

// ============================================
// Auto-Init bei DOM-Ready
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    // Guild-ID aus window.gameserverGuildId (von EJS bereitgestellt)
    const guildId = window.gameserverGuildId;

    if (!guildId) {
        console.debug('[GameserverOverview] Script geladen aber nicht auf Server-Overview-Seite (window.gameserverGuildId nicht gesetzt) - Skip init');
        return;
    }

    console.log('[GameserverOverview] Auto-Init für Guild:', guildId);

    // Singleton-Instanz erstellen/abrufen und initialisieren
    const overview = new GameserverOverview(guildId);
    overview.init();

    // Cleanup bei Page-Leave
    window.addEventListener('beforeunload', () => {
        overview.disconnect();
    });

    // Globale Referenz für Debugging
    window.gameserverOverview = overview;
});
