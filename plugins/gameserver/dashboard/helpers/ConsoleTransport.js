/**
 * ConsoleTransport – was passiert eigentlich, wenn jemand ins Konsolenfeld tippt?
 *
 * Der Konsolen-Tab hatte ein Eingabefeld, der RCON-Tab auch, und bei Palworld
 * landeten beide beim selben Ziel: Das Egg reicht stdin per
 * `(while read cmd; do rcon … "$cmd"; done) < /dev/stdin` an ein rcon-CLI im
 * Container weiter. Zwei Wege zum selben Server – nur prüfte einer davon
 * `CommandFilter` (Blacklist, Rate-Limit) und der andere nichts.
 *
 * Die Entscheidung des Betreibers (Konzept 23.3): Der RCON-Tab bleibt, weil
 * Palworld eine strukturelle Sonderstellung hat und ein eigener Tab sie sichtbar
 * macht. Dafür verschwindet die Befehlseingabe dort aus dem Konsolen-Tab, wo
 * stdin ohnehin nur eine Brücke ist. Diese Datei entscheidet, wo „dort" ist.
 *
 * Abgeleitet wird aus vorhandenen Daten – die Addons tragen dafür nichts nach:
 *
 *   | Signal                                          | Bedeutung                    |
 *   |-------------------------------------------------|------------------------------|
 *   | `< /dev/stdin` **und** `rcon` im Startbefehl     | Brücke zu RCON               |
 *   | `startup.stop` ist ein Wort (`quit`, `shutdown`) | Prozess liest stdin selbst   |
 *   | `startup.stop` ist `^C` oder leer                | kein Befehlseingang          |
 *
 * Der Stoppbefehl ist deshalb ein verlässliches Signal: Ein Wort kann nur wirken,
 * wenn der Prozess stdin auch wirklich liest. `^C` heißt, das Panel schickt ein
 * Signal statt eines Befehls – dann gibt es dort nichts einzutippen.
 *
 * Ein Addon darf übersteuern, wenn die Ableitung danebenliegt:
 *
 *     "console": { "stdin": "native" | "bridge_to_rcon" | "none" }
 *
 * @module helpers/ConsoleTransport
 */

'use strict';

/** stdin ist ein echter Befehlseingang – Eingabefeld im Konsolen-Tab bleibt. */
const NATIVE = 'native';
/** stdin ist nur eine Brücke zu RCON – Eingabe gehört in den RCON-Tab. */
const BRIDGE_TO_RCON = 'bridge_to_rcon';
/** Kein Befehlseingang über stdin – der Tab zeigt nur die Ausgabe. */
const NONE = 'none';

const ERLAUBT = new Set([NATIVE, BRIDGE_TO_RCON, NONE]);

/**
 * Sieht der Startbefehl so aus, als reiche er stdin an ein rcon-CLI weiter?
 *
 * Beide Teile müssen zutreffen. `rcon` allein kommt in vielen Startbefehlen vor
 * (etwa als `-rconport`), und `/dev/stdin` allein wäre ein echter Eingang.
 *
 * @param {string} befehl
 * @returns {boolean}
 */
function istRconBruecke(befehl) {
    if (!befehl) return false;
    const liestStdin = /<\s*\/dev\/stdin/.test(befehl);
    const nenntRcon  = /\brcon\b/i.test(befehl);
    return liestStdin && nenntRcon;
}

/**
 * Ist der Stoppbefehl ein Wort, das der Prozess über stdin liest?
 *
 * `^C` ist ein Signal, kein Befehl – geschrieben als Zirkumflex + Buchstabe,
 * seltener als echtes Steuerzeichen. Leer heißt: nichts zu senden.
 *
 * @param {string} stop
 * @returns {boolean}
 */
function istStoppWort(stop) {
    if (!stop) return false;
    const s = String(stop).trim();
    if (!s) return false;
    if (/^\^[a-z]$/i.test(s)) return false;                 // ^C, ^D, …
    if (/^[\u0000-\u001f]+$/.test(s)) return false;      // echtes Steuerzeichen
    return true;
}

/**
 * Bestimmt den stdin-Transport eines Servers.
 *
 * @param {object} [gameData] – aufgelöstes `game_data` des Addons
 * @returns {{stdin: string, quelle: 'addon'|'abgeleitet', begruendung: string}}
 */
function resolveConsoleTransport(gameData) {
    const daten = gameData || {};

    // 1. Ausdrückliche Angabe des Addons schlägt jede Ableitung.
    const gesetzt = daten.console?.stdin;
    if (gesetzt && ERLAUBT.has(gesetzt)) {
        return {
            stdin: gesetzt,
            quelle: 'addon',
            begruendung: `Das Addon legt console.stdin auf "${gesetzt}" fest.`,
        };
    }

    const startup = daten.startup || {};

    // 2. Brücke erkennen, bevor der Stoppbefehl befragt wird: Palworlds `stop`
    //    ist "shutdown 15" und damit ein Wort – ohne diese Reihenfolge käme
    //    fälschlich "native" heraus.
    if (istRconBruecke(String(startup.command || ''))) {
        return {
            stdin: BRIDGE_TO_RCON,
            quelle: 'abgeleitet',
            begruendung: 'Der Startbefehl reicht stdin an ein rcon-CLI im Container weiter.',
        };
    }

    // 3. Ein Stoppbefehl als Wort wirkt nur, wenn der Prozess stdin liest.
    if (istStoppWort(startup.stop)) {
        return {
            stdin: NATIVE,
            quelle: 'abgeleitet',
            begruendung: `Der Stoppbefehl "${String(startup.stop).trim()}" wird über stdin geschickt.`,
        };
    }

    return {
        stdin: NONE,
        quelle: 'abgeleitet',
        begruendung: 'Gestoppt wird per Signal, nicht per Befehl – stdin nimmt nichts entgegen.',
    };
}

/**
 * Darf der Konsolen-Tab ein Eingabefeld zeigen?
 *
 * @param {object} [gameData]
 * @returns {boolean}
 */
function konsoleNimmtBefehle(gameData) {
    return resolveConsoleTransport(gameData).stdin === NATIVE;
}

module.exports = {
    resolveConsoleTransport,
    konsoleNimmtBefehle,
    NATIVE,
    BRIDGE_TO_RCON,
    NONE,
};
