#!/usr/bin/env node
/**
 * Ein Modpack einspielen ist ein Vorgang, den man sieht (2026-11-02, B218).
 *
 * Betreiber: „das wenn ich ein anderes modpack wähle dann bekomme ich zwar die
 * toasts angezeigt ... aber letztenendes bleibt die mod seite wie im bild zu sehen
 * stehen", und nach „Neu installieren": „ich sehe leider nicht ob das modpack frisch
 * installiert wurde".
 *
 * Geprüft wird die Rechnung am echten Code, das SQL an einer TEMPORARY-Kopie von
 * `gameservers`. Geschrieben wird am Bestand nichts.
 *
 *   node scripts/check-modpack-vorgang.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { ohneKommentare } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const { ServiceManager } = require('dunebot-core');
ServiceManager.register('Logger', { warn() {}, info() {}, error() {}, debug() {} });
const gesendet = [];
ServiceManager.register('sseManager', { broadcast: (g, ns, d) => gesendet.push({ g, ns, ...d }) });

const Modpackstand = require('../plugins/gameserver/dashboard/helpers/Modpackstand');
const { baueZustand, baueMesswerte } = require('../plugins/gameserver/dashboard/helpers/Serverseite');
global.window = undefined;
const { knopfZustand } = require('../plugins/gameserver/dashboard/assets/js/gameserver-live.js');
const migration = require('../plugins/gameserver/migrations/20261102_110000_modpack_vorgang');
const lies = (d) => ohneKommentare(fs.readFileSync(path.join(WURZEL, d), 'utf8'));

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').join('\n      ')}`); }
}

(async () => {
    const jetzt = new Date();
    const laeuft = { modpack_seit: jetzt, modpack_name: 'Parasites' };

    console.log('Anzeige');
    await pruefe('der Stand gilt bis zur Frist, danach sperrt nichts mehr', () => {
        assert.strictEqual(Modpackstand.stand(laeuft).laeuft, true);
        assert.strictEqual(Modpackstand.stand({ modpack_seit: null }).laeuft, false);
        const alt = new Date(Date.now() - Modpackstand.FRIST_MS - 1000);
        assert.strictEqual(Modpackstand.stand({ modpack_seit: alt }).laeuft, false);
    });
    await pruefe('die Serverseite zeigt den Vorgang, auch bei einem ausgeschalteten Server', () => {
        assert.strictEqual(baueZustand({ status: 'offline', ...laeuft }).text, 'Modpack wird eingespielt');
        assert.match(baueMesswerte({ status: 'offline', ...laeuft }).grund, /Parasites.*wird eingespielt/);
    });
    await pruefe('Ausfall und Löschen wiegen schwerer als das Modpack', () => {
        assert.strictEqual(baueZustand({ status: 'online', verbindung: 'maschine_weg', ...laeuft }).schluessel, 'verbindung');
    });
    await pruefe('Starten und Neustarten sind gesperrt, mit Grund, Stoppen bleibt', () => {
        const aus = knopfZustand({ status: 'offline', modpack: true });
        assert.deepStrictEqual([aus.start.aktiv, aus.start.grund], [false, 'Das Modpack wird gerade eingespielt.']);
        const an = knopfZustand({ status: 'online', bereit: true, modpack: true });
        assert.deepStrictEqual([an.restart.aktiv, an.stop.aktiv], [false, true]);
        assert.ok(an.restart.grund);
        assert.strictEqual(knopfZustand({ status: 'offline' }).start.aktiv, true);
    });

    console.log('\nSperre');
    await pruefe('Start, Neustart und Neuinstallation fragen die Sperre, Stoppen nicht', () => {
        const t = lies('plugins/gameserver/dashboard/routes/servers.js');
        for (const r of ['start', 'restart', 'reinstall']) {
            assert.match(t, new RegExp(`router\\.post\\('/:serverId/${r}', require\\('\\.\\./helpers/Modpackstand'\\)\\.sperre`), r);
        }
        assert.ok(!/router\.post\('\/:serverId\/stop', require\('\.\.\/helpers\/Modpackstand'\)/.test(t));
    });
    await pruefe('die Sperre gibt 409, Lesen geht durch', async () => {
        const antworten = [];
        const res = { status(c) { antworten.push(c); return this; }, json() { return this; } };
        ServiceManager.register('dbService', { query: async () => [laeuft] });
        await Modpackstand.sperre({ method: 'POST', params: { serverId: 1 } }, res, () => antworten.push('weiter'));
        await Modpackstand.sperre({ method: 'GET', params: { serverId: 1 } }, res, () => antworten.push('weiter'));
        assert.deepStrictEqual(antworten, [409, 'weiter']);
    });
    await pruefe('der Vorgang endet auch, wenn die Installation wirft', () => {
        const t = lies('plugins/gameserver/dashboard/routes/inhalte.js');
        assert.match(t, /await Modpackstand\.beginne\([\s\S]{0,400}try \{[\s\S]{0,300}installiereModpack[\s\S]{0,200}\} finally \{\s*await Modpackstand\.beende/);
    });

    console.log('\nMods-Seite');
    const seite = fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/views/guild/partials/server-detail-inhalte.ejs'), 'utf8');
    await pruefe('die Karte nennt, wann das Paket installiert wurde', () => {
        assert.match(seite, /Zuletzt installiert: \$\{escape\(modpackZeit\(m\.updated_at\)\)\}/);
    });
    await pruefe('die Knöpfe sind gesperrt, solange es läuft, und jeder Tab erfährt das Ende', () => {
        assert.strictEqual((seite.match(/\$\{v\.laeuft \? 'disabled' : ''\}/g) || []).length, 2);
        assert.match(seite, /DOMContentLoaded'[\s\S]{0,260}\.on\('modpack', \(\) => window\.inhalteLaden\(\)\)/);
    });
    await pruefe('Ersetzen fragt im roten Dialog, mit dem Namen zum Eintippen', () => {
        assert.ok(!/window\.confirm\(dasselbe/.test(seite), 'confirm bei etwas Endgültigem');
        assert.match(seite, /Das lässt sich nicht zurücknehmen\./);
        assert.match(seite, /id="modpackErsetzenKnopf" disabled/);
        assert.match(seite, /if \(!altes\) \{ modpackEinspielen\(kennung, fassung, knopf\); return; \}/);
    });

    console.log('\nSQL, an einer Kopie');
    const roh = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT, user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
    });
    const db = { query: async (sql, p) => { const [r] = await roh.query(sql, p); return r; } };
    try {
        await db.query('CREATE TEMPORARY TABLE kopie_gs AS SELECT * FROM gameservers');
        await db.query('CREATE TEMPORARY TABLE gameservers AS SELECT * FROM kopie_gs');
        await migration.up(db);
        ServiceManager.register('dbService', db);
        const [z] = await db.query('SELECT id, guild_id FROM gameservers ORDER BY id LIMIT 1');
        const lesen = async () => (await db.query(
            `SELECT ${Modpackstand.SPALTEN} FROM gameservers gs WHERE gs.id = ?`, [z.id]))[0];

        await pruefe('von zwei Klicks gewinnt einer, und alle Tabs erfahren es', async () => {
            gesendet.length = 0;
            const [a, b] = await Promise.all([Modpackstand.beginne(z.id, z.guild_id, 'P'), Modpackstand.beginne(z.id, z.guild_id, 'P')]);
            assert.deepStrictEqual([a, b].sort(), [false, true]);
            assert.deepStrictEqual(gesendet.map(x => [x.ns, x.action, x.stand]), [['gameserver', 'modpack', 'laeuft']]);
            assert.strictEqual(Modpackstand.stand(await lesen()).laeuft, true);
        });
        await pruefe('fertig räumt den Stand', async () => {
            gesendet.length = 0;
            await Modpackstand.beende(z.id, z.guild_id, 'P');
            assert.strictEqual(Modpackstand.stand(await lesen()).laeuft, false);
            assert.strictEqual(gesendet[0].stand, 'fertig');
            assert.strictEqual(await Modpackstand.beginne(z.id, z.guild_id, 'Q'), true);
        });
        await pruefe('ein abgelaufener Vorgang lässt sich neu beginnen', async () => {
            await db.query("UPDATE gameservers SET modpack_seit = NOW() - INTERVAL 40 MINUTE WHERE id = ?", [z.id]);
            assert.strictEqual(await Modpackstand.beginne(z.id, z.guild_id, 'R'), true);
        });
        await pruefe('ein Neustart räumt liegengebliebene Vorgänge', async () => {
            await Modpackstand.nachNeustart(db);
            assert.strictEqual(Modpackstand.stand(await lesen()).laeuft, false);
        });
    } finally {
        await roh.end();
    }

    console.log(fehler ? `\n❌ ${fehler} Prüfung(en) rot` : '\n✅ Der Vorgang ist zu sehen');
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
