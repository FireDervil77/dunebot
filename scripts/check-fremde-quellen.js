#!/usr/bin/env node
/**
 * Bibliotheken und Schriften vom eigenen Server (Kassensturz K279, 2026-11-07).
 *
 * Bis dahin luden Guild-Bereich, Anmeldung und Frontend jQuery, Toastr,
 * SortableJS, Font Awesome, Cropper und xterm von cdn.jsdelivr.net und
 * cdnjs.cloudflare.com, die Schriften von fonts.googleapis.com. Jeder
 * Seitenaufruf meldete dort die Adresse des Besuchers, ohne Einwilligung und
 * ohne Hinweis in der Datenschutzerklärung; fiel ein CDN aus, fehlten Icons,
 * Toasts oder die Konsole. Jetzt aus npm-Paketen unter /vendor (app.js),
 * xterm aus der Kopie des Gameserver-Plugins.
 *
 *   Quelltext  keine Ansicht, kein Theme, kein Stylesheet lädt Skript, Stil
 *              oder Schrift von einem fremden Host — ausgenommen Stripe und
 *              der Tag Manager (hinter der Einwilligung)
 *   CSP        gibt keine CDNs und kein Google Fonts mehr frei
 *   Lokal      jede /vendor-Adresse aus Theme, Schrift-CSS und Ansichten
 *              führt über die Tabelle in app.js zu einer Datei; jede Datei,
 *              die eine eingebundene Schrift-CSS nennt, ist da
 *
 * Was es nicht sieht: eine protokoll-relative Adresse (`src="//host/…"`) in
 * einer Ansicht. `ohneKommentareEjs` liest `//` als JavaScript-Kommentar und
 * schneidet die Zeile dort ab. In CSS und im Theme-Code wird sie gefunden.
 *
 *   node scripts/check-fremde-quellen.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const WURZEL = path.join(__dirname, '..');
const { ohneKommentare, ohneKommentareEjs, ohneKommentareCss } = require('./lib/quelltext');

let fehler = 0;
function pruefe(was, tun) {
    try { tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 12).join('\n      ')}`); }
}
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), 'utf8');

/** Erlaubte fremde Hosts für Skripte — nichts sonst. */
const ERLAUBT = ['js.stripe.com', 'www.googletagmanager.com'];

/** Ansichten, Theme-Code und eigene Stylesheets; keine mitgelieferten Bibliotheken. */
function quellen(ordner, liste = []) {
    for (const e of fs.readdirSync(path.join(WURZEL, ordner), { withFileTypes: true })) {
        if (['node_modules', 'vendor', 'public'].includes(e.name)) continue;
        const rel = path.join(ordner, e.name);
        if (e.isDirectory()) quellen(rel, liste);
        else if (/\.(ejs|css)$/.test(e.name) || /themes\/[^/]+\/theme\.js$/.test(rel)) liste.push(rel);
    }
    return liste;
}

/** Text ohne Kommentare, je nach Art der Datei. */
function code(rel) {
    if (rel.endsWith('.ejs')) return ohneKommentareEjs(lies(rel)).replace(/<!--[\s\S]*?-->/g, ' ');
    if (rel.endsWith('.css')) return ohneKommentareCss(lies(rel));
    return ohneKommentare(lies(rel));
}

/** Die Tabelle der Vendor-Pfade aus app.js: URL-Präfix → [Paket, Ordner]. */
function vendorTabelle() {
    const q = ohneKommentare(lies('apps/dashboard/app.js'));
    const block = q.slice(q.indexOf('for (const [urlPfad, [paket, ordner]] of Object.entries({'));
    const tab = {};
    for (const m of block.slice(0, block.indexOf('}))')).matchAll(/'([^']+)':\s*\['([^']+)',\s*'([^']*)'\]/g)) tab[m[1]] = [m[2], m[3]];
    return tab;
}

/** Eine /vendor-Adresse in eine Datei auf der Platte auflösen — oder null. */
function datei(url, tab) {
    const praefix = Object.keys(tab).filter(p => url === p || url.startsWith(p + '/')).sort((a, b) => b.length - a.length)[0];
    if (!praefix) return null;
    const [paket, ordner] = tab[praefix];
    let wurzel;
    try { wurzel = path.dirname(require.resolve(`${paket}/package.json`, { paths: [path.join(WURZEL, 'apps/dashboard')] })); }
    catch { return null; }
    const ziel = path.join(wurzel, ordner, url.slice(praefix.length).split('?')[0]);
    return fs.existsSync(ziel) ? ziel : null;
}

