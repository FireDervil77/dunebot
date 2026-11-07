#!/usr/bin/env node
/**
 * Kein Shard ohne Manager (2026-11-07).
 *
 * Am 2026-11-07 um 10:01 wurde Shard 0 nicht innerhalb von `spawnTimeout`
 * bereit. Der Shard-Manager (apps/bot/index.js) meldete den Fehler und ging,
 * ohne den Shard zu beenden; pm2 startete einen neuen Manager samt Shard. Der
 * alte Shard (PID 393989, Elternprozess 1) wurde doch noch fertig und lief
 * weiter. Zwei „Bot #0" warfen sich danach alle zwei Sekunden gegenseitig vom
 * IPC des Dashboards (551 Abbrüche in der ersten Stunde); `/plugin status`
 * scheiterte mit „It is not connected to this client".
 *
 *   Manager  scheitert der Start, beendet er seine Shards vor sich selbst
 *   Shard    verschwindet der Manager, beendet er sich selbst (`disconnect`),
 *            SIGTERM, SIGINT und `disconnect` laufen über ein Beenden, das
 *            nur einmal aufräumt und nach zehn Sekunden hart endet
 *   Annahme  Node meldet `disconnect` auch, wenn der Elternprozess hart
 *            (SIGKILL) stirbt — nachgemessen, nicht angenommen
 *
 *   node scripts/check-shard-waise.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WURZEL = path.join(__dirname, '..');
const { ohneKommentare } = require('./lib/quelltext');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 6).join('\n      ')}`); }
}
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), 'utf8');
const warte = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
    console.log('\nKein Shard ohne Manager');

    await pruefe('Manager: scheitert der Start, werden erst die Shards beendet, dann der Manager', async () => {
        const q = ohneKommentare(lies('apps/bot/index.js'));
        const ab = q.indexOf('Logger.error("Fehler beim Spawnen der Shards:", err);');
        assert.ok(ab > 0, 'Fehlerzweig nicht gefunden');
        const zweig = q.slice(ab, q.indexOf('process.exit(1);', ab));
        assert.match(zweig, /for \(const shard of manager\.shards\.values\(\)\)[\s\S]*shard\.kill\(\)/);
    });

    await pruefe('Shard: SIGTERM, SIGINT und disconnect laufen über ein einmaliges Beenden mit harter Frist', async () => {
        const q = ohneKommentare(lies('apps/bot/bot.js'));
        assert.match(q, /process\.on\('SIGTERM', \(\) => beendeEinmal\(/);
        assert.match(q, /process\.on\('SIGINT', \(\) => beendeEinmal\(/);
        assert.match(q, /if \(typeof process\.send === 'function'\) \{\s*process\.on\('disconnect', \(\) => beendeEinmal\(/);
        const f = q.slice(q.indexOf('function beendeEinmal('));
        assert.match(f.slice(0, 400), /if \(!beenden\)/, 'räumt mehrfach auf');
        assert.match(f.slice(0, 400), /setTimeout\(\(\) => process\.exit\(0\), 10000\)\.unref\(\)/, 'keine harte Frist');
        assert.ok(!/process\.on\('SIGTERM', async/.test(q), 'ein zweiter SIGTERM-Weg');
    });

    await pruefe('Annahme: ein Kind bekommt disconnect, wenn der Elternprozess per SIGKILL stirbt', async () => {
        const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'shard-waise-'));
        const marke = path.join(ordner, 'kind.txt');
        const kind = path.join(ordner, 'kind.js');
        const eltern = path.join(ordner, 'eltern.js');
        fs.writeFileSync(kind, `
            const fs = require('fs');
            process.on('disconnect', () => { fs.writeFileSync(${JSON.stringify(marke)}, 'disconnect'); process.exit(0); });
            setInterval(() => {}, 1000);
        `);
        fs.writeFileSync(eltern, `
            const { fork } = require('child_process');
            const k = fork(${JSON.stringify(kind)});
            console.log(k.pid);
            setInterval(() => {}, 1000);
        `);
        const p = spawn(process.execPath, [eltern], { stdio: ['ignore', 'pipe', 'inherit'] });
        const kindPid = await new Promise((ok, nein) => {
            p.stdout.once('data', d => ok(Number(String(d).trim())));
            setTimeout(() => nein(new Error('Kind nicht gestartet')), 5000);
        });
        p.kill('SIGKILL');
        let lebt = true;
        for (let i = 0; i < 30 && lebt; i++) {
            await warte(100);
            try { process.kill(kindPid, 0); } catch { lebt = false; }
        }
        if (lebt) { try { process.kill(kindPid, 'SIGKILL'); } catch { /* schon weg */ } }
        const gemeldet = fs.existsSync(marke) ? fs.readFileSync(marke, 'utf8') : null;
        fs.rmSync(ordner, { recursive: true, force: true });
        assert.strictEqual(lebt, false, 'das Kind lebt nach dem Tod des Elternprozesses weiter');
        assert.strictEqual(gemeldet, 'disconnect');
    });

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ Ein Shard endet mit seinem Manager');
    process.exit(fehler ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
