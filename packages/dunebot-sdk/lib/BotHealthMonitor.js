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

        // Für den Anlauf nach einem Start (Baustelle 180): Wer in den ersten
        // ANLAUF_MS fragt, wartet auf den Bot statt „offline" zu hören.
        this.gestartetAm = Date.now();
        this._wartende = [];
    }

    // ── Der Zustand kommt aus der Verbindung (Baustelle 180, 2026-10-29) ────
    //
    // Gemessen am 2026-10-12: Startete das Dashboard, prüfte die Überwachung
    // eine Sekunde, BEVOR sich der Bot verband — „offline" — und dann erst
    // wieder nach 60 s. Umgekehrt galt ein getrennter Bot erst nach drei
    // verpassten Prüfungen als weg, also bis zu drei Minuten später.
    // Betreiber: „korrekt so machen wir es" — Anmelden am IPC-Server heißt
    // online (mit einer Prüfung sofort, für die Guild-Liste), Trennen heißt
    // offline, beides in der Sekunde. Der 60-s-Takt bleibt als Gegenprobe für
    // eine Verbindung, die steht, aber nicht antwortet.

    /**
     * Ein Client hat sich am IPC-Server verbunden oder getrennt.
     *
     * Nur `Bot #<Shard>` zählt — am Server melden sich auch Prüfskripte mit
     * Zahlennamen an, und die sind kein Bot.
     *
     * @param {'connect'|'disconnect'} art
     * @param {string} name Name des Clients
     * @param {number} [nochBots] wie viele Bot-Verbindungen nach dem Trennen bleiben
     */
    verbindungMelden(art, name, nochBots = 0) {
        if (!BotHealthMonitor.istBot(name)) return;
        const Logger = ServiceManager.get('Logger');
        if (art === 'connect') {
            Logger.info(`[BotHealth] ${name} verbunden — prüfe sofort`);
            // Kurz Luft lassen: Die Verbindung steht, der Bot meldet seine
            // Zuhörer aber erst im selben Augenblick an.
            setTimeout(() => this.checkBotHealth(), BotHealthMonitor.NACH_VERBINDUNG_MS);
            return;
        }
        if (art === 'disconnect' && nochBots === 0 && this.botStatus.isOnline) {
            this.botStatus.isOnline = false;
            this.botStatus.lastPing = Date.now();
            Logger.error(`❌ [BotHealth] ${name} getrennt — Bot offline`);
        }
    }

    /**
     * Online — und in den ersten Sekunden nach einem Start: warten statt Nein.
     *
     * Nach `pm2 restart` beider Dienste verbindet sich der Bot ein paar
     * Sekunden nach dem Dashboard. Wer genau dann eine Guild-Seite öffnet,
     * würde sonst auf „Bot offline" umgeleitet.
     *
     * @param {number} [anlaufMs]
     * @returns {Promise<boolean>}
     */
    async onlineNachAnlauf(anlaufMs = BotHealthMonitor.ANLAUF_MS) {
        if (this.botStatus.isOnline) return true;
        const rest = this.gestartetAm + anlaufMs - Date.now();
        if (rest <= 0) return false;
        await new Promise((fertig) => {
            const wecker = setTimeout(fertig, rest);
            this._wartende.push(() => { clearTimeout(wecker); fertig(); });
        });
        return this.botStatus.isOnline;
    }

    static istBot(name) {
        return /^Bot #\d+$/.test(String(name || ''));
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
            
            const wartende = this._wartende.splice(0);
            wartende.forEach((weiter) => weiter());

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

/** Wie lange nach dem Start des Dashboards auf den Bot gewartet wird (B180). */
BotHealthMonitor.ANLAUF_MS = 15000;
/** Pause zwischen Verbindung und erster Prüfung. */
BotHealthMonitor.NACH_VERBINDUNG_MS = 500;

module.exports = BotHealthMonitor;
