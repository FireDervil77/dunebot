/**
 * StatusService – eine Wahrheit über den Live-Zustand eines Gameservers
 *
 * Vorher gab es drei unabhängige, teils nie aktualisierte Quellen:
 *   - gameservers.current_players (wurde aus Daemon-Stats gefüllt, die das Feld nie senden)
 *   - GameDig-Query (lief nur im Browser der Detailseite, wurde nirgends gespeichert)
 *   - gameservers.max_players (DB-Spalte, während MAX_PLAYERS die echte Wahrheit ist)
 *
 * Dieser Service fragt den Status ab, persistiert ihn in gameserver_status und
 * ist damit die gemeinsame Quelle für Dashboard, Discord-Bot und API.
 *
 * Quelle A (hier, E1): Query via GameDig – Zählwerte, Map, Version, Ping
 * Quelle B (E3):       RCON via Daemon   – echte Spielernamen
 *
 * @module helpers/StatusService
 * @author FireBot Team
 */

'use strict';

const { ServiceManager } = require('dunebot-core');
const QueryService = require('./QueryService');
const { resolveStatusConfig } = require('./StatusSchema');

/** ENV-Variablen, die als Slot-Anzahl in Frage kommen (Reihenfolge = Priorität) */
const MAX_PLAYER_VARS = ['MAX_PLAYERS', 'MAXPLAYERS', 'SERVER_MAXPLAYERS', 'SLOTS'];

/**
 * Vom Daemon unterstützte Protokolle für die Fernabfrage.
 *
 * "palworld_rest" ist kein RCON im engeren Sinn, sondern Palworlds eigene
 * Admin-API über HTTP. Für die Aufrufer verhält sie sich gleich – Befehl rein,
 * Text raus –, deshalb liegt sie im selben Treiber-Register wie srcds.
 */
const SUPPORTED_RCON_PROTOCOLS = ['srcds', 'palworld_rest'];

/**
 * Felder, die eine normalisierte Spielerangabe tragen darf.
 *
 * Bewusst eine Allowlist statt einer Denylist: Jede Quelle liefert mehr, als
 * angezeigt werden soll – GameDig einen kompletten `raw`-Block, RCON-Parser die
 * Rohspalten, und Palworlds REST-API gibt in `/v1/api/players` die **IP-Adresse**
 * jedes Spielers heraus. Das ist ein personenbezogenes Datum und hat weder in
 * `players_json` noch im SSE-Stream oder der späteren Public-API etwas zu suchen.
 *
 * Verworfen wird deshalb hier, bei der Normalisierung – nicht erst bei der
 * Anzeige. Neue Spielversionen können jederzeit weitere Felder mitbringen; eine
 * Denylist würde sie durchlassen, diese Liste nicht.
 */
const PLAYER_FIELDS = [
    'name', 'uid', 'platform_id', 'steamid',
    'score', 'level', 'ping', 'time', 'team', 'avatar',
];

/**
 * Wie lange ein Query-Ergebnis wiederverwendet wird, statt neu abzufragen.
 *
 * Gameserver beantworten A2S-Abfragen pro Quelle nur einzeln und drosseln
 * Wiederholungen. Fragen Poller und geöffnete Detailseite gleichzeitig ab,
 * läuft die zweite Abfrage in den Timeout – genau das Bild von "erster Durchgang
 * geht, zweiter scheitert".
 */
const QUERY_REUSE_MS = 5_000;

/**
 * Zeitgrenze für den RCON-Statusabruf über den Daemon.
 *
 * Kürzer als beim Konsolen-Befehl (15 s): Der Poller läuft im 10-Sekunden-Takt,
 * eine Abfrage darf den nächsten Durchgang nicht überholen.
 */
const RCON_STATUS_TIMEOUT_MS = 8_000;

/** @type {Map<string, Promise>} serverId → laufende Abfrage (Coalescing) */
const inFlight = new Map();
/** @type {Map<string, {result: object, at: number}>} serverId → letztes Query-Ergebnis */
const lastQuery = new Map();

