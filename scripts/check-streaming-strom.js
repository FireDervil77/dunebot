#!/usr/bin/env node
/**
 * Prueft den Weg vom Kern in die offene Zustandsseite (Stufe 7).
 *
 * Der Strom ist die Sorte Mechanik, die **lautlos** versagt. Ein vertippter
 * Ereignisname, ein vergessenes `starten()`, ein Zuhoerer ohne Melder - nichts
 * davon wirft, nichts davon steht im Protokoll. Die Seite sieht aus wie immer,
 * sie hoert nur auf, sich zu bewegen. Genau deshalb steht hier ein Waechter
 * und nicht nur ein Kommentar.
 *
 * Fuenf Regeln:
 *
 *   1. Ein Signal traegt KEINE Inhalte - nur `streamerId`, `guildId`, `grund`
 *   2. `sseManager` kommt im Kern nicht vor
 *   3. Es gibt mindestens einen Melder UND einen Zuhoerer
 *   4. `strom.starten()` wird wirklich aufgerufen
 *   5. Der Kanalname im Browser deckt sich mit `strom.KANAL`
 *   6. Beide Zustandsrouten pruefen das Recht
 *
 *   node scripts/check-streaming-strom.js
 *
 * Exitcode 1 bei jeder Verletzung.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '../plugins/streaming');
let verstoesse = 0;

/**
 * @param {string} rel Pfad unterhalb des Plugins
 * @returns {string} Inhalt, roh
 */
function lies(rel) {
    return fs.readFileSync(path.join(WURZEL, rel), 'utf8');
}

/**
 * Derselbe Inhalt, aber ohne Kommentare.
 *
 * **Das ist keine Kosmetik, sondern der Unterschied zwischen Waechter und
 * Zierde.** Bei der Gegenprobe am 2026-08-25 blieb Regel 3 gruen, obwohl der
 * Zuhoerer abgemeldet war: Ich hatte ihn mit `//` stillgelegt, und die Suche
 * fand ihn im Kommentar weiter. Derselbe Fehler wie am 2026-08-25 beim
 * Schichten-Waechter - dort suchte er nach `fragBot(` und die Probe schrieb
 * `fragBot`. Ein Waechter muss lesen, was laeuft, nicht was dasteht.
 *
 * @param {string} rel Pfad unterhalb des Plugins
 * @returns {string} nur Code
 */
