#!/usr/bin/env node
/**
 * Die tote Kette „Plugin aktualisieren“ bleibt weg (K028, 2026-11-09).
 *
 * Gemessen vorher: `onUpdate` in core, gameserver und automod ohne Aufrufer
 * (core zusätzlich mit einer auskommentierten zweiten Fassung); die Route
 * `POST /guild/:id/plugins/:name/update` rief `pluginManager.updatePlugin`,
 * das es nicht gab; der Knopf „Jetzt aktualisieren“, Frist, Changelog und der
 * Hinweis „Plugin-Update(s) verfügbar“ hingen an `updateInfo` und
 * `pendingUpdates`, die niemand setzte (`pendingUpdates = []` fest im
 * Controller); das Widget `plugin-updates` war nur als Platz angemeldet;
 * `getPluginUpdateInfo` und `DBService.updatePluginVersion` ohne Aufrufer.
 * Die Tabelle `plugin_versions` (7 Zeilen von 2025) hat keinen Leser und
 * bleibt für den Tabellenschnitt.
 *
 * Der eine Weg: Beim Start zieht `enablePluginForGuild` die Fassung nach,
 * `onGuildEnable` schreibt Rechte und Navigation neu.
 *
 *   node scripts/check-plugin-update-kette.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), 'utf8');
const gibtEs = (p) => fs.existsSync(path.join(WURZEL, p));
let fehler = 0;
async function pruefe(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); }
    catch (e) { fehler++; console.log(`  ✗ ${name}\n      ${String(e.message).split('\n').join('\n      ')}`); }
}

/** Alle .js-Quellen unter einem Ordner, ohne Fremdes und Gebündeltes. */
function quellen(ordner, endung = '.js') {
    const aus = [];
    (function sammle(o) {
        for (const e of fs.readdirSync(path.join(WURZEL, o), { withFileTypes: true })) {
            if (['node_modules', 'vendor', 'public', 'dist', 'assets'].includes(e.name)) continue;
            const p = path.join(o, e.name);
            if (e.isDirectory()) sammle(p);
            else if (e.name.endsWith(endung)) aus.push(p);
        }
    })(ordner);
    return aus;
}