class StatusService {

    // ────────────────────────────────────────────────────────────
    // JSON-Spalten
    // ────────────────────────────────────────────────────────────

    /** @private */
    static _parseJson(value, fallback) {
        if (value == null) return fallback;
        if (typeof value !== 'string') return value;
        try { return JSON.parse(value); } catch (_) { return fallback; }
    }

    // ────────────────────────────────────────────────────────────
    // RCON-Verfügbarkeit
    // ────────────────────────────────────────────────────────────

    /**
     * Ermittelt, ob RCON für einen Server tatsächlich nutzbar ist.
     *
     * Ersetzt die frühere Vermutung `!!game_data.config.rcon`, die RCON auch dann
     * als verfügbar meldete, wenn weder Port auflösbar noch Passwort gesetzt war.
     *
     * Konvention (wie im Sende-Pfad): port_var in Kleinbuchstaben → ports[],
     * in Großbuchstaben → env_variables[].
     *
     * @param {object} opts
     * @param {object} opts.gameData - geparste game_data (Addon)
     * @param {object} opts.ports    - geparste ports-Spalte
     * @param {object} opts.envVars  - geparste env_variables-Spalte
     * @param {object} [opts.cfg]    - Verbindungsblock; ohne Angabe config.rcon.
     *                                 Der Status-Abruf reicht hier den aufgelösten
     *                                 status.rcon-Block herein, weil er ein anderes
     *                                 Protokoll fahren kann als die Konsole – bei
     *                                 Palworld die REST-API statt srcds.
     * @returns {{available: boolean, configured: boolean, protocol: string|null,
     *            port: number|null, hasPassword: boolean, reason: string|null}}
     */
    static resolveRcon({ gameData, ports = {}, envVars = {}, cfg: explicitCfg = null }) {
        const cfg = explicitCfg || gameData?.config?.rcon;
        const result = {
            available:   false,
            configured:  !!cfg,
            protocol:    cfg?.protocol || null,
            port:        null,
            hasPassword: false,
            reason:      null,
        };

        if (!cfg) {
            result.reason = 'Dieses Spiel hat keine RCON-Konfiguration';
            return result;
        }

        // Fester Port schlägt die Variablen-Auflösung. Palworlds REST-API lauscht
        // containerintern auf 8212 und wird bewusst nicht allokiert – es gäbe
        // also keinen ports-Eintrag und keine ENV-Variable, auf die man zeigen könnte.
        const literalPort = Number(cfg.port);
        if (Number.isFinite(literalPort) && literalPort > 0) {
            result.port = literalPort;
        }

        const portVar = cfg.port_var || '';
        if (result.port) {
            // bereits gesetzt
        } else if (portVar === portVar.toLowerCase()) {
            const entry = ports[portVar];
            result.port = entry?.external ?? entry?.internal ?? null;
            // Manche Spiele fahren RCON über den Game-Port
            if (!result.port && portVar === 'game') {
                const game = ports.game;
                result.port = game?.external ?? game?.internal ?? null;
            }
        } else {
            result.port = parseInt(envVars[portVar], 10) || null;
        }

        result.hasPassword = !!(envVars[cfg.password_var || ''] || '').toString().trim();

        if (!result.port) {
            result.reason = `RCON-Port (${portVar || '?'}) ist nicht konfiguriert`;
            return result;
        }
        if (!result.hasPassword) {
            result.reason = `RCON-Passwort (${cfg.password_var || '?'}) ist nicht gesetzt`;
            return result;
        }
        if (result.protocol && !SUPPORTED_RCON_PROTOCOLS.includes(result.protocol)) {
            result.reason = `RCON-Protokoll "${result.protocol}" wird noch nicht unterstützt`;
            return result;
        }

        result.available = true;
        return result;
    }

    // ────────────────────────────────────────────────────────────
    // Slot-Anzahl
    // ────────────────────────────────────────────────────────────

