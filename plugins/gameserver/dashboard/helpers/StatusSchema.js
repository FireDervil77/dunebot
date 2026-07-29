/**
 * StatusSchema – löst die Status-Konfiguration eines Addons auf
 *
 * Bisher steckte das Spielwissen fest im Code (`GAME_PROCESSORS` im QueryService):
 * CS2-GOTV-Filter, Minecraft-MOTD-Bereinigung, Rust-Tags, ARK-Level, Valheim-Platzhalter.
 * Jedes neue Spiel brauchte eine Code-Änderung.
 *
 * Ab jetzt beschreibt das Addon selbst, was mit dem Abfrageergebnis passiert –
 * über `game_data.status`. Fehlt der Block (alle Bestandsaddons), wird er zur
 * Laufzeit aus `game_data.query` + `game_data.config.rcon` gebaut und um die
 * eingebauten Vorgaben des jeweiligen Spiels ergänzt. Nach außen ändert sich damit
 * nichts, bis jemand bewusst etwas überschreibt.
 *
 * @module helpers/StatusSchema
 * @author FireBot Team
 */

'use strict';

/**
 * Eingebaute Vorgaben je GameDig-Typ.
 *
 * Das ist exakt das, was vorher in GAME_PROCESSORS stand – nur als Daten statt als
 * Code. Ein Addon kann jeden Block überschreiben, indem es `status.query` selbst setzt.
 */
const BUILTIN = {
    cs2: {
        filters: [
            { fn: 'drop_players_named', args: { names: ['GOTV', 'SourceTV'] } },
            { fn: 'drop_empty_players' },
        ],
        extras: [
            { key: 'bots',        fn: 'count_without_named', args: { names: ['GOTV', 'SourceTV'] } },
            { key: 'vac',         fn: 'tag_contains',        args: { tag: 'secure' } },
            { key: 'gameVersion', fn: 'version_number' },
        ],
    },

    minecraft: {
        transforms: [
            { field: 'name',            fn: 'strip_color_codes' },
            { field: 'players[].avatar', fn: 'crafthead_avatar', args: { from: 'raw.id' } },
        ],
    },

    valheim: {
        // Valheim liefert über A2S keine Spielernamen – Platzhalter statt leerer Zeilen
        transforms: [
            { field: 'players[].name', fn: 'fallback_name', args: { prefix: 'Wikinger' } },
        ],
    },

    rust: {
        extras: [
            { key: 'wipeDate', fn: 'tag_match',    args: { pattern: 'born(\\d+)' } },
            { key: 'pve',      fn: 'tag_contains', args: { tag: 'pve' } },
            { key: 'oxide',    fn: 'tag_contains', args: { tag: 'oxide' } },
        ],
    },

    palworld: {
        // Palworld kennt weder Score noch Spielzeit – die Standard-Spalten blieben
        // deshalb leer. Über die REST-API kommen stattdessen Level, Ping und die
        // Plattform, und genau die gehören in die Liste.
        display: {
            columns: [
                { key: 'name',        label: 'Spieler',   source: 'player.name' },
                { key: 'level',       label: 'Level',     source: 'player.level',       align: 'end' },
                { key: 'ping',        label: 'Ping',      source: 'player.ping',        format: 'ms', align: 'end' },
                { key: 'platform_id', label: 'Plattform', source: 'player.platform_id', format: 'platform' },
            ],
        },
    },

    arkse: {
        transforms: [
            { field: 'players[].level', fn: 'copy_from', args: { from: 'score' } },
        ],
        display: {
            columns: [
                { key: 'name',  label: 'Spieler',   source: 'player.name' },
                { key: 'level', label: 'Level',     source: 'player.level' },
                { key: 'time',  label: 'Spielzeit', source: 'player.time', format: 'duration' },
            ],
        },
    },
};

/**
 * Eingebaute RCON-Status-Abrufe je GameDig-Typ.
 *
 * Nach demselben Muster wie BUILTIN: Das Addon darf über `status.rcon` alles
 * überschreiben, muss aber nichts angeben. Ohne diese Vorgaben müsste jedes
 * Bestandsaddon erst in der Datenbank umgeschrieben werden, bevor überhaupt ein
 * Name erscheint.
 *
 * `command` ist der abzusetzende Befehl, der Rest beschreibt, wie seine Ausgabe
 * zu lesen ist (Formate siehe Daemon: internal/gameserver/rcon/parse.go).
 * Die Named Groups folgen der Go-Schreibweise `(?P<name>…)`.
 */
