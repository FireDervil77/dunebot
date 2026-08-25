'use strict';

/**
 * Streaming - der hausinterne Signalweg.
 *
 * Ein einziger EventEmitter, damit der **Kern** sagen kann "hier hat sich
 * etwas geaendert", ohne wissen zu muessen, wer zuhoert. Zuhoerer ist heute
 * nur `ausgabe/strom.js` (schiebt es in offene Browser).
 *
 * **Warum ueberhaupt ein Emitter und kein direkter Aufruf?** Weil die
 * Schichtenregel sonst bricht: `kern/` entscheidet und schreibt, `ausgabe/`
 * redet nach draussen. Ein `sseManager.broadcast(...)` in `takt.js` waere
 * genau die Vermischung, die `scripts/check-streaming-schichten.js` verhindern
 * soll - und der Kern liesse sich nicht mehr ohne Browser durchspielen.
 * Nachgesehen am 2026-08-26, ob es im Projekt schon einen allgemeinen Bus
 * gibt: `IPMEventRouter` ist der Draht zum Daemon, `SSEManager` selbst ist ein
 * EventEmitter, aber beides ist keine Anlaufstelle fuer Plugins. Also ein
 * eigener, kleiner - im selben Vorgang, ohne Netz dazwischen.
 *
 * **Ein Signal ist ein Klopfen, keine Nachricht.** Es traegt absichtlich keine
 * Inhalte: Wer es empfaengt, holt sich den Stand selbst und laeuft dabei durch
 * dieselbe Rechtepruefung wie jeder andere Zugriff. Haenge hier nie Daten an,
 * die nicht jeder sehen darf, der irgendeine Guild offen hat.
 *
 * @module streaming/shared/signale
 */

const { EventEmitter } = require('events');

const signale = new EventEmitter();

/**
 * Die Vorgabe ist 10. Ein Zuhoerer je Streamer waere schnell darueber und
 * Node warnt dann von "moeglichem Speicherleck" - hier ist es keins, es sind
 * feste, wenige Anmeldungen beim Start.
 */
signale.setMaxListeners(25);

/**
 * Name des einzigen Signals.
 *
 * Bewusst eine Konstante: ein vertippter Ereignisname wirft nicht, er wird nur
 * nie gehoert. Das ist die Sorte Fehler, die man erst drei Wochen spaeter
 * bemerkt ([[nachsehen-statt-raten]]).
 */
const ZUSTAND = 'zustand';

/**
 * Melden, dass sich am sichtbaren Zustand etwas geaendert hat.
 *
 * Darf nie werfen und nie bremsen: Der Aufrufer ist mitten in der Verarbeitung
 * eines echten Ereignisses. Ein kaputter Zuhoerer darf die Ankuendigung nicht
 * mitreissen.
 *
 * @param {Object} was Beschreibung
 * @param {number} [was.streamerId] Betroffener Streamer - bestimmt die Guilds
 * @param {string} [was.guildId] Direkt betroffene Guild (wenn schon bekannt)
 * @param {string} was.grund Kurzwort fuers Protokoll, z. B. 'ging_live'
 */
function melden(was) {
    try {
        signale.emit(ZUSTAND, was);
    } catch {
        // Absichtlich stumm und ohne Logger: Diese Funktion wird aus dem
        // heissen Pfad gerufen. Faellt das Melden aus, bleibt die Seite alt -
        // das ist ein Schoenheitsfehler, kein Betriebsfehler.
    }
}

module.exports = { signale, melden, ZUSTAND };
