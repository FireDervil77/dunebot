#!/usr/bin/env node
/**
 * Wächter der Aufbewahrung (G-05, K382, 2026-11-14).
 *
 * Jede Frist steht in der `package.json` ihres Plugins unter `aufbewahrung`
 * (Form in `apps/dashboard/helpers/Aufbewahrung.js`). Nachts löscht die
 * Aufgabe `core:aufbewahrung` im Zeitplan, was älter ist.
 *
 * Erklärungen:
 *   1. Form: Name, Tabelle, Zeitspalte, Tage, guild/recht, titel, wo/ohne.
 *   2. Jede Tabelle mit dem Weg `frist` in `mitgliedInhalte` hat eine Frist
 *      ohne Bedingung. Sonst bliebe sie für immer, und die Auskunft sagte
 *      „bis zum Ende der Frist“.
 *   3. Tabelle und Spalten gibt es in der Datenbank, die Zeitspalte ist eine
 *      Zeit, `guild: true` hat `guild_id`, `ohne` zeigt auf `id`.
 *   4. `recht` steht in der permissions.json des Plugins, `titel` in beiden
 *      Sprachen.
 *   5. Wer eine Frist mit `guild: true` hat, bindet den Kern-Teil
 *      `shared/aufbewahrung` mit seinem Namen ein, außerhalb eines Formulars.
 * Verdrahtung:
 *   6. app.js startet die Aufbewahrung nach dem Zeitplan; sie trägt
 *      `core:aufbewahrung` ein. Die Toast-Logs löscht nicht mehr index.js.
 *   7. `aufbewahrung_tage` geht mit der Guild (vor `guilds`).
 *   8. Die Datenauskunft nennt die Tage (Auskunft und Löschen), Seite und
 *      Befehl zeigen sie; die PUT-Route prüft das Recht der Frist.
 * Läufe an TEMPORARY-Tabellen der echten Datenbank:
 *   9. Wirksame Tage je Guild, Vorgabe für Guilds ohne Einstellung und
 *      Zeilen ohne Guild, Obergrenze begrenzt Einstellung und Vorgabe.
 *  10. Probelauf zählt dasselbe und löscht nichts; zweiter Lauf löscht nichts.
 *  11. Obergrenze des Betreibers; Einstellung der Guild prüft 1..Obergrenze.
 *  12. `wo` und `ohne`: nur verteilt, nicht mit offener Kind-Zeile.
 *  13. In Stücken: mehr als `STUECK` alte Zeilen gehen in einem Lauf.
 *  14. Scheitert eine Frist, laufen die anderen; Fehler steht in der Zeile.
 *  15. Tage für die Auskunft: je Guild, sonst das Längste.
 *
 *   node scripts/check-aufbewahrung.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

/** Für Gegenproben: den Helfer aus einer Kopie laden. */
const HELFER = process.env.AUFBEWAHRUNG_HELFER || path.join(WURZEL, 'apps/dashboard/helpers/Aufbewahrung.js');

let rot = 0;
async function pruefe(was, tun) {
    try {
        await tun();
        console.log(`  ✓ ${was}`);
    } catch (e) {
        rot++;
        console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').join('\n      ')}`);
    }
}
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), 'utf8');
const code = (p) => ohneKommentare(lies(p));

function pakete() {
    const aus = {};
    for (const p of fs.readdirSync(path.join(WURZEL, 'plugins'))) {
        const d = path.join(WURZEL, 'plugins', p, 'package.json');
        if (fs.existsSync(d)) aus[p] = JSON.parse(fs.readFileSync(d, 'utf8'));
    }
    return aus;
}

/** Tabellen mit dem Weg `frist` in `mitgliedInhalte`: Tabelle → Plugin. */
function fristTabellen(meta) {
    const aus = new Map();
    for (const [p, m] of Object.entries(meta)) {
        for (const [t, spalten] of Object.entries(m.mitgliedInhalte || {})) {
            for (const e of Object.values(spalten)) if ((typeof e === 'string' ? e : e?.weg) === 'frist') aus.set(t, p);
        }
    }
    return aus;
}

/** Tabellen mit `frist`, denen eine Frist ohne Bedingung fehlt. */
function ohneFrist(meta) {
    const da = new Set();
    for (const m of Object.values(meta)) for (const e of m.aufbewahrung || []) if (!e.wo && !e.ohne) da.add(e.tabelle);
    return [...fristTabellen(meta)].filter(([t]) => !da.has(t)).map(([t, p]) => `${p}: ${t}`);
}

