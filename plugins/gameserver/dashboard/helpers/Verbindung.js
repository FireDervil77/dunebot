'use strict';

/**
 * Steht die Leitung zur Maschine eines Servers? (2026-11-02, F15)
 *
 * Ohne Leitung ist der Zustand eines Gameservers unbekannt, nicht offline: Fällt
 * nur der Daemon aus, läuft das Spiel weiter. `gameservers.status` bleibt deshalb
 * der letzte bekannte Stand, und das hier liegt darüber. Bei der Wartung am
 * 2026-11-02 war 55 eine Viertelstunde weg, und 7 Days stand weiter auf „Läuft".
 *
 * Geschrieben wird `rootserver.verbindung` von der `VerbindungsWache`, gelesen
 * von Liste, Serverseite und Live-Anzeige über diesen Ausschnitt SQL.
 */

/** Für ein SELECT auf `gameservers gs`. */
const SPALTEN = `(SELECT r.verbindung FROM rootserver r WHERE r.id = gs.rootserver_id) AS verbindung,
                 (SELECT r.verbindung_seit FROM rootserver r WHERE r.id = gs.rootserver_id) AS verbindung_seit,
                 gs.last_crash_reason, gs.last_crash_at`;

/** Was die Wache beim Zurückkommen einträgt, siehe `beendet()`. */
const AUSFALL_GRUND = 'Beim Ausfall der Maschine beendet.';

const PILLE = {
    maschine_weg: { text: 'Maschine nicht erreichbar', ton: 'red' },
    daemon_weg:   { text: 'Daemon nicht erreichbar',   ton: 'red' },
    angekuendigt: { text: 'Daemon wird aktualisiert',  ton: 'blue' },
};

/** Die Frist ist um: Über den Server lässt sich nichts mehr sagen. */
function weg(verbindung) {
    return verbindung === 'daemon_weg' || verbindung === 'maschine_weg';
}

/** Überstimmt die Verbindung den Status? Dann steht hier, was die Pille sagt. */
function pille(verbindung) {
    return PILLE[verbindung] || null;
}

function uhrzeit(seit) {
    const d = new Date(seit);
    if (Number.isNaN(d.getTime())) return null;
    const heute = Date.now() - d.getTime() < 24 * 3600 * 1000;
    return d.toLocaleString('de-DE', {
        timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit',
        ...(heute ? {} : { day: '2-digit', month: '2-digit' }),
    });
}

/**
 * Der Satz im Messstreifen, oder null, wenn die Leitung steht.
 *
 * @param {object} server Zeile mit `SPALTEN`
 * @param {string} letzterStand Text des letzten bekannten Status
 * @returns {string|null}
 */
function grund(server, letzterStand) {
    const v = server.verbindung;
    if (!v || v === 'da') return null;
    if (v === 'neu_verbinden') return 'Die Verbindung zur Maschine ist unterbrochen und wird neu aufgebaut.';
    if (v === 'angekuendigt') return 'Der Daemon wird aktualisiert und meldet sich gleich zurück.';
    const seit = server.verbindung_seit ? uhrzeit(server.verbindung_seit) : null;
    return `${PILLE[v].text}${seit ? ` seit ${seit}` : ''} — letzter Stand: ${letzterStand}.`;
}

/**
 * Hat der Server den letzten Ausfall nicht überlebt? Ein neuer Start löst das ab.
 *
 * @param {object} server Zeile mit `SPALTEN`
 * @returns {string|null}
 */
function beendet(server) {
    if (server.last_crash_reason !== AUSFALL_GRUND || !server.last_crash_at) return null;
    const start = server.last_started_at ? new Date(server.last_started_at).getTime() : 0;
    return new Date(server.last_crash_at).getTime() >= start ? AUSFALL_GRUND : null;
}

module.exports = { SPALTEN, AUSFALL_GRUND, weg, pille, grund, beendet };
