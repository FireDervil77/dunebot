#!/usr/bin/env node
/**
 * Der Blog außerhalb der Blogseite: Aufmacher im Hero, „Neu" am Menüpunkt —
 * und die ausführliche Seite, wenn nur eine Kurzfassung da ist.
 *
 * ── Was hier gehalten wird (2026-10-12) ─────────────────────────────────────
 *
 * Die Startseite zeigt im Karussell den neuesten eigenen Blogartikel als erste
 * Folie, und am Menüpunkt „Blog" steht „Neu", solange ein eigener Artikel
 * jünger als sieben Tage ist (`apps/dashboard/helpers/Blog.js`). Still
 * schiefgehen kann:
 *
 *   Auswahl    ein Entwurf, ein vordatierter Artikel oder eine Spielemeldung
 *              aus Discord wird Aufmacher — oder hält das „Neu" dauerhaft an
 *   Karussell  zwei Folien sind zugleich „aktiv" oder keine; die Punkte unter
 *              dem Karussell zählen eine Folie zu wenig
 *   Menü       das „Neu" steht an jedem Punkt oder an keinem
 *
 * Datenbank: an einer TEMPORÄREN Kopie von `blog_posts`.
 *
 *   node scripts/check-blog-aufmacher.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const ejs = require('ejs');

const still = () => {};
if (!ServiceManager.has('Logger')) {
    ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });
}
const migration = require(path.join(WURZEL, 'migrations/kern/20261012_180000_blog_spielemeldungen.js'));
const TEILE = path.join(WURZEL, 'apps/dashboard/themes/default/partials/frontend');
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), 'utf8');

let fehler = 0, bestanden = 0;
async function pruefe(was, tun) {
    try { await tun(); bestanden++; console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 3).join('\n      ')}`); }
}

/** `tr` wie im Dashboard. Ein Schlüssel, den es nicht gibt, wirft. */
function uebersetzer(locale) {
    const texte = JSON.parse(lies(`apps/dashboard/locales/${locale}.json`));
    return (schluessel) => {
        const t = schluessel.split('.').reduce((o, k) => (o == null ? o : o[k]), texte);
        if (typeof t !== 'string') throw new Error(`Sprachschlüssel fehlt in ${locale}: ${schluessel}`);
        return t;
    };
}