(async () => {
    console.log('\nCode');

    await pruefe('kein Plugin definiert oder ruft `onUpdate`', () => {
        const treffer = [];
        for (const o of ['plugins', 'apps', 'packages']) {
            for (const p of quellen(o)) if (/\bonUpdate\s*\(/.test(ohneKommentare(lies(p)))) treffer.push(p);
        }
        assert.deepStrictEqual(treffer, []);
    });

    await pruefe('Route, Controller und Helfer des Aktualisierens sind weg', () => {
        assert.ok(!/plugins\/:pluginName\/update/.test(ohneKommentare(lies('apps/dashboard/routes/guild.router.js'))), 'Route steht noch');
        assert.ok(!/updatePluginVersion/.test(ohneKommentare(lies('apps/dashboard/controllers/guild.controller.js'))), 'Controller steht noch');
        assert.ok(!/updatePluginVersion/.test(ohneKommentare(lies('packages/dunebot-db-client/lib/DBService.js'))), 'DBService.updatePluginVersion steht noch');
        assert.ok(!/getPluginUpdateInfo/.test(ohneKommentare(lies('apps/dashboard/helpers/PluginManager.js'))), 'getPluginUpdateInfo steht noch');
        const aufrufe = quellen('apps').filter(p => /\.updatePlugin\s*\(/.test(ohneKommentare(lies(p))));
        assert.deepStrictEqual(aufrufe, [], 'jemand ruft updatePlugin — das es nicht gibt');
    });

    await pruefe('das Widget plugin-updates ist weder angemeldet noch vorhanden', () => {
        assert.ok(!/plugin-updates/.test(ohneKommentare(lies('apps/dashboard/helpers/KernWidgets.js'))));
        assert.ok(!gibtEs('plugins/core/dashboard/views/widgets/plugin-updates.ejs'));
    });

    console.log('\nPlugin-Seite');

    const ANSICHT = 'apps/dashboard/themes/default/views/guild/plugins.ejs';

    await pruefe('die Vorlage kennt updateInfo, pendingUpdates und den Knopf nicht mehr', () => {
        const v = ohneKommentareEjs(lies(ANSICHT));
        for (const w of ['updateInfo', 'pendingUpdates', 'btn-update-plugin', '/update`', 'function meldung']) {
            assert.ok(!v.includes(w), `${w} steht noch in der Vorlage`);
        }
        assert.ok(!/pendingUpdates/.test(ohneKommentare(lies('apps/dashboard/controllers/guild.controller.js'))), 'der Controller reicht pendingUpdates noch durch');
    });

    await pruefe('die Seite zeichnet sich mit dem, was der Controller liefert', async () => {
        const ejs = require(path.join(WURZEL, 'node_modules/ejs'));
        const tr = (k) => k;
        const p = { name: 'greeting', displayName: 'Greeting', version: '1.2.3', author: 'FireDervil', description: 'x', icon: '', stempel: 'Eingeschaltet am 09.11.2026 von FireDervil' };
        const html = await ejs.renderFile(path.join(WURZEL, ANSICHT), {
            tr, guildId: '1', guild: { name: 'Prüf' }, istKontrollGuild: false,
            enabledPlugins: [p], availablePlugins: [], success: [], error: [],
        }, { async: true });
        assert.ok(html.includes('Greeting') && html.includes('v1.2.3'), 'Plugin fehlt in der Ausgabe');
        assert.ok(!/Jetzt aktualisieren|Update verfügbar|Plugin-Update/.test(html), 'Update-Reste in der Ausgabe');
        assert.ok(html.includes('Eingeschaltet am'), 'der Stempel (K158) fehlt');
    });

    console.log('\nTabelle plugin_versions (K358)');

    await pruefe('kein Code nennt die Tabelle mehr', () => {
        const treffer = [];
        for (const o of ['apps', 'packages', 'plugins']) {
            for (const p of quellen(o)) if (/plugin_versions/.test(ohneKommentare(lies(p)))) treffer.push(p);
        }
        assert.deepStrictEqual(treffer, []);
    });

    await pruefe('die Migration reißt sie ab — an einer TEMPORARY-Kopie, die echte bleibt unberührt', async () => {
        require(path.join(WURZEL, 'node_modules/dotenv')).config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
        const mysql = require(path.join(WURZEL, 'node_modules/mysql2/promise'));
        const verbinde = () => mysql.createConnection({
            host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT) || 3306,
            user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
        });
        const c = await verbinde(), aussen = await verbinde();
        try {
            const zahl = async (k) => {
                const [t] = await k.query(`SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
                    AND TABLE_NAME = 'plugin_versions' AND TABLE_TYPE = 'BASE TABLE'`);
                return t.length ? Number((await k.query('SELECT COUNT(*) AS n FROM plugin_versions'))[0][0].n) : null;
            };
            const vorher = await zahl(aussen);
            if (vorher !== null) {
                await c.query('CREATE TEMPORARY TABLE fb_k LIKE plugin_versions');
                await c.query('INSERT INTO fb_k SELECT * FROM plugin_versions');
                await c.query('CREATE TEMPORARY TABLE plugin_versions LIKE fb_k');
                await c.query('INSERT INTO plugin_versions SELECT * FROM fb_k');
                await c.query('DROP TEMPORARY TABLE fb_k');
            } else {
                // Nach dem Rollout gibt es die echte nicht mehr: eine leere Kopie genügt.
                await c.query('CREATE TEMPORARY TABLE plugin_versions (id INT)');
            }
            let gedroppt = 0;
            const db = {
                query: async (sql, p) => {
                    const m = /^\s*DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?`?(\w+)`?/i.exec(sql);
                    if (m) {
                        const [[k]] = await c.query(`SHOW CREATE TABLE \`${m[1]}\``);
                        assert.match(k['Create Table'], /^CREATE TEMPORARY TABLE/, `DROP träfe die echte Tabelle ${m[1]}`);
                        gedroppt++;
                    } else {
                        assert.ok(!/^\s*(DROP|ALTER|CREATE|TRUNCATE)\b/i.test(sql), `unerwartetes DDL: ${sql.slice(0, 60)}`);
                    }
                    return (await c.query(sql, p))[0];
                },
            };
            const migration = require(path.join(WURZEL, 'migrations/kern/20261109_140000_plugin_versions_entfernen.js'));
            await migration.up(db);
            assert.strictEqual(gedroppt, 1, 'die Migration hat nichts abgerissen');
            assert.strictEqual(await zahl(aussen), vorher, 'die echte Tabelle wurde angefasst');
        } finally {
            await c.end(); await aussen.end();
        }
    });

    console.log(fehler ? `\n❌ Update-Kette: ${fehler} Prüfung(en) rot` : '\n✅ Update-Kette: alles grün');
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error('\n❌ Der Wächter selbst ist gescheitert:', e); process.exit(1); });