function liesCode(rel) {
    return lies(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map(z => z.replace(/\/\/.*$/, ''))
        .join('\n');
}

/**
 * @param {string} regel Beschreibung
 * @param {Array<string>} fehler Fundstellen
 */
function melde(regel, fehler) {
    if (!fehler.length) {
        console.log(`  ✓ ${regel}`);
        return;
    }
    verstoesse += fehler.length;
    console.log(`  ✗ ${regel}`);
    fehler.forEach(f => console.log(`      ${f}`));
}

console.log('\nStrom zum Browser');

// ---------------------------------------------------------------------------
// Regel 1: Ein Signal traegt keine Inhalte.
//
// Die wichtigste Regel hier, und die einzige mit Folgen ueber die Optik
// hinaus. Der Strom geht an JEDEN Browser, der die Guild offen hat - abgeholt
// wird ueber eine Route mit `requirePermission`. Wer dem Signal Daten
// mitgibt, umgeht diese Pruefung, ohne es zu merken: Es gibt keinen Fehler,
// die Daten sind einfach da.
// ---------------------------------------------------------------------------
const ERLAUBT = new Set(['streamerId', 'guildId', 'grund']);

function meldeAufrufe() {
    const fehler = [];

    for (const rel of ['dashboard/kern/takt.js', 'dashboard/ausgabe/drossel.js',
        'dashboard/kern/abgleich.js', 'dashboard/kern/aufraeumen.js',
        'dashboard/ausgabe/liverolle.js', 'dashboard/ausgabe/meldung.js']) {
        const voll = path.join(WURZEL, rel);
        if (!fs.existsSync(voll)) continue;

        const inhalt = liesCode(rel);

        const muster = /\bmelden\(\s*\{([^}]*)\}/g;
        let treffer;
        while ((treffer = muster.exec(inhalt)) !== null) {
            const zeile = inhalt.slice(0, treffer.index).split('\n').length;
            for (const stueck of treffer[1].split(',')) {
                const name = stueck.split(':')[0].trim();
                if (!name) continue;
                if (!ERLAUBT.has(name)) {
                    fehler.push(`${rel}:${zeile} — Signal traegt "${name}"; erlaubt sind nur ${[...ERLAUBT].join(', ')}`);
                }
            }
        }
    }
    return fehler;
}

melde('Ein Signal traegt keine Inhalte', meldeAufrufe());

// ---------------------------------------------------------------------------
// Regel 2: Der Kern kennt den SSEManager nicht.
// ---------------------------------------------------------------------------
melde('sseManager kommt im Kern nicht vor', (() => {
    const fehler = [];
    const kern = path.join(WURZEL, 'dashboard/kern');
    for (const name of fs.readdirSync(kern)) {
        if (!name.endsWith('.js')) continue;
        if (/sseManager/.test(liesCode(`dashboard/kern/${name}`))) {
            fehler.push(`dashboard/kern/${name} nennt sseManager`);
        }
    }
    return fehler;
})());

// ---------------------------------------------------------------------------
// Regel 3+4: Melder, Zuhoerer, und ein echter Aufruf von starten().
//
// Nach [[vorhanden-heisst-nicht-funktioniert]]: Der Zuhoerer allein beweist
// nichts. Wird `starten()` nie gerufen, haengt er nirgends - und das faellt
// erst auf, wenn jemand merkt, dass die Seite steht.
// ---------------------------------------------------------------------------
const strom = liesCode('dashboard/ausgabe/strom.js');
const index = liesCode('dashboard/index.js');

// **"Mindestens einer" ist zu schwach.** Genau diese Regel stand hier zuerst
// und blieb am 2026-08-25 gruen, waehrend die Melder in der Drossel
// verschwunden waren - takt.js hatte ja noch einen. Verloren gegangen waren
// sie durch ein `git checkout` in meiner eigenen Gegenprobe, also unbemerkt
// und ohne Fehler. Ein Waechter, der schon bei einem von zwei zufrieden ist,
// bewacht den, den man nicht verliert.
const MELDER = {
    'dashboard/kern/takt.js':        'Ereignis verarbeitet (live/beendet/geaendert)',
    'dashboard/ausgabe/drossel.js':  'Auftrag fertig oder aufgegeben'
};

melde('Jede Stelle, die melden soll, meldet auch', Object.entries(MELDER)
    .filter(([rel]) => !/\bmelden\(\s*\{/.test(liesCode(rel)))
    .map(([rel, wofuer]) => `${rel} meldet nicht mehr — ${wofuer}`));

melde('Der Strom hoert wirklich zu (signale.on)',
    /signale\.on\(\s*ZUSTAND/.test(strom) ? [] : ['ausgabe/strom.js meldet sich nicht am Signalweg an']);

melde('strom.starten() wird aufgerufen',
    /require\('\.\/ausgabe\/strom'\)\.starten\(\)/.test(index)
        ? [] : ['dashboard/index.js startet den Strom nicht']);

// ---------------------------------------------------------------------------
// Regel 5: Derselbe Kanalname auf beiden Seiten.
//
// Der Fehler, der hier lauert, wirft nicht: Der Server sendet unter "streamng",
// der Browser hoert auf "streaming" - und beide halten sich fuer in Ordnung.
// ---------------------------------------------------------------------------
melde('Kanalname im Browser deckt sich mit strom.KANAL', (() => {
    const treffer = strom.match(/const KANAL = '([^']+)'/);
    if (!treffer) return ['strom.js hat keine Konstante KANAL'];

    const ansicht = liesCode('dashboard/views/guild/streaming-zustand.ejs');
    const hoert = new RegExp(`addEventListener\\(\\s*'${treffer[1]}'`).test(ansicht);
    return hoert ? [] : [`Ansicht hoert nicht auf '${treffer[1]}'`];
})());

// ---------------------------------------------------------------------------
// Regel 6: Beide neuen Routen pruefen das Recht.
// ---------------------------------------------------------------------------
melde('Zustandsrouten pruefen STREAMING.VIEW', (() => {
    const router = liesCode('dashboard/routes/guild.router.js');
    return ['/zustand/daten', '/zustand/strom'].flatMap(pfad => {
        const zeile = router.split('\n').find(z => z.includes(`'${pfad}'`) && z.includes('router.get'));
        if (!zeile) return [`Route ${pfad} nicht gefunden`];
        return /requirePermission\('STREAMING\.VIEW'\)/.test(zeile) ? [] : [`Route ${pfad} ohne Rechtepruefung`];
    });
})());

console.log(verstoesse === 0
    ? '\nErgebnis: 0 Verstoesse.\n'
    : `\nErgebnis: ${verstoesse} Verstoss/Verstoesse.\n`);

process.exit(verstoesse === 0 ? 0 : 1);
