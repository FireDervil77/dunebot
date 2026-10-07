#!/usr/bin/env node
/**
 * Prüft die Freigabe von Paketfassungen (Baustelle 172, 2026-10-07).
 *
 * Bis dahin wählten sechs Abfragen die Fassung mit „stable zuerst, sonst die
 * neueste". Eine `stable`-Fassung gab es nie — jeder Server nahm also beim
 * nächsten Start, was die Werkbank zuletzt veröffentlicht hatte (Server 208 am
 * 2026-10-06: vier Fassungen an einem Vormittag).
 *
 * Zwei Teile:
 *
 *   1. Im Quelltext: Die Regel steht an EINER Stelle (helpers/Paketfassung.js).
 *      Keine Abfrage wählt mehr selbst, die alte Funktion hat keinen Aufrufer,
 *      und wer einen Server anlegt, schreibt seinen Kanal mit.
 *
 *   2. An der Datenbank: Die Regel selbst — an TEMPORÄREN Kopien. Eine
 *      temporäre Tabelle gleichen Namens verdeckt in dieser einen Verbindung
 *      die echte; an den echten Tabellen wird nichts geschrieben, und am Ende
 *      wird nachgezählt, dass sie unverändert sind.
 *
 *   node scripts/check-freigabe.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { ohneKommentare } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const P = require('../plugins/gameserver/dashboard/helpers/Paketfassung');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n')[0]}`); }
}

function quelldateien() {
    const aus = [];
    const lauf = (ordner) => {
        for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
            if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
            const p = path.join(ordner, e.name);
            if (e.isDirectory()) lauf(p);
            else if (e.name.endsWith('.js')) aus.push(p);
        }
    };
    for (const o of ['plugins', 'apps', 'packages']) lauf(path.join(WURZEL, o));
    return aus;
}

(async () => {
    console.log('\nQuelltext: die Regel steht an einer Stelle');
    const dateien = quelldateien();
    const code = new Map(dateien.map(d => [path.relative(WURZEL, d), ohneKommentare(fs.readFileSync(d, 'utf8'))]));
    const REGEL = 'plugins/gameserver/dashboard/helpers/Paketfassung.js';

    await pruefe('keine Abfrage ordnet mehr selbst nach „stable zuerst"', async () => {
        const treffer = [...code].filter(([, t]) => /channel\s*=\s*'stable'\s*\)\s*DESC/.test(t)).map(([d]) => d);
        assert.deepStrictEqual(treffer, []);
    });

    await pruefe('wer package_versions als Fassung anbindet, nimmt die Unterabfrage aus Paketfassung.js', async () => {
        const fremd = [];
        for (const [d, t] of code) {
            if (d === REGEL) continue;
            for (const m of t.matchAll(/JOIN\s+package_versions\s+pv\s+ON\s+pv\.id\s*=\s*([^\n]{0,40})/g)) {
                if (!/^\$\{FASSUNG_FUER_(SERVER|ANLEGEN)\}/.test(m[1].trim())) fremd.push(`${d}: ${m[0].trim()}`);
            }
        }
        assert.deepStrictEqual(fremd, []);
    });

    await pruefe('ladePaketFuerAddon gibt es nicht mehr — kein Aufrufer bekommt still die alte Regel', async () => {
        const treffer = [...code].filter(([, t]) => /ladePaketFuerAddon/.test(t)).map(([d]) => d);
        assert.deepStrictEqual(treffer, []);
    });

    await pruefe('beide Wege, einen Server anzulegen, schreiben den Kanal', async () => {
        const stellen = [];
        for (const [d, t] of code) {
            for (const m of t.matchAll(/INSERT INTO gameservers\s*\(([^)]*)\)/g)) stellen.push([d, m[1]]);
        }
        assert.strictEqual(stellen.length, 2, `erwartet: Dashboard und Discord — gefunden ${stellen.map(s => s[0]).join(', ')}`);
        for (const [d, spalten] of stellen) assert.match(spalten, /\bchannel\b/, `${d} legt ohne Kanal an`);
    });

    await pruefe('die Migration stellt Bestandsserver ohne freigegebene Fassung auf test', async () => {
        const m = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/migrations/20261007_100000_server_kanal.js'), 'utf8'));
        assert.match(m, /ADD COLUMN IF NOT EXISTS channel ENUM\('stable','test'\) NOT NULL DEFAULT 'stable'/);
        assert.match(m, /SET gs\.channel = 'test'[\s\S]*NOT EXISTS[\s\S]*v\.channel = 'stable'/);
    });

    await pruefe('Kontroll-Guild: nur die genannte, und ohne Angabe niemand', async () => {
        const alt = process.env.CONTROL_GUILD_ID;
        process.env.CONTROL_GUILD_ID = '42';
        assert.strictEqual(P.istKontrollGuild('42'), true);
        assert.strictEqual(P.istKontrollGuild(42), true);
        assert.strictEqual(P.istKontrollGuild('43'), false);
        assert.strictEqual(P.istKontrollGuild(null), false);
        delete process.env.CONTROL_GUILD_ID;
        assert.strictEqual(P.istKontrollGuild('42'), false, 'ohne CONTROL_GUILD_ID sieht niemand Entwürfe');
        if (alt === undefined) delete process.env.CONTROL_GUILD_ID; else process.env.CONTROL_GUILD_ID = alt;
    });

    console.log('\nDatenbank: die Regel an temporären Kopien');
    const c = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE, dateStrings: true,
    });
    const db = { query: async (sql, p) => (await c.query(sql, p))[0] };
    const zaehle = async () => JSON.stringify((await c.query(
        "SELECT (SELECT COUNT(*) FROM package_versions) n, (SELECT COALESCE(SUM(channel='stable'),0) FROM package_versions) s, (SELECT COUNT(*) FROM gameservers) g"))[0][0]);
    const vorher = await zaehle();
    const [echterKanal] = await c.query("SHOW COLUMNS FROM gameservers LIKE 'channel'");

    // Eigene Welt: zwei Pakete, vier Fassungen, drei Server. Unabhängig vom Bestand.
    //
    // `package_versions` wird mit LIKE von der ECHTEN Tabelle abgeformt — mit ihren
    // Spalten, wie sie sind. Eine von Hand nachgebaute hatte beim ersten Lauf dieses
    // Wächters ein `published_at`, das sich bei jedem UPDATE selbst auf „jetzt"
    // stellte (MariaDB tut das mit der ersten TIMESTAMP-Spalte ohne Vorgabe): Die
    // Freigabe machte die Fassung zur „neuesten", und die Probe mass den Nachbau.
    // `gameservers` und `packages` sind dagegen bewusst schmal: Von ihnen liest die
    // Regel nur Kennung, Guild, Paket und Kanal.
    await c.query('CREATE TEMPORARY TABLE fb_pv_form LIKE package_versions');
    await c.query('CREATE TEMPORARY TABLE package_versions LIKE fb_pv_form');
    await c.query('DROP TEMPORARY TABLE fb_pv_form');
    await c.query("CREATE TEMPORARY TABLE gameservers (id INT PRIMARY KEY, guild_id VARCHAR(20), addon_marketplace_id INT, name VARCHAR(60) NULL, channel ENUM('stable','test') NOT NULL DEFAULT 'stable', updated_at TIMESTAMP NULL DEFAULT NULL)");
    await c.query('CREATE TEMPORARY TABLE packages (id INT PRIMARY KEY, slug VARCHAR(60))');
    const KONTROLL = '900', FREMD = '901';
    const altKontroll = process.env.CONTROL_GUILD_ID;
    process.env.CONTROL_GUILD_ID = KONTROLL;
    const doc = (slug, v) => JSON.stringify({ identity: { slug, version: v } });
    await c.query("INSERT INTO packages VALUES (1,'geprueft'),(2,'ungeprueft')");
    await c.query(`INSERT INTO package_versions (id, package_id, version, fbpkg, checksum, channel, published_at, test_passed_at) VALUES
        (11, 1, '1.0.0', ?, 'sha256:a', 'test', '2026-01-01 10:00:00', '2026-01-01 09:00:00'),
        (12, 1, '1.0.1', ?, 'sha256:b', 'test', '2026-01-02 10:00:00', '2026-01-02 09:00:00'),
        (13, 1, '1.0.2', ?, 'sha256:c', 'test', '2026-01-03 10:00:00', NULL),
        (21, 2, '2.0.0', ?, 'sha256:d', 'test', '2026-01-01 10:00:00', NULL)`,
        [doc('geprueft', '1.0.0'), doc('geprueft', '1.0.1'), doc('geprueft', '1.0.2'), doc('ungeprueft', '2.0.0')]);
    await c.query("INSERT INTO gameservers (id, guild_id, addon_marketplace_id, channel) VALUES (1, ?, 1, 'test'), (2, ?, 1, 'stable'), (3, ?, 2, 'test')",
        [KONTROLL, KONTROLL, KONTROLL]);
    const fassung = async (id) => (await P.ladePaketFuerServer(db, id))?.paket_version ?? null;

    await pruefe('test folgt der neuesten Fassung; stable ohne Freigabe bekommt KEINE (kein stiller Rückfall)', async () => {
        assert.strictEqual(await fassung(1), '1.0.2');
        assert.strictEqual(await fassung(2), null);
        assert.strictEqual(await fassung(3), '2.0.0');
    });

    await pruefe('freigegeben wird nur mit grünem Prüfdurchlauf, und nur was zum Paket gehört', async () => {
        await assert.rejects(P.freigeben(db, { paketId: 2, fassungId: 21, userId: '1' }), /keinen grünen Prüfdurchlauf/);
        await assert.rejects(P.freigeben(db, { paketId: 1, fassungId: 13, userId: '1' }), /keinen grünen Prüfdurchlauf/);
        await assert.rejects(P.freigeben(db, { paketId: 2, fassungId: 11, userId: '1' }), /gehört nicht zu diesem Paket/);
        await P.freigeben(db, { paketId: 1, fassungId: 11, userId: '544578232704565262' });
        await assert.rejects(P.freigeben(db, { paketId: 1, fassungId: 11, userId: '1' }), /schon freigegeben/);
        const [z] = await db.query('SELECT channel, released_at, released_by, published_at FROM package_versions WHERE id = 11');
        assert.strictEqual(z.channel, 'stable');
        assert.ok(z.released_at, 'der Zeitpunkt der Freigabe steht da');
        assert.strictEqual(z.released_by, '544578232704565262');
        assert.strictEqual(z.published_at, '2026-01-01 10:00:00', 'die Freigabe verschiebt den Veröffentlichungszeitpunkt nicht — an ihm hängt „die neueste"');
    });

    await pruefe('nach der Freigabe: stable bekommt die freigegebene, test weiter die neueste', async () => {
        assert.strictEqual(await fassung(2), '1.0.0');
        assert.strictEqual(await fassung(1), '1.0.2');
        const m = await P.ladePaketeZuServern(db, [{ id: 1 }, { id: 2 }, { id: 3 }]);
        assert.deepStrictEqual([m[1].identity.version, m[2].identity.version, m[3].identity.version], ['1.0.2', '1.0.0', '2.0.0'],
            'die Liste ordnet nach SERVER — zwei Server desselben Spiels, zwei Fassungen');
    });

    await pruefe('Anlegen: fremde Guild sieht nur Freigegebenes, die Guild des Betreibers auch Entwürfe', async () => {
        const fremd = await P.ladePaketeFuerAnlegen(db, FREMD), eigen = await P.ladePaketeFuerAnlegen(db, KONTROLL);
        assert.deepStrictEqual(fremd.map(z => `${z.slug} ${z.version} ${z.channel}`), ['geprueft 1.0.0 stable']);
        assert.deepStrictEqual(eigen.map(z => `${z.slug} ${z.version} ${z.channel}`), ['geprueft 1.0.0 stable', 'ungeprueft 2.0.0 test'],
            'auch der Betreiber legt mit der freigegebenen an, wenn es eine gibt');
        assert.strictEqual(await P.ladePaketFuerAnlegen(db, 2, FREMD), null);
        assert.strictEqual((await P.ladePaketFuerAnlegen(db, 2, KONTROLL)).kanal, 'test');
        assert.strictEqual((await P.ladePaketFuerAnlegen(db, 1, FREMD)).kanal, 'stable');
        assert.strictEqual((await P.ladePaketFuerAnlegen(db, 1, KONTROLL)).kanal, 'stable');
    });

    await pruefe('Kanal umstellen: test nur beim Betreiber, stable nur mit freigegebener Fassung, fremde Server gar nicht', async () => {
        await c.query("INSERT INTO gameservers (id, guild_id, addon_marketplace_id, channel) VALUES (4, ?, 1, 'stable')", [FREMD]);
        await assert.rejects(P.kanalSetzen(db, { serverId: 4, guildId: FREMD, kanal: 'test' }), /nur in der Guild des Betreibers/);
        await assert.rejects(P.kanalSetzen(db, { serverId: 4, guildId: KONTROLL, kanal: 'test' }), /nicht gefunden/);
        await assert.rejects(P.kanalSetzen(db, { serverId: 3, guildId: KONTROLL, kanal: 'stable' }), /noch keine Fassung freigegeben/);
        await assert.rejects(P.kanalSetzen(db, { serverId: 1, guildId: KONTROLL, kanal: 'nightly' }), /Kanal:/);
        assert.deepStrictEqual(await P.kanalSetzen(db, { serverId: 1, guildId: KONTROLL, kanal: 'stable' }), { kanal: 'stable', geaendert: true });
        assert.deepStrictEqual(await P.kanalSetzen(db, { serverId: 1, guildId: KONTROLL, kanal: 'stable' }), { kanal: 'stable', geaendert: false });
        assert.strictEqual(await fassung(1), '1.0.0');
        assert.deepStrictEqual(await P.serverJeKanal(db, 1), { stable: 3, test: 0 });
    });

    await pruefe('neuere Freigabe gewinnt; Rücknahme fällt zurück; die letzte Rücknahme lässt nichts übrig', async () => {
        await P.freigeben(db, { paketId: 1, fassungId: 12, userId: '1' });
        assert.strictEqual(await fassung(2), '1.0.1');
        let r = await P.zuruecknehmen(db, { paketId: 1, fassungId: 12 });
        assert.strictEqual(r.nochFreigegeben, 1);
        assert.strictEqual(await fassung(2), '1.0.0');
        r = await P.zuruecknehmen(db, { paketId: 1, fassungId: 11 });
        assert.strictEqual(r.nochFreigegeben, 0);
        assert.strictEqual(await fassung(2), null, 'stable ohne Freigabe: kein Paket');
        await assert.rejects(P.zuruecknehmen(db, { paketId: 1, fassungId: 11 }), /nicht freigegeben/);
        const [z] = await db.query('SELECT channel, released_at, released_by FROM package_versions WHERE id = 11');
        assert.deepStrictEqual([z.channel, z.released_at, z.released_by], ['test', null, null]);
    });

    await c.query('DROP TEMPORARY TABLE gameservers, packages, package_versions');
    if (altKontroll === undefined) delete process.env.CONTROL_GUILD_ID; else process.env.CONTROL_GUILD_ID = altKontroll;

    await pruefe('die echten Tabellen sind unberührt', async () => {
        assert.strictEqual(await zaehle(), vorher);
    });

    console.log('\nBestand');
    const [[b]] = await c.query(`SELECT (SELECT COUNT(*) FROM package_versions) fassungen,
        (SELECT COALESCE(SUM(channel='stable'),0) FROM package_versions) freigegeben`);
    console.log(`  · ${b.fassungen} Fassungen, ${b.freigegeben} freigegeben`);
    if (echterKanal.length) {
        await pruefe('kein Server folgt stable, ohne dass sein Spiel eine freigegebene Fassung hat', async () => {
            const [ohne] = await c.query(`
                SELECT gs.id, gs.name FROM gameservers gs
                 WHERE gs.channel = 'stable' AND gs.addon_marketplace_id IN (SELECT id FROM packages)
                   AND NOT EXISTS (SELECT 1 FROM package_versions v
                                    WHERE v.package_id = gs.addon_marketplace_id AND v.channel = 'stable')`);
            assert.deepStrictEqual(ohne.map(z => `#${z.id} ${z.name}`), [], 'diese Server lassen sich nicht starten');
        });
    } else {
        console.log('  · gameservers.channel fehlt noch — die Migration läuft mit dem nächsten Dashboard-Start');
    }
    await c.end();

    console.log(fehler === 0 ? '\n✅ Freigabe: Regel an einer Stelle, an der Datenbank belegt\n' : `\n❌ ${fehler} Abweichung(en)\n`);
    process.exit(fehler === 0 ? 0 : 1);
})().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
