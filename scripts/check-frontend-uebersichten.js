#!/usr/bin/env node
/**
 * Webseite: die Übersichten „Alle Neuigkeiten" und „Alle Changelogs" (2026-10-09).
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 *
 * Betreiber, 2026-10-09: Die Startseite zeigt sechs News, „aber es gibt dort
 * keinen Link zu allen News. Gleiches bei den Changelogs, die teilweise SEHR
 * lang angezeigt werden."
 *
 * Gefunden wurden vier Dinge, und jedes hat hier seine Probe:
 *
 *   1. Für News gab es keine Übersicht. Jetzt: `/news`, zwölf je Seite.
 *   2. Die Übersicht der Changelogs gab es — ihr Knopf auf der Startseite
 *      erschien aber nur bei MEHR als drei Einträgen, und geladen wurden genau
 *      drei. Er konnte nie erscheinen.
 *   3. Die Karten der Startseite gaben die ganze Beschreibung als HTML aus
 *      (2.3.0: 2600 Zeichen). Jetzt ein Textauszug.
 *   4. Liste und Detailseite fragten nicht nach `status`: Ein Entwurf war für
 *      jeden lesbar, der die Fassung in die Adresse tippte.
 *
 * Gefahren wird der echte Router mit einer Attrappe der Datenbank, die ihre
 * Abfragen selbst auswertet (Filter, Grenze, Versatz) — sonst prüfte der
 * Wächter nur, dass die Wörter im SQL stehen. Gezeichnet werden die echten
 * Vorlagen.
 *
 *   node scripts/check-frontend-uebersichten.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ejs = require('ejs');

const WURZEL = path.join(__dirname, '..');
const THEMA = path.join(WURZEL, 'apps/dashboard/themes/default');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

// ── Bestand der Attrappe ────────────────────────────────────────────────────
const uebersetzt = (de) => JSON.stringify({ 'de-DE': de, 'en-GB': '' });
const NEWS = Array.from({ length: 26 }, (_, i) => ({
    _id: i + 1, slug: `news-${i + 1}`, status: i === 20 ? 'draft' : 'published',
    title_translations: uebersetzt(`Titel ${i + 1} <b>fett</b>`),
    excerpt_translations: uebersetzt(`<p>Anriss&nbsp;${i + 1} &mdash; mit <strong>HTML</strong></p>`),
    content_translations: uebersetzt('<p>Inhalt</p>'),
    author: 'Team', image_url: '/images/x.png',
    date: `2026-09-${String(i + 1).padStart(2, '0')} 10:00:00`, created_at: `2026-09-${String(i + 1).padStart(2, '0')} 10:00:00`,
}));
const LANG = '<div># Changelog &mdash; lang</div>' + '<div>Ein Satz mit <strong>Auszeichnung</strong> und noch einem Wort dazu. </div>'.repeat(40);
const CHANGELOGS = [
    { id: 1, version: '1.0.0', status: 'published', is_public: 1, release_date: '2026-01-01 10:00:00' },
    { id: 2, version: '2.0.0', status: 'published', is_public: 1, release_date: '2026-06-01 10:00:00' },
    { id: 3, version: '2.3.0', status: 'published', is_public: 1, release_date: '2026-08-11 10:00:00' },
    { id: 4, version: '2.4.0', status: 'draft',     is_public: 1, release_date: '2026-10-09 10:00:00' }, // Entwurf MIT Haken
    { id: 5, version: '2.2.9', status: 'published', is_public: 0, release_date: '2026-07-01 10:00:00' }, // veröffentlicht, nicht öffentlich
].map(c => ({ ...c, type: 'major', title_translations: uebersetzt(`Update ${c.version}`), description_translations: uebersetzt(LANG),
    changes_translations: uebersetzt('# Gruppe\n## Teil\n+ Neu') }));

/** Die Attrappe WERTET die Abfrage aus — Filter, Reihenfolge, Grenze, Versatz. */
const gefragt = [];
function antworte(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ').trim();
    gefragt.push(s);
    const tabelle = /FROM (news|changelogs)\b/.exec(s)?.[1];
    if (!tabelle) throw new Error(`Attrappe kennt die Abfrage nicht: ${s.slice(0, 90)}`);
    let zeilen = tabelle === 'news' ? [...NEWS] : [...CHANGELOGS];
    const wo = / WHERE (.*?)(?: ORDER BY| LIMIT|$)/.exec(s)?.[1] || '';
    let p = 0;
    for (const teil of wo.split(' AND ').map(x => x.trim()).filter(Boolean)) {
        const m = /^(\w+) = (\?|'[^']*'|\d+)$/.exec(teil);
        if (!m) throw new Error(`Attrappe versteht die Bedingung nicht: ${teil}`);
        const wert = m[2] === '?' ? params[p++] : m[2].replace(/^'|'$/g, '');
        zeilen = zeilen.filter(z => String(z[m[1]]) === String(wert));
    }
    if (/^SELECT COUNT\(\*\) AS n /.test(s)) return [{ n: zeilen.length }];
    const ordnung = / ORDER BY (\w+) DESC/.exec(s)?.[1];
    if (ordnung) zeilen.sort((a, b) => String(b[ordnung]).localeCompare(String(a[ordnung])));
    const grenze = / LIMIT (\d+)(?: OFFSET (\d+))?/.exec(s);
    if (grenze) zeilen = zeilen.slice(Number(grenze[2] || 0), Number(grenze[2] || 0) + Number(grenze[1]));
    return zeilen;
}
ServiceManager.register('dbService', { query: async (sql, params) => antworte(sql, params) });
const still = () => {};
const protokoll = [];
ServiceManager.register('Logger', { debug: still, info: still, warn: still, success: still, error: (...a) => protokoll.push(a.map(x => x?.message || x).join(' ')) });

