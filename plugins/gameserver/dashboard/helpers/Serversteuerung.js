'use strict';

/**
 * Was das Gameserver-Plugin anderen Plugins an Steuerung anbietet.
 *
 * Eingetragen in `ServersteuerungRegistry` (SDK) beim Einschalten des Plugins,
 * ausgetragen beim Abschalten. Erster Nutzer: der Zusatz „Streamserver" im
 * Streaming-Plugin (Baustelle 118, `docs/streamer-plugin/17-Streamserver.md`).
 * Der Nutzer `require`t diese Datei nicht - er kennt nur den Vertrag.
 *
 * ── Zwei Zusagen, die hier eingeloest werden ────────────────────────────────
 *
 * 1. **`spieler` ist `null`, wenn die Zahl nicht gilt.** Der StatusPoller fragt
 *    je nach Lage alle 10 s, 60 s oder hoechstens 300 s (`StatusPoller.js`,
 *    `INTERVAL_*`). Eine Zahl, die aelter als `SPIELER_GILT_MS` ist, stammt also
 *    aus einem Poller, der steht - und ein stehender Poller misst nicht. Ebenso
 *    ohne Statuszeile, ohne Zeitpunkt oder mit `online = 0` (Abfrage
 *    gescheitert).
 * 2. **Gestoppt wird ueber `ServerStopp.stoppe`**, den Weg der Stopp-Route. Der
 *    Server wird dafuer genauso geladen wie dort (`gs.*, r.daemon_id`).
 *
 * @module helpers/Serversteuerung
 */

const { ServiceManager } = require('dunebot-core');
const ServerStopp = require('./ServerStopp');

/** Dreimal der laengste Takt des StatusPollers (300 s). */
const SPIELER_GILT_MS = 15 * 60_000;

/** @returns {Object} Datenbankdienst */
const db = () => ServiceManager.get('dbService');

/**
 * Die Spielerzahl, wie sie nach aussen gilt.
 *
 * @param {Object} zeile Zeile mit players_current, queried_at, online
 * @param {number} [jetzt] Zeitpunkt in ms
 * @returns {number|null} Anzahl oder null (unbekannt)
 */
function spielerzahl(zeile, jetzt = Date.now()) {
    if (!zeile || zeile.players_current === null || zeile.players_current === undefined) return null;
    if (zeile.online !== undefined && zeile.online !== null && !Number(zeile.online)) return null;
    if (!zeile.queried_at) return null;

    const abgefragt = new Date(zeile.queried_at).getTime();
    if (!Number.isFinite(abgefragt) || jetzt - abgefragt > SPIELER_GILT_MS) return null;

    const anzahl = Number(zeile.players_current);
    return Number.isInteger(anzahl) && anzahl >= 0 ? anzahl : null;
}

/**
 * Der letzte Start in Millisekunden.
 *
 * `last_started_at` setzen der Startknopf (`routes/servers.js`), der Cronjob
 * (`CronWorker._merkeStart`) und die Meldung des Daemons, dass der Server laeuft
 * (`IPMServer._handleGameserverStatusChanged` - beim Wechsel, nicht bei jeder
 * Abfrage). Ein Nutzer vergleicht den Wert nur auf Gleichheit: Aendert er sich,
 * wurde gestartet.
 *
 * @param {Date|string|null} wert
 * @returns {number|null}
 */
function startzeit(wert) {
    if (!wert) return null;
    const ms = new Date(wert).getTime();
    return Number.isFinite(ms) ? ms : null;
}

/**
 * @param {Object} zeile Zeile aus gameservers + gameserver_status
 * @returns {import('dunebot-sdk/lib/ServersteuerungRegistry').ServerZustand}
 */
function alsZustand(zeile) {
    return {
        id: Number(zeile.id),
        name: zeile.name,
        status: zeile.status,
        spieler: spielerzahl(zeile),
        gestartet_am: startzeit(zeile.last_started_at)
    };
}

const ABFRAGE = `
    SELECT gs.id, gs.name, gs.status, gs.last_started_at,
           st.players_current, st.queried_at, st.online
      FROM gameservers gs
      LEFT JOIN gameserver_status st ON st.server_id = gs.id`;

const anbieter = {
    label: 'Gameserver',

    async server(guildId) {
        const zeilen = await db().query(`${ABFRAGE} WHERE gs.guild_id = ? ORDER BY gs.name ASC`, [guildId]);
        return (zeilen || []).map(alsZustand);
    },

    async zustand(guildId, serverId) {
        const zeilen = await db().query(`${ABFRAGE} WHERE gs.id = ? AND gs.guild_id = ?`, [serverId, guildId]);
        return zeilen && zeilen[0] ? alsZustand(zeilen[0]) : null;
    },

    async stoppen(guildId, serverId, { grund } = {}) {
        const Logger = ServiceManager.get('Logger');

        // Wie `POST /:serverId/stop` - ServerStopp braucht daemon_id und
        // last_status_update, beides steht nur in dieser Form.
        const zeilen = await db().query(
            `SELECT gs.*, r.daemon_id
               FROM gameservers gs
               LEFT JOIN rootserver r ON gs.rootserver_id = r.id
              WHERE gs.id = ? AND gs.guild_id = ?`,
            [serverId, guildId]);
        const server = zeilen && zeilen[0];
        if (!server) return { ok: false, grund: 'Server nicht gefunden' };

        Logger.info(`[Gameserver] Stopp von Server ${server.id} angefordert: ${grund || 'durch ein anderes Plugin'}`);
        const ergebnis = await ServerStopp.stoppe({ server, guildId });
        return { ok: Boolean(ergebnis.ok), grund: ergebnis.grund, eingereiht: ergebnis.eingereiht };
    }
};

module.exports = { anbieter, spielerzahl, startzeit, SPIELER_GILT_MS };
