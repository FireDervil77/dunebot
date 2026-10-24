#!/usr/bin/env node
/**
 * Werkbank: Eine Datei, die fb-init selbst anlegt, wird gesagt (2026-10-24).
 *
 * ── Anlass ──────────────────────────────────────────────────────────────────
 *
 * Windrose, Prüfdurchlauf 115: Auf leerem Volume gab es `R5/ServerDescription.json`
 * noch nicht — das Spiel schreibt sie sonst beim ersten Start. fb-init legte sie
 * als `{}` an und schrieb nur die Schlüssel des Pakets hinein. Dem Spiel fehlte
 * `Version`; es hielt die Datei für kaputt, ergänzte sie nicht und stürzte ab.
 * Das Protokoll sagte zu jeder Einstellung „✓ angekommen" — und kein Wort davon,
 * dass die Datei von uns stammte.
 *
 * fb-init meldet das längst (`files[].created`, internal/parser/bericht.go), der
 * Daemon reicht die Meldung unverändert durch — gelesen hat es niemand.
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 *
 *   1. Daemon-Seite, aus dem Quelltext: fb-init setzt `created` in `files`, und
 *      der Werkbank-Lauf kopiert die ganze Meldung ins Ereignis. Bricht eins
 *      davon, bliebe die Warnzeile still — und still sieht aus wie „nichts
 *      angelegt".
 *   2. Dashboard-Seite: `nachweisZeilen` nennt jede angelegte Datei, auch ohne
 *      Einstellung im Entwurf (ein reiner config-Eintrag), und schweigt bei
 *      `created: false`.
 *
 *   node scripts/check-angelegte-datei.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ohneKommentare } = require('./lib/quelltext');

const DAEMON = '/home/firedervil/firebot_daemon';

let fehler = 0;
function pruefe(was, tun) {
    try { tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 5).join('\n      ')}`); }
}

console.log('\n1. Daemon reicht `created` durch');

pruefe('fb-init setzt `created` je Datei in der configured-Meldung', () => {
    const go = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'cmd/fb-init/konfiguration.go'), 'utf8'));
    assert.match(go, /"created":\s*bericht\.Angelegt/, '`"created": bericht.Angelegt` fehlt in konfiguration.go');
    assert.match(go, /"files":\s*stempel/, 'die Dateiliste geht nicht als `files` hinaus');
});

pruefe('der Parser setzt Angelegt, wenn er eine fehlende Datei anlegt', () => {
    const go = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/parser/bericht.go'), 'utf8'));
    assert.match(go, /bericht\.Angelegt = true/, 'bericht.go setzt Angelegt nicht mehr');
});

pruefe('der Werkbank-Lauf kopiert die ganze Meldung ins Ereignis', () => {
    const go = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/gameserver/werkbank_start.go'), 'utf8'));
    assert.match(go, /for k, v := range msg\.Payload \{\s*daten\[k\] = v/,
        'werkbank_start.go kopiert msg.Payload nicht mehr vollständig — `files` käme nicht an');
});

console.log('\n2. Dashboard nennt angelegte Dateien');

const { _nachweisZeilen: nachweisZeilen } = require('../plugins/werkbank/dashboard/helpers/Ereignisse');

const nachweis = [{ key: 'password', ziel: 'file', wo: 'R5/ServerDescription.json: ServerDescription_Persistent.Password', zustand: 'angekommen' }];

pruefe('angelegte Datei steht als ⚠-Zeile mit Namen da', () => {
    const z = nachweisZeilen({ nachweis, files: [{ file: 'R5/ServerDescription.json', created: true }] });
    const warn = z.filter(x => x.includes('⚠'));
    assert.strictEqual(warn.length, 1, `erwartet eine Warnzeile, kamen ${warn.length}:\n${z.join('\n')}`);
    assert.match(warn[0], /R5\/ServerDescription\.json gab es nicht/);
    assert.ok(z[1].includes('✓ password'), 'die Einstellungszeile ist verloren gegangen');
});

pruefe('auch ohne Einstellung im Entwurf (nur config-Eintrag)', () => {
    const z = nachweisZeilen({ nachweis: [], files: [{ file: 'R5/ServerDescription.json', created: true }] });
    assert.ok(z.some(x => x.includes('⚠ R5/ServerDescription.json')), z.join('\n'));
});

pruefe('vorhandene Datei (created: false) gibt keine Warnung', () => {
    const z = nachweisZeilen({ nachweis, files: [{ file: 'R5/ServerDescription.json', created: false }] });
    assert.ok(!z.some(x => x.includes('⚠')), z.join('\n'));
});

pruefe('ältere Meldung ohne `files` bricht nichts', () => {
    const z = nachweisZeilen({ nachweis });
    assert.strictEqual(z.length, 2, z.join('\n'));
});

if (fehler) {
    console.log(`\n❌ Angelegte Datei: ${fehler} Prüfung(en) rot`);
    process.exit(1);
}
console.log('\n✅ Angelegte Datei: alles grün');
