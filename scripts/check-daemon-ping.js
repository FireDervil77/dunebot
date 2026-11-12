#!/usr/bin/env node
/**
 * Der Daemon-Ping ist eine Messung, kein Artefakt (K346, 2026-11-12).
 *
 * Bis dahin rechnete IPMServer `Date.now() − payload.timestamp × 1000`. Der
 * Daemon schickt ganze Sekunden; heraus kam der Bruchteil der laufenden
 * Sekunde (auf 54, derselben VM, konstant ~917 ms), keine Laufzeit. Mit
 * Millisekunden wäre es der Uhrenversatz zweier Maschinen geworden.
 *
 * Jetzt misst der Daemon selbst: Jeder Herzschlag trägt `folge`, das Ack
 * gibt sie zurück, der nächste Herzschlag bringt `ping_ms` (rundlauf.go).
 *
 * Geprüft: IPMServer rechnet nichts mehr aus dem Zeitstempel; das Ack trägt
 * die Nummer; ein gemessener Wert wird gespeichert; eine Runde ohne Messung
 * lässt den letzten Wert stehen; ein Daemon ohne Messung (ohne `folge`) leert
 * die Spalte, statt einen alten Wert als Ping stehen zu lassen.
 *
 *   node scripts/check-daemon-ping.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare } = require('./lib/quelltext');

const still = () => {};
ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });

const WURZEL = path.join(__dirname, '..');
const abfragen = [];
ServiceManager.register('dbService', {
    async query(sql, werte) { abfragen.push({ sql: String(sql), werte }); return { affectedRows: 1 }; },
});

const RootServer = require(path.join(WURZEL, 'plugins/masterserver/dashboard/models/RootServer.js'));
const IPMServer = require(path.join(WURZEL, 'apps/dashboard/helpers/IPMServer.js'));

let fehler = 0;
async function pruefe(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); }
    catch (e) { fehler++; console.log(`  ✗ ${name}\n      ${e.message}`); }
}

(async () => {
    console.log('check-daemon-ping');

    await pruefe('IPMServer rechnet keinen Ping mehr aus dem Herzschlag-Zeitstempel', () => {
        const ipm = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'apps/dashboard/helpers/IPMServer.js'), 'utf8'));
        assert(!/timestamp\s*\*\s*1000/.test(ipm), 'IPMServer rechnet noch `timestamp * 1000`');
        assert(/payload\.ping_ms/.test(ipm), 'IPMServer liest `payload.ping_ms` nicht');
    });

    await pruefe('Daemon: Herzschlag trägt folge und ping_ms, Ack wird an der Nummer gemessen', () => {
        const client = ohneKommentare(fs.readFileSync('/home/firedervil/firebot_daemon/internal/websocket/client.go', 'utf8'));
        assert(/payload\["folge"\]\s*=\s*c\.rundlauf\.start\(/.test(client), 'sendHeartbeat vergibt keine Nummer');
        assert(/payload\["ping_ms"\]\s*=\s*dauer\.Milliseconds\(\)/.test(client), 'sendHeartbeat schickt kein ping_ms');
        assert(/c\.rundlauf\.ack\(folgeAus\(msg\)/.test(client), 'heartbeat_ack misst nicht an der Nummer');
        assert(fs.existsSync('/home/firedervil/firebot_daemon/internal/websocket/rundlauf.go'), 'rundlauf.go fehlt');
    });

    // Herzschläge durch den echten Handler, Modell und Sendeweg als Attrappen.
    const ipm = new IPMServer();
    ipm.Logger = ServiceManager.get('Logger');
    const gesendet = [];
    ipm._sende = (ws, nachricht) => gesendet.push(nachricht);
    ipm.innenhaut = null;
    ipm.connections.set('d54', { ws: {}, metadata: { guild_id: 'g1' }, lastHeartbeat: 0 });
    const verbucht = [];
    RootServer.processHeartbeat = async (daemonId, ms) => verbucht.push([daemonId, ms]);

    await pruefe('gemessener Wert wird verbucht, das Ack gibt die Nummer zurück', async () => {
        gesendet.length = 0; verbucht.length = 0;
        await ipm._handleHeartbeat('d54', { daemon_id: 'd54', timestamp: 1762950000, folge: 12, ping_ms: 23 });
        assert.deepStrictEqual(verbucht, [['d54', 23]]);
        const ack = gesendet.find(n => n.type === 'heartbeat_ack');
        assert(ack, 'kein heartbeat_ack gesendet');
        assert.strictEqual(ack.folge, 12, 'Ack trägt die Nummer nicht');
    });

    await pruefe('Runde ohne Messung (Nummer da, kein ping_ms) lässt den letzten Wert stehen', async () => {
        verbucht.length = 0;
        await ipm._handleHeartbeat('d54', { daemon_id: 'd54', timestamp: 1762950030, folge: 13 });
        assert.deepStrictEqual(verbucht, [['d54', undefined]]);
    });

    await pruefe('Daemon ohne Messung (keine Nummer) leert die Spalte statt eines Artefakts', async () => {
        verbucht.length = 0;
        await ipm._handleHeartbeat('d54', { daemon_id: 'd54', timestamp: 1762950060 });
        assert.deepStrictEqual(verbucht, [['d54', null]]);
    });

    await pruefe('unbrauchbares ping_ms zählt wie keine Messung', async () => {
        verbucht.length = 0;
        await ipm._handleHeartbeat('d54', { daemon_id: 'd54', folge: 14, ping_ms: 'schnell' });
        assert.deepStrictEqual(verbucht, [['d54', undefined]]);
    });

    // Das Modell: drei Fälle, drei SQL-Formen.
    const Modell = require(path.join(WURZEL, 'plugins/masterserver/dashboard/models/RootServer.js'));
    delete require.cache[require.resolve(path.join(WURZEL, 'plugins/masterserver/dashboard/models/RootServer.js'))];
    const Frisch = require(path.join(WURZEL, 'plugins/masterserver/dashboard/models/RootServer.js'));
    assert.notStrictEqual(Frisch.processHeartbeat, Modell.processHeartbeat);

    await pruefe('Modell: Zahl schreibt last_ping_ms', async () => {
        abfragen.length = 0;
        await Frisch.processHeartbeat('d54', 23);
        assert.strictEqual(abfragen.length, 1);
        assert(/last_ping_ms = \?/.test(abfragen[0].sql));
        assert.deepStrictEqual(abfragen[0].werte, ['online', 23, 'd54']);
    });
    await pruefe('Modell: undefined lässt last_ping_ms in Ruhe', async () => {
        abfragen.length = 0;
        await Frisch.processHeartbeat('d54', undefined);
        assert(!/last_ping_ms/.test(abfragen[0].sql), 'Spalte wurde angefasst');
        assert.deepStrictEqual(abfragen[0].werte, ['online', 'd54']);
    });
    await pruefe('Modell: null leert last_ping_ms', async () => {
        abfragen.length = 0;
        await Frisch.processHeartbeat('d54', null);
        assert(/last_ping_ms = \?/.test(abfragen[0].sql));
        assert.deepStrictEqual(abfragen[0].werte, ['online', null, 'd54']);
    });

    console.log(fehler ? `\n${fehler} Befund(e)` : '\nalles grün');
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
