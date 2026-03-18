/**
 * QueryService – Gameserver Status-Abfrage via GameDig
 *
 * Liest gamedig_type + port_var aus dem Addon-JSON (game_data.query),
 * ermittelt Host/Port aus Rootserver + gameservers.ports und gibt
 * den Live-Status zurück.
 *
 * Unterstützte Spiele (via GameDig 600+):
 *   cs2, arkse, rust, valheim, 7dtd, minecraft, tf2, ...
 *
 * @module helpers/QueryService
 * @author FireBot Team
 */

'use strict';

const { GameDig } = require('gamedig');

/** Timeout für eine einzelne Query in ms */
const QUERY_TIMEOUT_MS = 5000;
/** Maximale Verbindungsversuche */
const QUERY_MAX_ATTEMPTS = 2;

class QueryService {
    /**
     * Fragt den Live-Status eines Gameservers ab.
     *
     * @param {object} opts
     * @param {string}  opts.host          - IP/Hostname des Rootservers
     * @param {object}  opts.ports         - Geparste ports-Spalte aus gameservers (z.B. { game: { external: 27015 }, query: { external: 27016 } })
     * @param {object}  opts.gameData      - Geparste game_data-Spalte aus addon_marketplace (enthält .query Block)
     * @returns {Promise<QueryResult>}
     */
    static async query({ host, ports, gameData }) {
        const queryConfig = gameData?.query;
        if (!queryConfig?.gamedig_type) {
            return { success: false, error: 'Dieses Spiel unterstützt keine Live-Query (kein gamedig_type konfiguriert)' };
        }
        if (!host) {
            return { success: false, error: 'Kein Host konfiguriert' };
        }

        // Query-Port aus ports-Objekt lesen
        const portVar = queryConfig.port_var || 'game';
        const portEntry = ports?.[portVar];
        let port = portEntry?.external ?? portEntry?.internal ?? null;

        // Fallback für _plus_N Notation (z.B. "game_plus_1"):
        // Ältere Server haben nur "game" gespeichert → game-Port + N berechnen
        if (!port) {
            const plusMatch = portVar.match(/^(.+)_plus_(\d+)$/);
            if (plusMatch) {
                const baseEntry = ports?.[plusMatch[1]];
                const basePort = baseEntry?.external ?? baseEntry?.internal ?? null;
                if (basePort) {
                    port = Number(basePort) + parseInt(plusMatch[2], 10);
                }
            }
        }

        if (!port) {
            return { success: false, error: `Query-Port (${portVar}) nicht in Server-Konfiguration gefunden` };
        }

        try {
            const state = await GameDig.query({
                type: queryConfig.gamedig_type,
                host,
                port,
                maxAttempts: QUERY_MAX_ATTEMPTS,
                socketTimeout: QUERY_TIMEOUT_MS,
                attemptTimeout: QUERY_TIMEOUT_MS,
            });

            return {
                success: true,
                name:       state.name    || null,
                map:        state.map     || null,
                ping:       state.ping    ?? null,
                players:    (state.players || []).map(p => ({
                    name:   p.name || '',
                    score:  p.score ?? null,
                    time:   p.raw?.time ?? p.time ?? null,
                })),
                bots:       (state.bots   || []).length,
                maxPlayers: state.maxplayers ?? null,
                password:   state.password ?? false,
                version:    state.version  || null,
                tags:       state.raw?.tags || [],
                connect:    state.connect  || `${host}:${port}`,
            };

        } catch (err) {
            // GameDig wirft einen Error wenn der Server nicht erreichbar ist
            return {
                success: false,
                error: err.message || 'Server nicht erreichbar',
            };
        }
    }

    /**
     * Parst den ports- und game_data-JSON-String aus dem DB-Ergebnis.
     * Kann direkt mit dem DB-Row-Objekt aus servers.js aufgerufen werden.
     *
     * @param {object} dbRow  - DB-Row mit .ports (string|object) und .game_data (string|object)
     * @returns {{ ports: object, gameData: object }}
     */
    static parseServerData(dbRow) {
        let ports = {};
        let gameData = {};
        try {
            ports    = typeof dbRow.ports     === 'string' ? JSON.parse(dbRow.ports)     : (dbRow.ports     || {});
        } catch (_) { /* ignorieren */ }
        try {
            gameData = typeof dbRow.game_data === 'string' ? JSON.parse(dbRow.game_data) : (dbRow.game_data || {});
        } catch (_) { /* ignorieren */ }
        return { ports, gameData };
    }
}

/**
 * @typedef {object} QueryResult
 * @property {boolean}        success
 * @property {string|null}    [name]
 * @property {string|null}    [map]
 * @property {number|null}    [ping]
 * @property {PlayerInfo[]}   [players]
 * @property {number}         [bots]
 * @property {number|null}    [maxPlayers]
 * @property {boolean}        [password]
 * @property {string|null}    [version]
 * @property {string}         [connect]
 * @property {string}         [error]
 */

/**
 * @typedef {object} PlayerInfo
 * @property {string}      name
 * @property {number|null} score
 * @property {number|null} time
 */

module.exports = QueryService;
