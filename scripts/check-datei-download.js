#!/usr/bin/env node
/**
 * Dateien über 10 MB (Baustelle 135, Betreiber 2026-10-29: F4).
 *
 *   Unterschrift  Abruf.dateiAdresse rechnet wie DateiUnterschrift im Daemon —
 *                 derselbe Prüfvektor wie datei_test.go
 *   Kopf          anhangKopf übersteht Umlaute und `€` (setHeader wirft sonst)
 *   Durchreichen  echter HTTP-Ablauf gegen einen Attrappen-Daemon
 *   Anfang        leseAnfang fragt mit Range und nimmt höchstens N Bytes
 *   Route         Download nicht mehr über gameserver.files.read, Sperrliste
 *                 davor; zu groß heißt 413, die Seite bietet Herunterladen an
 *
 *   node scripts/check-datei-download.js
 */
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const WURZEL = path.join(__dirname, '..');
const { ohneKommentare } = require('./lib/quelltext');
const Abruf = require('../plugins/gameserver/dashboard/helpers/Abruf');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 3).join('\n      ')}`); }
}
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), 'utf8');

(async () => {
    const SCHLUESSEL = 'schluessel';
    const inhalt = Buffer.alloc(3 * 1024 * 1024, 0x61);
    const anfragen = [];
    const daemon = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://x');
        anfragen.push({ pfad: u.searchParams.get('pfad'), range: req.headers.range });
        const erwartet = crypto.createHmac('sha256', SCHLUESSEL)
            .update(`datei\n${u.searchParams.get('server')}\n${u.searchParams.get('pfad')}\n${u.searchParams.get('bis')}`).digest('hex');
        if (u.pathname !== '/datei' || u.searchParams.get('sig') !== erwartet) { res.statusCode = 404; return res.end(); }
        const r = /bytes=0-(\d+)/.exec(req.headers.range || '');
        if (r) {
            res.writeHead(206, { 'content-length': Number(r[1]) + 1, 'content-range': `bytes 0-${r[1]}/${inhalt.length}` });
            return res.end(inhalt.subarray(0, Number(r[1]) + 1));
        }
        res.writeHead(200, { 'content-length': inhalt.length, 'content-type': 'application/octet-stream' });
        res.end(inhalt);
    });
    await new Promise(r => daemon.listen(0, '127.0.0.1', r));
    const maschine = { host: '127.0.0.1', abruf_port: daemon.address().port, api_key: SCHLUESSEL };

    const app = require('express')();
    app.use(async (req, res) => {
        const pfad = decodeURIComponent(req.url.slice(1));
        await Abruf.reicheDurch(Abruf.dateiAdresse(maschine, 209, pfad), req, res, path.basename(pfad));
    });
    const dashboard = http.createServer(app);
    await new Promise(r => dashboard.listen(0, '127.0.0.1', r));
    const holen = (pfad) => new Promise((fertig, nein) => {
        http.get({ port: dashboard.address().port, path: '/' + encodeURIComponent(pfad) }, (a) => {
            let n = 0; a.on('data', d => { n += d.length; }); a.on('end', () => fertig({ status: a.statusCode, kopf: a.headers, n }));
        }).on('error', nein);
    });

    console.log('\nDateien über 10 MB (F4)');

    await pruefe('Prüfvektor: dieselbe Zahl wie DateiUnterschrift im Daemon', async () => {
        const go = lies('../firebot_daemon/internal/sicherungsabruf/datei_test.go');
        const vektor = /const erwartet = "([0-9a-f]{64})"/.exec(go);
        assert.ok(vektor, 'kein Prüfvektor im Go-Test');
        const js = crypto.createHmac('sha256', 'schluessel').update('datei\n209\nlogs/server.log\n1790000000').digest('hex');
        assert.strictEqual(js, vektor[1]);
        const a = new URL(Abruf.dateiAdresse({ host: '1.2.3.4', abruf_port: 9350, api_key: 'schluessel' }, 209, 'logs/server.log'));
        assert.strictEqual(a.pathname, '/datei');
        assert.strictEqual(a.host, '1.2.3.4:9350');
        const bis = a.searchParams.get('bis');
        assert.strictEqual(a.searchParams.get('sig'),
            crypto.createHmac('sha256', 'schluessel').update(`datei\n209\nlogs/server.log\n${bis}`).digest('hex'));
        assert.ok(Number(bis) - Date.now() / 1000 <= 300, 'die Frist ist länger als fünf Minuten');
    });

    await pruefe('Kopf: Umlaute und € werfen nicht, der echte Name bleibt', async () => {
        const k = Abruf.anhangKopf('Prüf (€) "x".log');
        assert.doesNotThrow(() => new http.ServerResponse({ method: 'GET' }).setHeader('Content-Disposition', k));
        assert.match(k, /^attachment; filename="Pr_f \(_\) _x_\.log"; filename\*=UTF-8''/);
        assert.strictEqual(decodeURIComponent(k.split("UTF-8''")[1]), 'Prüf (€) "x".log');
    });

    await pruefe('Durchreichen: ganze Datei, auch mit € im Namen und Leerzeichen im Pfad', async () => {
        const a = await holen('logs/Spiel €.log');
        assert.strictEqual(a.status, 200);
        assert.strictEqual(a.n, inhalt.length);
        assert.match(a.kopf['content-disposition'], /^attachment;/);
        assert.strictEqual(anfragen.at(-1).pfad, 'logs/Spiel €.log', 'der Pfad kam verändert an, die Unterschrift stimmte dann nur zufällig');
    });

    await pruefe('Anfang: Range, höchstens N Bytes, Fehler kommen an', async () => {
        const b = await Abruf.leseAnfang(maschine, 209, 'BepInEx/LogOutput.log', 1024);
        assert.strictEqual(b.length, 1024);
        assert.strictEqual(anfragen.at(-1).range, 'bytes=0-1023');
        await assert.rejects(Abruf.leseAnfang({ ...maschine, api_key: 'falsch' }, 209, 'x', 10), /antwortete mit 404/);
    });

    await pruefe('Route: kein files.read mehr im Download, Sperrliste davor', async () => {
        const r = ohneKommentare(lies('plugins/gameserver/dashboard/routes/files.js'));
        const ab = r.indexOf("router.get('/servers/:serverId/files/download'");
        const route = r.slice(ab, r.indexOf('module.exports', ab));
        assert.doesNotMatch(route, /gameserver\.files\.read/);
        assert.ok(route.indexOf('sperrt(res, server') > 0 && route.indexOf('sperrt(res, server') < route.indexOf('Abruf.reicheDurch'), 'die Sperrliste steht nicht davor');
        assert.match(r, /status\(413\)\.json\(\{ success: false, zuGross: true/);
        assert.match(ohneKommentare(lies('plugins/gameserver/dashboard/assets/js/file-manager.js')), /if \(data\.zuGross\)/);
    });

    await pruefe('Modseite: große Logs über den Anfang, und sie sagt es', async () => {
        const r = ohneKommentare(lies('plugins/gameserver/dashboard/routes/inhalte.js'));
        assert.match(r, /nurAnfang = Number\(eintrag\.size\) > LOG_GRENZE/);
        assert.match(r, /leseAnfang\(maschine, geladen\.server\.id, pfad, LOG_GRENZE\)/);
        assert.match(lies('plugins/gameserver/dashboard/views/guild/partials/server-detail-inhalte.ejs'), /LADESTAND\.nurAnfang/);
    });

    daemon.close(); dashboard.close();
    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ Große Dateien: Strom statt Nachricht, gleiche Unterschrift auf beiden Seiten');
    process.exit(fehler ? 1 : 0);
})();
