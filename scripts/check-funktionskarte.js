#!/usr/bin/env node
/**
 * Prueft die **Funktionskarte** und die Zerlegung der Ziele-Seite.
 *
 * Bis zum 2026-08-29 stand in `streaming-ziele.ejs` je Ziel EIN Formular mit
 * neunzehn Feldern und EINEM Speichern-Knopf. Wer die Follower-Meldungen
 * anhakte, schickte Ruhezeiten, Filter und Rollenzuordnung mit ab.
 *
 * Fuenf Regeln halten die Zerlegung zusammen. Drei davon sichern Fallen, die
 * beim Bau tatsaechlich zugeschnappt sind oder zugeschnappt waeren:
 *
 *   1. **Die Spalten der Karten ergeben genau die Spalten der Tabelle** - keine
 *      doppelt, keine vergessen. Eine vergessene Spalte waere kein Absturz,
 *      sondern ein Feld, das sich nicht mehr speichern laesst.
 *   2. **Jede Karte hat eine Route, jede Route eine Karte.** Ein Formular ohne
 *      Route liefert 404; eine Route ohne Formular ist totes Geraet.
 *   3. **Kein Formular im Formular.** Der Browser verwirft das innere lautlos -
 *      der Probe-Knopf taete dann nichts.
 *   4. **Jeder `form="…"`-Verweis trifft ein vorhandenes Formular.** Der
 *      Kopfschalter haengt daran. Ein Tippfehler macht ihn zur Attrappe, und
 *      die Maskierung von EJS hat genau das schon einmal getan
 *      (`id=&#34;k1&#34;` statt `id="k1"`).
 *   5. **Ein Schalter ohne Ziel bricht ab**, statt bedienbar auszusehen.
 *
 * Nebenwirkungsfrei: rendert Vorlagen, ruehrt weder Datenbank noch Netz.
 *
 *   node scripts/check-funktionskarte.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const WURZEL = path.join(__dirname, '..');
const KERN = path.join(WURZEL, 'apps/dashboard/themes/default/views');
const PV = path.join(WURZEL, 'plugins/streaming/dashboard/views');

let faelle = 0;
let abweichungen = 0;

/**
 * @param {boolean} gut Bedingung
 * @param {string} text Beschreibung
 * @param {string} [zusatz] Warum es zaehlt
 * @returns {void}
 */
function pruefe(gut, text, zusatz = '') {
    faelle++;
    if (gut) { console.log(`  ✓ ${text}`); return; }
    abweichungen++;
    console.log(`  ✗ ${text}`);
    if (zusatz) console.log(`      → ${zusatz}`);
}

/** @param {string} p Pfad ab Projektwurzel @returns {string} Inhalt */
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), 'utf8');

const KARTE = 'apps/dashboard/themes/default/views/shared/funktionskarte.ejs';

/**
 * Die Karte rendern.
 *
 * @param {Object} daten Werte
 * @returns {string} HTML
 */
const karte = (daten) => ejs.render(lies(KARTE), daten,
    { filename: path.join(KERN, 'shared/funktionskarte.ejs') });

