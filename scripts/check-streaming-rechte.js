#!/usr/bin/env node
/**
 * Prueft, dass jede schreibende Route des Streaming-Plugins eine
 * Rechtepruefung traegt.
 *
 * Das ist die Lehre aus E6: Dort fehlte die Pruefung an 37 Routen, und niemand
 * hat es bemerkt, weil die Navigation die Seiten ohnehin nur Berechtigten
 * zeigte. Eine ausgeblendete Schaltflaeche ist keine Sperre — wer die Adresse
 * kennt, ruft sie trotzdem auf.
 *
 * Vier Regeln:
 *
 *   1. Jede `router.post/put/patch/delete` traegt `requirePermission(...)`
 *      oder `CheckAdmin` — direkt in der Zeile, nicht irgendwo daneben
 *   2. Jede `router.get` traegt mindestens `STREAMING.VIEW` oder `CheckAdmin`
 *   3. Nur Rechte, die `permissions.json` auch kennt (ein Tippfehler im
 *      Schluessel sperrt sonst lautlos jeden aus)
 *   4. Kein Recht traegt einen Uebersetzungsschluessel ueber 100 Zeichen —
 *      `permission_definitions.description_translation_key` ist
 *      `varchar(100)`, und ein zu langer Text laesst den Einspieler GENAU
 *      DIESES Recht ueberspringen. Genau daran fehlte am 2026-08-24
 *      `STREAMING.VIEW`, und das Plugin sah trotzdem fertig aus.
 *
 *   node scripts/check-streaming-rechte.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '../plugins/streaming');
const RECHTE_DATEI = path.join(WURZEL, 'dashboard/permissions.json');
const SCHLUESSEL_MAX = 100;

let abweichungen = 0;

/**
 * Eine Abweichung melden.
 *
 * @param {string} text Klartext
 * @returns {void}
 */
function melde(text) {
    abweichungen++;
    console.log(`  ✗ ${text}`);
}

/**
 * Alle Router-Dateien des Plugins.
 *
 * @returns {Array<string>} Pfade
 */
function routerDateien() {
    const ordner = path.join(WURZEL, 'dashboard/routes');
    if (!fs.existsSync(ordner)) return [];
    return fs.readdirSync(ordner)
        .filter(n => n.endsWith('.router.js'))
        .map(n => path.join(ordner, n));
}

// ---------------------------------------------------------------
// Die bekannten Rechte
// ---------------------------------------------------------------
const katalog = JSON.parse(fs.readFileSync(RECHTE_DATEI, 'utf8'));
const bekannt = new Set(katalog.permissions.map(p => p.key));

console.log('\nRechte im Katalog');
for (const p of katalog.permissions) {
    // So bildet der Einspieler den Uebersetzungsschluessel — die Laenge
    // entscheidet, ob das Recht ueberhaupt in die Datenbank kommt.
    const schluessel = `permissions.${p.key.toLowerCase()}.description`;
    if (schluessel.length > SCHLUESSEL_MAX) {
        melde(`${p.key}: Uebersetzungsschluessel ${schluessel.length} Zeichen ` +
              `(erlaubt ${SCHLUESSEL_MAX}) — dieses Recht wuerde still uebersprungen`);
    } else {
        console.log(`  ✓ ${p.key} (Schluessel ${schluessel.length}/${SCHLUESSEL_MAX})`);
    }
}

// ---------------------------------------------------------------
// Die Routen
// ---------------------------------------------------------------
const SCHREIBEND = /^\s*router\.(post|put|patch|delete)\(/;
const LESEND     = /^\s*router\.get\(/;

for (const datei of routerDateien()) {
    const kurz = path.relative(WURZEL, datei);
    console.log(`\n${kurz}`);

    const zeilen = fs.readFileSync(datei, 'utf8').split('\n');
    let gefunden = 0;

    zeilen.forEach((zeile, i) => {
        const schreibend = SCHREIBEND.test(zeile);
        if (!schreibend && !LESEND.test(zeile)) return;
        gefunden++;

        const nr = i + 1;
        const pfad = (zeile.match(/router\.\w+\('([^']*)'/) || [])[1] || '?';

        // Der Webhook-Eingang ist die eine bewusste Ausnahme: Er wird von
        // Twitch aufgerufen, nicht von einem angemeldeten Menschen. Seine
        // Sperre ist die Signaturpruefung.
        if (kurz.includes('webhook.router')) {
            console.log(`  – ${pfad} (Eingang: Signatur statt Recht)`);
            return;
        }

        const hatAdmin = zeile.includes('CheckAdmin');
        const recht = (zeile.match(/requirePermission\('([^']+)'\)/) || [])[1] || null;

        if (!recht && !hatAdmin) {
            melde(`${kurz}:${nr} ${zeile.trim().slice(0, 60)}… ohne Rechtepruefung`);
            return;
        }
        if (recht && !bekannt.has(recht)) {
            melde(`${kurz}:${nr} prueft "${recht}" — steht nicht in permissions.json`);
            return;
        }
        // Eine Weiterleitung ohne eigene Anzeige darf mit VIEW auskommen;
        // alles Schreibende braucht mehr als das blosse Ansehen.
        if (schreibend && recht === 'STREAMING.VIEW') {
            melde(`${kurz}:${nr} ${pfad} schreibt, prueft aber nur STREAMING.VIEW`);
            return;
        }

        console.log(`  ✓ ${schreibend ? 'schreibt' : 'liest  '} ${pfad.padEnd(22)} ${recht || 'CheckAdmin'}`);
    });

    if (!gefunden) melde(`${kurz}: keine einzige Route gefunden — stimmt das Muster noch?`);

    // Regel 5: Eine Route mit festem Wort darf nicht HINTER einer Route mit
    // Platzhalter stehen, die auf denselben Abschnitt passt. Express nimmt die
    // erste, die passt — `/ziele/:id` schluckt dann `/ziele/live-rolle`, und
    // die Seite meldet einen technischen Fehler, ohne dass irgendwo stuende,
    // warum. Genau das ist am 2026-08-25 beim Bau der Live-Rolle passiert.
    const pfade = [];
    zeilen.forEach((zeile, i) => {
        const t = zeile.match(/router\.(get|post|put|patch|delete)\('([^']*)'/);
        if (t) pfade.push({ nr: i + 1, art: t[1], pfad: t[2] });
    });

    for (let i = 0; i < pfade.length; i++) {
        const spaeter = pfade[i];
        const teileS = spaeter.pfad.split('/');
        for (let j = 0; j < i; j++) {
            const frueher = pfade[j];
            if (frueher.art !== spaeter.art) continue;
            const teileF = frueher.pfad.split('/');
            if (teileF.length !== teileS.length) continue;

            const verdeckt = teileF.every((teil, k) =>
                teil === teileS[k] || (teil.startsWith(':') && !teileS[k].startsWith(':')));
            const hatPlatzhalter = teileF.some(t => t.startsWith(':'));

            if (verdeckt && hatPlatzhalter) {
                melde(`${kurz}:${spaeter.nr} "${spaeter.pfad}" wird von "${frueher.pfad}" (Zeile ${frueher.nr}) verdeckt — feste Pfade gehoeren nach oben`);
            }
        }
    }
}

console.log(abweichungen === 0
    ? '\n0 Abweichungen\n'
    : `\n${abweichungen} Abweichung(en)\n`);
process.exit(abweichungen === 0 ? 0 : 1);
