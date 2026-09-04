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

// **Ab dem 2026-09-04 gilt die Regel fuer die GANZE Datei, nicht nur fuer den
// Bauteil-Block.** Der Altbestand trug 66 feste Farbwerte — die
// Bootstrap-4-Palette (`#007bff`, `#28a745`, `#dc3545`, `#17a2b8`), gegen die
// jede Einstellung in `theme.json` wirkungslos war. Sie sind raus; die
// Beschraenkung auf einen Block haette es erlaubt, sie unbemerkt wieder
// hereinzuschreiben.
//
// Schatten sind die eine Ausnahme, und sie stehen als Rolle in `tokens.css`:
// Tiefe ist keine Farbe der Palette und darf mit ihr nicht wandern.
const ganze = ohneKommentare(css);
const festeGanz = [...ganze.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => m[0]);
pruefe(`guild.css traegt insgesamt keine festen Farbwerte (${festeGanz.length})`,
    festeGanz.length === 0,
    festeGanz.length ? `gefunden: ${[...new Set(festeGanz)].join(', ')}` : null);

const rgbGanz = [...ganze.matchAll(/rgba?\(\s*\d+\s*,/g)].map(m => m[0]);
pruefe(`guild.css traegt kein rgb()/rgba() mit festen Zahlen (${rgbGanz.length})`,
    rgbGanz.length === 0,
    'Schatten gehoeren als Rolle nach tokens.css, nicht als Zahl hierher.');

// Und die Schriften: `body` liest ueber Tabler `--tblr-font-sans-serif`. Ohne
// die Bruecke dorthin bittet Tabler um "Inter Var", laedt sie nicht, und der
// Bereich faellt auf die Systemschrift zurueck — ohne Fehler, ohne Hinweis.
const tokensFrueh = lies(TOKENS);
pruefe('Die Schriftrollen sind erklaert',
    ['--fb-font-display', '--fb-font-ui', '--fb-font-mono'].every(r => tokensFrueh.includes(`${r}:`)),
    'Eine fehlende Schriftrolle faellt still auf die Systemschrift zurueck.');
pruefe('Tablers Schriftvariablen zeigen auf die Rollen',
    tokensFrueh.includes('--tblr-font-sans-serif: var(--fb-font-ui)')
    && tokensFrueh.includes('--tblr-font-monospace: var(--fb-font-mono)'),
    'Ohne die Bruecke greift keine der geladenen Schriften.');


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
// 3. Jede eigene Stildatei wird auch geladen
// =====================================================
//
// **Der Fund vom 2026-09-03, und er hatte lange Bestand.** `guild.css` lag
// seit jeher im Theme, trug 631 Zeilen — und war **nirgends registriert und
// nirgends eingereiht.** Der Browser hat sie nie geladen.
//
// Aufgefallen ist es erst, als frisch geschriebene Regeln auf der Seite nicht
// ankamen. Vorher fiel es nicht auf, weil das meiste darin ohnehin so aussah,
// wie Tabler es von sich aus zeichnet — die Datei war unsichtbar, nicht kaputt.
//
// Zwei Ansichten verlassen sich in ihren Kommentaren ausdruecklich auf sie
// ("global in guild.css definiert"). Sie taten es vier Wochen lang vergebens.

console.log('\nJede eigene Stildatei ist registriert UND eingereiht');

const THEME_JS = 'apps/dashboard/themes/default/theme.js';
const themeJs = ohneKommentare(lies(THEME_JS));
const themeDir = path.join(WURZEL, 'apps/dashboard/themes/default/assets/css');

const registriert = new Map();   // Dateiname -> Handle
for (const t of themeJs.matchAll(/registerStyle\(\s*'([^']+)'\s*,\s*'([^']+)'/g)) {
    registriert.set(t[2], t[1]);
}
const eingereiht = new Set(
    [...themeJs.matchAll(/enqueueStyle\(\s*'([^']+)'\s*\)/g)].map(m => m[1])
);
// Der Sammelaufruf `[...].forEach(h => am.enqueueStyle(h))` listet seine
// Handles als Zeichenketten im Array davor.
for (const t of themeJs.matchAll(/\[([^\]]*)\]\s*\.\s*forEach\(\s*h\s*=>\s*am\.enqueueStyle/g)) {
    for (const h of t[1].matchAll(/'([^']+)'/g)) eingereiht.add(h[1]);
}

// **Die Schriftquelle geht denselben Weg und kann denselben Tod sterben.**
// Sie ist ein Vendor-Handle, faellt also durch die Dateischleife unten
// hindurch — geprueft wird sie deshalb hier von Hand. Eine nicht geladene
// Schrift stuerzt nicht ab, sie sieht nur nach Systemschrift aus; genau so
// hat der Guild-Bereich bis zum 2026-09-04 ausgesehen, waehrend Tabler um
// "Inter Var" bat, die nie jemand geholt hat.
pruefe('Die Schriftquelle ist angemeldet',
    /registerVendorStyle\(\s*'fonts-guild'/.test(themeJs),
    'Ohne `registerVendorStyle` gibt es das Handle nicht.');
pruefe('Die Schriftquelle wird im Guild-Bereich eingereiht',
    eingereiht.has('fonts-guild'),
    'Angemeldet, aber nie eingereiht — der Browser holt sie nie.');

// =====================================================
// Das Blatt: greifen die Selektoren ueberhaupt?
// =====================================================
//
// Der Rahmen um das Panel haengt an vier Selektoren, und jeder von ihnen
// beschreibt eine STRUKTUR, keine Klasse an einem Element:
//
//     .page > .navbar-vertical       Seitenleiste ist Kind von .page
//     .page > header.navbar          Kopfleiste ist Kind von .page
//     .page > .page-wrapper          Inhaltsspalte ist Kind von .page
//     .navbar-vertical > .container-fluid
//
// Wer das Layout umbaut — eine Huelle dazwischen, ein `<div>` mehr —, trifft
// keinen Fehler: Die Regeln greifen einfach nicht mehr, die Seitenleiste
// faellt auf Tablers `position: fixed` zurueck und klebt am Fensterrand,
// waehrend der Kasten daneben schwebt. Genau das prueft dieser Block.

console.log('\nDas Blatt: die Selektoren finden ihre Struktur');

const layout   = ohneKommentare(lies('apps/dashboard/themes/default/views/layouts/guild.ejs'));
const seitenl  = ohneKommentare(lies('apps/dashboard/themes/default/partials/guild/sidebar.ejs'));
const kopfl    = ohneKommentare(lies('apps/dashboard/themes/default/partials/guild/topbar.ejs'));

pruefe('`.page` und `.page-wrapper` stehen im Layout',
    /class="page"/.test(layout) && /class="page-wrapper"/.test(layout),
    'Ohne diese beiden hat das Raster keine Anker.');

pruefe('Die Seitenleiste ist ein `aside.navbar-vertical`',
    /<aside[^>]*class="[^"]*\bnavbar-vertical\b/.test(seitenl),
    'Der Selektor `.page > .navbar-vertical` trifft dann nichts.');

pruefe('Die Seitenleiste traegt innen ein `.container-fluid`',
    /<aside[\s\S]{0,200}?class="container-fluid"/.test(seitenl),
    'Das mitlaufende Menue haengt daran.');

pruefe('Die Kopfleiste ist ein `header.navbar`',
    /<header[^>]*class="[^"]*\bnavbar\b/.test(kopfl),
    'Der Selektor `.page > header.navbar` trifft dann nichts.');

// Reihenfolge im Raster: Seitenleiste, Kopfleiste, Inhalt.
const inPage = layout.slice(layout.indexOf('class="page"'));
const reihe = ['guild/sidebar', 'guild/topbar', 'class="page-wrapper"']
    .map(m => inPage.indexOf(m));
pruefe('Seitenleiste, Kopfleiste und Inhalt stehen in dieser Folge',
    reihe.every(i => i >= 0) && reihe[0] < reihe[1] && reihe[1] < reihe[2],
    `Fundstellen: ${reihe.join(', ')} — -1 heisst "gar nicht da".`);

// **Und sie sind DIREKTE Kinder.** Die Reihenfolgepruefung allein beweist das
// nicht — bei der Gegenprobe habe ich ein `<div class="huelle">` direkt hinter
// `.page` eingezogen, und sie blieb gruen, obwohl `.page > .navbar-vertical`
// damit ins Leere greift. Gemessen wird deshalb, ob zwischen `.page` und der
// Seitenleiste ueberhaupt ein Element aufgeht; EJS-Bloecke zaehlen nicht mit.
// Bis zum ANFANG des EJS-Blocks schneiden, nicht bis zum Namen darin — sonst
// endet der Ausschnitt mitten in `<%- includePartial(` und traegt dessen `<`
// als vermeintliches Element. (Beim ersten Anlauf genau so passiert.)
const zwischen = inPage.slice(inPage.indexOf('>') + 1, inPage.lastIndexOf('<%', reihe[0]))
    .replace(/<%[\s\S]*?%>/g, '')
    .trim();
pruefe('Zwischen `.page` und der Seitenleiste steht kein weiteres Element',
    !zwischen.includes('<'),
    `Dort steht: ${zwischen.slice(0, 60)} — `
    + '`.page > .navbar-vertical` greift dann nicht mehr.');

const blattCss = ohneKommentare(lies(CSS));

pruefe('Der `body` traegt Tablers `layout-boxed`',
    /<body[^>]*class="[^"]*\blayout-boxed\b/.test(layout),
    'Ohne die Klasse gibt es kein Blatt — Zentrierung, Breite, Rand und '
    + 'Rundung kommen von Tabler und haengen alle daran.');

pruefe('Tablers `position: fixed` an der Seitenleiste ist zurueckgenommen',
    /\.page > \.navbar-vertical\s*\{[^}]*position:\s*static/.test(blattCss),
    'Ohne das klebt die Leiste am Fensterrand, neben dem Kasten.');

// **Der Versatz an den Geschwistern — der Fehler, den ein Bild gefunden hat.**
//
// Tabler haelt den Platz fuer die fixierte Leiste nicht an `.page` frei,
// sondern an allem, was HINTER ihr steht:
//
//     .navbar-expand-lg.navbar-vertical ~ .navbar,
//     .navbar-expand-lg.navbar-vertical ~ .page-wrapper { margin-left: 15rem }
//
// Drei Klassen. Der erste Anlauf schrieb `margin-left: 0` an
// `.page > .page-wrapper` — zwei Klassen, und damit wirkungslos. Kopfleiste
// und Inhalt standen 240px zu weit rechts, im Raster ein zweites Mal.
//
// Geprueft wird der Selektor MIT seiner Spezifitaet: `.navbar-expand-lg` muss
// darin vorkommen, sonst gewinnt er nicht.
for (const geschwister of ['header\\.navbar', '\\.page-wrapper']) {
    const muster = new RegExp(
        `\\.page > \\.navbar-vertical\\.navbar-expand-lg ~ ${geschwister}`);
    pruefe(`Der 15rem-Versatz ist zurueckgenommen (${geschwister.replace(/\\/g, '')})`,
        muster.test(blattCss),
        'Ohne `.navbar-expand-lg` im Selektor bleibt Tablers Regel staerker.');
}

/**
 * Dateien, die bewusst NICHT geladen werden.
 *
 * Jede mit Begruendung — eine Ausnahmeliste ohne Begruendung waechst, bis sie
 * alles enthaelt und nichts mehr aussagt (dieselbe Regel wie in
 * `check-schalter.js`).
 */
const GEWOLLT_TOT = new Map([
    ['guild-switcher.css',
     'Setzt `.dropdown-item.active` auf #e9ecef — das faerbte jeden aktiven '
     + 'Menuepunkt der Seitenleiste hellgrau und schluege die Aktivfarbe aus '
     + 'dem Theme. Bootstrap-4-Altbestand; einzubinden waere ein Rueckschritt, '
     + 'nicht eine Reparatur. Loeschen erst, wenn geklaert ist, ob der '
     + 'Guild-Umschalter noch etwas davon braucht.']
]);

for (const datei of fs.readdirSync(themeDir).filter(f => f.endsWith('.css'))) {
    if (GEWOLLT_TOT.has(datei)) {
        console.log(`  – ${datei} bleibt absichtlich ungeladen`);
        continue;
    }
    const handle = registriert.get(datei);
    if (!handle) {
        pruefe(`${datei} ist registriert`, false,
            'Die Datei liegt im Theme, aber kein registerStyle nennt sie — sie wird nie geladen.');
        continue;
    }
    pruefe(`${datei} → '${handle}' wird eingereiht`,
        eingereiht.has(handle),
        `Registriert, aber kein enqueueStyle('${handle}') — die Datei wird nie geladen.`);
}

// =====================================================

console.log(`\nErgebnis: ${geprueft} Pruefungen, ${abweichungen} Abweichungen.`);
process.exit(abweichungen ? 1 : 0);