(async () => {

// ---------------------------------------------------------------------
console.log('\n1. Die Funktionskarte selbst');
// ---------------------------------------------------------------------

pruefe(fs.existsSync(path.join(KERN, 'shared/funktionskarte.ejs')),
    'views/shared/funktionskarte.ejs existiert');

// Die zwei Kommentarfallen aus `seitenkopf.ejs` - hier noch einmal, weil sie
// beim Schreiben JEDER neuen Kernvorlage lauern.
const roh = lies(KARTE);
const beginn = roh.indexOf('/*' + '*');
const fliess = beginn === -1 ? '' : roh.slice(beginn + 3, roh.indexOf('*' + '/', beginn));
pruefe(!fliess.includes('*' + '/'), 'kein vorzeitiges Kommentarende im Fliesstext',
    'ein Pfadmuster mit Sternchen schliesst den JSDoc-Block, der Rest wird zu JavaScript');
pruefe(!fliess.includes('%' + '>'), 'kein EJS-Ende im Fliesstext',
    'schliesst den Block vorzeitig — „Could not find matching close tag"');

let ok = true;
try { karte({ titel: 'T', koerper: '<p>x</p>' }); } catch { ok = false; }
pruefe(ok, 'eine Karte ohne Formular rendert (reine Anzeige)');

for (const [was, daten] of [
    ['ohne `titel`',              { koerper: 'x' }],
    ['ohne `koerper`',            { titel: 'T' }],
    ['`schalter` ohne `aktion`',  { titel: 'T', koerper: 'x', id: 'a', schalter: { name: 'an', an: true } }],
    ['`schalter` ohne `id`',      { titel: 'T', koerper: 'x', aktion: '/a', schalter: { name: 'an', an: true } }]
]) {
    let brach = false;
    try { karte(daten); } catch { brach = true; }
    pruefe(brach, `${was} bricht laut ab`,
        'ein Schalter ohne Ziel sieht bedienbar aus und sendet nirgendwohin — genau die Attrappe, gegen die die Karte gebaut ist');
}

// **Die Maskierungsfalle.** Die erste Fassung setzte die Formular-Kennung ueber
// `<%= ... %>` zusammen; EJS maskierte die Anfuehrungszeichen zu `&#34;`, und
// der Kopfschalter fand sein Formular nicht mehr. Gerendert sieht man es sofort.
const mitSchalter = karte({ titel: 'T', koerper: 'x', id: 'k1', aktion: '/a',
                            csrfToken: 'M', darf: true, schalter: { name: 'aktiv', an: true } });
pruefe(/<form[^>]*\bid="k1"/.test(mitSchalter) && mitSchalter.includes('form="k1"'),
    'Kopfschalter und Formular sind unmaskiert verbunden',
    'EJS maskiert in `<%=` die Anfuehrungszeichen — dann steht dort id=&#34;k1&#34; und der Schalter sendet nichts');
pruefe(mitSchalter.includes('form-switch'), 'An/Aus ist ein Schalter, kein Kaestchen',
    'Hausregel: An/Aus = form-switch, Mehrfachauswahl = Kaestchen');
pruefe(!karte({ titel: 'T', koerper: 'x', aktion: '/a', darf: false }).includes('type="submit"'),
    'ohne Aenderungsrecht erscheint kein Speichern-Knopf');

// ---------------------------------------------------------------------
console.log('\n2. Die Karten decken die Tabelle genau ab');
// ---------------------------------------------------------------------

const { KARTEN_SPALTEN } = require(path.join(WURZEL, 'plugins/streaming/shared/models.js'));
const spalten = Object.values(KARTEN_SPALTEN).flat();

pruefe(spalten.length === new Set(spalten).size, 'keine Spalte steht in zwei Karten',
    'sonst ueberschreibt die eine Karte, was die andere gerade gespeichert hat');

// Der Bestand: die Spalten, die die abgeloeste Sammelroute schrieb. Sie stehen
// hier als Zahl, damit ein spaeteres Feld nicht lautlos ohne Karte bleibt.
pruefe(spalten.length === 17, `alle 17 Spalten haben eine Karte (gefunden: ${spalten.length})`,
    'eine Spalte ohne Karte laesst sich in der Oberflaeche nicht mehr aendern');

pruefe(KARTEN_SPALTEN.schalter && KARTEN_SPALTEN.schalter.length === 1
       && KARTEN_SPALTEN.schalter[0] === 'aktiv',
    '`aktiv` steht allein in seiner Karte',
    'es schaltet in 14 Abfragen ALLES ab — an der Ankuendigungskarte haette ein Schalter mit der Aufschrift „Ankuendigung" heimlich die Melder mitgenommen');

// ---------------------------------------------------------------------
console.log('\n3. Jede Karte hat eine Route — und jede Route eine Karte');
// ---------------------------------------------------------------------

const router = lies('plugins/streaming/dashboard/routes/guild.router.js');
const felder = router.slice(router.indexOf('const KARTEN_FELDER'), router.indexOf('KARTEN_MIT_ABONACHZUG'));
for (const name of Object.keys(KARTEN_SPALTEN)) {
    pruefe(new RegExp(`^\\s{4}${name}:`, 'm').test(felder),
        `Karte „${name}" wird im Router gelesen`,
        'ohne Eintrag in KARTEN_FELDER liefert ihr Formular einen Absturz');
}

pruefe(!/router\.post\('\/ziele\/:id',/.test(router),
    'die alte Sammelroute POST /ziele/:id ist weg',
    'sie schrieb alle 17 Spalten — ein Teilformular haette die uebrigen auf NULL gesetzt');
pruefe(!/module\.exports[\s\S]*\bzielSpeichern\b/.test(lies('plugins/streaming/shared/models.js')),
    '`zielSpeichern` ist geloescht, nicht nur ungenutzt',
    'ungenutztes Geraet versagt beim ersten Einsatz lautlos');

// ---------------------------------------------------------------------
console.log('\n4. Die gerenderte Seite: flach, verdrahtet, vollstaendig');
// ---------------------------------------------------------------------

const tr = (k) => `«${k}»`;
const daten = {
    tr, guildId: '42', csrfToken: 'M', hasPermission: () => true,
    meldung: null, fehler: null, liveRolleId: '900', fremdeTraeger: 0,
    zeitzone: 'Europe/Berlin', zonen: ['Europe/Berlin'],
    rollen: [{ id: '900', name: 'Live' }],
    zielkanaele: [{ id: '10', name: 'ank', istAnkuendigung: true }],
    sprachkanaele: [{ id: '20', name: 'Buehne' }],
    mitglieder: [{ id: '5551234567', name: 'FireDervil' }],
    melderArten: { raid: { label: 'Raid', hinweis: 'h' } },
    melderBeschreibung: () => ({ scope: null }),
    ziele: [{
        id: 7, streamer_id: 3, anzeigename: 'FireDervil', login: 'firedervil',
        channel_id: '10', rolle_id: '900', abo_rolle_id: '900', onair_channel: '20',
        melder_channel_id: '10', melder_arten: 'raid', filter_spiel: null,
        filter_titel: null, filter_spiel_aus: null, filter_titel_aus: null,
        ruhe_von: null, ruhe_bis: null, aufraeumen: 'bearbeiten', eigenes_bild: null,
        veroeffentlichen: 1, aktiv: 1, mitglied_id: '5551234567', vorlage: null,
        aboZusage: true, aboInhaber: 'F', melderScopes: []
    }]
};

let html = null;
try {
    html = await ejs.renderFile(path.join(PV, 'guild/streaming-ziele.ejs'), daten,
        { views: [KERN, PV, path.join(PV, 'guild')] });
} catch (err) {
    pruefe(false, 'streaming-ziele.ejs rendert', err.message.split('\n')[0]);
}

if (html) {
    pruefe(true, 'streaming-ziele.ejs rendert');

    const fehlend = Object.values(KARTEN_SPALTEN).flat()
        .filter(sp => !new RegExp(`name="${sp}"`).test(html));
    pruefe(fehlend.length === 0, 'jede Spalte hat ein Feld in der Seite',
        `ohne Feld ist die Spalte nicht mehr aenderbar: ${fehlend.join(', ')}`);

    let tiefe = 0, max = 0;
    html.replace(/<form|<\/form>/g, (m) => { tiefe += m === '<form' ? 1 : -1; max = Math.max(max, tiefe); return m; });
    pruefe(max === 1, 'kein Formular steckt in einem anderen',
        'der Browser verwirft das innere lautlos — der Probe-Knopf taete dann nichts');

    const ids = new Set([...html.matchAll(/<form[^>]*\bid="([^"]+)"/g)].map(m => m[1]));
    const verweise = new Set([...html.matchAll(/\bform="([^"]+)"/g)].map(m => m[1]));
    const tot = [...verweise].filter(v => !ids.has(v));
    pruefe(tot.length === 0, 'jeder form-Verweis trifft ein vorhandenes Formular',
        `ins Leere: ${tot.join(', ')} — die Knoepfe dort sind Attrappen`);

    // Jede Kartenadresse muss es als Route geben.
    const ziele = [...html.matchAll(/action="[^"]*\/ziele\/7\/([a-z]+)"/g)].map(m => m[1]);
    const ohneRoute = ziele.filter(z => !new RegExp(`'/ziele/:id/${z}'|\\\`/ziele/:id/\\\$\\{karte\\}\\\``).test(router)
                                        && !Object.keys(KARTEN_SPALTEN).includes(z));
    pruefe(ohneRoute.length === 0, 'jede Kartenadresse hat eine Route',
        `ohne Route: ${ohneRoute.join(', ')}`);
}

console.log(abweichungen === 0
    ? `\nErgebnis: ${faelle} Pruefungen, 0 Abweichungen.\n`
    : `\nErgebnis: ${faelle} Pruefungen, ${abweichungen} Abweichung(en).\n`);
process.exit(abweichungen === 0 ? 0 : 1);

})().catch(err => { console.error('\nAbbruch:', err.message, '\n', err.stack); process.exit(1); });
