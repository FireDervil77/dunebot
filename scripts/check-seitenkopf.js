#!/usr/bin/env node
/**
 * Prueft den **gemeinsamen Seitenkopf** und den **Leerzustand** (Baustelle 83).
 *
 * Bis zum 2026-08-29 trugen sieben Plugins sieben Kopien desselben Kopfes
 * (automod 54 Zeilen, greeting 22, dazwischen alles), dazu neun Ansichten mit
 * handgebautem `page-header`. Wer die Kopfzeile aendern wollte, aenderte sie
 * sechzehnmal.
 *
 * Vier Regeln halten das zusammen — und zwei davon halten Fallen fest, die
 * beim Bau tatsaechlich zugeschnappt sind:
 *
 *   1. **Die data-Attribute bleiben plugin-spezifisch.** Die Seitenskripte
 *      lesen `dataset.automodBasis`, `dataset.ticketTexte` und so fort. Ein
 *      gemeinsames `data-basis` haette jedes dieser Skripte still blind
 *      gemacht — der Kopf saehe richtig aus, und die Knoepfe taeten nichts.
 *   2. **Kein `*` direkt gefolgt von `/` im Kopfkommentar.** Ein Pfadmuster
 *      wie `plugins/<stern>/dashboard` schliesst den JSDoc-Block vorzeitig;
 *      der Resttext wird als JavaScript gelesen und die Fehlermeldung lautet
 *      „Unexpected identifier". Genau so passiert.
 *   3. **Kein `%` direkt gefolgt von `>` im Kopfkommentar.** Schliesst den
 *      EJS-Block vorzeitig -> „Could not find matching close tag".
 *   4. **Kein Plugin baut den Kopf noch selbst.** Sonst faengt die Vervielfae
 *      ltigung von vorne an.
 *
 * Nebenwirkungsfrei: rendert Vorlagen, ruehrt weder Datenbank noch Netz.
 *
 *   node scripts/check-seitenkopf.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const WURZEL = path.join(__dirname, '..');
const KERN = path.join(WURZEL, 'apps/dashboard/themes/default/views');
const PLUGINS = ['streaming', 'greeting', 'ticket', 'moderation', 'giveaway', 'music', 'automod'];

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

(async () => {

// ---------------------------------------------------------------------
console.log('\n1. Die gemeinsamen Vorlagen liegen da, wo Plugins sie finden');
// ---------------------------------------------------------------------

for (const name of ['seitenkopf', 'leerzustand']) {
    pruefe(fs.existsSync(path.join(KERN, 'shared', `${name}.ejs`)),
        `views/shared/${name}.ejs existiert`,
        'unter `partials/` laege sie ausserhalb der View-Wurzeln — kein Plugin koennte sie per Namen einbinden');
}

// ---------------------------------------------------------------------
console.log('\n2. Die Fallen aus dem Kopfkommentar');
// ---------------------------------------------------------------------

for (const name of ['seitenkopf', 'leerzustand']) {
    const pfad = `apps/dashboard/themes/default/views/shared/${name}.ejs`;
    const inhalt = lies(pfad);

    // **Der Fliesstext des JSDoc-Blocks**, also zwischen `/**` und dem ERSTEN
    // Kommentarende. Die erste Fassung dieser Regel suchte im ganzen Kopf und
    // schlug am regulaeren Blockende an — sie haette jeden Kommentar verboten.
    const beginn = inhalt.indexOf('/*' + '*');
    const text = beginn === -1 ? '' : inhalt.slice(beginn + 3, inhalt.indexOf('*' + '/', beginn));

    pruefe(!text.includes('*' + '/'),
        `${name}: kein vorzeitiges Kommentarende im Fliesstext`,
        'ein Pfadmuster mit Sternchen schliesst den JSDoc-Block und der Rest wird zu JavaScript');
    pruefe(!text.includes('%' + '>'),
        `${name}: kein EJS-Ende im Fliesstext`,
        'schliesst den Block vorzeitig — „Could not find matching close tag"');

    // Und die Gegenprobe, die beide Fallen zugleich faengt: Sie muss rendern.
    let rendert = true;
    try {
        ejs.render(inhalt,
            { plugin: 'probe', titel: 'T', icon: 'i', guildId: '1' },
            { filename: path.join(KERN, 'shared', `${name}.ejs`) });
    } catch { rendert = false; }
    pruefe(rendert, `${name}: rendert ueberhaupt`,
        'beide Fallen zeigen sich erst hier — mit einer Meldung, die woanders hinzeigt');
}

// ---------------------------------------------------------------------
console.log('\n3. Ohne `plugin` bricht der Kopf ab, statt still zu wirken');
// ---------------------------------------------------------------------

let abgebrochen = false;
try {
    ejs.render(lies('apps/dashboard/themes/default/views/shared/seitenkopf.ejs'),
        { titel: 'X', icon: 'i', guildId: '1' },
        { filename: path.join(KERN, 'shared/seitenkopf.ejs') });
} catch { abgebrochen = true; }
pruefe(abgebrochen, 'ein Kopf ohne `plugin` scheitert laut',
    'sonst rendert er sauber und das Seitenskript findet seine data-Attribute nicht');

// ---------------------------------------------------------------------
console.log('\n4. Jedes Plugin rendert — mit SEINEM eigenen Attributnamen');
// ---------------------------------------------------------------------

const tr = (k) => `«${k}»`;
for (const pl of PLUGINS) {
    const rel = `plugins/${pl}/dashboard/views/guild/partials/${pl}-kopf.ejs`;
    const datei = path.join(WURZEL, rel);
    let html = null;
    try {
        html = ejs.render(lies(rel),
            { tr, guildId: '42', titel: 'Eine Seite', beschreibung: 'Text', icon: 'fa-solid fa-x' },
            { filename: datei, views: [KERN] });
    } catch (err) {
        pruefe(false, `${pl}: rendert`, err.message.split('\n')[0]);
        continue;
    }

    pruefe(html.includes(`data-${pl}-basis="/guild/42/plugins/${pl}"`),
        `${pl}: traegt data-${pl}-basis`,
        'die Seitenskripte lesen genau diesen Namen — ein gemeinsamer machte sie blind');
    pruefe(/class="page-pretitle"/.test(html) && /class="page-title"/.test(html),
        `${pl}: Vortitel und Titel stehen da`);
}

// ---------------------------------------------------------------------
console.log('\n5. Kein Plugin baut den Kopf noch selbst');
// ---------------------------------------------------------------------

for (const pl of PLUGINS) {
    const inhalt = lies(`plugins/${pl}/dashboard/views/guild/partials/${pl}-kopf.ejs`);
    pruefe(inhalt.includes("include('shared/seitenkopf'"),
        `${pl}-kopf.ejs reicht an den Kern durch`,
        'sonst faengt die Vervielfaeltigung von vorne an');
    pruefe(!/class="page-header/.test(inhalt),
        `${pl}-kopf.ejs hat kein eigenes page-header-Markup`);
}

// **Die Meldungstexte bleiben beim Plugin.** Im Kern waeren sie der Anfang
// eines Sammelbeckens — genau das, was die sieben Kopien so verschieden
// gemacht hat.
// Geprueft wird der **Code**, nicht der Kommentar: Im Anwendungsbeispiel oben
// steht `tr('streaming:TITLE')` voellig zu Recht. Die erste Fassung dieser
// Regel las die ganze Datei und meldete das eigene Beispiel als Verstoss.
const kernRoh = lies('apps/dashboard/themes/default/views/shared/seitenkopf.ejs');
const kernCode = kernRoh.slice(kernRoh.indexOf('*' + '/') + 2);
pruefe(!/tr\(['"](?:automod|ticket|music|giveaway|moderation|greeting|streaming):/.test(kernCode),
    'der Kern kennt keine Uebersetzungsschluessel eines Plugins',
    'sonst wird aus der Zusammenfuehrung ein Sammelbecken');

// ---------------------------------------------------------------------
console.log('\n6. Der Leerzustand zeigt nur, was es gibt');
// ---------------------------------------------------------------------

const leer = (daten) => ejs.render(lies('apps/dashboard/themes/default/views/shared/leerzustand.ejs'),
    daten, { filename: path.join(KERN, 'shared/leerzustand.ejs') });

const ohne = leer({ titel: 'Nichts da' });
pruefe(!ohne.includes('empty-subtitle') && !ohne.includes('empty-action'),
    'ohne Text und ohne Aktion bleiben beide Bloecke weg',
    'ein leerer Untertitel oder ein Knopf ohne Ziel ist eine Attrappe');

const mit = leer({ titel: 'T', text: 'U', aktion: '<a class="btn">Los</a>' });
pruefe(mit.includes('empty-subtitle') && mit.includes('empty-action') && mit.includes('<a class="btn">'),
    'mit Text und Aktion erscheinen beide — die Aktion unmaskiert');
pruefe(leer({ titel: 'T' }).includes('empty-icon'),
    'ein Symbol gibt es immer, auch ohne Angabe');

console.log(abweichungen === 0
    ? `\nErgebnis: ${faelle} Pruefungen, 0 Abweichungen.\n`
    : `\nErgebnis: ${faelle} Pruefungen, ${abweichungen} Abweichung(en).\n`);
process.exit(abweichungen === 0 ? 0 : 1);

})().catch(err => { console.error('\nAbbruch:', err.message, '\n', err.stack); process.exit(1); });
