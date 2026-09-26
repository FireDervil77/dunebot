#!/usr/bin/env node
/**
 * Prüft, dass keine Seite im Guild-Bereich ihren eigenen `user` an die Vorlage gibt.
 *
 * Anlass (2026-09-26, gemeldet vom Betreiber): Im Gameserver-Plugin fehlte der
 * Systembereich der Seitenleiste, in allen anderen Plugins nicht. Die
 * Seitenleiste liest `locals.user` und zeigt den Systembereich nur bei
 * `isOwner`/`hasSystemAccess`. Die Middleware setzt `res.locals.user =
 * req.session.user.info` — dort stehen beide. Die Marktplatz-Routen gaben aber
 * `user: req.session.user` mit, die Hülle OHNE `.info`: Render-Daten stechen
 * res.locals, und die Seitenleiste fand kein `isOwner`.
 *
 * Geprüft wird:
 *   1. die Ursache, am echten Partial: mit dem Nutzer der Middleware steht der
 *      Systembereich da, mit der Sitzungshülle nicht (so fällt auf, wenn sich
 *      die Seitenleiste ändert und die Prüfung 2 ins Leere misst);
 *   2. keine Route unter plugins/ oder den Guild-Routen des Kerns gibt `user`
 *      mit — außer in AUSNAHMEN, mit Grund.
 *
 *   node scripts/check-render-user.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { ohneKommentare } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');

/** Seiten ohne Seitenleiste des Guild-Bereichs — dort ist die Sitzungshülle die erwartete Form. */
const AUSNAHMEN = {
    'apps/dashboard/controllers/auth.controller.js': 'Anmeldeseiten, Frontend-Layout ohne Seitenleiste',
    'apps/dashboard/controllers/frontend.controller.js': 'öffentliche Seiten, Frontend-Layout ohne Seitenleiste',
};

let bestanden = 0;
function check(name, fn) {
    try { fn(); bestanden++; console.log(`  ✓ ${name}`); }
    catch (e) { process.exitCode = 1; console.log(`  ✗ ${name}\n      ${e.message}`); }
}

function dateien(ordner, liste = []) {
    for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === 'vendor') continue;
        const p = path.join(ordner, e.name);
        if (e.isDirectory()) dateien(p, liste);
        else if (e.name.endsWith('.js')) liste.push(p);
    }
    return liste;
}

console.log('\n1. Ursache am echten Partial');
const partial = path.join(WURZEL, 'apps/dashboard/themes/default/partials/guild/sidebar.ejs');
const info = { id: '1', isOwner: true, hasSystemAccess: true };
const rendern = (daten) => ejs.render(fs.readFileSync(partial, 'utf8'),
    { tr: (k, v) => v || k, guildId: 'g1', guildNav: [], activeMenu: '', ...daten }, { filename: partial });
check('mit dem Nutzer der Middleware steht der Systembereich da', () => {
    assert.ok(rendern({ user: info }).includes('/admin/addons'));
});
check('mit der Sitzungshülle (ohne .info) fehlt er — genau der gemeldete Fehler', () => {
    assert.ok(!rendern({ user: { info } }).includes('/admin/addons'));
});

console.log('\n2. Keine Route gibt einen eigenen user mit');
const orte = [...dateien(path.join(WURZEL, 'plugins')), ...dateien(path.join(WURZEL, 'apps/dashboard/routes')),
    ...dateien(path.join(WURZEL, 'apps/dashboard/controllers'))];
const funde = [];
for (const datei of orte) {
    // Ohne Kommentare: Ein Kommentar, der eine alte Render-Zeile zitiert, ist kein Fund.
    const text = ohneKommentare(fs.readFileSync(datei, 'utf8'));
    const re = /render(?:View)?\(\s*res\s*,\s*[^,]+,\s*\{([\s\S]{0,4000}?)\}\s*\)/g;
    let m;
    while ((m = re.exec(text))) {
        const block = m[1];
        const t = block.match(/(?:^|[\s,{])user\s*(?::\s*([^,\n}]+))?\s*[,}\n]/);
        if (!t) continue;
        const wert = (t[1] || 'user').trim();
        // Derselbe Gegenstand wie in res.locals — harmlos.
        if (/^res\.locals\.user\b/.test(wert)) continue;
        // Zeilennummer im ORIGINAL — ohneKommentare verschiebt die Zeilen. Der
        // Rohtext dient hier NUR der Positionssuche; gesucht wird oben im
        // kommentarfreien Text (check-waechter-prosa: BEKANNT, mit diesem Grund).
        const roh = fs.readFileSync(datei, 'utf8');
        const kopf = m[0].split('\n')[0].trim();
        const stelle = roh.indexOf(kopf);
        const zeile = stelle >= 0 ? roh.slice(0, stelle).split('\n').length : 0;
        funde.push({ datei: path.relative(WURZEL, datei), zeile, wert, davor: text.slice(0, m.index) });
    }
}
const ausnahmeGenutzt = new Set();
for (const f of funde) {
    if (AUSNAHMEN[f.datei]) { ausnahmeGenutzt.add(f.datei); continue; }
    // Kurzform `user,` — nachsehen, woher die Variable kommt.
    if (f.wert === 'user') {
        const herkunft = [...f.davor.matchAll(/(?:const|let)\s+user\s*=\s*([^;\n]+)/g)].pop();
        if (herkunft && /^res\.locals\.user\s*$/.test(herkunft[1].trim())) continue;
        f.wert = `user (${herkunft ? herkunft[1].trim() : 'Herkunft unbekannt'})`;
    }
    check(`${f.datei}:${f.zeile}`, () => assert.fail(`gibt user = ${f.wert} an die Vorlage — res.locals.user reicht, die Seitenleiste braucht dessen isOwner`));
}
check('jede Ausnahme wird noch gebraucht', () => {
    const tot = Object.keys(AUSNAHMEN).filter(d => !ausnahmeGenutzt.has(d));
    assert.deepStrictEqual(tot, [], 'Ausnahme ohne Fund — streichen');
});
check(`${orte.length} Dateien durchsucht, ${funde.length} Fund(e) mit eigenem user`, () => assert.ok(orte.length > 50));

console.log(`\n${bestanden} Prüfungen bestanden${process.exitCode ? ' — ES GIBT FEHLER' : ''}`);
