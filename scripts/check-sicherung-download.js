#!/usr/bin/env node
/**
 * Sicherung herunterladen — durch das Dashboard (2026-10-28, „Weg 1").
 *
 * Bis dahin leitete der Knopf den Browser zum Daemon um (http://…:9350). HSTS
 * auf firenetworks.de, die Sperre der Browser gegen http-Downloads aus einer
 * https-Seite und eine fehlende Firewall-Regel ließen ihn ins Leere laufen.
 * Jetzt holt das Dashboard die unterschriebene Adresse selbst ab und reicht
 * den Strom durch.
 *
 * Gefahren wird die echte Route mit echtem HTTP: ein nachgebauter Daemon, der
 * die Unterschrift prüft wie internal/sicherungsabruf (HMAC über Kennung,
 * Datei, Frist) und Bereichsanfragen beantwortet wie http.ServeFile.
 *
 *   node scripts/check-sicherung-download.js
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const path = require('path');
const express = require('express');

const { ServiceManager } = require('dunebot-core');
const still = () => {};
ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });

const WURZEL = path.join(__dirname, '..');
const SCHLUESSEL = 'probe-schluessel';
const INHALT = Buffer.from('ARCHIV'.repeat(50000)); // 300 kB
let daemonAntwort = null; // erzwingt einen Status (404, 500), sonst normal
let daemonSah = [];

// ── Der nachgebaute Daemon ──────────────────────────────────────────────────
// Wie der Daemon: ein selbst unterschriebenes Zertifikat, dem das Dashboard vertraut.
const zertifikat = (() => {
    const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'abruf-'));
    const [schluessel, zert] = ['k.pem', 'z.pem'].map(d => path.join(ordner, d));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
        '-keyout', schluessel, '-out', zert, '-days', '2', '-subj', '/CN=FireBot Abruf',
        '-addext', 'basicConstraints=critical,CA:TRUE'], { stdio: 'ignore' });
    const paar = { key: fs.readFileSync(schluessel, 'utf8'), cert: fs.readFileSync(zert, 'utf8') };
    fs.rmSync(ordner, { recursive: true });
    return paar;
})();
const daemon = https.createServer(zertifikat, (req, res) => {
    const u = new URL(req.url, 'http://x');
    daemonSah.push({ pfad: u.pathname, range: req.headers.range || null });
    const server = u.searchParams.get('server'), datei = u.searchParams.get('datei');
    const bis = u.searchParams.get('bis'), sig = u.searchParams.get('sig');
    const erwartet = crypto.createHmac('sha256', SCHLUESSEL).update(`${server}\n${datei}\n${bis}`).digest('hex');
    if (u.pathname !== '/sicherung' || sig !== erwartet || Number(bis) < Date.now() / 1000) {
        res.writeHead(403); return res.end('verboten');
    }
    if (daemonAntwort) { res.writeHead(daemonAntwort); return res.end('nein'); }
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Accept-Ranges', 'bytes');
    const m = /^bytes=(\d+)-$/.exec(req.headers.range || '');
    if (m) {
        const ab = Number(m[1]);
        res.writeHead(206, { 'Content-Range': `bytes ${ab}-${INHALT.length - 1}/${INHALT.length}`, 'Content-Length': INHALT.length - ab });
        return res.end(INHALT.subarray(ab));
    }
    res.writeHead(200, { 'Content-Length': INHALT.length });
    res.end(INHALT);
});

let daemonPort = 0;
let sicherung = null;
const db = {
    async query(sql) {
        if (/^SELECT id, name, status, created_at FROM gameserver_backups/.test(sql)) return [sicherung];
        if (/FROM gameserver_backups b\s+JOIN gameservers gs/.test(sql)) {
            return [{ name: 'Probe_2026', status: 'completed', host: '127.0.0.1', fqdn: 'node1.firenetworks.de',
                fqdn_gilt: 1, abruf_port: daemonPort, api_key: SCHLUESSEL, abruf_zertifikat: zertifikat.cert }];
        }
        throw new Error('Unerwartete Abfrage: ' + sql.trim().slice(0, 80));
    },
};
ServiceManager.register('dbService', db);

const router = require(path.join(WURZEL, 'plugins/gameserver/dashboard/routes/servers.js'));
const schicht = router.stack.find(l => l.route && l.route.path === '/:serverId/backups/:backupId/download');
const handler = schicht.route.stack.at(-1).handle;

const app = express();
app.get('/d/:serverId/:backupId', (req, res) => { res.locals.guildId = 'g1'; return handler(req, res); });

function hole(port, kopf = {}) {
    return new Promise((ok, nein) => {
        http.get({ host: '127.0.0.1', port, path: '/d/217/145', headers: kopf }, (a) => {
            const teile = [];
            a.on('data', d => teile.push(d));
            a.on('end', () => ok({ status: a.statusCode, kopf: a.headers, inhalt: Buffer.concat(teile) }));
        }).on('error', nein);
    });
}

let bestanden = 0;
async function pruefe(name, fn) {
    daemonAntwort = null; daemonSah = [];
    try { await fn(); console.log(`  ✓ ${name}`); bestanden++; }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

(async () => {
    await new Promise(r => daemon.listen(0, '127.0.0.1', r));
    daemonPort = daemon.address().port;
    const dash = app.listen(0, '127.0.0.1');
    await new Promise(r => dash.on('listening', r));
    const port = dash.address().port;

    console.log('\nSicherung durch das Dashboard');

    await pruefe('Der Browser bekommt die Datei vom Dashboard — keine Umleitung zum Daemon', async () => {
        const a = await hole(port);
        assert.strictEqual(a.status, 200);
        assert.ok(!a.kopf.location, 'es wird noch umgeleitet: ' + a.kopf.location);
        assert.ok(a.inhalt.equals(INHALT), `Inhalt weicht ab (${a.inhalt.length} statt ${INHALT.length} Bytes)`);
        assert.strictEqual(a.kopf['content-type'], 'application/gzip');
        assert.match(a.kopf['content-disposition'], /^attachment; filename="Probe_2026\.tar\.gz"; filename\*=UTF-8''Probe_2026\.tar\.gz$/);
        assert.strictEqual(Number(a.kopf['content-length']), INHALT.length);
    });

    await pruefe('Unterschrift stimmt (der Daemon nahm sie an), und gefragt wird über die IP', async () => {
        await hole(port);
        assert.strictEqual(daemonSah.length, 1);
        assert.strictEqual(daemonSah[0].pfad, '/sicherung');
    });

    await pruefe('Fortsetzen: Range geht mit, 206 mit Content-Range zurück', async () => {
        const a = await hole(port, { Range: 'bytes=100000-' });
        assert.strictEqual(a.status, 206);
        assert.strictEqual(daemonSah[0].range, 'bytes=100000-');
        assert.match(a.kopf['content-range'], /^bytes 100000-299999\/300000$/);
        assert.ok(a.inhalt.equals(INHALT.subarray(100000)));
    });

    await pruefe('Daemon findet die Datei nicht: Fehlerseite mit Grund, keine halbe Datei', async () => {
        daemonAntwort = 404;
        const a = await hole(port);
        assert.strictEqual(a.status, 502);
        assert.match(JSON.parse(a.inhalt).message, /liegt nicht beim Rootserver/);
    });

    await pruefe('Daemon nicht erreichbar: 502 mit Grund', async () => {
        const alt = daemonPort; daemonPort = 1; // dort lauscht niemand
        const a = await hole(port);
        daemonPort = alt;
        assert.strictEqual(a.status, 502);
        assert.match(JSON.parse(a.inhalt).message, /nicht erreichbar/);
    });

    console.log('\nLöschen, während die Sicherung läuft');
    const Sicherung = require(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/Sicherung.js'));
    const loeschen = router.stack.find(l => l.route && l.route.path === '/:serverId/backups/:backupId' && l.route.methods.delete)
        .route.stack.at(-1).handle;
    const rufeLoeschen = (zeile) => new Promise((fertig) => {
        sicherung = zeile;
        const res = { locals: { guildId: 'g1' }, status(c) { this.code = c; return this; }, json(d) { fertig({ code: this.code, d }); } };
        loeschen({ params: { serverId: '231', backupId: '149' } }, res);
    });
    const jetzt = new Date();
    const alt = new Date(Date.now() - Sicherung.FRIST_MS - 1000);

    await pruefe('laufende Sicherung und Wiederherstellung: 409, der Daemon wird nicht gefragt', async () => {
        for (const status of ['running', 'pending', 'restoring']) {
            const a = await rufeLoeschen({ id: 149, name: 'x', status, created_at: jetzt });
            assert.strictEqual(a.code, 409, status);
            assert.match(a.d.message, /gerade in Arbeit/);
        }
    });
    await pruefe('fertig, fehlgeschlagen und Leichen nach der Frist kommen an der Sperre vorbei', async () => {
        for (const zeile of [{ status: 'completed', created_at: jetzt }, { status: 'failed', created_at: jetzt }, { status: 'running', created_at: alt }]) {
            assert.strictEqual(Sicherung.laeuft(zeile), false, JSON.stringify(zeile));
            const a = await rufeLoeschen({ id: 149, name: 'x', ...zeile }).catch(e => ({ code: 0, e }));
            assert.notStrictEqual(a.code, 409, JSON.stringify(zeile));
        }
    });
    await pruefe('die Liste nennt `laeuft`, der Knopf ist dann gesperrt, Fertigmeldung gibt ihn frei', async () => {
        const seite = fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/views/guild/partials/server-detail-backups.ejs'), 'utf8');
        assert.match(seite, /\$\{b\.laeuft \? 'disabled' : ''\}/);
        assert.match(seite, /\.on\('backup_completed', \(\) => loadBackups\(\)\)/);
        const routen = fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/routes/servers.js'), 'utf8');
        assert.match(routen, /laeuft: Sicherung\.laeuft\(b\)/);
    });

    console.log('\nNach einem Neustart, an einer Kopie');
    require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
    const roh = await require('mysql2/promise').createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT, user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
    });
    await pruefe('Liegengebliebenes wird aufgeräumt, Fertiges bleibt, und der Start hängt daran', async () => {
        await roh.query('CREATE TEMPORARY TABLE kopie_b LIKE gameserver_backups');
        await roh.query('CREATE TEMPORARY TABLE gameserver_backups LIKE kopie_b');
        await roh.query(`INSERT INTO gameserver_backups (server_id, guild_id, name, status, created_by) VALUES
            (1, 'g', 'lief', 'running', 'u'), (1, 'g', 'wartete', 'pending', 'u'),
            (1, 'g', 'stellte', 'restoring', 'u'), (1, 'g', 'fertig', 'completed', 'u')`);
        await Sicherung.nachNeustart({ query: (sql, p) => roh.query(sql, p).then(r => r[0]) });
        const [z] = await roh.query('SELECT name, status, error_message, wiederhergestellt FROM gameserver_backups ORDER BY id');
        assert.deepStrictEqual(z.map(x => x.status), ['failed', 'failed', 'completed', 'completed']);
        assert.match(z[0].error_message, /neu gestartet/);
        assert.match(z[2].wiederhergestellt, /gescheitert/, 'die Liste färbt nur „gescheitert" rot');
        assert.strictEqual(z[3].error_message, null);
        assert.strictEqual(Sicherung.laeuft(z[0]), false, 'die Zeile muss sich löschen lassen');
        assert.match(fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/index.js'), 'utf8'), /helpers\/Sicherung'\)\.nachNeustart\(dbService\)/);
    });
    await roh.end();

    console.log(`\n${bestanden} Prüfung(en) bestanden.`);
    dash.close(); daemon.close();
    process.exit(process.exitCode || 0);
})();
