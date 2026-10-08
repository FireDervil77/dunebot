#!/usr/bin/env node
/**
 * Prüft die Tag-Bibliothek (2026-10-07).
 *
 * Bis dahin trug das Spiel ein Kommafeld (`addon_marketplace.tags`): Der
 * Adminbereich schrieb es als JSON, die Spielseite der Guild zerlegte es am
 * Komma und zeigte `["SCI-FI"` samt Klammer. Jetzt hält `tags` jedes Tag
 * einmal und `tag_links` sagt, woran es hängt.
 *
 *   1. Quelltext: Niemand liest oder schreibt das alte Feld mehr.
 *   2. Datenbank: Migration und Helfer an TEMPORÄREN Tabellen. Die Migration
 *      wird dafür mit einer Verbindung gefahren, die `CREATE TABLE` in
 *      `CREATE TEMPORARY TABLE` umschreibt — sie legt also nichts Echtes an,
 *      und am Ende wird nachgezählt.
 *
 *   node scripts/check-tags.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const Tags = require('../apps/dashboard/helpers/Tags');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n')[0]}`); }
}
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), 'utf8');

(async () => {
    console.log('\nEingabe: was ein Tag sein darf');
    await pruefe('getrimmt, ohne Doppelte (Gross/Klein egal), Liste oder Kommatext', async () => {
        assert.deepStrictEqual(Tags.bereinige([' CO-OP ', 'co-op', 'Sci  Fi', '']).map(t => t.name), ['CO-OP', 'Sci Fi']);
        assert.deepStrictEqual(Tags.bereinige('Survival, Koop ,survival').map(t => t.slug), ['survival', 'koop']);
        assert.deepStrictEqual(Tags.bereinige(undefined), []);
        assert.deepStrictEqual(Tags.bereinige([]), []);
    });
    await pruefe('zu lang, verbotene Zeichen, zu viele: mit Grund abgewiesen', async () => {
        assert.throws(() => Tags.bereinige(['x'.repeat(41)]), /höchstens 40/);
        assert.throws(() => Tags.bereinige(['<b>fett</b>']), /nicht geht/);
        assert.throws(() => Tags.bereinige(['a"b']), /nicht geht/);
        assert.throws(() => Tags.bereinige([42]), /ist Text/);
        assert.throws(() => Tags.bereinige(Array.from({ length: 13 }, (_, i) => 't' + i)), /Höchstens 12/);
        assert.throws(() => Tags.sucheSql('spiel', 'a.id; DROP TABLE x'), /ungültige Spalte/);
    });

    console.log('\nQuelltext: das Kommafeld liest und schreibt niemand mehr');
    await pruefe('Adminbereich: speichert über die Bibliothek, nicht in addon_marketplace.tags', async () => {
        const r = ohneKommentare(lies('apps/dashboard/routes/admin/addons.router.js'));
        assert.ok(!/SET[^`]*\btags\s*=\s*\?/.test(r), 'das UPDATE setzt die alte Spalte noch');
        assert.match(r, /Tags\.setze\(dbService, 'spiel', id, tags\)/);
        assert.match(r, /Tags\.fuer\(dbService, 'spiel', addon\.id\)/);
    });
    await pruefe('Guild: Liste, Suche und Detail fragen die Bibliothek', async () => {
        const r = ohneKommentare(lies('plugins/gameserver/dashboard/routes/addons.js'));
        assert.ok(!/category,\s*tags,/.test(r), 'die alte Spalte steht noch in einer Abfrage');
        assert.ok(!/tags LIKE \?/.test(r), 'die Suche geht noch über den rohen Text');
        assert.match(r, /Tags\.sucheSql\('spiel', 'addon_marketplace\.id'\)/);
        assert.match(r, /Tags\.fuerViele\(dbService, 'spiel'/);
    });
    await pruefe('Ansichten: Tags sind eine Liste — nirgends mehr am Komma zerlegt oder als JSON geparst', async () => {
        for (const v of ['plugins/gameserver/dashboard/views/guild/gameserver-addon-detail.ejs',
                         'apps/dashboard/themes/default/views/admin/addons/edit.ejs']) {
            const t = ohneKommentareEjs(lies(v));
            assert.ok(!/addon\.tags\.split\(/.test(t), `${v} zerlegt die Tags am Komma`);
            assert.ok(!/JSON\.parse\(addon\.tags\)/.test(t), `${v} liest die Tags als JSON`);
        }
        const admin = ohneKommentareEjs(lies('apps/dashboard/themes/default/views/admin/addons/edit.ejs'));
        assert.ok(!/comma-separated/.test(admin));
        // Das Feld ist seit dem 2026-10-08 EIN Baustein für Adminbereich und Werkbank.
        const feld = ohneKommentareEjs(lies('apps/dashboard/themes/default/views/shared/tagfeld.ejs'));
        assert.match(feld, /<datalist id="<%= _tfId %>Vorschlaege">/, 'die Vorschläge aus der Bibliothek fehlen');
        assert.match(admin, /include\('\.\.\/\.\.\/shared\/tagfeld'/, 'der Adminbereich benutzt den gemeinsamen Baustein nicht');
        const werkbank = ohneKommentareEjs(lies('plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs'));
        assert.match(werkbank, /include\('shared\/tagfeld'/, 'die Werkbank benutzt den gemeinsamen Baustein nicht');
        for (const [name, text] of [['Adminbereich', admin], ['Werkbank', werkbank]]) {
            assert.ok(!/weg\.className = 'btn-close'/.test(text), `${name}: eine eigene Kopie des Tag-Felds steht noch da`);
            assert.match(text, /window\.tagfeld\('/, `${name}: liest das Tag-Feld nicht`);
        }
    });

    // ── Tags statt Kategorie (2026-10-08) ───────────────────────────────────
    //
    // Die Kategorie eines Spiels — neun feste Werte, genau einer je Spiel — ist
    // von allen Oberflächen verschwunden; gefiltert und gezeigt wird nach Tags.
    // Die Spalte bleibt bis zum Tabellenschnitt, das Paket behält sein Feld.
    console.log('\nTags statt Kategorie');
    await pruefe('keine Oberfläche zeigt oder filtert mehr nach der Kategorie', async () => {
        for (const v of ['apps/dashboard/themes/default/partials/frontend/sections/addons.ejs',
                         'plugins/gameserver/dashboard/views/guild/gameserver-marketplace.ejs',
                         'plugins/gameserver/dashboard/views/guild/gameserver-addon-detail.ejs',
                         'plugins/gameserver/dashboard/views/guild/server-create-step1.ejs']) {
            const t = ohneKommentareEjs(lies(v));
            assert.ok(!/\bcategory\b|kategorie/i.test(t), `${v} nennt die Kategorie noch`);
            assert.ok(/\btags?\b/i.test(t), `${v} zeigt keine Tags`);
        }
        const werkbank = ohneKommentareEjs(lies('plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs'));
        assert.ok(!/name="kategorie"/.test(werkbank), 'die Werkbank fragt noch nach der Kategorie');
    });
    await pruefe('Liste und Startseite holen Tags aus der Bibliothek und filtern darüber', async () => {
        const r = ohneKommentare(lies('plugins/gameserver/dashboard/routes/addons.js'));
        assert.ok(!/\bcategory\b/.test(r), 'die Route der Spiele-Datenbank liest die Kategorie noch');
        assert.match(r, /Tags\.hatTagSql\('spiel', 'addon_marketplace\.id'\)/);
        assert.match(r, /Tags\.benutzte\(dbService, 'spiel'/);
        assert.match(r, /Tags\.verwandte\(dbService, 'spiel'/);
        const f = ohneKommentare(lies('apps/dashboard/controllers/frontend.controller.js'));
        const abfrage = f.slice(f.indexOf('FROM addon_marketplace') - 400, f.indexOf('FROM addon_marketplace'));
        assert.ok(!/\bcategory\b|rating_count, tags/.test(abfrage), 'die Startseite liest noch Kategorie oder die alte Tag-Spalte');
        assert.match(f, /Tags\.fuerViele\(dbService, 'spiel'/);
        const s = ohneKommentare(lies('plugins/gameserver/dashboard/routes/servers.js'));
        assert.match(s, /bauePaketAuswahl\(paketZeilen, [^;]+, tagsJeSpiel\)/, 'der Anlege-Assistent bekommt keine Tags');
    });
    await pruefe('die Werkbank reicht Tags an das Spiel weiter — nicht ins Paket', async () => {
        const w = ohneKommentare(lies('plugins/werkbank/dashboard/helpers/Sitzungen.js'));
        assert.match(w, /if \(r\.art !== 'neu'\) throw[^\n]*\n\s*await tagsUebergeben\(sitzung, r\.paketId, zeilen\);/, 'veröffentlichen gibt die Tags nicht weiter — oder schon vor dem Einliefern');
        assert.match(w, /tags: await Tags\.fuer\(db\(\), 'spiel', zeile\.paket_id\)/, 'öffnen nimmt die Tags des Spiels nicht mit');
        assert.ok(!/einlieferung\.KATEGORIEN\.has\(kategorie\)/.test(w), 'das Formular prüft noch eine Kategorie');
    });

    console.log('\nDatenbank: Migration und Helfer an temporären Tabellen');
    const c = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE, dateStrings: true,
    });
    const echt = async () => JSON.stringify((await c.query(
        `SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('tags', 'tag_links') ORDER BY TABLE_NAME`))[0].map(z => z.TABLE_NAME));
    const vorher = await echt();

    // Die Verbindung, mit der die Migration läuft: aus jeder Tabelle wird eine
    // temporäre. Fremdschlüssel kennen temporäre Tabellen nicht — die Zeile fällt.
    let angelegt = 0;
    const db = {
        query: async (sql, p) => {
            let s = sql;
            if (/^\s*CREATE TABLE IF NOT EXISTS/.test(s)) {
                s = s.replace(/CREATE TABLE IF NOT EXISTS/, 'CREATE TEMPORARY TABLE')
                     .replace(/,\s*CONSTRAINT[^\n]*FOREIGN KEY[^\n]*/, '');
                angelegt++;
            }
            assert.ok(!/^\s*(DROP|ALTER|CREATE)\s+TABLE\b/i.test(s) || /TEMPORARY/.test(s),
                `der Wächter führt kein DDL an echten Tabellen aus: ${s.trim().slice(0, 60)}`);
            return (await c.query(s, p))[0];
        },
    };
    const migration = require('../migrations/kern/20261007_140000_tag_bibliothek.js');

    await pruefe('die Migration legt beide Tabellen an und zieht die vorhandenen Spiel-Tags um', async () => {
        await migration.up(db);
        assert.strictEqual(angelegt, 2);
        // Was im alten Feld steht, muss danach in der Bibliothek hängen — je Spiel dieselbe Menge.
        const [spiele] = await c.query(`SELECT id, slug, tags FROM addon_marketplace WHERE tags IS NOT NULL AND tags <> '' AND tags <> '[]'`);
        for (const s of spiele) {
            let alt; try { alt = JSON.parse(s.tags); } catch { alt = String(s.tags).split(','); }
            if (!Array.isArray(alt)) alt = String(s.tags).split(',');
            const erwartet = [...new Set(alt.map(x => String(x).trim()).filter(Boolean).map(x => x.toLowerCase()))].sort();
            const ist = (await Tags.fuer(db, 'spiel', s.id)).map(x => x.toLowerCase()).sort();
            assert.deepStrictEqual(ist, erwartet, `Spiel ${s.slug}`);
        }
        console.log(`      (${spiele.length} Spiel(e) mit Tags im alten Feld umgezogen)`);
    });

    await pruefe('setzen: neue Tags entstehen, vorhandene werden wiederverwendet und behalten ihre Schreibweise', async () => {
        const A = 900001, B = 900002;
        assert.deepStrictEqual(await Tags.setze(db, 'spiel', A, ['Wächterprobe', 'Koop-Probe']), ['Koop-Probe', 'Wächterprobe']);
        assert.deepStrictEqual(await Tags.setze(db, 'spiel', B, ['koop-probe', 'NUR-B-Probe']), ['Koop-Probe', 'NUR-B-Probe'],
            '„koop-probe" ist dasselbe Tag wie „Koop-Probe" — und heisst weiter so');
        const [[n]] = await c.query("SELECT COUNT(*) n FROM tags WHERE slug = 'koop-probe'");
        assert.strictEqual(Number(n.n), 1, 'ein Tag, nicht zwei');
        const alle = await Tags.alle(db);
        assert.strictEqual(Number(alle.find(t => t.slug === 'koop-probe').benutzt), 2);
        assert.deepStrictEqual(await Tags.fuerViele(db, 'spiel', [A, B, 900003]),
            { [A]: ['Koop-Probe', 'Wächterprobe'], [B]: ['Koop-Probe', 'NUR-B-Probe'], 900003: [] });
    });

    await pruefe('setzen ersetzt: was nicht mehr genannt wird, ist weg — das Tag selbst bleibt in der Bibliothek', async () => {
        const A = 900001;
        assert.deepStrictEqual(await Tags.setze(db, 'spiel', A, ['Wächterprobe']), ['Wächterprobe']);
        assert.deepStrictEqual(await Tags.setze(db, 'spiel', A, []), []);
        const alle = await Tags.alle(db);
        assert.strictEqual(Number(alle.find(t => t.slug === 'wächterprobe').benutzt), 0, 'unbenutzt, aber noch da — zum Wiederverwenden');
        await assert.rejects(Tags.setze(db, 'blog', 1, ['x']), /den Bereich „blog" gibt es nicht/);
        // „a,b" als EIN Listeneintrag enthält ein Komma — abgewiesen, nichts geschrieben.
        await assert.rejects(Tags.setze(db, 'spiel', A, ['a,b']), /nicht geht/);
        assert.deepStrictEqual(await Tags.fuer(db, 'spiel', A), []);
    });

    await pruefe('suchen: die Bedingung findet ein Spiel über sein Tag', async () => {
        const [[spiel]] = await c.query('SELECT id FROM addon_marketplace ORDER BY id LIMIT 1');
        await Tags.setze(db, 'spiel', spiel.id, [...await Tags.fuer(db, 'spiel', spiel.id), 'Suchprobe-Xyz']);
        const sql = `SELECT id FROM addon_marketplace WHERE ${Tags.sucheSql('spiel', 'addon_marketplace.id')}`;
        assert.deepStrictEqual((await db.query(sql, ['%suchprobe-x%'])).map(z => z.id), [spiel.id]);
        assert.deepStrictEqual(await db.query(sql, ['%gibt-es-nicht%']), []);
    });

    // ── Tags statt Kategorie (2026-10-08): filtern, zählen, Verwandte finden ──
    await pruefe('filtern: die Bedingung findet Spiele über den slug eines Tags — unabhängig von der Schreibweise', async () => {
        const [[spiel]] = await c.query('SELECT id FROM addon_marketplace ORDER BY id LIMIT 1');
        const sql = `SELECT id FROM addon_marketplace WHERE ${Tags.hatTagSql('spiel', 'addon_marketplace.id')}`;
        assert.deepStrictEqual((await db.query(sql, [Tags.slugVon('  SUCHPROBE-xyz ')])).map(z => z.id), [spiel.id]);
        assert.deepStrictEqual(await db.query(sql, ['suchprobe']), [], 'ein Teil des Namens ist kein Tag');
        assert.throws(() => Tags.hatTagSql('spiel', 'a.id; DROP TABLE x'), /ungültige Spalte/);
    });
    await pruefe('zählen und Verwandte: was Einträge wirklich tragen, häufigstes zuerst — und wer am meisten teilt', async () => {
        const A = 900011, B = 900012, C = 900013, D = 900014;
        await Tags.setze(db, 'spiel', A, ['Probe-X', 'Probe-Y', 'Probe-Z']);
        await Tags.setze(db, 'spiel', B, ['probe-x', 'Probe-Y']);
        await Tags.setze(db, 'spiel', C, ['Probe-X']);
        await Tags.setze(db, 'spiel', D, ['Probe-W']);
        assert.deepStrictEqual(await Tags.benutzte(db, 'spiel', [A, B, C, D]), [
            { name: 'Probe-X', slug: 'probe-x', anzahl: 3 }, { name: 'Probe-Y', slug: 'probe-y', anzahl: 2 },
            { name: 'Probe-W', slug: 'probe-w', anzahl: 1 }, { name: 'Probe-Z', slug: 'probe-z', anzahl: 1 }]);
        assert.deepStrictEqual(await Tags.benutzte(db, 'spiel', [C, D]), [
            { name: 'Probe-W', slug: 'probe-w', anzahl: 1 }, { name: 'Probe-X', slug: 'probe-x', anzahl: 1 }]);
        assert.deepStrictEqual(await Tags.benutzte(db, 'spiel', []), [], 'ohne Einträge gibt es nichts zu zählen');
        assert.ok((await Tags.benutzte(db, 'spiel')).some(x => x.slug === 'probe-x'), 'ohne Einschränkung fehlt ein Tag');
        assert.deepStrictEqual(await Tags.verwandte(db, 'spiel', A), [{ id: B, gemeinsam: 2 }, { id: C, gemeinsam: 1 }]);
        assert.deepStrictEqual(await Tags.verwandte(db, 'spiel', D), [], 'wer nichts teilt, hat keine Verwandten');
        assert.deepStrictEqual(await Tags.verwandte(db, 'spiel', A, 1), [{ id: B, gemeinsam: 2 }]);
        for (const id of [A, B, C, D]) await Tags.setze(db, 'spiel', id, []);
    });
    // Die Werkbank am selben Bestand: Die Sitzung reicht ihre Tags weiter — über
    // denselben dbService, mit dem sie sonst arbeitet (hier die temporären Tabellen).
    await pruefe('Werkbank: Tags der Sitzung gehen an das Spiel — ohne eigene bleibt, was es trägt', async () => {
        const { ServiceManager } = require('dunebot-core');
        const still = () => {};
        ServiceManager.register('dbService', db);
        if (!ServiceManager.has('Logger')) ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });
        const S = require('../plugins/werkbank/dashboard/helpers/Sitzungen');
        const [[paket]] = await c.query('SELECT id, slug FROM packages ORDER BY id LIMIT 1');
        await Tags.setze(db, 'spiel', paket.id, ['Vorher-Probe']);
        // Vorbelegung des Formulars: ohne eigene Tags, was das Spiel unter diesem Slug trägt.
        assert.deepStrictEqual(await S.angabenTags({ entwurf: { identity: { slug: paket.slug } } }), ['Vorher-Probe']);
        assert.deepStrictEqual(await S.angabenTags({ entwurf: { identity: { slug: 'gibt-es-nicht-probe' } } }), []);
        assert.deepStrictEqual(await S.angabenTags({ entwurf: { identity: { slug: paket.slug }, werkbank: { praesentation: { tags: [] } } } }), [],
            'eine bewusst leere Liste wurde mit den Tags des Spiels überschrieben');
        // Ohne eigene Tags: nicht anfassen.
        assert.strictEqual(await S.tagsUebergeben({ entwurf: { werkbank: { praesentation: { icon_url: '' } } } }, paket.id), null);
        assert.deepStrictEqual(await Tags.fuer(db, 'spiel', paket.id), ['Vorher-Probe']);
        // Mit eigenen: genau diese.
        const zeilen = [];
        assert.deepStrictEqual(await S.tagsUebergeben({ entwurf: { werkbank: { praesentation: { tags: ['Neu-Probe', 'vorher-probe'] } } } }, paket.id, zeilen),
            ['Neu-Probe', 'Vorher-Probe']);
        assert.deepStrictEqual(zeilen, []);
        // Scheitert es, steht es in den Meldungen — und wirft nicht (das Paket ist da schon eingeliefert).
        assert.strictEqual(await S.tagsUebergeben({ entwurf: { werkbank: { praesentation: { tags: ['mit,komma'] } } } }, paket.id, zeilen), null);
        assert.ok(zeilen.length === 1 && /Tags liessen sich nicht setzen/.test(zeilen[0]), `keine Meldung: ${zeilen.join(' | ')}`);
        assert.deepStrictEqual(await Tags.fuer(db, 'spiel', paket.id), ['Neu-Probe', 'Vorher-Probe'], 'ein gescheiterter Versuch hat die Tags verändert');
        await Tags.setze(db, 'spiel', paket.id, []);
    });
    await pruefe('Starttag: Spiele ohne Tags bekommen ihre Kategorie als erstes — wer Tags hat, bleibt unberührt', async () => {
        const start = require('../plugins/gameserver/migrations/20261008_140000_starttag_aus_kategorie.js');
        const [spiele] = await c.query('SELECT id, slug, category FROM addon_marketplace ORDER BY id');
        const vorher = await Tags.fuerViele(db, 'spiel', spiele.map(s => s.id));
        await start.up(db);
        const danach = await Tags.fuerViele(db, 'spiel', spiele.map(s => s.id));
        let gesetzt = 0;
        for (const s of spiele) {
            if (vorher[s.id].length) { assert.deepStrictEqual(danach[s.id], vorher[s.id], `${s.slug} hatte Tags und wurde angefasst`); continue; }
            const erwartet = start.START_TAG[s.category];
            assert.deepStrictEqual(danach[s.id].map(Tags.slugVon), erwartet ? [Tags.slugVon(erwartet)] : [], `${s.slug} (${s.category})`);
            if (erwartet) gesetzt++;
        }
        assert.ok(!('other' in start.START_TAG), '„other" sagt nichts und wird kein Tag');
        await start.up(db);
        assert.deepStrictEqual(await Tags.fuerViele(db, 'spiel', spiele.map(s => s.id)), danach, 'ein zweiter Lauf hat etwas geändert');
        console.log(`      (${gesetzt} Spiel(e) ohne Tags bekamen eines)`);
    });

    await c.query('DROP TEMPORARY TABLE IF EXISTS tag_links, tags');
    await pruefe('die echte Datenbank ist unberührt', async () => {
        assert.strictEqual(await echt(), vorher);
    });
    console.log(vorher === '[]'
        ? '  · tags/tag_links gibt es noch nicht — die Migration läuft mit dem nächsten Dashboard-Start'
        : '  · tags/tag_links sind angelegt');
    await c.end();

    console.log(fehler === 0 ? '\n✅ Tag-Bibliothek: eine Quelle, an der Datenbank belegt\n' : `\n❌ ${fehler} Abweichung(en)\n`);
    process.exit(fehler === 0 ? 0 : 1);
})().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
