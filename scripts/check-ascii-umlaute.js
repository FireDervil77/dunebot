#!/usr/bin/env node
/**
 * Sichtbare Texte schreiben Umlaute als Umlaute (2026-10-28).
 *
 * Das Musik-Plugin schrieb „Gerade laeuft nichts", „Uebersprungen:",
 * „Ungueltige ID" — 73 Zeilen in Discord-Antworten, Fehlermeldungen des
 * Dashboards und den Namen der Rechte. In den Streaming-Musikbefehlen war das
 * am 2026-09-19 behoben, im Musik-Plugin gezählt erst heute.
 *
 * Geprüft wird jede Zeichenkette mit Leerzeichen (also ein Text, kein Schlüssel
 * wie 'ueberspringen' oder '/lautstaerke'), ohne `${…}`, ohne Kommentar- und
 * Logzeilen, in JSON nur `name`/`description`. Migrationen bleiben draußen:
 * Eine ausgeführte Migration ändern heißt eine Prüfsummen-Warnung bei jedem
 * Start (Baustelle 70).
 *
 * Die Wörter stehen fest in der Liste — „ue" allein träfe „neue" und
 * „Steuerung". Ein neues Ersatzwort fällt also erst auf, wenn es hier steht.
 *
 *   node scripts/check-ascii-umlaute.js [ordner …]   (Vorgabe: ORDNER unten)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const WURZEL = path.join(__dirname, '..');

const ORDNER = ['plugins/music'];

const WOERTER = ['laeuft', 'Laeuft', 'Ungueltige', 'ungueltig', 'Lautstaerke', 'uebersprungen', 'Uebersprungen', 'loeschen',
    'Loeschen', 'geloescht', 'gezaehlt', 'geaendert', 'Eintraege', 'Gewuenscht', 'gewuenscht', 'dafuer', 'Dafuer', 'fuer', 'Fuer',
    'Naechster', 'Naechstes', 'naechsten', 'naechste', 'waehle', 'Waehle', 'faengt', 'koennte', 'koennen', 'angehaengt', 'Ueber',
    'ueber', 'uebersteuern', 'Knoepfe', 'moeglich', 'Moeglich', 'aendert', 'aendern', 'Hoehere', 'aufloesen', 'zurueckgegeben',
    'eigenstaendige', 'liess', 'liesse', 'oeffnen', 'hinzufuegen', 'ueberspringen', 'verfuegbar', 'Groesse', 'groesser', 'zurueck',
    'Zurueck', 'waere', 'wuerde', 'muessen', 'spaeter', 'Spaeter', 'gueltig', 'Schluessel', 'Pruefung', 'pruefen'];
const WORT = new RegExp(`(?:\\b|(?<=\\\\n))(${WOERTER.join('|')})\\b`);
const LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

function* dateien(ordner) {
    for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
        const p = path.join(ordner, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'migrations') yield* dateien(p); }
        else if (/\.(js|json)$/.test(e.name)) yield p;
    }
}

function funde(datei) {
    const json = datei.endsWith('.json');
    const treffer = [];
    fs.readFileSync(datei, 'utf8').split('\n').forEach((zeile, i) => {
        const s = zeile.trim();
        if (/^(\/\/|\*|\/\*)/.test(s) || zeile.includes('Logger') || zeile.includes('console.')) return;
        if (json && !/^\s*"(name|description)"\s*:/.test(zeile)) return;
        for (const lit of zeile.match(LITERAL) || []) {
            if (!/\s/.test(lit.slice(1, -1))) continue;
            const text = lit.replace(/\$\{[^}]*\}/g, '');
            const m = text.match(WORT);
            if (m) treffer.push(`${path.relative(WURZEL, datei)}:${i + 1}  „${m[1]}"  ${s.slice(0, 90)}`);
        }
    });
    return treffer;
}

const ziele = process.argv.slice(2).length ? process.argv.slice(2) : ORDNER;
console.log('\nUmlaute in sichtbaren Texten');
let alle = [];
for (const o of ziele) {
    const f = [...dateien(path.resolve(WURZEL, o))].flatMap(funde);
    console.log(`  ${f.length ? '✗' : '✓'} ${o}: ${f.length} Zeile(n) mit ASCII-Umlaut`);
    alle = alle.concat(f);
}
for (const t of alle.slice(0, 40)) console.log('      ' + t);
if (alle.length > 40) console.log(`      … und ${alle.length - 40} weitere`);
console.log(alle.length ? `\n✗ ${alle.length} Fund(e)` : '\n✓ alles grün');
process.exit(alle.length ? 1 : 0);