function sprachschluessel(datei, pfad) {
    if (!fs.existsSync(datei)) return false;
    let o = JSON.parse(fs.readFileSync(datei, 'utf8'));
    for (const teil of pfad.split('.')) { o = o?.[teil]; if (o === undefined) return false; }
    return typeof o === 'string';
}

/** Rechte und Titel der Fristen, gegen die Dateien der Plugins. */
function rechteUndTitel(meta) {
    const fehler = [];
    for (const [p, m] of Object.entries(meta)) {
        for (const e of m.aufbewahrung || []) {
            if (e.guild) {
                // JSON, roh gelesen: Kommentare gibt es darin nicht (check-waechter-prosa).
                const d = path.join(WURZEL, 'plugins', p, 'dashboard', 'permissions.json');
                const keys = fs.existsSync(d) ? (JSON.parse(fs.readFileSync(d, 'utf8')).permissions || []).map(x => x.key) : [];
                if (!keys.includes(e.recht)) fehler.push(`${p}:${e.name}: Recht ${e.recht} fehlt in ${p}/dashboard/permissions.json`);
            }
            const [ns, schl] = String(e.titel).split(':');
            for (const sprache of ['de-DE', 'en-GB']) {
                const d = path.join(WURZEL, 'plugins', ns, 'dashboard', 'locales', `${sprache}.json`);
                if (!sprachschluessel(d, schl)) fehler.push(`${p}:${e.name}: ${e.titel} fehlt in ${ns}/dashboard/locales/${sprache}.json`);
            }
        }
    }
    return fehler;
}

/** Alle .ejs unter plugins/<p>/dashboard/views. */
function ansichten(p) {
    const aus = [];
    const gehe = (d) => {
        if (!fs.existsSync(d)) return;
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const voll = path.join(d, e.name);
            if (e.isDirectory()) gehe(voll);
            else if (e.name.endsWith('.ejs')) aus.push(voll);
        }
    };
    gehe(path.join(WURZEL, 'plugins', p, 'dashboard', 'views'));
    return aus;
}

/** Plugins mit Fristen für die Guild, die den Kern-Teil nicht (richtig) einbinden. */
function ohneKernTeil(meta) {
    const fehler = [];
    for (const [p, m] of Object.entries(meta)) {
        if (!(m.aufbewahrung || []).some(e => e.guild)) continue;
        const muster = new RegExp(`include\\(\\s*['"]shared/aufbewahrung['"]\\s*,\\s*\\{[^}]*plugin\\s*:\\s*['"]${p}['"]`);
        const treffer = [];
        for (const d of ansichten(p)) {
            const q = ohneKommentareEjs(fs.readFileSync(d, 'utf8'));
            const i = q.search(muster);
            if (i < 0) continue;
            const davor = q.slice(0, i);
            const offen = (davor.match(/<form\b/g) || []).length - (davor.match(/<\/form>/g) || []).length;
            treffer.push({ d: path.relative(WURZEL, d), imFormular: offen > 0 });
        }
        if (!treffer.length) fehler.push(`${p}: keine Ansicht bindet shared/aufbewahrung mit plugin: '${p}' ein`);
        for (const t of treffer) if (t.imFormular) fehler.push(`${t.d}: Kern-Teil steht in einem <form>`);
    }
    return fehler;
}

