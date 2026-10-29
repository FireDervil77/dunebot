'use strict';

/**
 * Live-Messwerte der Maschinen bestellen — nur solange jemand zusieht.
 *
 * Betreiber 2026-10-29: „3 Sekunden Takt ist ok … und nur senden, wenn jemand
 * die Daten haben möchte." (Baustelle 207, Teil 3.)
 *
 * Zuschauer sind die Browser an `/rootservers/events` (Widget „RootServer" und
 * Detailseite) — im SSEManager mit `source: 'masterserver'`, die Detailseite
 * zusätzlich mit `daemonId`. Für jede Guild mit Zuschauern geht an deren
 * verbundene Daemons `system.messwerte` {sekunden: FRIST_SEK}: sofort, wenn
 * einer dazukommt, danach alle TAKT_MS neu.
 *
 * Abbestellt wird nie. Der Daemon hört von selbst auf, wenn die Frist ohne
 * Erneuerung abläuft (`internal/websocket/hostmesswerte.go`) — ein verlorenes
 * „Aus" kann so nichts offen lassen. Die Frist ist doppelt so lang wie der
 * Takt, damit eine verspätete Erneuerung keine Lücke reißt.
 *
 * Ein Daemon vor dem Befehl (bis 1.0.151) lehnt ab — dann bleibt es beim
 * Herzschlag alle 30 s. Gemeldet einmal je Daemon und Dashboard-Lauf, nicht
 * alle 30 s.
 *
 * @module helpers/Messwertbestellung
 */

const { ServiceManager } = require('dunebot-core');

const TAKT_MS = 30 * 1000;
const FRIST_SEK = 60;
const BEFEHL = 'system.messwerte';

let takt = null;
const abgelehnt = new Set();

/**
 * Welche Daemons einer Guild gerade jemand sehen will.
 *
 * @param {Array<Object>} zuschauer Einträge aus sseManager.getClientInfo()
 * @param {string} guildId
 * @returns {{alle: boolean, daemons: Set<string>}} alle = ein Zuschauer ohne
 *          Filter (Widget); sonst nur die genannten (Detailseiten)
 */
function gewuenscht(zuschauer, guildId) {
    const daemons = new Set();
    let alle = false;
    for (const z of zuschauer) {
        if (z.guildId !== guildId || z.metadata?.source !== 'masterserver') continue;
        if (z.metadata.daemonId) daemons.add(String(z.metadata.daemonId));
        else alle = true;
    }
    return { alle, daemons };
}

/** Bestellung an die verbundenen Daemons einer Guild, die jemand sehen will. */
function bestelleFuer(guildId) {
    if (!ServiceManager.has('sseManager') || !ServiceManager.has('ipmServer')) return;
    const ipmServer = ServiceManager.get('ipmServer');
    const { alle, daemons } = gewuenscht(ServiceManager.get('sseManager').getClientInfo(), guildId);
    if (!alle && daemons.size === 0) return;

    for (const [daemonId, conn] of ipmServer.connections.entries()) {
        if (conn.metadata?.guild_id !== guildId) continue;
        if (!alle && !daemons.has(daemonId)) continue;
        ipmServer.sendCommand(daemonId, BEFEHL, { sekunden: FRIST_SEK }, 10000)
            .then(() => abgelehnt.delete(daemonId))
            .catch(fehler => {
                if (abgelehnt.has(daemonId)) return;
                abgelehnt.add(daemonId);
                ServiceManager.get('Logger').info(
                    `[Masterserver] Daemon ${daemonId} liefert keine Live-Messwerte (${fehler.message}) — `
                    + 'es bleibt beim Herzschlag alle 30 s');
            });
    }
}

/** Eine Runde: jede Guild mit Zuschauern. */
function runde() {
    if (!ServiceManager.has('sseManager')) return;
    const guilds = new Set(ServiceManager.get('sseManager').getClientInfo()
        .filter(z => z.metadata?.source === 'masterserver').map(z => z.guildId));
    for (const guildId of guilds) bestelleFuer(guildId);
}

/**
 * Ein Zuschauer ist dazugekommen: sofort bestellen, den Takt sicherstellen.
 * Aufgerufen von `GET /rootservers/events` nach `addClient`.
 *
 * @param {string} guildId
 */
function zuschauerDa(guildId) {
    if (!takt) {
        takt = setInterval(runde, TAKT_MS);
        takt.unref?.();
    }
    bestelleFuer(guildId);
}

module.exports = { zuschauerDa, gewuenscht, runde, TAKT_MS, FRIST_SEK, BEFEHL };
