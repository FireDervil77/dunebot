#!/usr/bin/env node
/**
 * Widget „RootServer" auf dem Hauptdashboard (Baustelle 207, 2026-10-28).
 *
 * Betreiber: „bei beiden servern steht offline obwohl sie vorhanden sind."
 * Das Widget prüfte `rs.status` — die Spalte gibt es seit der Migration
 * `20260801_120000_drop_rootserver_status` nicht mehr, sie heißt
 * `daemon_status`. Der Weg zum Widget (`RootServer.getByGuild`, `r.*`) setzt
 * keinen Alias, also kam `undefined` an und das Abzeichen stand immer auf
 * „Offline".
 *
 *   Felder   jedes `rs.<feld>` im Widget ist eine Spalte von `rootserver`
 *            oder eine Zählspalte aus getByGuild — ein geratener Name fällt hier auf
 *   Zustand  gerendert mit den echten Zeilen: das Abzeichen folgt daemon_status
 *
 * Live-Werte (das Widget zieht nach dem Laden nichts nach) prüft das nicht —
 * das ist der zweite, offene Teil von Baustelle 207.
 *
 * Gelesen wird aus der Datenbank, geschrieben nichts.
 *
 *   node scripts/check-rootserver-widget.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentareEjs } = require('./lib/quelltext');

const WIDGET = 'plugins/masterserver/dashboard/views/widgets/rootserver-status.ejs';
const ZAEHLSPALTEN = ['gameserver_count', 'gameserver_running_count'];

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 3).join('\n      ')}`); }
}

(async () => {
    const c = await mysql.createConnection({ host: process.env.MYSQL_HOST, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE });
    ServiceManager.register('dbService', {
        query: async (s, p) => {
            if (!/^\s*SELECT/i.test(s)) throw new Error('Wächter schreibt nicht: ' + s.slice(0, 40));
            return (await c.query(s, p))[0];
        },
        tableExists: async (t) => (await c.query('SHOW TABLES LIKE ?', [t]))[0].length > 0,
    });
    const RootServer = require('../plugins/masterserver/dashboard/models/RootServer');
    const quelle = fs.readFileSync(path.join(WURZEL, WIDGET), 'utf8');
    const zeichne = (rootservers) => ejs.render(quelle, { guildId: 'x', rootservers }, { filename: path.join(WURZEL, WIDGET) });
    const abzeichen = (html) => [...html.matchAll(/-lt" style="font-size:\.7rem;">\s*(Online|Offline)\s*</g)].map(m => m[1]);

    console.log('\nWidget „RootServer"');

    await pruefe('jedes rs.<feld> im Widget ist eine Spalte von rootserver', async () => {
        const spalten = (await c.query('SHOW COLUMNS FROM rootserver'))[0].map(z => z.Field);
        const benutzt = [...new Set([...ohneKommentareEjs(quelle).matchAll(/\brs\.([a-z_]+)/g)].map(m => m[1]))];
        const geraten = benutzt.filter(f => !spalten.includes(f) && !ZAEHLSPALTEN.includes(f));
        assert.deepStrictEqual(geraten, [], `keine Spalte: ${geraten.join(', ')}`);
    });

    await pruefe('mit den echten Zeilen: das Abzeichen folgt daemon_status', async () => {
        const [g] = (await c.query('SELECT guild_id FROM rootserver GROUP BY guild_id ORDER BY COUNT(*) DESC LIMIT 1'))[0];
        assert.ok(g, 'kein RootServer in der Datenbank — nichts zu vergleichen');
        const zeilen = await RootServer.getByGuild(g.guild_id);
        const erwartet = zeilen.map(r => r.daemon_status === 'online' ? 'Online' : 'Offline');
        assert.deepStrictEqual(abzeichen(zeichne(zeilen)), erwartet);
    });

    await pruefe('Gegenprobe: online und offline unterscheiden sich im Abzeichen', async () => {
        assert.deepStrictEqual(abzeichen(zeichne([{ id: 1, name: 'a', daemon_status: 'online' }, { id: 2, name: 'b', daemon_status: 'offline' }])), ['Online', 'Offline']);
    });

    await c.end();
    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✓ alles grün');
    process.exit(fehler ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
