#!/usr/bin/env node
/**
 * Fortschritts-Bibliothek (G-20, F-G8, F-CL8, K382, 2026-11-14).
 *
 * Geprüft wird:
 *
 *   1  Erklärungen   `fortschritt` in jeder package.json fehlerfrei (Kennung
 *                    beginnt mit dem Plugin, Schablone bekannt), Titel in de
 *                    und en, das Recht steht im Katalog
 *   2  Eigene        ein Plugin ruft schreibende Funktionen von `Fortschritt`
 *      Kennungen     nur mit einer ablesbaren Kennung, die mit seinem Namen
 *                    beginnt und erklärt ist (der Kern unter apps/ verwaltet
 *                    alle: Routen, Probe)
 *   3  Ein Weg       `fortschritt_*` schreibt nur das SDK (und die Migration);
 *                    gelöscht wird für G-04 über `mitgliedInhalte`/`guildInhalte`
 *   4  Pflichten     Kern erklärt alle sechs Tabellen für Guild und Mitglied,
 *                    Aufbewahrung verdichtet `fortschritt_buchungen` mit Funktion
 *   5  Rechnen       Schablonen, Rechner, Stufen ordnen, Level aus der Tabelle
 *   6  Buchen        an TEMPORARY-Kopien der Kern-Migration mit echtem SQL:
 *                    erste Buchung spielt die Schablone ein, Schlüssel doppelt →
 *                    eine Buchung, Minus gekürzt, Storno → Stand zurück, Stufe
 *                    aus der Tabelle (auch nach Ändern und Löschen einer Stufe),
 *                    Schablone laden ersetzt die Tabelle, Prestige, Gesamtstand
 *                    = Summe, Wochen- und Monatsrangliste gegen die Buchungen
 *                    nachgerechnet, Position, Saisons (zählt nur im Zeitraum,
 *                    archivieren/zurücksetzen), Verdichten hält den Stand,
 *                    Mitglied und Kennung entfernen, Nachrechnen
 *   7  Seite         Kern-Teil und Betreiber-Seite rendern, Texte de = en,
 *                    Routen und Zeitplan eingetragen
 *   8  Gegenproben   jede Prüfung aus 1 bis 3 wird an eingebauten Fehlern rot
 *
 * Geschrieben wird nur in TEMPORARY-Tabellen dieser Verbindung.
 *
 *   node scripts/check-fortschritt.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare } = require('./lib/quelltext');

ServiceManager.register('Logger', { debug() {}, info() {}, success() {}, warn() {}, error() {} });

const SDK = 'packages/dunebot-sdk/lib/Fortschritt.js';
const MIGRATION = 'migrations/kern/20261114_235000_fortschritt.js';
const Fortschritt = require(path.join(WURZEL, SDK));
const TABELLEN = ['fortschritt_buchungen', 'fortschritt_stand', 'fortschritt_stufen', 'fortschritt_einstellungen', 'fortschritt_saisons', 'fortschritt_saison_stand'];
const SCHREIBEND = ['buche', 'storniere', 'setzeStufen', 'setzeEinstellungen', 'legeSaisonAn', 'beendeSaison', 'loescheSaison', 'entferneMitglied', 'loescheKennung'];

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 12).join('\n      ')}`); }
}

function pakete() {
    const aus = {};
    for (const p of fs.readdirSync(path.join(WURZEL, 'plugins'))) {
        const d = path.join(WURZEL, 'plugins', p, 'package.json');
        if (fs.existsSync(d)) aus[p] = JSON.parse(fs.readFileSync(d, 'utf8'));
    }
    return aus;
}

function sprachwert(sprache, schluessel) {
    const [ns, rest] = schluessel.split(':');
    const datei = path.join(WURZEL, 'plugins', ns, 'dashboard/locales', `${sprache}.json`);
    if (!fs.existsSync(datei)) return undefined;
    let o = JSON.parse(fs.readFileSync(datei, 'utf8'));
    for (const t of rest.split('.')) o = o?.[t];
    return o;
}

/** .js unter apps, plugins, packages; ohne node_modules, vendor, public, backups, assets. */
function quellen() {
    const aus = [];
    for (const o of ['apps', 'plugins', 'packages']) {
        (function sammle(x) {
            for (const e of fs.readdirSync(path.join(WURZEL, x), { withFileTypes: true })) {
                if (['node_modules', 'vendor', 'public', 'backups', 'assets'].includes(e.name)) continue;
                const p = path.join(x, e.name);
                if (e.isDirectory()) sammle(p);
                else if (e.name.endsWith('.js')) aus.push([p, fs.readFileSync(path.join(WURZEL, p), 'utf8')]);
            }
        })(o);
    }
    return aus;
}

// ── 2/3: reine Prüfungen, damit die Gegenproben sie wiederverwenden ──────

/** Text eines Aufrufs ab der öffnenden Klammer bis zur passenden schließenden. */
function aufrufText(code, ab) {
    let tiefe = 0;
    for (let i = ab; i < code.length; i++) {
        if (code[i] === '(') tiefe++;
        else if (code[i] === ')' && --tiefe === 0) return code.slice(ab, i + 1);
    }
    return code.slice(ab, ab + 400);
}

