#!/usr/bin/env node
/**
 * Der Busbahnhof mit echtem Dock (FireBus Etappe 4).
 *
 * Gefahren wird das echte Programm `cmd/bahnhof` mit dem echten `BusDock.js`. Der Daemon
 * ist ein WebSocket-Client, das Dashboard eine Attrappe von `_handleConnection`. Es geht
 * um das, wofür der Bahnhof da ist: Das Dashboard startet neu, und der Daemon merkt nichts.
 *
 *   node scripts/check-bus-dock.js
 *
 * Braucht Go und das Daemon-Repository daneben.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const assert = require('assert');
const { spawn, execFileSync } = require('child_process');
const WebSocket = require('ws');
const BusDock = require('../apps/dashboard/helpers/BusDock');
const { ohneKommentare } = require('./lib/quelltext');

const DAEMON = path.join(__dirname, '..', '..', 'firebot_daemon');
const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'bahnhof-'));
const SOCKET = path.join(ordner, 'dock.sock');
const stille = { info() {}, warn() {}, error() {}, debug() {} };

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 3).join('\n      ')}`); }
}
const warte = (ms) => new Promise(r => setTimeout(r, ms));
async function bis(was, tun, ms = 4000) {
    const ende = Date.now() + ms;
    while (Date.now() < ende) { if (tun()) return; await warte(20); }
    throw new Error(`Zeit abgelaufen: ${was}`);
}
const freierPort = () => new Promise((fertig) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => fertig(port)); });
});

/** Dashboard-Attrappe: nimmt Anmeldungen an wie `_handleConnection`, merkt sich alles. */
function dashboard() {
    const ipm = { Logger: stille, leitungen: [], nachrichten: [], ips: [], angedockt: 0 };
    ipm._angedockt = () => { ipm.angedockt++; };
    ipm._handleConnection = (ws, req) => {
        ipm.leitungen.push(ws);
        ipm.ips.push(req.headers['x-forwarded-for']);
        ws.on('close', () => { ws.istZu = true; });
        ws.on('message', (daten) => {
            const n = JSON.parse(daten.toString());
            ipm.nachrichten.push(n);
            if (n.type === 'register') ws.send(JSON.stringify({ type: 'registered', sessionToken: 'neu' }));
            if (n.type === 'heartbeat') ws.send(JSON.stringify({ type: 'heartbeat_ack', von: 'dashboard' }));
        });
    };
    ipm.andocken = () => { ipm.dock = new BusDock(ipm, SOCKET); ipm.dock.starte(); };
    return ipm;
}