    /**
     * Slot-Anzahl aus der ENV-Variable lesen – das ist der Wert, der wirklich
     * im Startup-Command/der Config landet (gameservers.max_players ist nur Anzeige).
     * @param {object} envVars
     * @param {object} gameData
     * @returns {number|null}
     */
    static resolveMaxPlayers(envVars = {}, gameData = {}) {
        // Override im Addon: "merge": { "max_players": "variable:FOO" }
        const override = gameData?.status?.merge?.max_players;
        const candidates = typeof override === 'string' && override.startsWith('variable:')
            ? [override.slice('variable:'.length), ...MAX_PLAYER_VARS]
            : MAX_PLAYER_VARS;

        for (const key of candidates) {
            const n = parseInt(envVars[key], 10);
            if (Number.isFinite(n) && n > 0) return n;
        }
        return null;
    }

    // ────────────────────────────────────────────────────────────
    // Abfrage + Persistenz
    // ────────────────────────────────────────────────────────────

    /**
     * Fragt den Live-Status ab und schreibt den Snapshot.
     *
     * @param {object} server - Zeile aus gameservers inkl. rootserver_ip + game_data
     *                          (id, guild_id, status, ports, env_variables, game_data,
     *                           bind_ip, rootserver_ip)
     * @returns {Promise<object>} persistierter Snapshot
     */
    /**
     * Fragt den Live-Status ab und schreibt den Snapshot.
     *
     * Läuft für denselben Server bereits eine Abfrage, wird deren Ergebnis
     * mitbenutzt statt eine zweite Abfrage loszuschicken – sonst blockieren sich
     * Poller und Detailseite gegenseitig am Gameserver.
     *
     * @param {object} server
     * @returns {Promise<object>}
     */
    static async refresh(server) {
        const key = String(server.id);

        const running = inFlight.get(key);
        if (running) return running;

        const promise = StatusService._refreshNow(server).finally(() => inFlight.delete(key));
        inFlight.set(key, promise);
        return promise;
    }

    /**
     * Liefert das letzte Query-Ergebnis, wenn es jung genug ist.
     * @param {number|string} serverId
     * @param {number} [maxAgeMs]
     * @returns {object|null}
     */
    static getRecentQuery(serverId, maxAgeMs = QUERY_REUSE_MS) {
        const entry = lastQuery.get(String(serverId));
        if (!entry) return null;
        return (Date.now() - entry.at) <= maxAgeMs ? entry.result : null;
    }

    /**
     * Reduziert eine Spielerangabe auf die erlaubten Felder (siehe PLAYER_FIELDS).
     *
     * Gemeinsamer Engpass für alle Quellen – Query, RCON und REST laufen hier
     * durch, damit es genau eine Stelle gibt, an der über Spielerfelder entschieden
     * wird.
     *
     * @param {object} player - Rohe Spielerangabe der Quelle
     * @returns {object} Normalisierte Spielerangabe
     */
    static normalizePlayer(player) {
        const out = {};
        for (const field of PLAYER_FIELDS) {
            if (player?.[field] !== undefined) out[field] = player[field];
        }
        // Die Standard-Spalten der Spielerliste sollen auch dann vorhanden sein,
        // wenn die Quelle sie nicht kennt – sonst bleibt die Spalte undefiniert
        // statt leer.
        out.name  = out.name || '';
        out.score = out.score ?? null;
        out.time  = out.time ?? null;
        return out;
    }

    /**
     * Normalisiert eine ganze Spielerliste.
     *
     * @param {Array<object>} players
     * @returns {Array<object>}
     */
    static normalizePlayers(players) {
        if (!Array.isArray(players)) return [];
        return players.map(p => StatusService.normalizePlayer(p));
    }

