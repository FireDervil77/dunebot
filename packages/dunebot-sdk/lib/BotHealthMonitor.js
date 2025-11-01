/**
 * Bot Health Monitor
 * 
 * Überwacht den Bot-Status via IPC Health-Checks.
 * Trackt verfügbare Guilds und Latency für Middleware-Validierung.
 * 
 * @author FireDervil
 */

const { ServiceManager } = require('dunebot-core');

class BotHealthMonitor {
    constructor() {
        this.botStatus = {
            isOnline: false,
            lastPing: null,
            lastSuccessfulPing: null,
            availableGuilds: [],
            guildCount: 0,
            latency: null,
            consecutiveFailures: 0
        };
        
        this.checkInterval = null;
        this.isChecking = false;
    }

    /**
     * Startet Health-Check-Monitoring
     * @param {number} intervalMs - Check-Intervall in Millisekunden (default: 60000 = 60s)
     */
    startMonitoring(intervalMs = 60000) {
        const Logger = ServiceManager.get('Logger');
        
        Logger.debug(`[BotHealth] startMonitoring() aufgerufen mit Intervall ${intervalMs}ms`);
        
        if (this.checkInterval) {
            Logger.warn('[BotHealth] Monitoring läuft bereits');
            return;
        }
        
        Logger.info(`🏥 [BotHealth] Starte Monitoring - alle ${intervalMs/1000}s`);
        
        // Initial check
        Logger.debug('[BotHealth] Führe initialen Health-Check durch...');
        this.checkBotHealth();
        
        // Regelmäßige Checks
        this.checkInterval = setInterval(() => {
            this.checkBotHealth();
        }, intervalMs);
        
        Logger.success(`[BotHealth] Monitoring erfolgreich gestartet!`);
    }

    /**
     * Stoppt Health-Check-Monitoring
     */
    stopMonitoring() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
            
            const Logger = ServiceManager.get('Logger');
            Logger.info('[BotHealth] Monitoring gestoppt');
        }
    }

    /**
     * Führt Health-Check durch
     */
    async checkBotHealth() {
        if (this.isChecking) {
            return; // Prevent overlapping checks
        }
        
        this.isChecking = true;
        const Logger = ServiceManager.get('Logger');
        const ipcServer = ServiceManager.get('ipcServer');
        
        if (!ipcServer) {
            Logger.error('[BotHealth] IPC-Server nicht verfügbar');
            this.botStatus.isOnline = false;
            this.isChecking = false;
            return;
        }
        
        const startTime = Date.now();
        
        try {
            // Dashboard sendet via ipcServer.broadcastOne() an Bot
            const response = await ipcServer.broadcastOne(
                'dashboard:BOT_HEALTH_CHECK',
                {},
                true,  // requireResponse
                5000   // 5s timeout
            );
            
            if (!response || !response.guilds) {
                throw new Error('Invalid health check response');
            }
            
            const latency = Date.now() - startTime;
            
            // Bot ist online
            const wasOffline = !this.botStatus.isOnline;
            
            this.botStatus = {
                isOnline: true,
                lastPing: Date.now(),
                lastSuccessfulPing: Date.now(),
                availableGuilds: response.guilds || [],
                guildCount: response.guildCount || 0,
                latency: latency,
                consecutiveFailures: 0,
                botPing: response.ping || null
            };
            
            if (wasOffline) {
                Logger.success(`✅ [BotHealth] Bot wieder online! ${this.botStatus.guildCount} Guilds, ${latency}ms`);
            } else {
                Logger.debug(`[BotHealth] Bot online ✓ | ${this.botStatus.guildCount} Guilds | ${latency}ms latency`);
            }
            
        } catch (error) {
            this.botStatus.consecutiveFailures++;
            this.botStatus.lastPing = Date.now();
            
            // Nach 3 Fehlversuchen als offline markieren
            if (this.botStatus.consecutiveFailures >= 3 && this.botStatus.isOnline) {
                this.botStatus.isOnline = false;
                Logger.error(`❌ [BotHealth] Bot offline nach ${this.botStatus.consecutiveFailures} Fehlversuchen`);
            } else {
                Logger.warn(`⚠️ [BotHealth] Check fehlgeschlagen (${this.botStatus.consecutiveFailures}/3):`, error.message);
            }
        } finally {
            this.isChecking = false;
        }
    }

    /**
     * Prüft ob eine Guild verfügbar ist (Bot ist Mitglied)
     * @param {string} guildId - Discord Guild ID
     * @returns {boolean}
     */
    isGuildAvailable(guildId) {
        if (!this.botStatus.isOnline) {
            return false;
        }
        
        return this.botStatus.availableGuilds.includes(guildId);
    }

    /**
     * Gibt aktuellen Bot-Status zurück
     * @returns {Object} Bot-Status
     */
    getStatus() {
        return { ...this.botStatus };
    }

    /**
     * Prüft ob Bot online ist
     * @returns {boolean}
     */
    isOnline() {
        return this.botStatus.isOnline;
    }

    /**
     * Gibt Liste aller verfügbaren Guilds zurück
     * @returns {Array<string>}
     */
    getAvailableGuilds() {
        return [...this.botStatus.availableGuilds];
    }

    /**
     * Gibt Latency des letzten erfolgreichen Checks zurück
     * @returns {number|null}
     */
    getLatency() {
        return this.botStatus.latency;
    }

    /**
     * Gibt Zeit seit letztem erfolgreichen Ping zurück (in Sekunden)
     * @returns {number|null}
     */
    getTimeSinceLastSuccess() {
        if (!this.botStatus.lastSuccessfulPing) return null;
        return Math.floor((Date.now() - this.botStatus.lastSuccessfulPing) / 1000);
    }
}

module.exports = BotHealthMonitor;
