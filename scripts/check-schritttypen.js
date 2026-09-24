#!/usr/bin/env node
/**
 * Hat jeder Schritttyp des Schemas einen Weg durch den Daemon?
 *
 * ── Warum es diesen Waechter gibt (Werkbank W-12, 2026-09-24) ───────────────
 *
 * Das Schema kannte sieben Schritttypen, der Daemon fuehrte zwei aus. (`chown`
 * ist am 2026-09-24 aus dem Schema gegangen: Schritte laufen als
 * Container-Benutzer, der Typ hatte keine Aufgabe — Betreiber: „chown aus dem
 * schritt entfernen.")
 * Aufgefallen ist das nicht als Fehler, sondern als Messung am 2026-09-23 — ein
 * Paket mit `download` waere mit „dieser Schritttyp wird noch nicht ausgefuehrt"
 * abgewiesen worden. Ehrlich, aber niemand hat die Luecke gezaehlt.
 *
 * Ein Typ ist erst ausfuehrbar, wenn er an ZWEI Stellen steht:
 *
 *   internal/pkgspec/install.go       ein `case` in Install.Pruefe
 *   internal/gameserver/rezept/rezept.go   ein `case` in baueAuftrag
 *
 * Fehlt der erste, weist Pruefe ihn ab. Fehlt der zweite, liefe das Rezept an
 * und scheiterte mitten drin („geprueft, aber nicht gebaut") — nach einem
 * 30-GB-Download im ersten Schritt.
 *
 * ── Die Ausnahmen haben eine Bedingung ──────────────────────────────────────
 *
 * Was noch nicht gebaut ist, steht in AUSSTEHEND — mit dem Grund. Ist ein Typ
 * dort eingetragen UND inzwischen gebaut, ist das ebenfalls ein Befund: Die
 * Liste soll nicht stillschweigend veralten (kein Dauerrot, aber auch kein
 * Dauergruen durch vergessene Ausnahmen).
 *
 *   node scripts/check-schritttypen.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { ohneKommentare } = require('./lib/quelltext');

const DAEMON = '/home/firedervil/firebot_daemon';

const AUSSTEHEND = {
    download: 'W-12 Schritt 2 — offen ist zuerst die Vertrauensfrage (Pruefsumme statt Herkunftsliste)',
    extract:  'W-12 Schritt 3 — setzt auf download auf',
    template: 'W-12 Schritt 4 — dieselbe Platzhalterregel wie start.args und config[]',
};

let fehler = 0;
const pruefe = (ok, was, zusatz = '') => {
    console.log(`  ${ok ? '✅' : '❌'} ${was}${zusatz ? '\n       ' + zusatz : ''}`);
    if (!ok) fehler++;
};

const schema = JSON.parse(fs.readFileSync(
    path.join(__dirname, '../packages/fbpkg/schema/fbpkg-v1.schema.json'), 'utf8'));
const typen = schema.definitions?.installStep?.properties?.type?.enum || [];

const install = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/pkgspec/install.go'), 'utf8'));
const rezept = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/gameserver/rezept/rezept.go'), 'utf8'));

// Konstante → Wert, z. B. SchrittMkdir → "mkdir"
const konst = {};
for (const m of install.matchAll(/\b(Schritt\w+)\s*=\s*"([a-z]+)"/g)) konst[m[1]] = m[2];

/** Die `case`-Werte im Rumpf einer Funktion, als Typnamen. */
function faelle(quelle, kopf) {
    const start = quelle.search(kopf);
    if (start < 0) return null;
    // bis zur naechsten Funktion auf oberster Ebene
    const rest = quelle.slice(start + 1);
    const ende = rest.search(/\nfunc /);
    const rumpf = ende < 0 ? rest : rest.slice(0, ende);
    return new Set([...rumpf.matchAll(/case\s+pkgspec\.(Schritt\w+)|case\s+(Schritt\w+)/g)]
        .map(m => konst[m[1] || m[2]]).filter(Boolean));
}

const inPruefe = faelle(install, /func \(i \*Install\) Pruefe\(\)/);
const inAuftrag = faelle(rezept, /func baueAuftrag\(/);

console.log(`\n▸ Schema: ${typen.join(', ') || '—'}`);
pruefe(typen.length > 0, 'das Schema nennt Schritttypen');
pruefe(inPruefe !== null, 'Install.Pruefe gefunden', 'internal/pkgspec/install.go');
pruefe(inAuftrag !== null, 'baueAuftrag gefunden', 'internal/gameserver/rezept/rezept.go');
if (!inPruefe || !inAuftrag) { console.log(`\n${fehler} Befund(e).\n`); process.exit(1); }

console.log('\n▸ Jeder Typ hat beide Zweige — oder steht mit Grund in AUSSTEHEND');
for (const typ of typen) {
    const p = inPruefe.has(typ), a = inAuftrag.has(typ);
    if (AUSSTEHEND[typ]) {
        pruefe(!p && !a, `${typ}: ausstehend — ${AUSSTEHEND[typ]}`,
            (p || a) ? `ist inzwischen ${p ? 'in Pruefe' : ''}${p && a ? ' und ' : ''}${a ? 'in baueAuftrag' : ''} — aus AUSSTEHEND nehmen` : '');
        continue;
    }
    pruefe(p && a, `${typ}: Pruefe ${p ? '✓' : '✗'} · baueAuftrag ${a ? '✓' : '✗'}`,
        p && !a ? 'geprueft, aber nicht gebaut — das Rezept liefe an und scheiterte mittendrin'
      : !p && a ? 'gebaut, aber Pruefe weist ihn ab — kein Paket kommt je dorthin'
      : !p && !a ? 'weder noch — in AUSSTEHEND eintragen (mit Grund) oder bauen' : '');
}

console.log('\n▸ Der Daemon kennt keinen Typ, den das Schema nicht hat');
for (const typ of new Set([...inPruefe, ...inAuftrag])) {
    pruefe(typen.includes(typ), `${typ} steht im Schema`);
}

console.log(fehler ? `\n${fehler} Befund(e).\n` : '\nAlles gruen.\n');
process.exit(fehler ? 1 : 0);