    /** @private */
    static async _refreshNow(server) {
        const Logger = ServiceManager.get('Logger');

        const ports    = StatusService._parseJson(server.ports, {});
        const gameData = StatusService._parseJson(server.game_data, {});
        const envVars  = StatusService._parseJson(server.env_variables, {});

        const maxFromVars = StatusService.resolveMaxPlayers(envVars, gameData);

        // Offline-Server werden nicht abgefragt – das spart Timeouts im Poller
        if (server.status !== 'online') {
            return StatusService._persist(server, {
                online: false, players_current: null, players_max: maxFromVars,
                map: null, version: null, ping_ms: null,
                players_json: null, extra_json: null,
                source: 'none', query_ok: false,
                last_error: null, resetFailCount: true,
            });
        }

        const statusCfg = resolveStatusConfig(gameData);

        // Query und RCON sprechen verschiedene Dienste an und behindern sich
        // nicht – also nebeneinander. Nacheinander würden sich im Fehlerfall
        // zwei Zeitgrenzen addieren und der Poll-Takt reißen.
        const [queryResult, rconResult] = await Promise.all([
            QueryService.query({
                host: server.bind_ip || server.rootserver_ip,
                ports,
                gameData,
            }),
            StatusService._fetchRconPlayers(server, statusCfg, { ports, envVars, gameData }),
        ]);

        const queryOk = !!queryResult.success;
        const rconOk  = rconResult.ok;

        // Nur wenn beide Quellen stumm bleiben, wissen wir wirklich nichts.
        if (!queryOk && !rconOk) {
            const reason = queryResult.error || rconResult.error || 'Query fehlgeschlagen';
            Logger?.debug?.(`[StatusService] Keine Quelle erreichbar (Server ${server.id}): ${reason}`);
            return StatusService._withQuery(await StatusService._persist(server, {
                online: false, players_current: null, players_max: maxFromVars,
                map: null, version: null, ping_ms: null,
                players_json: null, extra_json: null,
                source: 'none', query_ok: false,
                rcon_ok: rconResult.attempted ? false : null,
                last_error: reason,
                resetFailCount: false,
            }), queryResult);
        }

        const queryPlayers = queryOk ? StatusService.normalizePlayers(queryResult.players) : [];
        const rconPlayers  = rconOk  ? StatusService.normalizePlayers(rconResult.players)  : [];
        const players      = StatusService._mergePlayers(statusCfg.merge?.players, queryPlayers, rconPlayers);

        // Zählwert getrennt von der Liste: Die Query kennt bei vielen Spielen
        // eine eigene Angabe, die auch gerade verbindende Spieler mitzählt, die
        // noch in keiner Liste stehen. Fällt sie aus, zählt die Liste.
        const playersCurrent = queryOk && statusCfg.merge?.player_count !== 'rcon_first'
            ? queryPlayers.length
            : players.length;

        const source = queryOk && rconOk ? 'merged' : (queryOk ? 'query' : 'rcon');

        return StatusService._withQuery(await StatusService._persist(server, {
            // Antwortet auch nur eine der beiden Quellen, läuft der Server.
            // Vorher hing "online" allein an der Query – bei Palworld also nie.
            online:          true,
            players_current: playersCurrent,
            // Query gewinnt, weil sie den laufenden Prozess widerspiegelt;
            // die Variable ist der Fallback, wenn das Protokoll nichts liefert.
            players_max:     queryResult.maxPlayers ?? maxFromVars,
            map:             queryOk ? (queryResult.map || null) : null,
            version:         queryOk ? (queryResult.extra?.gameVersion || queryResult.version || null) : null,
            ping_ms:         queryOk ? (queryResult.ping ?? null) : null,
            players_json:    players,
            extra_json:      queryOk
                ? { ...(queryResult.extra || {}), bots: queryResult.bots ?? 0, connect: queryResult.connect || null }
                : null,
            source,
            query_ok:        queryOk,
            rcon_ok:         rconResult.attempted ? rconOk : null,
            last_error:      queryOk ? null : (queryResult.error || null),
            // Solange irgendeine Quelle antwortet, ist das kein Fehlversuch.
            // Sonst baute Palworld dauerhaft Backoff auf, obwohl RCON liefert.
            resetFailCount:  true,
        }), queryResult);
    }

