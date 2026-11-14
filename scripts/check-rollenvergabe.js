#!/usr/bin/env node
/**
 * Rollenvergabe mit Besitzer (G-07, F-G12, K382, 2026-11-14).
 *
 * Geprüft wird:
 *
 *   1  Ein Weg       `roles.add`/`roles.remove`/`roles.set` (und `members.addRole`,
 *                    `edit({ roles })`) nur in dunebot-sdk/lib/Rollen.js
 *   2  Erklärungen   `rollen` in jeder package.json fehlerfrei; jeder Besitzer im
 *                    Code ist erklärt und jeder erklärte wird benutzt; Titel in
 *                    de und en; jede Einstellung (`shared/rollen.js`) läuft
 *                    gegen die echte Datenbank (nur lesend) und liefert IDs
 *   3  Regeln        an einer TEMPORARY-Kopie von `rollen_vergaben` mit echtem
 *                    SQL, Discord als Attrappe: Regel 1 (zwei Besitzer, einer
 *                    nimmt → bleibt; ohne Eintrag nichts), Regel 2 (von Hand da →
 *                    kein Eintrag → nimm lässt stehen; anderer Besitzer hält →
 *                    mitgebucht ohne Discord), gibAb ohne Eintrag, gibAb bei
 *                    fremdem Besitzer, blockiert behält den Eintrag, je Rolle
 *                    ein Aufruf, Aufträge je Mitglied nacheinander
 *   4  Buch folgt    vergiss (Rollen, Mitglied), ungültige Rollen löschen nichts,
 *      Discord       Abgleich im Bot nur mit vollständiger Liste
 *   5  Dashboard     ohne Bot-Client geht der Auftrag über dashboard:ROLLEN, die
 *                    Antwort des Shards mit der Guild zählt, alle 10004 = weg;
 *                    der Bot-Handler weist Unsinn ab
 *   6  Migration     streaming_role_grants: Besitzer je Zeile (abo, live, beide)
 *   7  Seite         Recht, Navigation, Router, Ansichten übersetzen sich
 *   8  Gegenproben   jede Prüfung aus 1 und 2 wird an eingebauten Fehlern rot
 *
 * Geschrieben wird nur in TEMPORARY-Tabellen dieser Verbindung.
 *
 *   node scripts/check-rollenvergabe.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare } = require('./lib/quelltext');

const protokoll = [];
ServiceManager.register('Logger', {
    debug() {}, info() {}, success() {},
    warn: (...a) => protokoll.push(`warn ${a.join(' ')}`),
    error: (...a) => protokoll.push(`error ${a.map((x) => (x && x.message) || String(x)).join(' ')}`),
});

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 12).join('\n      ')}`); }
}

const RECHT_DATEI = 'packages/dunebot-sdk/lib/Rollen.js';
const SCHREIBEN = /\.roles\.(add|remove|set)\s*\(|\.members\.(addRole|removeRole)\s*\(|\.edit\s*\(\s*\{[^}]*\broles\s*:/;

/** .js unter apps, plugins, packages; ohne node_modules, vendor, public, backups. */
function quellen() {
    const aus = [];
    (function sammle(o) {
        for (const e of fs.readdirSync(path.join(WURZEL, o), { withFileTypes: true })) {
            if (['node_modules', 'vendor', 'public', 'backups', 'assets'].includes(e.name)) continue;
            const p = path.join(o, e.name);
            if (e.isDirectory()) sammle(p);
            else if (e.name.endsWith('.js')) aus.push(p);
        }
    })('apps');
    for (const o of ['plugins', 'packages']) {
        (function sammle(x) {
            for (const e of fs.readdirSync(path.join(WURZEL, x), { withFileTypes: true })) {
                if (['node_modules', 'vendor', 'public', 'backups', 'assets'].includes(e.name)) continue;
                const p = path.join(x, e.name);
                if (e.isDirectory()) sammle(p);
                else if (e.name.endsWith('.js')) aus.push(p);
            }
        })(o);
    }
    return aus;
}

// ── 1/2: reine Prüfungen, damit die Gegenproben sie wiederverwenden ──────

