#!/usr/bin/env node
/**
 * Haben Deutsch und Englisch je Plugin dieselben Schlüssel, und gibt es jeden
 * Schlüssel, den der Code abfragt?
 *
 * Gefunden am 2026-11-06: Die deutsche Datei von Moderation führte die Texte
 * für Deafen, Undeafen, Kick und Move als `VDEAFEN_*` usw., der Code fragt
 * `VOICE.DEAFEN_*` ab. Auf einem deutschen Server antworteten die vier Befehle
 * mit dem rohen Schlüssel. Dazu englische Lücken in Core, DuneMap, Gameserver
 * und Greeting (Englisch fällt auf Deutsch zurück, `fallbackLng: "de-DE"`),
 * und `/tag` im Ticket-Plugin hatte gar keine Texte.
 *
 * Geprüft wird:
 *   1. Je `plugins/<plugin>/{bot,dashboard}/locales`: dieselben Schlüssel in
 *      de-DE und en-GB.
 *   2. Jeder feste Schlüssel `'<namensraum>:<SCHLÜSSEL>'` in `getT(`,
 *      `replyT(`, `tr(`, `t(`, `translate(` oder `description:` steht in
 *      beiden Sprachen der Sprachdatei, die die App lädt (Bot liest `bot/`,
 *      Dashboard liest `dashboard/`, siehe I18nManager.loadPluginTranslations).
 *      Zusammengesetzte Schlüssel (`'x:EVENT_' + s`) sind nicht prüfbar und
 *      werden ausgelassen. Kommentare zählen nicht (`ohneKommentare`).
 *
 *   node scripts/check-sprachdateien.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const SPRACHEN = ['de-DE', 'en-GB'];
const AUFRUF = /(?:\b(?:getT|replyT|tr|t|translate)\(\s*|\bdescription:\s*)(['"`])([a-z][a-z0-9_-]*):([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\1(?!\s*\+)/g;

function flach(obj, praefix = '', aus = new Set()) {
    for (const [k, v] of Object.entries(obj)) {
        const s = praefix ? `${praefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) flach(v, s, aus);
        else aus.add(s);
    }
    return aus;
}

function dateien(ordner) {
    const aus = [];
    for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
        const p = path.join(ordner, e.name);
        if (e.isDirectory()) {
            if (['node_modules', 'vendor', 'migrations', 'locales'].includes(e.name)) continue;
            aus.push(...dateien(p));
        } else if (/\.(js|ejs)$/.test(e.name)) {
            aus.push(p);
        }
    }
    return aus;
}

const rel = p => path.relative(WURZEL, p);
let fehler = 0;

// Namensraum → Plugin-Ordner (der Namensraum ist `name` aus package.json)
const ordnerVon = {};
const plugins = fs.readdirSync(path.join(WURZEL, 'plugins')).sort()
    .filter(p => fs.existsSync(path.join(WURZEL, 'plugins', p, 'package.json')));
for (const p of plugins) {
    ordnerVon[require(path.join(WURZEL, 'plugins', p, 'package.json')).name] = p;
}

// 1. Gleiche Schlüssel in beiden Sprachen
const schluessel = {}; // `${plugin}/${app}` → { 'de-DE': Set, 'en-GB': Set }
let dateienGeprueft = 0;
for (const p of plugins) {
    for (const app of ['bot', 'dashboard']) {
        const ordner = path.join(WURZEL, 'plugins', p, app, 'locales');
        if (!fs.existsSync(ordner)) continue;
        const je = {};
        for (const lng of SPRACHEN) {
            const datei = path.join(ordner, `${lng}.json`);
            if (!fs.existsSync(datei)) {
                fehler++;
                console.log(`  ✗ ${rel(datei)} fehlt`);
                je[lng] = new Set();
                continue;
            }
            je[lng] = flach(JSON.parse(fs.readFileSync(datei, 'utf8')));
            dateienGeprueft++;
        }
        schluessel[`${p}/${app}`] = je;
        const [a, b] = SPRACHEN;
        for (const [hat, fehlt] of [[a, b], [b, a]]) {
            for (const k of je[hat]) {
                if (je[fehlt].has(k)) continue;
                fehler++;
                console.log(`  ✗ ${rel(ordner)}: '${k}' steht in ${hat}, fehlt in ${fehlt}`);
            }
        }
    }
}

// 2. Abgefragte Schlüssel gibt es
function appVon(datei) {
    const r = rel(datei).split(path.sep);
    if (r[0] === 'apps') return r[1] === 'bot' ? 'bot' : r[1] === 'dashboard' ? 'dashboard' : null;
    if (r[0] === 'plugins') return ['bot', 'dashboard'].includes(r[2]) ? r[2] : null;
    return null;
}

let abfragen = 0;
const gemeldet = new Set();
for (const datei of [...dateien(path.join(WURZEL, 'plugins')), ...dateien(path.join(WURZEL, 'apps'))]) {
    const roh = fs.readFileSync(datei, 'utf8');
    const quelle = datei.endsWith('.ejs') ? ohneKommentareEjs(roh) : ohneKommentare(roh);
    for (const m of quelle.matchAll(AUFRUF)) {
        const [, , ns, k] = m;
        const p = ordnerVon[ns];
        if (!p) continue;
        const app = appVon(datei);
        if (!app) {
            fehler++;
            console.log(`  ✗ ${rel(datei)}: '${ns}:${k}' — unklar, ob Bot oder Dashboard die Datei lädt`);
            continue;
        }
        abfragen++;
        const je = schluessel[`${p}/${app}`];
        for (const lng of SPRACHEN) {
            if (je && je[lng].has(k)) continue;
            const id = `${rel(datei)}|${ns}:${k}|${lng}`;
            if (gemeldet.has(id)) continue;
            gemeldet.add(id);
            fehler++;
            console.log(`  ✗ ${rel(datei)}: '${ns}:${k}' fehlt in plugins/${p}/${app}/locales/${lng}.json`);
        }
    }
}

if (fehler) {
    console.log(`\n❌ ${fehler} Lücke(n) in den Sprachdateien der Plugins.`);
    process.exit(1);
}
console.log(`✅ ${dateienGeprueft} Sprachdateien mit gleichen Schlüsseln, ${abfragen} feste Abfragen, alle vorhanden.`);
