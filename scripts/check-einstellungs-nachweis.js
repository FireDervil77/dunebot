#!/usr/bin/env node
/**
 * Kam jede Einstellung beim letzten Start an? (Baustelle 171, F7, 2026-11-07)
 *
 * Betreiber am 2026-09-29: „kann ich irgendwie checken am gameserver auf dem
 * anderen server ob er die einstellungen übernommen hat?" — bis dahin nur per
 * SSH. Seit dem Daemon-Commit „Einstellungs-Nachweis reist mit `started`"
 * schickt der Daemon je Einstellung und Ziel ein Urteil (dieselbe Rechnung wie
 * der Nachweis der Werkbank); das Dashboard legt es ab und zeigt es an.
 *
 *   Aufbereitung  je Einstellung das schlechteste Urteil über ihre Ziele,
 *                 Text und je Ziel ein Satz; ohne Nachweis nichts
 *   Karte         die echte Teilansicht zeichnet Pille, Warnzeile und Kopfzeile
 *   Handler       der echte _handleReadiness speichert bei `started`, nur die
 *                 bekannten Felder, gekürzt; ohne `nachweis` bleibt der alte
 *   Migration     an einer TEMPORÄREN Kopie von gameservers: legt beide Spalten
 *                 an, ein zweiter Lauf tut nichts
 *   Seite         die Serverseite fragt die Spalten ab
 *
 *   node scripts/check-einstellungs-nachweis.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const ejs = require('ejs');
const mysql = require('mysql2/promise');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare } = require('./lib/quelltext');

const still = () => {};
ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });
const Serverseite = require(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/Serverseite'));
const ANSICHTEN = path.join(WURZEL, 'plugins/gameserver/dashboard/views/guild');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 6).join('\n      ')}`); }
}

const PAKET = { settings: [
    { key: 'name', role: 'player', name: { de: 'Servername' }, type: 'text', apply: [{ target: 'arg' }, { target: 'file', file: 'a.ini', path: 'name' }] },
    { key: 'spieler', role: 'player', name: { de: 'Spieler' }, type: 'number', apply: [{ target: 'file', file: 'a.ini', path: 'max' }] },
    { key: 'gruss', role: 'player', name: { de: 'Gruß' }, type: 'text', apply: [{ target: 'rcon', command: 'say' }] },
    { key: 'neu', role: 'player', name: { de: 'Neu' }, type: 'text', apply: [{ target: 'env', variable: 'NEU' }] },
] };
const NACHWEIS = [
    { key: 'name', ziel: 'arg', wo: 'Startzeile', zustand: 'angekommen' },
    { key: 'name', ziel: 'file', wo: 'a.ini: name', zustand: 'nicht_gefunden', hinweis: 'Schlüssel fehlt' },
    { key: 'spieler', ziel: 'file', wo: 'a.ini: max', zustand: 'angekommen' },
    { key: 'gruss', ziel: 'rcon', wo: 'say', zustand: 'nicht_pruefbar' },
];
const AM = '2026-11-07 10:00:00';
const karte = (nachweis = NACHWEIS, am = AM) => Serverseite.baueUebersicht({ id: 1, name: 'x', status: 'offline', ansicht: 'einfach',
    paket_werte: '{}', einstellungs_nachweis: nachweis === null ? null : JSON.stringify(nachweis), einstellungs_nachweis_am: am }, PAKET, {});

(async () => {
    console.log('\nEinstellungs-Nachweis an der Serverseite (B171)');

    await pruefe('Aufbereitung: je Einstellung das schlechteste Urteil, ohne Nachweis nichts', async () => {
        const e = Object.fromEntries(karte().einstellungen.sichtbar.map(x => [x.schluessel, x.nachweis]));
        assert.strictEqual(e.name.zustand, 'nicht_gefunden', 'Startzeile an, Datei nicht — gewirkt hat es nicht');
        assert.strictEqual(e.name.art, 'warn');
        assert.strictEqual(e.name.ziele.length, 2);
        assert.match(e.name.ziele[1], /^file \(a\.ini: name\): die Datei kennt den Schlüssel nicht — Schlüssel fehlt$/);
        assert.strictEqual(e.spieler.art, 'gut');
        assert.strictEqual(e.gruss.art, 'neutral');
        assert.strictEqual(e.neu, null, 'kein Urteil für eine Einstellung ohne Eintrag');
        assert.strictEqual(karte().einstellungen.nachweisAm, AM);
        const ohne = karte(null, null).einstellungen;
        assert.ok(ohne.sichtbar.every(x => x.nachweis === null) && ohne.nachweisAm === null);
        const kaputt = karte('kein json', AM).einstellungen;
        assert.ok(kaputt.sichtbar.every(x => x.nachweis === null), 'kaputtes JSON darf die Seite nicht reißen');
        assert.ok(Object.keys(Serverseite.NACHWEIS).length === 6);
    });

    await pruefe('Karte: Pille je Einstellung, Warnzeile bei „kam nicht an", Kopfzeile mit dem Start', async () => {
        const html = await ejs.renderFile(path.join(ANSICHTEN, 'partials/server-detail-uebersicht.ejs'),
            { uebersicht: karte(), server: { id: 1 }, guildId: '1' });
        assert.match(html, /⚠ die Datei kennt den Schlüssel nicht/);
        assert.match(html, /✓ kam beim letzten Start an/);
        assert.match(html, /· erst im laufenden Spiel prüfbar/);
        assert.match(html, /file \(a\.ini: name\): die Datei kennt den Schlüssel nicht — Schlüssel fehlt/);
        assert.match(html, /Ob jede Einstellung ankam, zeigt der letzte Start \(07\.11\.26, 10:00\)/);
        const ohne = await ejs.renderFile(path.join(ANSICHTEN, 'partials/server-detail-uebersicht.ejs'),
            { uebersicht: karte(null, null), server: { id: 1 }, guildId: '1' });
        assert.doesNotMatch(ohne, /kam beim letzten Start|Ob jede Einstellung ankam/);
    });

    await pruefe('Handler: speichert bei started, nur bekannte Felder, gekürzt; ohne nachweis bleibt der alte', async () => {
        const schreib = [];
        ServiceManager.register('dbService', { query: async (sql, p) => {
            if (/^\s*UPDATE gameservers SET einstellungs_nachweis/.test(sql)) schreib.push(p);
            if (/SELECT guild_id, name FROM gameservers/.test(sql)) return [{ guild_id: 'g', name: 'Bude' }];
            return [];
        } });
        ServiceManager.register('sseManager', { broadcast: still });
        const Plugin = require(path.join(WURZEL, 'plugins/gameserver/dashboard/index.js'));
        const h = (payload) => Plugin.prototype._handleReadiness.call(Object.create(Plugin.prototype), payload, {}, {});
        await h({ server_id: 5, art: 'started', nachweis: [
            { key: 'name', ziel: 'arg', zustand: 'angekommen', wert: 'GEHEIM', extra: 'x' },
            { key: 'x'.repeat(300), ziel: 'file', zustand: 'nicht_gefunden', hinweis: 'h'.repeat(900) },
            { ziel: 'arg', zustand: 'angekommen' },
        ] });
        assert.strictEqual(schreib.length, 1);
        const gespeichert = JSON.parse(schreib[0][0]);
        assert.strictEqual(schreib[0][1], 5);
        assert.strictEqual(gespeichert.length, 2, 'ein Eintrag ohne key gehört nicht hinein');
        assert.ok(!JSON.stringify(gespeichert).includes('GEHEIM') && !('extra' in gespeichert[0]), 'unbekannte Felder kamen mit');
        assert.strictEqual(gespeichert[1].key.length, 100);
        assert.strictEqual(gespeichert[1].hinweis.length, 300);
        await h({ server_id: 5, art: 'started' });
        await h({ server_id: 5, art: 'ready', nachweis: [] });
        assert.strictEqual(schreib.length, 1, 'ohne nachweis oder bei anderer Art wurde der alte überschrieben');
    });

    await pruefe('Migration: an einer temporären Kopie, legt beide Spalten an, zweiter Lauf tut nichts', async () => {
        const c = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
            user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE });
        try {
            const [[echt]] = await c.query("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gameservers' AND COLUMN_NAME LIKE 'einstellungs_nachweis%'");
            // Die temporäre Tabelle verdeckt in DIESER Verbindung die echte (DDL nur an TEMPORARY).
            await c.query('CREATE TEMPORARY TABLE fb_probe_gameservers LIKE gameservers');
            await c.query('CREATE TEMPORARY TABLE gameservers LIKE fb_probe_gameservers');
            if (Number(echt.n) > 0) {
                await c.query('ALTER TABLE gameservers DROP COLUMN einstellungs_nachweis_am, DROP COLUMN einstellungs_nachweis').catch(() => {
                    // Wurf heißt: Die Spalten fehlten schon in der Kopie — dann gibt es nichts zurückzunehmen.
                });
            }
            const db = { query: (sql, p) => c.query(sql, p).then(([r]) => r) };
            const mig = require(path.join(WURZEL, 'plugins/gameserver/migrations/20261107_140000_einstellungs_nachweis.js'));
            await mig.up(db);
            await mig.up(db);
            const spalten = (await db.query("SHOW COLUMNS FROM gameservers LIKE 'einstellungs_nachweis%'")).map(r => r.Field);
            assert.deepStrictEqual(spalten, ['einstellungs_nachweis', 'einstellungs_nachweis_am']);
        } finally { await c.end(); }
    });

    await pruefe('Seite: die Detailabfrage holt beide Spalten', async () => {
        const q = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/routes/servers.js'), 'utf8'));
        assert.match(q, /gs\.einstellungs_nachweis,\s*gs\.einstellungs_nachweis_am,/);
    });

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ Die Serverseite zeigt, ob jede Einstellung beim letzten Start ankam');
    process.exit(fehler ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
