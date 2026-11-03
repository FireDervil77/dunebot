#!/usr/bin/env node
/**
 * Die Fahrkartenkontrolle (FireBus Etappe 3, Linie V, F9), seit Paket 4 im Busbahnhof.
 *
 * Was nicht im Fahrplan steht, in die falsche Richtung fährt, zu groß oder zu schnell
 * ist, fährt nicht mit und wird gemeldet. Die Regeln selbst prüfen die Go-Tests
 * (`internal/bahnhof/tuer_test.go`, `paket4_test.go`), am echten Programm
 * `check-bus-dock.js`. Hier: Das Dashboard prüft nicht mehr selbst, es schreibt, was der
 * Bahnhof meldet, und die Gründe stimmen in Bahnhof, Dashboard und Tabelle überein.
 *
 *   node scripts/check-firebus-kontrolle.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const WURZEL = path.join(__dirname, '..');
const DAEMON = path.join(WURZEL, '..', 'firebot_daemon');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const { ServiceManager } = require('dunebot-core');
const warnungen = [];
ServiceManager.register('Logger', { warn: (t) => warnungen.push(t), info() {}, error() {}, debug() {} });

const FireBusKontrolle = require('../apps/dashboard/helpers/FireBusKontrolle');
const migration = require('../migrations/kern/20261102_170000_firebus_kontrolle');
const { ohneKommentare } = require('./lib/quelltext');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 3).join('\n      ')}`); }
}
const neu = () => new FireBusKontrolle({ db: () => ({ query: async () => [] }) });
const gemeldet = (k) => [...k.meldungen].map(([s, n]) => [...JSON.parse(s), n]);

(async () => {
    console.log('\nDie Tür steht im Bahnhof');
    await pruefe('das Dashboard prüft nicht mehr selbst', () => {
        const ipm = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'apps/dashboard/helpers/IPMServer.js'), 'utf8'));
        assert.doesNotMatch(ipm, /_kontrolliere|kontrolle\.pruefe/);
        assert.strictEqual(typeof FireBusKontrolle.prototype.pruefe, 'undefined');
        const tuer = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/bahnhof/bahnhof.go'), 'utf8'));
        assert.match(tuer, /b\.tuer\.pruefe\(absender, k\.name\(\), len\(daten\)\)/);
    });
    await pruefe('die Gründe sind in Bahnhof, Dashboard und Tabelle dieselben', () => {
        const go = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/bahnhof/tuer.go'), 'utf8'));
        const imBahnhof = [...go.matchAll(/grund\w+\s*=\s*"(\w+)"/g)].map(m => m[1]).sort();
        const tabelle = /ENUM\(([^)]*)\)/.exec(ohneKommentare(fs.readFileSync(path.join(WURZEL, 'migrations/kern/20261102_170000_firebus_kontrolle.js'), 'utf8')))[1]
            .match(/'(\w+)'/g).map(x => x.slice(1, -1)).sort();
        assert.deepStrictEqual(imBahnhof, Object.keys(FireBusKontrolle.GRUENDE).sort());
        assert.deepStrictEqual(tabelle, imBahnhof);
    });

    console.log('\nWas der Bahnhof meldet');
    await pruefe('Meldungen werden je Fall addiert, einmal ins Log geschrieben', () => {
        warnungen.length = 0;
        const k = neu();
        k.uebernimm([{ daemon: 'd1', name: 'gibt.es.nicht', grund: 'unbekannt', anzahl: 2 }]);
        k.uebernimm([{ daemon: 'd1', name: 'gibt.es.nicht', grund: 'unbekannt', anzahl: 3 }, { daemon: 'd1', name: 'gameserver.stop', grund: 'richtung', anzahl: 1 }]);
        assert.deepStrictEqual(gemeldet(k), [['d1', 'gibt.es.nicht', 'unbekannt', 5], ['d1', 'gameserver.stop', 'richtung', 1]]);
        assert.strictEqual(warnungen.length, 2, warnungen.join(' | '));
    });
    await pruefe('Unbekannte Gründe und Kaputtes werden übergangen', () => {
        const k = neu();
        k.uebernimm(null);
        k.uebernimm([null, { daemon: 'd1', name: 'x', grund: 'erfunden', anzahl: 1 }, { daemon: 'd1', name: 'x', grund: 'tempo', anzahl: 0 },
            { daemon: 'd1', name: 'x', grund: 'tempo', anzahl: 'viel' }]);
        assert.strictEqual(k.meldungen.size, 0);
    });
    await pruefe('ein Name mit Zeilenumbruch zerlegt den Schlüssel nicht, lange Namen werden gekürzt', () => {
        const k = neu();
        k.uebernimm([{ daemon: 'd1', name: 'a\nb', grund: 'unbekannt', anzahl: 1 }, { daemon: 'd1', name: 'x'.repeat(200), grund: 'unbekannt', anzahl: 1 }]);
        const [[, eins], [, zwei]] = gemeldet(k);
        assert.strictEqual(eins, 'a\nb');
        assert.strictEqual(zwei.length, 80);
    });

    console.log('\nProtokoll, an einer Kopie');
    const roh = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT, user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
    });
    const db = {
        query: async (sql, p) => {
            const [r] = await roh.query(sql.replace('CREATE TABLE IF NOT EXISTS', 'CREATE TEMPORARY TABLE'), p);
            return r;
        },
    };
    try {
        await migration.up(db);
        await pruefe('zwei Takte derselben Stunde ergeben eine Zeile', async () => {
            const k = new FireBusKontrolle({ db: () => db });
            k.uebernimm([{ daemon: 'd1', name: 'gibt.es.nicht', grund: 'unbekannt', anzahl: 2 }]);
            await k.schreibe();
            assert.strictEqual(k.meldungen.size, 0);
            k.uebernimm([{ daemon: 'd1', name: 'gibt.es.nicht', grund: 'unbekannt', anzahl: 1 }]);
            await k.schreibe();
            const z = await db.query('SELECT name, grund, anzahl FROM firebus_kontrolle');
            assert.strictEqual(z.length, 1);
            assert.strictEqual(Number(z[0].anzahl), 3);
            assert.strictEqual(z[0].grund, 'unbekannt');
        });
    } finally {
        await roh.end();
    }

    console.log('\nSeite');
    await pruefe('die Seite zeichnet leer und gefüllt, und `settings` bleibt frei', () => {
        const ejs = require('ejs');
        const datei = path.join(WURZEL, 'apps/dashboard/themes/default/views/admin/firebus.ejs');
        const vorlage = fs.readFileSync(datei, 'utf8');
        const gruende = FireBusKontrolle.GRUENDE;
        assert.match(ejs.render(vorlage, { zeilen: [], gruende, fassung: 4 }), /Keine Meldungen/);
        const html = ejs.render(vorlage, { fassung: 4, gruende, zeilen: [{ zuletzt: new Date(), maschine: '<b>x</b>', name: 'a.b', grund: 'tempo', anzahl: '12' }] });
        assert.match(html, /Absender zu schnell/);
        assert.ok(!html.includes('<b>x</b>'), 'nicht escapet');
    });
    await pruefe('die Seite nennt den Bahnhof, seinen Fahrplan und eine Abweichung', () => {
        const ejs = require('ejs');
        const vorlage = fs.readFileSync(path.join(WURZEL, 'apps/dashboard/themes/default/views/admin/firebus.ejs'), 'utf8');
        const gruende = FireBusKontrolle.GRUENDE;
        const gleich = ejs.render(vorlage, { zeilen: [], gruende, fassung: 7, bahnhof: { fassung: 7, stand: '<i>abc</i>' } });
        assert.match(gleich, /Bahnhof &lt;i&gt;abc&lt;\/i&gt;, Fahrplan 7/);
        assert.doesNotMatch(gleich, /Dashboard 7|nicht angedockt/);
        assert.match(ejs.render(vorlage, { zeilen: [], gruende, fassung: 8, bahnhof: { fassung: 7, stand: 'abc' } }), /Dashboard 8/);
        assert.match(ejs.render(vorlage, { zeilen: [], gruende, fassung: 8, bahnhof: null }), /Bahnhof nicht angedockt/);
        const route = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'apps/dashboard/routes/admin.router.js'), 'utf8'));
        assert.match(route, /bahnhof: ServiceManager\.has\('ipmServer'\) \? \(ServiceManager\.get\('ipmServer'\)\.dock\?\.bahnhof/);
    });
    await pruefe('die Seite steht in der Navigation', () => {
        assert.match(fs.readFileSync(path.join(WURZEL, 'apps/dashboard/themes/default/partials/guild/sidebar.ejs'), 'utf8'), /url: '\/admin\/firebus'/);
    });

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ Der Bahnhof kontrolliert, das Dashboard schreibt, und die Gründe passen');
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