console.log('\nBibliotheken und Schriften vom eigenen Server (K279)');

pruefe('Quelltext: nichts lädt Skript, Stil oder Schrift von einem fremden Host', () => {
    const muster = [
        /<script[^>]*\bsrc=["'](https?:)?\/\/([^/"']+)/gi,
        /<link[^>]*\bhref=["'](https?:)?\/\/([^/"']+)[^>]*>/gi,
        /@import\s+(?:url\()?["']?(https?:)?\/\/([^/"')]+)/gi,
        /\burl\(\s*["']?(https?:)?\/\/([^/"')]+)/gi,
        /register(?:Vendor)?(?:Style|Script)\([^)]*["'](https?:)?\/\/([^/"']+)/gi,
    ];
    const funde = [];
    for (const rel of [...quellen('apps/dashboard/themes'), ...quellen('plugins')]) {
        const t = code(rel);
        // Im Theme-Code stehen Adressen als Zeichenkette (bis 2026-11-07 ein
        // ganzes `CDN`-Objekt), nicht in einem Aufruf.
        const hier = rel.endsWith('theme.js') ? [...muster, /['"`](https?:)?\/\/([^/'"`]+)/g] : muster;
        for (const m of hier) {
            for (const f of t.matchAll(m)) {
                const host = f[2];
                const ganz = f[0];
                // <link> ohne Stil-/Schrift-Bezug (z. B. kanonische Adresse, Discord-Einladung) zählt nicht
                if (ganz.startsWith('<link') && !/rel=["'](stylesheet|preload|preconnect|dns-prefetch|modulepreload)/i.test(ganz)) continue;
                if (!ERLAUBT.includes(host)) funde.push(`${rel}: ${host}`);
            }
        }
    }
    assert.deepStrictEqual([...new Set(funde)], []);
});

pruefe('CSP: keine CDNs, kein Google Fonts', () => {
    const q = ohneKommentare(lies('apps/dashboard/app.js'));
    const csp = q.slice(q.indexOf('contentSecurityPolicy:'), q.indexOf('contentSecurityPolicy:') + 4000);
    for (const host of ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'unpkg.com']) {
        assert.ok(!csp.includes(host), `${host} steht noch in der CSP`);
    }
});

pruefe('Lokal: jede /vendor-Adresse führt zu einer Datei, jede Schriftdatei ist da', () => {
    const tab = vendorTabelle();
    assert.ok(Object.keys(tab).length >= 10, `Tabelle in app.js nicht gelesen (${Object.keys(tab).length})`);
    const adressen = new Set();
    const sammle = (quelltext) => { for (const m of quelltext.matchAll(/['"(](\/vendor\/[^'")\s]+)/g)) adressen.add(m[1]); };
    sammle(code('apps/dashboard/themes/default/theme.js'));
    for (const rel of quellen('apps/dashboard/themes')) sammle(code(rel));
    assert.ok(adressen.size >= 15, `nur ${adressen.size} Adressen gefunden`);
    const fehlt = [];
    let schriften = 0;
    for (const url of adressen) {
        const ziel = datei(url, tab);
        if (!ziel) { fehlt.push(url); continue; }
        if (ziel.endsWith('.css') && url.startsWith('/vendor/schriften/')) {
            for (const m of ohneKommentareCss(fs.readFileSync(ziel, 'utf8')).matchAll(/url\((\.\/[^)]+)\)/g)) {
                schriften++;
                if (!fs.existsSync(path.join(path.dirname(ziel), m[1]))) fehlt.push(`${url} → ${m[1]}`);
            }
        }
    }
    assert.deepStrictEqual(fehlt, []);
    assert.ok(schriften >= 50, `nur ${schriften} Schriftdateien geprüft`);
});

pruefe('Lokal: die Konsole nimmt die xterm-Kopie des Gameserver-Plugins', () => {
    for (const f of ['xterm.min.css', 'xterm.min.js', 'xterm-addon-fit.min.js']) {
        assert.ok(fs.existsSync(path.join(WURZEL, 'plugins/gameserver/dashboard/assets/vendor/xterm', f)), `${f} fehlt`);
    }
    const teil = code('plugins/gameserver/dashboard/views/guild/partials/server-detail-console.ejs');
    assert.match(teil, /\/assets\/plugins\/gameserver\/vendor\/xterm\/xterm\.min\.js/);
});

console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ Bibliotheken und Schriften kommen vom eigenen Server');
process.exit(fehler ? 1 : 0);
