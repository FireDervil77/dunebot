#!/usr/bin/env node
/**
 * Erzeugt die A2S-Kennungstabelle für fb-probe aus gamedigs eigener Spieltabelle.
 *
 * Warum erzeugt und nicht getippt: Es sind 134 Kennungen von 356. Eine von Hand
 * gepflegte Liste wäre am Tag ihrer Entstehung richtig und danach nie wieder —
 * und der Fehler wäre lautlos, weil eine fehlende Kennung nicht als Fehler
 * aussieht, sondern als "kann ich nicht". fb-probe würde dann für ein Spiel
 * schweigen, das es längst beantworten könnte.
 *
 * Die Tabelle beantwortet genau eine Frage: Spricht diese gamedig-Kennung A2S?
 * Ports stehen bewusst NICHT darin — die löst das Dashboard auf (E-5) und legt
 * sie fertig in den Auftrag. Eine zweite Portquelle wäre eine zweite Wahrheit.
 *
 * Aufruf:  node scripts/erzeuge-a2s-kennungen.js
 * Ziel:    ../firebot_daemon/internal/probe/kennungen_gen.go
 *
 * @author FireDervil
 */

const fs = require('fs');
const path = require('path');

const ZIEL = path.resolve(__dirname, '../../firebot_daemon/internal/probe/kennungen_gen.go');

const games = require('../node_modules/gamedig/lib/games.js');
const tabelle = games.games || games.default || games;

const alle = Object.keys(tabelle);
const valve = alle.filter((k) => (tabelle[k].options || {}).protocol === 'valve').sort();

if (valve.length === 0) {
    console.error('FEHLER: keine einzige valve-Kennung gefunden.');
    console.error('Das heisst nicht "gamedig hat keine mehr", sondern "der Aufbau der');
    console.error('Tabelle hat sich geändert". Eine leere Datei zu schreiben wäre der');
    console.error('teuerste Ausgang: fb-probe könnte danach gar nichts mehr.');
    process.exit(1);
}

const gamedigFassung = require('../node_modules/gamedig/package.json').version;
const heute = new Date().toISOString().slice(0, 10);

const zeilen = valve.map((k) => `\t${JSON.stringify(k)}: true,`).join('\n');

const inhalt = `package probe

// ERZEUGT — nicht von Hand ändern.
//
// Quelle:  gamedig ${gamedigFassung}, lib/games.js
// Erzeugt: ${heute} durch dunebot_prod/scripts/erzeuge-a2s-kennungen.js
// Umfang:  ${valve.length} von ${alle.length} Kennungen sprechen A2S
//
// Die Tabelle beantwortet eine einzige Frage: Spricht diese gamedig-Kennung
// Source Query (A2S)? Ports stehen absichtlich nicht darin — die löst das
// Dashboard auf (E-5) und legt sie fertig in den Auftrag.
//
// Eine Kennung, die hier FEHLT, ist kein Fehler, sondern eine Aussage:
// fb-probe antwortet "kann ich nicht", die Bereitschaft bleibt bei der
// Portstufe, und das Dashboard liefert die Anzeige über gamedig nach.

// a2sKennungen — gamedig-Kennung → spricht A2S.
var a2sKennungen = map[string]bool{
${zeilen}
}
`;

fs.writeFileSync(ZIEL, inhalt);
console.log(`${valve.length} von ${alle.length} Kennungen sprechen A2S.`);
console.log(`Geschrieben: ${ZIEL}`);
