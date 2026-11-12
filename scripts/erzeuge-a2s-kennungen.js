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

const { SPRICHT_A2S, ERBT_ABER_NICHT, sprichtA2S } = require('../plugins/werkbank/dashboard/helpers/A2sProtokolle');

// Jedes GameDig-Protokoll, das von `valve` erbt, muss eingeordnet sein (K259).
// Bis 2026-11-12 nahm dieses Skript nur `protocol === 'valve'` — `sdtd` erbt
// und fehlte lautlos. Ein neuer Erbe bricht hier ab, statt wieder zu fehlen.
const PROTOKOLLE = path.resolve(__dirname, '../node_modules/gamedig/protocols');
const erben = fs.readdirSync(PROTOKOLLE)
    .filter((d) => d.endsWith('.js') && d !== 'valve.js' && d !== 'index.js')
    .filter((d) => /class\s+\w+\s+extends\s+valve\b/i.test(fs.readFileSync(path.join(PROTOKOLLE, d), 'utf8')))
    .map((d) => d.replace(/\.js$/, ''));
if (erben.length === 0) {
    console.error('FEHLER: kein einziges Protokoll erbt von valve — der Aufbau von gamedig/protocols hat sich geändert.');
    process.exit(1);
}
const uneingeordnet = erben.filter((p) => !(p in SPRICHT_A2S) && !(p in ERBT_ABER_NICHT));
const verwaist = [...Object.keys(SPRICHT_A2S), ...Object.keys(ERBT_ABER_NICHT)]
    .filter((p) => p !== 'valve' && !erben.includes(p));
if (uneingeordnet.length || verwaist.length) {
    if (uneingeordnet.length) console.error(`FEHLER: erbt von valve, steht aber in keiner Liste: ${uneingeordnet.join(', ')}`);
    if (verwaist.length) console.error(`FEHLER: steht in einer Liste, erbt aber nicht (mehr) von valve: ${verwaist.join(', ')}`);
    console.error('Einordnen in plugins/werkbank/dashboard/helpers/A2sProtokolle.js, mit Begründung.');
    process.exit(1);
}

const alle = Object.keys(tabelle);
const valve = alle.filter((k) => sprichtA2S(tabelle[k])).sort();

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
// Regel:   GameDig-Protokoll ${Object.keys(SPRICHT_A2S).join(', ')} (plugins/werkbank/dashboard/helpers/A2sProtokolle.js)
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

// gofmt richtet die Spalten aus; ohne es zeigt `git diff` jede Zeile als geändert.
const gofmt = require('child_process').spawnSync('gofmt', ['-w', ZIEL], { encoding: 'utf8' });
if (gofmt.error || gofmt.status !== 0) {
    console.error(`WARNUNG: gofmt lief nicht (${gofmt.error ? gofmt.error.message : gofmt.stderr.trim()}) — von Hand: gofmt -w ${ZIEL}`);
}
console.log(`${valve.length} von ${alle.length} Kennungen sprechen A2S.`);
console.log(`Geschrieben: ${ZIEL}`);
