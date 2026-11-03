#!/usr/bin/env node
/**
 * Die Innenhaut des FireBus (Etappe 4, Paket 5), Seite des Dashboards.
 *
 * Der Busbahnhof liest nur den Umschlag, den Inhalt kann er weder lesen noch ändern. Der
 * Schlüssel folgt aus dem Token (`rootserver.api_key`), jede Seite hat ihre Sitzung, von
 * der Gegenseite gilt nur die neueste, Zähler nur aufwärts (F19). Die Seite des Daemons
 * prüfen die Go-Tests (`internal/innenhaut`, `internal/websocket/innenhaut_test.go`,
 * `internal/bahnhof/paket5_test.go`). Hier:
 *
 *   1. dieselbe Rechnung wie der Daemon, an den Testwerten aus `vektor_test.go`
 *   2. die Regeln von `helpers/Innenhaut.js`
 *   3. die Leitung im echten IPMServer: Anmeldung, Halle vor der Anmeldung, Klartext
 *   4. die Migrationen an temporären Kopien, Marke und Sitzungsnummer in der Datenbank
 *
 *   node scripts/check-innenhaut.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { EventEmitter } = require('events');
const WURZEL = path.join(__dirname, '..');
const DAEMON = path.join(WURZEL, '..', 'firebot_daemon');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const { ServiceManager } = require('dunebot-core');
const logs = [];
const Logger = { warn: (t) => logs.push(String(t)), info() {}, error: (t) => logs.push(String(t)), debug() {} };
ServiceManager.register('Logger', Logger);

const Innenhaut = require('../apps/dashboard/helpers/Innenhaut');
const { grundschluessel, richtung, teile, verschliesse, oeffneMit, pruefeUmschlag, neueSitzung } = Innenhaut;
const RootServer = require('../plugins/masterserver/dashboard/models/RootServer');
const IPMServer = require('../apps/dashboard/helpers/IPMServer');
const migrationRootserver = require('../plugins/masterserver/migrations/20261103_170000_rootserver_innenhaut');
const migrationSitzung = require('../migrations/kern/20261103_170000_firebus_sitzung');
const { ohneKommentare } = require('./lib/quelltext');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 3).join('\n      ')}`); }
}

/** Die Seite des Daemons, nur fürs Prüfen: wie `Haut.Siegle` in Go. */
function daemonSeite(token, daemonId, nummer = 100) {
    const k = grundschluessel(token, daemonId);
    const sitzung = neueSitzung(nummer);
    let n = 0;
    return {
        sitzung,
        siegle(nachricht, zaehler) {
            n = zaehler ?? n + 1;
            const { u, inhalt } = teile(nachricht);
            Object.assign(u, { daemon: daemonId, s: sitzung });
            return verschliesse(richtung(k, Buffer.from(sitzung, 'hex'), 'd>a'), n, u, inhalt);
        },
        oeffne(text) {
            const u = JSON.parse(text);
            pruefeUmschlag(u);
            assert.strictEqual(u.an, sitzung, 'an eine andere Sitzung');
            return oeffneMit(richtung(k, Buffer.concat([Buffer.from(sitzung, 'hex'), Buffer.from(u.s, 'hex')]), 'a>d'), u);
        },
    };
}

/** Eine Datenbank im Speicher, so weit Innenhaut.js sie fragt. */
function speicherDb(zeilen) {
    const geschrieben = [];
    let nummer = null;
    return {
        geschrieben,
        db: () => ({
            query: async (sql, p = []) => {
                if (sql.startsWith('SELECT api_key')) return zeilen.filter(z => z.daemon_id === p[0]);
                if (sql.startsWith('UPDATE rootserver')) {
                    geschrieben.push(p);
                    const z = zeilen.find(x => x.daemon_id === p[2]);
                    Object.assign(z, { innenhaut_sitzung: p[0], innenhaut_zaehler: p[1] });
                    return { affectedRows: 1 };
                }
                if (sql.startsWith('SELECT nummer')) return nummer === null ? [] : [{ nummer }];
                if (sql.startsWith('INSERT INTO firebus_sitzung')) { nummer = p[0]; return {}; }
                throw new Error(`unerwartet: ${sql}`);
            },
        }),
    };
}

