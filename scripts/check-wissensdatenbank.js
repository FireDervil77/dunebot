#!/usr/bin/env node
/**
 * Wissensdatenbank (`/kb`) — vom Einspielen bis zum Schloss am Artikel.
 *
 * ── Was hier gehalten wird (2026-10-11) ─────────────────────────────────────
 *
 * Die öffentliche Dokumentation zog aus 34 Markdown-Dateien (`documentation/`,
 * Adresse `/docs`) in die Datenbank (`kb_categories`, `kb_articles`, Adresse
 * `/kb`). Dabei kann an sechs Stellen still etwas verloren gehen:
 *
 *   Einspielen   eine Datei fehlt, ein Verweis zeigt ins Leere, ein Artikel zu
 *                einem Plugin, das es nicht gibt, steht plötzlich öffentlich da
 *   Rendern      rohes HTML aus einem Formularfeld landet als HTML auf einer
 *                öffentlichen Seite
 *   Sichtbarkeit ein Entwurf ist außen zu sehen — oder der Inhalt eines
 *                Artikels mit Schloss steht im Quelltext der Seite
 *   Adressen     ein alter Verweis auf /docs/… endet auf einer 404
 *   Verwaltung   zwei Artikel unter einer Adresse; die Startseite gelöscht
 *   Verdrahtung  der alte Datei-Editor bleibt daneben stehen (zwei Wege)
 *
 * Datenbank: Migration und Modell laufen an TEMPORÄREN Tabellen. Die
 * Verbindung schreibt `CREATE TABLE` in `CREATE TEMPORARY TABLE` um und
 * verweigert jedes Schreiben an eine Tabelle, die keine Kopie ist; am Ende
 * wird nachgezählt, dass es die echten Tabellen danach so wenig oder so sehr
 * gibt wie davor.
 *
 * Seiten: Der echte Router und die echte Ansicht, bedient über HTTP auf einem
 * freien Port — mit einer Attrappe nur für das Layout drumherum.
 *
 *   node scripts/check-wissensdatenbank.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const ejs = require('ejs');
const express = require('express');

const still = () => {};
if (!ServiceManager.has('Logger')) {
    ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });
}

const Wissen = require(path.join(WURZEL, 'apps/dashboard/helpers/Wissen'));
const migration = require(path.join(WURZEL, 'migrations/kern/20261011_150000_wissensdatenbank.js'));
const ANSICHTEN = path.join(WURZEL, 'apps/dashboard/themes/default/views');
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), 'utf8');
const gibtEs = (p) => fs.existsSync(path.join(WURZEL, p));

let fehler = 0, bestanden = 0;
async function pruefe(was, tun) {
    try { await tun(); bestanden++; console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 3).join('\n      ')}`); }
}

/** `tr` wie im Dashboard: Schlüssel mit Punkt, `{{name}}` wird ersetzt. Unbekanntes wirft. */
function uebersetzer(locale) {
    const texte = JSON.parse(lies(`apps/dashboard/locales/${locale}.json`));
    return (schluessel, werte = {}) => {
        const t = schluessel.split('.').reduce((o, k) => (o == null ? o : o[k]), texte);
        if (typeof t !== 'string') throw new Error(`Sprachschlüssel fehlt in ${locale}: ${schluessel}`);
        return t.replace(/\{\{(\w+)\}\}/g, (_, k) => String(werte[k] ?? ''));
    };
}

