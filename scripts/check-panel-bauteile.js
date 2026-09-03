#!/usr/bin/env node
'use strict';

/**
 * Die Bauteile des Panel-Entwurfs (P5) — halten sie sich an ihre eigene Regel?
 *
 * ## Die Regel
 *
 * **Jede Farbe kommt aus einer Rolle** (`var(--fb-*)`), keine steht fest. Wer
 * die Palette wechselt — über `theme.json` oder den Theme-Editor —, wechselt
 * sie damit mit. Helle Flächen werden per `color-mix` aus derselben Rolle
 * abgeleitet, statt als zweiter Wert gepflegt zu werden, der auseinanderläuft.
 *
 * ## Warum das eine Prüfung braucht
 *
 * `guild.css` zeigt, was ohne sie passiert: 631 Zeilen, davon 8 mit Rollen und
 * **48 fest eingetragene Farben** aus Bootstrap-4-Zeiten. Das ist nicht durch
 * eine Entscheidung entstanden, sondern durch dreißig kleine, in denen es
 * jeweils schneller war, `#dc3545` zu tippen.
 *
 * Die neuen Bauteile fangen bei null an. Diese Prüfung hält sie dort.
 *
 * ## Die zweite Prüfung: stille Tippfehler in theme.json
 *
 * Eine Rolle, die es in `tokens.css` nicht gibt, tut **nichts** — sie landet
 * als CSS-Variable im `:root`, die niemand liest. `--fb-primry: #6f4fd0`
 * stürzt nicht ab, es wirkt nur nicht, und die Farbe bleibt die alte.
 *
 *     node scripts/check-panel-bauteile.js
 */

const fs = require('fs');
const path = require('path');

const WURZEL = path.resolve(__dirname, '..');
const CSS = 'apps/dashboard/themes/default/assets/css/guild.css';
const TOKENS = 'apps/dashboard/themes/default/assets/css/tokens.css';
const THEME = 'apps/dashboard/themes/default/theme.json';

/** Ab hier stehen die Bauteile — davor liegt der Altbestand. */
const MARKE = 'Bauteile des Panel-Entwurfs (P5)';

let geprueft = 0;
let abweichungen = 0;

const lies = (d) => fs.readFileSync(path.join(WURZEL, d), 'utf8');
const ohneKommentare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

function pruefe(was, ok, hinweis) {
    geprueft++;
    console.log(`  ${ok ? '✓' : '✗'} ${was}`);
    if (!ok) {
        abweichungen++;
        if (hinweis) console.log(`      ${hinweis}`);
    }
}

// =====================================================
// 1. Keine festen Farben in den neuen Bauteilen
// =====================================================

console.log('\nDie Bauteile nehmen ihre Farben aus Rollen');

const css = lies(CSS);
const start = css.indexOf(MARKE);

if (start < 0) {
    pruefe('Der Bauteil-Block ist auffindbar', false,
        `Die Marke "${MARKE}" steht nicht mehr in ${CSS}.`);
} else {
    const block = ohneKommentare(css.slice(start));

    // `#fff` in einem Kommentar zaehlt nicht, deshalb erst die Kommentare raus.
    const feste = [...block.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => m[0]);
    pruefe(`Keine festen Farbwerte (${feste.length} gefunden)`,
        feste.length === 0,
        feste.length ? `gefunden: ${[...new Set(feste)].join(', ')}` : null);

    // rgb()/rgba() mit Zahlen ist derselbe Fehler in anderer Schreibweise —
    // erlaubt bleibt nur der Weg ueber eine Rolle.
    const rgbFest = [...block.matchAll(/rgba?\(\s*\d+\s*,/g)].map(m => m[0]);
    pruefe(`Kein rgb()/rgba() mit festen Zahlen (${rgbFest.length} gefunden)`,
        rgbFest.length === 0);

    pruefe('Die Bauteile benutzen ueberhaupt Rollen',
        (block.match(/var\(--fb-/g) || []).length >= 10,
        'Weniger als zehn Rollenverweise — das waere zu wenig fuer diesen Block.');
}

// =====================================================
// 2. Jede Rolle aus theme.json existiert in tokens.css
// =====================================================

console.log('\nJede Rolle aus theme.json wird auch gelesen');

const tokensCss = lies(TOKENS);
const theme = JSON.parse(lies(THEME));
const rollen = Object.keys(theme.tokens || {});

pruefe(`theme.json bringt Rollen mit (${rollen.length})`, rollen.length > 0);

const unbekannt = rollen.filter(r => !tokensCss.includes(`--${r}:`));
pruefe('Alle Rollen sind in tokens.css deklariert',
    unbekannt.length === 0,
    unbekannt.length
        ? `ohne Deklaration: ${unbekannt.join(', ')} — sie wirken nicht, ohne zu stuerzen.`
        : null);

// Der umgekehrte Fall ist KEIN Fehler: `--fb-success` und Verwandte stehen
// bewusst nur in tokens.css. Sie sind Vorgaben, die niemand je umstellen
// wollte — und eine Rolle in theme.json waere die Einladung dazu.
const nurCss = [...tokensCss.matchAll(/^\s*--(fb-[a-z0-9-]+):/gm)]
    .map(m => m[1])
    .filter(r => !rollen.includes(r) && !/-rgb$/.test(r));
console.log(`\n  Nur in tokens.css, nicht ueber theme.json einstellbar: ${nurCss.length}`);
if (nurCss.length) console.log(`    ${nurCss.join(', ')}`);

// =====================================================

console.log(`\nErgebnis: ${geprueft} Pruefungen, ${abweichungen} Abweichungen.`);
process.exit(abweichungen ? 1 : 0);
