#!/usr/bin/env node
/**
 * Bewacht den Vertrag zwischen `FormAntwort` (Server) und `form-toast.js`
 * (Browser) — und vor allem die Zusagen, die ihn ungefaehrlich machen.
 *
 * **Der Anlass ist eine Frage des Betreibers:** „darf halt nur kein Einfallstor
 * fuer Boese werden." Beim Nachsehen war eine Luecke schon da, nur bisher
 * folgenlos: `toastr` schreibt seine Nachricht als **HTML** in die Seite
 * (Vorgabe `escapeHtml: false`), und solange alle Toast-Texte fest im
 * Quelltext standen, machte das nichts. Mit `FormAntwort` liefert der Server
 * den Text — und der enthaelt Nutzereingaben.
 *
 * Sechs Regeln:
 *
 *   1. `escapeHtml: true` — Text bleibt Text
 *   2. Formulare fremder Herkunft werden nicht abgefangen
 *   3. `geheZu` fuehrt nur auf den eigenen Server
 *   4. JSON nur bei eigener Kopfzeile, nie nach `Accept` geraten
 *   5. Es gibt einen Rueckfall auf das klassische Absenden
 *   6. Ein abgelehntes Formular bleibt 200, nicht 4xx
 *
 *   node scripts/check-formantwort.js
 *
 * Exitcode 1 bei jeder Verletzung.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..');
let verstoesse = 0;

/**
 * @param {string} rel Pfad ab Projektwurzel
 * @returns {string} Inhalt ohne Kommentare
 */
function liesCode(rel) {
    return fs.readFileSync(path.join(WURZEL, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').map(z => z.replace(/\/\/.*$/, '')).join('\n');
}

/**
 * @param {string} regel Beschreibung
 * @param {Array<string>} fehler Fundstellen
 */
function melde(regel, fehler) {
    if (!fehler.length) { console.log(`  ✓ ${regel}`); return; }
    verstoesse += fehler.length;
    console.log(`  ✗ ${regel}`);
    fehler.forEach(f => console.log(`      ${f}`));
}

const TOAST   = 'apps/dashboard/themes/default/assets/js/global-toast.js';
const FORMULAR = 'apps/dashboard/themes/default/assets/js/form-toast.js';
const SERVER  = 'packages/dunebot-sdk/lib/FormAntwort.js';

console.log('\nXSS');

// Die wichtigste Regel: Ohne sie ist jede servergelieferte Meldung ein Weg,
// fremdes Markup in die Seite zu bekommen.
melde('toastr schreibt Text, kein HTML (escapeHtml: true)',
    /escapeHtml:\s*true/.test(liesCode(TOAST))
        ? [] : [`${TOAST} setzt escapeHtml nicht auf true — toastr-Vorgabe ist false, die Nachricht landet als HTML in der Seite`]);

console.log('\nHerkunft');

const browser = liesCode(FORMULAR);

melde('Formulare fremder Herkunft werden nicht abgefangen',
    /gleicheHerkunft\(\s*form\.action\s*\)/.test(browser)
        ? [] : ['form-toast.js prueft form.action nicht — ein data-toast auf ein fremdes Ziel schickte Sitzung und CSRF-Token dorthin']);

melde('geheZu fuehrt nur auf den eigenen Server',
    /gleicheHerkunft\(\s*d\.geheZu\s*\)/.test(browser)
        ? [] : ['form-toast.js springt ungeprueft auf d.geheZu — offene Weiterleitung']);

console.log('\nDer Vertrag');

const server = liesCode(SERVER);

// Nach `Accept` zu schnueffeln waere der naheliegende Weg und genau falsch:
// Browser schicken bei gewoehnlichen Formularen wechselnde Accept-Zeilen, und
// dann bekaeme ein normaler Klick ploetzlich JSON statt einer Seite.
melde('JSON nur bei eigener Kopfzeile, nicht nach Accept geraten',
    /req\?\.headers\?\.\[KOPFZEILE\]/.test(server) && !/accept/i.test(server.replace(/KOPFZEILE/g, ''))
        ? [] : ['FormAntwort entscheidet nicht (nur) an der eigenen Kopfzeile']);

melde('Es gibt einen Rueckfall auf das klassische Absenden',
    /form\.submit\(\)/.test(browser)
        ? [] : ['form-toast.js hat keinen Rueckfall — bei einer Fehlerseite passierte gar nichts, ohne Hinweis']);

// Ein abgelehntes Formular ist kein Serverfehler. Wer hier 4xx sendet, loest
// bei jedem Tippfehler des Nutzers den Rueckfall aus - und damit ein
// vollstaendiges Neuladen statt einer Meldung.
melde('Ein abgelehntes Formular bleibt 200',
    /antworteFehler[\s\S]*?res\.status\(\s*4\d\d/.test(server)
        ? ['antworteFehler sendet 4xx — das loest den Rueckfall bei jedem Nutzerfehler aus'] : []);

console.log(verstoesse === 0
    ? '\nErgebnis: 0 Verstoesse.\n'
    : `\nErgebnis: ${verstoesse} Verstoss/Verstoesse.\n`);

process.exit(verstoesse === 0 ? 0 : 1);
