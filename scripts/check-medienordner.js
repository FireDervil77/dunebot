#!/usr/bin/env node
/**
 * Prueft die Ordnerverwaltung der Medienablage.
 *
 * Der Betreiber am 2026-09-16: *„die Kategorieverwaltung ist wirklich
 * gröselig im Uploader."* Gemessen war sie das auch: Ein Ordner entstand durch
 * Tippen, deshalb lagen „icons" (18 Dateien) und „newicons" (65) nebeneinander.
 * Umbenennen gab es nicht, Mehrfachauswahl auch nicht — und der Haken auf der
 * Kachel sah aus wie eine Auswahl, markierte aber nur die geoeffnete Datei.
 *
 * Geprueft wird dreierlei:
 *   1. Der Ordnername — was durchgeht und was nicht, mit Begruendung.
 *   2. Die Wege am Server: vorhanden, mit Recht versehen, und der eine, der
 *      wirklich Dateien loescht, ist der einzige mit DELETE-Recht.
 *   3. Die Oberflaeche: Auswahl und „gerade geoeffnet" sind getrennt, und
 *      beim Hochladen wird nicht mehr frei getippt.
 *
 * Keine Datenbank, kein Netz.
 *
 *   node scripts/check-medienordner.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), 'utf8');

let geprueft = 0, gescheitert = 0;
function pruefe(was, ist, soll) {
    geprueft++;
    const gut = JSON.stringify(ist) === JSON.stringify(soll);
    if (!gut) gescheitert++;
    console.log(`  ${gut ? '✓' : '✗'} ${was}${gut ? '' : `: ${JSON.stringify(ist)} (soll: ${JSON.stringify(soll)})`}`);
}
function pruefeWahr(was, gut, hinweis = '') {
    geprueft++;
    if (!gut) gescheitert++;
    console.log(`  ${gut ? '✓' : '✗'} ${was}${gut || !hinweis ? '' : ` — ${hinweis}`}`);
}

// Dienste stellen, bevor der Pruefling geladen wird: `ServiceManager.get()`
// wirft, wenn etwas fehlt.
const { ServiceManager } = require('../packages/dunebot-core');
ServiceManager.register('Logger', { info(){}, warn(){}, error(){}, debug(){}, success(){} });

const router = require('../apps/dashboard/routes/guild/media.router');
const { ordnernamePruefen, VORGABE_ORDNER } = router;

// ---------------------------------------------------------------------------
console.log('\n1. Was ist ein gueltiger Ordnername?');
// ---------------------------------------------------------------------------
pruefe('"icons"', ordnernamePruefen('icons'), { ok: true, name: 'icons' });
pruefe('"banner-gross"', ordnernamePruefen('banner-gross'), { ok: true, name: 'banner-gross' });
pruefe('"2026"', ordnernamePruefen('2026'), { ok: true, name: '2026' });
pruefe('Leerraum aussen faellt weg', ordnernamePruefen('  icons  '), { ok: true, name: 'icons' });

console.log('\n   Und was nicht — jede Ablehnung muss sagen, warum');
for (const [wert, name] of [
    ['', 'leer'], ['   ', 'nur Leerraum'], [null, 'null'], [undefined, 'undefined'],
    ['Icons', 'Grossbuchstabe'], ['icons neu', 'Leerzeichen'], ['icons/neu', 'Schraegstrich'],
    ['../etc', 'Pfadwechsel'], ['ícons', 'Umlaut'], ['a'.repeat(51), 'zu lang'],
]) {
    const e = ordnernamePruefen(wert);
    pruefeWahr(`${name} wird abgelehnt`, e.ok === false, JSON.stringify(e));
    pruefeWahr(`… und nennt einen Grund`, e.ok === false && typeof e.fehler === 'string' && e.fehler.length > 15,
        JSON.stringify(e.fehler));
}
pruefeWahr('der Vorgabe-Ordner ist selbst gueltig', ordnernamePruefen(VORGABE_ORDNER).ok === true);

// ---------------------------------------------------------------------------
console.log('\n2. Die Wege am Server');
// ---------------------------------------------------------------------------
const quelle = ohneKommentare(lies('apps/dashboard/routes/guild/media.router.js'));

const WEGE = [
    ['/api/verschieben', 'CORE.MEDIA.UPLOAD'],
    ['/api/loeschen', 'CORE.MEDIA.DELETE'],
    ['/api/ordner/umbenennen', 'CORE.MEDIA.UPLOAD'],
    ['/api/ordner/loeschen', 'CORE.MEDIA.UPLOAD'],
];
for (const [weg, recht] of WEGE) {
    const muster = new RegExp(`router\\.post\\('${weg.replace(/\//g, '\\/')}',\\s*requirePermission\\('${recht.replace(/\./g, '\\.')}'\\)`);
    pruefeWahr(`POST ${weg} verlangt ${recht}`, muster.test(quelle));
}

// Der Kern der Sache: „Ordner aufloesen" darf KEINE Datei anfassen.
const aufloesen = quelle.slice(quelle.indexOf("router.post('/api/ordner/loeschen'"));
const aufloesenRumpf = aufloesen.slice(0, aufloesen.indexOf('\n});'));
pruefeWahr('„Ordner aufloesen" loescht keine Datei', !/unlinkSync/.test(aufloesenRumpf));
pruefeWahr('… sondern verschiebt sie in den Vorgabe-Ordner',
    /UPDATE guild_media SET folder = \?/.test(aufloesenRumpf));
pruefeWahr('… und der Vorgabe-Ordner selbst laesst sich nicht aufloesen',
    /ordner\.name === VORGABE_ORDNER/.test(aufloesenRumpf));

const bulkLoeschen = quelle.slice(quelle.indexOf("router.post('/api/loeschen'"));
pruefeWahr('das Mehrfach-Loeschen entfernt wirklich Dateien',
    /unlinkSync/.test(bulkLoeschen.slice(0, bulkLoeschen.indexOf('\n});'))));

// Fremde Kennungen: Ohne diese Pruefung koennte jemand in einer fremden Guild
// schreiben — die Kennungen sind fortlaufend.
pruefeWahr('Kennungen werden gegen die eigene Guild geprueft',
    /async function eigeneKennungen/.test(quelle));
pruefeWahr('… und die Abfrage bindet die Guild mit',
    /FROM guild_media WHERE guild_id = \? AND id IN/.test(quelle));
pruefeWahr('die alte Regex-Pruefung steht nur noch im Helfer',
    (quelle.match(/a-z0-9-\]\+\$|a-z0-9-\]\{1,50\}/g) || []).length === 1);

// ---------------------------------------------------------------------------
console.log('\n3. Die Oberflaeche');
// ---------------------------------------------------------------------------
const ansicht = ohneKommentareEjs(lies('apps/dashboard/themes/default/views/guild/media/index.ejs'));

pruefeWahr('das Freitextfeld beim Hochladen ist weg', !/id="upload-folder"/.test(ansicht));
pruefeWahr('… stattdessen eine Auswahl', /id="upload-folder-select"/.test(ansicht));
pruefeWahr('… mit einem Feld fuer einen neuen Ordner', /id="upload-folder-neu"/.test(ansicht));

pruefeWahr('der Haken haengt an der Mehrfachauswahl, nicht am Detailfenster',
    /\.media-item\.gewaehlt \.media-check/.test(ansicht));
pruefeWahr('… und NICHT mehr an `.selected`',
    !/\.media-item\.selected \.media-check/.test(ansicht));
pruefeWahr('Auswahl und geoeffnete Datei sind zwei Dinge',
    /const gewaehlt = new Set\(\)/.test(ansicht) && /let selectedMedia/.test(ansicht));

for (const knopf of ['btn-auswahl-verschieben', 'btn-auswahl-loeschen',
                     'btn-ordner-umbenennen', 'btn-ordner-aufloesen']) {
    pruefeWahr(`\`${knopf}\` ist verdrahtet`,
        new RegExp(`getElementById\\('${knopf}'\\)\\.addEventListener`).test(ansicht));
    pruefeWahr(`… und steht auch im Markup`, new RegExp(`id="${knopf}"`).test(ansicht));
}

pruefeWahr('gemeldet wird ueber showToast, nicht ueber alert',
    /showToast\(/.test(ansicht) && !/\balert\(/.test(ansicht));

console.log(`\nErgebnis: ${geprueft} Pruefungen, ${gescheitert} Abweichungen.`);
process.exit(gescheitert > 0 ? 1 : 0);