(async () => {
    console.log('\nAuswahl: welcher Artikel Aufmacher ist und was als neu zählt');

    const zugang = {
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
    };
    const c = await mysql.createConnection(zugang);
    const aussen = await mysql.createConnection(zugang);
    const echt = async () => JSON.stringify((await aussen.query('SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS m FROM blog_posts'))[0][0]);
    const vorher = await echt();

    await c.query('CREATE TEMPORARY TABLE fb_k LIKE blog_posts');
    await c.query('CREATE TEMPORARY TABLE blog_posts LIKE fb_k');
    await c.query('DROP TEMPORARY TABLE fb_k');
    const istKopie = /^CREATE TEMPORARY TABLE/.test((await c.query('SHOW CREATE TABLE blog_posts'))[0][0]['Create Table']);
    assert.ok(istKopie, 'blog_posts ist in dieser Verbindung keine Kopie');
    const db = {
        query: async (sql, p = []) => {
            assert.ok(!/^\s*(DROP|CREATE|TRUNCATE)\s/i.test(sql), `der Wächter legt nichts an und wirft nichts weg: ${sql.trim().slice(0, 60)}`);
            return (await c.execute(sql, p))[0];
        },
    };
    await migration.up(db);   // vor dem Rollout fehlen der Kopie die Spalten zur Herkunft
    ServiceManager.register('dbService', db);
    const Blog = require(path.join(WURZEL, 'apps/dashboard/helpers/Blog.js'));

    const lege = (slug, mehr = {}) => db.query(
        `INSERT INTO blog_posts (title_translations, content_translations, excerpt_translations, slug, author, status, published_at, source, source_message_id)
         VALUES (?, ?, ?, ?, 'x', ?, NOW() - INTERVAL ? HOUR, ?, ?)`,
        [JSON.stringify(mehr.titel || { 'de-DE': 'Titel ' + slug, 'en-GB': '' }), JSON.stringify({ 'de-DE': mehr.inhalt || '<p>Inhalt</p>' }),
         JSON.stringify({ 'de-DE': mehr.kurz ?? '<p>Kurz&nbsp;&amp; <strong>knapp</strong></p>' }), slug,
         mehr.status || 'published', mehr.vorStunden ?? 0, mehr.quelle || 'own', mehr.quelle === 'discord' ? '1' + String(Math.random()).slice(2, 19) : null]);

    await pruefe('ohne Artikel: kein Aufmacher, kein „Neu"', async () => {
        Blog.vergiss();
        assert.strictEqual(await Blog.neuester('de-DE'), null);
        assert.strictEqual(await Blog.zahlNeu(), 0);
    });

    await pruefe('der neueste EIGENE, veröffentlichte Artikel — kein Entwurf, kein vordatierter, keine Spielemeldung', async () => {
        await lege('alt', { vorStunden: 24 * 30 });
        await lege('neu', { vorStunden: 48 });
        await lege('entwurf', { vorStunden: 2, status: 'draft' });
        await lege('ausgeblendet', { vorStunden: 3, status: 'hidden' });
        await lege('vordatiert', { vorStunden: -24 });
        await lege('meldung', { vorStunden: 1, quelle: 'discord' });
        const a = await Blog.neuester('de-DE');
        assert.deepStrictEqual([a.slug, a.titel, a.kurztext], ['neu', 'Titel neu', 'Kurz & knapp']);
        assert.ok(a.zeit instanceof Date);
        Blog.vergiss();
        assert.strictEqual(await Blog.zahlNeu(), 1, 'als neu zählt nur der eigene Artikel von vor zwei Tagen');
    });

    await pruefe('ohne Anriss kommt der Kurztext aus dem Inhalt; ohne deutsche Fassung die englische', async () => {
        await lege('ohne-anriss', { vorStunden: 1, kurz: '', inhalt: '<h2>Über</h2><p>Der <em>eigentliche</em> Text.</p>', titel: { 'de-DE': '', 'en-GB': 'Only English' } });
        const a = await Blog.neuester('de-DE');
        assert.strictEqual(a.titel, 'Only English');
        assert.ok(a.kurztext.includes('Der eigentliche Text.') && !/[<>]/.test(a.kurztext), a.kurztext);
        await db.query("DELETE FROM blog_posts WHERE slug = 'ohne-anriss'");
    });

    await pruefe(`„Neu" gilt ${Blog.NEU_TAGE} Tage — und wird höchstens einmal je Minute gezählt`, async () => {
        Blog.vergiss();
        assert.strictEqual(await Blog.zahlNeu(), 1);
        await db.query("UPDATE blog_posts SET published_at = NOW() - INTERVAL ? DAY WHERE slug = 'neu'", [Blog.NEU_TAGE + 1]);
        assert.strictEqual(await Blog.zahlNeu(), 1, 'innerhalb der Minute wird nicht neu gezählt');
        Blog.vergiss();
        assert.strictEqual(await Blog.zahlNeu(), 0);
        assert.strictEqual((await Blog.neuester('de-DE')).slug, 'neu', 'Aufmacher bleibt der neueste, auch wenn er nicht mehr „neu" ist');
    });

    await pruefe('der Wächter hat an der echten Tabelle nichts geändert', async () => {
        assert.strictEqual(await echt(), vorher);
    });
    await c.end();
    await aussen.end();

    // ═════════════════════════════════════════════════════════════
    console.log('\nKarussell und Menü');

    const news = [1, 2, 3].map(i => ({ title: `News ${i}`, excerpt: 'Anriss', content: 'Inhalt', date: new Date(), slug: `news-${i}` }));
    const hero = (locale, daten) => ejs.renderFile(path.join(TEILE, 'sections/hero.ejs'),
        { theme: { asset: (x) => x }, tr: uebersetzer(locale), coreConfig: { githubUrl: 'https://example.org' }, locale, carouselNews: news, ...daten });
    const folien = (html) => (html.match(/class="carousel-item[^"]*"/g) || []);
    const punkte = (html) => (html.match(/data-slide-to="\d+"/g) || []).length;

    await pruefe('mit Aufmacher: er ist die erste und einzige aktive Folie, Titel escapt, ein Punkt mehr', async () => {
        for (const locale of ['de-DE', 'en-GB']) {
            const html = await hero(locale, { heroBlog: { slug: 'mein-artikel', titel: 'Mein <b>Artikel</b>', kurztext: 'Kurz & knapp', zeit: new Date('2026-10-12T10:00:00Z') } });
            const f = folien(html);
            assert.strictEqual(f.length, 7);
            assert.deepStrictEqual(f.map(x => /active/.test(x)), [true, false, false, false, false, false, false]);
            assert.strictEqual(punkte(html), 7, 'die Punkte unter dem Karussell zählen anders als die Folien');
            const erste = html.slice(html.indexOf(f[0]), html.indexOf('<!-- Slide: Standard 1 -->'));
            assert.ok(erste.includes('Mein &lt;b&gt;Artikel&lt;/b&gt;') && !erste.includes('<b>Artikel</b>'));
            assert.ok(erste.includes('href="/blog/mein-artikel"') && erste.includes('href="/blog"') && erste.includes('Kurz &amp; knapp'));
            assert.ok(erste.includes(uebersetzer(locale)('LANDING.HERO_BLOG_LABEL')));
        }
    });

    await pruefe('ohne Aufmacher — und beim Prozess von vor dem Umbau — beginnt das Karussell wie vorher', async () => {
        for (const daten of [{ heroBlog: null }, {}]) {
            const html = await hero('de-DE', daten);
            const f = folien(html);
            assert.strictEqual(f.length, 6);
            assert.deepStrictEqual(f.map(x => /active/.test(x)), [true, false, false, false, false, false]);
            assert.strictEqual(punkte(html), 6);
            assert.ok(!html.includes('hero-rubrik'));
        }
        // Der erste Punkt ist als aktiv ausgezeichnet — als Attribut, nicht als Text.
        assert.ok((await hero('de-DE', {})).includes('data-slide-to="0" class="active"'));
    });

    const menue = (locale, daten) => ejs.renderFile(path.join(TEILE, 'header_nav.ejs'),
        { theme: { asset: (x) => x }, tr: uebersetzer(locale), locale, ...daten });
    const punkteImMenue = [
        { url: '/', label: 'Start' },
        { url: '/blog', label: 'Blog' },
        { url: '/kb', label: 'Wissen', children: [{ url: '/blog', label: 'Blog im Untermenü' }, { url: '/kb/faq', label: 'FAQ' }] },
        { url: '/blog/spiele-updates', label: 'Updates' },
    ];
    await pruefe('„Neu" steht am Menüpunkt Blog — nur dort, und nur wenn es Neues gibt', async () => {
        for (const locale of ['de-DE', 'en-GB']) {
            const html = await menue(locale, { menuItems: punkteImMenue, blogNeu: 2 });
            assert.strictEqual((html.match(/class="menue-neu"/g) || []).length, 2, 'einmal oben, einmal im Untermenü');
            assert.match(html, new RegExp(`>Blog <span class="menue-neu">${uebersetzer(locale)('LANDING.BADGE_NEW')}</span></a>`));
            assert.ok(!/Start <span|Updates <span|FAQ <span|Wissen<\/span> <span class="menue-neu"/.test(html));
        }
        for (const daten of [{ blogNeu: 0 }, {}]) {
            assert.ok(!(await menue('de-DE', { menuItems: punkteImMenue, ...daten })).includes('class="menue-neu"'));
        }
    });

    await pruefe('Startseite und Menü bekommen ihre Werte; die Auswahl steht nur im Helfer', () => {
        const controller = ohneKommentare(lies('apps/dashboard/controllers/frontend.controller.js'));
        assert.ok(controller.includes("require('../helpers/Blog').neuester(userLocale)") && /carouselNews,\s*heroBlog,/.test(controller));
        const router = ohneKommentare(lies('apps/dashboard/routes/frontend.router.js'));
        assert.ok(router.includes("res.locals.blogNeu = await require('../helpers/Blog').zahlNeu()"));
        assert.ok(!/FROM blog_posts/.test(controller), 'der Controller fragt den Blog selbst ab');
        const css = lies('apps/dashboard/themes/default/assets/css/frontend.css');
        // Rohtext gewollt: Gesucht wird, ob es die Klasse in der Stildatei gibt.
        assert.ok(css.includes('.navmenu .menue-neu'), 'die Marke „Neu" am Menüpunkt hat keine Regel');
        // `.hero .hero-rubrik` gehörte zum alten Hero und ging mit ihm (7adf76ed,
        // 2026-10-13). Der neue (hero-kit) kennzeichnet den Aufmacher mit dem
        // Bild „NEU" — das wird hier geprüft, nicht eine Klasse ohne Aufrufer.
        const hero = ohneKommentare(lies('apps/dashboard/themes/default/partials/frontend/sections/hero.ejs'));
        assert.match(hero, /if \(aufmacher\) \{\s*folien\.push\(\{[\s\S]{0,200}marke: \{ bild: 'badges\/gefuellt\/Badge_NEU_gefuellt\.png'/,
            'die Aufmacher-Folie trägt keine Marke „NEU"');
    });

    // ═════════════════════════════════════════════════════════════
    console.log('\nAusführliche Seite: ohne Inhalt die Kurzfassung');

    await pruefe('News und Blogartikel, die nur eine Kurzfassung tragen, zeigen sie — in der Sprache des Lesers zuerst', () => {
        const { langfassung, istLeererInhalt } = require(path.join(WURZEL, 'apps/dashboard/helpers/text.js'));
        // Der Editor speichert „nichts" nicht als leere Zeichenkette.
        for (const leer of ['', null, undefined, '<p>&nbsp;</p>', '<p><br></p>\n', '  <div> </div> ']) assert.strictEqual(istLeererInhalt(leer), true, JSON.stringify(leer));
        for (const voll of ['<p>a</p>', '<p><img src="/x.png"></p>', '<iframe src="x"></iframe>']) assert.strictEqual(istLeererInhalt(voll), false, voll);

        assert.strictEqual(langfassung({ 'de-DE': '<p>Lang</p>' }, { 'de-DE': '<p>Kurz</p>' }, 'de-DE'), '<p>Lang</p>');
        assert.strictEqual(langfassung({ 'de-DE': '<p>&nbsp;</p>' }, { 'de-DE': '<p>Kurz</p>' }, 'de-DE'), '<p>Kurz</p>');
        // Der Fall vom 2026-10-12 (News „Content Update"): englisch gibt es nur die Kurzfassung.
        assert.strictEqual(langfassung(JSON.stringify({ 'de-DE': '<p>Lang</p>', 'en-GB': '' }), JSON.stringify({ 'de-DE': '<p>Kurz</p>', 'en-GB': '<p>Short</p>' }), 'en-GB'), '<p>Short</p>');
        assert.strictEqual(langfassung({ 'de-DE': '<p>Lang</p>' }, {}, 'en-GB'), '<p>Lang</p>');
        // Spielemeldungen tragen nur die englische Fassung.
        assert.strictEqual(langfassung({ 'en-GB': '<p>Only</p>' }, null, 'de-DE'), '<p>Only</p>');
        assert.strictEqual(langfassung(null, undefined, 'de-DE'), '');

        const router = ohneKommentare(lies('apps/dashboard/routes/frontend.router.js'));
        assert.ok(router.includes('content: langfassung(rawNews[0].content_translations, rawNews[0].excerpt_translations, userLocale)'), 'die News-Seite gibt nur den Inhalt aus');
        assert.ok(router.includes('content: langfassung(rawPost.content_translations, rawPost.excerpt_translations, userLocale)'), 'die Blogseite gibt nur den Inhalt aus');
    });

    console.log(`\n${fehler ? '❌' : '✅'} ${bestanden} bestanden, ${fehler} gescheitert`);
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error('\n❌ Der Wächter selbst ist gescheitert:', e); process.exit(1); });