    /**
     * Holt die Spielerliste über den RCON-Kanal des Daemons.
     *
     * Gibt immer ein Ergebnis zurück, nie einen Fehler – eine nicht erreichbare
     * RCON-Verbindung darf die Query-Auswertung nicht mitreißen.
     *
     * @private
     * @returns {Promise<{attempted: boolean, ok: boolean, players: Array, raw: string|null, error: string|null}>}
     */
    static async _fetchRconPlayers(server, statusCfg, { ports, envVars, gameData }) {
        const untouched = { attempted: false, ok: false, players: [], raw: null, error: null };

        // Ohne Status-Befehl gibt es nichts abzurufen. Das ist der Normalfall für
        // Spiele, die ihre Spieler schon über die Query liefern.
        const spec = statusCfg?.rcon;
        if (!spec?.command) return untouched;

        // Verbindung aus demselben Block wie der Befehl auflösen: Der Status-Kanal
        // kann ein anderes Protokoll fahren als die Konsole. Bei Palworld holt die
        // Konsole weiter über srcds, die Spielerliste aber über die REST-API.
        const rcon = StatusService.resolveRcon({ gameData, ports, envVars, cfg: spec });
        if (!rcon.available) return { ...untouched, error: rcon.reason };

        const ipmServer = ServiceManager.get('ipmServer');
        if (!ipmServer) {
            return { ...untouched, error: 'Kein IPM-Server verfügbar' };
        }

        // Die daemon_id hängt an rootserver, nicht an gameservers – wer den Server
        // ohne diesen JOIN lädt, hätte hier sonst stillschweigend kein RCON und
        // würde einen guten Snapshot mit "keine Quelle" überschreiben. Deshalb holt
        // der Service sie notfalls selbst, statt sich auf den Aufrufer zu verlassen.
        const daemonId = server.daemon_id || await StatusService._resolveDaemonId(server.id);
        if (!daemonId) {
            return { ...untouched, error: 'Kein Daemon für diesen Server verbunden' };
        }

        const password = String(envVars[spec.password_var] || '');
        const Logger   = ServiceManager.get('Logger');

        let result;
        try {
            // sendCommand wirft bei success:false – ohne dieses catch verschwände
            // die Daemon-Meldung hinter einem generischen Fehler.
            result = await ipmServer.sendCommand(daemonId, 'gameserver.rcon_status', {
                guild_id:      String(server.guild_id),
                server_id:     String(server.id),
                rcon_host:     server.bind_ip || server.rootserver_ip || '127.0.0.1',
                rcon_port:     rcon.port,
                rcon_password: password,
                rcon_protocol: rcon.protocol || 'srcds',
                command:       spec.command,
                format:        spec.format || 'regex',
                row_regex:     spec.row_regex || '',
                json_path:     spec.json_path || '',
                fields:        spec.fields || {},
                skip_lines:    spec.skip_lines || 0,
            }, RCON_STATUS_TIMEOUT_MS);
        } catch (err) {
            const reason = err?.message || 'RCON-Statusabfrage fehlgeschlagen';
            Logger?.debug?.(`[StatusService] RCON-Status fehlgeschlagen (Server ${server.id}): ${reason}`);
            await StatusService.recordRconResult(server.id, server.guild_id, false, reason).catch(() => {});
            return { attempted: true, ok: false, players: [], raw: null, error: reason };
        }

        await StatusService.recordRconResult(server.id, server.guild_id, true, null).catch(() => {});

        return {
            attempted: true,
            ok:        true,
            players:   Array.isArray(result?.players) ? result.players : [],
            raw:       result?.raw ?? null,
            error:     null,
        };
    }

