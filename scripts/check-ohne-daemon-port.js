#!/usr/bin/env node
/**
 * Das Feld „Daemon-Port" ist weg (2026-11-03).
 *
 * Gelesen hat `rootserver.daemon_port` niemand, Formular und Detailseite zeigten es
 * trotzdem mit „Standard: 9340 (WebSocket)". Der Daemon lauscht für seine Leitung auf
 * keinem Port, er verbindet sich zum Busbahnhof. Hier: Niemand kennt das Feld mehr, die
 * Migration räumt die Spalte ab, und das Anlegen eines RootServers geht danach noch
 * (an einer temporären Kopie der Tabelle).
 *
 *   node scripts/check-ohne-daemon-port.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const ejs = require('ejs');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare } = require('./lib/quelltext');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 3).join('\n      ')}`); }
}

function dateien(ordner, aus = []) {
    for (const eintrag of fs.readdirSync(ordner, { withFileTypes: true })) {
        const p = path.join(ordner, eintrag.name);
        if (eintrag.isDirectory()) {
            if (!['node_modules', 'migrations', 'public', 'vendor'].includes(eintrag.name)) dateien(p, aus);
        } else if (/\.(js|ejs)$/.test(eintrag.name)) aus.push(p);
    }
    return aus;
}

(async () => {
    console.log('\nNiemand kennt das Feld mehr');
    await pruefe('kein daemon_port und kein daemonPort in Dashboard und Plugins (außer Migrationen)', () => {
        const treffer = [...dateien(path.join(WURZEL, 'apps/dashboard')), ...dateien(path.join(WURZEL, 'plugins'))]
            .filter(p => /daemon_port|daemonPort/.test(ohneKommentare(fs.readFileSync(p, 'utf8'))))
            .map(p => path.relative(WURZEL, p));
        assert.deepStrictEqual(treffer, []);
    });
    await pruefe('Anlegeformular und Detailseite übersetzen sich, ohne „Daemon-Port"', () => {
        for (const datei of ['masterserver-rootserver-create.ejs', 'masterserver-rootserver-detail.ejs']) {
            const vorlage = fs.readFileSync(path.join(WURZEL, 'plugins/masterserver/dashboard/views/guild', datei), 'utf8');
            ejs.compile(vorlage);
            assert.doesNotMatch(vorlage, /Daemon-Port/, datei);
        }
    });

    console.log('\nDatenbank, an einer temporären Kopie');
    const roh = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT, user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
    });
    const db = { query: async (sql, p) => (await roh.query(sql, p))[0] };
    ServiceManager.register('dbService', db);
    ServiceManager.register('Logger', { info() {}, warn() {}, error() {}, debug() {} });
    const migration = require('../plugins/masterserver/migrations/20261103_200000_rootserver_ohne_daemon_port');
    const RootServer = require('../plugins/masterserver/dashboard/models/RootServer');
    const spalte = async () => (await db.query("SHOW COLUMNS FROM rootserver LIKE 'daemon_port'")).length;
    try {
        // Die temporäre Tabelle verdeckt die echte, nur in dieser Verbindung.
        const [[echt]] = await roh.query('SHOW CREATE TABLE rootserver');
        await roh.query(echt['Create Table'].replace(/^CREATE TABLE/, 'CREATE TEMPORARY TABLE'));
        const vorher = await spalte();
        await pruefe('die Migration nimmt die Spalte, ein zweites Mal ändert nichts, down legt sie wieder an', async () => {
            await migration.up(db);
            await migration.up(db);
            assert.strictEqual(await spalte(), 0);
            await migration.down(db);
            assert.strictEqual(await spalte(), 1);
            await migration.up(db);
            assert.strictEqual(await spalte(), 0);
        });
        await pruefe('ein RootServer lässt sich danach anlegen und bearbeiten', async () => {
            const angelegt = await RootServer.create({
                guildId: 'g-probe', ownerUserId: 'u', name: 'Probe-ohne-Port', host: '127.0.0.1',
                ramTotalGb: 8, diskTotalGb: 100,
            });
            const id = angelegt.id || angelegt.insertId || angelegt;
            const [zeile] = await db.query('SELECT name, host FROM rootserver WHERE guild_id = ?', ['g-probe']);
            assert.deepStrictEqual([zeile.name, zeile.host], ['Probe-ohne-Port', '127.0.0.1']);
            await RootServer.update(id, { name: 'Probe-umbenannt', daemon_port: 1234 });
            const [neu] = await db.query('SELECT name FROM rootserver WHERE guild_id = ?', ['g-probe']);
            assert.strictEqual(neu.name, 'Probe-umbenannt');
        });
        await pruefe('die echte Tabelle blieb unberührt', async () => {
            const andere = await mysql.createConnection({
                host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT, user: process.env.MYSQL_USER,
                password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
            });
            try {
                const [z] = await andere.query("SELECT COUNT(*) AS n FROM rootserver WHERE guild_id = 'g-probe'");
                assert.strictEqual(Number(z[0].n), 0);
            } finally {
                await andere.end();
            }
            assert.ok(vorher === 0 || vorher === 1);
        });
    } finally {
        await roh.end();
    }

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ Das Feld „Daemon-Port" ist weg, und RootServer entstehen wie vorher');
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
