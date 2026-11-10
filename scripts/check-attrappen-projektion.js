#!/usr/bin/env node
/**
 * Attrappen liefern nur die erfragten Spalten (K108, 2026-11-09).
 *
 * Lässt jeden Wächter mit einer dbService-Attrappe einmal mit echter
 * Spaltenprojektion laufen (scripts/lib/projektions-sonde.js). Kippt einer
 * dadurch von grün auf rot, liest der geprüfte Code eine Spalte, die sein
 * SELECT nicht nennt — im Test grün, in Produktion `undefined`. Wächter, die
 * auch ohne Projektion rot sind, zählen nicht (die melden sich selbst).
 *
 * Dauer gemessen: gut zwei Minuten für 81 Wächter.
 *
 *   node scripts/check-attrappen-projektion.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ohneKommentare } = require('./lib/quelltext');

const SKRIPTE = __dirname;
const SONDE = path.join(SKRIPTE, 'lib', 'projektions-sonde.js');
const selbst = path.basename(__filename);

const waechter = fs.readdirSync(SKRIPTE)
    .filter(n => n.startsWith('check-') && n.endsWith('.js') && n !== selbst)
    .filter(n => /register\(\s*['"]dbService['"]/.test(ohneKommentare(fs.readFileSync(path.join(SKRIPTE, n), 'utf8'))));

const lauf = (n, projiziert) => spawnSync(process.execPath, [path.join(SKRIPTE, n)], {
    env: { ...process.env, NODE_OPTIONS: `-r ${SONDE}`, SONDE_PROJIZIEREN: projiziert ? '1' : '0', SONDE_DATEI: '' },
    encoding: 'utf8', timeout: 180000,
}).status;

if (waechter.length < 50) {
    console.log(`❌ Nur ${waechter.length} Wächter mit dbService-Attrappe gefunden — die Suche misst nicht mehr.`);
    process.exit(1);
}

const gekippt = [];
for (const n of waechter) {
    if (lauf(n, true) === 0) continue;
    if (lauf(n, false) !== 0) continue;      // auch ohne Projektion rot: meldet sich selbst
    gekippt.push(n);
}
console.log(`\n${waechter.length} Wächter mit dbService-Attrappe, je einmal mit echter Spaltenprojektion.`);
if (gekippt.length) {
    console.log(`❌ Kippen von grün auf rot (der Code liest Spalten, die sein SELECT nicht nennt):\n  - ${gekippt.join('\n  - ')}`);
    console.log('   Nachsehen: SONDE_PROJIZIEREN=1 NODE_OPTIONS="-r scripts/lib/projektions-sonde.js" node scripts/<wächter>');
    process.exit(1);
}
console.log('✅ Keiner kippt: Kein geprüfter Code liest eine Spalte, die er nicht abfragt.');
process.exit(0);
