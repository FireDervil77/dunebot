#!/usr/bin/env node
/**
 * ficsit.app als Mod-Quelle für Satisfactory (Stufe 10 S1, 2026-10-27).
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 *
 *   Regel      `passt` (game_version gegen die Changelist) und `ausschluss`
 *              (Broken, kein LinuxServer-Ziel, falsche Spielfassung) — ohne Netz
 *   Weiche     Quellen.js kennt `ficsit`; das Paketschema an allen drei Stellen
 *              (sources, source_ids, loader.packages); die Werkbank-Listen
 *   Datenbank  `gameserver_content.quelle` nimmt `ficsit` — die Migration läuft
 *              an einer TEMPORARY-Kopie, der Bestand bleibt unberührt
 *   Echt       (mit Netz) SML hat die am 2026-10-27 nachgerechnete Summe,
 *              PowerSuit wird als Broken abgewiesen, PowerChecker bringt SML
 *              und MarcioCommonLibs VORNE mit. Ohne Netz: übersprungen und so
 *              gesagt — eine abgewiesene Antwort ist KEIN fehlendes Netz.
 *
 *   node scripts/check-ficsit.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { ServiceManager } = require('dunebot-core');

const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const still = () => {};
if (!ServiceManager.has('Logger')) ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });

const HELFER = path.join(WURZEL, 'plugins/gameserver/dashboard/helpers');
const Ficsit = require(path.join(HELFER, 'Ficsit.js'));
const Quellen = require(path.join(HELFER, 'Quellen.js'));

let fehler = 0, bestanden = 0;
async function pruefe(was, tun) {
    try { const r = await tun(); bestanden++; console.log(`  ✓ ${was}${r ? ' — ' + r : ''}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 4).join('\n      ')}`); }
}

(async () => {
    console.log('\nRegel');

    await pruefe('passt: Changelist gegen game_version — unbekannt ist unbekannt, nicht „passt"', () => {
        assert.strictEqual(Ficsit.passt('>=491125', 513885), true);
        assert.strictEqual(Ficsit.passt('>=520000', 513885), false);
        assert.strictEqual(Ficsit.passt('>=491125', null), null);
        assert.strictEqual(Ficsit.passt('', 513885), null);
        assert.strictEqual(Ficsit.passt('quatsch', 513885), null);
    });

    await pruefe('ausschluss: Broken, ohne LinuxServer, falsche Spielfassung — Damaged bleibt', () => {
        const mod = (state) => ({ name: 'X', mod_reference: 'X', compatibility: { EA: { state } } });
        const f = (ziele, gv = '>=491125') => ({ version: '1.0.0', game_version: gv, targets: ziele.map(t => ({ targetName: t })) });
        assert.match(Ficsit.ausschluss(mod('Broken'), f(['LinuxServer']), 513885), /Broken/);
        assert.match(Ficsit.ausschluss(mod('Works'), f(['Windows']), 513885), /reiner Client-Mod/);
        assert.match(Ficsit.ausschluss(mod('Works'), f(['LinuxServer'], '>=600000'), 513885), /verlangt Spielfassung/);
        assert.strictEqual(Ficsit.ausschluss(mod('Damaged'), f(['LinuxServer']), 513885), null);
        assert.strictEqual(Ficsit.ausschluss(mod('Works'), f(['LinuxServer'], '>=600000'), null), null, 'ohne Changelist wird nicht gefiltert');
    });

    await pruefe('istErlaubt: nur api. und storage.ficsit.app, nur https', () => {
        assert.ok(Ficsit.istErlaubt('https://api.ficsit.app/v1/version/x/LinuxServer/download'));
        assert.ok(Ficsit.istErlaubt('https://storage.ficsit.app/file/x.smod'));
        for (const a of ['http://api.ficsit.app/x', 'https://ficsit.app/mod/SML', 'https://boese-storage.ficsit.app/x', 'https://storage.ficsit.app.evil.com/x']) {
            assert.ok(!Ficsit.istErlaubt(a), `${a} ist erlaubt`);
        }
    });

    console.log('\nWeiche und Schema');

    await pruefe('Quellen.js kennt ficsit, mit der Form der anderen Anbieter', () => {
        assert.strictEqual(Quellen.fuer('ficsit'), Ficsit);
        for (const f of ['suche', 'verzeichnis', 'adresse', 'paket', 'aufloesen', 'aktualisierungen', 'fassungen', 'hoeher', 'neuerAls', 'istErlaubt']) {
            assert.strictEqual(typeof Ficsit[f], 'function', `${f} fehlt`);
        }
        assert.deepStrictEqual(Quellen.ausPaket({ sources: ['ficsit'] }), ['ficsit']);
    });

    await pruefe('das Paketschema nimmt ficsit in sources, source_ids und loader.packages', () => {
        const schema = JSON.parse(fs.readFileSync(path.join(WURZEL, 'packages/fbpkg/schema/fbpkg-v1.schema.json'), 'utf8'));
        const text = JSON.stringify(schema);
        assert.ok(/"sources":\{"type":"array","items":\{"enum":\[[^\]]*"ficsit"/.test(text), 'sources');
        assert.ok(/"source_ids":\{[^{]*"type":"object","additionalProperties":false,"properties":\{[\s\S]*?"ficsit":\{/.test(text), 'source_ids');
        assert.ok(/"packages":\{[^{]*"type":"object","additionalProperties":false,"properties":\{"thunderstore"[\s\S]*?"ficsit":\{/.test(text), 'loader.packages');
    });

    console.log('\nDatenbank (TEMPORARY-Kopie)');

    const c = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE });
    const typ = async () => {
        const [[z]] = await c.query('SHOW CREATE TABLE gameserver_content');
        return /`quelle` (enum\([^)]*\))/.exec(z['Create Table'])[1];
    };
    const echtVorher = await typ();

    await pruefe('das Satisfactory-Paket mit ficsit-Inhalt besteht das Schema', async () => {
        const Ajv = require('ajv');
        const schema = JSON.parse(fs.readFileSync(path.join(WURZEL, 'packages/fbpkg/schema/fbpkg-v1.schema.json'), 'utf8'));
        const [[v]] = await c.query(`SELECT v.fbpkg FROM package_versions v JOIN packages p ON p.id = v.package_id
            WHERE p.slug = 'satisfactory' ORDER BY v.id DESC LIMIT 1`);
        const paket = { ...JSON.parse(v.fbpkg), content: { supported: true, sources: ['ficsit'], source_ids: { ficsit: 'satisfactory' },
            path: 'game/FactoryGame/Mods', client_side: true, needs_restart: true, activation: 'start',
            loader: { key: 'sml', installable_as_content: true, packages: { ficsit: 'SML' }, path: 'game/FactoryGame/Mods/SML' } } };
        const pruefen = new Ajv({ allErrors: true, strict: false }).compile(schema);
        assert.ok(pruefen(paket), JSON.stringify(pruefen.errors).slice(0, 400));
        // Gegenprobe: eine Quelle, die es nicht gibt, fällt durch.
        assert.ok(!pruefen({ ...paket, content: { ...paket.content, sources: ['ficsitt'] } }), 'eine erfundene Quelle bestand das Schema');
    });
    await pruefe('die Migration erweitert quelle um ficsit — an der Kopie; zweimal laufen schadet nicht', async () => {
        // Über einen Umweg: `CREATE TEMPORARY TABLE x LIKE x` lehnt MySQL ab.
        await c.query('CREATE TEMPORARY TABLE fb_gc_form LIKE gameserver_content');
        await c.query('CREATE TEMPORARY TABLE gameserver_content LIKE fb_gc_form');
        const [[k]] = await c.query('SHOW CREATE TABLE gameserver_content');
        assert.match(k['Create Table'], /^CREATE TEMPORARY TABLE/, 'die Kopie verdeckt den Bestand nicht — abgebrochen');
        const db = { query: async (sql, w) => (await c.query(sql, w))[0] };
        const m = require(path.join(WURZEL, 'plugins/gameserver/migrations/20261027_120000_inhalt_quelle_ficsit.js'));
        if (echtVorher.includes("'ficsit'")) return 'Bestand trägt ficsit schon — Migration lief';
        await m.up(db);
        await m.up(db);   // zweites Mal: nichts zu tun
        assert.match(await typ(), /'ficsit'/, 'die Kopie trägt ficsit nicht');
        await c.query("INSERT INTO gameserver_content (server_id, guild_id, art, quelle, kennung) VALUES (1, 'g', 'mod', 'ficsit', 'SML')");
        await assert.rejects(m.down(db), /erst entfernen/);
    });
    await c.query('DROP TEMPORARY TABLE IF EXISTS gameserver_content');
    await c.query('DROP TEMPORARY TABLE IF EXISTS fb_gc_form');
    await pruefe('der Bestand ist unberührt', async () => assert.strictEqual(await typ(), echtVorher));
    await c.end();

    console.log('\nEcht (ficsit.app)');

    const ohneNetz = (e) => /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|fetch failed|aborted|timeout/i.test(String(e?.cause?.code || e?.message));
    async function echt(was, tun) {
        try { await tun(); bestanden++; console.log(`  ✓ ${was}`); }
        catch (e) {
            if (ohneNetz(e)) { console.log(`  · ${was} — übersprungen, kein Netz: ${e.message}`); return; }
            fehler++; console.log(`  ✗ ${was}\n      ${e.message}`);
        }
    }
    await echt('SML 3.12.0 trägt die am 2026-10-27 nachgerechnete Summe', async () => {
        const p = await Ficsit.paket('satisfactory', 'SML', '3.12.0');
        assert.strictEqual(p.sha256, 'b44d03b49afbd3757c8566281d0a1a6e250c4b676284774f1c1d11f6e6957b77');
        assert.ok(Ficsit.istErlaubt(p.adresse), p.adresse);
    });
    await echt('PowerSuit wird als Broken abgewiesen', async () => {
        await assert.rejects(Ficsit.paket('satisfactory', 'PowerSuit'), /Broken/);
    });
    await echt('PowerChecker bringt SML und MarcioCommonLibs VORNE mit', async () => {
        const { pakete, fehlend } = await Ficsit.aufloesen('satisfactory', 'PowerChecker', null, { spielfassung: 513885 });
        assert.deepStrictEqual(pakete.map(p => p.kennung), ['SML', 'MarcioCommonLibs', 'PowerChecker']);
        assert.deepStrictEqual(fehlend, []);
        assert.ok(pakete.every(p => /^[0-9a-f]{64}$/.test(p.sha256)), 'eine Datei ohne Prüfsumme');
    });

    console.log(fehler ? `\n✗ ${fehler} gescheitert, ${bestanden} bestanden` : `\n✓ ${bestanden} bestanden`);
    process.exit(fehler ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