async function neueHaut(zeilen, jetzt = () => 1_000_000) {
    const speicher = speicherDb(zeilen);
    const h = new Innenhaut({ db: speicher.db, Logger, jetzt });
    await h.starte();
    return { h, speicher };
}

(async () => {
    console.log('\nDieselbe Rechnung wie der Daemon (vektor_test.go)');
    const go = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/innenhaut/vektor_test.go'), 'utf8'));
    const wert = (name) => {
        const m = go.match(new RegExp(`\\b${name}\\s*=\\s*(\`[^\`]*\`|"[^"]*")`));
        assert.ok(m, `${name} fehlt in vektor_test.go`);
        return m[1].slice(1, -1);
    };
    const v = {
        token: wert('vektorToken'), daemon: wert('vektorDaemon'), sitzung: wert('vektorSitzung'),
        k: wert('vektorK'), vomDaemon: wert('vomDaemon'), vomDashboard: wert('vomDashboard'),
    };
    await pruefe('derselbe Grundschlüssel', () => {
        assert.strictEqual(grundschluessel(v.token, v.daemon).toString('hex'), v.k);
    });
    await pruefe('was der Daemon versiegelt, öffnet das Dashboard', () => {
        const u = JSON.parse(v.vomDaemon);
        pruefeUmschlag(u);
        const m = oeffneMit(richtung(Buffer.from(v.k, 'hex'), Buffer.from(u.s, 'hex'), 'd>a'), u);
        assert.strictEqual(m.action, 'status_changed');
        assert.strictEqual(m.payload.text, 'äöü "x"');
    });
    await pruefe('was das Dashboard versiegelt, steht dort Zeichen für Zeichen', () => {
        const u = JSON.parse(v.vomDashboard);
        const { u: neu, inhalt } = teile({ type: 'command', id: 'c1', command: 'gameserver.stop', payload: { server_id: '7', text: 'äöü "x"' }, frist_ms: 60000 });
        Object.assign(neu, { daemon: v.daemon, s: u.s, an: u.an });
        const schluessel = richtung(Buffer.from(v.k, 'hex'), Buffer.concat([Buffer.from(u.an, 'hex'), Buffer.from(u.s, 'hex')]), 'a>d');
        assert.strictEqual(verschliesse(schluessel, 1, neu, inhalt), v.vomDashboard);
    });

    console.log('\nDie Regeln');
    const zeile = () => ({ daemon_id: 'd1', api_key: 'token', innenhaut_sitzung: null, innenhaut_zaehler: 0 });
    await pruefe('Nachricht und Antwort, die Nutzlast nie lesbar', async () => {
        const { h } = await neueHaut([zeile()]);
        const d = daemonSeite('token', 'd1');
        const roh = d.siegle({ type: 'event', namespace: 'gameserver', action: 'status_changed', payload: { kennwort: 'geheim' } });
        assert.ok(!roh.includes('geheim') && roh.includes('"action":"status_changed"'));
        const o = await h.oeffne(roh);
        assert.strictEqual(o.nachricht.payload.kennwort, 'geheim');
        assert.strictEqual(o.daemonId, 'd1');
        const antwort = h.siegle('d1', o.sitzung, { type: 'command', id: 'c', command: 'files.list', payload: { pfad: '/geheim' }, frist_ms: 5000 });
        assert.ok(!antwort.includes('/geheim') && antwort.includes('"command":"files.list"') && antwort.includes('"frist_ms":5000'));
        assert.strictEqual(d.oeffne(antwort).payload.pfad, '/geheim');
    });
    await pruefe('Wiederholung und Rückschritt werden abgewiesen, aber nach dem Siegel', async () => {
        const { h } = await neueHaut([zeile()]);
        const d = daemonSeite('token', 'd1');
        const erste = d.siegle({ type: 'heartbeat' });
        const zweite = d.siegle({ type: 'heartbeat' });
        await h.oeffne(zweite);
        await assert.rejects(h.oeffne(zweite), (e) => e.innenhaut === 'wiederholung');
        await assert.rejects(h.oeffne(erste), (e) => e.innenhaut === 'wiederholung');
        const fremd = daemonSeite('falsch', 'd1', 999);
        await assert.rejects(h.oeffne(fremd.siegle({ type: 'heartbeat' })), (e) => e.innenhaut === 'siegel' && e.daemonId === 'd1');
        await h.oeffne(d.siegle({ type: 'heartbeat' }));
    });
    await pruefe('nur die neueste Sitzung, und der Wechsel wird sofort geschrieben', async () => {
        const z = zeile();
        const { h, speicher } = await neueHaut([z]);
        const alt = daemonSeite('token', 'd1', 100);
        await h.oeffne(alt.siegle({ type: 'heartbeat' }));
        const neu = daemonSeite('token', 'd1', 101);
        await h.oeffne(neu.siegle({ type: 'heartbeat' }, 5));
        await new Promise(r => setImmediate(r));
        assert.deepStrictEqual(speicher.geschrieben.at(-1), [neu.sitzung, 5, 'd1']);
        await assert.rejects(h.oeffne(alt.siegle({ type: 'heartbeat' })), (e) => e.innenhaut === 'alt');
        // Dieselbe Nummer mit anderem Zufall ist keine neuere.
        await assert.rejects(h.oeffne(daemonSeite('token', 'd1', 101).siegle({ type: 'heartbeat' })), (e) => e.innenhaut === 'alt');
    });
    await pruefe('die Marke übersteht den Neustart des Dashboards', async () => {
        const z = zeile();
        const d = daemonSeite('token', 'd1');
        const erste = await neueHaut([z]);
        const alteNachrichten = [1, 2, 3].map(() => d.siegle({ type: 'heartbeat' }));
        for (const roh of alteNachrichten) await erste.h.oeffne(roh);
        await erste.h.merkeAlle();
        const zweite = await neueHaut([z]);
        await assert.rejects(zweite.h.oeffne(alteNachrichten[2]), (e) => e.innenhaut === 'wiederholung');
        await zweite.h.oeffne(d.siegle({ type: 'heartbeat' }));
        assert.ok(await zweite.h.sprichtSie('d1'));
        assert.ok(!(await (await neueHaut([zeile()])).h.sprichtSie('d1')), 'ohne Marke gilt noch Klartext');
    });
    await pruefe('merke schreibt nur, was sich geändert hat', async () => {
        const { h, speicher } = await neueHaut([zeile()]);
        await h.oeffne(daemonSeite('token', 'd1').siegle({ type: 'heartbeat' }));
        await new Promise(r => setImmediate(r));
        const vorher = speicher.geschrieben.length;
        await h.merke('d1');
        await h.merkeAlle();
        assert.strictEqual(speicher.geschrieben.length, vorher);
    });
    await pruefe('der Vorlauf des Wizards verschiebt keine Marke', async () => {
        const { h } = await neueHaut([zeile()]);
        const dienst = daemonSeite('token', 'd1', 100);
        await h.oeffne(dienst.siegle({ type: 'heartbeat' }));
        const wizard = daemonSeite('token', 'd1', 500);
        const o = await h.oeffne(wizard.siegle({ type: 'register', payload: { daemon_id: 'd1', probe: true } }));
        assert.ok(o.probe);
        await h.oeffne(dienst.siegle({ type: 'heartbeat' }));
    });
    await pruefe('Klartext kommt gekennzeichnet, ein fremder Umschlag nicht durch', async () => {
        const { h } = await neueHaut([zeile()]);
        assert.deepStrictEqual(await h.oeffne('{"type":"register","payload":{"token":"x"}}'), { klartext: true, nachricht: { type: 'register', payload: { token: 'x' } } });
        const d = daemonSeite('token', 'd1');
        const roh = d.siegle({ type: 'heartbeat' });
        await assert.rejects(h.oeffne(roh.replace('"type":"heartbeat"', '"type":"heartbeat","payload":{}')), (e) => e.innenhaut === 'umschlag');
        await assert.rejects(h.oeffne(roh.replace('"type":"heartbeat"', '"type":"register"')), (e) => e.innenhaut === 'siegel');
        await assert.rejects(h.oeffne(daemonSeite('token', 'd9').siegle({ type: 'heartbeat' })), (e) => e.innenhaut === 'unbekannt');
        assert.throws(() => teile({ type: 'x', inhalt: 'y' }), /trägt inhalt/);
    });
    await pruefe('ein neuer Token gilt nach höchstens zehn Sekunden', async () => {
        let jetzt = 1_000_000;
        const z = zeile();
        const { h } = await neueHaut([z], () => jetzt);
        await h.oeffne(daemonSeite('token', 'd1', 100).siegle({ type: 'heartbeat' }));
        z.api_key = 'neu';
        const neu = daemonSeite('neu', 'd1', 101);
        await assert.rejects(h.oeffne(neu.siegle({ type: 'heartbeat' })), (e) => e.innenhaut === 'siegel');
        jetzt += 10_001;
        await h.oeffne(neu.siegle({ type: 'heartbeat' }));
    });
    await pruefe('die Sitzungsnummer steigt, auch wenn die Uhr zurückspringt', async () => {
        const speicher = speicherDb([]);
        const a = new Innenhaut({ db: speicher.db, Logger, jetzt: () => 5000 });
        await a.starte();
        const b = new Innenhaut({ db: speicher.db, Logger, jetzt: () => 10 });
        await b.starte();
        assert.strictEqual(Innenhaut.nummerVon(a.sitzung), 5000);
        assert.strictEqual(Innenhaut.nummerVon(b.sitzung), 5001);
    });

    console.log('\nDie Leitung im IPMServer');
    const ipm = new IPMServer();
    ipm.Logger = Logger;
    const z1 = { daemon_id: 'd1', api_key: 'token', innenhaut_sitzung: null, innenhaut_zaehler: 0 };
    const z2 = { daemon_id: 'd2', api_key: 'token2', innenhaut_sitzung: 'ff'.repeat(16), innenhaut_zaehler: 9 };
    ipm.innenhaut = new Innenhaut({ db: speicherDb([z1, z2]).db, Logger, jetzt: Date.now });
    await ipm.innenhaut.starte();
    const geroutet = [];
    Object.assign(ipm, {
        _routeMessage: async (id, m) => { geroutet.push([id, m.type, m.nr]); },
        _logDaemonEvent: async () => {}, _serverRegistry: async () => [], syncSftpUsers: async () => {},
        wache: { angemeldet: async () => {}, getrennt: async () => {} },
    });
    Object.assign(RootServer, {
        getByDaemonId: async (id) => ({ id: 54, daemon_id: id, name: 'Maschine', guild_id: 'g', install_status: 'completed', base_directory: '/v', system_user: 'u' }),
        markOnline: async () => {}, uebernimmSftp: async () => {}, uebernimmDatenbank: async () => {}, uebernimmMaschinenbefund: async () => null,
        getByDaemonIdAndApiKey: async () => null,
    });
    const leitung = () => {
        const ws = new EventEmitter();
        ws.gesendet = [];
        ws.send = (t) => ws.gesendet.push(t);
        ws.close = (code) => { ws.zu = code; };
        ipm._handleConnection(ws, { headers: {}, socket: { remoteAddress: '10.0.0.1' } });
        return ws;
    };
    const bringe = async (ws, text) => { ws.emit('message', Buffer.from(text)); for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };

    await pruefe('versiegelte Anmeldung, Antwort versiegelt, ohne Token und ohne JWT', async () => {
        const d = daemonSeite('token', 'd1');
        const ws = leitung();
        await bringe(ws, d.siegle({ type: 'register', payload: { daemon_id: 'd1', version: '1.2.0' } }));
        assert.ok(ipm.connections.has('d1'), `nicht angemeldet: ${logs.slice(-2).join(' | ')}`);
        const antwort = d.oeffne(ws.gesendet[0]);
        assert.strictEqual(antwort.type, 'registered');
        assert.ok(!('sessionToken' in antwort));
        assert.strictEqual(d.oeffne(ws.gesendet.at(-1)).type, ws.gesendet.length > 1 ? 'bus_adresse' : 'registered');
        ws.emit('close');
    });
    await pruefe('die Halle vor der neuen Anmeldung wird danach verarbeitet, in Reihenfolge', async () => {
        geroutet.length = 0;
        const d = daemonSeite('token', 'd1', 200);
        const ws = leitung();
        await bringe(ws, d.siegle({ type: 'event', nr: 1 }));
        await bringe(ws, d.siegle({ type: 'event', nr: 2 }));
        assert.deepStrictEqual(geroutet, [], 'vor der Anmeldung verarbeitet');
        assert.strictEqual(ws.zu, undefined, 'die Leitung wurde geschlossen');
        await bringe(ws, d.siegle({ type: 'register', payload: { daemon_id: 'd1' } }));
        await bringe(ws, d.siegle({ type: 'event', nr: 3 }));
        assert.deepStrictEqual(geroutet.map(g => g[2]), [1, 2, 3]);
        ws.emit('close');
    });
    await pruefe('Klartext auf einer versiegelten Leitung und eine fremde Sitzung fahren nicht', async () => {
        geroutet.length = 0;
        const d = daemonSeite('token', 'd1', 300);
        const ws = leitung();
        await bringe(ws, d.siegle({ type: 'register', payload: { daemon_id: 'd1' } }));
        await bringe(ws, '{"type":"event","nr":9}');
        await bringe(ws, daemonSeite('token', 'd1', 301).siegle({ type: 'event', nr: 10 }));
        assert.deepStrictEqual(geroutet, []);
        ws.emit('close');
    });
    await pruefe('falscher Token: Ablehnung ohne Siegel, Leitung zu, Fehlversuch gezählt', async () => {
        ipm.registerFailures.clear();
        const ws = leitung();
        await bringe(ws, daemonSeite('falsch', 'd1', 400).siegle({ type: 'register', payload: { daemon_id: 'd1' } }));
        assert.strictEqual(ws.zu, 4001);
        assert.match(JSON.parse(ws.gesendet[0]).error, /Siegel passt nicht/);
        assert.strictEqual(ipm.registerFailures.size, 1);
    });
    await pruefe('wer versiegelt gesprochen hat, kommt im Klartext nicht mehr an', async () => {
        const ws = leitung();
        await bringe(ws, JSON.stringify({ type: 'register', payload: { daemon_id: 'd2', token: 'eyJ.alt.jwt' } }));
        assert.ok(!ipm.connections.has('d2'));
        assert.match(JSON.parse(ws.gesendet[0]).error, /spricht die Innenhaut/);
    });
    await pruefe('Befehle gehen versiegelt an die Sitzung der Leitung', async () => {
        const d = daemonSeite('token', 'd1', 500);
        const ws = leitung();
        await bringe(ws, d.siegle({ type: 'register', payload: { daemon_id: 'd1' } }));
        const zugesagt = ipm.sendCommand('d1', 'files.list', { pfad: '/x' }, 50).catch(() => {});
        const befehl = d.oeffne(ws.gesendet.at(-1));
        assert.strictEqual(befehl.command, 'files.list');
        assert.strictEqual(befehl.payload.pfad, '/x');
        await zugesagt;
        ws.emit('close');
    });

    console.log('\nVerdrahtung');
    await pruefe('eine Sendestelle, Innenhaut vor dem Dock, Marken bei Heartbeat und Halt', () => {
        const q = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'apps/dashboard/helpers/IPMServer.js'), 'utf8'));
        assert.strictEqual((q.match(/ws\.send\(/g) || []).length, 2, 'ws.send nur in _sende und für die Ablehnung ohne Siegel');
        assert.ok(q.indexOf('await this.innenhaut.starte()') < q.indexOf('new BusDock('), 'die Innenhaut startet nach dem Dock');
        assert.match(q, /this\.innenhaut\?\.merke\(daemonId\)/);
        assert.match(q, /await this\.innenhaut\?\.merkeAlle\(\)/);
    });
    await pruefe('der Daemon schreibt nur versiegelt, und der Token fährt nicht mit', () => {
        const client = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/websocket/client.go'), 'utf8'));
        assert.doesNotMatch(client, /wsjson\./);
        assert.doesNotMatch(client, /"token":/);
        assert.doesNotMatch(client, /SessionToken/);
        const vorlauf = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/kopplung/vorlauf.go'), 'utf8'));
        assert.match(vorlauf, /haut\.Siegle\(/);
        assert.doesNotMatch(vorlauf, /"token":/);
    });
    await pruefe('der Bahnhof wiederholt keine versiegelte Anmeldung', () => {
        const b = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/bahnhof/bahnhof.go'), 'utf8'));
        assert.match(b, /l\.versiegelt = k\.Sitzung != ""/);
        assert.match(b, /selbst := l\.versiegelt && l\.bestaetigt/);
    });

    console.log('\nDatenbank, an temporären Kopien');
    const roh = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT, user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
    });
    const db = {
        query: async (sql, p) => {
            const [r] = await roh.query(sql.replace('CREATE TABLE IF NOT EXISTS', 'CREATE TEMPORARY TABLE IF NOT EXISTS'), p);
            return r;
        },
    };
    try {
        // Die temporäre Tabelle verdeckt die echte, nur in dieser Verbindung.
        const [[echt]] = await roh.query('SHOW CREATE TABLE rootserver');
        await roh.query(echt['Create Table'].replace(/^CREATE TABLE/, 'CREATE TEMPORARY TABLE'));
        await pruefe('die Migration legt beide Spalten an, ein zweites Mal ändert nichts', async () => {
            await migrationRootserver.up(db);
            await migrationRootserver.up(db);
            const spalten = (await db.query("SHOW COLUMNS FROM rootserver LIKE 'innenhaut%'")).map(s => `${s.Field} ${s.Type} ${s.Null} ${s.Default}`);
            assert.deepStrictEqual(spalten, ['innenhaut_sitzung char(32) YES null', 'innenhaut_zaehler bigint(20) unsigned NO 0']);
        });
        await pruefe('Marke schreiben und nach einem Neustart wieder lesen', async () => {
            await db.query(`INSERT INTO rootserver (guild_id, owner_user_id, daemon_id, name, host, api_key)
                            VALUES ('g', 'u', 'd-probe', 'Probe', '127.0.0.1', 'tok')`);
            await migrationSitzung.up(db);
            const h = new Innenhaut({ db: () => db, Logger });
            await h.starte();
            const d = daemonSeite('tok', 'd-probe', 777);
            await h.oeffne(d.siegle({ type: 'heartbeat' }, 41));
            await new Promise(r => setTimeout(r, 50));
            const [z] = await db.query("SELECT innenhaut_sitzung, innenhaut_zaehler FROM rootserver WHERE daemon_id = 'd-probe'");
            assert.deepStrictEqual([z.innenhaut_sitzung, Number(z.innenhaut_zaehler)], [d.sitzung, 41]);
            const nach = new Innenhaut({ db: () => db, Logger });
            await nach.starte();
            assert.ok(Innenhaut.nummerVon(nach.sitzung) > Innenhaut.nummerVon(h.sitzung));
            await assert.rejects(nach.oeffne(d.siegle({ type: 'heartbeat' }, 41)), (e) => e.innenhaut === 'wiederholung');
        });
        await pruefe('die echte Tabelle blieb unberührt', async () => {
            const andere = await mysql.createConnection({
                host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT, user: process.env.MYSQL_USER,
                password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
            });
            try {
                const [z] = await andere.query("SELECT COUNT(*) AS n FROM rootserver WHERE daemon_id = 'd-probe'");
                assert.strictEqual(Number(z[0].n), 0);
            } finally {
                await andere.end();
            }
        });
    } finally {
        await roh.end();
    }

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ Die Innenhaut rechnet wie der Daemon, hält Wiederholungen ab und übersteht den Neustart');
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
