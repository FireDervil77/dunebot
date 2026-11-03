#!/usr/bin/env node
/**
 * Daemon-Logs im Masterserver (2026-11-03): je Maschine, Export, Löschen.
 *
 * Befund des Betreibers: Die Seite zeigte nur die Logs EINES Rootservers, der Export
 * meldete „auf dieser Website nicht verfügbar", und Löschen tat nichts. Beide Routen
 * gab es nie.
 *
 * Gefahren werden die echten Routen aus guild.router.js mit echtem SQL, aber gegen
 * eine TEMPORARY-Kopie von `daemon_logs`, die nur diese Verbindung sieht. Gelöscht
 * wird nur in der Kopie, am Bestand nichts.
 *
 *   node scripts/check-daemon-logs.js
 */
'use strict';
const path = require('path');
const assert = require('assert');

const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const { ServiceManager } = require('dunebot-core');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').join('\n      ')}`); }
}

const meldungen = [];
ServiceManager.register('Logger', { info: (t) => meldungen.push(t), warn: () => {}, error: (t, e) => meldungen.push(`${t} ${e?.message || ''}`), debug: () => {} });

(async () => {
    const roh = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT, user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
    });
    // Eine Verbindung für alles: Nur sie sieht die TEMPORARY-Kopie.
    ServiceManager.register('dbService', {
        query: async (sql, p) => (await roh.query(sql, p))[0],
        rawQuery: async (sql, p) => (await roh.query(sql, p))[0],
        tableExists: async (t) => (await roh.query('SHOW TABLES LIKE ?', [t]))[0].length > 0,
        getConfig: async () => '30',
    });
    const gespurt = [];
    ServiceManager.register('ipmServer', { _logDaemonEvent: async (id, event, data) => { gespurt.push({ id, event, data }); } });

    const router = require('../plugins/masterserver/dashboard/routes/guild.router');
    const handler = (methode, pfad) => {
        const schicht = router.stack.find(l => l.route?.path === pfad && l.route.methods[methode]);
        assert.ok(schicht, `${methode.toUpperCase()} ${pfad} gibt es nicht`);
        const kette = schicht.route.stack;
        return kette[kette.length - 1].handle;
    };
    const rufe = async (methode, pfad, { query = {}, body = {} } = {}) => {
        const antwort = { status: 200, kopf: {}, json: null, text: null, ansicht: null };
        const res = {
            locals: { guildId: GUILD },
            status(c) { antwort.status = c; return this; },
            json(d) { antwort.json = d; return this; },
            setHeader(k, v) { antwort.kopf[k.toLowerCase()] = v; },
            type(t) { antwort.kopf['content-type'] = t; return this; },
            send(t) { antwort.text = t; return this; },
            redirect(u) { antwort.weiter = u; },
            render(v, d) { antwort.ansicht = { v, d }; },
        };
        ServiceManager.register('themeManager', { renderView: async (r, v, d) => { antwort.ansicht = { v, d }; } });
        await handler(methode, pfad)({ query, body, params: {}, session: { user: { info: { id: '1', username: 'waechter' } } } }, res);
        return antwort;
    };

    let GUILD;
    try {
        const [zeilen] = await roh.query(
            "SELECT guild_id, COUNT(*) n FROM rootserver WHERE daemon_id IS NOT NULL GROUP BY guild_id HAVING n >= 2 LIMIT 1");
        assert.ok(zeilen.length, 'keine Guild mit zwei Rootservern, die Probe mässe nichts');
        GUILD = zeilen[0].guild_id;
        const [maschinen] = await roh.query('SELECT daemon_id, name FROM rootserver WHERE guild_id = ? AND daemon_id IS NOT NULL ORDER BY id', [GUILD]);
        const [a, b] = maschinen;

        // Über einen Zwischennamen: Unter demselben Namen nimmt MySQL `LIKE` nicht an.
        await roh.query('CREATE TEMPORARY TABLE kopie_daemon_logs LIKE daemon_logs');
        await roh.query('CREATE TEMPORARY TABLE daemon_logs LIKE kopie_daemon_logs');
        const zeile = (d, level, action, meldung, meta = {}) => roh.query(
            `INSERT INTO daemon_logs (guild_id, daemon_id, event_type, level, action, message, metadata, created_at)
             VALUES (?, ?, 'status_change', ?, ?, ?, ?, NOW())`, [GUILD, d, level, action, meldung, JSON.stringify(meta)]);
        await zeile(a.daemon_id, 'info', 'reconnected', 'A wieder da');
        await zeile(a.daemon_id, 'warn', 'adresse_zurueck', 'A zurück', { grund: '<b>x</b>' });
        await zeile(b.daemon_id, 'info', 'reconnected', 'B wieder da');
        await zeile(b.daemon_id, 'error', 'heartbeat_lost', 'B weg');
        await zeile('fremd', 'error', 'x', 'gehört keiner Maschine dieser Guild');

        console.log('Anzeigen');
        await pruefe('ohne Wahl kommen beide Maschinen, mit Namen, Fremdes nicht', async () => {
            const r = await rufe('get', '/logs');
            const d = r.ansicht.d;
            assert.strictEqual(d.logs.length, 4);
            assert.deepStrictEqual(new Set(d.logs.map(l => l.maschine)), new Set([a.name, b.name]));
            assert.strictEqual(d.stats.total, 4);
            assert.strictEqual(d.maschinen.length, maschinen.length);
        });
        await pruefe('eine Maschine gewählt: nur ihre, Zahlen passen', async () => {
            const d = (await rufe('get', '/logs', { query: { daemon: b.daemon_id } })).ansicht.d;
            assert.deepStrictEqual(d.logs.map(l => l.message).sort(), ['B weg', 'B wieder da']);
            assert.deepStrictEqual([d.stats.total, d.stats.errors, d.gewaehlt], [2, 1, b.daemon_id]);
        });
        await pruefe('eine fremde daemon_id zeigt nicht deren Zeilen, sondern alle eigenen', async () => {
            const d = (await rufe('get', '/logs', { query: { daemon: 'fremd' } })).ansicht.d;
            assert.ok(!d.logs.some(l => l.daemon_id === 'fremd'));
            assert.strictEqual(d.gewaehlt, '');
        });
        await pruefe('Metadaten kommen als Objekt, nicht als Text', async () => {
            const d = (await rufe('get', '/logs', { query: { level: 'warn' } })).ansicht.d;
            assert.deepStrictEqual(d.logs.map(l => l.metadata), [{ grund: '<b>x</b>' }]);
        });

        console.log('\nExport');
        await pruefe('die Route gibt es, sie liefert eine Datei mit der Auswahl', async () => {
            const r = await rufe('get', '/logs/export', { query: { daemon: a.daemon_id } });
            assert.match(r.kopf['content-disposition'], /^attachment; filename="daemon-logs-[A-Za-z0-9._-]+-\d{4}-\d{2}-\d{2}\.json"$/);
            const inhalt = JSON.parse(r.text);
            assert.deepStrictEqual([inhalt.anzahl, inhalt.maschinen], [2, [a.name]]);
            assert.ok(inhalt.zeilen.every(z => z.maschine === a.name && z.meldung));
        });
        await pruefe('mit Level-Filter exportiert sie nur diese Stufe', async () => {
            const inhalt = JSON.parse((await rufe('get', '/logs/export', { query: { level: 'error' } })).text);
            assert.deepStrictEqual(inhalt.zeilen.map(z => z.meldung), ['B weg']);
        });

        console.log('\nLöschen');
        await pruefe('ohne den richtigen Namen wird nichts gelöscht', async () => {
            const r = await rufe('delete', '/logs', { body: { daemon: a.daemon_id, bestaetigung: 'falsch' } });
            assert.strictEqual(r.status, 400);
            const [[{ n }]] = await roh.query('SELECT COUNT(*) n FROM daemon_logs');
            assert.strictEqual(n, 5);
        });
        await pruefe('mit Namen: nur die gewählte Maschine, Spur und Log danach', async () => {
            gespurt.length = 0;
            const r = await rufe('delete', '/logs', { body: { daemon: a.daemon_id, bestaetigung: a.name } });
            assert.deepStrictEqual([r.status, r.json.success, r.json.anzahl], [200, true, 2]);
            const [rest] = await roh.query('SELECT daemon_id FROM daemon_logs');
            assert.ok(!rest.some(z => z.daemon_id === a.daemon_id));
            assert.strictEqual(rest.length, 3, 'die andere Maschine oder Fremdes ging mit');
            assert.deepStrictEqual(gespurt.map(s => [s.id, s.event, s.data.anzahl]), [[a.daemon_id, 'logs_geloescht', 2]]);
            assert.ok(meldungen.some(m => /2 Daemon-Log\(s\) gelöscht von waechter/.test(m)));
        });
        await pruefe('ALLE löscht jede Maschine der Guild, nie Fremdes', async () => {
            const r = await rufe('delete', '/logs', { body: { bestaetigung: 'ALLE' } });
            assert.strictEqual(r.json.anzahl, 2);
            const [rest] = await roh.query('SELECT daemon_id FROM daemon_logs');
            assert.deepStrictEqual(rest.map(z => z.daemon_id), ['fremd']);
        });
        await pruefe('Löschen verlangt das Recht DAEMON.MANAGE, Export das Recht LOGS.VIEW', async () => {
            const schicht = (m, p) => router.stack.find(l => l.route?.path === p && l.route.methods[m]).route.stack;
            assert.ok(schicht('delete', '/logs').length > 1 && schicht('get', '/logs/export').length > 1, 'keine Rechteprüfung davor');
            const quelle = require('fs').readFileSync(path.join(WURZEL, 'plugins/masterserver/dashboard/routes/guild.router.js'), 'utf8');
            assert.match(quelle, /router\.delete\('\/logs', requirePermission\('MASTERSERVER\.DAEMON\.MANAGE'\)/);
            assert.match(quelle, /router\.get\('\/logs\/export', requirePermission\('MASTERSERVER\.LOGS\.VIEW'\)/);
        });
    } finally {
        await roh.end();
    }

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ Jede Maschine hat ihr Log, und Export und Löschen gibt es wirklich');
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
