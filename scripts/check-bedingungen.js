#!/usr/bin/env node
/**
 * Bedingungen: Dashboard und Daemon werten `when` gleich aus (Stufe 9, 2026-10-25).
 *
 * Der Daemon entscheidet mit pkgspec.gilt, welcher Fall der Bereitschaft gilt;
 * das Dashboard braucht dieselbe Regel für die Verbindungsangabe, für „wirkt
 * nur, wenn …" und für die Vorschau der Leiter (helpers/Bedingung.js). Zwei
 * Auswertungen derselben Regel laufen auseinander, sobald eine geändert wird.
 *
 * Deshalb liest dieser Wächter DIESELBE Tabelle wie der Go-Test
 * (firebot_daemon/internal/pkgspec/testdata/bedingungen.json) — er schreibt sie
 * nicht ab. Ändert jemand gilt im Daemon und die Tabelle, wird hier rot, bis
 * die Nachbildung folgt.
 *
 *   node scripts/check-bedingungen.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { gilt, waehleFall } = require('../plugins/gameserver/dashboard/helpers/Bedingung');

const TABELLE = '/home/firedervil/firebot_daemon/internal/pkgspec/testdata/bedingungen.json';

let fehler = 0;
const pruefe = (ok, was, zusatz = '') => {
    if (!ok) { fehler++; console.log(`  ✗ ${was}${zusatz ? '\n      ' + zusatz : ''}`); }
};

let tab;
try {
    tab = JSON.parse(fs.readFileSync(TABELLE, 'utf8'));
} catch (e) {
    console.error(`FEHLER: Tabelle nicht lesbar (${TABELLE}): ${e.message} — der Wächter mässe nichts.`);
    process.exit(1);
}
const faelle = tab.faelle || [];
if (faelle.length < 10) {
    console.error(`FEHLER: Tabelle zu kurz (${faelle.length}) — der Wächter mässe nichts.`);
    process.exit(1);
}

console.log(`\n▸ ${faelle.length} Zeilen aus ${path.basename(TABELLE)}`);
for (const f of faelle) {
    const ist = gilt(f.when, f.wert);
    pruefe(ist === f.gilt, `gilt(${JSON.stringify(f.when)}, ${JSON.stringify(f.wert)}) = ${ist}, Tabelle sagt ${f.gilt}`);
}

console.log('\n▸ Fallwahl wie pkgspec.ReadyWhen.Fuer');
const windrose = [{ from: 'setting:use_direct_connection', when: 'false' }];
pruefe(waehleFall(windrose, { use_direct_connection: '0' }) === 0, 'P2P (0) → Fall 0');
pruefe(waehleFall(windrose, { use_direct_connection: '1' }) === -1, 'Direkt (1) → Grundfall');
pruefe(waehleFall(windrose, {}) === 0, 'ohne Wert → Fall 0 (leer gilt als false, wie im Daemon)');
pruefe(waehleFall([], { x: '1' }) === -1, 'keine Fälle → Grundfall');
pruefe(waehleFall([{ from: 'setting:a', when: '=x' }, { from: 'setting:a', when: '!=y' }], { a: 'x' }) === 0,
    'erster passender Fall gewinnt');

if (fehler) {
    console.log(`\n❌ Bedingungen: ${fehler} Abweichung(en)`);
    process.exit(1);
}
console.log('\n✅ Bedingungen: Dashboard wertet aus wie der Daemon');
