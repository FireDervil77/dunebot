#!/usr/bin/env node
/**
 * Plugin abschalten: Jede Tabelle mit `guild_id` steht in einer Liste (K067, 2026-11-07).
 *
 * Alle Guilds teilen sich eine Datenbank. Schaltet eine Guild ein Plugin ab,
 * gehen ihre Zeilen, die Tabellen bleiben (Betreiber 2026-11-07). Welche
 * Tabellen, nennt das Plugin in seiner package.json:
 *
 *   "guildInhalte": {
 *     "loeschen": ["kind_tabelle", "eltern_tabelle"],
 *     "bleiben":  { "tabelle": "Grund, warum die Zeilen der Guild bleiben" }
 *   }
 *
 * Bis dahin fragte der Kern `getDatabaseTables()`, das kein Plugin hatte, und
 * gelöscht wurde nur, was ein `onGuildDisable` von Hand löschte: automod,
 * moderation und discord gar nichts, streaming neun von zwölf Tabellen nicht.
 *
 * Der Kern (`plugins/core`) lässt sich nicht abschalten. Seine Liste gilt für
 * „Guild löschen“ (G-04b, `Datenauskunft.guildLoeschen`) und nennt alle
 * Tabellen, die kein Plugin anlegt (Besitz wie bei G-01/G-04a). Die Guild
 * steht dort auch in `guildId` (Navigation) und in `guilds._id`.
 *
 *   Besitz       jede Tabelle aus einem CREATE TABLE im Plugin-Ordner gehört
 *                genau einem Plugin
 *   Vollständig  jede eigene Tabelle mit `guild_id` steht in `loeschen` oder in
 *                `bleiben` (mit Grund); nichts Fremdes, nichts Erfundenes
 *   Reihenfolge  ein Fremdschlüssel ohne CASCADE: Kind vor Eltern
 *   Echt         DBService.loescheGuildZeilen läuft je Liste gegen die echte
 *                Datenbank, mit einer Guild ohne Zeilen (`0`)
 *   Ein Weg      kein `onGuildDisable` löscht Zeilen einer Tabelle seiner Liste
 *   Dialog       der rote Dialog nennt genau die Plugins mit Liste, Texte in
 *                beiden Sprachen
 *   Kern         disableInGuild löscht über die Liste, nicht mehr über
 *                getDatabaseTables
 *
 *   node scripts/check-guild-inhalte.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

const KERN = 'core';
let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 12).join('\n      ')}`); }
}
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), 'utf8');

/** .js und .sql eines Plugins, ohne node_modules und ohne Browser-Skripte. */
function quellen(ordner, liste = []) {
    for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === 'assets') continue;
        const p = path.join(ordner, e.name);
        if (e.isDirectory()) quellen(p, liste);
        else if (/\.(js|sql)$/.test(e.name)) liste.push(p);
    }
    return liste;
}

