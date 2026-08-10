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

const { GameDig, games: GAMEDIG_KATALOG } = require('gamedig');

/** Timeout für eine einzelne Query in ms */
const QUERY_TIMEOUT_MS = 5000;
/** Maximale Verbindungsversuche */
const QUERY_MAX_ATTEMPTS = 2;

/**
 * GameDig hat Spielkennungen umbenannt und führt die alten nur noch als
 * `extra.old_id`. `arkse` heisst dort seit Fassung 5 `ase` — die Abfrage
 * scheiterte deshalb mit „arkse nicht gefunden", obwohl am Server nichts falsch
 * war.
 *
 * Die Zuordnung wird aus GameDigs eigenem Katalog gelesen, nicht von Hand
 * gepflegt: sonst steht hier beim nächsten Umbenennen wieder eine veraltete
 * Liste. Schlägt das Lesen fehl, bleibt der Typ unverändert — dann meldet
 * GameDig den Fehler wie bisher, statt dass die Abfrage ganz ausfällt.
 *
 * Wichtig: die Umschreibung muss hier passieren und nicht nur im Addon-Datensatz.
 * Laufende Server tragen eine eingefrorene Kopie des Addons (`frozen_game_data`);
 * ein reparierter Marktplatz-Eintrag erreicht sie nicht.
 */
const ALTE_KENNUNGEN = (() => {
    try {
        const karte = new Map();
        for (const [id, spiel] of Object.entries(GAMEDIG_KATALOG || {})) {
            const alt = spiel?.extra?.old_id;
            if (!alt) continue;
            for (const a of (Array.isArray(alt) ? alt : [alt])) karte.set(a, id);
        }
        return karte;
    } catch (_) {
        return new Map();
    }
})();

/**
 * Übersetzt eine veraltete GameDig-Kennung in die heutige.
 * @param {string} typ
 * @returns {{typ: string, umgeschrieben: string|null}}
 */
function heutigerTyp(typ) {
    const heute = ALTE_KENNUNGEN.get(typ);
    return heute ? { typ: heute, umgeschrieben: typ } : { typ, umgeschrieben: null };
}

const { resolveStatusConfig } = require('./StatusSchema');
const { applyQueryRules } = require('./StatusTransforms');

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
        // Regeln kommen aus dem Addon (game_data.status.query), mit Rückfall auf
        // game_data.query plus den eingebauten Vorgaben des jeweiligen Spiels.
        const { query: queryConfig } = resolveStatusConfig(gameData || {});

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

        const { typ: gameType, umgeschrieben } = heutigerTyp(queryConfig.gamedig_type);
        if (umgeschrieben) {
            // Nur zur Kenntnis, kein Fehler: die Abfrage läuft danach normal.
            // Der Hinweis zeigt, welches Addon noch die alte Kennung trägt.
            require('dunebot-core').ServiceManager.get('Logger')
                ?.debug?.(`[QueryService] GameDig-Kennung "${umgeschrieben}" ist veraltet, benutze "${gameType}"`);
        }

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
                // Extra-Feld für spielspezifische Daten (wird von den Regeln befüllt)
                extra: {},
            };

            // Deklarative Aufbereitung: Filter, Transformationen, Extras
            applyQueryRules(result, state, queryConfig);

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