/** @param {Array<[string, string]>} dateien [pfad, quelltext] */
function pruefeEinWeg(dateien) {
    const aus = [];
    for (const [p, text] of dateien) {
        if (p === RECHT_DATEI) continue;
        const code = ohneKommentare(text);
        code.split('\n').forEach((z, i) => { if (SCHREIBEN.test(z)) aus.push(`${p}:${i + 1}: ${z.trim().slice(0, 90)}`); });
    }
    return aus;
}

/** Besitzer-Literale in Aufrufen von Rollen.* (vergib/nimm/gibAb/…). */
function benutzteBesitzer(dateien) {
    const aus = new Map();
    for (const [p, text] of dateien) {
        const code = ohneKommentare(text);
        if (!/\bRollen\b/.test(code) || p === RECHT_DATEI) continue;
        for (const m of code.matchAll(/besitzer\s*:\s*(?:\[\s*)?((?:'[a-z0-9_-]+:[a-z0-9_-]+'\s*,?\s*)+)/g)) {
            for (const b of m[1].matchAll(/'([a-z0-9_-]+:[a-z0-9_-]+)'/g)) {
                if (!aus.has(b[1])) aus.set(b[1], p);
            }
        }
    }
    return aus;
}

function pruefeBesitzer(erklaert, benutzt) {
    const aus = [];
    for (const [b, p] of benutzt) if (!erklaert.has(b)) aus.push(`${p}: Besitzer ${b} ist in keiner package.json unter rollen erklärt`);
    for (const b of erklaert) if (![...benutzt.keys()].includes(b)) aus.push(`erklärt, aber nirgends benutzt: ${b}`);
    return aus;
}

function sprachwert(plugin, sprache, schluessel) {
    const ns = schluessel.split(':')[0];
    const ordner = ns === 'core' ? 'core' : ns;
    const datei = path.join(WURZEL, 'plugins', ordner, 'dashboard/locales', `${sprache}.json`);
    if (!fs.existsSync(datei)) return undefined;
    let o = JSON.parse(fs.readFileSync(datei, 'utf8'));
    for (const t of schluessel.split(':')[1].split('.')) o = o?.[t];
    return o;
}

// ── 3: Attrappe Discord ──────────────────────────────────────────────────

const G = '900000000000000001';
const U = '900000000000000002';
const R = { a: '900000000000000011', b: '900000000000000012', hoch: '900000000000000013', verw: '900000000000000014' };

function welt({ traegt = [], recht = true } = {}) {
    const aufrufe = [];
    const rollen = new Map([
        [R.a, { id: R.a, name: 'A', position: 2, managed: false }],
        [R.b, { id: R.b, name: 'B', position: 3, managed: false }],
        [R.hoch, { id: R.hoch, name: 'Hoch', position: 20, managed: false }],
        [R.verw, { id: R.verw, name: 'Booster', position: 1, managed: true }],
    ]);
    const hat = new Set(traegt);
    const guild = {
        id: G,
        roles: { cache: rollen },
        members: {
            me: {
                permissions: { has: () => recht },
                roles: { highest: { comparePositionTo: (r) => 10 - r.position } },
            },
        },
    };
    const mitglied = {
        id: U, guild, user: { tag: 'probe' },
        roles: {
            cache: { has: (r) => hat.has(r) },
            add: async (r, grund) => {
                if (Array.isArray(r)) throw new Error('Liste an roles.add (PATCH der ganzen Liste)');
                aufrufe.push(['add', r, grund]);
                await new Promise((f) => setTimeout(f, 5));
                hat.add(r);
            },
            remove: async (r, grund) => {
                if (Array.isArray(r)) throw new Error('Liste an roles.remove');
                aufrufe.push(['remove', r, grund]);
                hat.delete(r);
            },
        },
    };
    guild.members.fetch = async () => mitglied;
    return { guild, mitglied, aufrufe, hat };
}

(async () => {
    console.log('\nRollenvergabe mit Besitzer (G-07)');
    const Rollen = require(path.join(WURZEL, RECHT_DATEI));
    const dateien = quellen().map((p) => [p, fs.readFileSync(path.join(WURZEL, p), 'utf8')]);

    await pruefe('1. Ein Weg: Rollen setzt nur dunebot-sdk/lib/Rollen.js', () => {
        assert.ok(SCHREIBEN.test(ohneKommentare(fs.readFileSync(path.join(WURZEL, RECHT_DATEI), 'utf8'))), 'die Suche findet nicht einmal den Kern — sie misst nicht mehr');
        assert.deepStrictEqual(pruefeEinWeg(dateien), []);
    });

    const { liste, fehler: erklFehler } = Rollen.erklaerungen({ neu: true });
    await pruefe(`2a. Erklärungen fehlerfrei (${liste.length} Besitzer)`, () => {
        assert.deepStrictEqual(erklFehler, []);
        assert.ok(liste.length >= 7, `nur ${liste.length} Besitzer erklärt`);
    });
    await pruefe('2b. Jeder benutzte Besitzer ist erklärt, jeder erklärte benutzt', () => {
        assert.deepStrictEqual(pruefeBesitzer(new Set(liste.map((e) => e.besitzer)), benutzteBesitzer(dateien)), []);
    });
    await pruefe('2c. Titel in de und en', () => {
        const fehlt = [];
        for (const e of liste) for (const s of ['de-DE', 'en-GB']) if (typeof sprachwert(e.plugin, s, e.titel) !== 'string') fehlt.push(`${e.titel} (${s})`);
        assert.deepStrictEqual(fehlt, []);
    });

    const mysql = require('mysql2/promise');
    const c = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
        supportBigNumbers: true, bigNumberStrings: true });
    const schreibt = [];
    const db = {
        async query(sql, werte) {
            const s = String(sql).trim();
            // Geschrieben wird nur in die TEMPORARY-Tabelle dieser Verbindung.
            if (!/^(SELECT|SHOW)\b/i.test(s) && !/\brollen_vergaben\b/.test(s) && !/^CREATE TEMPORARY TABLE/i.test(s)) {
                throw new Error(`nur lesend: ${s.slice(0, 60)}`);
            }
            if (!/^(SELECT|SHOW)\b/i.test(s)) schreibt.push(s.split('\n')[0]);
            return (await c.query(s, werte))[0];
        },
        async getConfig(plugin, schluessel, kontext, guildId) {
            const z = (await c.query('SELECT config_value FROM configs WHERE plugin_name = ? AND config_key = ? AND guild_id = ? LIMIT 1', [plugin, schluessel, guildId]))[0];
            return z[0]?.config_value ?? null;
        },
    };
    ServiceManager.register('dbService', db);

    try {
        // TEMPORARY-Kopie aus der DDL der Kern-Migration (die echte Tabelle gibt
        // es erst nach dem Neustart; ist sie da, verdeckt die Kopie sie).
        let ddl = null;
        await require(path.join(WURZEL, 'migrations/kern/20261114_230000_rollen_vergaben.js')).up({ query: async (s) => { ddl = s; } });
        await c.query(ddl.replace('CREATE TABLE IF NOT EXISTS', 'CREATE TEMPORARY TABLE'));

        await pruefe('2d. Jede Einstellung läuft gegen die echte Datenbank und liefert IDs', async () => {
            const guilds = (await c.query('SELECT DISTINCT guild_id FROM guild_plugins WHERE is_enabled = 1'))[0].map((z) => String(z.guild_id));
            assert.ok(guilds.length, 'keine Guild mit Plugins');
            const kaputt = [];
            let gesehen = 0;
            for (const e of liste) {
                const f = require(path.join(WURZEL, 'plugins', e.plugin, 'shared/rollen.js'))[e.besitzer];
                for (const g of guilds) {
                    let r;
                    try { r = await f({ guildId: g, db }); } catch (err) { kaputt.push(`${e.besitzer} in ${g}: ${err.message}`); continue; }
                    if (!Array.isArray(r) || r.some((x) => !/^\d{5,32}$/.test(String(x)))) kaputt.push(`${e.besitzer} in ${g}: ${JSON.stringify(r).slice(0, 80)}`);
                    gesehen += r?.length || 0;
                }
            }
            assert.deepStrictEqual(kaputt, []);
            assert.ok(gesehen > 0, 'keine Einstellung liefert irgendwo eine Rolle — misst die Prüfung noch?');
        });

        const buch = async () => (await c.query('SELECT rolle_id, besitzer FROM rollen_vergaben WHERE guild_id = ? AND mitglied_id = ? ORDER BY rolle_id, besitzer', [G, U]))[0]
            .map((z) => `${z.rolle_id === R.a ? 'a' : z.rolle_id === R.b ? 'b' : z.rolle_id === R.hoch ? 'hoch' : z.rolle_id}:${z.besitzer}`);
        const leeren = () => c.query('DELETE FROM rollen_vergaben');
        // Im Bot: Die Aufträge bringen `mitglied` oder `guild` mit, dann führt
        // Rollen sie hier aus (ohne `client` im ServiceManager, so prüft 5a den
        // Weg über IPC).

        await pruefe('3a. vergib: gibt in Discord und bucht; zweites Mal nichts', async () => {
            await leeren();
            const w = welt();
            const e = await Rollen.vergib({ mitglied: w.mitglied, rollen: R.a, besitzer: 'probe:eins', grund: 'Probe' });
            assert.deepStrictEqual(e.vergeben, [R.a]);
            assert.deepStrictEqual(await buch(), ['a:probe:eins']);
            assert.match(w.aufrufe[0][2], /^\[probe:eins\] Probe/, 'Besitzer im Audit-Log-Grund');
            const zwei = await Rollen.vergib({ mitglied: w.mitglied, rollen: R.a, besitzer: 'probe:eins' });
            assert.deepStrictEqual(zwei.unveraendert, [{ rolle: R.a, hinweis: 'SCHON_GEBUCHT' }]);
            assert.strictEqual(w.aufrufe.length, 1);
        });

        await pruefe('3b. Regel 1: zwei Besitzer, einer nimmt → bleibt; der zweite nimmt → weg', async () => {
            await leeren();
            const w = welt();
            await Rollen.vergib({ mitglied: w.mitglied, rollen: R.a, besitzer: 'probe:eins' });
            const zwei = await Rollen.vergib({ mitglied: w.mitglied, rollen: R.a, besitzer: 'probe:zwei' });
            assert.deepStrictEqual(zwei.gebucht, [R.a], 'zweiter Besitzer bucht dazu, ohne Discord');
            assert.strictEqual(w.aufrufe.length, 1);
            const n1 = await Rollen.nimm({ mitglied: w.mitglied, rollen: R.a, besitzer: 'probe:eins' });
            assert.deepStrictEqual(n1.gehalten.map((g) => g.von), [['probe:zwei']]);
            assert.ok(w.hat.has(R.a), 'Rolle ist weg, obwohl probe:zwei sie hält');
            assert.deepStrictEqual(await buch(), ['a:probe:zwei']);
            const n2 = await Rollen.nimm({ mitglied: w.mitglied, rollen: R.a, besitzer: 'probe:zwei' });
            assert.deepStrictEqual(n2.entzogen, [R.a]);
            assert.ok(!w.hat.has(R.a));
            assert.deepStrictEqual(await buch(), []);
        });

        await pruefe('3c. Regel 1: nimm ohne eigenen Eintrag tut nichts', async () => {
            await leeren();
            const w = welt({ traegt: [R.a] });
            const e = await Rollen.nimm({ mitglied: w.mitglied, rollen: R.a, besitzer: 'probe:eins' });
            assert.deepStrictEqual(e.unveraendert, [{ rolle: R.a, hinweis: 'KEIN_EINTRAG' }]);
            assert.ok(w.hat.has(R.a));
            assert.strictEqual(w.aufrufe.length, 0);
        });

        await pruefe('3d. Regel 2 (K391): von Hand da → kein Eintrag → nimm lässt stehen', async () => {
            await leeren();
            const w = welt({ traegt: [R.a] });
            const e = await Rollen.vergib({ mitglied: w.mitglied, rollen: R.a, besitzer: 'probe:eins' });
            assert.deepStrictEqual(e.unveraendert, [{ rolle: R.a, hinweis: 'HAT_SCHON' }]);
            assert.deepStrictEqual(await buch(), []);
            await Rollen.nimm({ mitglied: w.mitglied, rollen: R.a, besitzer: 'probe:eins' });
            assert.ok(w.hat.has(R.a), 'Handrolle weggenommen');
            assert.strictEqual(w.aufrufe.length, 0);
        });

        await pruefe('3e. gibAb ohne Eintrag nimmt die Rolle (vor G-07 vergeben)', async () => {
            await leeren();
            const w = welt({ traegt: [R.a] });
            const e = await Rollen.gibAb({ mitglied: w.mitglied, rollen: R.a, besitzer: 'probe:eins' });
            assert.deepStrictEqual(e.entzogen, [R.a]);
            assert.ok(!w.hat.has(R.a));
        });

        await pruefe('3f. gibAb bei fremdem Besitzer: bleibt, eigener Eintrag geht, Hinweis nennt ihn', async () => {
            await leeren();
            const w = welt();
            await Rollen.vergib({ mitglied: w.mitglied, rollen: R.a, besitzer: 'probe:fremd' });
            await Rollen.vergib({ mitglied: w.mitglied, rollen: R.a, besitzer: 'probe:eins' });
            const e = await Rollen.gibAb({ mitglied: w.mitglied, rollen: R.a, besitzer: 'probe:eins' });
            assert.deepStrictEqual(e.gehalten, [{ rolle: R.a, name: 'A', von: ['probe:fremd'] }]);
            assert.ok(w.hat.has(R.a));
            assert.deepStrictEqual(await buch(), ['a:probe:fremd']);
        });

        await pruefe('3g. Blockiert: zu hoch, verwaltet, weg, kein Recht; nimm behält den Eintrag', async () => {
            await leeren();
            const w = welt();
            const e = await Rollen.vergib({ mitglied: w.mitglied, rollen: [R.hoch, R.verw, '900000000000000099'], besitzer: 'probe:eins' });
            assert.deepStrictEqual(e.blockiert.map((b) => b.grund), ['ZU_HOCH', 'VERWALTET', 'WEG']);
            assert.deepStrictEqual(await buch(), []);
            await c.query('INSERT INTO rollen_vergaben (guild_id, mitglied_id, rolle_id, besitzer) VALUES (?, ?, ?, ?)', [G, U, R.hoch, 'probe:eins']);
            w.hat.add(R.hoch);
            const n = await Rollen.nimm({ mitglied: w.mitglied, rollen: R.hoch, besitzer: 'probe:eins' });
            assert.deepStrictEqual(n.blockiert.map((b) => b.grund), ['ZU_HOCH']);
            assert.deepStrictEqual(await buch(), ['hoch:probe:eins'], 'Eintrag weg, obwohl die Rolle noch dran ist');
            const ohne = welt({ recht: false });
            const k = await Rollen.vergib({ mitglied: ohne.mitglied, rollen: R.a, besitzer: 'probe:eins' });
            assert.deepStrictEqual(k.blockiert.map((b) => b.grund), ['KEIN_RECHT']);
            assert.strictEqual(w.aufrufe.length + ohne.aufrufe.length, 0);
        });

        await pruefe('3h. Je Rolle ein Aufruf, Aufträge je Mitglied nacheinander', async () => {
            await leeren();
            const w = welt();
            const reihe = [];
            const a = Rollen.vergib({ mitglied: w.mitglied, rollen: [R.a, R.b], besitzer: 'probe:eins' }).then(() => reihe.push('eins'));
            const b = Rollen.gibAb({ mitglied: w.mitglied, rollen: [R.a], besitzer: 'probe:zwei' }).then(() => reihe.push('zwei'));
            await Promise.all([a, b]);
            assert.deepStrictEqual(reihe, ['eins', 'zwei']);
            assert.deepStrictEqual(w.aufrufe.map((x) => x[0] + ':' + (x[1] === R.a ? 'a' : 'b')), ['add:a', 'add:b'],
                'gibAb lief vor dem Ende von vergib oder nahm die Rolle trotz probe:eins');
        });

        await pruefe('3i. Mitglied nicht mehr da: vergib nichts, nimm leert das eigene Gedächtnis', async () => {
            await leeren();
            await c.query('INSERT INTO rollen_vergaben (guild_id, mitglied_id, rolle_id, besitzer) VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
                [G, U, R.a, 'probe:eins', G, U, R.a, 'probe:zwei']);
            const w = welt();
            w.guild.members.fetch = async () => { const e = new Error('Unknown Member'); e.code = 10007; throw e; };
            const v = await Rollen.vergib({ guild: w.guild, userId: U, rollen: R.a, besitzer: 'probe:eins' });
            assert.strictEqual(v.kein_mitglied, true);
            await Rollen.nimm({ guild: w.guild, userId: U, rollen: R.a, besitzer: 'probe:eins' });
            assert.deepStrictEqual(await buch(), ['a:probe:zwei']);
        });

        await pruefe('4a. Buch folgt Discord: vergiss je Rolle, je Mitglied; ungültige Rollen löschen nichts', async () => {
            await leeren();
            await c.query('INSERT INTO rollen_vergaben (guild_id, mitglied_id, rolle_id, besitzer) VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
                [G, U, R.a, 'probe:eins', G, U, R.b, 'probe:eins']);
            assert.strictEqual(await Rollen.vergiss(G, { mitgliedId: U, rollen: ['kaputt'] }), 0);
            assert.strictEqual(await Rollen.vergiss(G, { mitgliedId: U, rollen: [] }), 0);
            assert.deepStrictEqual(await buch(), ['a:probe:eins', 'b:probe:eins']);
            assert.strictEqual(await Rollen.vergiss(G, { rollen: [R.a] }), 1);
            assert.strictEqual(await Rollen.vergiss(G, { mitgliedId: U }), 1);
            assert.deepStrictEqual(await buch(), []);
        });

        await pruefe('4b. Abgleich im Bot: halbe Liste löscht nichts, volle löscht nur Veraltetes', async () => {
            await leeren();
            await c.query('INSERT INTO rollen_vergaben (guild_id, mitglied_id, rolle_id, besitzer) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)',
                [G, U, R.a, 'probe:eins', G, U, R.b, 'probe:eins', G, '900000000000000003', R.a, 'probe:eins']);
            const Mitglieder = require(path.join(WURZEL, 'apps/bot/helpers/Mitglieder.js'));
            const echt = Mitglieder.holen;
            const w = welt({ traegt: [R.a] });
            const client = { guilds: { cache: new Map([[G, w.guild]]) } };
            const handler = require(path.join(WURZEL, 'apps/bot/ipc/ROLLEN_ABGLEICH.js'));
            try {
                Mitglieder.holen = async () => ({ mitglieder: new Map([[U, w.mitglied]]), vollstaendig: false, grund: 'Frist' });
                const halb = await handler({ guildIds: [G, '900000000000000077'] }, client);
                assert.strictEqual(halb.geloescht, 0);
                assert.strictEqual(halb.fremd, 1);
                assert.strictEqual(halb.uebersprungen.length, 1);
                Mitglieder.holen = async () => ({ mitglieder: new Map([[U, w.mitglied]]), vollstaendig: true, grund: null });
                const voll = await handler({ guildIds: [G] }, client);
                assert.strictEqual(voll.geloescht, 2, 'b (trägt sie nicht) und das gegangene Mitglied');
                assert.deepStrictEqual(await buch(), ['a:probe:eins']);
            } finally {
                Mitglieder.holen = echt;
            }
        });

        await pruefe('5a. Dashboard: Auftrag über dashboard:ROLLEN, Antwort des Shards mit der Guild', async () => {
            assert.ok(!ServiceManager.has('client'), 'Aufbau: client registriert, der IPC-Weg wäre nicht geprüft');
            const gesendet = [];
            const antwort = { vergeben: [R.a], entzogen: [], gebucht: [], blockiert: [], gehalten: [], unveraendert: [], kein_mitglied: false, fehler: null, code: null };
            ServiceManager.register('ipcServer', { broadcast: async (ereignis, nutzlast, _r, opt) => {
                gesendet.push({ ereignis, nutzlast, opt });
                return [{ success: true, data: { success: false, error: 'Guild nicht gefunden', code: 10004 } },
                        { success: true, data: { success: true, ergebnis: antwort } }];
            } });
            const e = await Rollen.vergib({ guildId: G, userId: U, rollen: [R.a, 'kaputt'], besitzer: 'probe:eins', frist_ms: 1234 });
            assert.deepStrictEqual(e, antwort);
            assert.strictEqual(gesendet[0].ereignis, 'dashboard:ROLLEN');
            assert.deepStrictEqual(gesendet[0].nutzlast.rollen, [R.a]);
            assert.strictEqual(gesendet[0].nutzlast.art, 'vergib');
            assert.strictEqual(gesendet[0].opt.timeout, 1234);
            ServiceManager.register('ipcServer', { broadcast: async () => [{ success: true, data: { success: false, error: 'Guild nicht gefunden', code: 10004 } }] });
            const weg = await Rollen.nimm({ guildId: G, userId: U, rollen: R.a, besitzer: 'probe:eins' });
            assert.strictEqual(weg.code, 10004);
            ServiceManager.register('ipcServer', { broadcast: async () => [] });
            const still = await Rollen.nimm({ guildId: G, userId: U, rollen: R.a, besitzer: 'probe:eins' });
            assert.match(still.fehler, /keine Antwort/);
            await assert.rejects(Rollen.vergib({ guildId: G, userId: U, rollen: R.a, besitzer: 'Kaputt' }), /ungültig/);
        });

        await pruefe('5b. Bot-Handler ROLLEN weist Unsinn ab, fremde Guild = 10004', async () => {
            const handler = require(path.join(WURZEL, 'apps/bot/ipc/ROLLEN.js'));
            const client = { guilds: { cache: new Map() } };
            assert.strictEqual((await handler({ art: 'loesche', guildId: G, userId: U, besitzer: 'a:b' }, client)).success, false);
            assert.strictEqual((await handler({ art: 'vergib', guildId: 'x', userId: U, besitzer: 'a:b' }, client)).success, false);
            assert.strictEqual((await handler({ art: 'vergib', guildId: G, userId: U, besitzer: 'A B' }, client)).success, false);
            assert.strictEqual((await handler({ art: 'vergib', guildId: G, userId: U, besitzer: 'a:b', rollen: [R.a] }, client)).code, 10004);
        });

        await pruefe('6. Migration streaming: Besitzer je Zeile (abo, live, beide, alte Rolle → live)', async () => {
            const m = require(path.join(WURZEL, 'plugins/streaming/migrations/20261114_230000_rollenbuch_in_den_kern.js'));
            const zeilen = await m.zeilenMitBesitzer({ query: async (sql) => {
                if (/FROM streaming_role_grants/.test(sql)) return [
                    { guild_id: 'g', mitglied_id: '1', rolle_id: 'abo', vergeben_am: null },
                    { guild_id: 'g', mitglied_id: '1', rolle_id: 'live', vergeben_am: null },
                    { guild_id: 'g', mitglied_id: '1', rolle_id: 'beide', vergeben_am: null },
                    { guild_id: 'g', mitglied_id: '1', rolle_id: 'alt', vergeben_am: null },
                    { guild_id: 'h', mitglied_id: '1', rolle_id: 'abo', vergeben_am: null }];
                if (/FROM streaming_targets/.test(sql)) return [{ guild_id: 'g', abo_rolle_id: 'abo' }];
                if (/FROM configs/.test(sql)) return [{ guild_id: 'g', config_key: 'LIVE_ROLLE_ID', config_value: 'live' },
                    { guild_id: 'g', config_key: 'LIVE_ROLLE_ID', config_value: 'beide' }, { guild_id: 'g', config_key: 'ABO_ROLLE_ID', config_value: 'beide' }];
                throw new Error(sql);
            } });
            assert.deepStrictEqual(zeilen.map((z) => `${z.guild_id}:${z.rolle_id}=${z.besitzer.join('+')}`),
                ['g:abo=streaming:abo', 'g:live=streaming:live', 'g:beide=streaming:abo+streaming:live', 'g:alt=streaming:live', 'h:abo=streaming:live']);
        });
    } finally {
        await c.end();
    }

    await pruefe('7. Seite: Recht, Navigation, Router, Ansichten übersetzen sich', () => {
        const rechte = JSON.parse(fs.readFileSync(path.join(WURZEL, 'packages/dunebot-core/config/permissions.json'), 'utf8'));
        const alle = JSON.stringify(rechte);
        assert.ok(alle.includes('"CORE.ROLLEN.VIEW"'), 'CORE.ROLLEN.VIEW fehlt im Katalog');
        assert.match(fs.readFileSync(path.join(WURZEL, 'migrations/kern/20261114_231000_rollen_rechte.js'), 'utf8'), /'CORE\.ROLLEN\.VIEW'/);
        const nav = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'apps/dashboard/helpers/KernNavigation.js'), 'utf8'));
        assert.match(nav, /url: `\/guild\/\$\{guildId\}\/rollenvergabe`,[\s\S]{0,200}capability: 'CORE\.ROLLEN\.VIEW'/);
        const router = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'apps/dashboard/routes/guild/rollenvergabe.router.js'), 'utf8'));
        assert.match(router, /router\.get\('\/', requirePermission\('CORE\.ROLLEN\.VIEW'\)/);
        assert.match(ohneKommentare(fs.readFileSync(path.join(WURZEL, 'apps/dashboard/routes/guild.router.js'), 'utf8')),
            /router\.use\("\/:guildId\/rollenvergabe", CheckAuth, CheckGuildAccess, rollenvergabeRouter\)/);
        const ejs = require('ejs');
        const fehlt = [];
        for (const v of ['guild/rollenvergabe.ejs', 'shared/rollen-hinweis.ejs']) {
            const text = fs.readFileSync(path.join(WURZEL, 'apps/dashboard/themes/default/views', v), 'utf8');
            ejs.compile(text, { client: false });
            for (const m of ohneKommentare(text).matchAll(/_t\('([A-Z_]+)'\s*[,)]/g)) {
                for (const s of ['de-DE', 'en-GB']) if (typeof sprachwert('core', s, `core:ROLLENVERGABE.${m[1]}`) !== 'string') fehlt.push(`${m[1]} (${s})`);
            }
        }
        for (const p of Object.values(Rollen.GRUND).filter((g) => g !== 'FEHLER')) {
            for (const s of ['de-DE', 'en-GB']) if (typeof sprachwert('core', s, `core:ROLLENVERGABE.PROBLEM_${p}`) !== 'string') fehlt.push(`PROBLEM_${p} (${s})`);
        }
        for (const s of ['de-DE', 'en-GB']) {
            const nav2 = JSON.parse(fs.readFileSync(path.join(WURZEL, `apps/dashboard/locales/${s}.json`), 'utf8'));
            if (typeof nav2.NAV?.ROLLENVERGABE !== 'string') fehlt.push(`NAV.ROLLENVERGABE (${s})`);
            for (const k of ['PERM_ROLLEN_VIEW', 'PERM_ROLLEN_VIEW_DESC']) if (typeof sprachwert('core', s, `core:${k}`) !== 'string') fehlt.push(`${k} (${s})`);
        }
        assert.deepStrictEqual(fehlt, []);
    });

    await pruefe('8. Gegenproben: eingebaute Fehler werden rot', () => {
        assert.strictEqual(pruefeEinWeg([['plugins/x/bot/a.js', 'await member.roles.add(rolle);']]).length, 1, 'roles.add');
        assert.strictEqual(pruefeEinWeg([['plugins/x/bot/a.js', 'await m.roles.remove([a, b], "x");']]).length, 1, 'roles.remove');
        assert.strictEqual(pruefeEinWeg([['plugins/x/bot/a.js', 'await m.roles.set([]);']]).length, 1, 'roles.set');
        assert.strictEqual(pruefeEinWeg([['plugins/x/bot/a.js', 'await guild.members.addRole({ user, role });']]).length, 1, 'members.addRole');
        assert.strictEqual(pruefeEinWeg([['plugins/x/bot/a.js', 'await member.edit({ roles: [] });']]).length, 1, 'edit roles');
        assert.strictEqual(pruefeEinWeg([['plugins/x/bot/a.js', '// member.roles.add(rolle) im Kommentar']]).length, 0, 'Kommentar');
        assert.strictEqual(pruefeEinWeg([[RECHT_DATEI, 'await member.roles.add(rolle);']]).length, 0, 'der Kern selbst');
        const benutzt = benutzteBesitzer([['plugins/x/a.js', "Rollen.vergib({ besitzer: 'x:neu' }); Rollen.eintraege(g, { besitzer: ['x:a', 'x:b'] });"]]);
        assert.deepStrictEqual([...benutzt.keys()], ['x:neu', 'x:a', 'x:b']);
        assert.strictEqual(pruefeBesitzer(new Set(['x:a', 'x:b']), benutzt).length, 1, 'unerklärter Besitzer');
        assert.strictEqual(pruefeBesitzer(new Set(['x:a', 'x:b', 'x:neu', 'x:tot']), benutzt).length, 1, 'erklärt, nie benutzt');
    });

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot\n` : '\n✅ Rollenvergabe: ein Weg, Regeln halten\n');
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
