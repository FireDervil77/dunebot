#!/usr/bin/env node
/**
 * Rechnen Dashboard und Daemon dieselbe Unterschrift aus?
 *
 * ── Warum es diese Pruefung braucht (Baustelle 106, 2026-09-08) ─────────────
 *
 * Die Adresse zum Herunterladen einer Sicherung wird an ZWEI Stellen gerechnet:
 * hier im Dashboard (`plugins/gameserver/dashboard/routes/servers.js`, Node) und
 * im Daemon (`internal/sicherungsabruf/abruf.go`, Go). Beide muessen denselben
 * Text unterschreiben.
 *
 * **Wer den Text aendert, merkt es sonst nie hier.** Ein Doppelpunkt statt des
 * Zeilenumbruchs, eine andere Reihenfolge - der Code laeuft weiter, die Tests
 * beider Seiten bleiben gruen, und erst der Betreiber sieht beim Klicken ein
 * 404, das nach einem kaputten Daemon aussieht.
 *
 * Deshalb ein fester Pruefvektor, den beide Seiten kennen. Derselbe Wert steht
 * in `TestPruefvektor` im Daemon. Aendert sich die Rechnung absichtlich,
 * muessen beide Zahlen von Hand nachgezogen werden - genau das soll es sein.
 *
 *   node scripts/check-sicherungsabruf.js
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ERWARTET = '81f4a5a331a677acf4923ac143e40311b1d67682474500dd61bfbd0943d15248';
const SCHLUESSEL = 'test-api-key';
const SERVER = '185';
const DATEI = 'Fires_Valheim_bude_2026-09-07_06-32.tar.gz';
const BIS = 1789000000;

let fehler = 0;
const pruefe = (ok, was, zusatz = '') => {
    console.log(`  ${ok ? '✅' : '❌'} ${was}${zusatz ? '\n       ' + zusatz : ''}`);
    if (!ok) fehler++;
};

console.log('\n▸ Die Unterschrift der Abruf-Adresse');

const hier = crypto.createHmac('sha256', SCHLUESSEL)
    .update(`${SERVER}\n${DATEI}\n${BIS}`)
    .digest('hex');

pruefe(hier === ERWARTET, 'Dashboard rechnet den Pruefvektor richtig',
    hier === ERWARTET ? hier : `hier: ${hier}\n       erwartet: ${ERWARTET}`);

// ── Und rechnet die Route wirklich so? ──────────────────────────────────────
//
// Der Vektor oben prueft eine Kopie der Rechnung, nicht die Rechnung selbst.
// Deshalb zusaetzlich ein Blick in die Route: Steht dort noch derselbe Text?
// Grob, aber es faengt genau den Fall ab, den dieser Waechter meint.
const routenDatei = path.join(__dirname, '../plugins/gameserver/dashboard/routes/servers.js');
const quelle = fs.readFileSync(routenDatei, 'utf8');

pruefe(/createHmac\('sha256',\s*zeile\.api_key\)/.test(quelle),
    'Die Route unterschreibt mit dem api_key der Maschine');

pruefe(/\.update\(`\$\{serverId\}\\n\$\{datei\}\\n\$\{bis\}`\)/.test(quelle),
    'Die Route unterschreibt Kennung, Datei und Frist mit Zeilenumbruch dazwischen',
    'Ohne die Umbrueche waeren ("12","3x.tar.gz") und ("123","x.tar.gz") dieselbe Adresse');

// Die Frist: lang genug zum Klicken, kurz genug, dass die Adresse in der
// Browser-Geschichte nichts mehr wert ist.
const frist = /\+\s*(\d+);\s*$/m.exec(quelle.split('const bis =')[1] || '');
pruefe(Boolean(frist) && Number(frist[1]) <= 900,
    'Die Frist ist hoechstens 15 Minuten',
    frist ? `${frist[1]} Sekunden` : 'keine Frist gefunden');

console.log(fehler === 0
    ? '\n✅ Beide Seiten rechnen dieselbe Unterschrift\n'
    : `\n❌ ${fehler} Abweichung(en) — ausgestellte Adressen wuerden abgewiesen\n`);
process.exit(fehler === 0 ? 0 : 1);
