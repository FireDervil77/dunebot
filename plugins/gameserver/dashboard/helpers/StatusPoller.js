/**
 * StatusPoller – hält die Status-Snapshots aller Gameserver aktuell
 *
 * Bisher lief die einzige echte Statusquelle (GameDig) nur im Browser der
 * Detailseite. Ergebnis: Serverliste, Karten und der Discord-Bot zeigten
 * dauerhaft 0 Spieler. Der Poller fragt zentral ab, schreibt den Snapshot und
 * broadcastet ihn per SSE – alle Ansichten lesen danach dieselbe Wahrheit.
 *
 * Adaptive Intervalle statt fixem Takt, damit ein Gameserver nicht sinnlos mit
 * Query-Traffic beschossen wird:
 *   - jemand schaut gerade auf den Server   → 10 s
 *   - Guild hat offene Dashboard-Verbindung → 60 s
 *   - sonst                                 → 300 s
 *   - nach Fehlern                          → Backoff bis 300 s
 *
 * @module helpers/StatusPoller
 * @author FireBot Team
 */

'use strict';

const { ServiceManager } = require('dunebot-core');
const StatusService = require('./StatusService');

/** Takt, in dem geprüft wird, welche Server fällig sind */
const TICK_MS = 5_000;
/** Wie lange ein Server nach direktem Interesse als "beobachtet" gilt */
const INTEREST_TTL_MS = 120_000;

const INTERVAL_WATCHED = 10_000;
const INTERVAL_GUILD_ACTIVE = 60_000;
const INTERVAL_IDLE = 300_000;
const INTERVAL_MAX = 300_000;

/** Wieviele Server maximal gleichzeitig abgefragt werden (Query kostet je bis 5 s) */
const MAX_CONCURRENT = 5;

class StatusPoller {
    constructor() {
        /** @type {Map<string, number>} serverId → Zeitpunkt des letzten Interesses */
        this._interest = new Map();
        /** @type {Map<string, number>} serverId → nächste Fälligkeit (ms epoch) */
        this._nextDue = new Map();
        /** @type {Map<string, string>} serverId → zuletzt gesehener DB-Status */
        this._lastStatus = new Map();
        /** @type {Set<string>} gerade laufende Abfragen */
        this._inFlight = new Set();
        this._timer = null;
        this._started = false;
    }

    // ────────────────────────────────────────────────────────────
    // Lifecycle
    // ────────────────────────────────────────────────────────────

    /**
     * Startet den Poller.
     * @param {object} dbService
     */
    start(dbService) {
        const Logger = ServiceManager.get('Logger');
        if (this._started) return;

        this._dbService = dbService;
        this._timer = setInterval(() => {
            this._tick().catch(err =>
                Logger.error('[StatusPoller] Tick fehlgeschlagen:', err.message)
            );
        }, TICK_MS);
        // Nicht am Prozess-Shutdown hängen
        if (this._timer.unref) this._timer.unref();

        this._started = true;
        Logger.success('[StatusPoller] Status-Poller gestartet.');
    }

    /** Stoppt den Poller. */
    stop() {
        if (this._timer) clearInterval(this._timer);
        this._timer = null;
        this._started = false;
        ServiceManager.get('Logger')?.info('[StatusPoller] Status-Poller gestoppt.');
    }

    // ────────────────────────────────────────────────────────────
    // Interesse (von Routen/Views gemeldet)
    // ────────────────────────────────────────────────────────────

    /**
     * Meldet, dass gerade jemand auf diesen Server schaut → schnelleres Intervall.
     * @param {number|string} serverId
     */
    markInterest(serverId) {
        this._interest.set(String(serverId), Date.now());
    }

    /**
     * Erzwingt eine sofortige Abfrage (z.B. nach Start/Stop eines Servers).
     * @param {number|string} serverId
     */
    invalidate(serverId) {
        this._nextDue.set(String(serverId), 0);
    }

    // ────────────────────────────────────────────────────────────
    // Poll-Schleife
    // ────────────────────────────────────────────────────────────

    /** @private */
    async _tick() {
        const servers = await this._loadServers();
        const now = Date.now();

        const due = [];
        for (const server of servers) {
            const key = String(server.id);
            if (this._inFlight.has(key)) continue;

            // Statuswechsel (z.B. offline → online) sofort abfragen, statt auf
            // das nächste reguläre Intervall zu warten
            const lastStatus = this._lastStatus.get(key);
            if (lastStatus !== server.status) {
                this._lastStatus.set(key, server.status);
                if (lastStatus !== undefined) this._nextDue.set(key, 0);
            }

            if ((this._nextDue.get(key) ?? 0) > now) continue;
            due.push(server);
        }

        // Aufgeräumt halten: verschwundene Server nicht ewig mitschleppen
        if (servers.length !== this._nextDue.size) {
            const alive = new Set(servers.map(s => String(s.id)));
            for (const key of this._nextDue.keys()) {
                if (!alive.has(key)) {
                    this._nextDue.delete(key);
                    this._interest.delete(key);
                    this._lastStatus.delete(key);
                }
            }
        }

        for (let i = 0; i < due.length; i += MAX_CONCURRENT) {
            await Promise.all(due.slice(i, i + MAX_CONCURRENT).map(s => this._refresh(s)));
        }
    }

