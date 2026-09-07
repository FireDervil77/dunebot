#!/usr/bin/env node
/**
 * Prueft, dass jeder Zustand in `entwuerfe.js` auch gezeichnet werden kann.
 *
 * # Der Anlass
 *
 * Am 2026-09-07 habe ich ein fertiges Merkmal auf `zustand: 'fertig'` gesetzt.
 * Die drei Klassen im Stylesheet heissen aber `steht`, `halb` und `entwurf`.
 * Die Seite haette dann ein Symbol ohne Farbe gezeigt - kein Fehler, keine
 * Meldung, nur ein Punkt, der aussieht wie vergessen. Genau die Sorte
 * Schaden, die niemand bemerkt, weil nichts kaputtgeht.
 *
 * Geprueft wird gegen **das Stylesheet**, nicht gegen eine Liste in diesem
 * Skript: Eine Liste hier waere eine zweite Wahrheit und ginge beim naechsten
 * neuen Zustand genauso schief.
 *
 *   node scripts/check-entwurfszustaende.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const CSS = path.join(__dirname, '../apps/dashboard/themes/default/assets/css/guild.css');
const ENTWUERFE = path.join(__dirname, '../plugins/streaming/dashboard/entwuerfe.js');

let faelle = 0;
let abweichungen = 0;

/**
 * @param {boolean} gut Bedingung
 * @param {string} text Beschreibung
 * @param {string} [zusatz] Ergaenzung
 * @returns {void}
 */
function pruefe(gut, text, zusatz = '') {
    faelle++;
    if (!gut) abweichungen++;
    console.log(`  ${gut ? '✓' : '✗'} ${text}${zusatz ? '  — ' + zusatz : ''}`);
}

console.log('\nJeder Zustand hat eine Farbe');

const css = fs.readFileSync(CSS, 'utf8');

// Die Symbole der Merkmale und die Marke der Seite haben getrennte Klassen -
// beide werden aus demselben Feld gebaut, also muessen beide geprueft werden.
const symbole = new Set([...css.matchAll(/\.merkmal__symbol--([a-z]+)/g)].map(m => m[1]));
const marken  = new Set([...css.matchAll(/\.zustandsmarke--([a-z]+)/g)].map(m => m[1]));

pruefe(symbole.size > 0, 'die Symbolklassen sind im Stylesheet gefunden', [...symbole].join(', '));
pruefe(marken.size > 0, 'die Markenklassen auch', [...marken].join(', '));

// Die echten Daten, nicht der Quelltext: Ein Zustand, der aus einer Variablen
// kommt, waere per grep unsichtbar.
const { ServiceManager } = require('dunebot-core');
if (!ServiceManager.has('Logger')) {
    ServiceManager.register('Logger', { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, success: () => {} });
}
const { SEITEN } = require(ENTWUERFE);

const fehlendeMerkmale = [];
const fehlendeSeiten = [];

for (const [name, seite] of Object.entries(SEITEN)) {
    // Die Marke kennt nur `halb`; alles andere wird als `entwurf` gezeichnet
    // (streaming-entwurf.ejs). `steht` auf Seitenebene waere deshalb kein
    // Fehler, aber eine Luege - die Seite hiesse dann trotzdem "Entwurf".
    if (seite.zustand && !['entwurf', 'halb'].includes(seite.zustand)) {
        fehlendeSeiten.push(`${name}: ${seite.zustand}`);
    }
    for (const m of seite.merkmale || []) {
        if (!symbole.has(m.zustand)) fehlendeMerkmale.push(`${name}/${m.titel}: ${m.zustand}`);
    }
}

pruefe(fehlendeMerkmale.length === 0,
    'jedes Merkmal benutzt einen Zustand, den das Stylesheet kennt',
    fehlendeMerkmale.join(' | '));

pruefe(fehlendeSeiten.length === 0,
    'jede Seite benutzt einen Zustand, den die Marke kennt',
    fehlendeSeiten.join(' | '));

// Und die Gegenrichtung: Eine Klasse, die niemand benutzt, ist entweder tot
// oder ein vergessener Zustand. Das ist kein Fehler, aber eine Auskunft.
const benutzt = new Set();
for (const seite of Object.values(SEITEN)) {
    for (const m of seite.merkmale || []) benutzt.add(m.zustand);
}
const ungenutzt = [...symbole].filter(z => !benutzt.has(z));
console.log(ungenutzt.length
    ? `  · unbenutzte Zustandsklassen: ${ungenutzt.join(', ')}`
    : '  · alle Zustandsklassen werden benutzt');

console.log(`\n${faelle} Faelle, ${abweichungen} Abweichung(en)\n`);
process.exit(abweichungen ? 1 : 0);
