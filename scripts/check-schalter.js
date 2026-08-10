#!/usr/bin/env node
'use strict';

/**
 * Schalter und Kontrollkästchen im Dashboard — sind sie einheitlich?
 *
 * ## Die Regel
 *
 * | Was | Bauform |
 * |---|---|
 * | **Eine Sache an oder aus** — Funktion aktiv, Karte sichtbar, Eintrag freigeschaltet | `form-check form-switch` |
 * | **Mehreres aus einer Liste** — Rechtematrix, Zustellwege, Ereignisarten, Dateiauswahl | `form-check` allein |
 *
 * Der Unterschied ist nicht kosmetisch. Ein Schalter sagt „das ist ein
 * Zustand, den du umlegst"; ein Kästchen sagt „such dir aus dieser Liste
 * etwas aus". Wer beides mischt, zwingt den Nutzer, jedes Mal neu zu raten.
 *
 * ## Warum dieses Skript nötig ist
 *
 * Am 2026-08-10 stand es 58 zu 31 — dieselbe Art Einstellung war auf der einen
 * Seite ein Schalter und auf der anderen ein Kästchen. Dazu hat
 * `guild.css` mit einer Regel auf `input[type="checkbox"]` und `!important`
 * jeden Schalter wieder zum Quadrat gemacht und ihn grün statt in der
 * Guild-Farbe eingefärbt.
 *
 * Beides ist behoben. Ohne eine Prüfung, die den Stand misst, wäre es in drei
 * Monaten wieder so.
 *
 *   node scripts/check-schalter.js          Übersicht
 *   node scripts/check-schalter.js --liste  jede Fundstelle einzeln
 */

const fs = require('fs');
const path = require('path');

const WURZELN = ['apps/dashboard/themes', 'plugins'];
const LISTE = process.argv.includes('--liste');

/**
 * Fundstellen, die bewusst ein Kästchen bleiben.
 *
 * Jede mit Begründung — eine Ausnahmeliste ohne Begründung wächst, bis sie
 * alles enthält und nichts mehr aussagt.
 */
const GEWOLLTE_KAESTCHEN = [
    ['consent.ejs', 'Einwilligungskategorien — mehrere aus einer Liste'],
    ['changelog-edit.ejs', 'Versandoptionen beim Speichern — einmalige Aktionen, keine Dauereinstellung'],
    ['news-edit.ejs', 'Versandoptionen beim Speichern — einmalige Aktionen'],
    ['notification-edit.ejs', 'Zustellwege — mehrere gleichzeitig wählbar'],
    ['permissions/groups.ejs', 'Rechtekatalog — Mehrfachauswahl'],
    ['permissions/matrix.ejs', 'Rechtematrix — Mehrfachauswahl'],
    ['permissions/users.ejs', 'Rechtekatalog je Nutzer — Mehrfachauswahl'],
    ['server-detail-files.ejs', 'Dateiauswahl — Mehrfachauswahl'],
    ['moderation-settings.ejs', 'modlog_events — mehrere Ereignisarten'],
    ['moderation.ejs', 'modlog_events — mehrere Ereignisarten']
];

/**
 * @param {string} verzeichnis
 * @param {string[]} [treffer]
 * @returns {string[]}
 */
function ejsDateien(verzeichnis, treffer = []) {
    if (!fs.existsSync(verzeichnis)) return treffer;

    for (const eintrag of fs.readdirSync(verzeichnis, { withFileTypes: true })) {
        const p = path.join(verzeichnis, eintrag.name);
        if (eintrag.isDirectory()) {
            if (eintrag.name !== 'node_modules') ejsDateien(p, treffer);
        } else if (eintrag.name.endsWith('.ejs')) {
            treffer.push(p);
        }
    }
    return treffer;
}

/** Ist diese Fundstelle als gewolltes Kästchen eingetragen? */
const istGewollt = (datei) =>
    GEWOLLTE_KAESTCHEN.find(([teil]) => datei.replace(/\\/g, '/').includes(teil));

const schalter = [];
const gewollt = [];
const offen = [];

for (const datei of WURZELN.flatMap(w => ejsDateien(w))) {
    const zeilen = fs.readFileSync(datei, 'utf8').split('\n');

    zeilen.forEach((zeile, i) => {
        if (!/type=["']checkbox["']/.test(zeile)) return;

        // `querySelectorAll('input[type="checkbox"]')` ist eine Abfrage, kein
        // Bauteil. Ohne diese Ausnahme meldet die Prüfung Stellen, an denen
        // gar kein Kästchen steht — und eine Prüfung mit Fehlalarmen wird
        // nach dem zweiten Mal ignoriert.
        if (/querySelector|\$\(|getElementsBy|closest\(/.test(zeile)) return;

        // Das umschliessende Element steht bis zu drei Zeilen darüber — ein
        // rein zeilenweiser Vergleich übersieht jeden umbrochenen Aufbau.
        const umfeld = zeilen.slice(Math.max(0, i - 3), i + 2).join(' ');
        const fund = { datei, zeile: i + 1, text: zeile.trim().slice(0, 90) };

        if (/form-switch/.test(umfeld)) schalter.push(fund);
        else if (istGewollt(datei)) gewollt.push({ ...fund, grund: istGewollt(datei)[1] });
        else offen.push(fund);
    });
}

console.log('\nSchalter und Kontrollkästchen im Dashboard\n');
console.log('─'.repeat(62));
console.log(`  Schalter (form-switch)          ${String(schalter.length).padStart(4)}`);
console.log(`  Kästchen, bewusst so            ${String(gewollt.length).padStart(4)}`);
console.log(`  Kästchen ohne Begründung        ${String(offen.length).padStart(4)}`);
console.log('─'.repeat(62));

if (LISTE) {
    console.log('\nBewusste Kästchen:');
    const jeGrund = new Map();
    for (const g of gewollt) {
        if (!jeGrund.has(g.grund)) jeGrund.set(g.grund, 0);
        jeGrund.set(g.grund, jeGrund.get(g.grund) + 1);
    }
    for (const [grund, n] of jeGrund) console.log(`  ${String(n).padStart(3)}  ${grund}`);
}

if (offen.length > 0) {
    console.log('\n\x1b[33mOhne Einordnung — Schalter oder begründetes Kästchen?\x1b[0m');
    for (const o of offen) {
        console.log(`  ${o.datei}:${o.zeile}`);
        if (LISTE) console.log(`      ${o.text}`);
    }
    console.log('\n  Entweder `form-switch` an das umschliessende `.form-check`,');
    console.log('  oder mit Begründung in GEWOLLTE_KAESTCHEN eintragen.\n');
} else {
    console.log('\n  \x1b[32m✓ Jedes Kästchen ist entweder ein Schalter oder begründet.\x1b[0m\n');
}

process.exit(offen.length === 0 ? 0 : 1);
