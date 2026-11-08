#!/usr/bin/env node
/**
 * Server-Timing: Kommt die Zeit von Datenbank, Daemon und Bot im Kopf an?
 * (2026-11-08)
 *
 * Anlass: „die Webseite reagiert schon wieder voll langsam", und es ließ sich
 * nicht sagen, wo die Sekunden blieben. Seitdem trägt jede Antwort einen Kopf
 * `Server-Timing` (Middleware `anfragezeit`, Kern `Anfragezeit`).
 *
 * Das Skript liest nicht, es benutzt: ein echter HTTP-Server mit der echten
 * Middleware, darin die echten Klassen DBClient, IPMServer und IPCServer —
 * nur ihre Leitungen nach außen (Pool, Daemon, Bot) sind Attrappen, die eine
 * bekannte Zeit warten. Geprüft wird, was beim Browser ankommt.
 *
 * Nebenwirkungsfrei: keine Datenbank, kein Daemon, kein Bot, kein Netz außer
 * einem Port auf 127.0.0.1.
 *
 *   node scripts/check-anfragezeit.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';
const path = require('path');
const http = require('http');
const assert = require('assert');
const express = require('express');
const { ServiceManager, Anfragezeit } = require('dunebot-core');

const WURZEL = path.join(__dirname, '..');
const protokoll = [];
ServiceManager.register('Logger', {
    warn: (t) => protokoll.push(String(t)), info() {}, debug() {}, error() {}, success() {},
});

const anfragezeit = require(path.join(WURZEL, 'apps/dashboard/middlewares/anfragezeit.middleware'));
const DBClient = require(path.join(WURZEL, 'packages/dunebot-db-client/lib/DBClient'));
const IPMServer = require(path.join(WURZEL, 'apps/dashboard/helpers/IPMServer'));
const IPCServer = require(path.join(WURZEL, 'apps/dashboard/helpers/IPCServer'));

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

// Echte Klassen, Leitungen nach außen als Attrappen mit bekannter Dauer.
const db = new DBClient({});
db.pool.end().catch(() => {});
db.pool = { execute: async () => { await warte(40); return [[{ eins: 1 }]]; } };

const ipm = new IPMServer();
ipm.Logger = ServiceManager.get('Logger');
ipm._sendeBefehl = async (daemonId, befehl) => { await warte(befehl === 'gameserver.langsam' ? 1100 : 60); return { ok: true }; };

const ipc = new IPCServer();
ipc.getSockets = () => [['Bot #1', { send: async () => { await warte(50); return { success: true }; } }]];

let fehler = 0;
async function pruefe(name, fn) {
    try {
        await fn();
        console.log(`  ✓ ${name}`);
    } catch (e) {
        fehler++;
        console.log(`  ✗ ${name}\n      ${e.message}`);
    }
}

function teile(kopf) {
    const aus = {};
    for (const teil of String(kopf || '').split(/,\s*(?=[a-z]+;)/)) {
        const [name, ...rest] = teil.split(';');
        const e = {};
        for (const r of rest) {
            const i = r.indexOf('=');
            e[r.slice(0, i)] = r.slice(i + 1).replace(/^"|"$/g, '');
        }
        aus[name.trim()] = e;
    }
    return aus;
}

(async () => {
    const app = express();
    app.use(anfragezeit);
    app.use((req, res, next) => { if (req.headers['x-angemeldet']) req.session = { user: { id: '1' } }; next(); });
    app.get('/seite', async (req, res) => {
        await db.query('SELECT 1');
        await Promise.all([db.query('SELECT 2'), db.query('SELECT 3')]);
        await ipm.sendCommand('d1', 'gameserver.status');
        await ipm.sendCommand('d1', 'gameserver.status');
        await ipc.broadcastOne('dashboard:guilds', {});
        res.send('ok');
    });
    app.get('/leer', (req, res) => res.send('ok'));
    app.use('/statisch', express.static(path.join(WURZEL, 'apps/dashboard/public')));
    app.get('/langsam', async (req, res) => { await ipm.sendCommand('d1', 'gameserver.langsam'); await warte(2000); res.json({ ok: 1 }); });
    app.get('/wirft', async (req, res) => {
        try { await Anfragezeit.messe('db', null, async () => { await warte(30); throw new Error('weg'); }); } catch (_) { /* erwartet */ }
        res.status(500).end();
    });
    const server = http.createServer(app).listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const basis = `http://127.0.0.1:${server.address().port}`;
    const hole = (pfad, kopf = {}) => fetch(basis + pfad, { headers: kopf });

    console.log('\nWas beim Browser ankommt');
    await pruefe('angemeldet: gesamt, db, daemon, bot mit Anzahl und Namen', async () => {
        const r = await hole('/seite', { 'x-angemeldet': '1' });
        const t = teile(r.headers.get('server-timing'));
        assert.ok(t.gesamt && Number(t.gesamt.dur) >= 250, `gesamt fehlt oder zu klein: ${JSON.stringify(t.gesamt)}`);
        assert.strictEqual(t.db?.desc, '3 Abfragen, Summe');
        assert.ok(Number(t.db.dur) >= 115, `db zählt die parallelen nicht als Summe: ${t.db.dur}`);
        assert.strictEqual(t.daemon?.desc, '2 Befehle, Summe: gameserver.status x2');
        assert.ok(Number(t.daemon.dur) >= 115, `daemon: ${t.daemon.dur}`);
        assert.strictEqual(t.bot?.desc, '1 IPC, Summe: dashboard:guilds');
    });
    await pruefe('nicht angemeldet: Dauer ja, Befehlsnamen nein', async () => {
        const r = await hole('/seite');
        const kopf = r.headers.get('server-timing');
        assert.ok(!/gameserver\.status|dashboard:guilds/.test(kopf), kopf);
        assert.strictEqual(teile(kopf).daemon?.desc, '2 Befehle, Summe');
    });
    await pruefe('eine Seite ohne Datenbank: nur gesamt', async () => {
        const t = teile((await hole('/leer')).headers.get('server-timing'));
        assert.deepStrictEqual(Object.keys(t), ['gesamt']);
    });
    await pruefe('auch eine statische Datei trägt den Kopf', async () => {
        const r = await fetch(basis + '/statisch/vendor/isotope-layout/isotope.pkgd.js');
        assert.strictEqual(r.status, 200, 'die Datei kam nicht');
        assert.ok(/^gesamt;dur=/.test(r.headers.get('server-timing') || ''), r.headers.get('server-timing'));
    });
    await pruefe('eine Abfrage, die wirft, zählt trotzdem', async () => {
        const r = await hole('/wirft');
        assert.strictEqual(r.status, 500);
        assert.strictEqual(teile(r.headers.get('server-timing')).db?.desc, '1 Abfragen, Summe');
    });
    await pruefe('Anfragen laufen gleichzeitig und zählen getrennt', async () => {
        const [a, b] = await Promise.all([hole('/seite', { 'x-angemeldet': '1' }), hole('/leer')]);
        assert.strictEqual(teile(a.headers.get('server-timing')).db?.desc, '3 Abfragen, Summe');
        assert.deepStrictEqual(Object.keys(teile(b.headers.get('server-timing'))), ['gesamt']);
    });

    console.log('\nProtokoll');
    await pruefe('langsame Anfrage und langsamer Daemon-Befehl stehen im Protokoll, ohne Abfrageteil', async () => {
        protokoll.length = 0;
        await hole('/langsam?token=geheim');
        assert.ok(protokoll.some((z) => /Befehl gameserver\.langsam brauchte 1\d{3} ms/.test(z)), protokoll.join('\n'));
        const zeile = protokoll.find((z) => z.startsWith('[Anfragezeit]'));
        assert.ok(zeile && /GET \/langsam → 200 nach 3\d{3} ms — daemon 1\d{3} ms \(1 Befehle: gameserver\.langsam\)/.test(zeile), zeile);
        assert.ok(!/geheim/.test(zeile), 'der Abfrageteil steht im Protokoll');
    });
    await pruefe('schnelle Anfragen und Befehle schreiben nichts', async () => {
        protokoll.length = 0;
        await hole('/seite');
        assert.deepStrictEqual(protokoll, []);
    });
    await pruefe('außerhalb einer Anfrage (Takt): kein Kopf, aber das Protokoll für langsame Befehle', async () => {
        protokoll.length = 0;
        assert.strictEqual(Anfragezeit.aktuell(), null);
        await ipm.sendCommand('d1', 'gameserver.langsam');
        assert.strictEqual(protokoll.length, 1, protokoll.join('\n'));
    });

    console.log('\nVerdrahtung');
    await pruefe('die Middleware steht als erste im Dashboard', async () => {
        const fs = require('fs');
        const { ohneKommentare } = require('./lib/quelltext');
        const quelle = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'apps/dashboard/app.js'), 'utf8'));
        const block = quelle.slice(quelle.indexOf('#initializeMiddlewares() {'));
        const erste = block.match(/this\.app\.use\(([^)]*\))?/);
        assert.ok(erste && /anfragezeit\.middleware/.test(erste[0]), `zuerst steht: ${erste && erste[0]}`);
        // Ausführungsreihenfolge: Zwischen `this.app = express()` und dem Aufruf
        // von #initializeMiddlewares() darf nichts an der App hängen. Was im
        // Text weiter oben steht, aber erst danach läuft, zählt nicht.
        const vorher = quelle.slice(quelle.indexOf('this.app = express()'), quelle.indexOf('this.#initializeMiddlewares();'));
        assert.ok(!/this\.app\.(use|get|post|all)\(/.test(vorher), 'vor der Middleware hängt schon etwas an der App');
    });
    await pruefe('Datenbank misst query, rawQuery und transaction', async () => {
        const fs = require('fs');
        const { ohneKommentare } = require('./lib/quelltext');
        const c = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'packages/dunebot-db-client/lib/DBClient.js'), 'utf8'));
        const s = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'packages/dunebot-db-client/lib/DBService.js'), 'utf8'));
        assert.match(c, /Anfragezeit\.messe\('db', null, \(\) => this\.pool\.execute\(/);
        assert.match(c, /Anfragezeit\.messe\('db', null, \(\) => this\.#transaktion\(/);
        assert.match(s, /Anfragezeit\.messe\('db', null, \(\) => this\.pool\.query\(/);
        assert.match(s, /Anfragezeit\.messe\('db', null, \(\) => this\.#transaktion\(/);
    });

    server.close();
    db.pool = null;
    console.log(`\nErgebnis: ${fehler ? fehler + ' Abweichung(en)' : 'alles grün'}`);
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