(async () => {
    // ════════════════════════════════════════════════════════════════════════
    console.log('\nEinspielen: der Bestand aus documentation/');
    const ordnerDa = gibtEs('documentation');
    const bestand = migration.leseBestand();

    await pruefe('34 Dateien hinein, 34 Artikel heraus — 27 veröffentlicht, 7 Entwurf', () => {
        // Der Ordner geht in einem eigenen Schritt, wenn der Betreiber die
        // Artikel gesehen hat. Danach ist das Einspielen Geschichte, und diese
        // Prüfung hat nichts mehr zu zählen — sie sagt das, statt rot zu bleiben.
        if (!ordnerDa) { console.log('      (documentation/ ist entfernt — nichts mehr einzuspielen)'); return; }
        const dateien = [];
        (function sammle(o) {
            for (const e of fs.readdirSync(o, { withFileTypes: true })) {
                if (e.isDirectory()) sammle(path.join(o, e.name));
                else if (e.name.endsWith('.md')) dateien.push(path.join(o, e.name));
            }
        })(path.join(WURZEL, 'documentation'));
        assert.strictEqual(dateien.length, 34, 'der Bestand hat sich geändert — die Zahlen in Migration und STAND nachziehen');
        assert.strictEqual(bestand.artikel.length, dateien.length);
        assert.strictEqual(new Set(bestand.artikel.map(a => a.quelle)).size, dateien.length, 'eine Datei kommt doppelt oder gar nicht vor');
        assert.strictEqual(bestand.artikel.filter(a => a.stand === 'published').length, 27);
        assert.deepStrictEqual(bestand.artikel.filter(a => a.stand === 'draft').map(a => a.kuerzel).sort(),
            ['clan-manager', 'economy', 'image-builder', 'leveling', 'social-alerts', 'statistik', 'voiceserver']);
        // Ein Entwurf ist nie öffentlich; was bisher jeder lesen konnte, bleibt es.
        assert.ok(bestand.artikel.every(a => (a.stand === 'draft') === (a.oeffentlich === 0)));
        assert.strictEqual(new Set(bestand.artikel.map(a => a.bereich + '/' + a.kuerzel)).size, bestand.artikel.length, 'zwei Artikel unter einer Adresse');
        assert.deepStrictEqual(bestand.bereiche.map(b => b.kuerzel), ['getting-started', 'dashboard', 'gameserver', 'plugins', 'bot', 'allgemein']);
    });

    await pruefe('Titel aus der ersten Überschrift, die danach nicht mehr im Inhalt steht; Kurztext aus dem ersten Absatz', () => {
        const z = migration.zerlege('# Daemon installieren\n\nDer **Daemon** läuft auf [deinem](x.md) Server.\n\n## Voraussetzungen\n\n- Linux\n', 'ersatz');
        assert.deepStrictEqual([z.titel, z.kurztext], ['Daemon installieren', 'Der Daemon läuft auf deinem Server.']);
        assert.ok(!/^# /m.test(z.inhalt) && z.inhalt.startsWith('Der **Daemon**'));
        assert.strictEqual(migration.zerlege('Ohne Überschrift.', 'ersatz').titel, 'ersatz');
        // Ein Aufbau (Liste, Tabelle) ist kein Kurztext.
        assert.strictEqual(migration.zerlege('# T\n\n- a\n- b\n\nErst das ist Text.', 'x').kurztext, 'Erst das ist Text.');
        if (!ordnerDa) return;
        assert.ok(bestand.artikel.every(a => a.titel && a.inhalt), 'ein Artikel ohne Titel oder Inhalt');
        const start = bestand.artikel.find(a => a.bereich === 'allgemein' && a.kuerzel === 'startseite');
        assert.ok(start && start.stand === 'published' && start.oeffentlich === 1, 'index.md ist nicht die Startseite geworden');
    });

    await pruefe('Verweise zwischen den Dateien zeigen auf die neuen Adressen — und jede gibt es', () => {
        const um = (text, ordner) => migration.schreibeVerweiseUm(text, ordner);
        assert.strictEqual(um('[a](ressourcen.md)', 'gameserver'), '[a](/kb/gameserver/ressourcen)');
        assert.strictEqual(um('[a](../plugins/tickets.md)', 'getting-started'), '[a](/kb/plugins/tickets)');
        assert.strictEqual(um('[a](gameserver/daemon-setup.md#troubleshooting)', ''), '[a](/kb/gameserver/daemon-setup#troubleshooting)');
        assert.strictEqual(um('[a](faq.md) [b](plugins/) [c](../index.md)', ''), '[a](/kb/allgemein/faq) [b](/kb/plugins) [c](../index.md)');
        // Fremdes, Anker und absolute Pfade bleiben.
        const bleibt = '[a](https://discord.com/x.md) [b](#oben) [c](/auth/login) [d](mailto:a@b.de)';
        assert.strictEqual(um(bleibt, 'gameserver'), bleibt);
        if (!ordnerDa) return;
        const ziele = new Set(bestand.artikel.map(a => a.kuerzel === 'startseite' ? '/kb' : `/kb/${a.bereich}/${a.kuerzel}`)
            .concat(bestand.bereiche.map(b => '/kb/' + b.kuerzel)));
        const verweise = bestand.artikel.flatMap(a => [...a.inhalt.matchAll(/\]\(([^)\s]+)\)/g)].map(m => m[1]));
        assert.ok(verweise.length > 50, 'kaum Verweise gefunden — die Suche misst nicht mehr');
        assert.deepStrictEqual(verweise.filter(v => /\.md(#|$)/.test(v) && !/^https?:/.test(v)), [], 'ein Verweis zeigt noch auf eine Datei');
        assert.deepStrictEqual([...new Set(verweise.filter(v => v.startsWith('/kb')).map(v => v.split('#')[0]).filter(v => !ziele.has(v)))], [],
            'ein Verweis zeigt auf eine Adresse, die es nicht gibt');
    });

    // ════════════════════════════════════════════════════════════════════════
    console.log('\nRegeln (helpers/Wissen.js)');

    await pruefe('Rendern: rohes HTML wird Text, ein Verweis mit Skript wird entschärft, Überschriften tragen eine Kennung', () => {
        const html = Wissen.rendere('## Fehler beheben\n\nText <script>alert(1)</script> und `/ban <user>`.\n\n<div onclick="x()">Block</div>\n\n[böse](javascript:alert(1)) [gut](/kb/a/b) [fremd](https://x.de)');
        assert.ok(!/<script|<div|onclick="/.test(html), 'rohes HTML kommt als HTML heraus:\n' + html);
        assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && html.includes('<code>/ban &lt;user&gt;</code>'));
        assert.ok(!html.includes('javascript:'), 'ein javascript:-Verweis bleibt klickbar');
        assert.ok(html.includes('<a href="/kb/a/b">gut</a>') && html.includes('<a href="https://x.de">fremd</a>'));
        assert.ok(html.includes('<h2 id="fehler-beheben">Fehler beheben</h2>'));
        assert.strictEqual(Wissen.rendere(null), '');
    });

    await pruefe('Sichtbarkeit: Entwurf nie; veröffentlicht für Angemeldete ganz, sonst nur „öffentlich" — der Rest mit Schloss', () => {
        const a = (status, is_public) => ({ status, is_public });
        const tafel = [
            ['draft', 0, false, 'nichts'], ['draft', 1, false, 'nichts'], ['draft', 0, true, 'nichts'], ['draft', 1, true, 'nichts'],
            ['published', 0, false, 'schloss'], ['published', 1, false, 'ganz'], ['published', 0, true, 'ganz'], ['published', 1, true, 'ganz'],
        ];
        for (const [s, p, angemeldet, soll] of tafel) assert.strictEqual(Wissen.sichtbarkeit(a(s, p), angemeldet), soll, `${s}/${p}/${angemeldet}`);
        assert.strictEqual(Wissen.sichtbarkeit(null, true), 'nichts');
        // Aus der Datenbank kommt `is_public` als Zahl — oder als Text.
        assert.strictEqual(Wissen.sichtbarkeit(a('published', '1'), false), 'ganz');
        assert.strictEqual(Wissen.sichtbarkeit(a('published', '0'), false), 'schloss');
        // Angemeldet ist, wer eine Discord-Kennung in der Sitzung hat — keine Guild nötig.
        assert.strictEqual(Wissen.istAngemeldet({ session: { user: { info: { id: '1' } } } }), true);
        assert.strictEqual(Wissen.istAngemeldet({ session: { user: {} } }), false);
        assert.strictEqual(Wissen.istAngemeldet({}), false);
    });

    await pruefe('Adressen: /docs/… findet seine neue Stelle; nach dem Login geht es nur nach /kb zurück', () => {
        const n = Wissen.neueAdresse;
        assert.deepStrictEqual(['', 'index', 'index.md', 'faq', 'faq.md', 'gameserver', 'gameserver/', 'gameserver/ressourcen.md', 'plugins/AutoMod', 'bot/index.md'].map(n),
            ['/kb', '/kb', '/kb', '/kb/allgemein/faq', '/kb/allgemein/faq', '/kb/gameserver', '/kb/gameserver', '/kb/gameserver/ressourcen', '/kb/plugins/automod', '/kb/bot']);
        // Unsinn führt zur Startseite, nicht irgendwohin.
        assert.deepStrictEqual(['../etc/passwd', 'a b/c', '%2e%2e/x', '//fremd.de/x'].map(n), ['/kb', '/kb', '/kb', '/kb/fremd.de/x'].map((z, i) => i === 3 ? '/kb' : z));
        // Migration und Modell tragen je eine Fassung der Regel — sie dürfen nicht auseinanderlaufen.
        for (const p of ['', 'faq.md', 'gameserver/ressourcen.md', 'plugins/', 'index.md', 'bot/slash-commands']) {
            assert.strictEqual(migration.neueAdresse(p), Wissen.neueAdresse(p), p);
        }
        const r = Wissen.rueckkehrZiel;
        assert.deepStrictEqual(['/kb', '/kb/gameserver', '/kb/gameserver/ressourcen', '/kb/a/b/'].map(r), ['/kb', '/kb/gameserver', '/kb/gameserver/ressourcen', '/kb/a/b/']);
        assert.deepStrictEqual(['https://fremd.de', '//fremd.de', '/kb/../admin', '/admin', '/kb/a/b/c', '/kb?x=//fremd.de', '/kbx', undefined, '/auth/server-selector'].map(r),
            [null, null, null, null, null, null, null, null, null]);
    });

    await pruefe('Sprache: gewünschte Fassung, sonst deutsch; Kürzel aus Titeln', () => {
        const u = { 'de-DE': 'Hallo', 'en-GB': 'Hello' };
        assert.deepStrictEqual(['de', 'de-DE', 'en', 'en-GB', 'en-US', '', undefined, 'fr'].map(l => Wissen.text(u, l)),
            ['Hallo', 'Hallo', 'Hello', 'Hello', 'Hello', 'Hallo', 'Hallo', 'Hallo']);
        assert.strictEqual(Wissen.text({ 'de-DE': 'Nur deutsch' }, 'en-GB'), 'Nur deutsch');
        assert.strictEqual(Wissen.text(JSON.stringify(u), 'en'), 'Hello', 'die Spalte kommt als Text aus der Datenbank');
        assert.strictEqual(Wissen.text(null, 'de'), '');
        assert.strictEqual(Wissen.kuerzelAus('  Häufige Fragen & Antworten — Übersicht! '), 'haeufige-fragen-antworten-uebersicht');
    });

    // ════════════════════════════════════════════════════════════════════════
    console.log('\nDatenbank: Migration und Modell an temporären Tabellen');

    const c = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE, dateStrings: true,
    });
    const aussen = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
    });
    const echt = async () => {
        const [t] = await aussen.query(
            `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'kb\\_%' ORDER BY TABLE_NAME`);
        const zahlen = {};
        for (const z of t) zahlen[z.TABLE_NAME] = Number((await aussen.query(`SELECT COUNT(*) AS n FROM \`${z.TABLE_NAME}\``))[0][0].n);
        const menue = {};
        for (const tab of ['frontend_menu_items', 'frontend_footer_links']) {
            const [da] = await aussen.query(`SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [tab]);
            if (da.length) menue[tab] = (await aussen.query(`SELECT id, url FROM \`${tab}\` ORDER BY id`))[0].map(z => z.id + ':' + z.url).join('|');
        }
        return JSON.stringify({ zahlen, menue });
    };
    const vorher = await echt();

    // Menü und Fußzeile: Die Migration ändert dort eine Adresse — also Kopien mit Inhalt.
    const KOPIEN = [];
    for (const tab of ['frontend_menu_items', 'frontend_footer_links']) {
        const [da] = await c.query(`SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [tab]);
        if (!da.length) continue;
        await c.query(`CREATE TEMPORARY TABLE fb_k LIKE \`${tab}\``);
        await c.query(`INSERT INTO fb_k SELECT * FROM \`${tab}\``);
        await c.query(`CREATE TEMPORARY TABLE \`${tab}\` LIKE fb_k`);
        await c.query(`INSERT INTO \`${tab}\` SELECT * FROM fb_k`);
        await c.query('DROP TEMPORARY TABLE fb_k');
        KOPIEN.push(tab);
    }
    const istKopie = async (tab) => /^CREATE TEMPORARY TABLE/.test((await c.query(`SHOW CREATE TABLE \`${tab}\``))[0][0]['Create Table']);

    let angelegt = 0;
    const geprueft = new Set();
    // `SHOW TABLES` nennt temporäre Tabellen nicht — der Wächter merkt sich seine Kopien selbst.
    const kopiert = new Set();
    // Zwei Eingriffe für die Fehlerfälle: `stoere(sql)` lässt eine Abfrage scheitern,
    // `luege(sql)` gibt an ihrer Stelle eine erfundene Antwort.
    let stoere = null, luege = null;
    const db = {
        query: async (sql, p) => {
            if (luege) { const antwort = luege(sql); if (antwort) return antwort; }
            if (stoere && stoere(sql)) throw new Error('vom Wächter gestört');
            let s = sql;
            if (/^\s*CREATE TABLE IF NOT EXISTS/.test(s)) {
                // Die Kopie entsteht nur, wenn es sie in dieser Verbindung noch nicht gibt —
                // so verhält sich auch `IF NOT EXISTS` beim zweiten Lauf.
                const name = /CREATE TABLE IF NOT EXISTS\s+(\w+)/.exec(s)[1];
                if (kopiert.has(name)) return [];
                s = s.replace(/CREATE TABLE IF NOT EXISTS/, 'CREATE TEMPORARY TABLE')
                     .replace(/,\s*CONSTRAINT[^\n]*FOREIGN KEY[^\n]*/, '');
                kopiert.add(name);
                angelegt++;
            }
            assert.ok(!/^\s*(DROP|ALTER|CREATE|TRUNCATE)\s+TABLE\b/i.test(s) || /TEMPORARY/.test(s),
                `der Wächter führt kein DDL an echten Tabellen aus: ${s.trim().slice(0, 60)}`);
            const schreibt = /^\s*(?:INSERT\s+(?:IGNORE\s+)?INTO|UPDATE|DELETE\s+FROM)\s+`?(\w+)`?/i.exec(s);
            if (schreibt && !geprueft.has(schreibt[1])) {
                assert.ok(await istKopie(schreibt[1]), `${schreibt[1]} ist in dieser Verbindung keine Kopie — abgebrochen, bevor etwas geschrieben wird`);
                geprueft.add(schreibt[1]);
            }
            return (await c.query(s, p))[0];
        },
        // Wie DBService.transaction: Der Rückruf bekommt eine VERBINDUNG, deren
        // `query` [zeilen, felder] liefert — dieselben Sicherungen wie oben.
        transaction: async (rueckruf) => {
            await c.query('START TRANSACTION');
            try {
                const ergebnis = await rueckruf({ query: async (sql, p) => [await db.query(sql, p)] });
                await c.query('COMMIT');
                return ergebnis;
            } catch (e) {
                await c.query('ROLLBACK');
                throw e;
            }
        },
    };
    const vorDemWaechter = JSON.parse(vorher).zahlen;
    const schonEcht = Object.keys(vorDemWaechter).length > 0;
    if (schonEcht) {
        // Nach dem Rollout gibt es die Tabellen wirklich. Dann laufen Migration
        // und Modell an Kopien OHNE Inhalt — eingespielt wird in leere Tabellen.
        for (const tab of ['kb_articles', 'kb_categories']) {
            await c.query(`CREATE TEMPORARY TABLE fb_k LIKE \`${tab}\``);
            await c.query(`CREATE TEMPORARY TABLE \`${tab}\` LIKE fb_k`);
            await c.query('DROP TEMPORARY TABLE fb_k');
            kopiert.add(tab);
        }
    }
    ServiceManager.register('dbService', db);

    const zahl = async (sql, p) => Number((await db.query(sql, p))[0].n);
    const erwartet = ordnerDa ? 34 : 1;

    await pruefe('scheitert das Einspielen mittendrin, bleibt nichts halb zurück', async () => {
        if (!ordnerDa) return;
        let artikelGeschrieben = 0;
        stoere = (sql) => /INSERT INTO kb_articles/.test(sql) && ++artikelGeschrieben === 20;
        await assert.rejects(migration.up(db), /vom Wächter gestört/);
        stoere = null;
        assert.strictEqual(artikelGeschrieben, 20, 'der Störer hat nicht dort gegriffen, wo er sollte');
        assert.strictEqual(await zahl('SELECT COUNT(*) AS n FROM kb_articles'), 0, 'Artikel aus dem abgebrochenen Lauf sind geblieben');
        assert.strictEqual(await zahl('SELECT COUNT(*) AS n FROM kb_categories'), 0, 'Bereiche aus dem abgebrochenen Lauf sind geblieben');
    });

    await pruefe('die Migration legt beide Tabellen an und spielt den Bestand ein — nachgezählt', async () => {
        await migration.up(db);
        if (!schonEcht) assert.strictEqual(angelegt, 2);
        assert.strictEqual(await zahl('SELECT COUNT(*) AS n FROM kb_articles'), erwartet);
        assert.strictEqual(await zahl('SELECT COUNT(*) AS n FROM kb_categories'), ordnerDa ? 6 : 1);
        if (ordnerDa) {
            assert.strictEqual(await zahl(`SELECT COUNT(*) AS n FROM kb_articles WHERE status = 'published' AND is_public = 1`), 27);
            assert.strictEqual(await zahl(`SELECT COUNT(*) AS n FROM kb_articles WHERE status = 'draft' AND is_public = 0`), 7);
            const [g] = await db.query(`SELECT plugin, JSON_VALID(title_translations) AS j FROM kb_categories WHERE slug = 'gameserver'`);
            assert.deepStrictEqual([g.plugin, Number(g.j)], ['gameserver', 1]);
        }
        // Menü und Fußzeile zeigen danach auf /kb — in den Kopien.
        for (const tab of KOPIEN) {
            assert.strictEqual(await zahl(`SELECT COUNT(*) AS n FROM \`${tab}\` WHERE url IN ('/docs', '/docs/')`), 0, tab);
        }
    });

    await pruefe('ein zweiter Lauf spielt nichts doppelt ein', async () => {
        await migration.up(db);
        assert.strictEqual(await zahl('SELECT COUNT(*) AS n FROM kb_articles'), erwartet);
    });

    await pruefe('zwei Starts zugleich (Bot und Dashboard): der zweite scheitert am Kürzel und löscht nichts', async () => {
        // Nachgestellt: Der zweite Prozess hat „leer" gelesen, BEVOR der erste
        // fertig war — hier sagt die Leerprüfung deshalb einmal die Unwahrheit.
        let gelogen = 0;
        luege = (sql) => (/COUNT\(\*\) FROM kb_categories\) \+/.test(sql) && ++gelogen === 1 ? [{ n: 0 }] : null);
        await migration.up(db);
        luege = null;
        assert.strictEqual(gelogen, 1, 'die Leerprüfung der Migration sieht anders aus — der Wächter stellt den Fall nicht mehr nach');
        assert.strictEqual(await zahl('SELECT COUNT(*) AS n FROM kb_articles'), erwartet, 'der zweite Lauf hat den Bestand des ersten angefasst');
        assert.strictEqual(await zahl('SELECT COUNT(*) AS n FROM kb_categories'), ordnerDa ? 6 : 1);
    });

    await pruefe('Lesen: Bereiche in ihrer Reihenfolge, die Startseite steht in keiner Liste', async () => {
        if (!ordnerDa) return;
        const b = await Wissen.bereiche('de-DE');
        assert.deepStrictEqual(b.map(x => [x.kuerzel, x.artikel]),
            [['getting-started', 3], ['dashboard', 4], ['gameserver', 8], ['plugins', 9], ['bot', 1], ['allgemein', 1]],
            'gezählt werden nur veröffentlichte Artikel, und die Startseite nicht');
        assert.strictEqual((await Wissen.bereiche('en-GB')).find(x => x.kuerzel === 'gameserver').titel, 'Game servers');
        const allgemein = await Wissen.bereich('allgemein', 'de');
        assert.deepStrictEqual((await Wissen.artikelImBereich(allgemein.id, 'de', false)).map(a => a.kuerzel), ['faq']);
        const start = await Wissen.artikel('allgemein', 'startseite', 'de');
        assert.strictEqual(start.istStartseite, true);
        assert.strictEqual(await Wissen.bereich('gibt-es-nicht', 'de'), null);
        assert.strictEqual(await Wissen.bereich("x' OR '1'='1", 'de'), null);
        assert.strictEqual(await Wissen.artikel('gameserver', '../x', 'de'), null);
        // Englisch gibt es im Bestand nicht — die englische Seite zeigt den deutschen Text.
        assert.strictEqual((await Wissen.artikel('gameserver', 'daemon-setup', 'en-GB')).titel, 'Daemon installieren');
    });

    await pruefe('Suche: Groß und Klein egal, nur Veröffentlichtes, Platzhalter sind Text', async () => {
        if (!ordnerDa) return;
        const klein = await Wissen.suche('daemon', 'de', false);
        const gross = await Wissen.suche('DAEMON', 'de', false);
        assert.ok(klein.length >= 3 && klein.length === gross.length, `daemon: ${klein.length}, DAEMON: ${gross.length}`);
        assert.ok(klein.every(a => a.stand === 'published'));
        // „Economy" steht in einem Entwurf im Titel — der Entwurf selbst ist kein Treffer.
        assert.ok(!(await Wissen.suche('economy', 'de', true)).some(a => a.kuerzel === 'economy'));
        assert.deepStrictEqual(await Wissen.suche('%', 'de', false), [], 'ein einzelnes Zeichen sucht nicht');
        assert.deepStrictEqual(await Wissen.suche('%%', 'de', false), [], '% ist ein Zeichen, kein Platzhalter');
        assert.deepStrictEqual(await Wissen.suche('gibtesgarantiertnicht', 'de', false), []);
    });

    let neuerBereich = null, neuerArtikel = null;
    await pruefe('Verwaltung: anlegen, ändern, und was abgewiesen wird — mit einem Satz', async () => {
        const wirft = (versprechen, muster) => assert.rejects(versprechen, (e) => {
            assert.ok(e instanceof Wissen.Eingabefehler, 'kein Eingabefehler: ' + e.message);
            assert.match(e.message, muster);
            return true;
        });
        await wirft(Wissen.bereichSpeichern({ title_de: '' }), /Titel fehlt/);
        await wirft(Wissen.bereichSpeichern({ title_de: 'Suche' }), /„suche" ist schon eine Adresse/);
        await wirft(Wissen.bereichSpeichern({ title_de: 'X', slug: 'Mit Leerzeichen' }), /Kürzel für die Adresse/);
        neuerBereich = await Wissen.bereichSpeichern({ title_de: 'Prüf Bereich', title_en: 'Test area', description_de: 'Nur für den Wächter', icon: 'bi-bug', sort_order: '5' });
        assert.ok(Number.isInteger(neuerBereich) && neuerBereich > 0, 'das Anlegen liefert keine Kennung');
        const roh = await Wissen.bereichRoh(neuerBereich);
        assert.deepStrictEqual([roh.slug, roh.title_translations['en-GB'], roh.sort_order], ['pruef-bereich', 'Test area', 5]);
        await wirft(Wissen.bereichSpeichern({ title_de: 'Zweiter', slug: 'pruef-bereich' }), /gibt es schon/);

        await wirft(Wissen.artikelSpeichern({ category_id: neuerBereich, title_de: 'T' }), /Inhalt fehlt/);
        await wirft(Wissen.artikelSpeichern({ category_id: 999999, title_de: 'T', content_de: 'x' }), /Bereich gibt es nicht/);
        neuerArtikel = await Wissen.artikelSpeichern(
            { category_id: neuerBereich, title_de: 'Geheimer Trick', excerpt_de: 'Kurz gesagt.', content_de: 'Der eigentliche GEHEIMTEXT.' }, 'Wächter');
        let a = await Wissen.artikelRoh(neuerArtikel);
        // Vorgabe für Neues: Entwurf, nur angemeldet.
        assert.deepStrictEqual([a.slug, a.status, Number(a.is_public), a.author], ['geheimer-trick', 'draft', 0, 'Wächter']);
        assert.ok(!('en-GB' in a.content_translations), 'leeres Englisch wurde als Fassung gespeichert');
        await wirft(Wissen.artikelSpeichern({ category_id: neuerBereich, title_de: 'Geheimer Trick', content_de: 'x' }), /gibt es das Kürzel „geheimer-trick" schon/);

        await Wissen.artikelSpeichern({ id: neuerArtikel, category_id: neuerBereich, slug: 'geheimer-trick', title_de: 'Geheimer Trick',
            excerpt_de: 'Kurz gesagt.', content_de: 'Der eigentliche GEHEIMTEXT.', content_en: 'The actual text.', status: 'published', is_public: '0' });
        a = await Wissen.artikelRoh(neuerArtikel);
        assert.deepStrictEqual([a.status, Number(a.is_public), a.content_translations['en-GB'], a.author], ['published', 0, 'The actual text.', 'Wächter']);

        // Die Startseite: Text ja, alles andere nein.
        const start = await Wissen.artikel('allgemein', 'startseite', 'de');
        const f = { id: start.id, category_id: start.bereichId, slug: 'startseite', title_de: 'Neu', content_de: 'Neuer Text', status: 'published', is_public: '1' };
        await wirft(Wissen.artikelSpeichern({ ...f, status: 'draft' }), /Startseite von \/kb/);
        await wirft(Wissen.artikelSpeichern({ ...f, slug: 'anders' }), /Startseite von \/kb/);
        await wirft(Wissen.artikelSpeichern({ ...f, is_public: '0' }), /Startseite von \/kb/);
        await wirft(Wissen.artikelSpeichern({ ...f, category_id: neuerBereich }), /Startseite von \/kb/);
        await wirft(Wissen.artikelEntfernen(start.id), /nicht entfernen/);
        await Wissen.artikelSpeichern(f);
        assert.strictEqual((await Wissen.artikel('allgemein', 'startseite', 'de')).titel, 'Neu');
        const allgemein = await Wissen.bereich('allgemein', 'de');
        await wirft(Wissen.bereichSpeichern({ id: allgemein.id, title_de: 'Allgemein', slug: 'sonstiges' }), /sein Kürzel bleibt/);
        // Ein Bereich mit Artikeln lässt sich nicht entfernen.
        await wirft(Wissen.bereichEntfernen(neuerBereich), /liegen noch 1 Artikel/);
    });

    await pruefe('Folgemigration: der Verweis auf dunebot.de/invite wird zu /invite — sonst ändert sich nichts', async () => {
        const einladung = require(path.join(WURZEL, 'migrations/kern/20261012_100000_einladung_im_artikel.js'));
        const inhalt = (id) => db.query('SELECT content_translations AS c FROM kb_articles WHERE id = ?', [id]).then(z => JSON.parse(z[0].c));
        const mit = await Wissen.artikelSpeichern({ category_id: neuerBereich, title_de: 'Einladen',
            content_de: 'Vorher.\n\n> **[FireBot einladen](https://dunebot.de/invite)**\n\nNachher mit [Dashboard](https://dashboard.dunebot.de).',
            content_en: '[Invite](https://dunebot.de/invite)' });
        const ohne = await Wissen.artikelSpeichern({ category_id: neuerBereich, title_de: 'Unbeteiligt', content_de: 'Geh auf /invite oder lies [hier](/kb).' });
        const unbeteiligtVorher = JSON.stringify(await inhalt(ohne));
        await einladung.up(db);
        const nach = await inhalt(mit);
        assert.strictEqual(nach['de-DE'], 'Vorher.\n\n> **[FireBot einladen](/invite)**\n\nNachher mit [Dashboard](https://dashboard.dunebot.de).');
        assert.strictEqual(nach['en-GB'], '[Invite](/invite)', 'die englische Fassung wurde nicht mitgezogen');
        assert.strictEqual(JSON.stringify(await inhalt(ohne)), unbeteiligtVorher, 'ein Artikel ohne den Verweis wurde angefasst');
        if (ordnerDa) {
            const echt = await Wissen.artikel('getting-started', 'bot-einladen', 'de');
            assert.ok(echt.inhalt.includes('](/invite)') && !echt.inhalt.includes('dunebot.de/invite'), 'der Artikel aus dem Bestand trägt den alten Verweis noch');
        }
        // Zweiter Lauf: nichts mehr zu tun, nichts kaputt.
        await einladung.up(db);
        assert.strictEqual((await inhalt(mit))['de-DE'], nach['de-DE']);
        // Der gerenderte Verweis ist ein gewöhnlicher Verweis auf die eigene Seite.
        assert.ok(Wissen.rendere(nach['de-DE']).includes('<a href="/invite">FireBot einladen</a>'));
        await Wissen.artikelEntfernen(mit);
        await Wissen.artikelEntfernen(ohne);
    });

    await pruefe('Folgemigration: „Bot einladen" bekommt den Weg über das Dashboard — aber nur über den unveränderten Text', async () => {
        if (!ordnerDa) { console.log('      (documentation/ ist entfernt — der eingespielte Artikel lässt sich hier nicht mehr nachstellen)'); return; }
        const zweiWege = require(path.join(WURZEL, 'migrations/kern/20261012_110000_bot_einladen_zwei_wege.js'));
        const artikelJetzt = async () => (await Wissen.artikel('getting-started', 'bot-einladen', 'de'));
        const vorher = await artikelJetzt();
        // Der Fingerabdruck in der Migration ist der des Textes, den das Einspielen plus die Verweis-Migration erzeugt.
        assert.strictEqual(zweiWege.fingerabdruck(vorher.inhalt), zweiWege.VORHER, 'der Fingerabdruck passt nicht zum eingespielten Text — die Migration täte in der Produktion nichts');
        await zweiWege.up(db);
        const nach = await artikelJetzt();
        assert.strictEqual(nach.inhalt, zweiWege.NEU);
        // Was der Betreiber verlangt hat, steht drin — und jeder Verweis im neuen Text hat ein Ziel.
        for (const stueck of ['## Weg 1: Über das Dashboard', '**Bot nicht in Guild**', '**Bot hinzufügen**', '**Server verwalten**', '[FireBot einladen](/invite)']) {
            assert.ok(nach.inhalt.includes(stueck), 'fehlt im neuen Text: ' + stueck);
        }
        const html = Wissen.rendere(nach.inhalt);
        assert.ok(html.includes('<h2 id="bei-discord-bestaetigen">') && html.includes('<a href="#bei-discord-bestaetigen">'), 'der Sprung zum Abschnitt „Bei Discord bestätigen" trifft nicht');
        for (const ziel of ['/kb/dashboard/uebersicht', '/kb/getting-started/erste-schritte']) {
            const [b, a] = ziel.split('/').slice(2);
            assert.strictEqual(Wissen.sichtbarkeit(await Wissen.artikel(b, a, 'de'), false), 'ganz', ziel);
        }
        // Die Beschriftungen im Text sind die der Serverauswahl.
        const texte = JSON.parse(lies('apps/dashboard/locales/de-DE.json')).SELECTOR;
        assert.deepStrictEqual([texte.BTN_INVITE, texte.BOT_NOT_IN_GUILD], ['Bot hinzufügen', 'Bot nicht in Guild']);
        // Zweiter Lauf ändert nichts; eine Fassung des Betreibers bleibt stehen.
        await zweiWege.up(db);
        assert.strictEqual((await artikelJetzt()).inhalt, zweiWege.NEU);
        await db.query('UPDATE kb_articles SET content_translations = ? WHERE id = ?', [JSON.stringify({ 'de-DE': 'Meine eigene Fassung.', 'en-GB': 'Mine.' }), nach.id]);
        await zweiWege.up(db);
        const eigen = await Wissen.artikelRoh(nach.id);
        assert.deepStrictEqual(eigen.content_translations, { 'de-DE': 'Meine eigene Fassung.', 'en-GB': 'Mine.' }, 'eine vom Betreiber geänderte Fassung wurde überschrieben');
    });

    await pruefe('Folgemigration: dashboard.dunebot.de wird zu /guild, die Serverauswahl stimmt — nur diese Sätze ändern sich', async () => {
        const adresse = require(path.join(WURZEL, 'migrations/kern/20261012_120000_dashboard_adresse_in_artikeln.js'));
        const roh = (id) => db.query('SELECT content_translations AS c FROM kb_articles WHERE id = ?', [id]).then(z => JSON.parse(z[0].c));
        // Ein Artikel, in dem der Betreiber den Satz um den Verweis schon umgeschrieben hat: Dort greift nur das Netz.
        const eigen = await Wissen.artikelSpeichern({ category_id: neuerBereich, title_de: 'Eigener Satz',
            content_de: 'Mein Text.\n\nSchau ins **[dashboard.dunebot.de](https://dashboard.dunebot.de)**, lohnt sich.\n\nEnde.' });
        const fremd = await Wissen.artikelSpeichern({ category_id: neuerBereich, title_de: 'Ohne Bezug', content_de: 'Hier steht nichts davon. [Dashboard](/guild)' });
        const fremdVorher = JSON.stringify(await roh(fremd));
        await adresse.up(db);
        assert.strictEqual((await roh(eigen))['de-DE'], 'Mein Text.\n\nSchau ins **[firenetworks.de/guild](/guild)**, lohnt sich.\n\nEnde.');
        assert.strictEqual(JSON.stringify(await roh(fremd)), fremdVorher, 'ein Artikel ohne den Verweis wurde angefasst');

        // Die Beschriftungen im neuen Text sind die der Seiten, die er beschreibt.
        const de = JSON.parse(lies('apps/dashboard/locales/de-DE.json'));
        const neuerText = adresse.ERSETZUNGEN.map(e => e[1]).join('\n');
        for (const wort of [de.AUTH.LOGIN_BUTTON, de.SELECTOR.BTN_MANAGE, de.SELECTOR.BTN_INVITE, de.SELECTOR.BOT_NOT_IN_GUILD]) {
            assert.ok(neuerText.includes(`**${wort}**`), `„${wort}" steht nicht im neuen Text — heißt der Knopf inzwischen anders?`);
        }
        // Und /guild ist wirklich die Adresse, hinter der Anmeldung und Serverauswahl liegen.
        assert.match(ohneKommentare(lies('apps/dashboard/app.js')), /\.register\('\/guild', this\.routers\.guild/);

        if (ordnerDa) {
            const erste = await Wissen.artikel('getting-started', 'erste-schritte', 'de');
            assert.ok(erste.inhalt.includes('**[firenetworks.de/guild](/guild)**\n2. Klicke auf **Mit Discord fortfahren**'), 'Schritt 1 und 2 unter „Dashboard öffnen" stehen nicht da');
            assert.ok(erste.inhalt.includes('Steht dort **Bot nicht in Guild**') && !erste.inhalt.includes('eine Übersicht aller Server, auf denen FireBot aktiv ist'));
            // Der Sprung aus „Bot einladen" trifft diese Überschrift.
            assert.ok(Wissen.rendere(erste.inhalt).includes('<h2 id="dashboard-oeffnen">Dashboard öffnen</h2>'));
            const zweiWege = require(path.join(WURZEL, 'migrations/kern/20261012_110000_bot_einladen_zwei_wege.js'));
            assert.ok(zweiWege.NEU.includes('(/kb/getting-started/erste-schritte#dashboard-oeffnen)'));
            const uebersicht = await Wissen.artikel('dashboard', 'uebersicht', 'de');
            assert.ok(uebersicht.inhalt.includes('direkt über **[firenetworks.de/guild](/guild)**'));
            // Der Rest der Artikel ist unberührt: genau so lang wie vorher plus der Unterschied der getauschten Sätze.
            const bestandErste = bestand.artikel.find(a => a.bereich === 'getting-started' && a.kuerzel === 'erste-schritte').inhalt;
            assert.strictEqual(erste.inhalt, adresse.ersetze(bestandErste));
        }
        // Nach allen drei Folgemigrationen nennt kein Artikel mehr die alte Domain.
        assert.strictEqual(await zahl(`SELECT COUNT(*) AS n FROM kb_articles WHERE LOWER(CONVERT(content_translations USING utf8mb4)) LIKE '%dunebot%'`), 0);
        // Zweiter Lauf: nichts mehr zu tun.
        const vorDemZweiten = JSON.stringify(await roh(eigen));
        await adresse.up(db);
        assert.strictEqual(JSON.stringify(await roh(eigen)), vorDemZweiten);
        await Wissen.artikelEntfernen(eigen);
        await Wissen.artikelEntfernen(fremd);
    });

    await pruefe('Verweise ziehen mit: Artikel umbenannt, Artikel verschoben, Bereich umbenannt', async () => {
        const roh = (id) => db.query('SELECT content_translations AS c FROM kb_articles WHERE id = ?', [id]).then(z => JSON.parse(z[0].c));
        const zweiter = await Wissen.bereichSpeichern({ title_de: 'Zweiter Prüfbereich', slug: 'pruef-zwei' });
        const ziel = await Wissen.artikelSpeichern({ category_id: neuerBereich, title_de: 'Ziel', slug: 'ziel', content_de: 'Ich bin das Ziel. Siehe auch [mich selbst](/kb/pruef-bereich/ziel#oben).' });
        const aehnlich = await Wissen.artikelSpeichern({ category_id: neuerBereich, title_de: 'Ziel neu', slug: 'ziel-neu', content_de: 'Ein anderer Artikel.' });
        const quelle = await Wissen.artikelSpeichern({ category_id: zweiter, title_de: 'Quelle', slug: 'quelle',
            content_de: 'Geh zu [Ziel](/kb/pruef-bereich/ziel), zum [Abschnitt](/kb/pruef-bereich/ziel#abschnitt), zum [ähnlichen](/kb/pruef-bereich/ziel-neu) und in den [Bereich](/kb/pruef-bereich). Kein Verweis: /kb/pruef-bereich/ziel',
            content_en: 'See [target](/kb/pruef-bereich/ziel).' });
        const speichern = (id, f, bericht) => Wissen.artikelRoh(id).then(a => Wissen.artikelSpeichern({
            id, category_id: a.category_id, slug: a.slug, title_de: a.title_translations['de-DE'],
            content_de: a.content_translations['de-DE'], content_en: a.content_translations['en-GB'] || '', status: a.status, ...f }, null, bericht));

        // Speichern ohne Adresswechsel fasst nichts an und meldet nichts.
        let bericht = {};
        await speichern(ziel, {}, bericht);
        assert.strictEqual(bericht.verweise, undefined);

        // 1. Umbenennen
        bericht = {};
        await speichern(ziel, { slug: 'ziel-umbenannt' }, bericht);
        assert.deepStrictEqual(bericht.verweise, { artikel: 2, stellen: 4, von: '/kb/pruef-bereich/ziel', nach: '/kb/pruef-bereich/ziel-umbenannt' });
        let q = await roh(quelle);
        assert.strictEqual(q['de-DE'], 'Geh zu [Ziel](/kb/pruef-bereich/ziel-umbenannt), zum [Abschnitt](/kb/pruef-bereich/ziel-umbenannt#abschnitt), zum [ähnlichen](/kb/pruef-bereich/ziel-neu) und in den [Bereich](/kb/pruef-bereich). Kein Verweis: /kb/pruef-bereich/ziel');
        assert.strictEqual(q['en-GB'], 'See [target](/kb/pruef-bereich/ziel-umbenannt).', 'die englische Fassung wurde nicht mitgezogen');
        assert.ok((await roh(ziel))['de-DE'].includes('(/kb/pruef-bereich/ziel-umbenannt#oben)'), 'der Verweis des Artikels auf sich selbst zeigt noch auf die alte Adresse');
        assert.strictEqual((await roh(aehnlich))['de-DE'], 'Ein anderer Artikel.');

        // 2. In einen anderen Bereich verschieben — der Fall des Betreibers.
        bericht = {};
        await speichern(ziel, { category_id: zweiter }, bericht);
        assert.strictEqual(bericht.verweise.nach, '/kb/pruef-zwei/ziel-umbenannt');
        q = await roh(quelle);
        assert.ok(q['de-DE'].includes('[Ziel](/kb/pruef-zwei/ziel-umbenannt), zum [Abschnitt](/kb/pruef-zwei/ziel-umbenannt#abschnitt)'));
        assert.ok(q['de-DE'].includes('[Bereich](/kb/pruef-bereich)'), 'der Verweis auf den alten BEREICH wurde mitgerissen');
        // Und der Verweis trifft wirklich: Unter der neuen Adresse liegt der Artikel.
        assert.strictEqual((await Wissen.artikel('pruef-zwei', 'ziel-umbenannt', 'de')).id, ziel);

        // 3. Bereich umbenennen: alle Adressen darunter und der Bereich selbst.
        bericht = {};
        await Wissen.bereichSpeichern({ id: zweiter, title_de: 'Zweiter Prüfbereich', slug: 'pruef-drei' }, bericht);
        assert.ok(bericht.verweise.stellen >= 4, JSON.stringify(bericht));
        q = await roh(quelle);
        assert.ok(q['de-DE'].includes('(/kb/pruef-drei/ziel-umbenannt)') && q['en-GB'] === 'See [target](/kb/pruef-drei/ziel-umbenannt).');
        assert.strictEqual(await zahl(`SELECT COUNT(*) AS n FROM kb_articles WHERE content_translations LIKE '%](/kb/pruef-zwei%'`), 0);

        // 4. Scheitert das Mitziehen, ist auch der Artikel nicht verschoben.
        stoere = (sql) => /UPDATE kb_articles SET content_translations = \?/.test(sql);
        await assert.rejects(speichern(ziel, { slug: 'ziel-halb' }), /vom Wächter gestört/);
        stoere = null;
        assert.strictEqual((await Wissen.artikelRoh(ziel)).slug, 'ziel-umbenannt', 'der Artikel ist umbenannt, obwohl das Mitziehen scheiterte');
        assert.ok((await roh(quelle))['de-DE'].includes('(/kb/pruef-drei/ziel-umbenannt)'));

        // Der Satz für den Menschen.
        const router = ohneKommentare(lies('apps/dashboard/routes/admin/kb.router.js'));
        assert.match(router, /artikelSpeichern\(req\.body \|\| \{\}, autor, bericht\)[\s\S]{0,260}zuVerweisen\(bericht\)/);
        assert.match(router, /bereichSpeichern\(req\.body \|\| \{\}, bericht\)[\s\S]{0,120}zuVerweisen\(bericht\)/);

        for (const id of [quelle, ziel, aehnlich]) await Wissen.artikelEntfernen(id);
        await Wissen.bereichEntfernen(zweiter);
    });

    // ════════════════════════════════════════════════════════════════════════
    console.log('\nSeiten: der echte Router, die echte Ansicht');

    const fehlerseite = async (res, status) => { res.status(status).send('FEHLERSEITE ' + status); };
    ServiceManager.register('themeManager', {
        getLayout: () => 'frontend',
        // Die Attrappe ersetzt nur das Layout drumherum: Sie zeichnet die echte Ansicht.
        async renderView(res, ansicht, daten) {
            const html = await ejs.renderFile(path.join(ANSICHTEN, ansicht + '.ejs'), { ...res.locals, ...daten });
            res.send(html);
        },
    });
    const app = express();
    app.use((req, res, next) => {
        const sprache = req.headers['x-sprache'] || 'de-DE';
        res.locals.locale = sprache;
        res.locals.tr = uebersetzer(sprache);
        req.session = req.headers['x-angemeldet'] ? { user: { info: { id: '42' } } } : {};
        next();
    });
    const wissen = require(path.join(WURZEL, 'apps/dashboard/routes/kb.router'))({ fehlerseite });
    app.use('/kb', wissen.kb);
    app.use('/docs', wissen.alt);
    const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    const hole = (weg, kopf = {}) => new Promise((ja, nein) => {
        http.get({ host: '127.0.0.1', port: server.address().port, path: weg, headers: kopf }, (antwort) => {
            let text = '';
            antwort.on('data', d => { text += d; });
            antwort.on('end', () => ja({ status: antwort.statusCode, ort: antwort.headers.location, text }));
        }).on('error', nein);
    });
    const AN = { 'x-angemeldet': '1' };

    await pruefe('Startseite, Bereich, Artikel: gezeichnet aus der Datenbank, mit Kacheln und Seitenleiste', async () => {
        if (!ordnerDa) return;
        const start = await hole('/kb');
        assert.strictEqual(start.status, 200, start.text.slice(0, 200));
        assert.strictEqual((start.text.match(/class="kb-kachel"/g) || []).length, 7, 'je Bereich eine Kachel (sechs aus dem Bestand, einer vom Wächter)');
        assert.match(start.text, /<a class="kb-kachel" href="\/kb\/gameserver">[\s\S]{0,200}Gameserver[\s\S]{0,300}8 Artikel/);
        assert.match(start.text, /<form action="\/kb\/suche" method="get"/);
        const bereich = await hole('/kb/gameserver');
        assert.strictEqual(bereich.status, 200);
        // Die Artikel eines Bereichs stehen als Kacheln da, wie die Bereiche auf der Startseite (2026-10-12).
        assert.strictEqual((bereich.text.match(/class="kb-kachel kb-kachel-artikel"/g) || []).length, 8);
        assert.ok(!bereich.text.includes('class="kb-eintrag"'), 'der Bereich zeigt seine Artikel noch als Zeilen');
        assert.match(bereich.text, /href="\/kb\/gameserver\/daemon-setup"/);
        const artikel = await hole('/kb/gameserver/daemon-setup');
        assert.strictEqual(artikel.status, 200);
        assert.match(artikel.text, /<h1 class="kb-titel">Daemon installieren<\/h1>/);
        assert.match(artikel.text, /<h2 id="voraussetzungen">Voraussetzungen<\/h2>/);
        // Englische Seite: Rahmen englisch, Text deutsch (es gibt keine englische Fassung).
        const en = await hole('/kb/gameserver/daemon-setup', { 'x-sprache': 'en-GB' });
        assert.ok(en.text.includes('Knowledge base') && en.text.includes('Daemon installieren') && en.text.includes('Back to Game servers'));
        assert.strictEqual((await hole('/kb/gibt-es-nicht')).status, 404);
        assert.strictEqual((await hole('/kb/gameserver/gibt-es-nicht')).status, 404);
        // Die Startseite hat EINE Adresse.
        const doppelt = await hole('/kb/allgemein/startseite');
        assert.deepStrictEqual([doppelt.status, doppelt.ort], [301, '/kb']);
    });

    await pruefe('Schloss: ohne Anmeldung Titel und Kurztext — der Inhalt steht nicht in der Seite', async () => {
        const gast = await hole('/kb/pruef-bereich/geheimer-trick');
        assert.strictEqual(gast.status, 200);
        assert.ok(gast.text.includes('Geheimer Trick') && gast.text.includes('Kurz gesagt.'));
        assert.ok(!gast.text.includes('GEHEIMTEXT'), 'der Inhalt eines Artikels mit Schloss steht im Quelltext der Seite');
        assert.match(gast.text, /class="kb-schloss"/);
        assert.match(gast.text, /href="\/auth\/login\?redirect=%2Fkb%2Fpruef-bereich%2Fgeheimer-trick"/);
        // In der Liste des Bereichs und in der Suche: mit Schloss, ohne Inhalt.
        const liste = await hole('/kb/pruef-bereich');
        assert.ok(liste.text.includes('bi-lock-fill') && !liste.text.includes('GEHEIMTEXT'));
        // Die Kachel eines Artikels mit Schloss sagt es in Worten, nicht nur mit dem Symbol.
        assert.match(liste.text, /class="kb-kachel kb-kachel-artikel" href="\/kb\/pruef-bereich\/geheimer-trick">[\s\S]{0,400}Nur für angemeldete Nutzer/);
        // Suchtreffer bleiben eine Liste.
        const suche = await hole('/kb/suche?q=geheimtext');
        assert.ok((await hole('/kb/suche?q=geheimtext')).text.includes('class="kb-eintrag"'));
        assert.ok(suche.text.includes('Geheimer Trick') && !suche.text.includes('Der eigentliche'), 'die Suche verrät den Inhalt');
        // Angemeldet: ganz, ohne Schloss.
        const an = await hole('/kb/pruef-bereich/geheimer-trick', AN);
        assert.ok(an.text.includes('GEHEIMTEXT') && !an.text.includes('class="kb-schloss"'));
        // Die Adresse, die der Knopf mitgibt, lässt der Login auch wieder zu.
        assert.strictEqual(Wissen.rueckkehrZiel('/kb/pruef-bereich/geheimer-trick'), '/kb/pruef-bereich/geheimer-trick');
    });

    await pruefe('Entwurf: außen nicht da — auch nicht für Angemeldete, nicht in Liste und Suche', async () => {
        if (!ordnerDa) return;
        assert.strictEqual((await hole('/kb/plugins/economy')).status, 404);
        assert.strictEqual((await hole('/kb/plugins/economy', AN)).status, 404);
        const liste = await hole('/kb/plugins', AN);
        assert.ok(!liste.text.includes('/kb/plugins/economy"') && liste.text.includes('/kb/plugins/automod"'));
    });

    await pruefe('eine Eingabe in der Suche kommt als Text zurück', async () => {
        const s = await hole('/kb/suche?q=' + encodeURIComponent('"><script>alert(1)</script>'));
        assert.strictEqual(s.status, 200);
        assert.ok(!s.text.includes('<script>alert(1)'), 'der Suchbegriff landet als HTML in der Seite');
    });

    await pruefe('/docs und /docs/… leiten dauerhaft auf die neue Stelle', async () => {
        for (const [alt, neu] of [['/docs', '/kb'], ['/docs/', '/kb'], ['/docs/faq', '/kb/allgemein/faq'],
            ['/docs/gameserver/ressourcen.md', '/kb/gameserver/ressourcen'], ['/docs/bot', '/kb/bot'], ['/docs/plugins/automod', '/kb/plugins/automod']]) {
            const a = await hole(alt);
            assert.deepStrictEqual([a.status, a.ort], [301, neu], alt);
        }
        if (!ordnerDa) return;
        // Und dort ist auch etwas — jede alte Adresse eines veröffentlichten Artikels.
        for (const a of bestand.artikel.filter(x => x.stand === 'published')) {
            const um = await hole('/docs/' + a.quelle);
            const ziel = await hole(um.ort);
            assert.strictEqual(ziel.status, 200, `/docs/${a.quelle} → ${um.ort} → ${ziel.status}`);
        }
    });

    await pruefe('Verwaltung: Übersicht und Formulare zeichnen sich; die Startseite ist nicht löschbar', async () => {
        const zeichne = (ansicht, daten) => ejs.renderFile(path.join(ANSICHTEN, ansicht + '.ejs'), daten);
        const alle = await Wissen.allesFuerVerwaltung();
        const uebersicht = await zeichne('admin/kb/index', { bereiche: alle, start: Wissen.START });
        assert.strictEqual((uebersicht.match(/href="\/admin\/kb\/artikel\/\d+"><strong>/g) || []).length, erwartet + 1, 'nicht jeder Artikel steht in der Übersicht');
        if (ordnerDa) {
            assert.strictEqual((uebersicht.match(/>Entwurf<\/span>/g) || []).length, 7);
            assert.match(uebersicht, /Startseite von \/kb<\/span>/);
        }
        const start = await Wissen.artikel('allgemein', 'startseite', 'de');
        assert.ok(!new RegExp(`data-kb-entfernen="artikel" data-id="${start.id}"`).test(uebersicht), 'die Startseite hat einen Entfernen-Knopf');
        assert.ok(new RegExp(`data-kb-entfernen="artikel" data-id="${neuerArtikel}" data-soll="geheimer-trick"`).test(uebersicht));
        // Entfernen eines Bereichs wird nur angeboten, wenn er leer ist.
        assert.ok(!new RegExp(`data-kb-entfernen="bereich" data-id="${neuerBereich}"`).test(uebersicht));

        const wahl = alle.map(b => ({ id: b.id, kuerzel: b.kuerzel, titel: b.titel }));
        const formStart = await zeichne('admin/kb/artikel', { artikel: await Wissen.artikelRoh(start.id), bereiche: wahl, vorgabeBereich: start.bereichId });
        // Gesperrte Felder werden nicht mitgeschickt — ihr Wert reist versteckt mit.
        for (const name of ['category_id', 'status', 'is_public']) assert.match(formStart, new RegExp(`<input type="hidden" name="${name}"`), name);
        assert.match(formStart, /name="slug"[^>]*value="startseite"[^>]*readonly/);
        const formNeu = await zeichne('admin/kb/artikel', { artikel: null, bereiche: wahl, vorgabeBereich: neuerBereich });
        assert.match(formNeu, new RegExp(`<option value="${neuerBereich}" selected>`));
        assert.match(formNeu, /<option value="draft" selected>Entwurf<\/option>/);
        assert.ok(!/name=is_public value="1" checked/.test(formNeu), 'ein neuer Artikel ist als öffentlich vorbelegt');
        const formBereich = await zeichne('admin/kb/bereich', { bereich: await Wissen.bereichRoh(neuerBereich), start: Wissen.START });
        assert.match(formBereich, /name="title_en"[^>]*value="Test area"/);
    });

    await pruefe('Entfernen: erst der Artikel, dann der leere Bereich', async () => {
        await Wissen.artikelEntfernen(neuerArtikel);
        assert.strictEqual((await hole('/kb/pruef-bereich/geheimer-trick', AN)).status, 404);
        await Wissen.bereichEntfernen(neuerBereich);
        assert.strictEqual((await hole('/kb/pruef-bereich')).status, 404);
    });

    server.close();

    await pruefe('der Wächter hat an den echten Tabellen nichts geändert', async () => {
        assert.strictEqual(await echt(), vorher);
    });
    await c.end();
    await aussen.end();

    // ════════════════════════════════════════════════════════════════════════
    console.log('\nVerdrahtung: ein Weg, nicht zwei');

    await pruefe('der Datei-Editor und die alte Ansicht sind weg, nichts liest mehr aus documentation/', () => {
        for (const weg of ['apps/dashboard/routes/admin/docs.router.js', 'apps/dashboard/themes/default/views/admin/docs',
            'apps/dashboard/themes/default/views/frontend/documentation.ejs']) {
            assert.ok(!gibtEs(weg), `${weg} gibt es noch — Datei-Editor und Datenbank nebeneinander sind zwei Wege`);
        }
        const leser = [];
        (function sammle(o) {
            for (const e of fs.readdirSync(path.join(WURZEL, o), { withFileTypes: true })) {
                if (['node_modules', 'vendor', 'public'].includes(e.name)) continue;
                const p = path.join(o, e.name);
                if (e.isDirectory()) sammle(p);
                // Gesucht ist der ORDNER als Pfadteil — `'documentation'` allein ist auch
                // der Name des Startseiten-Abschnitts (section_type) und hat damit nichts zu tun.
                else if (e.name.endsWith('.js') && /(?:resolve|join)\([^;]*['"`]documentation['"`]/.test(ohneKommentare(lies(p)))) leser.push(p);
            }
        })('apps');
        assert.deepStrictEqual(leser, [], 'liest noch aus documentation/');
    });

    await pruefe('öffentliche Seite und Verwaltung hängen an ihrer Stelle; die Regel steht nur im Modell', () => {
        const vorn = ohneKommentare(lies('apps/dashboard/routes/frontend.router.js'));
        assert.match(vorn, /require\('\.\/kb\.router'\)\(\{ fehlerseite \}\)/);
        assert.match(vorn, /router\.use\('\/kb', wissen\.kb\)/);
        assert.match(vorn, /router\.use\('\/docs', wissen\.alt\)/);
        assert.ok(!/marked|safeDocsPath|buildDocsNav/.test(vorn), 'der alte Markdown-Weg steht noch im Frontend-Router');
        const hinten = ohneKommentare(lies('apps/dashboard/routes/admin.router.js'));
        assert.match(hinten, /router\.use\('\/kb', kbRouter\)/);
        assert.ok(!/docs\.router/.test(hinten));
        // Kein Router rechnet die Sichtbarkeit selbst.
        for (const p of ['apps/dashboard/routes/kb.router.js', 'apps/dashboard/routes/admin/kb.router.js']) {
            assert.ok(!/is_public|status\s*[!=]==?\s*['"]published/.test(ohneKommentare(lies(p))), `${p} entscheidet selbst, wer was liest`);
        }
        // Zwei Sicherungen halten den Inhalt eines Artikels mit Schloss zurück: Der
        // Router rendert ihn nicht, die Ansicht gäbe ihn nicht aus. Der Seitentest
        // oben bleibt grün, solange EINE hält — deshalb hier jede einzeln.
        assert.match(ohneKommentare(lies('apps/dashboard/routes/kb.router.js')), /inhaltHtml: sichtbar === 'ganz' \? Wissen\.rendere\(artikel\.inhalt\) : ''/);
        assert.match(ohneKommentareEjs(lies('apps/dashboard/themes/default/views/frontend/kb.ejs')),
            /if \(artikel\.sichtbar === 'schloss'\) \{[\s\S]*?\} else \{ %>\s*<article class="kb-content kb-article"><%- inhaltHtml %><\/article>/);
        const leiste = ohneKommentareEjs(lies('apps/dashboard/themes/default/partials/guild/sidebar.ejs'));
        assert.match(leiste, /url: '\/admin\/kb',\s+titel: 'Wissensdatenbank'/);
        assert.ok(!leiste.includes('/admin/docs'));
        const anmeldung = ohneKommentare(lies('apps/dashboard/controllers/auth.controller.js'));
        assert.match(anmeldung, /rueckkehrZiel\(req\.session\.redirectURL\)/);
        // Die Ansicht gibt genau EINE Sache unescapt aus: den gerenderten Inhalt.
        const ansicht = ohneKommentareEjs(lies('apps/dashboard/themes/default/views/frontend/kb.ejs'));
        assert.deepStrictEqual([...new Set((ansicht.match(/<%-\s*[^%]+%>/g) || []).map(x => x.replace(/\s+/g, ' ')))], ['<%- inhaltHtml %>']);
    });

    await pruefe('beide Sprachdateien tragen dieselben Schlüssel der Wissensdatenbank', () => {
        const de = JSON.parse(lies('apps/dashboard/locales/de-DE.json')).KB;
        const en = JSON.parse(lies('apps/dashboard/locales/en-GB.json')).KB;
        assert.ok(de && en, 'Abschnitt KB fehlt');
        assert.deepStrictEqual(Object.keys(en).sort(), Object.keys(de).sort());
        // Jeder Schlüssel, den Ansicht und Startseiten-Abschnitt benutzen, ist da.
        const benutzt = new Set();
        for (const p of ['apps/dashboard/themes/default/views/frontend/kb.ejs', 'apps/dashboard/themes/default/partials/frontend/sections/documentation.ejs']) {
            for (const m of ohneKommentareEjs(lies(p)).matchAll(/tr\('KB\.([A-Z_]+)'/g)) benutzt.add(m[1]);
        }
        assert.ok(benutzt.size >= 12, 'kaum Schlüssel gefunden — die Suche misst nicht mehr');
        assert.deepStrictEqual([...benutzt].filter(k => !(k in de)), []);
    });

    console.log(fehler ? `\n❌ Wissensdatenbank: ${fehler} Prüfung(en) rot` : `\n✅ Wissensdatenbank: ${bestanden} Prüfung(en) bestanden`);
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error('\n❌ Der Wächter selbst ist gescheitert:', e); process.exit(1); });
