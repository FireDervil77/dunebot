#!/usr/bin/env node
/**
 * Wer ein Plugin wann ein- oder abschaltete — gestempelt nur beim Wechsel
 * (K158, 2026-11-08).
 *
 * Gemessen vorher: alle 59 eingeschalteten Zeilen in guild_plugins mit dem
 * letzten Start als `enabled_at` und ohne `enabled_by`, alle 3 abgeschalteten
 * ohne `disabled_by`. Dashboard und Bot schalten bei jedem Start alles noch
 * einmal ein, und beim Abschalten folgt der Bot dem Dashboard ohne Benutzer.
 *
 *   SQL     die echte SQL aus DBService an einer TEMPORARY-Kopie von
 *           guild_plugins, gegen die echte MariaDB (Zuweisungsreihenfolge!)
 *   Wege    Discord `/plugin status` reicht den Benutzer bis zum Stempel
 *
 * Schreibt nur in eine TEMPORARY-Tabelle, die mit der Verbindung verschwindet.
 *
 *   node scripts/check-plugin-stempel.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { ohneKommentare } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const DBService = require(path.join(WURZEL, 'packages/dunebot-db-client/lib/DBService'));

let fehler = 0;
async function pruefe(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); }
    catch (e) { fehler++; console.log(`  ✗ ${name}\n      ${String(e.message).split('\n').join('\n      ')}`); }
}
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    console.log('\nSQL an einer TEMPORARY-Kopie');
    require(path.join(WURZEL, 'node_modules/dotenv')).config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
    const mysql = require(path.join(WURZEL, 'node_modules/mysql2/promise'));
    const db = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT) || 3306,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE, connectTimeout: 4000,
    });
    try {
        await db.query('CREATE TEMPORARY TABLE gp_probe LIKE guild_plugins');
        // Die echte SQL, nur auf die Kopie umgelenkt.
        const umgelenkt = {
            query: async (sql, w) => {
                assert.ok(/guild_plugins/.test(sql), 'SQL ohne guild_plugins');
                return (await db.query(sql.replace(/guild_plugins/g, 'gp_probe'), w))[0];
            },
        };
        const ein = (version, wer) => DBService.prototype.enablePluginForGuild.call(umgelenkt, 'G1', 'musik', version, wer);
        const aus = (wer) => DBService.prototype.disablePluginForGuild.call(umgelenkt, 'G1', 'musik', wer);
        const zeile = async () => (await db.query("SELECT * FROM gp_probe WHERE guild_id = 'G1' AND plugin_name = 'musik'"))[0][0];
        const ms = (d) => (d ? new Date(d).getTime() : null);

        let erstes;
        await pruefe('erstes Einschalten stempelt Zeit und Benutzer', async () => {
            await ein('1.0', 'U1');
            erstes = await zeile();
            assert.strictEqual(erstes.is_enabled, 1);
            assert.strictEqual(erstes.enabled_by, 'U1');
            assert.ok(erstes.enabled_at);
        });
        await warte(1100);
        await pruefe('Start (nochmal ein, ohne Benutzer): Zeit und Benutzer bleiben, die Fassung zieht nach', async () => {
            await ein('1.1', null);
            const z = await zeile();
            assert.strictEqual(z.enabled_by, 'U1');
            assert.strictEqual(ms(z.enabled_at), ms(erstes.enabled_at));
            assert.strictEqual(z.plugin_version, '1.1');
        });
        let abgeschaltet;
        await pruefe('Abschalten stempelt, wer es war', async () => {
            await aus('U2');
            abgeschaltet = await zeile();
            assert.strictEqual(abgeschaltet.is_enabled, 0);
            assert.strictEqual(abgeschaltet.disabled_by, 'U2');
            assert.ok(abgeschaltet.disabled_at);
        });
        await warte(1100);
        await pruefe('der Bot folgt (nochmal aus, ohne Benutzer): Zeit und Benutzer bleiben', async () => {
            await aus(null);
            const z = await zeile();
            assert.strictEqual(z.disabled_by, 'U2');
            assert.strictEqual(ms(z.disabled_at), ms(abgeschaltet.disabled_at));
        });
        await pruefe('wieder einschalten: neuer Stempel, das Abschalten ist vergessen', async () => {
            await ein('1.1', 'U3');
            const z = await zeile();
            assert.strictEqual(z.is_enabled, 1);
            assert.strictEqual(z.enabled_by, 'U3');
            assert.ok(ms(z.enabled_at) > ms(erstes.enabled_at));
            assert.strictEqual(z.disabled_at, null);
            assert.strictEqual(z.disabled_by, null);
        });
    } finally {
        await db.end();
    }

    console.log('\nWege');
    const lies = (d) => ohneKommentare(fs.readFileSync(path.join(WURZEL, d), 'utf8'));
    await pruefe('Discord `/plugin status` schickt den Benutzer mit', () => {
        assert.match(lies('apps/bot/commands/plugin.js'),
            /sendToDashboard\("core:UPDATE_PLUGIN_STATUS",\s*\{ guildId: guild\.id, enabled: einschalten, disabled: abschalten, userId: waiter\.user\.id \}/);
    });
    await pruefe('das Dashboard reicht ihn an Ein- und Abschalten weiter, nur als Discord-ID', () => {
        const q = lies('apps/dashboard/helpers/IPCServer.js');
        assert.match(q, /const wer = \/\^\\d\{17,20\}\$\/\.test\(String\(payload\.userId \|\| ''\)\) \? \{ userId: String\(payload\.userId\) \} : null;/);
        assert.match(q, /pluginManager\.enableInGuild\(pluginName, guildId, wer\)/);
        assert.match(q, /pluginManager\.disableInGuild\(pluginName, guildId, wer\)/);
    });
    await pruefe('PluginManager nimmt den Benutzer aus der Sitzung oder aus { userId }', () => {
        const q = lies('apps/dashboard/helpers/PluginManager.js');
        assert.strictEqual((q.match(/const userId = req\?\.session\?\.user\?\.info\?\.id \|\| req\?\.userId \|\| null;/g) || []).length, 2);
    });

    console.log(`\nErgebnis: ${fehler ? fehler + ' Abweichung(en)' : 'alles grün'}`);
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
