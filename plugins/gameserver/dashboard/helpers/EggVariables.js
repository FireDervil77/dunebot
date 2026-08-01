/**
 * EggVariables – welche Addon-Variable wirkt, und welche liegt nur herum?
 *
 * Ein Egg bringt seine Variablen als `{{NAME}}`-Platzhalter mit. Eingesetzt
 * werden sie an drei Stellen: im Startbefehl, im Installationsskript und in den
 * Konfigurationsdateien, die das Addon patcht. Eine Variable, die in keiner
 * davon vorkommt, kann man ausfüllen wie man will – es passiert nichts.
 *
 * Genau so ist `WORLD_MODE` auf dem CoreKeeper-Server auf `"true"` gelandet,
 * wo das Spiel `0` oder `1` erwartet: Das Formular lud zum Ausfüllen ein und
 * sagte nicht dazu, was der Wert bewirkt.
 *
 * **Vorgabe des Betreibers (Konzept 23.2): kennzeichnen, nicht ausblenden.**
 * Eine ungenutzte Variable bleibt sichtbar und bekommt einen Hinweis. Wer sie
 * später braucht, soll sie finden können – ein verstecktes Eingabefeld ist kein
 * aufgeräumtes Formular, sondern ein verlorener Schalter.
 *
 * @module helpers/EggVariables
 */

'use strict';

/**
 * Sammelt allen Text, in dem ein `{{NAME}}` wirksam werden kann.
 *
 * Bewusst großzügig: Lieber eine Variable zu viel als „verwendet" melden als
 * eine fälschlich als tot. Ein falsches „wird nicht verwendet" würde jemanden
 * dazu bringen, eine wirksame Einstellung zu ignorieren.
 *
 * @param {object} gameData
 * @returns {string}
 */
function sammleVorlagen(gameData) {
    const daten = gameData || {};
    const teile = [];

    const startup = daten.startup || {};
    teile.push(String(startup.command || ''));
    teile.push(String(startup.stop || ''));
    teile.push(String(startup.done || ''));

    // Installationsskript – Pterodactyl legt es unter scripts.installation ab.
    const install = daten.scripts?.installation?.script || daten.install_script || '';
    teile.push(String(install));

    // Konfigurationsdateien, die das Addon vor dem Start patcht.
    const dateien = daten.config?.files;
    if (dateien) teile.push(JSON.stringify(dateien));

    // Docker-Images können Platzhalter tragen (selten, aber möglich).
    if (daten.docker_images) teile.push(JSON.stringify(daten.docker_images));

    return teile.join('\n');
}

/**
 * Variablen, die nicht das Egg auswertet, sondern die Plattform selbst.
 *
 * Sie tauchen in keiner Vorlage auf und wären nach reiner Textsuche „tot" –
 * gelesen werden sie vom Daemon (Aktualisierung, SteamCMD-Anmeldung) oder von
 * der Startlogik. Ein „wird nicht verwendet" an dieser Stelle wäre schlicht
 * falsch und würde jemanden dazu bringen, eine wirksame Einstellung zu ignorieren.
 */
const PLATTFORM_VARIABLEN = new Set([
    'AUTO_UPDATE',      // Daemon aktualisiert beim Start
    'SRCDS_APPID',      // SteamCMD-App, die der Daemon installiert
    'SRCDS_BETAID',
    'SRCDS_BETAPASS',
    'STEAM_USER',
    'STEAM_PASS',
    'VALIDATE',
    'LD_LIBRARY_PATH',  // Laufzeitumgebung des Containers
]);

/**
 * Wird die Variable irgendwo eingesetzt?
 *
 * Eggs kennen drei Schreibweisen, und sie mischen sie munter: Pterodactyl setzt
 * `{{NAME}}` vor dem Start ein, das Installationsskript und der Startbefehl sind
 * aber Shell und greifen mit `$NAME` oder `${NAME}` zu. Palworld benutzt in einer
 * einzigen Zeile beides – `-servername="{{SERVER_NAME}}"` neben
 * `$(if [ -n "$SERVER_PASSWORD" ]; …)`. Wer nur nach `{{…}}` sucht, hält den
 * halben Startbefehl für tot.
 *
 * @param {string} vorlagen
 * @param {string} name
 * @returns {boolean}
 */
function wirdVerwendet(vorlagen, name) {
    if (!name) return false;
    if (PLATTFORM_VARIABLEN.has(name)) return true;

    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // {{ NAME }} – Leerraum innerhalb der Klammern kommt vor
    if (new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`).test(vorlagen)) return true;
    // ${NAME}
    if (new RegExp(`\\$\\{\\s*${escaped}\\s*[}:]`).test(vorlagen)) return true;
    // $NAME – Wortgrenze dahinter, damit $SERVER nicht auf $SERVER_PASSWORD passt
    if (new RegExp(`\\$${escaped}\\b`).test(vorlagen)) return true;

    return false;
}

/**
 * Beurteilt alle Variablen eines Servers.
 *
 * Aufgeführt wird die Vereinigung aus dem, was das Addon deklariert, und dem,
 * was tatsächlich am Server gespeichert ist – sonst verschwände ein von Hand
 * gesetzter Wert aus der Liste, nur weil das Addon ihn nicht kennt.
 *
 * @param {object} gameData – `game_data` bzw. `frozen_game_data` des Servers
 * @param {object} envVars  – gespeicherte `env_variables` des Servers
 * @returns {Array<{name: string, wert: string, verwendet: boolean, imAddon: boolean,
 *                  beschreibung: string, vorgabe: string}>}
 */
function beurteileVariablen(gameData, envVars = {}) {
    const daten = gameData || {};
    const vorlagen = sammleVorlagen(daten);

    const deklariert = new Map();
    for (const v of (Array.isArray(daten.variables) ? daten.variables : [])) {
        if (v?.env_variable) deklariert.set(String(v.env_variable), v);
    }

    const namen = new Set([...deklariert.keys(), ...Object.keys(envVars || {})]);

    return [...namen].sort().map(name => {
        const def = deklariert.get(name);
        return {
            name,
            wert: envVars?.[name] ?? '',
            verwendet: wirdVerwendet(vorlagen, name),
            imAddon: Boolean(def),
            beschreibung: def?.description || '',
            vorgabe: def?.default_value ?? '',
        };
    });
}

/**
 * Nur die Namen, die nirgends eingesetzt werden.
 *
 * @param {object} gameData
 * @param {object} envVars
 * @returns {string[]}
 */
function unbenutzteVariablen(gameData, envVars = {}) {
    return beurteileVariablen(gameData, envVars)
        .filter(v => !v.verwendet)
        .map(v => v.name);
}

module.exports = {
    beurteileVariablen,
    unbenutzteVariablen,
    wirdVerwendet,
    sammleVorlagen,
};
