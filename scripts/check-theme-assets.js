#!/usr/bin/env node
'use strict';

/**
 * Prueft, ob jede eingereihte Asset-Kennung auch registriert ist — und ob die
 * dahinterliegenden Dateien existieren.
 *
 * Hintergrund: `enqueueScript('foo')` auf eine nicht registrierte Kennung tut
 * **nichts**. Kein Fehler, kein Protokolleintrag — die Datei fehlt einfach auf
 * der Seite, und man sucht den Grund im JavaScript statt in der Registrierung.
 * Beim Theme-Umbau waeren so beinahe die Bibliotheken des oeffentlichen
 * Frontends verschwunden: Sie standen nur im alten `theme.js`, und das neue
 * kannte sie nicht.
 *
 * Aufruf:  node scripts/check-theme-assets.js
 */

const fs = require('fs');
const path = require('path');

const WURZEL = path.resolve(__dirname, '..');
const THEMES = path.join(WURZEL, 'apps/dashboard/themes');

/** Alle Kennungen aus register*(...) einer Datei. */
function registrierte(datei) {
    const t = fs.readFileSync(datei, 'utf8');
    return new Set([...t.matchAll(/register(?:Vendor)?(?:Script|Style)\(\s*'([^']+)'/g)].map(m => m[1]));
}

/** Alle Kennungen aus enqueue*(...) einer Datei. */
function eingereihte(datei) {
    const t = fs.readFileSync(datei, 'utf8');
    return [...t.matchAll(/enqueue(?:Script|Style)\(\s*'([^']+)'/g)].map(m => m[1]);
}

function dateienUnter(verzeichnis, endungen) {
    const treffer = [];
    (function lauf(d) {
        if (!fs.existsSync(d)) return;
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            if (['node_modules', '.git', 'vendor'].includes(e.name)) continue;
            const p = path.join(d, e.name);
            if (e.isDirectory()) lauf(p);
            else if (endungen.some(x => e.name.endsWith(x))) treffer.push(p);
        }
    })(verzeichnis);
    return treffer;
}

let befunde = 0;

// ── 1. Je Theme: eingereiht, aber nicht registriert ────────────────────────
for (const theme of fs.readdirSync(THEMES)) {
    const themeJs = path.join(THEMES, theme, 'theme.js');
    if (!fs.existsSync(themeJs)) continue;

    const reg = registrierte(themeJs);
    const fehlend = eingereihte(themeJs).filter(h => !reg.has(h));

    if (fehlend.length) {
        console.log(`\n  ${theme}/theme.js — eingereiht, aber nicht registriert:`);
        [...new Set(fehlend)].forEach(h => console.log(`      ${h}`));
        befunde += fehlend.length;
    }
}

// ── 2. Projektweit: Kennungen, die niemand registriert ─────────────────────
// Plugins registrieren ihre eigenen; die zaehlen mit.
const alleReg = new Set();
for (const theme of fs.readdirSync(THEMES)) {
    const j = path.join(THEMES, theme, 'theme.js');
    if (fs.existsSync(j)) registrierte(j).forEach(h => alleReg.add(h));
}
for (const d of dateienUnter(path.join(WURZEL, 'plugins'), ['.js'])) {
    if (!d.includes('/dashboard/')) continue;
    registrierte(d).forEach(h => alleReg.add(h));
}

const offen = new Map();
for (const d of dateienUnter(path.join(WURZEL, 'plugins'), ['.js', '.ejs'])
        .concat(dateienUnter(path.join(WURZEL, 'apps/dashboard'), ['.js', '.ejs']))) {
    for (const h of eingereihte(d)) {
        if (!alleReg.has(h)) {
            if (!offen.has(h)) offen.set(h, []);
            offen.get(h).push(path.relative(WURZEL, d));
        }
    }
}

if (offen.size) {
    console.log('\n  Nirgends registriert, aber eingereiht:');
    for (const [h, wo] of offen) {
        console.log(`      ${h}   (${wo[0]}${wo.length > 1 ? ` +${wo.length - 1}` : ''})`);
        befunde++;
    }
}

// ── 3. Lokale Dateien, die es nicht gibt ───────────────────────────────────
for (const theme of fs.readdirSync(THEMES)) {
    const themeJs = path.join(THEMES, theme, 'theme.js');
    if (!fs.existsSync(themeJs)) continue;
    const t = fs.readFileSync(themeJs, 'utf8');

    // Auch registerVendorScript/-Style pruefen: Die zeigen zwar meist auf
    // Adressen, koennen aber ueber `vendor: true` ebenso auf eine Datei im
    // Theme verweisen (adminlte.min.css tut genau das). Diese Luecke hat beim
    // Umbau dazu gefuehrt, dass eine noch benoetigte Datei geloescht wurde,
    // ohne dass die Pruefung anschlug.
    for (const m of t.matchAll(/register(?:Vendor)?(?:Script|Style)\(\s*'([^']+)'\s*,\s*'([^']+)'/g)) {
        const [, handle, datei] = m;
        if (datei.startsWith('/') || datei.startsWith('http')) continue;
        const unter = datei.endsWith('.css') ? 'css' : 'js';
        const pfad = path.join(THEMES, theme, 'assets', unter, datei);
        const imStandard = path.join(THEMES, 'default', 'assets', unter, datei);
        if (!fs.existsSync(pfad) && !fs.existsSync(imStandard)) {
            console.log(`\n  ${theme}: '${handle}' zeigt auf ${datei} — Datei nicht gefunden`);
            befunde++;
        }
    }
}

console.log(befunde === 0
    ? '\n  Keine Befunde — jede eingereihte Kennung ist registriert und aufloesbar.\n'
    : `\n  ${befunde} Befund(e).\n`);

process.exit(befunde === 0 ? 0 : 1);
