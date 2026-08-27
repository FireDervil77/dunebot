#!/usr/bin/env node
/**
 * Steht jedes Recht aus den `permissions.json` auch wirklich in der Datenbank?
 *
 * **Der Anlass.** Am 2026-08-27 stand beim Dashboard-Start eine Zeile im
 * Protokoll:
 *
 *     Fehler beim Registrieren von Permission DISCORD.ROLEMENUS.MANAGE:
 *       Data too long for column 'description_translation_key' at row 1
 *
 * Danach existierte das Recht nicht. **Ein Recht, das nicht in
 * `permission_definitions` steht, laesst sich keiner Gruppe zuteilen** —
 * `hasPermission` findet nichts und verweigert. Die Richtung ist die
 * harmlosere (gesperrt statt offen), aber die Funktion dahinter ist fuer
 * *jeden* unerreichbar, und niemand sucht die Ursache in einer Spaltenbreite.
 *
 * Es ist dasselbe Muster wie bei `STREAMING.TEST` (ein Recht ohne Aufrufer)
 * und bei der Zusage vom 2026-08-26 (angemeldet, aber nicht anklickbar): Etwas
 * ist vorhanden und wirkt trotzdem nicht.
 *
 * ## Was geprueft wird
 *
 *   1. Jeder Schluessel aus jeder `permissions.json` steht in der Datenbank.
 *   2. Kein Text ist laenger als seine Spalte — die Falle, bevor sie zuschnappt.
 *   3. Jedes `requires` zeigt auf ein Recht, das es gibt.
 *
 * **Liest nur, aendert nichts.** Braucht eine erreichbare Datenbank.
 *
 *   node scripts/check-rechte-registriert.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../apps/dashboard/.env'), quiet: true });

const mysql = require('mysql2/promise');

let faelle = 0;
let abweichungen = 0;

/**
 * @param {boolean} gut Bedingung
 * @param {string} text Beschreibung
 * @param {string} [zusatz] Ergaenzung
 * @returns {void}
 */
function pruefe(gut, text, zusatz = '') {
    faelle++;
    if (!gut) abweichungen++;
    console.log(`  ${gut ? '✓' : '✗'} ${text}${zusatz ? '  — ' + zusatz : ''}`);
}

/**
 * Alle `permissions.json` im Haus.
 *
 * @returns {Array<{plugin: string, datei: string, rechte: Array}>} Fundstellen
 */
function dateienSammeln() {
    const gefunden = [];
    const wurzel = path.join(__dirname, '..');

    const kandidaten = [
        { plugin: 'kern', datei: path.join(wurzel, 'apps/dashboard/permissions.json') }
    ];
    const pluginVerz = path.join(wurzel, 'plugins');
    if (fs.existsSync(pluginVerz)) {
        for (const e of fs.readdirSync(pluginVerz, { withFileTypes: true })) {
            if (!e.isDirectory()) continue;
            kandidaten.push({
                plugin: e.name,
                datei: path.join(pluginVerz, e.name, 'dashboard', 'permissions.json')
            });
        }
    }

    for (const k of kandidaten) {
        if (!fs.existsSync(k.datei)) continue;
        try {
            const j = JSON.parse(fs.readFileSync(k.datei, 'utf8'));
            const rechte = (j.permissions || j || []).filter(r => r && r.key);
            gefunden.push({ ...k, rechte });
        } catch (err) {
            console.log(`  ✗ ${k.plugin}: permissions.json ist kein gueltiges JSON — ${err.message}`);
            abweichungen++;
            faelle++;
        }
    }

    return gefunden;
}