/**
 * Schreibende Aufrufe in Plugins: Kennung ablesbar, eigene Vorsilbe, erklärt.
 *
 * @param {Array<[string, string]>} dateien
 * @param {(k: string) => boolean} erklaert
 */
function pruefeEigene(dateien, erklaert) {
    const aus = [];
    const muster = new RegExp(`\\bFortschritt\\.(${SCHREIBEND.join('|')})\\s*\\(`, 'g');
    for (const [p, text] of dateien) {
        const teile = p.split(path.sep);
        if (teile[0] !== 'plugins') continue;
        const vor = teile[1] === 'core' ? 'kern' : teile[1];
        const code = ohneKommentare(text);
        let m;
        while ((m = muster.exec(code))) {
            const zeile = code.slice(0, m.index).split('\n').length;
            const arg = aufrufText(code, m.index + m[0].length - 1);
            const k = /\bkennung\s*:\s*(['"`])([a-z0-9_-]+):([^'"`$]*)(\$\{)?/.exec(arg);
            if (!k) { aus.push(`${p}:${zeile}: Fortschritt.${m[1]} ohne ablesbare Kennung (kennung: '${vor}:…')`); continue; }
            if (k[2] !== vor) { aus.push(`${p}:${zeile}: Fortschritt.${m[1]} auf fremde Kennung "${k[2]}:…" (erlaubt "${vor}:…")`); continue; }
            const probe = k[4] ? `${k[2]}:${k[3] || 'x'}`.replace(/:$/, ':x') : `${k[2]}:${k[3]}`;
            if (!erklaert(probe.replace(/:gesamt$/, ''))) aus.push(`${p}:${zeile}: Kennung "${probe}" ist nicht erklärt`);
        }
    }
    return aus;
}

const SQL_SCHREIBEN = /\b(INSERT\s+(IGNORE\s+)?INTO|UPDATE|DELETE\s+(\w+\s+)?FROM|REPLACE\s+INTO|TRUNCATE(\s+TABLE)?)\s+`?fortschritt_/i;

/** `fortschritt_*` schreibt nur das SDK. */
function pruefeEinWeg(dateien) {
    const aus = [];
    for (const [p, text] of dateien) {
        if (p === SDK) continue;
        ohneKommentare(text).split('\n').forEach((z, i) => { if (SQL_SCHREIBEN.test(z)) aus.push(`${p}:${i + 1}: ${z.trim().slice(0, 90)}`); });
    }
    return aus;
}

// ── 6: Datenbank ─────────────────────────────────────────────────────────

const G = '900000000000000001';
const G2 = '900000000000000002';
const A = '800000000000000001';
const B = '800000000000000002';
const C = '800000000000000003';
const K = 'kern:probe';

(async () => {
    console.log('Fortschritt (G-20)');
    const meta = pakete();
    const liste = Fortschritt.erklaerungen({ frisch: true });

    await pruefe('1a. Erklärungen fehlerfrei', () => {
        assert.deepStrictEqual(Fortschritt.pruefeForm(meta), []);
        assert.ok(liste.some((e) => e.kennung === K), 'kern:probe fehlt');
    });
    await pruefe('1b. Titel in de und en', () => {
        const fehlt = [];
        for (const e of liste) for (const s of ['de-DE', 'en-GB']) if (typeof sprachwert(s, e.titel) !== 'string') fehlt.push(`${e.titel} (${s})`);
        assert.deepStrictEqual(fehlt, []);
    });

    const dateien = quellen();
    await pruefe('2. Plugins buchen nur auf eigene, erklärte Kennungen', () => {
        assert.deepStrictEqual(pruefeEigene(dateien, (k) => Boolean(Fortschritt.erklaerungFuer(k))), []);
    });
    await pruefe('3. fortschritt_* schreibt nur das SDK', () => {
        assert.deepStrictEqual(pruefeEinWeg(dateien), []);
    });
    await pruefe('4a. Kern erklärt die Tabellen für Guild und Mitglied', () => {
        const core = meta.core;
        const fehlt = TABELLEN.filter((t) => !core.guildInhalte.loeschen.includes(t));
        for (const t of ['fortschritt_buchungen', 'fortschritt_stand', 'fortschritt_saison_stand']) if (core.mitgliedInhalte[t]?.mitglied_id !== 'loeschen') fehlt.push(`mitgliedInhalte.${t}`);
        const gl = core.guildInhalte.loeschen;
        if (gl.indexOf('fortschritt_saison_stand') > gl.indexOf('fortschritt_saisons')) fehlt.push('saison_stand vor saisons (Kind vor Eltern)');
        assert.deepStrictEqual(fehlt, []);
    });
    await pruefe('4b. Aufbewahrung verdichtet fortschritt_buchungen', () => {
        const Aufbewahrung = require(path.join(WURZEL, 'apps/dashboard/helpers/Aufbewahrung.js'));
        assert.deepStrictEqual(Aufbewahrung.pruefeForm(meta), []);
        const e = Aufbewahrung.erklaerungen(meta).find((x) => x.tabelle === 'fortschritt_buchungen');
        assert.ok(e && e.verdichten === true && e.zeitspalte === 'zeit', 'Frist fehlt oder verdichtet nicht');
        assert.strictEqual(typeof Aufbewahrung.verdichter(e), 'function');
        assert.throws(() => Aufbewahrung.verdichter({ ...e, name: 'gibt-es-nicht' }), /ohne Funktion/);
        assert.ok(Aufbewahrung.pruefeForm({ x: { aufbewahrung: [{ ...e, plugin: undefined, verdichten: 'ja' }] } }).some((f) => /verdichten/.test(f)), 'verdichten: "ja" nicht rot');
    });

    await pruefe('5. Schablonen, Rechner, Stufen ordnen, Level', () => {
        const an = Fortschritt.schablone('ansteigend');
        assert.strictEqual(an.length, 100);
        assert.deepStrictEqual(an.slice(0, 3).map((s) => s.schwelle), [100, 255, 475]);
        assert.strictEqual(an[9].schwelle, 4675, 'Stufe 10 der verbreiteten Kurve');
        assert.strictEqual(Fortschritt.schablone('flach')[99].schwelle, 10000);
        assert.ok(Fortschritt.schablone('steil').every((s, i, a) => i === 0 || s.schwelle > a[i - 1].schwelle));
        assert.deepStrictEqual(Fortschritt.rechne({ formel: 'quadratisch', a: 0, b: 10, c: 10, anzahl: 3 }).map((s) => s.schwelle), [10, 30, 60]);
        assert.throws(() => Fortschritt.rechne({ formel: 'quadratisch', a: 0, b: 0, c: 0, anzahl: 3 }), Fortschritt.Eingabefehler);
        assert.throws(() => Fortschritt.rechne({ formel: 'quadratisch', a: 0, b: 0, c: 1, anzahl: 0 }), Fortschritt.Eingabefehler);
        const o = Fortschritt.ordneStufen([{ schwelle: 300 }, { schwelle: 0, name: ' Neu ' }, { schwelle: '100' }]);
        assert.deepStrictEqual(o, [{ stufe: 1, schwelle: 0, name: 'Neu' }, { stufe: 2, schwelle: 100, name: null }, { stufe: 3, schwelle: 300, name: null }]);
        assert.throws(() => Fortschritt.ordneStufen([{ schwelle: 5 }, { schwelle: 5 }]), /zweimal/);
        assert.throws(() => Fortschritt.ordneStufen([{ schwelle: -1 }]), Fortschritt.Eingabefehler);
        assert.deepStrictEqual([0, 99, 100, 254, 255, 1e12].map((x) => Fortschritt.levelAus(an, x)), [0, 0, 1, 1, 2, 100]);
        assert.ok(Fortschritt.erklaerungFuer('clan:12', { meta: { clan: { fortschritt: [{ kennung: 'clan:*', titel: 'clan:X.Y', recht: 'CLAN.X', schablone: 'flach', gesamt: { schablone: 'flach' } }] } } })?.plugin === 'clan', 'clan:* trifft clan:12 nicht');
        assert.ok(Fortschritt.erklaerungFuer('clan:12:gesamt', { meta: { clan: { fortschritt: [{ kennung: 'clan:*', titel: 'clan:X.Y', recht: 'CLAN.X', schablone: 'flach', gesamt: { schablone: 'steil' } }] } } })?.schablone === 'steil');
        assert.strictEqual(Fortschritt.erklaerungFuer('clan:12:gesamt', { meta: { clan: { fortschritt: [{ kennung: 'clan:*', titel: 'clan:X.Y', recht: 'CLAN.X', schablone: 'flach' }] } } }), null, 'gesamt ohne Erklärung');
        // Bis LV-1a (2026-11-15) war `leveling:community` nicht erklärt, und hier
        // stand ein strictEqual zweier frischer Objekte: grün nur bei null === null.
        const lv = Fortschritt.erklaerungFuer('leveling:community');
        if (liste.some((e) => e.kennung === 'leveling:community')) assert.ok(lv?.plugin === 'leveling' && lv.kennung === 'leveling:community' && !lv.gesamt_gefragt, JSON.stringify(lv));
        else assert.strictEqual(lv, null);
    });

    const mysql = require('mysql2/promise');
    const c = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
        supportBigNumbers: true, bigNumberStrings: true });
    const schreibt = /^\s*(INSERT|UPDATE|DELETE|REPLACE|TRUNCATE|CREATE|DROP|ALTER)\b/i;
    async function q(sql, werte) {
        const s = String(sql);
        // Geschrieben wird nur in die TEMPORARY-Kopien dieser Verbindung.
        if (schreibt.test(s) && !/^\s*CREATE TEMPORARY TABLE/i.test(s) && !/\bfortschritt_/.test(s)) throw new Error(`nur lesend: ${s.slice(0, 60)}`);
        return (await c.query(s, werte))[0];
    }
    ServiceManager.register('dbService', {
        query: q,
        async transaction(cb) {
            await c.beginTransaction();
            try {
                const r = await cb({ query: async (s, w) => [await q(s, w)] });
                await c.commit();
                return r;
            } catch (e) { await c.rollback(); throw e; }
        },
    });

    // TEMPORARY-Kopien aus der DDL der Kern-Migration (Fremdschlüssel gehen an
    // TEMPORARY nicht; das Löschen mit der Saison prüft 6m ohne CASCADE).
    const ddl = [];
    await require(path.join(WURZEL, MIGRATION)).up({ query: async (s) => { ddl.push(s); } });
    for (const s of ddl) {
        await c.query(s.replace('CREATE TABLE IF NOT EXISTS', 'CREATE TEMPORARY TABLE')
            .replace(/,\s*CONSTRAINT[\s\S]*?ON DELETE CASCADE/, ''));
    }

    const buche = (mitglied, menge, schluessel, extra = {}) => Fortschritt.buche({ guildId: G, kennung: K, mitglied, menge, quelle: 'probe', schluessel, ...extra });
    const xpVon = async (m) => Number((await q('SELECT xp FROM fortschritt_stand WHERE guild_id = ? AND kennung = ? AND mitglied_id = ?', [G, K, m]))[0]?.xp ?? NaN);

    await pruefe('6a. Erste Buchung spielt die Schablone ein', async () => {
        const vorher = await Fortschritt.stufen({ guildId: G, kennung: K });
        assert.strictEqual(vorher.eingespielt, false);
        assert.strictEqual(vorher.stufen.length, 100);
        const r = await buche(A, 150, 'm:1');
        assert.ok(r.neu && !r.doppelt && r.xp === 150 && r.level === 1 && r.aufstieg && r.wechsel, JSON.stringify(r));
        assert.strictEqual(r.naechste.fehlt, 105);
        const nachher = await Fortschritt.stufen({ guildId: G, kennung: K });
        assert.ok(nachher.eingespielt && nachher.schablone === 'ansteigend' && nachher.stufen.length === 100);
    });
    await pruefe('6b. Schlüssel doppelt → eine Buchung', async () => {
        const r = await buche(A, 150, 'm:1');
        assert.ok(r.doppelt && !r.neu && r.xp === 150 && !r.wechsel, JSON.stringify(r));
        const r2 = await buche(B, 999, 'm:1');
        assert.ok(r2.doppelt, 'Schlüssel gilt je Kennung, nicht je Mitglied');
        const [{ n }] = await q('SELECT COUNT(*) AS n FROM fortschritt_buchungen WHERE guild_id = ? AND kennung = ? AND schluessel = ?', [G, K, 'm:1']);
        assert.strictEqual(Number(n), 1);
        assert.strictEqual(await xpVon(A), 150);
        const andereGuild = await Fortschritt.buche({ guildId: G2, kennung: K, mitglied: A, menge: 5, quelle: 'probe', schluessel: 'm:1' });
        assert.ok(andereGuild.neu, 'derselbe Schlüssel in einer anderen Guild ist eine eigene Buchung');
    });
    await pruefe('6c. Minus wird auf den Stand gekürzt, Storno nimmt genau zurück', async () => {
        const r = await buche(A, -1000, 'm:2', { akteur: B, grund: 'Probe' });
        assert.ok(r.gekuerzt && r.menge === -150 && r.xp === 0 && r.level === 0 && !r.aufstieg && r.wechsel, JSON.stringify(r));
        const [z] = await q('SELECT menge, verlangt FROM fortschritt_buchungen WHERE schluessel = ? AND guild_id = ?', ['m:2', G]);
        assert.deepStrictEqual([Number(z.menge), Number(z.verlangt)], [-150, -1000]);
        const s = await Fortschritt.storniere({ guildId: G, kennung: K, schluessel: 'm:2', akteur: B });
        assert.ok(s.gefunden && !s.schon && s.xp === 150 && s.level === 1, JSON.stringify(s));
        assert.ok((await Fortschritt.storniere({ guildId: G, kennung: K, schluessel: 'm:2' })).schon);
        assert.ok(!(await Fortschritt.storniere({ guildId: G, kennung: K, schluessel: 'gibt-es-nicht' })).gefunden);
        await assert.rejects(Fortschritt.buche({ guildId: G, kennung: K, mitglied: A, menge: 5, quelle: 'kern:prestige' }), Fortschritt.Eingabefehler);
        await assert.rejects(Fortschritt.buche({ guildId: G, kennung: 'fremd:x', mitglied: A, menge: 5, quelle: 'probe' }), /nicht|erklärt/);
        await assert.rejects(Fortschritt.buche({ guildId: G, kennung: `${K}:gesamt`, mitglied: A, menge: 5, quelle: 'probe' }), /Gesamtstand/);
        await assert.rejects(buche(A, 1.5, 'x'), Fortschritt.Eingabefehler);
        await assert.rejects(buche(A, 0, 'x'), Fortschritt.Eingabefehler);
        await assert.rejects(buche('R1', 5, 'x'), /Mitglieds-ID/);
    });
    await pruefe('6d. Stufe aus der Tabelle, auch nach Ändern und Löschen einer Stufe', async () => {
        await buche(B, 400, 'm:3');
        await buche(C, 1000, 'm:4');
        // A 150, B 400, C 1000; neue Tabelle 0 / 200 / 500 / 900
        let r = await Fortschritt.setzeStufen({ guildId: G, kennung: K, stufen: [{ schwelle: 900, name: 'Gold' }, { schwelle: 0 }, { schwelle: 500 }, { schwelle: 200 }] });
        assert.strictEqual(r.stufen, 4);
        const lv = async () => Object.fromEntries((await q('SELECT mitglied_id, level FROM fortschritt_stand WHERE guild_id = ? AND kennung = ?', [G, K])).map((z) => [String(z.mitglied_id), Number(z.level)]));
        assert.deepStrictEqual(await lv(), { [A]: 1, [B]: 2, [C]: 4 });
        // vorher (ansteigend: 100/255/475/780/1180 …) dieselben Level 1, 2, 4
        assert.deepStrictEqual(r.neuberechnet, { aufgestiegen: 0, abgestiegen: 0, gleich: 3 }, JSON.stringify(r.neuberechnet));
        // Stufe „200“ löschen: die übrigen rücken nach
        r = await Fortschritt.setzeStufen({ guildId: G, kennung: K, stufen: [{ schwelle: 0 }, { schwelle: 500 }, { schwelle: 900, name: 'Gold' }] });
        assert.deepStrictEqual(await lv(), { [A]: 1, [B]: 1, [C]: 3 });
        assert.deepStrictEqual(r.neuberechnet, { aufgestiegen: 0, abgestiegen: 2, gleich: 1 }, JSON.stringify(r.neuberechnet));
        const st = await Fortschritt.stand({ guildId: G, kennung: K, mitglied: C });
        assert.ok(st.level === 3 && st.stufe.name === 'Gold' && st.naechste === null && st.hoechste === 3, JSON.stringify(st));
        assert.strictEqual((await Fortschritt.stufen({ guildId: G, kennung: K })).schablone, null, 'von Hand = eigene Tabelle');
        const neu = await buche(B, 100, 'm:5');
        assert.ok(neu.level === 2 && neu.aufstieg && neu.stufe.nummer === 2, JSON.stringify(neu));
    });
    await pruefe('6e. Schablone laden ersetzt die Tabelle', async () => {
        const r = await Fortschritt.setzeStufen({ guildId: G, kennung: K, stufen: Fortschritt.schablone('flach'), schablone: 'flach' });
        assert.strictEqual(r.stufen, 100);
        const st = await Fortschritt.stufen({ guildId: G, kennung: K });
        assert.ok(st.schablone === 'flach' && st.stufen.length === 100 && st.stufen.every((s) => s.name === null), 'Namen nicht ersetzt');
        assert.strictEqual((await Fortschritt.stand({ guildId: G, kennung: K, mitglied: C })).level, 10);
        await assert.rejects(Fortschritt.setzeStufen({ guildId: G, kennung: K, stufen: [], schablone: 'gibts-nicht' }), Fortschritt.Eingabefehler);
    });
    await pruefe('6f. Gesamtstand = Summe, eigene Stufentabelle', async () => {
        const g = await Fortschritt.gesamtstand({ guildId: G, kennung: K });
        const summe = 150 + 500 + 1000;
        assert.ok(g.xp === summe && g.mitglieder === 3, JSON.stringify(g));
        assert.strictEqual(g.level, Fortschritt.levelAus(Fortschritt.schablone('flach'), summe));
        await Fortschritt.setzeStufen({ guildId: G, kennung: `${K}:gesamt`, stufen: [{ schwelle: 1000 }, { schwelle: 2000 }] });
        const g2 = await Fortschritt.gesamtstand({ guildId: G, kennung: K });
        assert.ok(g2.level === 1 && g2.naechste.fehlt === 2000 - summe, JSON.stringify(g2));
        assert.strictEqual((await Fortschritt.stufen({ guildId: G, kennung: K })).stufen.length, 100, 'die Tabelle der Mitglieder bleibt');
    });
    await pruefe('6g. Prestige: höchste Stufe → zurück, Prestige + 1, Rest bleibt', async () => {
        await Fortschritt.setzeStufen({ guildId: G, kennung: K, stufen: [{ schwelle: 100 }, { schwelle: 300 }, { schwelle: 600 }] });
        await Fortschritt.setzeEinstellungen({ guildId: G, kennung: K, prestige: true });
        // C hat 1000 (über der höchsten Stufe), Prestige greift bei der nächsten Buchung
        const r = await buche(C, 50, 'm:6');
        assert.ok(r.prestige === 1 && r.xp === 450 && r.level === 2 && r.aufstieg, JSON.stringify(r));
        const [p] = await q("SELECT menge FROM fortschritt_buchungen WHERE guild_id = ? AND quelle = 'kern:prestige'", [G]);
        assert.strictEqual(Number(p.menge), -600);
        await assert.rejects(Fortschritt.storniere({ guildId: G, kennung: K, schluessel: (await q("SELECT schluessel FROM fortschritt_buchungen WHERE quelle = 'kern:prestige'"))[0].schluessel }), /Kern/);
        const gesamt = await Fortschritt.rangliste({ guildId: G, kennung: K });
        assert.strictEqual(gesamt.eintraege[0].mitglied_id, C, 'Prestige zuerst');
        await Fortschritt.setzeEinstellungen({ guildId: G, kennung: K, prestige: false });
    });
    await pruefe('6h. Wochen- und Monatsrangliste gegen die Buchungen nachgerechnet', async () => {
        // Zurückdatieren direkt in der Kopie: eine Buchung von B vor 40 Tagen, eine von A vor 8 Tagen.
        await buche(B, 70, 'alt:1');
        await buche(A, 30, 'alt:2');
        await q("UPDATE fortschritt_buchungen SET zeit = NOW(3) - INTERVAL 40 DAY WHERE schluessel = 'alt:1'");
        await q("UPDATE fortschritt_buchungen SET zeit = NOW(3) - INTERVAL 8 DAY WHERE schluessel = 'alt:2'");
        for (const zr of ['woche', 'monat', 'tage:7', 'tage:30']) {
            const r = await Fortschritt.rangliste({ guildId: G, kennung: K, zeitraum: zr, proSeite: 100 });
            // nachgerechnet in JS über alle Buchungen, Grenze aus der Uhr der Datenbank
            const [{ jetzt, heute }] = await q('SELECT NOW(3) AS jetzt, CURDATE() AS heute');
            const h = new Date(heute);
            const grenze = zr === 'woche' ? new Date(h.getFullYear(), h.getMonth(), h.getDate() - ((h.getDay() + 6) % 7))
                : zr === 'monat' ? new Date(h.getFullYear(), h.getMonth(), 1)
                    : new Date(new Date(jetzt).getTime() - Number(zr.split(':')[1]) * 86400000);
            const alle = await q('SELECT mitglied_id, menge, zeit, quelle, storniert_am FROM fortschritt_buchungen WHERE guild_id = ? AND kennung = ?', [G, K]);
            const soll = new Map();
            for (const b of alle) {
                if (b.storniert_am || b.quelle === 'kern:prestige' || new Date(b.zeit) < grenze) continue;
                soll.set(String(b.mitglied_id), (soll.get(String(b.mitglied_id)) || 0) + Number(b.menge));
            }
            const erwartet = [...soll].filter(([, x]) => x > 0).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).map(([m, x]) => `${m}=${x}`);
            assert.deepStrictEqual(r.eintraege.map((e) => `${e.mitglied_id}=${e.xp}`), erwartet, zr);
            assert.strictEqual(r.gesamt, erwartet.length, `${zr} gesamt`);
        }
        const seite = await Fortschritt.rangliste({ guildId: G, kennung: K, proSeite: 1, seite: 2 });
        assert.ok(seite.eintraege.length === 1 && seite.eintraege[0].platz === 2 && seite.seiten === 3, JSON.stringify(seite));
        const p = await Fortschritt.position({ guildId: G, kennung: K, mitglied: A });
        const ganz = await Fortschritt.rangliste({ guildId: G, kennung: K, proSeite: 100 });
        assert.strictEqual(p.platz, ganz.eintraege.find((e) => e.mitglied_id === A).platz);
        assert.strictEqual((await Fortschritt.position({ guildId: G, kennung: K, mitglied: '800000000000000099' })).platz, null);
        await assert.rejects(Fortschritt.rangliste({ guildId: G, kennung: K, zeitraum: 'jahr' }), Fortschritt.Eingabefehler);
    });
    await pruefe('6i. Saisons: zählt nur im Zeitraum, archivieren und zurücksetzen', async () => {
        const jetzt = new Date();
        const s1 = await Fortschritt.legeSaisonAn({ guildId: G, kennung: K, name: 'Läuft', beginn: new Date(jetzt - 3600e3), ende: new Date(+jetzt + 3600e3) });
        const s2 = await Fortschritt.legeSaisonAn({ guildId: G, kennung: K, name: 'Kommt', beginn: new Date(+jetzt + 7200e3), ende: new Date(+jetzt + 9000e3) });
        const s3 = await Fortschritt.legeSaisonAn({ guildId: G, kennung: K, name: 'Reset', beginn: new Date(jetzt - 3600e3), ende: new Date(+jetzt + 3600e3), regel: 'zuruecksetzen' });
        await buche(A, 40, 's:1');
        await buche(B, 25, 's:2');
        const r1 = await Fortschritt.rangliste({ guildId: G, kennung: K, saison: s1.id });
        assert.deepStrictEqual(r1.eintraege.map((e) => `${e.mitglied_id}=${e.xp}`), [`${A}=40`, `${B}=25`]);
        assert.strictEqual((await Fortschritt.rangliste({ guildId: G, kennung: K, saison: s2.id })).gesamt, 0, 'künftige Saison zählt nicht');
        await Fortschritt.storniere({ guildId: G, kennung: K, schluessel: 's:2' });
        assert.strictEqual((await Fortschritt.rangliste({ guildId: G, kennung: K, saison: s1.id })).gesamt, 1, 'Storno im Saisonstand');
        const vorDauer = await xpVon(A);
        // Ende erreicht: Ende in die Vergangenheit legen, dann der Lauf des Zeitplans
        await q('UPDATE fortschritt_saisons SET ende = NOW() - INTERVAL 1 MINUTE WHERE id IN (?, ?)', [s1.id, s3.id]);
        await buche(A, 10, 's:3');
        assert.strictEqual((await Fortschritt.rangliste({ guildId: G, kennung: K, saison: s1.id })).eintraege[0].xp, 40, 'nach dem Ende zählt nichts');
        const fertig = await Fortschritt.beendeFaellige();
        assert.deepStrictEqual(fertig.map((x) => `${x.id}:${x.regel}`).sort(), [`${s1.id}:archivieren`, `${s3.id}:zuruecksetzen`].sort());
        assert.strictEqual((await Fortschritt.rangliste({ guildId: G, kennung: K, saison: s1.id })).gesamt, 1, 'archiviert bleibt lesbar');
        assert.strictEqual((await Fortschritt.rangliste({ guildId: G, kennung: K, saison: s3.id })).gesamt, 0, 'zurückgesetzt ist leer');
        assert.strictEqual(await xpVon(A), vorDauer + 10, 'der Dauerstand bleibt unberührt');
        assert.strictEqual((await Fortschritt.beendeFaellige()).length, 0, 'zweiter Lauf beendet nichts mehr');
        const liste = await Fortschritt.saisons({ guildId: G, kennung: K });
        assert.ok(liste.length === 3 && liste.filter((s) => s.beendet_am).length === 2 && !liste.some((s) => s.laeuft), JSON.stringify(liste.map((s) => [s.name, s.laeuft])));
        await assert.rejects(Fortschritt.legeSaisonAn({ guildId: G, kennung: K, name: 'x', beginn: jetzt, ende: jetzt }), Fortschritt.Eingabefehler);
    });
    await pruefe('6j. Verdichten hält den Stand, Nachrechnen ohne Abweichung', async () => {
        const vorher = Object.fromEntries((await q('SELECT mitglied_id, xp FROM fortschritt_stand WHERE guild_id = ? AND kennung = ?', [G, K])).map((z) => [String(z.mitglied_id), Number(z.xp)]));
        assert.deepStrictEqual((await Fortschritt.pruefe({ guildId: G, kennung: K })).abweichungen, []);
        // alles älter als 7 Tage verdichten: alt:1 (40 Tage) und alt:2 (8 Tage)
        const bedingung = { sql: '`fortschritt_buchungen`.`zeit` < NOW() - INTERVAL ? DAY', werte: [7] };
        assert.strictEqual((await Fortschritt.verdichte({ bedingung, trocken: true })).zeilen, 2);
        const r = await Fortschritt.verdichte({ bedingung, stueck: 1 });
        assert.deepStrictEqual(r, { zeilen: 2, rest: false });
        const v = await q("SELECT mitglied_id, menge, schluessel FROM fortschritt_buchungen WHERE quelle = 'kern:verdichtet' ORDER BY mitglied_id");
        assert.strictEqual(v.length, 2, JSON.stringify(v));
        assert.deepStrictEqual((await Fortschritt.pruefe({ guildId: G, kennung: K })).abweichungen, [], 'Stand ≠ Summe nach dem Verdichten');
        const nachher = Object.fromEntries((await q('SELECT mitglied_id, xp FROM fortschritt_stand WHERE guild_id = ? AND kennung = ?', [G, K])).map((z) => [String(z.mitglied_id), Number(z.xp)]));
        assert.deepStrictEqual(nachher, vorher);
        assert.strictEqual((await Fortschritt.verdichte({ bedingung, trocken: true })).zeilen, 0, 'Monatssummen werden nicht erneut verdichtet');
        // Nachrechnen findet einen verdorbenen Stand und repariert ihn
        await q('UPDATE fortschritt_stand SET xp = xp + 7 WHERE guild_id = ? AND kennung = ? AND mitglied_id = ?', [G, K, B]);
        const kaputt = await Fortschritt.pruefe({ guildId: G, kennung: K, reparieren: true });
        assert.strictEqual(kaputt.abweichungen.length, 1);
        assert.deepStrictEqual((await Fortschritt.pruefe({ guildId: G, kennung: K })).abweichungen, []);
    });
    await pruefe('6k. Mitglied und Kennung entfernen', async () => {
        const r = await Fortschritt.entferneMitglied({ guildId: G, kennung: K, mitglied: A });
        assert.ok(r.buchungen > 0 && r.stand === 1 && r.saisonstand === 1, JSON.stringify(r));
        assert.ok(Number.isNaN(await xpVon(A)));
        assert.strictEqual(Number((await q('SELECT COUNT(*) AS n FROM fortschritt_stand WHERE guild_id = ? AND mitglied_id = ?', [G2, A]))[0].n), 1, 'andere Guild bleibt');
        const k = await Fortschritt.loescheKennung({ guildId: G, kennung: K });
        assert.ok(k.fortschritt_stufen === 5 && k.fortschritt_einstellungen === 2 && k.fortschritt_saisons === 3, JSON.stringify(k));
        for (const t of TABELLEN.filter((t) => t !== 'fortschritt_saison_stand')) {
            assert.strictEqual(Number((await q(`SELECT COUNT(*) AS n FROM ${t} WHERE guild_id = ?`, [G]))[0].n), 0, `${t} nicht leer`);
        }
    });
    await c.end();

    await pruefe('7a. Kern-Teil und Betreiber-Seite rendern, Texte de = en', () => {
        const ejs = require('ejs');
        const de = JSON.parse(fs.readFileSync(path.join(WURZEL, 'plugins/core/dashboard/locales/de-DE.json'), 'utf8'));
        const en = JSON.parse(fs.readFileSync(path.join(WURZEL, 'plugins/core/dashboard/locales/en-GB.json'), 'utf8'));
        const fehlt = [];
        const tr = (k) => { const v = sprachwert('de-DE', k); if (typeof v !== 'string') fehlt.push(k); return v || k; };
        const datei = path.join(WURZEL, 'apps/dashboard/themes/default/views/admin/fortschritt.ejs');
        const vorlage = fs.readFileSync(datei, 'utf8');
        const html = ejs.render(vorlage, { tr, ueberblick: { erklaerungen: liste, je: [], fehlt: null }, kontrollGuild: G, probeKennung: K }, { filename: datei });
        assert.deepStrictEqual(fehlt, []);
        assert.strictEqual((html.match(/data-fortschritt-stufen=/g) || []).length, 2);
        const deK = Object.keys(de.FORTSCHRITT).sort();
        assert.deepStrictEqual(Object.keys(en.FORTSCHRITT).sort(), deK);
        for (const s of Object.keys(Fortschritt.SCHABLONEN)) assert.ok(de.FORTSCHRITT[`SCHABLONE_${s.toUpperCase()}`], `SCHABLONE_${s}`);
        assert.ok(de.AUFBEWAHRUNG.FORTSCHRITT_BUCHUNGEN && en.AUFBEWAHRUNG.FORTSCHRITT_BUCHUNGEN);
    });
    await pruefe('7b. Routen, Navigation, Zeitplan eingetragen', () => {
        const lies = (p) => fs.readFileSync(path.join(WURZEL, p), 'utf8');
        const r = ohneKommentare(lies('apps/dashboard/routes/guild/settings.router.js'));
        for (const w of ["router.get('/fortschritt/:kennung'", "router.post('/fortschritt/:kennung/vorschlag', csrfProtection", "router.put('/fortschritt/:kennung/stufen', csrfProtection", "router.put('/fortschritt/:kennung/einstellungen', csrfProtection"]) assert.ok(r.includes(w), w);
        assert.ok(/requirePermission\(e\.recht\)[\s\S]{0,60}requireBesitzerInKontrollGuild/.test(r), 'Recht und Kontroll-Guild beim Schreiben');
        assert.ok(ohneKommentare(lies('apps/dashboard/routes/admin.router.js')).includes("router.post('/fortschritt/probe'"));
        assert.ok(ohneKommentare(lies('apps/dashboard/themes/default/partials/guild/sidebar.ejs')).includes("'/admin/fortschritt'"));
        assert.ok(ohneKommentare(lies('apps/dashboard/app.js')).includes("require('./helpers/FortschrittSaisons').starten()"));
        assert.ok(ohneKommentare(lies('packages/dunebot-sdk/index.js')).includes('Fortschritt,'));
    });

    await pruefe('8. Gegenproben: eingebaute Fehler werden rot', () => {
        const erklaert = (k) => ['leveling:community', 'clan:x'].includes(k);
        const p = (datei, code) => pruefeEigene([[path.join('plugins', ...datei.split('/')), code]], erklaert);
        assert.strictEqual(p('leveling/bot/a.js', "Fortschritt.buche({ guildId, kennung: 'leveling:community', mitglied, menge: 5, quelle: 'n' })").length, 0, 'eigene');
        assert.strictEqual(p('leveling/bot/a.js', "Fortschritt.buche({ guildId, kennung: 'clan:3', menge: 5 })").length, 1, 'fremde');
        assert.strictEqual(p('leveling/bot/a.js', 'Fortschritt.buche({ guildId, kennung, menge: 5 })').length, 1, 'nicht ablesbar');
        assert.strictEqual(p('leveling/bot/a.js', "Fortschritt.storniere({ guildId, kennung: 'leveling:alt', schluessel })").length, 1, 'nicht erklärt');
        assert.strictEqual(p('clan/bot/a.js', 'Fortschritt.buche({ guildId, kennung: `clan:${clanId}`, menge: 5 })').length, 0, 'Clan mit ID');
        assert.strictEqual(p('leveling/bot/a.js', "Fortschritt.stand({ guildId, kennung: 'clan:3', mitglied })").length, 0, 'lesen ist frei');
        assert.strictEqual(p('leveling/bot/a.js', "// Fortschritt.buche({ kennung: 'clan:3' })").length, 0, 'Kommentar');
        assert.strictEqual(pruefeEinWeg([['plugins/x/a.js', "await db.query('UPDATE fortschritt_stand SET xp = 0')"]]).length, 1, 'UPDATE');
        assert.strictEqual(pruefeEinWeg([['plugins/x/a.js', 'await db.query(`DELETE FROM fortschritt_buchungen WHERE 1`)']]).length, 1, 'DELETE');
        assert.strictEqual(pruefeEinWeg([['plugins/x/a.js', "await db.query('INSERT IGNORE INTO fortschritt_stand VALUES ()')"]]).length, 1, 'INSERT IGNORE');
        assert.strictEqual(pruefeEinWeg([['plugins/x/a.js', "await db.query('SELECT * FROM fortschritt_stand')"]]).length, 0, 'lesen');
        assert.strictEqual(pruefeEinWeg([[SDK, "await q('DELETE FROM fortschritt_stand')"]]).length, 0, 'das SDK selbst');
        const kaputt = Fortschritt.pruefeForm({ leveling: { fortschritt: [{ kennung: 'clan:x', titel: 'x', recht: '', schablone: 'krumm', extra: 1 }] } });
        for (const w of ['beginnt nicht', 'titel', 'recht', 'schablone', 'unbekannte']) assert.ok(kaputt.some((f) => f.includes(w)), w);
    });

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot\n` : '\n✅ Fortschritt: Buchen, Stufen, Ranglisten und Saisons halten\n');
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
