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

// ============================================================================
// Pro-Spiel Query-Aufbereitung: Spieltyp-spezifische Post-Processing-Regeln
// ============================================================================
const GAME_PROCESSORS = {
    /**
     * CS2: GOTV-Bot filtern, Tags parsen (Version, VAC, etc.)
     */
    cs2(result, state) {
        // GOTV-Bot aus Spielerliste filtern
        result.players = result.players.filter(p => {
            if (p.name === 'GOTV' || p.name === 'SourceTV') return false;
            // Leere Spieler mit Score=0 und Time=0 sind oft Phantom-Einträge
            if (!p.name && p.score === 0 && (p.time === 0 || p.time == null)) return false;
            return true;
        });
        // Bot-Zählung korrigieren (GOTV ist kein echter Bot)
        const gotvBots = (state.bots || []).filter(b => b.name === 'GOTV' || b.name === 'SourceTV');
        result.bots = Math.max(0, result.bots - gotvBots.length);
        // Tags parsen → extra Felder
        result.extra.vac = (state.raw?.tags || '').includes('secure');
        const versionMatch = (state.raw?.version || '').match(/[\d.]+/);
        if (versionMatch) result.extra.gameVersion = versionMatch[0];
    },

    /**
     * Minecraft: MOTD bereinigen, Spieler-Avatare via Crafthead
     */
    minecraft(result, state) {
        // MOTD bereinigen (Minecraft Farb-Codes §x entfernen)
        if (result.name) {
            result.name = result.name.replace(/§[0-9a-fk-or]/gi, '');
        }
        // Spieler-UUIDs für Avatar-URLs
        result.players = result.players.map(p => ({
            ...p,
            avatar: p.raw?.id ? `https://crafthead.net/avatar/${p.raw.id}/32` : null,
        }));
    },

    /**
     * Valheim: Spieler haben keine Namen über A2S → Platzhalter setzen
     */
    valheim(result) {
        result.players = result.players.map((p, i) => ({
            ...p,
            name: p.name || `Wikinger ${i + 1}`,
        }));
    },

    /**
     * Rust: Tags enthalten viele nützliche Infos
     */
    rust(result, state) {
        const tags = state.raw?.tags || '';
        result.extra.wipeDate = tags.match(/born(\d+)/)?.[1] || null;
        result.extra.pve = tags.includes('pve');
        result.extra.oxide = tags.includes('oxide');
    },

    /**
     * ARK: Spieler-Score = Level
     */
    arkse(result) {
        result.players = result.players.map(p => ({
            ...p,
            level: p.score,
        }));
    },
};

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

        const gameType = queryConfig.gamedig_type;

        try {
            const state = await GameDig.query({
                type: gameType,
                host,
                port,
                maxAttempts: QUERY_MAX_ATTEMPTS,
                socketTimeout: QUERY_TIMEOUT_MS,
                attemptTimeout: QUERY_TIMEOUT_MS,
            });

            const result = {
                success: true,
                gameType,
                name:       state.name    || null,
                map:        state.map     || null,
                ping:       state.ping    ?? null,
                players:    (state.players || []).map(p => ({
                    name:   p.name || '',
                    score:  p.score ?? null,
                    time:   p.raw?.time ?? p.time ?? null,
                    raw:    p.raw || null,
                })),
                bots:       (state.bots   || []).length,
                maxPlayers: state.maxplayers ?? null,
                password:   state.password ?? false,
                version:    state.version  || null,
                tags:       state.raw?.tags || [],
                connect:    state.connect  || `${host}:${port}`,
                // Raw-Daten komplett durchreichen (für Pro-Spiel Aufbereitung im Frontend)
                raw: {
                    rules:      state.raw?.rules   || null,
                    tags:       state.raw?.tags     || null,
                    version:    state.raw?.version  || null,
                    numplayers: state.raw?.numplayers ?? null,
                    numbots:    state.raw?.numbots   ?? null,
                    folder:     state.raw?.folder    || null,
                    game:       state.raw?.game      || null,
                    appId:      state.raw?.appId     ?? null,
                },
                // Extra-Feld für spielspezifische Daten (wird von GAME_PROCESSORS befüllt)
                extra: {},
            };

            // Pro-Spiel Post-Processing anwenden
            const processor = GAME_PROCESSORS[gameType];
            if (processor) {
                processor(result, state);
            }

            return result;

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
