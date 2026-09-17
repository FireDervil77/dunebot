#!/usr/bin/env node
/**
 * Schalten die Knoepfe richtig? — Baustelle 134
 *
 * ── Warum es diesen Waechter gibt ───────────────────────────────────────────
 *
 * Der Betreiber, 2026-09-17: "die buttons, die ihren status selbstaendig
 * aendern muessten, ohne dass ich die Seite jedesmal neu laden muss."
 *
 * Vorher entschied die Vorlage beim Rendern, welche Knoepfe es GIBT. Der
 * Statustext sprang live auf "Laeuft" - und daneben stand weiter "Starten".
 * Jetzt stehen alle drei Knoepfe da und `gameserver-live.js` schaltet sie.
 *
 * Die Regel dafuer steht in `knopfZustand()` — als reine Rechnung, damit sie
 * hier gemessen werden kann. Ohne diesen Waechter waere sie Code, den nur der
 * Browser je ausfuehrt, und den niemand prueft.
 *
 * Die zwei Faelle, die man leicht falsch baut:
 *
 *   1. Ein Paket OHNE `ready_when` wird nie "bereit" gemeldet. Wer "Neu
 *      starten" an `bereit === true` haengt, sperrt so einen Server fuer
 *      immer.
 *   2. Beim Starten "Stoppen" zu sperren klingt sauber, ist aber eine Falle:
 *      Ein haengender Start haette dann keinen Weg zurueck.
 *
 *   node scripts/check-knopfzeile.js
 */
'use strict';
const path = require('path');
const { knopfZustand } = require(path.join(
    __dirname, '..', 'plugins/gameserver/dashboard/assets/js/gameserver-live.js'));

let fehler = 0;
const pruefe = (ok, was, zusatz = '') => {
    console.log(`  ${ok ? '✅' : '❌'} ${was}${zusatz ? '\n       ' + zusatz : ''}`);
    if (!ok) fehler++;
};

/** Kurzschreibweise: "start:sichtbar+aktiv restart:weg stop:gesperrt" */
function bild(z) {
    const s = knopfZustand(z);
    return ['start', 'restart', 'stop'].map(k =>
        `${k}:${!s[k].sichtbar ? 'weg' : s[k].aktiv ? 'aktiv' : 'gesperrt'}`).join(' ');
}

const faelle = [
    // [Lage, Zustand, erwartetes Bild, Begruendung]
    ['Server aus',
     { status: 'offline' },
     'start:aktiv restart:weg stop:weg',
     'Nur Starten ergibt Sinn.'],

    ['Fehler',
     { status: 'error' },
     'start:aktiv restart:weg stop:weg',
     'Aus einem Fehler kommt man durch Starten heraus.'],

    ['Startet gerade, noch nichts gemeldet',
     { status: 'starting', messbar: true, bereit: false },
     'start:weg restart:gesperrt stop:aktiv',
     'STOPPEN MUSS AKTIV BLEIBEN — ein haengender Start braucht einen Weg zurueck.'],

    ['Laeuft, aber noch nicht bereit',
     { status: 'online', messbar: true, bereit: false, text: 'wartet auf Port' },
     'start:weg restart:gesperrt stop:aktiv',
     'Genau der Fall, den der Betreiber sah: Text sagt "Laeuft", bereit ist er nicht.'],

    ['Laeuft und ist bereit',
     { status: 'online', messbar: true, bereit: true },
     'start:weg restart:aktiv stop:aktiv',
     'Der Normalfall.'],

    ['Laeuft, Paket misst keine Bereitschaft',
     { status: 'online', messbar: false, bereit: false },
     'start:weg restart:aktiv stop:aktiv',
     'OHNE ready_when darf nichts gesperrt sein — sonst waere der Server nie neu startbar.'],

    ['Wird gestoppt',
     { status: 'stopping' },
     'start:gesperrt restart:weg stop:weg',
     'Starten bleibt stehen, aber gesperrt — sonst waere die Zeile leer.'],

    ['Wird installiert',
     { status: 'installing' },
     'start:gesperrt restart:weg stop:weg',
     'Starten bleibt sichtbar, aber gesperrt — der Knopf soll nicht springen.'],

    ['Unbekannter Status',
     { status: 'wasauchimmer' },
     'start:aktiv restart:weg stop:weg',
     'Ein unbekannter Status darf nicht alles sperren.'],
];

console.log('\n▸ Welcher Knopf ist wann sichtbar und aktiv?');
for (const [lage, z, erwartet, warum] of faelle) {
    const ist = bild(z);
    pruefe(ist === erwartet, `${lage}: ${ist}`,
        ist === erwartet ? warum : `erwartet: ${erwartet}\n       ${warum}`);
}

console.log('\n▸ Ein gesperrter Knopf sagt, warum');
for (const [lage, z] of faelle) {
    const s = knopfZustand(z);
    for (const k of ['start', 'restart', 'stop']) {
        if (s[k].sichtbar && !s[k].aktiv) {
            pruefe(Boolean(s[k].grund), `${lage} → "${k}" gesperrt mit Begruendung`,
                s[k].grund || 'gesperrt OHNE Grund — das ist eine Sackgasse');
        }
    }
}

console.log('\n▸ Ein aktiver Knopf traegt keinen Hinderungsgrund');
for (const [lage, z] of faelle) {
    const s = knopfZustand(z);
    for (const k of ['start', 'restart', 'stop']) {
        if (s[k].aktiv && s[k].grund) {
            pruefe(false, `${lage} → "${k}" ist aktiv, nennt aber einen Grund`,
                `"${s[k].grund}" — das liest sich wie ein Hindernis, das es nicht gibt`);
        }
    }
}
pruefe(true, 'geprueft');

console.log(fehler === 0
    ? `\n✅ Knopfzeile: ${faelle.length} Lagen, alle richtig geschaltet\n`
    : `\n❌ ${fehler} Abweichung(en)\n`);
process.exit(fehler === 0 ? 0 : 1);
