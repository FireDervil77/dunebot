#!/usr/bin/env node
/**
 * Zaehlt oeffnende und schliessende `<div>` je Ansicht.
 *
 * **Warum das eine eigene Pruefung wert ist.** Ein `<div>`, das nie schliesst,
 * wirft nirgends. EJS uebersetzt sauber, die Seite laedt, und der Browser
 * repariert das Markup nach eigenem Gutduenken - meist, indem er alles
 * Nachfolgende in die offene Karte zieht. Sichtbar wird es als
 * "sieht irgendwie komisch aus": fehlende Innenabstaende, Kaesten, die
 * ineinanderlaufen, eine weisse Flaeche unter der Karte. Am 2026-08-25 ist
 * genau das zweimal passiert, beide Male beim Umbauen derselben Datei.
 *
 * **Was diese Pruefung NICHT kann**, und das ist wichtig zu wissen, bevor man
 * sich darauf verlaesst: Sie findet **Ungleichgewicht**, nicht **falsche
 * Platzierung**. Schliesst eine `card-body` zu frueh und ein spaeteres `</div>`
 * gleicht es aus, bleibt die Summe null - und der Block steht trotzdem am
 * falschen Ort. Diesen Fall hat der Betreiber gesehen, nicht dieses Skript.
 *
 * Gezaehlt wird bewusst nur `<div>`: Es traegt in Tabler die ganze
 * Kartenstruktur, und andere Elemente sind selten so tief verschachtelt.
 *
 *   node scripts/check-html-balance.js
 *
 * Exitcode 1 bei jeder unerwarteten Abweichung.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..');

/**
 * Ansichten, die absichtlich nicht ausgeglichen sind.
 *
 * Eine Teilansicht darf ein `<div>` schliessen, das ihr Layout geoeffnet hat -
 * dann steht am Ende -1, und das ist richtig. **Nur negative Werte sind so
 * erklaerbar.** Ein positiver Wert heisst immer: hier bleibt etwas offen.
 */
const GEWOLLT = {
    'apps/dashboard/themes/default/views/guild/plugins.ejs': -1,
    'apps/dashboard/themes/default/partials/frontend/sections/documentation.ejs': -1
};

const ORDNER = ['plugins', 'apps/dashboard/themes'];
let verstoesse = 0;
let geprueft = 0;

/**
 * @param {string} ordner Startordner (absolut)
 * @param {Array<string>} [treffer] Sammler
 * @returns {Array<string>} Pfade
 */
function ansichten(ordner, treffer = []) {
    if (!fs.existsSync(ordner)) return treffer;
    for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
        const voll = path.join(ordner, e.name);
        if (e.isDirectory()) {
            if (e.name !== 'node_modules' && e.name !== 'vendor') ansichten(voll, treffer);
        } else if (e.name.endsWith('.ejs')) {
            treffer.push(voll);
        }
    }
    return treffer;
}

console.log('\nAusgeglichene Ansichten');

for (const ordner of ORDNER) {
    for (const datei of ansichten(path.join(WURZEL, ordner))) {
        const rel = path.relative(WURZEL, datei).replace(/\\/g, '/');
        const inhalt = fs.readFileSync(datei, 'utf8');

        let tiefe = 0;
        for (const zeile of inhalt.split('\n')) {
            tiefe += (zeile.match(/<div\b/g) || []).length;
            tiefe -= (zeile.match(/<\/div>/g) || []).length;
        }

        geprueft++;
        const erwartet = GEWOLLT[rel] ?? 0;
        if (tiefe === erwartet) continue;

        verstoesse++;
        console.log(`  ✗ ${rel}: ${tiefe > 0 ? '+' : ''}${tiefe}` +
            (tiefe > 0
                ? `  — ${tiefe} <div> bleibt/bleiben offen; der Browser zieht alles Nachfolgende hinein`
                : `  — ${-tiefe} </div> zu viel; bei einer Teilansicht kann das gewollt sein, dann in GEWOLLT eintragen`));
    }
}

console.log(verstoesse === 0
    ? `\nErgebnis: ${geprueft} Ansichten, 0 Abweichungen.\n`
    : `\nErgebnis: ${geprueft} Ansichten, ${verstoesse} Abweichung(en).\n`);

process.exit(verstoesse === 0 ? 0 : 1);