const BUILTIN_RCON = {
    // Palworld: über die eigene Admin-REST-API statt über RCON.
    //
    // RCON "ShowPlayers" funktioniert auch und liefert CSV (name,playeruid,steamid),
    // aber die REST-API gibt zusätzlich Level, Ping und die Plattform – der
    // Präfix von userId verrät sie (steam_… bzw. gdk_… für Xbox). Das ist die
    // reichhaltigste Spielerliste aller angebundenen Spiele.
    //
    // Port 8212 steht fest und wird bewusst nicht allokiert: Der Daemon erreicht
    // die API über die Container-IP, es muss nichts nach außen offen sein und
    // mehrere Palworld-Server auf einem Node kollidieren nicht.
    //
    // Voraussetzung ist RESTAPIEnabled=True in der PalWorldSettings.ini. Fehlt es,
    // antwortet der Server mit 404 und der Treiber sagt genau das.
    //
    // Zurück auf RCON: protocol/port/command/format/json_path/fields durch
    //   { command: 'ShowPlayers', format: 'regex', skip_lines: 1,
    //     row_regex: '^(?P<name>[^,]*),(?P<uid>[^,]*),(?P<steamid>[^,]*)$' }
    // ersetzen – die Verbindungsangaben aus config.rcon greifen dann wieder.
    palworld: {
        protocol:     'palworld_rest',
        port:         8212,
        password_var: 'ADMIN_PASSWORD',
        command:      '/v1/api/players',
        format:       'json',
        json_path:    '$.players[*]',
        // Feldabbildung nach Abschnitt 15 des Konzepts. location_x/y und vor allem
        // iP fehlen hier bewusst – die IP-Adresse des Spielers ist ein
        // personenbezogenes Datum und wird schon beim Parsen verworfen.
        fields: {
            name:        'name',
            uid:         'playerId',
            platform_id: 'userId',
            ping:        'ping',
            level:       'level',
        },
    },

    // ARK: "ListPlayers" liefert "0. Spielername, 76561198…"
    arkse: {
        command:   'ListPlayers',
        format:    'regex',
        row_regex: '^\\s*\\d+\\.\\s*(?P<name>.+?),\\s*(?P<steamid>\\d+)\\s*$',
    },

    // Source-Titel: "status" hat eine feste Spaltenstruktur, dafür gibt es ein
    // eigenes Format im Daemon.
    cs2: {
        command: 'status',
        format:  'source_status',
    },
};

/** Standard-Spalten der Spielerliste, wenn das Addon nichts anderes sagt */
const DEFAULT_DISPLAY = {
    fields: [
        { key: 'map',     label: 'Map' },
        { key: 'ping',    label: 'Ping',     format: 'ms' },
        { key: 'version', label: 'Version' },
    ],
    columns: [
        { key: 'name',  label: 'Spielername', source: 'player.name' },
        { key: 'score', label: 'Score',       source: 'player.score', align: 'end' },
        { key: 'time',  label: 'Spielzeit',   source: 'player.time', format: 'duration', align: 'end' },
    ],
    badges: [],
};

/** @private */
function asArray(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
}

/**
 * Löst die Status-Konfiguration eines Addons auf.
 *
 * Reihenfolge: Addon-Angaben gewinnen über eingebaute Vorgaben, diese über die
 * Standardwerte. Fehlt `status` ganz, wird aus `query` + `config.rcon` abgeleitet.
 *
 * @param {object} gameData - geparste game_data des Addons
 * @returns {{query: object|null, rcon: object|null, merge: object, display: object}}
 */
function resolveStatusConfig(gameData = {}) {
    const status = gameData.status || {};

    // ── Query-Block (Kompat: game_data.query) ─────────────────────────────
    const queryCfg = status.query || gameData.query || null;
    let query = null;

    if (queryCfg?.gamedig_type) {
        const builtin = BUILTIN[queryCfg.gamedig_type] || {};
        query = {
            gamedig_type: queryCfg.gamedig_type,
            port_var:     queryCfg.port_var || 'game',
            // Eigene Regeln des Addons ersetzen die eingebauten – nicht ergänzen,
            // sonst könnte man eine unerwünschte Vorgabe nie loswerden.
            filters:    asArray(queryCfg.filters    ?? builtin.filters),
            transforms: asArray(queryCfg.transforms ?? builtin.transforms),
            extras:     asArray(queryCfg.extras     ?? builtin.extras),
        };
    }

    // ── RCON-Block (Kompat: game_data.config.rcon) ────────────────────────
    // Die Verbindungsangaben (Protokoll, Port- und Passwort-Variable) stehen bei
    // Bestandsaddons unter config.rcon; der Status-Abruf (Befehl + Parse-Format)
    // kommt aus status.rcon oder – wenn das Addon nichts sagt – aus BUILTIN_RCON.
    const connection  = gameData.config?.rcon || null;
    const builtinRcon = BUILTIN_RCON[query?.gamedig_type] || null;
    const addonRcon   = status.rcon || null;

    let rcon = null;
    if (connection || builtinRcon || addonRcon) {
        rcon = { ...(connection || {}), ...(builtinRcon || {}), ...(addonRcon || {}) };
    }

    // ── Anzeige ───────────────────────────────────────────────────────────
    const builtinDisplay = BUILTIN[query?.gamedig_type]?.display || {};
    const addonDisplay   = status.display || {};
    const display = {
        fields:  addonDisplay.fields  ?? builtinDisplay.fields  ?? DEFAULT_DISPLAY.fields,
        columns: addonDisplay.columns ?? builtinDisplay.columns ?? DEFAULT_DISPLAY.columns,
        badges:  addonDisplay.badges  ?? builtinDisplay.badges  ?? DEFAULT_DISPLAY.badges,
    };

    // ── Merge-Regeln (relevant ab RCON-Spielerlisten) ──────────────────────
    const merge = {
        players:      'rcon_first',
        player_count: 'query_first',
        max_players:  'variable:MAX_PLAYERS',
        ...(status.merge || {}),
    };

    return { query, rcon, merge, display };
}

module.exports = { resolveStatusConfig, BUILTIN, BUILTIN_RCON, DEFAULT_DISPLAY };
