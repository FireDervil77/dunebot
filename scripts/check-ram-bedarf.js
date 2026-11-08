#!/usr/bin/env node
/**
 * RAM lässt sich nicht stillschweigend unter den Bedarf verkleinern (K055, 2026-11-08).
 *
 * Bis dahin prüfte die Route PUT /servers/:id beim Verkleinern nichts. Die
 * Grenze des Containers greift erst im Betrieb: Braucht das Spiel mehr, beendet
 * das System den Prozess, und der Server stürzt irgendwann im Spiel ab.
 *
 * Geprüft wird:
 *   - die Rechnung in helpers/RamBedarf.js (Spitze plus 10 %, nur beim Verkleinern),
 *   - an der echten Datenbank, dass die Abfrage läuft (nur lesend),
 *   - dass Route, Seite und Formular-Handler die Rechnung wirklich benutzen.
 *
 *   node scripts/check-ram-bedarf.js
 */
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../apps/dashboard/.env'), quiet: true });
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const mysql = require('mysql2/promise');
const { ohneKommentare } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const lies = (d) => fs.readFileSync(path.join(WURZEL, d), 'utf8');
const RamBedarf = require('../plugins/gameserver/dashboard/helpers/RamBedarf');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').join('\n      ')}`); }
}

(async () => {
    console.log('Rechnung');
    await pruefe('ohne Messung gibt es nichts zu warnen', () => {
        assert.strictEqual(RamBedarf.beurteile(null), null);
        assert.strictEqual(RamBedarf.beurteile(0), null);
        assert.strictEqual(RamBedarf.warnung(null, 1024, 8192), null);
    });
    await pruefe('Grenze ist die Spitze plus 10 %, auch wenn die Spitze als Text kommt', () => {
        const b = RamBedarf.beurteile('5120');
        assert.strictEqual(b.spitzeMb, 5120);
        assert.strictEqual(b.grenzeMb, 5632);
        assert.match(b.text, /5 GiB/);
        assert.match(b.text, /5,5 GiB/);
    });
    await pruefe('verkleinern unter die Grenze warnt, darüber nicht', () => {
        const b = RamBedarf.beurteile(5120);
        assert.match(RamBedarf.warnung(b, 4096, 8000) || '', /^4 GiB ist weniger/);
        assert.strictEqual(RamBedarf.warnung(b, 6144, 8000), null);
    });
    await pruefe('vergrößern oder gleich lassen warnt nie, auch unter der Grenze', () => {
        const b = RamBedarf.beurteile(5120);
        assert.strictEqual(RamBedarf.warnung(b, 4096, 2048), null);
        assert.strictEqual(RamBedarf.warnung(b, 4096, 4096), null);
    });
    await pruefe('von „kein Limit“ auf eine Grenze darunter warnt', () => {
        const b = RamBedarf.beurteile(5120);
        assert.ok(RamBedarf.warnung(b, 4096, null));
    });

    console.log('\nDatenbank (nur lesend)');
    const db = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT) || 3306,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
    });
    try {
        await pruefe('die Abfrage läuft und liefert für einen gemessenen Server eine Grenze', async () => {
            const huelle = { query: async (sql, w) => (await db.query(sql, w))[0] };
            const [zeile] = await huelle.query(
                'SELECT server_id FROM server_metrics WHERE ram_mb_max > 0 AND bucket_start > NOW() - INTERVAL 30 DAY LIMIT 1');
            if (!zeile) { console.log('      (kein Server mit Messung in 30 Tagen — nur die Abfrage geprüft)'); }
            const b = await RamBedarf.lade(huelle, zeile ? zeile.server_id : 0);
            if (zeile) assert.ok(b && b.grenzeMb > b.spitzeMb, JSON.stringify(b));
            else assert.strictEqual(b, null);
        });
    } finally {
        await db.end();
    }

    console.log('\nVerdrahtung');
    const route = ohneKommentare(lies('plugins/gameserver/dashboard/routes/servers.js'));
    await pruefe('PUT prüft vor dem Speichern und verlangt ram_trotzdem', () => {
        const a = route.indexOf("router.put('/:serverId',");
        assert.ok(a >= 0, 'Route nicht gefunden');
        const block = route.slice(a, route.indexOf('router.', a + 10));
        const w = block.indexOf('RamBedarf.warnung(');
        const u = block.indexOf('UPDATE gameservers SET');
        assert.ok(w >= 0, 'RamBedarf.warnung fehlt');
        assert.ok(u > w, 'die Prüfung steht nicht vor dem UPDATE');
        assert.match(block, /req\.body\.ram_trotzdem !== 'ja'/);
        assert.match(block, /status\(409\)[\s\S]{0,80}rueckfrage: 'ram_unter_bedarf'/);
    });
    await pruefe('die Seite bekommt den Bedarf und zeigt den Schalter', () => {
        assert.match(route, /renderView\(res, 'guild\/gameserver-edit', \{[\s\S]{0,80}ramBedarf/);
        const ejs = lies('plugins/gameserver/dashboard/views/guild/gameserver-edit.ejs');
        assert.match(ejs, /name="ram_trotzdem" value="ja"/);
        assert.match(ejs, /form-check form-switch[\s\S]{0,200}ram_trotzdem/);
        assert.match(ejs, /data-grenze-mb="<%= ramBedarf\.grenzeMb %>"/);
    });
    await pruefe('der Formular-Handler zeigt die Meldung des Servers, nicht „Netzwerkfehler“', () => {
        const g = ohneKommentare(lies('apps/dashboard/themes/default/assets/js/guild.js'));
        assert.match(g, /fehler\.meldung = antwort\.message/);
        assert.match(g, /showToast\('error', error\.meldung/);
    });

    console.log(fehler ? `\n❌ ${fehler} Prüfung(en) rot` : '\n✅ RAM unter dem Bedarf nur mit Zustimmung');
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