(async () => {

const c = await mysql.createConnection({
    host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT, user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE
});

const [spalten] = await c.query(`
    SELECT COLUMN_NAME, CHARACTER_MAXIMUM_LENGTH AS laenge
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'permission_definitions'
`);
const breite = new Map(spalten.map(z => [z.COLUMN_NAME, Number(z.laenge) || 0]));

const [zeilen] = await c.query('SELECT permission_key FROM permission_definitions');
const inDerDatenbank = new Set(zeilen.map(z => z.permission_key));

const quellen = dateienSammeln();
const alleSchluessel = new Set();
for (const q of quellen) for (const r of q.rechte) alleSchluessel.add(r.key);

console.log(`\nGefunden: ${quellen.length} Dateien, ${alleSchluessel.size} Rechte, `
          + `${inDerDatenbank.size} Zeilen in der Datenbank`);

console.log('\nSteht jedes Recht in der Datenbank?');
{
    for (const q of quellen) {
        const fehlend = q.rechte.map(r => r.key).filter(k => !inDerDatenbank.has(k));
        pruefe(fehlend.length === 0,
            `${q.plugin}: alle ${q.rechte.length} Rechte sind angelegt`,
            fehlend.length ? `FEHLT: ${fehlend.join(', ')}` : '');
    }
}

console.log('\nPasst jeder Text in seine Spalte?');
{
    // Die Falle vor dem Zuschnappen: Ein zu langer Text laesst das Recht beim
    // naechsten Start scheitern, und die Datenbank behaelt bis dahin den alten
    // Stand — der Fehler waere also erst nach einem Neustart sichtbar.
    const felder = [
        ['permission_key', r => r.key],
        ['name_translation_key', r => r.name],
        ['description_translation_key', r => r.description],
        ['category', r => r.category]
    ];

    const zuLang = [];
    for (const q of quellen) {
        for (const r of q.rechte) {
            for (const [spalte, hol] of felder) {
                const grenze = breite.get(spalte);
                const wert = hol(r);
                if (!grenze || !wert) continue;
                const laenge = [...String(wert)].length;
                if (laenge > grenze) zuLang.push(`${r.key}.${spalte} (${laenge} > ${grenze})`);
            }
        }
    }
    pruefe(zuLang.length === 0, 'kein Text ist laenger als seine Spalte',
        zuLang.length ? zuLang.join(', ') : `${alleSchluessel.size} Rechte geprueft`);

    // Und die Spalten muessen ueberhaupt Platz haben. `varchar(100)` fuer eine
    // erklaerende Beschreibung ist zu wenig — genau daran ist es gescheitert.
    pruefe((breite.get('description_translation_key') || 0) >= 255,
        'die Beschreibungsspalte fasst mindestens 255 Zeichen',
        `${breite.get('description_translation_key')} Zeichen`);
    pruefe((breite.get('name_translation_key') || 0) >= 255,
        'die Namensspalte ebenso',
        `${breite.get('name_translation_key')} Zeichen`);
}

console.log('\nZeigt jedes `requires` auf ein Recht, das es gibt?');
{
    // Ein `requires` auf einen Tippfehler macht das Recht unerreichbar, ohne
    // dass irgendwo etwas scheitert.
    const kaputt = [];
    for (const q of quellen) {
        for (const r of q.rechte) {
            if (!r.requires) continue;
            const noetig = typeof r.requires === 'string' ? [r.requires] : r.requires;
            for (const n of noetig) {
                if (!alleSchluessel.has(n) && !inDerDatenbank.has(n)) kaputt.push(`${r.key} → ${n}`);
            }
        }
    }
    pruefe(kaputt.length === 0, 'jede Voraussetzung zeigt auf ein bekanntes Recht',
        kaputt.length ? kaputt.join(', ') : 'alle');
}

await c.end();

console.log(abweichungen === 0
    ? `\nErgebnis: ${faelle} Pruefungen, 0 Abweichungen.\n`
    : `\nErgebnis: ${faelle} Pruefungen, ${abweichungen} Abweichung(en).\n`);

process.exit(abweichungen === 0 ? 0 : 1);

})().catch(err => { console.error('\nAbbruch:', err.message, '\n', err.stack); process.exit(1); });
