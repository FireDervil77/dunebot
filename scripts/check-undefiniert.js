#!/usr/bin/env node
/**
 * Ruft irgendwo Code eine Funktion, die es nicht gibt?
 *
 * ── Der Befund (Baustelle 137, 2026-09-17) ──────────────────────────────────
 *
 * Der Betreiber: "wenn ich bei beiden Servern bearbeiten anklicke bekomme ich
 * 500?"
 *
 * Im Log stand `ReferenceError: beurteileVariablen is not defined`. Commit
 * `69bedad` ("Egg-Weg raus", 2026-09-11) hatte den Import entfernt und den
 * AUFRUF stehen lassen. Die Bearbeiten-Seite antwortete seither bei JEDEM
 * Server mit 500 — eine Woche lang, bis jemand darauf klickte.
 *
 * **Diese Fehlerklasse ist in JavaScript besonders teuer:** Ein fehlender
 * Import faellt beim Laden der Datei NICHT auf. Er faellt erst auf, wenn die
 * Zeile ausgefuehrt wird — also genau dann, wenn ein Mensch die Seite aufruft.
 * Kein Uebersetzer, kein Start, kein Test schlaegt vorher an.
 *
 * ── Warum ESLint hier nur Messwerkzeug ist ──────────────────────────────────
 *
 * ESLint liegt im Projekt, ist aber nicht eingerichtet. Eine Projektkonfiguration
 * anzulegen waere eine Entscheidung ueber den Arbeitsablauf und gehoert
 * abgesprochen. Dieses Skript bringt seine eigene Konfiguration mit, prueft
 * genau EINE Regel (`no-undef`) und aendert am Projekt nichts.
 *
 * Die Globals-Liste ist absichtlich grosszuegig: Ein falscher Alarm kostet mehr
 * Vertrauen, als ein uebersehener Fall kostet.
 *
 *   node scripts/check-undefiniert.js
 */
'use strict';
const path = require('path');

const WURZEL = path.join(__dirname, '..');

// Was in Node und im Browser ohnehin da ist. Beide Welten zusammen, weil unter
// `assets/js/` Browsercode liegt und daneben Servercode — und eine getrennte
// Liste hiesse, die Zuordnung zu raten.
const BEKANNT = `require module exports process __dirname __filename console Buffer
setTimeout clearTimeout setInterval clearInterval setImmediate URL URLSearchParams
fetch AbortSignal AbortController TextEncoder TextDecoder structuredClone
queueMicrotask global globalThis Intl Response Request Headers crypto performance
window document navigator location localStorage sessionStorage alert confirm
CSS FormData Blob File FileReader Event CustomEvent EventSource WebSocket
HTMLElement HTMLFormElement HTMLInputElement Node NodeList Image XMLHttpRequest
MutationObserver IntersectionObserver ResizeObserver event
requestAnimationFrame cancelAnimationFrame getComputedStyle history screen
self`.split(/\s+/).filter(Boolean);

// ── Was andere Skripte der Seite bereitstellen ──────────────────────────────
//
// Diese Namen sind KEINE Browser-Standards. Sie stehen hier einzeln, mit
// Herkunft — eine Sammelausnahme "alles in assets/js" wuerde echte Funde
// mitverstecken, und genau das soll dieser Waechter ja finden.
const VON_ANDEREN_SKRIPTEN = {
    fenster:          'guild.js — Modal-Helfer des Themes (die einzige Definition im Projekt)',
    fensterVonHand:   'guild.js — dito',
    GuildAjaxHandler: 'guild.js — gemeinsamer Fetch-Weg mit CSRF',
    showToast:        'guild.js — Meldungen im Betrieb',
    bootstrap:        'Bootstrap, per <script> geladen',
    Chart:            'Chart.js, per <script> geladen',
    monaco:           'Monaco-Editor, per <script> geladen',
    Sortable:         'SortableJS, per <script> geladen',
    Terminal:         'xterm.js, per <script> geladen',
    FitAddon:         'xterm-addon-fit, per <script> geladen',
    toastr:           'toastr, per <script> geladen',
    $:                'jQuery, per <script> geladen',
    jQuery:           'jQuery, per <script> geladen',
};

const ZIELE = [
    'plugins/*/dashboard/routes/**/*.js',
    'plugins/*/dashboard/helpers/**/*.js',
    'plugins/*/dashboard/assets/js/**/*.js',
    'plugins/*/bot/**/*.js',
    'plugins/*/shared/**/*.js',
    'apps/dashboard/routes/**/*.js',
    'apps/dashboard/helpers/**/*.js',
    'apps/dashboard/middlewares/**/*.js',
];

// Fremdcode misst niemand mit. Als LISTE mit Begruendung, nicht als stilles
// Ueberspringen — wer hier etwas eintraegt, sagt auch warum.
const AUSNAHMEN = [
    ['**/node_modules/**',  'Fremdcode'],
    ['**/assets/vendor/**', 'Fremdcode (Monaco, Chart.js und andere)'],
    ['**/*.min.js',         'zusammengefasst, nicht lesbar'],
];

(async () => {
    let ESLint;
    try { ({ ESLint } = require('eslint')); }
    catch {
        console.log('\n❌ ESLint ist nicht installiert — diese Pruefung kann nicht laufen.\n');
        process.exit(1);
    }

    const eslint = new ESLint({
        cwd: WURZEL,
        overrideConfigFile: true,          // keine Projektkonfiguration suchen
        ignorePatterns: AUSNAHMEN.map(a => a[0]),
        overrideConfig: [{
            files: ['**/*.js'],
            languageOptions: {
                ecmaVersion: 2023,
                sourceType: 'commonjs',
                globals: {
                    ...Object.fromEntries(BEKANNT.map(n => [n, 'readonly'])),
                    ...Object.fromEntries(Object.keys(VON_ANDEREN_SKRIPTEN).map(n => [n, 'readonly'])),
                },
            },
            rules: { 'no-undef': 'error' },
        }],
    });

    console.log('\n▸ Wird irgendwo etwas gerufen, das es nicht gibt?');
    console.log('  Ausgenommen (Dateien):');
    for (const [muster, grund] of AUSNAHMEN) console.log(`    ${muster} — ${grund}`);
    console.log(`  Als vorhanden angenommen: ${BEKANNT.length} Standardnamen und `
        + `${Object.keys(VON_ANDEREN_SKRIPTEN).length} aus anderen Skripten der Seite.`);

    const berichte = await eslint.lintFiles(ZIELE.map(z => path.join(WURZEL, z)));

    let fehler = 0, dateien = 0;
    for (const b of berichte) {
        dateien++;
        const treffer = b.messages.filter(m => m.ruleId === 'no-undef');
        for (const m of treffer) {
            fehler++;
            console.log(`  ❌ ${path.relative(WURZEL, b.filePath)}:${m.line}:${m.column}`);
            console.log(`       ${m.message}`);
        }
    }

    console.log(`\n  ${dateien} Dateien gelesen.`);
    console.log(fehler === 0
        ? '✅ Nichts Undefiniertes — jeder Aufruf hat seine Quelle\n'
        : `❌ ${fehler} Aufruf(e) ohne Quelle. Das ist ein 500 fuer den, der die Seite oeffnet.\n`);
    process.exit(fehler === 0 ? 0 : 1);
})().catch(e => {
    console.error('\n❌ Die Pruefung selbst ist gescheitert:', e.message);
    console.error('   Das ist KEIN gruenes Ergebnis — hier steht eine Messung aus.\n');
    process.exit(1);
});