(async () => {
    const meta = pakete();
    const A = require(HELFER);

    console.log('Erklärungen');
    await pruefe('1. Form aller Fristen', () => assert.deepStrictEqual(A.pruefeForm(meta), []));
    await pruefe('1. Gegenproben der Form werden rot', () => {
        const probe = (e) => A.pruefeForm({ x: { aufbewahrung: [{ name: 'a', tabelle: 't', zeitspalte: 'z', vorgabe_tage: 5, hoechstens_tage: 9, guild: true, recht: 'X.Y', titel: 'x:A', ...e }] } });
        assert.deepStrictEqual(probe({}), []);
        for (const [was, e] of [
            ['ohne name', { name: undefined }], ['vorgabe über hoechstens', { vorgabe_tage: 10 }], ['0 Tage', { vorgabe_tage: 0 }],
            ['Tage als Text', { hoechstens_tage: '9' }], ['guild ohne recht', { recht: undefined }], ['guild kein bool', { guild: 'ja' }],
            ['titel kein Schlüssel', { titel: 'Fälle' }], ['wo ohne Liste', { wo: { zustand: 'neu' } }], ['ohne ohne spalte', { ohne: { tabelle: 'k' } }],
            ['tabelle mit Backtick', { tabelle: 't`; DROP' }],
        ]) assert(probe(e).length, `${was} bleibt grün`);
    });
    await pruefe('2. Jede Tabelle mit `frist` hat eine Frist ohne Bedingung', () => assert.deepStrictEqual(ohneFrist(meta), []));
    await pruefe('2. Gegenprobe: ohne die Frist der Giveaway-Sperren rot, nur mit Bedingung rot', () => {
        const kopie = JSON.parse(JSON.stringify(meta));
        kopie.giveaway.aufbewahrung = [];
        assert.deepStrictEqual(ohneFrist(kopie), ['giveaway: giveaway_blacklist']);
        const k2 = JSON.parse(JSON.stringify(meta));
        k2.core.aufbewahrung = k2.core.aufbewahrung.filter(e => e.name !== 'ereignisbuch-spaetestens');
        assert.deepStrictEqual(ohneFrist(k2), ['core: ereignisbuch']);
    });

    const c = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
    });
    const spaltenDb = (await c.query(
        'SELECT TABLE_NAME AS t, COLUMN_NAME AS s, DATA_TYPE AS typ FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()'))[0];
    const schema = {};
    for (const { t, s, typ } of spaltenDb) (schema[t] ||= {})[s] = typ;

    await pruefe('3. Tabellen und Spalten gibt es, Zeitspalte ist eine Zeit', () => {
        const fehler = [];
        for (const e of A.erklaerungen(meta)) {
            const wer = `${e.plugin}:${e.name}`;
            const t = schema[e.tabelle];
            if (!t) { fehler.push(`${wer}: Tabelle ${e.tabelle} fehlt (noch nicht migriert?)`); continue; }
            if (!['datetime', 'timestamp', 'date'].includes(t[e.zeitspalte])) fehler.push(`${wer}: ${e.tabelle}.${e.zeitspalte} ist ${t[e.zeitspalte] || 'nicht da'}, keine Zeit`);
            if (e.guild && !t.guild_id) fehler.push(`${wer}: guild: true, aber ${e.tabelle} hat kein guild_id`);
            for (const s of Object.keys(e.wo || {})) if (!t[s]) fehler.push(`${wer}: wo-Spalte ${s} fehlt`);
            if (e.ohne) {
                if (!t.id) fehler.push(`${wer}: ohne braucht ${e.tabelle}.id`);
                const k = schema[e.ohne.tabelle];
                if (!k) fehler.push(`${wer}: ohne-Tabelle ${e.ohne.tabelle} fehlt`);
                else for (const s of [e.ohne.spalte, ...Object.keys(e.ohne.wo || {})]) if (!k[s]) fehler.push(`${wer}: ${e.ohne.tabelle}.${s} fehlt`);
            }
        }
        assert.deepStrictEqual(fehler, []);
    });
    await pruefe('4. Recht und Titel stehen in den Dateien des Plugins', () => assert.deepStrictEqual(rechteUndTitel(meta), []));
    await pruefe('4. Gegenprobe: unbekanntes Recht, fehlender Titel rot', () => {
        const k = JSON.parse(JSON.stringify(meta));
        k.moderation.aufbewahrung[0].recht = 'MODERATION.GIBTS.NICHT';
        k.automod.aufbewahrung[0].titel = 'automod:AUFBEWAHRUNG.GIBTS_NICHT';
        assert.strictEqual(rechteUndTitel(k).length, 3);
    });
    await pruefe('5. Kern-Teil eingebunden, außerhalb eines Formulars', () => assert.deepStrictEqual(ohneKernTeil(meta), []));
    await pruefe('5. Gegenprobe: Plugin mit Guild-Frist ohne Ansicht rot', () => {
        const k = JSON.parse(JSON.stringify(meta));
        k.ticket = { aufbewahrung: [{ name: 'x', guild: true }] };
        assert.deepStrictEqual(ohneKernTeil(k), ["ticket: keine Ansicht bindet shared/aufbewahrung mit plugin: 'ticket' ein"]);
    });

    console.log('Verdrahtung');
    await pruefe('6. app.js startet die Aufbewahrung nach dem Zeitplan', () => {
        const q = code('apps/dashboard/app.js');
        const zp = q.indexOf("require('./helpers/Zeitplan').starten()");
        const auf = q.indexOf("require('./helpers/Aufbewahrung').starten()");
        assert(zp > 0 && auf > zp, `Zeitplan bei ${zp}, Aufbewahrung bei ${auf}`);
        const h = code('apps/dashboard/helpers/Aufbewahrung.js');
        assert(/eintragen\(\s*'core:aufbewahrung'\s*,\s*TAKT\s*,\s*nachts\s*\)/.test(h), 'core:aufbewahrung wird nicht eingetragen');
        const takt = A.TAKT.split(' ');
        assert(!['2'].includes(takt[1]), 'Takt zwischen 2 und 3 Uhr (Zeitumstellung)');
    });
    await pruefe('6. Toast-Logs löscht nicht mehr index.js, kein node-cron dort', () => {
        const q = code('apps/dashboard/index.js');
        assert(!/guild_toast_logs/.test(q), 'index.js nennt guild_toast_logs');
        assert(!/node-cron/.test(q), 'index.js lädt node-cron');
        assert(meta.core.aufbewahrung.some(e => e.tabelle === 'guild_toast_logs' && !e.wo && !e.ohne), 'keine Frist für guild_toast_logs');
    });
    await pruefe('7. aufbewahrung_tage geht mit der Guild, vor guilds', () => {
        const l = meta.core.guildInhalte.loeschen;
        assert(l.includes('aufbewahrung_tage') && l.indexOf('aufbewahrung_tage') < l.indexOf('guilds'));
    });
    await pruefe('8. Auskunft und Löschen nennen die Tage, Seite und Befehl zeigen sie', () => {
        const d = code('apps/dashboard/helpers/Datenauskunft.js');
        assert.strictEqual((d.match(/require\('\.\/Aufbewahrung'\)\.tageJeTabelle\(guildId\)/g) || []).length, 2, 'tageJeTabelle nicht in auskunft und mitgliedLoeschen');
        assert(/tage: e\.weg === 'frist' \? fristTage\.get\(tab\.tabelle\)/.test(d), 'Auskunft trägt tage nicht');
        assert(/grund: e\.grund, tage: fristTage\.get\(tab\.tabelle\)/.test(d), 'Löschen trägt tage nicht');
        const m = code('apps/dashboard/helpers/MeineDaten.js');
        assert.strictEqual((m.match(/tage: (e|b)\.tage \?\? null/g) || []).length, 2, 'MeineDaten reicht tage nicht weiter');
        const s = ohneKommentareEjs(lies('apps/dashboard/themes/default/views/auth/meine-daten.ejs'));
        assert(/ZAHL_FRIST_TAGE/.test(s) && /'FristTage'/.test(s), 'Seite zeigt die Tage nicht');
        assert.strictEqual((code('apps/bot/commands/mydata.js').match(/"ZAHL_FRIST_TAGE"/g) || []).length, 2, '/mydata zeigt die Tage nicht');
        for (const f of ['apps/dashboard/locales/de-DE.json', 'apps/dashboard/locales/en-GB.json']) assert(sprachschluessel(path.join(WURZEL, f), 'MEINEDATEN.ZAHL_FRIST_TAGE'), f);
        // Sprachdateien des Bots, JSON roh: Kommentare gibt es darin nicht.
        for (const f of ['plugins/core/bot/locales/de-DE.json', 'plugins/core/bot/locales/en-GB.json']) assert(/"ZAHL_FRIST_TAGE": "[^"]*\{\{tage\}\}/.test(lies(f)), f);
    });
    await pruefe('8. PUT prüft das Recht der Frist, GET liefert darf', () => {
        const r = code('apps/dashboard/routes/guild/settings.router.js');
        const ab = r.indexOf("router.put('/aufbewahrung/:plugin'");
        assert(ab > 0, 'PUT fehlt');
        const rumpf = r.slice(ab, r.indexOf('\n});', ab));
        assert(/return requirePermission\(frist\.recht\)\(req, res, async \(\) => \{[\s\S]*setzeGuild/.test(rumpf), 'setzeGuild nicht hinter requirePermission(frist.recht)');
        assert(/e\.guild\)/.test(rumpf), 'PUT nimmt auch Fristen ohne guild');
        assert(/darf: rechte\[f\.recht\]/.test(r), 'GET liefert darf nicht');
    });

    // ── Läufe ────────────────────────────────────────────────────────────
    console.log('Läufe (TEMPORARY)');
    const migration = require(path.join(WURZEL, 'migrations/kern/20261114_090000_aufbewahrung.js'));
    await migration.up({ query: (sql) => c.query(sql.replace(/CREATE TABLE IF NOT EXISTS/g, 'CREATE TEMPORARY TABLE')) });
    await c.query(`CREATE TEMPORARY TABLE probe_auf (id INT AUTO_INCREMENT PRIMARY KEY, guild_id VARCHAR(20) NULL, zeit DATETIME NOT NULL, zustand VARCHAR(16) NOT NULL DEFAULT 'verteilt', KEY (zeit))`);
    await c.query(`CREATE TEMPORARY TABLE probe_auf_kind (id INT AUTO_INCREMENT PRIMARY KEY, ereignis_id INT NOT NULL, zustand VARCHAR(16) NOT NULL)`);
    const zeilen = [];
    ServiceManager.register('Logger', { info: (...a) => zeilen.push(a.join(' ')), error: (...a) => zeilen.push(a.map(String).join(' ')), warn() {}, debug() {} });
    ServiceManager.register('dbService', { async query(sql, params = []) { const [r] = await c.query(sql, params); return r; } });

    const PM = (aufbewahrung) => ({ probe: { aufbewahrung } });
    const G = { name: 'guild', tabelle: 'probe_auf', zeitspalte: 'zeit', vorgabe_tage: 10, hoechstens_tage: 30, guild: true, recht: 'P.EDIT', titel: 'probe:G' };
    const leeren = async () => { await c.query('DELETE FROM probe_auf'); await c.query('DELETE FROM probe_auf_kind'); };
    const fuelle = async (gs, alter) => {
        const werte = [];
        for (const g of gs) for (const a of alter) werte.push([g, a]);
        await c.query(`INSERT INTO probe_auf (guild_id, zeit) VALUES ${werte.map(() => '(?, NOW() - INTERVAL ? DAY)').join(',')}`, werte.flat());
    };
    const rest = async () => {
        const [r] = await c.query('SELECT COALESCE(guild_id, "-") AS g, COUNT(*) AS n FROM probe_auf GROUP BY g ORDER BY g');
        return Object.fromEntries(r.map(x => [x.g, Number(x.n)]));
    };

    await pruefe('9./10. Tage je Guild, Vorgabe, Obergrenze; Probelauf zählt, löscht nicht', async () => {
        await leeren();
        await fuelle(['111', '222', '333', null], [3, 7, 12, 20, 40]);
        await c.query("INSERT INTO aufbewahrung_tage (guild_id, plugin, name, tage) VALUES ('111', 'probe', 'guild', 5), ('222', 'probe', 'guild', 50)");
        const meta1 = PM([G]);
        const probe = await A.laufen({ trocken: true, meta: meta1 });
        // 111: 5 T. → 7,12,20,40; 222: 50 begrenzt auf 30 → 40; 333 und ohne Guild: 10 → 12,20,40
        assert.strictEqual(probe.zeilen, 11, `Probelauf zählt ${probe.zeilen}`);
        assert.deepStrictEqual(await rest(), { '-': 5, 111: 5, 222: 5, 333: 5 }, 'Probelauf hat gelöscht');
        assert.strictEqual((await c.query('SELECT COUNT(*) AS n FROM aufbewahrung_fristen'))[0][0].n, 0, 'Probelauf schreibt den Stand');
        const r = await A.laufen({ meta: meta1 });
        assert.strictEqual(r.zeilen, 11);
        assert.deepStrictEqual(await rest(), { '-': 2, 111: 1, 222: 4, 333: 2 });
        const [[z]] = await c.query("SELECT * FROM aufbewahrung_fristen WHERE plugin = 'probe' AND name = 'guild'");
        assert.strictEqual(z.zuletzt_geloescht, 11);
        assert.strictEqual(Number(z.geloescht_gesamt), 11);
        const r2 = await A.laufen({ meta: meta1 });
        assert.strictEqual(r2.zeilen, 0, 'zweiter Lauf löscht noch');
        const [[z2]] = await c.query("SELECT * FROM aufbewahrung_fristen WHERE plugin = 'probe' AND name = 'guild'");
        assert.strictEqual(z2.zuletzt_geloescht, 0);
        assert.strictEqual(Number(z2.geloescht_gesamt), 11);
        assert(zeilen.some(l => /probe:guild: 11 Zeile\(n\) aus probe_auf gelöscht/.test(l)), 'kein Log');
    });

    await pruefe('11. Obergrenze des Betreibers; Einstellung prüft 1..Obergrenze', async () => {
        const meta1 = PM([G]);
        assert.strictEqual((await A.setzeGrenze('probe', 'guild', '0', { meta: meta1 })).ok, false);
        assert.strictEqual((await A.setzeGrenze('probe', 'gibts', '5', { meta: meta1 })).ok, false);
        assert.strictEqual((await A.setzeGrenze('probe', 'guild', 8, { meta: meta1 })).ok, true);
        await leeren();
        await fuelle(['111', '222', '333', null], [3, 7, 9]);
        const r = await A.laufen({ meta: meta1 });
        // 111: 5 → 7,9; 222: 50 → 8 → 9; 333/ohne: 10 → 8 → 9
        assert.strictEqual(r.zeilen, 5);
        const f = await A.fuerGuild('222', 'probe', { meta: meta1 });
        assert.deepStrictEqual(f.map(x => [x.vorgabe, x.obergrenze, x.eingestellt, x.wirksam]), [[8, 8, 50, 8]]);
        for (const falsch of ['0', '9', 'abc', '2.5', -1]) {
            assert.strictEqual((await A.setzeGuild('333', 'probe', 'guild', falsch, { meta: meta1 })).ok, false, `${falsch} angenommen`);
        }
        assert.strictEqual((await A.setzeGuild('333', 'probe', 'gibts', 3, { meta: meta1 })).ok, false);
        const ohneGuild = PM([{ ...G, guild: false, recht: undefined }]);
        assert.strictEqual((await A.setzeGuild('333', 'probe', 'guild', 3, { meta: ohneGuild })).ok, false, 'guild: false einstellbar');
        assert.deepStrictEqual(await A.setzeGuild('333', 'probe', 'guild', ' 3 ', { meta: meta1 }), { ok: true, wirksam: 3 });
        assert.deepStrictEqual((await A.fuerGuild('333', 'probe', { meta: meta1 }))[0].eingestellt, 3);
        assert.deepStrictEqual(await A.setzeGuild('333', 'probe', 'guild', '', { meta: meta1 }), { ok: true, wirksam: 8 });
        assert.strictEqual((await c.query("SELECT COUNT(*) AS n FROM aufbewahrung_tage WHERE guild_id = '333'"))[0][0].n, 0, 'leer setzt nicht zurück');
        assert.strictEqual((await A.setzeGrenze('probe', 'guild', '', { meta: meta1 })).obergrenze, 30);
    });

    await pruefe('12. wo und ohne: nur verteilt, nicht mit offener Kind-Zeile', async () => {
        await leeren();
        const B = { name: 'bedingt', tabelle: 'probe_auf', zeitspalte: 'zeit', vorgabe_tage: 7, hoechstens_tage: 30, guild: false, titel: 'probe:B',
            wo: { zustand: ['verteilt'] }, ohne: { tabelle: 'probe_auf_kind', spalte: 'ereignis_id', wo: { zustand: ['offen', 'liegen_geblieben'] } } };
        const neu = async (zustand, alter) => (await c.query('INSERT INTO probe_auf (guild_id, zeit, zustand) VALUES (?, NOW() - INTERVAL ? DAY, ?)', ['1', alter, zustand]))[0].insertId;
        const alt = await neu('verteilt', 10);
        const mitOffen = await neu('verteilt', 10);
        const mitErledigt = await neu('verteilt', 10);
        const liegt = await neu('verteilt', 10);
        const nochNeu = await neu('neu', 10);
        const jung = await neu('verteilt', 3);
        await c.query("INSERT INTO probe_auf_kind (ereignis_id, zustand) VALUES (?, 'offen'), (?, 'erledigt'), (?, 'liegen_geblieben'), (?, 'erledigt')", [mitOffen, mitErledigt, liegt, liegt]);
        const r = await A.laufen({ meta: PM([B]) });
        assert.strictEqual(r.zeilen, 2);
        const [da] = await c.query('SELECT id FROM probe_auf ORDER BY id');
        assert.deepStrictEqual(da.map(x => x.id), [mitOffen, liegt, nochNeu, jung]);
        assert(![alt, mitErledigt].some(i => da.some(x => x.id === i)));
    });

    await pruefe(`13. In Stücken: ${A.STUECK * 2 + 7} alte Zeilen in einem Lauf`, async () => {
        await leeren();
        const n = A.STUECK * 2 + 7;
        for (let i = 0; i < n; i += 2000) {
            const k = Math.min(2000, n - i);
            await c.query(`INSERT INTO probe_auf (guild_id, zeit) VALUES ${Array(k).fill("('9', NOW() - INTERVAL 40 DAY)").join(',')}`);
        }
        await fuelle(['9'], [1]);
        const sql = [];
        const echt = ServiceManager.get('dbService');
        ServiceManager.register('dbService', { async query(s, p) { if (/^DELETE FROM `probe_auf`/.test(s)) sql.push(s); return echt.query(s, p); } });
        try {
            const r = await A.laufen({ meta: PM([{ ...G, guild: false, recht: undefined }]) });
            assert.strictEqual(r.zeilen, n);
            assert.strictEqual(sql.length, 3, `${sql.length} Stücke`);
            assert(sql.every(s => new RegExp(`LIMIT ${A.STUECK}$`).test(s)), 'ohne LIMIT');
            assert.deepStrictEqual(await rest(), { 9: 1 });
        } finally {
            ServiceManager.register('dbService', echt);
        }
    });

    await pruefe('14. Scheitert eine Frist, laufen die anderen; Fehler in der Zeile', async () => {
        await leeren();
        await fuelle(['111'], [40]);
        const kaputt = { ...G, name: 'kaputt', tabelle: 'probe_gibts_nicht', guild: false, recht: undefined };
        const r = await A.laufen({ meta: PM([kaputt, G]) });
        assert.strictEqual(r.fehler, 1);
        assert.strictEqual(r.zeilen, 1, 'die zweite Frist lief nicht');
        const [[z]] = await c.query("SELECT letzter_fehler FROM aufbewahrung_fristen WHERE plugin = 'probe' AND name = 'kaputt'");
        assert(/probe_gibts_nicht/.test(z.letzter_fehler), z.letzter_fehler);
        const r2 = await A.laufen({ meta: PM([G]) });
        assert.strictEqual(r2.fehler, 0);
    });

    await pruefe('15. Tage für die Auskunft: je Guild, sonst das Längste', async () => {
        const meta1 = PM([G, { ...G, name: 'zweite', vorgabe_tage: 20, guild: false, recht: undefined, tabelle: 'probe_auf' }]);
        await A.setzeGrenze('probe', 'guild', 12, { meta: meta1 });
        // probe:guild: 111 → 5, 222 → 50 begrenzt 12, sonst 10; probe:zweite: 20 (gleiche Tabelle, längste zählt)
        assert.strictEqual((await A.tageJeTabelle('111', { meta: PM([G]) })).get('probe_auf'), 5);
        assert.strictEqual((await A.tageJeTabelle('222', { meta: PM([G]) })).get('probe_auf'), 12);
        assert.strictEqual((await A.tageJeTabelle('999', { meta: PM([G]) })).get('probe_auf'), 10);
        assert.strictEqual((await A.tageJeTabelle(null, { meta: PM([G]) })).get('probe_auf'), 12);
        assert.strictEqual((await A.tageJeTabelle('111', { meta: meta1 })).get('probe_auf'), 20);
        // Mit den echten Erklärungen: jede Tabelle mit `frist` hat Tage.
        const echt = await A.tageJeTabelle(null);
        const fehlt = [...fristTabellen(meta).keys()].filter(t => !(echt.get(t) >= 1));
        assert.deepStrictEqual(fehlt, []);
    });

    await pruefe('Stand für /admin: Guilds, begrenzt, Bestand', async () => {
        const s = await A.stand({ meta: PM([G]) });
        assert.strictEqual(s.length, 1);
        assert.strictEqual(s[0].guilds, 2);
        assert.strictEqual(s[0].begrenzt, 1);
        assert.deepStrictEqual([s[0].kuerzeste, s[0].laengste, s[0].obergrenze, s[0].grenze_gesetzt], [5, 12, 12, true]);
        assert.strictEqual(typeof s[0].bestand.zeilen, 'number');
    });

    await c.end();
    console.log(rot ? `\n${rot} rot` : '\nalles grün');
    process.exit(rot ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