// ── Zeichnen mit den echten Vorlagen ────────────────────────────────────────
const TEXTE = { 'de-DE': JSON.parse(fs.readFileSync(path.join(WURZEL, 'apps/dashboard/locales/de-DE.json'), 'utf8')),
    'en-GB': JSON.parse(fs.readFileSync(path.join(WURZEL, 'apps/dashboard/locales/en-GB.json'), 'utf8')) };
const trFuer = (sprache) => (schluessel, werte = {}) => {
    const v = schluessel.split('.').reduce((o, k) => (o ? o[k] : undefined), TEXTE[sprache]);
    return typeof v === 'string' ? v.replace(/\{\{(\w+)\}\}/g, (_, k) => werte[k]) : `??${schluessel}??`;
};
const zeichne = (datei, daten, sprache = 'de-DE') => ejs.render(fs.readFileSync(datei, 'utf8'),
    { ...daten, tr: trFuer(sprache), theme: { asset: (u) => u }, locals: daten }, { filename: datei });
let letzte = null;
ServiceManager.register('themeManager', { getLayout: () => 'frontend', renderView: async (res, ansicht, daten) => {
    letzte = { ansicht, daten, html: zeichne(path.join(THEMA, 'views', ansicht + '.ejs'), daten) };
} });
const router = require('../apps/dashboard/routes/frontend.router.js');
const handler = (pfad) => router.stack.find(s => s.route && s.route.path === pfad && s.route.methods.get).route.stack[0].handle;
async function rufe(pfad, { query = {}, params = {} } = {}) {
    letzte = null;
    let status = 200;
    const res = { locals: { locale: 'de-DE' }, status(s) { status = s; return this; }, render(v) { letzte = { ansicht: v, html: '', daten: null }; return this; } };
    await handler(pfad)({ query, params, session: {}, cookies: {} }, res);
    return { status, ...letzte };
}
const zaehle = (text, muster) => text.split(muster).length - 1;

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 4).join('\n      ')}`); }
}

(async () => {
    console.log('\nAlle Neuigkeiten');
    await pruefe('die Route gibt es, und sie zeigt nur Veröffentlichtes — zwölf je Seite, neueste zuerst', async () => {
        const r = await rufe('/news');
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.ansicht, 'frontend/news');
        assert.strictEqual(r.daten.blaettern.gesamt, 25, 'der Entwurf zählt mit');
        assert.strictEqual(r.daten.news.length, 12);
        assert.strictEqual(r.daten.news[0].slug, 'news-26');
        assert.ok(!r.daten.news.some(n => n.slug === 'news-21'), 'der Entwurf steht in der Liste');
        assert.strictEqual(zaehle(r.html, 'class="news-item'), 12);
    });
    await pruefe('Blättern: drei Seiten, die letzte mit dem Rest — und die ersten sechs sind die der Startseite', async () => {
        const eins = await rufe('/news'), zwei = await rufe('/news', { query: { seite: '2' } }), drei = await rufe('/news', { query: { seite: '3' } });
        assert.deepStrictEqual([eins, zwei, drei].map(r => r.daten.news.length), [12, 12, 1]);
        const alle = [eins, zwei, drei].flatMap(r => r.daten.news.map(n => n.slug));
        assert.strictEqual(new Set(alle).size, 25, 'ein Eintrag steht auf zwei Seiten oder fehlt');
        const start = antworte("SELECT * FROM news WHERE status = 'published' ORDER BY created_at DESC LIMIT 6").map(n => n.slug);
        assert.deepStrictEqual(eins.daten.news.slice(0, 6).map(n => n.slug), start);
        assert.strictEqual(zaehle(zwei.html, 'page-item active'), 1);
        assert.ok(zwei.html.includes('href="/news"') && zwei.html.includes('href="/news?seite=3"'), 'Seite 2 führt nicht zu 1 und 3');
        assert.ok(zwei.html.includes('Seite 2 von 3'));
    });
    await pruefe('eine Seite, die es nicht gibt, zeigt keine leere Liste — und keine Eingabe landet im SQL', async () => {
        for (const [seite, soll] of [['99', 3], ['0', 1], ['-4', 1], ['abc', 1], ['2; DROP TABLE news', 1], ['2abc', 1], [' 2', 1], [['2', '3'], 1], ['3', 3]]) {
            gefragt.length = 0;
            const r = await rufe('/news', { query: { seite } });
            assert.strictEqual(r.daten.blaettern.seite, soll, `seite=${JSON.stringify(seite)}`);
            assert.ok(r.daten.news.length > 0, `seite=${JSON.stringify(seite)} zeigt nichts`);
            for (const s of gefragt) assert.ok(!/DROP|abc/.test(s) && / LIMIT 12 OFFSET \d+$/.test(s) || /^SELECT COUNT/.test(s), `ins SQL geraten: ${s}`);
        }
    });
    await pruefe('die Karte zeigt Text: kein HTML aus Titel oder Anriss, Entities aufgelöst', async () => {
        const r = await rufe('/news');
        assert.ok(r.html.includes('Titel 26 &lt;b&gt;fett&lt;/b&gt;'), 'der Titel wird nicht escaped');
        assert.ok(!/<strong>HTML<\/strong>/.test(r.html) && !r.html.includes('&amp;nbsp;') && !r.html.includes('&amp;mdash;'), 'der Anriss kommt als HTML oder mit doppelt kodierten Zeichen an');
        assert.ok(r.html.includes('Anriss 26 — mit HTML'));
        const roh = [...ohneKommentareEjs(fs.readFileSync(path.join(THEMA, 'views/frontend/news.ejs'), 'utf8')).matchAll(/<%-\s*([\s\S]*?)%>/g)].map(m => m[1].trim());
        for (const x of roh) assert.ok(/^include\('\.\.\/\.\.\/partials\/frontend\/blaettern'/.test(x), `unescaped ausgegeben: ${x.slice(0, 50)}`);
    });
    await pruefe('ohne Neuigkeiten steht das da — ohne Blättern', async () => {
        const merke = NEWS.splice(0, NEWS.length);
        try {
            const r = await rufe('/news');
            assert.strictEqual(r.status, 200);
            assert.ok(r.html.includes(TEXTE['de-DE'].NEWS.NO_NEWS));
            assert.strictEqual(zaehle(r.html, 'pagination'), 0);
        } finally { NEWS.push(...merke); }
    });

    console.log('\nAlle Changelogs');
    await pruefe('die Liste zeigt nur, was öffentlich UND veröffentlicht ist', async () => {
        const r = await rufe('/changelogs');
        assert.deepStrictEqual(r.daten.changelogs.map(c => c.version), ['2.3.0', '2.0.0', '1.0.0']);
        assert.strictEqual(zaehle(r.html, 'pagination'), 0, 'drei Einträge brauchen kein Blättern');
        for (const c of r.daten.changelogs) assert.ok(c.excerpt.length <= 221 && !/[<>]/.test(c.excerpt), 'der Auszug ist zu lang oder trägt HTML');
    });
    await pruefe('ein Entwurf ist über seine Fassung nicht lesbar — auch mit gesetztem Haken', async () => {
        assert.strictEqual((await rufe('/changelogs/:version', { params: { version: '2.4.0' } })).status, 404, 'der Entwurf 2.4.0 ist öffentlich lesbar');
        assert.strictEqual((await rufe('/changelogs/:version', { params: { version: 'v2.2.9' } })).status, 404, 'ein nicht öffentlicher Changelog ist lesbar');
        const offen = await rufe('/changelogs/:version', { params: { version: 'v2.3.0' } });
        assert.strictEqual(offen.status, 200);
        assert.strictEqual(offen.ansicht, 'frontend/changelog-details');
    });

    console.log('\nFehlerseiten und Ankündigung');
    await pruefe('eine Fehlerseite läuft über den Zeichner des Themes — sonst kommt sie ohne Gestaltung an', async () => {
        // Bis zum 2026-10-10 rief der Router `res.status(404).render(…)` direkt:
        // Die Stylesheets reiht erst der Zeichner ein, die Seite stand nackt da.
        const r = await rufe('/changelogs/:version', { params: { version: '9.9.9' } });
        assert.strictEqual(r.status, 404);
        assert.strictEqual(r.ansicht, 'frontend/404');
        assert.ok(r.daten !== null, 'die 404-Seite wurde am Zeichner vorbei ausgegeben (res.render)');
        const n = await rufe('/news-details/:slug', { params: { slug: 'news-21' } });
        assert.strictEqual(n.status, 404, 'eine News im Entwurf ist öffentlich lesbar');
        assert.ok(n.daten !== null);
        const quelle = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'apps/dashboard/routes/frontend.router.js'), 'utf8'));
        assert.ok(!/\.render\(\s*['"]frontend\/(404|500)['"]/.test(quelle), 'im Router gibt es wieder eine Fehlerseite am Zeichner vorbei');
        // Scheitert auch das Zeichnen, hängt die Anfrage nicht.
        const tm = ServiceManager.get('themeManager');
        const echt = tm.renderView;
        tm.renderView = async () => { throw new Error('Zeichner kaputt'); };
        try {
            let gesendet = null, status = 0;
            const res = { locals: { locale: 'de-DE' }, headersSent: false, status(s) { status = s; return this; }, type() { return this; }, send(x) { gesendet = x; return this; } };
            await handler('/changelogs/:version')({ query: {}, params: { version: '9.9.9' }, session: {}, cookies: {} }, res);
            assert.strictEqual(status, 404);
            assert.strictEqual(gesendet, 'Seite nicht gefunden');
        } finally { tm.renderView = echt; protokoll.length = 0; }
    });
    await pruefe('eine News im Entwurf wird gespeichert, aber NICHT angekündigt — der Verweis führte auf eine 404', async () => {
        // Am 2026-10-09 ging die News zu 2.4.0 als Entwurf nach Discord.
        const geschrieben = [], gesendet = [];
        const echteDb = ServiceManager.get('dbService');
        ServiceManager.register('dbService', { query: async (sql, p) => { geschrieben.push(sql.replace(/\s+/g, ' ').trim().slice(0, 40)); return /INSERT INTO notifications/.test(sql) ? { insertId: 77 } : /admin_settings/.test(sql) ? [{ value: '{"channel_id":"1"}' }] : { insertId: 5 }; } });
        ServiceManager.register('ipcServer', { broadcastOne: async (name, daten) => { gesendet.push({ name, url: daten.action_url }); } });
        try {
            const inhalt = require('../apps/dashboard/routes/admin/content.router.js');
            const speichern = inhalt.stack.find(s => s.route && s.route.path === '/news/save' && s.route.methods.post).route.stack.slice(-1)[0].handle;
            const sende = async (status, mehr = {}) => {
                geschrieben.length = 0; gesendet.length = 0;
                let antwort = null;
                await speichern({ body: { newsId: '29', title_de: 'Update', slug: 'update-v2-4-0', status, send_discord_post: '1', send_dashboard_badge: '1', ...mehr } },
                    { status() { return this; }, json(x) { antwort = x; return this; } });
                return antwort;
            };
            const entwurf = await sende('draft');
            assert.strictEqual(entwurf.success, true, 'der Entwurf wurde nicht gespeichert');
            assert.ok(geschrieben.some(s => s.startsWith('UPDATE news SET')), 'der Entwurf wurde nicht gespeichert');
            assert.ok(!geschrieben.some(s => s.startsWith('INSERT INTO notifications')), 'für einen Entwurf wurde eine Meldung angelegt');
            assert.deepStrictEqual(gesendet, [], 'ein Entwurf ging nach Discord');
            assert.strictEqual(entwurf.angekuendigt, false);
            assert.match(entwurf.warnung, /NICHT angekündigt.*Entwurf/);
            assert.match(entwurf.message, /NICHT angekündigt/);
            // Ohne Status gilt dasselbe — „leer" ist nicht „veröffentlicht".
            assert.deepStrictEqual([(await sende(undefined)).angekuendigt, gesendet.length], [false, 0]);
            // Veröffentlicht: Meldung, Discord, und der Verweis zeigt auf die Seite, die es gibt.
            const offen = await sende('published');
            assert.strictEqual(offen.angekuendigt, true);
            assert.strictEqual(offen.warnung, null);
            assert.ok(geschrieben.some(s => s.startsWith('INSERT INTO notifications')));
            assert.strictEqual(gesendet.length, 1);
            assert.match(gesendet[0].url, /\/news-details\/update-v2-4-0$/);
            // Ohne Haken wird nie angekündigt, und es gibt dann auch keine Warnung.
            const still2 = await sende('draft', { send_discord_post: '', send_dashboard_badge: '' });
            assert.deepStrictEqual([still2.warnung, gesendet.length], [null, 0]);
            // Die Oberfläche lässt die Warnung stehen, statt weiterzuleiten.
            const skript = ohneKommentare(fs.readFileSync(path.join(THEMA, 'assets/js/guild.js'), 'utf8'));
            assert.match(skript, /if \(result\.success && result\.warnung\) \{\s*this\.showToast\('warning', result\.message\);\s*\} else if \(result\.success\)/);
        } finally { ServiceManager.register('dbService', echteDb); protokoll.length = 0; }
    });

    console.log('\nStartseite');
    const abschnitt = (name, daten) => zeichne(path.join(THEMA, 'partials/frontend/sections', name + '.ejs'), daten);
    await pruefe('der Controller lädt drei veröffentlichte Changelogs und gibt jedem einen Textauszug', async () => {
        const C = require('../apps/dashboard/controllers/frontend.controller.js');
        const quelle = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'apps/dashboard/controllers/frontend.controller.js'), 'utf8'));
        const sql = /"(SELECT \* FROM changelogs [^"]+)"/.exec(quelle);
        assert.ok(sql, 'die Abfrage der Startseite ist nicht zu finden');
        assert.deepStrictEqual(antworte(sql[1]).map(c => c.version), ['2.3.0', '2.0.0', '1.0.0'], 'die Startseite zeigt einen Entwurf oder etwas nicht Öffentliches');
        assert.ok(typeof C.getIndex === 'function');
        assert.match(quelle, /excerpt: require\('dunebot-sdk\/utils'\)\.ChangelogHelper\.zuTextauszug\(changelog\.description\)/);
    });
    await pruefe('Changelog-Karten: ein kurzer Text statt der ganzen Beschreibung, und der Weg zu allen', async () => {
        const { ChangelogHelper } = require('dunebot-sdk/utils');
        const liste = ChangelogHelper.getLocalizedChangelogList(antworte("SELECT * FROM changelogs WHERE is_public = 1 AND status = 'published' ORDER BY release_date DESC LIMIT 3"), 'de-DE')
            .map(c => ({ ...c, excerpt: ChangelogHelper.zuTextauszug(c.description), formattedDate: '1. Januar' }));
        assert.ok(liste[0].description.length > 2000, 'die Probe hat keine lange Beschreibung — sie mässe nichts');
        const html = abschnitt('changelogs', { changelogsList: liste });
        assert.strictEqual(zaehle(html, 'changelog-card h-100'), 3);
        const texte = [...html.matchAll(/<p class="changelog-description">([\s\S]*?)<\/p>/g)].map(m => m[1]);
        assert.strictEqual(texte.length, 3);
        for (const t of texte) assert.ok(t.length <= 240 && !/<div|<strong/.test(t), `die Karte trägt ${t.length} Zeichen oder HTML`);
        assert.strictEqual(zaehle(html, 'href="/changelogs"'), 1, 'von drei Changelogs führt kein Weg zu allen');
        // Auch bei EINEM Eintrag: Die alte Bedingung „mehr als drei" konnte nie zutreffen.
        assert.strictEqual(zaehle(abschnitt('changelogs', { changelogsList: liste.slice(0, 1) }), 'href="/changelogs"'), 1);
        assert.strictEqual(zaehle(abschnitt('changelogs', { changelogsList: [] }), 'href="/changelogs"'), 0);
    });
    await pruefe('News-Abschnitt: der Weg zu allen — und die Detailseite führt dorthin zurück', async () => {
        const { NewsHelper } = require('dunebot-sdk/utils');
        const liste = NewsHelper.getLocalizedNewsList(NEWS.slice(0, 6), 'de-DE').map(n => ({ ...n, formattedDate: 'x' }));
        const html = abschnitt('news', { newsList: liste });
        assert.strictEqual(zaehle(html, 'href="/news"'), 1);
        assert.ok(html.includes(TEXTE['de-DE'].NEWS.VIEW_ALL));
        assert.strictEqual(zaehle(abschnitt('news', { newsList: [] }), 'href="/news"'), 0);
        const detail = ohneKommentareEjs(fs.readFileSync(path.join(THEMA, 'views/frontend/news-details.ejs'), 'utf8'));
        assert.ok(detail.includes('<a href="/news" class="btn btn-primary">') && !detail.includes('href="/#news"'));
    });

    console.log('\nTexte');
    await pruefe('jeder neue Schlüssel steht in beiden Sprachen, und keine Seite zeigt einen rohen Schlüssel', async () => {
        for (const sprache of ['de-DE', 'en-GB']) {
            for (const k of ['NEWS.VIEW_ALL', 'NEWS.ALL_NEWS', 'PAGING.LABEL', 'PAGING.NEWER', 'PAGING.OLDER', 'PAGING.PAGE_OF']) {
                assert.ok(!trFuer(sprache)(k).startsWith('??'), `${sprache}: ${k} fehlt`);
            }
            assert.ok(/\{\{seite\}\}.*\{\{seiten\}\}/.test(TEXTE[sprache].PAGING.PAGE_OF));
        }
        for (const r of [await rufe('/news', { query: { seite: '2' } }), await rufe('/changelogs')]) assert.strictEqual(zaehle(r.html, '??'), 0, 'eine Seite zeigt einen Schlüssel statt Text');
        assert.deepStrictEqual(protokoll, [], 'beim Zeichnen ist ein Fehler ins Protokoll gegangen');
    });

    console.log(fehler === 0 ? '\n✅ Übersichten: alle News, alle Changelogs, kurze Karten, kein Entwurf sichtbar\n' : `\n❌ ${fehler} Abweichung(en)\n`);
    process.exit(fehler === 0 ? 0 : 1);
})().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