(async () => {
    const bin = path.join(ordner, 'firebot-bahnhof');
    execFileSync('go', ['build', '-o', bin, './cmd/bahnhof'], { cwd: DAEMON, stdio: 'ignore' });
    const port = await freierPort();
    let bahnhof = spawn(bin, ['-adresse', `127.0.0.1:${port}`, '-dock', SOCKET], { stdio: 'ignore' });
    await bis('Socket', () => fs.existsSync(SOCKET));

    const erstes = dashboard();
    erstes.andocken();
    await warte(100);

    const daemon = new WebSocket(`ws://127.0.0.1:${port}/`);
    const eingang = [];
    let getrennt = false;
    daemon.on('message', (d) => eingang.push(JSON.parse(d.toString())));
    daemon.on('close', () => { getrennt = true; });
    await new Promise(r => daemon.on('open', r));

    // Seit 2026-11-03 der einzige Weg: Ein zweiter käme still zurück, wenn jemand den
    // WebSocket-Server wieder aufmacht, und das Panel setzte beim Start wieder alles
    // auf offline.
    console.log('\nEin Weg');
    await pruefe('das Dashboard lauscht nicht selbst, es dockt nur an', async () => {
        const ipm = ohneKommentare(fs.readFileSync(path.join(__dirname, '../apps/dashboard/helpers/IPMServer.js'), 'utf8'));
        assert.doesNotMatch(ipm, /WebSocket\.Server|require\('ws'\)/);
        assert.doesNotMatch(ipm, /markAllOffline/);
        assert.match(ipm, /new BusDock\(this, process\.env\.FIREBUS_DOCK \|\| DOCK_STANDARD\)/);
        const start = ohneKommentare(fs.readFileSync(path.join(__dirname, '../apps/dashboard/index.js'), 'utf8'));
        assert.doesNotMatch(start, /IPM_SERVER_PORT/);
    });

    // Die Busadresse kommt aus einer Stelle (helpers/BusAdresse.js): die Anmeldung
    // nennt sie jedem Daemon, die Vorlage neuer Maschinen trägt dieselbe (2026-11-03).
    await pruefe('die Busadresse entsteht an einer Stelle und kommt bei Daemon und Vorlage an', async () => {
        const { busAdresse } = require('../apps/dashboard/helpers/BusAdresse');
        assert.strictEqual(busAdresse({ DASHBOARD_BASE_URL: 'https://firenetworks.de' }), 'wss://firenetworks.de:9341');
        assert.strictEqual(busAdresse({ DASHBOARD_BASE_URL: 'https://firenetworks.de', FIREBUS_ADRESSE: ' wss://bahnhof2.firenetworks.de:9341 ' }),
            'wss://bahnhof2.firenetworks.de:9341');
        assert.strictEqual(busAdresse({}), null);
        const ipm = ohneKommentare(fs.readFileSync(path.join(__dirname, '../apps/dashboard/helpers/IPMServer.js'), 'utf8'));
        assert.match(ipm, /bus_adresse:\s*busAdresse\(\)/);
        assert.match(ipm, /eventRouter\.register\('adresse', 'befund'/);
        // Nach JEDER Anmeldung auch als eigene Nachricht: Die Antwort auf eine vom
        // Bahnhof wiederholte Anmeldung sieht der Daemon nicht (2026-11-03).
        assert.strictEqual((ipm.match(/this\._sendeBusAdresse\(ws\)/g) || []).length, 2, 'Erst- und Wiederanmeldung');
        const vorlage = ohneKommentare(fs.readFileSync(path.join(__dirname, '../apps/dashboard/themes/default/assets/js/guild.js'), 'utf8'));
        assert.match(vorlage, /const busAdresse = d\.busAdresse/);
        assert.doesNotMatch(vorlage, /9341/, 'die Vorlage rechnet die Adresse wieder selbst aus');
        const route = ohneKommentare(fs.readFileSync(path.join(__dirname, '../plugins/masterserver/dashboard/routes/rootserver.router.js'), 'utf8'));
        assert.match(route, /busAdresse: require\([^)]*BusAdresse'\)\.busAdresse\(\)/);
        // Und der Wizard des Daemons nennt neuen Maschinen denselben Bahnhof.
        const wizard = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/config/wizard.go'), 'utf8'));
        assert.strictEqual(/const BusAdresse = "([^"]+)"/.exec(wizard)?.[1], busAdresse({ DASHBOARD_BASE_URL: 'https://firenetworks.de' }));
    });

    console.log('\nNormalbetrieb');
    await pruefe('die Anmeldung läuft durch und ist für den Code dahinter eine normale Leitung', async () => {
        daemon.send(JSON.stringify({ type: 'register', payload: { daemon_id: 'd1', token: 'alt' } }));
        await bis('registered', () => eingang.some(n => n.type === 'registered'));
        assert.strictEqual(erstes.leitungen.length, 1);
        assert.strictEqual(erstes.ips[0], '127.0.0.1', 'die echte Adresse fehlt, die Namensprüfung braucht sie');
    });
    await pruefe('Befehle und Ereignisse fahren in beide Richtungen', async () => {
        erstes.leitungen[0].send(JSON.stringify({ type: 'command', id: '1' }));
        await bis('Befehl', () => eingang.some(n => n.type === 'command'));
        daemon.send(JSON.stringify({ type: 'event', namespace: 'gameserver', action: 'status_changed' }));
        await bis('Ereignis', () => erstes.nachrichten.some(n => n.action === 'status_changed'));
    });

    console.log('\nDashboard-Neustart');
    await pruefe('der Daemon bleibt verbunden, sein Herzschlag wird weiter bestätigt', async () => {
        erstes.dock.beende();
        await warte(200);
        const vorher = eingang.length;
        daemon.send(JSON.stringify({ type: 'heartbeat' }));
        await bis('Ack', () => eingang.length > vorher);
        assert.strictEqual(eingang.at(-1).type, 'heartbeat_ack');
        assert.notStrictEqual(eingang.at(-1).von, 'dashboard', 'das kam vom Bahnhof');
        assert.strictEqual(getrennt, false);
    });
    await pruefe('Konsole fällt weg, Ereignisse warten, und das neue Dashboard bekommt sie in der Folge', async () => {
        const vorher = eingang.length;
        daemon.send(JSON.stringify({ type: 'event', namespace: 'console', action: 'output', payload: { lines: ['x'] } }));
        daemon.send(JSON.stringify({ type: 'event', namespace: 'gameserver', action: 'crashed', nr: 1 }));
        daemon.send(JSON.stringify({ type: 'command_response', id: '5', payload: { success: true } }));
        await warte(100);

        const zweites = dashboard();
        zweites.andocken();
        await bis('Anmeldung beim neuen Dashboard', () => zweites.nachrichten.length >= 3);
        assert.deepStrictEqual(zweites.nachrichten.map(n => n.type), ['register', 'event', 'command_response']);
        assert.strictEqual(zweites.nachrichten[0].payload.token, 'neu', 'die Anmeldung trägt den neuen Schlüssel');
        assert.strictEqual(zweites.nachrichten[1].nr, 1);
        await warte(100);
        // Vom Neustart hört der Daemon genau eins: „Dock da", er liefert dann nach.
        // „Dock weg" kam beim Abdocken (Paket 3, 2026-11-03).
        assert.deepStrictEqual(eingang.slice(vorher), [{ type: 'dock', da: true }], 'der Daemon hat mehr vom Neustart gesehen als die Ansage');
        assert.ok(eingang.some(n => n.type === 'dock' && n.da === false), '„Dock weg" kam nie an');
        assert.strictEqual(getrennt, false);

        daemon.send(JSON.stringify({ type: 'event', namespace: 'gameserver', action: 'status_changed', nr: 2 }));
        await bis('wieder durch', () => zweites.nachrichten.some(n => n.nr === 2));
        zweites.leitungen[0].send(JSON.stringify({ type: 'command', id: '2' }));
        await bis('Rückweg', () => eingang.some(n => n.id === '2'));

        console.log('\nBahnhof weg');
        await pruefe('das Dashboard erfährt die Trennung, und der Daemon auch, nach der Ansage', async () => {
            assert.strictEqual(zweites.dock.angedockt, true);
            bahnhof.kill('SIGTERM');
            await bis('Ansage', () => eingang.some(n => n.type === 'bahnhof_neustart'));
            await bis('Daemon getrennt', () => getrennt);
            await bis('Dashboard getrennt', () => zweites.leitungen[0].istZu === true);
        });
        // Seit 9340 abgeschaltet ist (2026-11-03): Ohne Bahnhof laufen die Daemons
        // weiter, nur der Weg fehlt. Wer die Leitung schließt, darf daraus keinen
        // Ausfall der Maschine machen, die Wache fragt dafür `angedockt`.
        await pruefe('die Leitung trägt „Bahnhof weg", und das Dock weiß, dass es nicht hängt', async () => {
            assert.strictEqual(zweites.leitungen[0].bahnhofWeg, true);
            assert.strictEqual(zweites.dock.angedockt, false);
        });
        await pruefe('kommt der Bahnhof wieder, dockt das Dashboard von selbst an und sagt es', async () => {
            const vorher = zweites.angedockt;
            bahnhof = spawn(bin, ['-adresse', `127.0.0.1:${port}`, '-dock', SOCKET], { stdio: 'ignore' });
            await bis('wieder angedockt', () => zweites.dock.angedockt && zweites.angedockt > vorher, 8000);
        });
        await pruefe('ein gewolltes Abdocken ist kein „Bahnhof weg", die Leitung bleibt beim Bahnhof', async () => {
            const zweiter = new WebSocket(`ws://127.0.0.1:${port}/`);
            let zweiterZu = false;
            zweiter.on('close', () => { zweiterZu = true; });
            await new Promise(r => zweiter.on('open', r));
            zweiter.send(JSON.stringify({ type: 'register', payload: { daemon_id: 'd2', token: 't' } }));
            await bis('zweite Leitung', () => zweites.leitungen.length === 2);
            const leitung = zweites.leitungen[1];
            zweites.dock.beende();
            await warte(200);
            assert.strictEqual(leitung.bahnhofWeg, false);
            assert.strictEqual(leitung.istZu, undefined, 'beim Beenden wird keine Leitung geschlossen');
            assert.strictEqual(zweiterZu, false, 'der Daemon hat das Abdocken bemerkt');
            zweiter.close();
        });
    });

    bahnhof.kill('SIGKILL');
    fs.rmSync(ordner, { recursive: true, force: true });
    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ Das Dashboard startet neu, und der Daemon merkt nichts');
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