/** Was ein Plugin anlegt: die Namen aus CREATE TABLE, Kommentare ausgenommen. */
function angelegt(plugin) {
    const namen = new Set();
    for (const datei of quellen(path.join(WURZEL, 'plugins', plugin))) {
        let text = fs.readFileSync(datei, 'utf8');
        text = datei.endsWith('.sql')
            ? text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*--.*$/gm, '')
            : ohneKommentare(text);
        for (const t of text.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([a-z][a-z0-9_]*)`?/gi)) namen.add(t[1]);
    }
    return namen;
}

/** Der Rumpf von onGuildDisable im Dashboard-Teil, ohne Kommentare. */
function abschalter(plugin) {
    const datei = path.join(WURZEL, 'plugins', plugin, 'dashboard', 'index.js');
    if (!fs.existsSync(datei)) return '';
    const text = ohneKommentare(fs.readFileSync(datei, 'utf8'));
    const ab = text.indexOf('async onGuildDisable(');
    if (ab < 0) return '';
    return text.slice(ab, text.indexOf('\n    }\n', ab));
}

(async () => {
    console.log('\nGuild-Inhalte beim Abschalten (K067)');
    const plugins = fs.readdirSync(path.join(WURZEL, 'plugins'))
        .filter(p => fs.existsSync(path.join(WURZEL, 'plugins', p, 'package.json')));
    const meta = Object.fromEntries(plugins.map(p => [p, JSON.parse(lies(`plugins/${p}/package.json`))]));
    const listen = Object.fromEntries(plugins.map(p => [p, {
        loeschen: meta[p].guildInhalte?.loeschen || [],
        bleiben: meta[p].guildInhalte?.bleiben || {},
    }]));

    const { DBService } = require('dunebot-db-client');
    const db = new DBService();
    ServiceManager.register('dbService', db);
    try {
        const tabellen = await db.query(
            'SELECT TABLE_NAME AS t, TABLE_TYPE AS art FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
        const vorhanden = new Set(tabellen.map(r => r.t));
        const sichten = new Set(tabellen.filter(r => r.art === 'VIEW').map(r => r.t));
        const guildSpalte = await db.guildSpalten([...vorhanden].filter(t => !sichten.has(t)));
        const mitGuild = new Set(Object.keys(guildSpalte).filter(t => guildSpalte[t]));
        const besitz = Object.fromEntries(plugins.map(p => [p, angelegt(p)]));
        // Was kein Plugin anlegt, gehört dem Kern.
        const vonPlugins = new Set(plugins.flatMap(p => [...besitz[p]]));
        for (const t of vorhanden) if (!sichten.has(t) && !vonPlugins.has(t)) besitz[KERN].add(t);

        await pruefe('Besitz: jede vorhandene Tabelle legt genau ein Plugin an', async () => {
            const wer = {};
            for (const p of plugins) for (const t of besitz[p]) if (vorhanden.has(t)) (wer[t] ||= []).push(p);
            const doppelt = Object.entries(wer).filter(([, v]) => v.length > 1).map(([t, v]) => `${t}: ${v.join(', ')}`);
            assert.deepStrictEqual(doppelt, [], 'zwei Plugins legen dieselbe Tabelle an');
        });

        await pruefe('Vollständig: jede eigene Tabelle mit guild_id steht in loeschen oder bleiben', async () => {
            const meldungen = [];
            for (const p of plugins) {
                const { loeschen, bleiben } = listen[p];
                for (const t of besitz[p]) {
                    if (!mitGuild.has(t)) continue;
                    const n = (loeschen.includes(t) ? 1 : 0) + (t in bleiben ? 1 : 0);
                    if (n === 0) meldungen.push(`${p}: ${t} fehlt in guildInhalte`);
                    if (n === 2) meldungen.push(`${p}: ${t} steht in loeschen UND bleiben`);
                }
                for (const t of [...loeschen, ...Object.keys(bleiben)]) {
                    if (!vorhanden.has(t)) meldungen.push(`${p}: ${t} gibt es nicht`);
                    else if (!mitGuild.has(t)) meldungen.push(`${p}: ${t} hat keine Guild-Spalte (guild_id, guildId, guilds._id)`);
                    else if (!besitz[p].has(t)) meldungen.push(`${p}: ${t} legt ein anderes Plugin an`);
                }
                for (const [t, grund] of Object.entries(bleiben)) {
                    if (!String(grund || '').trim()) meldungen.push(`${p}: ${t} bleibt ohne Grund`);
                }
                if (new Set(loeschen).size !== loeschen.length) meldungen.push(`${p}: loeschen nennt eine Tabelle doppelt`);
            }
            assert.deepStrictEqual(meldungen, []);
        });

        await pruefe('Reihenfolge: Fremdschlüssel ohne CASCADE — Kind vor Eltern', async () => {
            const fk = await db.query(`
                SELECT k.TABLE_NAME AS kind, k.REFERENCED_TABLE_NAME AS eltern, r.DELETE_RULE AS regel
                  FROM information_schema.KEY_COLUMN_USAGE k
                  JOIN information_schema.REFERENTIAL_CONSTRAINTS r
                       ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
                 WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL`);
            const meldungen = [];
            for (const p of plugins) {
                const l = listen[p].loeschen;
                for (const { kind, eltern, regel } of fk) {
                    if (regel === 'CASCADE' || regel === 'SET NULL' || kind === eltern) continue;
                    const ik = l.indexOf(kind), ie = l.indexOf(eltern);
                    if (ik >= 0 && ie >= 0 && ik > ie) meldungen.push(`${p}: ${kind} (${regel} auf ${eltern}) muss vor ${eltern} stehen`);
                }
            }
            assert.deepStrictEqual(meldungen, []);
        });

        await pruefe('Echt: loescheGuildZeilen läuft je Liste, mit einer Guild ohne Zeilen', async () => {
            for (const p of plugins) {
                const l = listen[p].loeschen;
                if (!l.length) continue;
                for (const t of l) {
                    const [{ n }] = await db.query(`SELECT COUNT(*) AS n FROM \`${t}\` WHERE \`${guildSpalte[t]}\` = ?`, ['0']);
                    assert.strictEqual(Number(n), 0, `${t} hat Zeilen mit guild_id 0 — die Probe würde sie löschen`);
                }
                const ergebnis = await db.loescheGuildZeilen(l, '0');
                assert.deepStrictEqual(Object.keys(ergebnis), l, `${p}: nicht jede Tabelle gelaufen`);
                assert.ok(Object.values(ergebnis).every(n => n === 0), `${p}: ${JSON.stringify(ergebnis)}`);
            }
            for (const falsch of ['', undefined, null, 'abc', '1 OR 1=1']) {
                await assert.rejects(db.loescheGuildZeilen(['configs'], falsch), /ungültige Guild-ID/, `„${falsch}" angenommen`);
            }
            await assert.rejects(db.loescheGuildZeilen(['configs; DROP TABLE x'], '1'), /ungültiger Tabellenname/);
        });

        await pruefe('Ein Weg: kein onGuildDisable löscht Zeilen einer Tabelle seiner Liste', async () => {
            const meldungen = [];
            for (const p of plugins) {
                const rumpf = abschalter(p);
                for (const t of listen[p].loeschen) {
                    if (new RegExp(`DELETE\\s+FROM\\s+\`?${t}\`?\\b`, 'i').test(rumpf)) meldungen.push(`${p}: onGuildDisable löscht ${t} selbst`);
                }
                if (/DELETE\s+FROM\s+configs\b/i.test(rumpf)) meldungen.push(`${p}: onGuildDisable löscht configs selbst`);
            }
            assert.deepStrictEqual(meldungen, []);
        });

        await pruefe('Dialog: nennt genau die Plugins mit Liste, Texte in beiden Sprachen', async () => {
            const q = ohneKommentareEjs(lies('apps/dashboard/themes/default/views/guild/plugins.ejs'));
            const imDialog = [...q.match(/MIT_INHALTEN = \[([^\]]+)\]/)[1].matchAll(/'([a-z]+)'/g)].map(t => t[1]).sort();
            const soll = plugins.filter(p => p !== KERN && listen[p].loeschen.length && !meta[p].nurKontrollGuild).sort();
            assert.deepStrictEqual(imDialog, soll);
            const de = JSON.parse(lies('apps/dashboard/locales/de-DE.json')).ADMIN_PAGE;
            const en = JSON.parse(lies('apps/dashboard/locales/en-GB.json')).ADMIN_PAGE;
            for (const p of soll) {
                const k = `DISABLE_GOES_${p.toUpperCase()}`;
                assert.ok(de[k] && en[k], `Text ${k} fehlt`);
            }
        });

        await pruefe('Kern: disableInGuild löscht über guildInhalte, nicht über getDatabaseTables', async () => {
            const kern = ohneKommentare(lies('apps/dashboard/helpers/PluginManager.js'));
            const ab = kern.indexOf('async disableInGuild(');
            const rumpf = kern.slice(ab, kern.indexOf('\n    }\n', ab));
            assert.doesNotMatch(rumpf, /getDatabaseTables/);
            assert.match(rumpf, /guildInhalte\?\.loeschen/);
            assert.match(rumpf, /dbService\.loescheGuildZeilen\(tabellen, guildId\)/);
        });
    } finally {
        await db.pool.end();
    }

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ Jede Tabelle mit guild_id steht in einer Liste, der Kern löscht danach');
    process.exit(fehler ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
