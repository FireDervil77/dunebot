#!/usr/bin/env node
/**
 * FireBus, Etappe 0: Was die Zählung ergeben hat. Liest nur.
 *
 *   node scripts/firebus-zaehlung.js            letzte 24 Stunden
 *   node scripts/firebus-zaehlung.js --stunden 168
 */
'use strict';
const path = require('path');
const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const firebus = require('../packages/firebus');

const stunden = Number(process.argv[process.argv.indexOf('--stunden') + 1]) || 24;
const kb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1024).toFixed(1)} KB`);
const zahl = (x) => Number(x) || 0;
const wert = (x) => (x === null || x === undefined ? 'nicht gemessen' : `${Number(x).toFixed(2)} %`);

(async () => {
    const c = await mysql.createConnection({
        host: process.env.MYSQL_HOST, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE, port: process.env.MYSQL_PORT || 3306, dateStrings: true,
    });
    const [rootserver] = await c.query('SELECT daemon_id, id FROM rootserver');
    const maschine = new Map(rootserver.map(r => [r.daemon_id, `Rootserver ${r.id}`]));
    const [zeilen] = await c.query(
        'SELECT daemon_id, name, art, SUM(anzahl) AS anzahl, SUM(bytes) AS bytes, MAX(groesste) AS groesste, '
        + 'SUM(dauer_summe_ms) AS summe, MAX(dauer_max_ms) AS maxi, SUM(fristen) AS fristen '
        + 'FROM firebus_zaehlung WHERE stunde >= NOW() - INTERVAL ? HOUR GROUP BY daemon_id, name, art', [stunden]);
    const [last] = await c.query(
        'SELECT daemon_id, COUNT(*) AS n, AVG(cpu_prozent) AS cpu, MAX(cpu_prozent) AS cpu_max, MAX(ram_prozent) AS ram_max, '
        + 'AVG(druck_cpu) AS dc, MAX(druck_cpu) AS dc_max, AVG(druck_io) AS di, MAX(druck_io) AS di_max, MAX(druck_ram) AS dr_max '
        + 'FROM firebus_last WHERE zeit >= NOW() - INTERVAL ? HOUR GROUP BY daemon_id', [stunden]);

    console.log(`FireBus-Zählung der letzten ${stunden} Stunden, Fahrplan Fassung ${firebus.fassung}\n`);
    if (!zeilen.length) console.log('Keine Zeilen. Läuft das Dashboard schon mit der Zählung?\n');

    const verkehr = new Map();
    for (const z of zeilen.filter(x => x.art !== 'lesefaden')) {
        const v = verkehr.get(z.name) || { anzahl: 0, bytes: 0, groesste: 0, fristen: 0, summe: 0, maxi: 0, antworten: 0 };
        v.anzahl += zahl(z.anzahl); v.bytes += zahl(z.bytes); v.groesste = Math.max(v.groesste, zahl(z.groesste));
        v.fristen += zahl(z.fristen); v.maxi = Math.max(v.maxi, zahl(z.maxi));
        if (zahl(z.summe)) { v.summe += zahl(z.summe); v.antworten += zahl(z.anzahl); }
        verkehr.set(z.name, v);
    }
    const sekunden = stunden * 3600;
    console.log('Verkehr je Linie');
    const linien = {};
    for (const [name, v] of verkehr) {
        const l = firebus.zeile(name)?.linie || '?';
        linien[l] = linien[l] || { anzahl: 0, bytes: 0 };
        linien[l].anzahl += v.anzahl; linien[l].bytes += v.bytes;
    }
    for (const [l, v] of Object.entries(linien).sort((a, b) => b[1].anzahl - a[1].anzahl)) {
        console.log(`  ${l}  ${String(v.anzahl).padStart(9)} Nachrichten  ${(v.anzahl / sekunden).toFixed(2).padStart(8)} je s  ${kb(v.bytes).padStart(10)}`);
    }

    console.log('\nHäufigste Namen');
    for (const [name, v] of [...verkehr].sort((a, b) => b[1].anzahl - a[1].anzahl).slice(0, 15)) {
        console.log(`  ${name.padEnd(32)} ${String(v.anzahl).padStart(8)}  ${kb(v.bytes).padStart(10)}  größte ${kb(v.groesste)}`);
    }

    console.log('\nLangsamste Antworten');
    const langsam = [...verkehr].filter(([, v]) => v.antworten).sort((a, b) => b[1].maxi - a[1].maxi).slice(0, 10);
    for (const [name, v] of langsam) {
        console.log(`  ${name.padEnd(32)} max ${String(v.maxi).padStart(7)} ms  Schnitt ${String(Math.round(v.summe / v.antworten)).padStart(6)} ms  ${v.antworten} Antworten`);
    }

    console.log('\nFristen abgelaufen');
    const fristen = [...verkehr].filter(([, v]) => v.fristen);
    if (!fristen.length) console.log('  keine');
    for (const [name, v] of fristen) console.log(`  ${name.padEnd(32)} ${v.fristen}`);

    console.log('\nBelegung des Lesefadens');
    const faden = zeilen.filter(z => z.art === 'lesefaden').sort((a, b) => zahl(b.maxi) - zahl(a.maxi));
    if (!faden.length) console.log('  keine Zahlen, der Daemon ist noch nicht neu gebaut');
    for (const z of faden.slice(0, 15)) {
        console.log(`  ${(maschine.get(z.daemon_id) || z.daemon_id).padEnd(14)} ${z.name.padEnd(32)} max ${String(zahl(z.maxi)).padStart(7)} ms  zusammen ${String(zahl(z.summe)).padStart(8)} ms  ${zahl(z.anzahl)}×`);
    }

    console.log('\nMaschinenlast');
    if (!last.length) console.log('  keine Zahlen');
    for (const l of last) {
        console.log(`  ${maschine.get(l.daemon_id) || l.daemon_id}, ${l.n} Messungen`);
        console.log(`    CPU ${wert(l.cpu)} im Schnitt, ${wert(l.cpu_max)} Spitze; RAM Spitze ${wert(l.ram_max)}`);
        console.log(`    Warten auf CPU ${wert(l.dc)} im Schnitt, ${wert(l.dc_max)} Spitze`);
        console.log(`    Warten auf Platte ${wert(l.di)} im Schnitt, ${wert(l.di_max)} Spitze`);
        console.log(`    Warten auf Speicher Spitze ${wert(l.dr_max)}`);
    }

    const unbekannt = [...verkehr.keys()].filter(n => !firebus.kennt(n));
    console.log('\nNicht im Fahrplan');
    console.log(unbekannt.length ? unbekannt.map(n => `  ${n}`).join('\n') : '  nichts');
    await c.end();
})().catch((e) => {
    console.error(/doesn't exist/.test(e.message) ? 'Die Tabellen fehlen noch, die Migration kommt mit dem Dashboard-Neustart.' : e);
    process.exit(1);
});
