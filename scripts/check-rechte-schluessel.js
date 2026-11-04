#!/usr/bin/env node
/**
 * Fragt ein Plugin nur Rechte ab, die es auch definiert?
 *
 * Gefunden am 2026-11-04 beim Abgleich der Wissensdatenbank: DuneMap fragte
 * `DUNEMAP.ADMIN_MANAGE`, `DUNEMAP.SETTINGS_EDIT` und `DUNEMAP.MARKERS_CREATE`
 * ab, definiert sind `DUNEMAP.ADMIN.MANAGE` usw. Die Rechteprüfung wandelt nur
 * in Großbuchstaben, nicht `_` in `.` — Sektor-Karte, Einstellungen und das
 * Anlegen von Markern waren damit für jeden außer dem Besitzer gesperrt, auch
 * für die Administrator-Gruppe, die nur definierte Schlüssel bekommt.
 *
 * Geprüft wird je Plugin: Jeder Schlüssel mit dem Präfix des Plugins in
 * `requirePermission(…)`, `requireAnyPermission(…)`, `hasPermission(…)` oder
 * `capability: …` steht in dessen `dashboard/permissions.json`. Kommentare
 * zählen nicht (`ohneKommentare`).
 *
 *   node scripts/check-rechte-schluessel.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { ohneKommentare } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..', 'plugins');
const AUFRUF = /(?:requirePermission|requireAnyPermission|hasPermission)\(\s*'([A-Z][A-Z0-9_.]*)'|capability:\s*'([A-Z][A-Z0-9_.]*)'/g;

function dateien(ordner) {
    const aus = [];
    for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
        const p = path.join(ordner, e.name);
        if (e.isDirectory()) {
            if (['node_modules', 'vendor', 'migrations', 'assets'].includes(e.name)) continue;
            aus.push(...dateien(p));
        } else if (/\.(js|ejs)$/.test(e.name)) {
            aus.push(p);
        }
    }
    return aus;
}

let fehler = 0;
let geprueft = 0;
for (const plugin of fs.readdirSync(WURZEL).sort()) {
    const def = path.join(WURZEL, plugin, 'dashboard', 'permissions.json');
    if (!fs.existsSync(def)) continue;
    const schluessel = new Set((JSON.parse(fs.readFileSync(def, 'utf8')).permissions || []).map(p => p.key.toUpperCase()));
    const praefixe = new Set([...schluessel].map(k => k.split('.')[0] + '.'));

    for (const datei of dateien(path.join(WURZEL, plugin))) {
        const quelle = ohneKommentare(fs.readFileSync(datei, 'utf8'));
        for (const m of quelle.matchAll(AUFRUF)) {
            const k = (m[1] || m[2]).toUpperCase();
            if (k.endsWith('.*') || ![...praefixe].some(p => k.startsWith(p))) continue;
            geprueft++;
            if (!schluessel.has(k)) {
                fehler++;
                console.log(`  ✗ ${path.relative(path.join(__dirname, '..'), datei)}: '${k}' steht nicht in ${plugin}/dashboard/permissions.json`);
            }
        }
    }
}

if (fehler) {
    console.log(`\n❌ ${fehler} Abfrage(n) nach Rechten, die es nicht gibt. Gemeint ist meist der Schlüssel mit Punkten.`);
    process.exit(1);
}
console.log(`✅ ${geprueft} Rechteabfragen in Plugins, alle Schlüssel definiert.`);
