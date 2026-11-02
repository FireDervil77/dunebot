#!/usr/bin/env node
/**
 * Die Fahrkartenkontrolle (FireBus Etappe 3, Linie V, F9).
 *
 * Was nicht im Fahrplan steht, in die falsche Richtung fährt, zu groß oder zu schnell
 * ist, fährt nicht mit und wird gemeldet. Was nie verloren gehen darf, fährt auch bei
 * zu hohem Tempo mit. Antworten fahren immer, und Nutzlasten landen nie in der Meldung.
 *
 *   node scripts/check-firebus-kontrolle.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const { ServiceManager } = require('dunebot-core');
ServiceManager.register('Logger', { warn() {}, info() {}, error() {}, debug() {} });

const firebus = require('../packages/firebus');
const FireBusKontrolle = require('../apps/dashboard/helpers/FireBusKontrolle');
const IPMServer = require('../apps/dashboard/helpers/IPMServer');
const migration = require('../migrations/kern/20261102_170000_firebus_kontrolle');
const { ohneKommentare } = require('./lib/quelltext');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 3).join('\n      ')}`); }
}
const neu = (mehr = {}) => new FireBusKontrolle({ db: () => ({ query: async () => [] }), ...mehr });
const gemeldet = (k) => [...k.meldungen].map(([s, n]) => [...s.split('\n').slice(1), n]);

(async () => {
    console.log('\nDie Tür');
    await pruefe('alles, was der Daemon laut Fahrplan sendet, fährt', () => {
        const k = neu();
        const seine = firebus.zeilen.filter(z => z.von === 'daemon');
        assert.ok(seine.length > 20, 'Fahrplan zu kurz');
        for (const z of seine) assert.strictEqual(k.pruefe('d1', z.name, 100), true, z.name);
        assert.strictEqual(k.meldungen.size, 0);
    });
    await pruefe('Unbekanntes und Namenloses bleibt draußen und wird gemeldet', () => {
        const k = neu();
        assert.strictEqual(k.pruefe('d1', 'gibt.es.nicht', 10), false);
        assert.strictEqual(k.pruefe('d1', undefined, 10), false);
        assert.deepStrictEqual(gemeldet(k), [['gibt.es.nicht', 'unbekannt', 1], ['(ohne Namen)', 'unbekannt', 1]]);
    });
    await pruefe('ein Befehl vom Daemon ist die falsche Richtung', () => {
        const k = neu();
        assert.strictEqual(k.pruefe('d1', 'gameserver.stop', 10), false);
        assert.deepStrictEqual(gemeldet(k), [['gameserver.stop', 'richtung', 1]]);
    });
    await pruefe('Tempo: Verlierbares bleibt draußen, was nie verloren gehen darf, fährt und wird gemeldet', () => {
        const k = neu({ tempoGrenze: 2, jetzt: () => 1000 });
        const nie = firebus.zeilen.find(z => z.von === 'daemon' && z.verlust === 'nie').name;
        const verlierbar = firebus.zeilen.find(z => z.von === 'daemon' && z.verlust !== 'nie').name;
        assert.ok(k.pruefe('d1', verlierbar, 1) && k.pruefe('d1', verlierbar, 1));
        assert.strictEqual(k.pruefe('d1', verlierbar, 1), false);
        assert.strictEqual(k.pruefe('d1', nie, 1), true);
        assert.deepStrictEqual(gemeldet(k).map(m => m[1]), ['tempo', 'tempo']);
        assert.strictEqual(k.pruefe('d2', verlierbar, 1), true, 'der Zähler gilt je Daemon');
    });
    await pruefe('eine neue Sekunde fängt bei null an', () => {
        let jetzt = 1000;
        const k = neu({ tempoGrenze: 1, jetzt: () => jetzt });
        const name = firebus.zeilen.find(z => z.von === 'daemon' && z.verlust !== 'nie').name;
        k.pruefe('d1', name, 1);
        assert.strictEqual(k.pruefe('d1', name, 1), false);
        jetzt = 2000;
        assert.strictEqual(k.pruefe('d1', name, 1), true);
    });
    await pruefe('Antworten fahren immer, und die Nutzlast erreicht die Kontrolle nie', () => {
        const fragen = [];
        const ipm = Object.create(IPMServer.prototype);
        ipm.kontrolle = { pruefe: (...a) => { fragen.push(a); return false; } };
        assert.strictEqual(ipm._kontrolliere('d1', { type: 'command_response', payload: { success: true } }, 5), true);
        assert.strictEqual(ipm._kontrolliere('d1', { type: 'RESPONSE' }, 5), true);
        assert.strictEqual(fragen.length, 0);
        assert.strictEqual(ipm._kontrolliere('d1', { type: 'event', namespace: 'x', action: 'y', payload: { rcon: 'geheim' } }, 5), false);
        assert.deepStrictEqual(fragen[0], ['d1', 'x.y', 5]);
    });
    await pruefe('die Tür steht vor dem Verteiler', () => {
        const t = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'apps/dashboard/helpers/IPMServer.js'), 'utf8'));
        const tuer = t.indexOf('this._kontrolliere(daemonId, message, data.length)');
        assert.ok(tuer > 0 && tuer < t.indexOf('await this._routeMessage(daemonId, message)'));
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
        await pruefe('zwei Takte derselben Stunde ergeben eine Zeile, und die Tür merkt sich nichts doppelt', async () => {
            const k = new FireBusKontrolle({ db: () => db });
            k.pruefe('d1', 'gibt.es.nicht', 10);
            k.pruefe('d1', 'gibt.es.nicht', 10);
            await k.schreibe();
            assert.strictEqual(k.meldungen.size, 0);
            k.pruefe('d1', 'gibt.es.nicht', 10);
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
    await pruefe('die Seite steht in der Navigation', () => {
        assert.match(fs.readFileSync(path.join(WURZEL, 'apps/dashboard/themes/default/partials/guild/sidebar.ejs'), 'utf8'), /url: '\/admin\/firebus'/);
    });

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ Die Kontrolle prüft, meldet und liest nichts mit');
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