    /** @private */
    async _loadServers() {
        return this._dbService.query(`
            SELECT gs.id, gs.guild_id, gs.status, gs.ports, gs.env_variables, gs.bind_ip,
                   COALESCE(am.game_data, gs.frozen_game_data) AS game_data,
                   r.host AS rootserver_ip,
                   r.daemon_id,
                   st.fail_count
            FROM gameservers gs
            LEFT JOIN addon_marketplace am  ON gs.addon_marketplace_id = am.id
            LEFT JOIN rootserver r          ON gs.rootserver_id = r.id
            LEFT JOIN gameserver_status st  ON st.server_id = gs.id
            WHERE gs.status NOT IN ('installing', 'error')
        `);
    }

    /** @private */
    async _refresh(server) {
        const Logger = ServiceManager.get('Logger');
        const key = String(server.id);
        this._inFlight.add(key);

        try {
            const snapshot = await StatusService.refresh(server);
            this._broadcast(server.guild_id, snapshot);
        } catch (err) {
            Logger.warn(`[StatusPoller] Abfrage fehlgeschlagen (Server ${server.id}): ${err.message}`);
        } finally {
            this._inFlight.delete(key);
            this._nextDue.set(key, Date.now() + this._intervalFor(server));
        }
    }

    /**
     * Nächstes Intervall für einen Server.
     * @private
     */
    _intervalFor(server) {
        const now = Date.now();
        const key = String(server.id);

        // Abgelaufenes Interesse aufräumen
        const seen = this._interest.get(key);
        if (seen && now - seen > INTEREST_TTL_MS) {
            this._interest.delete(key);
        }

        let interval;
        if (server.status !== 'online') {
            interval = INTERVAL_IDLE;
        } else if (this._interest.has(key)) {
            interval = INTERVAL_WATCHED;
        } else if (this._guildHasViewers(server.guild_id)) {
            interval = INTERVAL_GUILD_ACTIVE;
        } else {
            interval = INTERVAL_IDLE;
        }

        // Backoff: jeder Fehlversuch verdoppelt, gedeckelt auf INTERVAL_MAX
        const fails = Number(server.fail_count) || 0;
        if (fails > 0) {
            interval = Math.min(interval * Math.pow(2, Math.min(fails, 5)), INTERVAL_MAX);
        }
        return interval;
    }

    /** @private */
    _guildHasViewers(guildId) {
        const sseManager = ServiceManager.get('sseManager');
        if (!sseManager || !guildId) return false;
        try {
            return sseManager.getClientCount(guildId) > 0;
        } catch (_) {
            return false;
        }
    }

    /** @private */
    _broadcast(guildId, snapshot) {
        const sseManager = ServiceManager.get('sseManager');
        if (!sseManager || !guildId) return;
        sseManager.broadcast(guildId, 'gameserver', {
            action:          'status',
            server_id:       snapshot.server_id,
            online:          snapshot.online,
            current_players: snapshot.players_current,
            max_players:     snapshot.players_max,
            map:             snapshot.map,
            ping_ms:         snapshot.ping_ms,
            version:         snapshot.version,
            players:         snapshot.players || [],
            source:          snapshot.source,
            timestamp:       Date.now(),
        }, { transform: playersOnlyForWatchedServer });
    }
}

/**
 * Schneidet die Spielerliste aus dem Status-Event, wenn der Empfänger nicht
 * ausdrücklich auf genau diesen Server schaut.
 *
 * Hintergrund: `sseManager.broadcast()` liefert an *alle* Verbindungen der Guild.
 * Der Server-Filter greift nur, wenn der Client `?server_id=…` mitschickt – das tut
 * die Detailseite, die Serverübersicht aber nicht. Ohne diesen Zuschnitt bekäme
 * jeder, der die Übersicht offen hat, die Spielernamen sämtlicher Gameserver der
 * Guild frei Haus.
 *
 * Zählwerte gehen weiterhin an alle – die Übersicht braucht sie, und "3 von 20"
 * verrät niemanden. Namen sind personenbezogen und bleiben bei der Detailansicht.
 *
 * @private
 * @param {object} data - Status-Event
 * @param {object} connection - Empfangende SSE-Verbindung
 * @returns {object} Nutzlast für diese Verbindung
 */
function playersOnlyForWatchedServer(data, connection) {
    const watched = connection?.metadata?.serverId;
    if (watched && String(watched) === String(data.server_id)) {
        return data;
    }
    const { players, ...withoutPlayers } = data;
    return withoutPlayers;
}

module.exports = StatusPoller;
