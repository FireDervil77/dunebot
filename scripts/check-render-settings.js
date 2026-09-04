#!/usr/bin/env node
'use strict';

/**
 * `settings` als Renderdaten — kollidiert mit Express, und EJS haengt daran
 *
 * ## Der Fehler, den das hier festhaelt
 *
 * Express legt seine eigenen Einstellungen als `settings` in die Renderdaten.
 * EJS liest daraus die View-Wurzeln fuer **verschachtelte** Includes, und zwar
 * nur von dort:
 *
 *     ejs.js:467   if (data.settings.views) { opts.views = data.settings.views; }
 *     ejs.js:181   if (!includePath && Array.isArray(views)) { … }
 *                  if (!includePath) throw 'Could not find the include file'
 *
 * Wer eine eigene Variable `settings` uebergibt, verdeckt Express' Objekt.
 * `opts.views` bleibt dann leer und **jeder verschachtelte Include stuerzt ab**
 * — mit einer Meldung, die auf eine fehlende Datei zeigt, obwohl die Datei da
 * ist. Vier Plugins traf das auf ihren Einstellungsseiten.
 *
 * ## Warum das hier nachgestellt und nicht nur gelesen wird
 *
 * Ein grep auf `Object.defineProperty` im ThemeRenderer wuerde beweisen, dass
 * dort etwas steht — nicht, dass es wirkt. Deshalb rendert dieses Skript zwei
 * echte Vorlagen mit verschachteltem Include: einmal ohne Nachreichen (muss
 * fallen), einmal mit (muss durchlaufen).
 *
 *     node scripts/check-render-settings.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const WURZEL = path.resolve(__dirname, '..');
const ejs = require(path.join(WURZEL, 'node_modules/ejs'));

let abweichungen = 0;
function pruefe(was, bedingung, hinweis) {
    if (bedingung) { console.log(`  ✓ ${was}`); return; }
    abweichungen++;
    console.log(`  ✗ ${was}`);
    if (hinweis) console.log(`      ${hinweis}`);
}

// =====================================================
// 1. Der Mechanismus — nachgestellt, nicht gelesen
// =====================================================

console.log('\nDer Mechanismus: `settings` verdeckt die View-Wurzeln');

const bau = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-render-'));
const wurzelDir = path.join(bau, 'wurzeln');
fs.mkdirSync(path.join(wurzelDir, 'gemeinsam'), { recursive: true });
fs.writeFileSync(path.join(wurzelDir, 'gemeinsam', 'kopf.ejs'), 'KOPF');
// Der Elternteil liegt woanders, damit der Include NICHT relativ aufgeht —
// genau wie `shared/seitenkopf` neben einem Plugin-Partial.
const eltern = path.join(bau, 'eltern.ejs');
fs.writeFileSync(eltern, "<%- include('gemeinsam/kopf') %>");

// **Drei Argumente, nicht vier.** EJS wertet `data.settings` nur aus, wenn
// KEIN eigenes Options-Objekt mitkommt (ejs.js:461, der `else`-Zweig). Mit
// einem vierten Argument nimmt es den gewoehnlichen Weg — und dann prueft man
// etwas anderes als das, was Express tut. Beim ersten Anlauf genau so passiert:
// Die Vergleichsprobe fiel mit derselben Meldung wie der Fehler.
const rendern = (settings) => new Promise((fertig) => {
    ejs.renderFile(eltern, { settings, cache: false }, (err, out) => fertig({ err, out }));
});

(async () => {
    // a) So, wie Express es meint: `settings` traegt die Wurzeln.
    const gut = await rendern({ views: [wurzelDir] });
    pruefe('mit Express-`settings` laeuft der verschachtelte Include',
        !gut.err && gut.out === 'KOPF',
        gut.err ? gut.err.message : `Ausgabe: ${gut.out}`);

    // b) Ein Plugin uebergibt sein eigenes `settings` — muss fallen.
    const kaputt = await rendern({ irgendwas: 1 });
    pruefe('ohne Wurzeln in `settings` faellt er — das ist der Befund',
        !!kaputt.err && /Could not find the include file/.test(kaputt.err.message),
        'Faellt er NICHT, hat EJS sein Verhalten geaendert und die Reparatur '
        + 'im ThemeRenderer braucht eine neue Begruendung.');

    // c) Und mit dem Nachreichen, wie der ThemeRenderer es tut.
    const fremd = { irgendwas: 1 };
    Object.defineProperty(fremd, 'views', {
        value: [wurzelDir], enumerable: false, configurable: true
    });
    const geheilt = await rendern(fremd);
    pruefe('nicht aufzaehlbar nachgereicht, laeuft er wieder',
        !geheilt.err && geheilt.out === 'KOPF',
        geheilt.err ? geheilt.err.message : `Ausgabe: ${geheilt.out}`);

    // Die Ansicht darf davon nichts merken.
    pruefe('das Nachreichen bleibt fuer die Ansicht unsichtbar',
        Object.keys(fremd).join(',') === 'irgendwas'
        && JSON.stringify(fremd) === '{"irgendwas":1}',
        `sichtbar: ${Object.keys(fremd).join(', ')}`);

    fs.rmSync(bau, { recursive: true, force: true });

    // =====================================================
    // 2. Die Reparatur steht im ThemeRenderer
    // =====================================================

    console.log('\nDie Reparatur sitzt an der einen Stelle');

    const renderer = fs.readFileSync(
        path.join(WURZEL, 'packages/dunebot-sdk/lib/theme/ThemeRenderer.js'), 'utf8');

    pruefe('der ThemeRenderer reicht die Wurzeln nach',
        /Object\.defineProperty\(fremd,/.test(renderer)
        && /'views', 'view cache', 'view options'/.test(renderer),
        'Ohne das faellt jede Ansicht, die `settings` uebergibt und verschachtelt inkludiert.');

    pruefe('und meldet die Kollision, statt sie zu verschweigen',
        /Logger\.warn\([^)]*ThemeRenderer/.test(renderer),
        'Stillschweigend heilen heisst: der Name bleibt fuer immer.');

    // =====================================================
    // 3. Wer uebergibt heute ein `settings`?
    // =====================================================
    //
    // Kein Fehler, solange die Reparatur steht — aber die Liste fuer den
    // tieferen Durchgang am Theming, und sie soll nicht wachsen.

    console.log('\nAnsichten, die eine eigene Variable `settings` uebergeben');

    const treffer = [];
    const suche = (verzeichnis) => {
        for (const eintrag of fs.readdirSync(verzeichnis, { withFileTypes: true })) {
            const voll = path.join(verzeichnis, eintrag.name);
            if (eintrag.isDirectory()) {
                if (eintrag.name === 'node_modules' || eintrag.name.startsWith('.')) continue;
                suche(voll);
            } else if (eintrag.name.endsWith('.js')) {
                const quelle = fs.readFileSync(voll, 'utf8');
                for (const m of quelle.matchAll(/renderView\(\s*res\s*,\s*'([^']+)'\s*,\s*\{([^}]*)\}/g)) {
                    if (/(^|[\s,])settings\s*(,|$|:)/.test(m[2])) treffer.push(m[1]);
                }
            }
        }
    };
    suche(path.join(WURZEL, 'plugins'));

    [...new Set(treffer)].sort().forEach(v => console.log(`    ${v}`));
    console.log(`  ${treffer.length ? '–' : '✓'} ${treffer.length} Aufruf(e)`);

    console.log(`\nErgebnis: ${abweichungen} Abweichungen.\n`);
    process.exit(abweichungen ? 1 : 0);
})();
