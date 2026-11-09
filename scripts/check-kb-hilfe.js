#!/usr/bin/env node
/**
 * Hilfe im Dashboard (K290, 2026-11-09): Auf den Seiten eines Plugins zeigt
 * „Hilfe“ in der Kopfleiste auf seinen Artikel in der Wissensdatenbank.
 *
 * Die Zuordnung sitzt am Artikel (`kb_articles.plugin`, höchstens einer je
 * Plugin); das Feld am Bereich ist weg (Betreiber: ein Weg). Gemessen vorher:
 * zwölf Plugins haben einen Steckbrief im Bereich „Plugins“, die Kürzel
 * weichen zweimal vom Namen ab (music → musik, ticket → tickets).
 *
 *   Migration  an TEMPORARY-Kopien der echten Tabellen MIT Inhalt, in die
 *              Form vor der Migration gebracht: die zwölf Steckbriefe
 *              bekommen ihr Plugin, eine vorhandene Wahl bleibt
 *   Modell     Abfrage, Übernehmen beim Speichern (atomar), Entfernen,
 *              Prüfung des Namens, Startseite
 *   Wege       Plugin-Route, Kopfleiste, Verwaltung, Sprachdateien,
 *              keine toten `/documentation`-Verweise
 *
 * Schreibt nur in TEMPORARY-Tabellen, die mit der Verbindung verschwinden;
 * jede ALTER/UPDATE/INSERT/DELETE wird vorher auf TEMPORARY geprüft.
 *
 *   node scripts/check-kb-hilfe.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
require(path.join(WURZEL, 'node_modules/dotenv')).config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require(path.join(WURZEL, 'node_modules/mysql2/promise'));
const { ServiceManager } = require('dunebot-core');
const Wissen = require(path.join(WURZEL, 'apps/dashboard/helpers/Wissen'));
const migration = require(path.join(WURZEL, 'migrations/kern/20261109_100000_kb_hilfe_am_artikel.js'));
const spielMigration = require(path.join(WURZEL, 'migrations/kern/20261109_120000_kb_anleitung_spiel.js'));
const Spielhilfe = require(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/Spielhilfe'));

const lies = (p) => fs.readFileSync(path.join(WURZEL, p), 'utf8');
let fehler = 0;
async function pruefe(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); }
    catch (e) { fehler++; console.log(`  ✗ ${name}\n      ${String(e.message).split('\n').join('\n      ')}`); }
}

(async () => {
    const c = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT) || 3306,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE, dateStrings: true,
    });
    const roh = async (sql, p) => (await c.query(sql, p))[0];

    // ── Kopien mit Inhalt, in der Form VOR der Migration ────────────────────
    const KOPIEN = ['kb_categories', 'kb_articles'];
    for (const tab of KOPIEN) {
        await roh(`CREATE TEMPORARY TABLE fb_k LIKE \`${tab}\``);
        await roh(`INSERT INTO fb_k SELECT * FROM \`${tab}\``);
        await roh(`CREATE TEMPORARY TABLE \`${tab}\` LIKE fb_k`);
        await roh(`INSERT INTO \`${tab}\` SELECT * FROM fb_k`);
        await roh('DROP TEMPORARY TABLE fb_k');
    }
    const istKopie = async (tab) => /^CREATE TEMPORARY TABLE/.test((await roh(`SHOW CREATE TABLE \`${tab}\``))[0]['Create Table']);
    for (const tab of KOPIEN) assert.ok(await istKopie(tab), `${tab} ist keine Kopie — abgebrochen`);
    const spalten = async (tab) => (await roh(`SHOW COLUMNS FROM \`${tab}\``)).map(z => z.Field);
    // Vor dem Rollout gibt es die Spalte am Artikel noch nicht, danach schon —
    // die Kopie wird in beiden Fällen in die alte Form gebracht.
    if ((await spalten('kb_articles')).includes('spiel')) {
        await roh('ALTER TABLE kb_articles DROP INDEX IF EXISTS uq_kb_articles_spiel, DROP COLUMN spiel');
    }
    if ((await spalten('kb_articles')).includes('plugin')) {
        await roh('ALTER TABLE kb_articles DROP INDEX IF EXISTS uq_kb_articles_plugin, DROP COLUMN plugin');
    }
    await roh(`ALTER TABLE kb_categories ADD COLUMN IF NOT EXISTS plugin VARCHAR(60) NULL AFTER sort_order`);
    await roh(`UPDATE kb_categories SET plugin = 'gameserver' WHERE slug = 'gameserver'`);

    // Jede schreibende Anweisung trifft nachweislich eine Kopie.
    let stoere = null;
    const sicher = async (sql) => {
        const m = /^\s*(?:ALTER\s+TABLE|INSERT\s+(?:IGNORE\s+)?INTO|UPDATE|DELETE\s+FROM)\s+`?(\w+)`?/i.exec(sql);
        if (m) assert.ok(await istKopie(m[1]), `${m[1]} ist keine Kopie — abgebrochen, bevor etwas geschrieben wird`);
        assert.ok(!/^\s*(DROP|CREATE|TRUNCATE)\s+TABLE\b/i.test(sql) || /TEMPORARY/.test(sql), `DDL an echter Tabelle: ${sql.slice(0, 60)}`);
        if (stoere && stoere(sql)) throw new Error('vom Wächter gestört');
    };
    // Im Betrieb kommt `db().query` aus dem Pool — während einer Transaktion
    // ist das eine ANDERE Verbindung, ihr Rollback erfasst die Abfrage nicht.
    // Der Wächter hat nur eine Verbindung und sähe das nie; deshalb gilt eine
    // Abfrage am Rückruf vorbei, solange die Transaktion offen ist, als Fehler.
    let inTransaktion = false;
    const db = {
        query: async (sql, p) => {
            assert.ok(!inTransaktion, `Abfrage am Pool vorbei, während eine Transaktion offen ist: ${sql.trim().slice(0, 60)}`);
            await sicher(sql);
            return roh(sql, p);
        },
        transaction: async (rueckruf) => {
            await roh('START TRANSACTION');
            inTransaktion = true;
            try {
                const e = await rueckruf({ query: async (sql, p) => { await sicher(sql); return c.query(sql, p); } });
                inTransaktion = false;
                await roh('COMMIT');
                return e;
            } catch (e) {
                inTransaktion = false;
                await roh('ROLLBACK');
                throw e;
            }
        },
    };
    ServiceManager.register('dbService', db);
    const geloggt = [];
    ServiceManager.register('Logger', { error: (...a) => geloggt.push(a), warn() {}, info() {}, debug() {} });
    const pluginVon = async (bereich, kuerzel) => (await roh(
        `SELECT a.plugin FROM kb_articles a JOIN kb_categories c ON c.id = a.category_id WHERE c.slug = ? AND a.slug = ?`,
        [bereich, kuerzel]))[0]?.plugin ?? null;
    const PLUGINS = fs.readdirSync(path.join(WURZEL, 'plugins'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);

    console.log('\nMigration an Kopien der echten Artikel');

    await pruefe('jedes Plugin der Liste gibt es, jeder Steckbrief steht im Bereich „Plugins“', async () => {
        assert.deepStrictEqual(migration.STECKBRIEFE.map(([p]) => p).filter(p => !PLUGINS.includes(p)), []);
        const fehlt = [];
        for (const [, kuerzel] of migration.STECKBRIEFE) {
            if (!(await roh(`SELECT 1 FROM kb_articles a JOIN kb_categories c ON c.id = a.category_id WHERE c.slug = 'plugins' AND a.slug = ?`, [kuerzel])).length) fehlt.push(kuerzel);
        }
        assert.deepStrictEqual(fehlt, [], 'Steckbriefe fehlen — die Migration ließe diese Plugins ohne Hilfe');
    });

    // Eine Wahl, die vor der Migration schon da wäre, bleibt — nachgestellt an greeting.
    await roh(`ALTER TABLE kb_articles ADD COLUMN plugin VARCHAR(60) NULL AFTER sort_order`);
    const [fremd] = await roh(`SELECT a.id FROM kb_articles a JOIN kb_categories c ON c.id = a.category_id WHERE c.slug = 'dashboard' ORDER BY a.id LIMIT 1`);
    await roh('UPDATE kb_articles SET plugin = ? WHERE id = ?', ['greeting', fremd.id]);

    await pruefe('die Migration ordnet die Steckbriefe zu und nimmt dem Bereich das Feld — zweimal ohne Schaden', async () => {
        for (let lauf = 0; lauf < 2; lauf++) await migration.up(db);
        assert.ok(!(await spalten('kb_categories')).includes('plugin'), 'kb_categories.plugin ist noch da');
        const index = await roh(`SHOW INDEX FROM kb_articles WHERE Key_name = 'uq_kb_articles_plugin'`);
        assert.strictEqual(Number(index[0]?.Non_unique), 0, 'je Plugin höchstens ein Artikel — der Schlüssel fehlt');
        for (const [plugin, kuerzel] of migration.STECKBRIEFE) {
            assert.strictEqual(await pluginVon('plugins', kuerzel), plugin === 'greeting' ? null : plugin, kuerzel);
        }
        const [g] = await roh(`SELECT id FROM kb_articles WHERE plugin = 'greeting'`);
        assert.strictEqual(g.id, fremd.id, 'die Migration hat eine vorhandene Wahl überschrieben');
    });
    await pruefe('die Spiel-Migration ordnet jedem Spieleartikel sein Paket zu — über die Kennung, zweimal ohne Schaden', async () => {
        for (let lauf = 0; lauf < 2; lauf++) await spielMigration.up(db);
        const index = await roh(`SHOW INDEX FROM kb_articles WHERE Key_name = 'uq_kb_articles_spiel'`);
        assert.strictEqual(Number(index[0]?.Non_unique), 0, 'je Spiel höchstens ein Artikel — der Schlüssel fehlt');
        const fehlt = [];
        for (const [artikel, kuerzel] of spielMigration.ANLEITUNGEN) {
            const [paket] = await roh(`SELECT id FROM addon_marketplace WHERE slug IN (?) ORDER BY id LIMIT 1`, [kuerzel]);
            if (!paket) { fehlt.push('Paket ' + kuerzel.join('/')); continue; }
            const [a] = await roh(`SELECT a.spiel FROM kb_articles a JOIN kb_categories c ON c.id = a.category_id WHERE c.slug = 'spiele' AND a.slug = ?`, [artikel]);
            if (!a) { fehlt.push('Artikel ' + artikel); continue; }
            assert.strictEqual(Number(a.spiel), paket.id, artikel);
        }
        assert.deepStrictEqual(fehlt, [], 'die Liste der Migration trifft nicht mehr');
        const ohne = await roh(`SELECT am.slug FROM addon_marketplace am WHERE NOT EXISTS (SELECT 1 FROM kb_articles a WHERE a.spiel = am.id)`);
        if (ohne.length) console.log(`      (ohne Anleitung: ${ohne.map(z => z.slug).join(', ')})`);
    });

    await roh('UPDATE kb_articles SET plugin = NULL WHERE id = ?', [fremd.id]);
    await roh(`UPDATE kb_articles a JOIN kb_categories c ON c.id = a.category_id SET a.plugin = 'greeting' WHERE c.slug = 'plugins' AND a.slug = 'greeting'`);

    console.log('\nModell (helpers/Wissen.js)');

    await pruefe('Hilfe: der veröffentlichte Artikel des Plugins, deutsch und englisch; sonst nichts', async () => {
        const g = await Wissen.hilfeFuerPlugin('greeting', 'de-DE');
        assert.strictEqual(g.adresse, '/kb/plugins/greeting');
        assert.ok(g.titel && g.titel !== 'greeting', 'ohne Titel');
        assert.strictEqual((await Wissen.hilfeFuerPlugin('music', 'en-GB')).adresse, '/kb/plugins/musik');
        assert.strictEqual((await Wissen.hilfeFuerPlugin('ticket', 'de-DE')).adresse, '/kb/plugins/tickets');
        assert.strictEqual(await Wissen.hilfeFuerPlugin('werkbank', 'de-DE'), null, 'werkbank hat keinen Artikel');
        for (const boese of ['', null, '../x', "greeting' OR 1=1", 'A'.repeat(70)]) {
            assert.strictEqual(await Wissen.hilfeFuerPlugin(boese, 'de-DE'), null, String(boese));
        }
        await roh(`UPDATE kb_articles SET status = 'draft' WHERE plugin = 'automod'`);
        assert.strictEqual(await Wissen.hilfeFuerPlugin('automod', 'de-DE'), null, 'ein Entwurf ist keine Hilfe');
        await roh(`UPDATE kb_articles SET status = 'published' WHERE plugin = 'automod'`);
    });

    const [plugins] = await roh(`SELECT id FROM kb_categories WHERE slug = 'plugins'`);
    const neu = (slug, plugin, status = 'draft') => ({ category_id: plugins.id, slug, title_de: 'Prüfartikel ' + slug,
        content_de: 'Text', status, is_public: '0', sort_order: 999, plugin });

    await pruefe('ein neuer Entwurf übernimmt das Plugin vom alten Artikel und sagt es', async () => {
        const bericht = {};
        const id = await Wissen.artikelSpeichern(neu('greeting-neu', 'greeting'), 'Wächter', bericht, PLUGINS);
        assert.deepStrictEqual(bericht.hilfe, { plugin: 'greeting', von: '/kb/plugins/greeting', entwurf: true });
        assert.strictEqual(await pluginVon('plugins', 'greeting'), null);
        assert.strictEqual(await pluginVon('plugins', 'greeting-neu'), 'greeting');
        assert.strictEqual(await Wissen.hilfeFuerPlugin('greeting', 'de-DE'), null, 'solange Entwurf, keine Hilfe');
        // Zurück: der alte bekommt es beim Speichern wieder, ohne Adresswechsel.
        const alt = await Wissen.artikelRoh((await roh(`SELECT a.id FROM kb_articles a WHERE a.category_id = ? AND a.slug = 'greeting'`, [plugins.id]))[0].id);
        const zurueck = {};
        await Wissen.artikelSpeichern({ ...alt, id: alt.id, title_de: alt.title_translations['de-DE'], title_en: alt.title_translations['en-GB'],
            excerpt_de: alt.excerpt_translations['de-DE'], excerpt_en: alt.excerpt_translations['en-GB'],
            content_de: alt.content_translations['de-DE'], content_en: alt.content_translations['en-GB'],
            plugin: 'greeting' }, null, zurueck, PLUGINS);
        assert.deepStrictEqual(zurueck.hilfe, { plugin: 'greeting', von: '/kb/plugins/greeting-neu', entwurf: false });
        assert.strictEqual((await Wissen.hilfeFuerPlugin('greeting', 'de-DE')).adresse, '/kb/plugins/greeting');
        const weg = await Wissen.artikelEntfernen(id);
        assert.strictEqual(weg.plugin, null);
    });

    await pruefe('scheitert das Speichern nach dem Abgeben, behält der alte Artikel das Plugin', async () => {
        stoere = (sql) => /^\s*INSERT INTO kb_articles/.test(sql);
        await assert.rejects(Wissen.artikelSpeichern(neu('dunemap-neu', 'dunemap'), null, {}, PLUGINS), /vom Wächter gestört/);
        stoere = null;
        assert.strictEqual(await pluginVon('plugins', 'dunemap'), 'dunemap', 'die Zuordnung ist halb verloren');
    });

    await pruefe('Entfernen meldet, welches Plugin seine Hilfe verliert', async () => {
        const id = await Wissen.artikelSpeichern(neu('hilfe-werkbank', 'werkbank', 'published'), null, {}, PLUGINS);
        assert.strictEqual((await Wissen.hilfeFuerPlugin('werkbank', 'de-DE')).adresse, '/kb/plugins/hilfe-werkbank');
        assert.strictEqual((await Wissen.artikelEntfernen(id)).plugin, 'werkbank');
        assert.strictEqual(await Wissen.hilfeFuerPlugin('werkbank', 'de-DE'), null);
    });

    await pruefe('ein Plugin, das es nicht gibt, und die Startseite werden abgewiesen', async () => {
        await assert.rejects(Wissen.artikelSpeichern(neu('x-neu', 'gibtsnicht'), null, {}, PLUGINS), /Ein Plugin „gibtsnicht" gibt es nicht/);
        await assert.rejects(Wissen.artikelSpeichern(neu('x-neu', 'Greeting!'), null, {}, null), /gibt es nicht/);
        const [s] = await roh(`SELECT a.id, a.category_id FROM kb_articles a JOIN kb_categories c ON c.id = a.category_id WHERE c.slug = 'allgemein' AND a.slug = 'startseite'`);
        await assert.rejects(Wissen.artikelSpeichern({ id: s.id, category_id: s.category_id, slug: 'startseite', title_de: 'S', content_de: 'T',
            status: 'published', is_public: '1', plugin: 'core' }, null, {}, PLUGINS), /Startseite von \/kb ist keine Hilfe/);
    });

    const spielVon = async (slug) => Number((await roh(
        `SELECT a.spiel FROM kb_articles a JOIN kb_categories c ON c.id = a.category_id WHERE c.slug = 'spiele' AND a.slug = ?`, [slug]))[0]?.spiel) || null;
    const SPIELE = (await roh('SELECT id FROM addon_marketplace')).map(z => z.id);
    const satisfactory = await spielVon('satisfactory');

    await pruefe('Anleitung: der veröffentlichte Artikel zur Kennung des Spiels; sonst nichts', async () => {
        assert.ok(satisfactory, 'Satisfactory hat keine Kennung');
        assert.strictEqual((await Wissen.hilfeFuerSpiel(satisfactory, 'de-DE')).adresse, '/kb/spiele/satisfactory');
        assert.strictEqual((await Wissen.hilfeFuerSpiel(String(await spielVon('windrose')), 'en-GB')).adresse, '/kb/spiele/windrose');
        for (const boese of [null, '', 0, -1, 'abc', '1 OR 1=1', 1.5, 999999999]) {
            assert.strictEqual(await Wissen.hilfeFuerSpiel(boese, 'de-DE'), null, String(boese));
        }
    });

    await pruefe('ein Entwurf übernimmt die Anleitung eines Spiels und sagt es; ein unbekanntes Spiel wird abgewiesen', async () => {
        const [spiele] = await roh(`SELECT id FROM kb_categories WHERE slug = 'spiele'`);
        const bericht = {};
        const id = await Wissen.artikelSpeichern({ category_id: spiele.id, slug: 'satisfactory-neu', title_de: 'S neu', content_de: 'T',
            status: 'draft', is_public: '0', spiel: String(satisfactory) }, null, bericht, PLUGINS, SPIELE);
        assert.deepStrictEqual(bericht.anleitung, { spiel: satisfactory, von: '/kb/spiele/satisfactory', entwurf: true });
        assert.strictEqual(bericht.hilfe, undefined);
        assert.strictEqual(await spielVon('satisfactory'), null);
        assert.strictEqual(await Wissen.hilfeFuerSpiel(satisfactory, 'de-DE'), null, 'solange Entwurf, keine Anleitung');
        assert.strictEqual((await Wissen.artikelEntfernen(id)).spiel, satisfactory);
        await roh(`UPDATE kb_articles a JOIN kb_categories c ON c.id = a.category_id SET a.spiel = ? WHERE c.slug = 'spiele' AND a.slug = 'satisfactory'`, [satisfactory]);
        await assert.rejects(Wissen.artikelSpeichern({ category_id: spiele.id, slug: 'x-neu', title_de: 'X', content_de: 'T', spiel: '999999' }, null, {}, PLUGINS, SPIELE),
            /Ein Spiel mit der Kennung „999999" gibt es nicht/);
        await assert.rejects(Wissen.artikelSpeichern({ category_id: spiele.id, slug: 'x-neu', title_de: 'X', content_de: 'T', spiel: 'abc' }, null, {}, PLUGINS, null),
            /gibt es nicht/);
    });

    await pruefe('Serverseite: „Hilfe“ wird die Anleitung des Spiels — nur für eine Seite dieses Servers in dieser Guild', async () => {
        const [server] = await roh(
            `SELECT gs.id, gs.guild_id FROM gameservers gs WHERE gs.addon_marketplace_id = ? ORDER BY gs.id LIMIT 1`, [satisfactory]);
        const [anderer] = await roh(`SELECT gs.id, gs.guild_id, gs.addon_marketplace_id FROM gameservers gs
            WHERE NOT EXISTS (SELECT 1 FROM kb_articles a WHERE a.spiel = gs.addon_marketplace_id) ORDER BY gs.id LIMIT 1`);
        const steckbrief = { adresse: '/kb/plugins/gameserver', titel: 'Gameserver' };
        const lauf = async (id, guildId, { methode = 'GET', accept = 'text/html,application/xhtml+xml' } = {}) => {
            const res = { locals: { guildId, locale: 'de-DE', hilfe: steckbrief } };
            let weiter = 0;
            await Spielhilfe.fuerServer({ params: { serverId: String(id) }, method: methode, headers: { accept } }, res, () => weiter++);
            assert.strictEqual(weiter, 1, 'next() nicht genau einmal');
            return res.locals.hilfe;
        };
        if (server) {
            assert.strictEqual((await lauf(server.id, server.guild_id)).adresse, '/kb/spiele/satisfactory');
            assert.strictEqual(await lauf(server.id, '1'), steckbrief, 'fremde Guild bekam die Anleitung');
            assert.strictEqual(await lauf(server.id, server.guild_id, { accept: 'application/json' }), steckbrief);
            assert.strictEqual(await lauf(server.id, server.guild_id, { accept: 'text/event-stream' }), steckbrief);
            assert.strictEqual(await lauf(server.id, server.guild_id, { methode: 'POST' }), steckbrief);
        } else {
            console.log('      (kein Satisfactory-Server da — der Treffer wird nicht belegt)');
        }
        if (anderer) assert.strictEqual(await lauf(anderer.id, anderer.guild_id), steckbrief, 'ein Spiel ohne Anleitung verlor den Steckbrief');
        assert.strictEqual(await lauf('create', '1'), steckbrief);
        // Scheitert die Abfrage: ins Log, Steckbrief bleibt, die Seite geht weiter.
        stoere = (sql) => /FROM gameservers WHERE id = \?/.test(sql);
        const vorher = geloggt.length;
        assert.strictEqual(await lauf(server ? server.id : 1, server ? server.guild_id : '1'), steckbrief);
        stoere = null;
        assert.strictEqual(geloggt.length, vorher + 1, 'der Fehler steht nicht im Log');
    });

    await pruefe('ein Bereich speichert sich ohne das alte Feld', async () => {
        const [b] = await roh(`SELECT * FROM kb_categories WHERE slug = 'gameserver'`);
        await Wissen.bereichSpeichern({ id: b.id, slug: b.slug, title_de: 'Gameserver', sort_order: b.sort_order, icon: b.icon, plugin: 'gameserver' });
        assert.ok(!('plugin' in (await Wissen.bereichRoh(b.id))));
    });

    await c.end();

    console.log('\nWege');

    await pruefe('die Plugin-Route fragt nur bei Seitenaufrufen und hängt nicht an der Abfrage', () => {
        const r = ohneKommentare(lies('apps/dashboard/routes/guild.router.js'));
        assert.match(r, /if \(req\.method === 'GET' && String\(req\.headers\.accept \|\| ''\)\.includes\('text\/html'\)\) \{\s*try \{\s*res\.locals\.hilfe = await Wissen\.hilfeFuerPlugin\(plugin\.name, res\.locals\.locale\);\s*\} catch \(fehler\) \{\s*Logger\.error\(/);
        assert.ok(r.indexOf('res.locals.hilfe') < r.indexOf('plugin.guildRouter(req, res, next)'), 'erst die Hilfe, dann der Router des Plugins');
    });

    await pruefe('die Kopfleiste zeigt auf den Artikel oder auf /kb, escapt, in neuem Fenster', () => {
        const t = ohneKommentareEjs(lies('apps/dashboard/themes/default/partials/guild/topbar.ejs'));
        assert.match(t, /const _hilfe = locals\.hilfe \|\| null;/);
        assert.match(t, /href="<%= _hilfe \? _hilfe\.adresse : '\/kb' %>" target="_blank" rel="noopener"/);
        assert.match(t, /title="<%= _hilfe \? _hilfe\.titel : tr\('SIDEBAR\.HELP_KB'\) %>"/);
        assert.ok(!/<%-[^%]*_hilfe/.test(t), 'Hilfe unescapt ausgegeben');
        for (const datei of ['de-DE', 'en-GB']) {
            const s = JSON.parse(lies(`apps/dashboard/locales/${datei}.json`)).SIDEBAR;
            assert.ok(s.HELP && s.HELP_KB, `${datei}: SIDEBAR.HELP / HELP_KB fehlt`);
        }
    });

    await pruefe('die Verwaltung wählt am Artikel, prüft gegen die Plugins und kennt das Feld am Bereich nicht mehr', () => {
        const r = ohneKommentare(lies('apps/dashboard/routes/admin/kb.router.js'));
        assert.match(r, /artikelSpeichern\(req\.body \|\| \{\}, autor, bericht, pluginNamen\(\), spiele\.map\(s => Number\(s\.id\)\)\)/);
        assert.match(r, /availablePlugins/);
        assert.match(lies('apps/dashboard/themes/default/views/admin/kb/artikel.ejs'), /<select class="form-select" id="aPlugin" name="plugin">/);
        assert.ok(!/name="plugin"/.test(lies('apps/dashboard/themes/default/views/admin/kb/bereich.ejs')), 'das Feld am Bereich steht noch im Formular');
        assert.ok(!/\bplugin\b/.test(ohneKommentare(lies('apps/dashboard/helpers/Wissen.js')).split('function bereichSpeichern')[1].split('async function bereichEntfernen')[0]),
            'bereichSpeichern schreibt noch ein Plugin');
    });

    await pruefe('das Gameserver-Plugin hängt die Anleitung vor alle Router unter /servers', () => {
        const i = ohneKommentare(lies('plugins/gameserver/dashboard/index.js'));
        const an = i.indexOf("this.guildRouter.use('/servers/:serverId', require('./helpers/Spielhilfe').fuerServer);");
        assert.ok(an > 0, 'nicht eingehängt');
        for (const danach of ["this.guildRouter.use('/servers', serversRouter);", "this.guildRouter.use('/', filesRouter);"]) {
            assert.ok(an < i.indexOf(danach), `nach ${danach}`);
        }
        const a = lies('apps/dashboard/themes/default/views/admin/kb/artikel.ejs');
        assert.match(a, /<select class="form-select" id="aSpiel" name="spiel">/);
        assert.match(ohneKommentare(lies('apps/dashboard/routes/admin/kb.router.js')), /if \(fehler\?\.code === 'ER_NO_SUCH_TABLE'\) return \[\];\s*throw fehler;/);
    });

    await pruefe('kein Verweis mehr auf /documentation (seit /kb ein 404)', () => {
        const treffer = [];
        (function sammle(o) {
            for (const e of fs.readdirSync(path.join(WURZEL, o), { withFileTypes: true })) {
                const p = path.join(o, e.name);
                if (e.isDirectory()) { if (!['node_modules', 'vendor'].includes(e.name)) sammle(p); continue; }
                if (/\.(ejs|js)$/.test(e.name) && /["'`]\/documentation["'`/]/.test(lies(p))) treffer.push(p);
            }
        })('apps/dashboard/themes');
        assert.deepStrictEqual(treffer, []);
    });

    console.log(fehler ? `\n❌ Hilfe im Dashboard: ${fehler} Prüfung(en) rot` : '\n✅ Hilfe im Dashboard: alles grün');
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error('\n❌ Der Wächter selbst ist gescheitert:', e); process.exit(1); });