    /**
     * Holt die daemon_id eines Servers nach, wenn der Aufrufer sie nicht mitbringt.
     *
     * @private
     * @param {number|string} serverId
     * @returns {Promise<string|null>}
     */
    static async _resolveDaemonId(serverId) {
        const dbService = ServiceManager.get('dbService');
        const Logger    = ServiceManager.get('Logger');
        try {
            const [row] = await dbService.query(`
                SELECT r.daemon_id
                FROM gameservers gs
                LEFT JOIN rootserver r ON gs.rootserver_id = r.id
                WHERE gs.id = ?
            `, [serverId]);
            return row?.daemon_id || null;
        } catch (err) {
            Logger?.warn?.(`[StatusService] daemon_id nicht ermittelbar (Server ${serverId}): ${err.message}`);
            return null;
        }
    }

    /**
     * Entscheidet, welche Spielerliste gilt.
     *
     * Die Regel steht im Addon (`status.merge.players`), weil sie vom Spiel
     * abhängt: Bei Palworld ist die Query blind und RCON die einzige Quelle, bei
     * CS2 liefert die Query bereits alles und RCON wäre nur zusätzliche Last.
     *
     * @private
     */
    static _mergePlayers(rule, queryPlayers, rconPlayers) {
        switch (rule) {
            case 'query_only':  return queryPlayers;
            case 'rcon_only':   return rconPlayers;
            case 'query_first': return queryPlayers.length ? queryPlayers : rconPlayers;
            case 'rcon_first':
            default:
                // Standard: die authentifizierte Quelle gewinnt, wenn sie etwas
                // weiß – sie liefert echte Namen statt Platzhaltern.
                return rconPlayers.length ? rconPlayers : queryPlayers;
        }
    }

    /**
     * Hängt das vollständige Query-Ergebnis an den Snapshot (nicht persistiert).
     * Die Detailseite rendert daraus spielspezifische Extras, die im Snapshot
     * bewusst nicht landen.
     * @private
     */
    static _withQuery(snapshot, queryResult) {
        snapshot.query = queryResult;
        lastQuery.set(String(snapshot.server_id), { result: queryResult, at: Date.now() });
        return snapshot;
    }

    /**
     * Schreibt den Snapshot und hält gameservers.current_players synchron
     * (Abwärtskompatibilität für bestehende Views und den Discord-Bot).
     * @private
     */
    static async _persist(server, snap) {
        const dbService = ServiceManager.get('dbService');

        await dbService.query(`
            INSERT INTO gameserver_status
                (server_id, guild_id, online, players_current, players_max, map, version,
                 ping_ms, players_json, extra_json, source, query_ok, last_error,
                 fail_count, queried_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
                online          = VALUES(online),
                players_current = VALUES(players_current),
                players_max     = VALUES(players_max),
                map             = VALUES(map),
                version         = VALUES(version),
                ping_ms         = VALUES(ping_ms),
                players_json    = VALUES(players_json),
                extra_json      = VALUES(extra_json),
                source          = VALUES(source),
                query_ok        = VALUES(query_ok),
                last_error      = VALUES(last_error),
                -- Nur echte Fehlversuche zählen. Ein planmäßig offline stehender
                -- Server ist kein Fehler und darf keinen Backoff aufbauen –
                -- sonst dauert es nach dem Start minutenlang bis zur ersten Zahl.
                fail_count      = IF(VALUES(fail_count) = 0, 0, fail_count + 1),
                queried_at      = NOW()
        `, [
            server.id,
            server.guild_id,
            snap.online ? 1 : 0,
            snap.players_current,
            snap.players_max,
            snap.map,
            snap.version,
            snap.ping_ms,
            snap.players_json ? JSON.stringify(snap.players_json) : null,
            snap.extra_json   ? JSON.stringify(snap.extra_json)   : null,
            snap.source,
            snap.query_ok ? 1 : 0,
            snap.last_error,
            snap.resetFailCount ? 0 : 1,
        ]);

        // NULL statt 0, wenn die Abfrage fehlschlug: "0 Spieler" ist eine Aussage,
        // "wir wissen es nicht" ist eine andere. Die Anzeige zeigt bei NULL ein "–"
        // statt einer erfundenen Null.
        await dbService.query(
            'UPDATE gameservers SET current_players = ?, max_players = COALESCE(?, max_players), current_map = COALESCE(?, current_map) WHERE id = ?',
            [snap.players_current, snap.players_max, snap.map, server.id]
        );

        return {
            server_id:       server.id,
            guild_id:        server.guild_id,
            online:          snap.online,
            players_current: snap.players_current,
            players_max:     snap.players_max,
            map:             snap.map,
            version:         snap.version,
            ping_ms:         snap.ping_ms,
            players:         snap.players_json || [],
            extra:           snap.extra_json   || {},
            source:          snap.source,
            query_ok:        snap.query_ok,
            // null = in diesem Durchgang nicht versucht. Die DB-Spalte schreibt
            // recordRconResult, damit der Konsolen-Pfad und der Poller dieselbe
            // Stelle benutzen.
            rcon_ok:         snap.rcon_ok ?? null,
            last_error:      snap.last_error,
            queried_at:      new Date().toISOString(),
        };
    }

