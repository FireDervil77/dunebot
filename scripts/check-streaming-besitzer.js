#!/usr/bin/env node
/**
 * Den Kanalinhaber gibt es nur einmal (Kassensturz K101, Baustelle 72, 2026-11-07).
 *
 * `streaming_streamers.besitzer_id` stand seit der Baseline im Schema, leer,
 * ohne Leser — beim Lesen des Schemas sah die Eigentumsfrage beantwortet aus.
 * Den Inhaber gibt allein die Kontoverknüpfung (`kanalInhaber()` über
 * `user_connections`). Betreiber am 2026-11-07: „Spalte löschen".
 *
 *   Code       außer Baseline und der Entfernung nennt kein Code die Spalte
 *   Migration  an einer TEMPORÄREN Kopie von streaming_streamers: entfernt
 *              die Spalte, ein zweiter Lauf tut nichts, down legt sie leer an
 *
 *   node scripts/check-streaming-besitzer.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

const MIGRATION = 'plugins/streaming/migrations/20261107_150000_besitzer_entfernen.js';
const ERLAUBT = new Set(['plugins/streaming/migrations/20260823_120000_baseline.js', MIGRATION]);

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 6).join('\n      ')}`); }
}

function dateien(ordner, liste = []) {
    for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const p = path.join(ordner, e.name);
        if (e.isDirectory()) dateien(p, liste);
        else if (/\.(js|ejs)$/.test(e.name)) liste.push(p);
    }
    return liste;
}

(async () => {
    console.log('\nKanalinhaber nur aus der Verknüpfung (K101)');

    await pruefe('Code: außer Baseline und Entfernung nennt niemand besitzer_id', async () => {
        const funde = [];
        for (const teil of ['plugins', 'apps', 'packages']) {
            for (const p of dateien(path.join(WURZEL, teil))) {
                const rel = path.relative(WURZEL, p);
                if (ERLAUBT.has(rel)) continue;
                const roh = fs.readFileSync(p, 'utf8');
                const text = p.endsWith('.ejs') ? ohneKommentareEjs(roh) : ohneKommentare(roh);
                if (/\bbesitzer_id\b/.test(text)) funde.push(rel);
            }
        }
        assert.deepStrictEqual(funde, [], `nennt die entfernte Spalte: ${funde.join(', ')}`);
    });

    await pruefe('Migration: an einer temporären Kopie, entfernt die Spalte, zweiter Lauf tut nichts, down legt sie leer an', async () => {
        const c = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
            user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE });
        try {
            // Die temporäre Tabelle verdeckt in DIESER Verbindung die echte (DDL nur an TEMPORARY).
            await c.query('CREATE TEMPORARY TABLE fb_probe_streamers LIKE streaming_streamers');
            await c.query('CREATE TEMPORARY TABLE streaming_streamers LIKE fb_probe_streamers');
            const db = { query: (sql, p) => c.query(sql, p).then(([r]) => r) };
            const spalten = async () => (await db.query('SHOW COLUMNS FROM streaming_streamers')).map(r => r.Field);
            if (!(await spalten()).includes('besitzer_id')) {
                await db.query('ALTER TABLE streaming_streamers ADD COLUMN besitzer_id VARCHAR(32) DEFAULT NULL AFTER avatar_url');
            }
            const mig = require(path.join(WURZEL, MIGRATION));
            await mig.up(db);
            await mig.up(db);
            assert.ok(!(await spalten()).includes('besitzer_id'), 'die Spalte steht noch');
            await mig.down(db);
            const zurueck = await spalten();
            assert.strictEqual(zurueck[zurueck.indexOf('avatar_url') + 1], 'besitzer_id', 'down legt sie nicht an ihren Platz');
        } finally { await c.end(); }
    });

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ Den Kanalinhaber gibt allein die Verknüpfung');
    process.exit(fehler ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
