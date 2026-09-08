#!/usr/bin/env node
/**
 * Haengt die Live-Anzeige ueberhaupt an der Seite?
 *
 * ── Der Befund, der dazu fuehrte (2026-09-08) ───────────────────────────────
 *
 * Der Betreiber: "die ansichtseite wenn man den server startet aktualisiert
 * ihren status so wie die bereitschaft nicht in echtzeit. das bemerke ich wie
 * die live stats schon seit beginn des projektes."
 *
 * `gameserver-live.js` war vollstaendig gebaut, wurde von zwei Seiten geladen -
 * und startete nie. Es sucht beim Aufbau `[data-fb-live-guild]`, und dieses
 * Attribut stand in KEINER Vorlage des Projekts. Ein `return` ohne Meldung.
 *
 * Geprueft wird deshalb dreierlei:
 *
 *   1. Es gibt mindestens eine Vorlage mit `data-fb-live-guild`.
 *   2. Jede Feldart, die eine Vorlage benutzt, kennt das Modul auch.
 *   3. Jede Feldart, die das Modul kennt, wird irgendwo benutzt - sonst ist es
 *      vorbereiteter toter Platz, und der faellt beim ersten Einsatz um.
 *
 *   node scripts/check-live-anzeige.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..');
const MODUL = path.join(WURZEL, 'plugins/gameserver/dashboard/assets/js/gameserver-live.js');
const ANSICHTEN = path.join(WURZEL, 'plugins/gameserver/dashboard/views');

let fehler = 0;
const pruefe = (ok, was, zusatz = '') => {
    console.log(`  ${ok ? '✅' : '❌'} ${was}${zusatz ? '\n       ' + zusatz : ''}`);
    if (!ok) fehler++;
};

/** Alle .ejs unterhalb eines Verzeichnisses. */
function vorlagen(verzeichnis, treffer = []) {
    for (const e of fs.readdirSync(verzeichnis, { withFileTypes: true })) {
        const voll = path.join(verzeichnis, e.name);
        if (e.isDirectory()) vorlagen(voll, treffer);
        else if (e.name.endsWith('.ejs')) treffer.push(voll);
    }
    return treffer;
}

const dateien = vorlagen(ANSICHTEN);
const quelle = fs.readFileSync(MODUL, 'utf8');

// Was das Modul zeichnen kann: die Faelle im switch.
// Kommentare vorher weg - im Kopf dieser Datei stehen die Namen als Prosa.
const modulOhneKommentare = quelle
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(z => z.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
const kann = new Set([...modulOhneKommentare.matchAll(/case\s+'([a-z-]+)':/g)].map(t => t[1]));

// Was die Vorlagen verlangen.
const benutzt = new Map();
let mitHaken = [];
for (const datei of dateien) {
    const text = fs.readFileSync(datei, 'utf8');
    if (/data-fb-live-guild/.test(text)) mitHaken.push(path.relative(WURZEL, datei));
    for (const t of text.matchAll(/data-fb-live="([a-z-]+)"/g)) {
        if (!benutzt.has(t[1])) benutzt.set(t[1], []);
        benutzt.get(t[1]).push(path.relative(WURZEL, datei));
    }
}

console.log('\n▸ Die Live-Anzeige haengt an einer Seite');
pruefe(mitHaken.length > 0,
    'Mindestens eine Vorlage traegt data-fb-live-guild',
    mitHaken.join(', ') || 'KEINE — das Modul startet nicht, ohne etwas zu melden');

console.log('\n▸ Vorlage und Modul kennen dieselben Felder');
for (const [art, wo] of benutzt) {
    pruefe(kann.has(art), `"${art}" wird gezeichnet`,
        kann.has(art) ? '' : `benutzt in ${wo.join(', ')}, aber kein Fall im Modul`);
}
for (const art of kann) {
    pruefe(benutzt.has(art), `"${art}" wird auch benutzt`,
        benutzt.has(art) ? '' : 'das Modul kann es, keine Vorlage verlangt es');
}

console.log(fehler === 0
    ? '\n✅ Die Live-Anzeige ist eingehaengt und vollstaendig\n'
    : `\n❌ ${fehler} Abweichung(en)\n`);
process.exit(fehler === 0 ? 0 : 1);