    /**
     * Merkt sich das Ergebnis eines echten RCON-Aufrufs (Konsole, Cronjob).
     * Damit basiert die RCON-Anzeige auf Tatsachen statt auf Konfiguration.
     *
     * @param {number|string} serverId
     * @param {string} guildId
     * @param {boolean} ok
     * @param {string|null} [error]
     */
    static async recordRconResult(serverId, guildId, ok, error = null) {
        const dbService = ServiceManager.get('dbService');
        const Logger    = ServiceManager.get('Logger');
        try {
            await dbService.query(`
                INSERT INTO gameserver_status (server_id, guild_id, rcon_ok, last_error)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    rcon_ok    = VALUES(rcon_ok),
                    last_error = IF(VALUES(rcon_ok), last_error, VALUES(last_error))
            `, [serverId, guildId, ok ? 1 : 0, ok ? null : (error || 'RCON fehlgeschlagen')]);
        } catch (err) {
            Logger?.warn?.(`[StatusService] RCON-Ergebnis nicht gespeichert (Server ${serverId}): ${err.message}`);
        }
    }

    /**
     * Rendert einen Snapshot in die Form, die die Detailseite von der Query kennt.
     *
     * Die Seite wurde gebaut, als die Query die einzige Quelle war, und liest
     * `success`, `players`, `maxPlayers`, `map`, `ping`, `version`. Seit RCON
     * dazukommt, kann der Server laufen, ohne dass die Query antwortet – dann
     * liefert diese Abbildung dieselben Felder aus dem Snapshot, statt die Seite
     * auf einem Fehler sitzen zu lassen.
     *
     * @param {object} snapshot
     * @returns {object}
     */
    static toQueryShape(snapshot) {
        return {
            success:    !!snapshot.online,
            error:      snapshot.online ? null : (snapshot.last_error || 'Server antwortet nicht'),
            players:    snapshot.players || [],
            maxPlayers: snapshot.players_max ?? null,
            map:        snapshot.map || null,
            ping:       snapshot.ping_ms ?? null,
            version:    snapshot.version || null,
            extra:      snapshot.extra || {},
            source:     snapshot.source || null,
        };
    }

    /**
     * Snapshot eines Servers laden (ohne Abfrage).
     * @param {number|string} serverId
     * @returns {Promise<object|null>}
     */
    static async getSnapshot(serverId) {
        const dbService = ServiceManager.get('dbService');
        const [row] = await dbService.query(
            'SELECT * FROM gameserver_status WHERE server_id = ?', [serverId]
        );
        if (!row) return null;
        row.players = StatusService._parseJson(row.players_json, []);
        row.extra   = StatusService._parseJson(row.extra_json, {});
        delete row.players_json;
        delete row.extra_json;
        return row;
    }
}

module.exports = StatusService;
