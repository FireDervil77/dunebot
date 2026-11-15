#!/usr/bin/env node
'use strict';

/**
 * Wächter der Messprobe Nachrichtenmenge (G-18, K382, 2026-11-15).
 *
 * Quelltext:
 *   1. Die vier Kern-Events des Bots (messageCreate, messageUpdate,
 *      messageDelete, messageDeleteBulk) rufen den Zähler; messageCreate,
 *      -Update, -Delete rufen weiter SpieleUpdates.
 *   2. `messprobe_nachrichten` schreibt nur `apps/bot/helpers/Messprobe.js`.
 *   3. Der Kern erklärt die Tabelle in `guildInhalte.loeschen` (vor `guilds`).
 *   4. In der Tabelle steht keine Mitglieds-, Kanal- oder Nachrichten-ID.
 * Läufe an einer TEMPORARY-Kopie der Kern-Migration (echte Tabelle unberührt):
 *   5. Menschen, Bots, Webhooks, Direktnachrichten; Bytes in UTF-8; Anhänge.
 *   6. `mitglied_minuten` zählt jedes Paar (Mitglied, Minute) einmal, auch über
 *      mehrere Schreibläufe derselben Minute.
 *   7. Zweiter Schreiblauf ohne Neues schreibt nichts dazu; Stundenwechsel
 *      ergibt eine neue Zeile, die alte Stunde fällt aus dem Speicher.
 *   8. Bearbeitet nur mit neuem Bearbeitungszeitpunkt; gelöscht einzeln und
 *      gesammelt.
 *   9. Scheitert das Schreiben, bleibt alles gezählt; Fehler einmal je Stunde
 *      im Log, mit Error-Objekt.
 *  10. Nach 7 × 24 + 1 Stunden ab der ältesten Zeile hört der Zähler auf.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare } = require('./lib/quelltext');

const MIGRATION = 'migrations/kern/20261115_120000_messprobe_nachrichten.js';
const HELFER = 'apps/bot/helpers/Messprobe.js';
const TABELLE = 'messprobe_nachrichten';

const protokoll = [];
ServiceManager.register('Logger', {
    debug() {}, success() {}, warn() {},
    info(...a) { protokoll.push(['info', ...a]); },
    error(...a) { protokoll.push(['error', ...a]); },
});
const { Messprobe, stundeVon } = require(path.join(WURZEL, HELFER));

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 12).join('\n      ')}`); }
}

const lies = (p) => ohneKommentare(fs.readFileSync(path.join(WURZEL, p), 'utf8'));

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

async function main() {
    console.log('check-messprobe (G-18)');

    await pruefe('1. Kern-Events rufen den Zähler', async () => {
        const soll = {
            messageCreate: [/Messprobe\.nachricht\(\s*message\s*\)/, /SpieleUpdates\.beiNachricht\(/],
            messageUpdate: [/Messprobe\.bearbeitet\(\s*alt\s*,\s*neu\s*\)/, /SpieleUpdates\.beiNachricht\(/],
            messageDelete: [/Messprobe\.geloescht\(/, /SpieleUpdates\.beiLoeschung\(/],
            messageDeleteBulk: [/Messprobe\.geloescht\(\s*kanal\?\.guildId\s*,\s*nachrichten\?\.size/],
        };
        for (const [ereignis, muster] of Object.entries(soll)) {
            const code = lies(`apps/bot/events/${ereignis}.js`);
            for (const m of muster) assert.ok(m.test(code), `apps/bot/events/${ereignis}.js: ${m} fehlt`);
            assert.ok(/require\(\s*["']\.\.\/helpers\/Messprobe["']\s*\)/.test(code), `${ereignis}: Messprobe nicht eingebunden`);
        }
    });

    await pruefe('2. Nur der Helfer schreibt die Tabelle', async () => {
        const schreibt = new RegExp(`\\b(INSERT\\s+(IGNORE\\s+)?INTO|UPDATE|DELETE\\s+FROM|REPLACE\\s+INTO|TRUNCATE(\\s+TABLE)?)\\s+\`?${TABELLE}\\b`, 'i');
        const fremd = quellen().filter(([p, t]) => p !== HELFER && schreibt.test(ohneKommentare(t))).map(([p]) => p);
        assert.deepStrictEqual(fremd, []);
        assert.ok(schreibt.test(lies(HELFER)), 'Helfer schreibt nicht mehr');
    });

    await pruefe('3. Kern erklärt die Tabelle für „Guild löschen“', async () => {
        const liste = JSON.parse(fs.readFileSync(path.join(WURZEL, 'plugins/core/package.json'), 'utf8')).guildInhalte.loeschen;
        assert.ok(liste.includes(TABELLE), `${TABELLE} fehlt in guildInhalte.loeschen`);
        assert.ok(liste.indexOf(TABELLE) < liste.indexOf('guilds'), 'muss vor guilds stehen');
    });

    const ddl = [];
    await require(path.join(WURZEL, MIGRATION)).up({ query: async (s) => { ddl.push(s); } });

    await pruefe('4. Keine IDs außer der Guild', async () => {
        const spalten = [...ddl.join('\n').matchAll(/^\s*([a-z_]+)\s+(VARCHAR|INT|BIGINT|DATETIME)/gim)].map((m) => m[1]);
        assert.deepStrictEqual(spalten.filter((s) => /_id$/.test(s)), ['guild_id']);
    });

    const mysql = require('mysql2/promise');
    const c = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
        dateStrings: true, supportBigNumbers: true, bigNumberStrings: true });
    const schreibend = /^\s*(INSERT|UPDATE|DELETE|REPLACE|TRUNCATE|CREATE|DROP|ALTER)\b/i;
    let kaputt = false;
    let schreibvorgaenge = 0;
    async function q(sql, werte) {
        const s = String(sql);
        if (schreibend.test(s) && !/^\s*CREATE TEMPORARY TABLE/i.test(s) && !new RegExp(`\\b${TABELLE}\\b`).test(s)) throw new Error(`nur lesend: ${s.slice(0, 60)}`);
        if (kaputt) throw new Error('Probe: Datenbank weg');
        if (/^\s*INSERT/i.test(s)) schreibvorgaenge++;
        return (await c.query(s, werte))[0];
    }
    ServiceManager.register('dbService', { query: q });

    try {
        for (const s of ddl) await c.query(s.replace('CREATE TABLE IF NOT EXISTS', 'CREATE TEMPORARY TABLE'));
        const zeile = async (g, stunde) => (await q(`SELECT * FROM ${TABELLE} WHERE guild_id = ? AND stunde = ?`, [g, stunde]))[0];

        const T0 = Date.UTC(2026, 10, 15, 10, 0, 5);
        let jetzt = T0;
        const m = new Messprobe({ uhr: () => jetzt });
        const G = '900000000000000001';
        const H = '900000000000000002';
        const msg = (o) => ({ guildId: G, author: { id: 'a', bot: false }, content: '', attachments: { size: 0 }, ...o });

        await pruefe('5. Menschen, Bots, Webhooks, Direktnachrichten, Bytes, Anhänge', async () => {
            m.nachricht(msg({ content: 'hallo' }));
            m.nachricht(msg({ author: { id: 'b' }, content: 'äöü', attachments: { size: 2 } }));
            m.nachricht(msg({ author: { id: 'bot', bot: true }, content: 'x' }));
            m.nachricht(msg({ author: { id: 'w', bot: false }, webhookId: '1', content: 'yy' }));
            m.nachricht(msg({ guildId: null, content: 'dm' }));
            m.nachricht(msg({ guildId: H, content: 'z' }));
            await m.schreibe();
            const z = await zeile(G, stundeVon(T0));
            assert.ok(z, 'keine Zeile');
            assert.deepStrictEqual([z.menschen, z.bots, z.inhalt_bytes, z.anhaenge].map(Number), [2, 2, 5 + 6 + 1 + 2, 2]);
            assert.strictEqual(Number((await zeile(H, stundeVon(T0))).menschen), 1);
            assert.strictEqual((await q(`SELECT COUNT(*) AS n FROM ${TABELLE}`))[0].n, '2', 'Direktnachricht gezählt');
        });

        await pruefe('6. mitglied_minuten: jedes Paar einmal, auch über Schreibläufe', async () => {
            assert.strictEqual(Number((await zeile(G, stundeVon(T0))).mitglied_minuten), 2);
            m.nachricht(msg({ content: 'noch mal a' }));
            jetzt = T0 + 30_000;
            m.nachricht(msg({ content: 'a, gleiche Minute' }));
            await m.schreibe();
            assert.strictEqual(Number((await zeile(G, stundeVon(T0))).mitglied_minuten), 2, 'gleiche Minute doppelt');
            jetzt = T0 + 61_000;
            m.nachricht(msg({ content: 'a, nächste Minute' }));
            await m.schreibe();
            const z = await zeile(G, stundeVon(T0));
            assert.strictEqual(Number(z.mitglied_minuten), 3);
            assert.strictEqual(Number(z.menschen), 5);
        });

        await pruefe('7. Leerer Lauf schreibt nichts; neue Stunde, neue Zeile, alte fällt aus dem Speicher', async () => {
            const vorher = schreibvorgaenge;
            await m.schreibe();
            assert.strictEqual(schreibvorgaenge, vorher, 'leerer Lauf schrieb');
            jetzt = T0 + 3_600_000;
            m.nachricht(msg({ content: 'neue Stunde' }));
            await m.schreibe();
            const z = await zeile(G, stundeVon(jetzt));
            assert.deepStrictEqual([z.menschen, z.mitglied_minuten].map(Number), [1, 1]);
            assert.ok(![...m.eimer.keys()].some((k) => k.endsWith(stundeVon(T0))), 'alte Stunde bleibt im Speicher');
        });

        await pruefe('8. Bearbeitet nur mit neuem Zeitpunkt; gelöscht einzeln und gesammelt', async () => {
            const s = stundeVon(jetzt);
            m.bearbeitet({ partial: false, editedTimestamp: null }, { guildId: G, editedTimestamp: null });
            m.bearbeitet({ partial: false, editedTimestamp: 5 }, { guildId: G, editedTimestamp: 5 });
            m.bearbeitet({ partial: false, editedTimestamp: null }, { guildId: G, editedTimestamp: 7 });
            m.bearbeitet({ partial: true }, { guildId: G, editedTimestamp: 9 });
            m.bearbeitet({ partial: true }, { guildId: G, editedTimestamp: null });
            m.bearbeitet({ partial: false, editedTimestamp: 1 }, { guildId: null, editedTimestamp: 9 });
            m.geloescht(G);
            m.geloescht(G, 12);
            m.geloescht(undefined, 3);
            await m.schreibe();
            const z = await zeile(G, s);
            assert.deepStrictEqual([z.bearbeitet, z.geloescht].map(Number), [2, 13]);
        });

        await pruefe('9. Scheitert das Schreiben, bleibt alles gezählt; Fehler einmal je Stunde', async () => {
            const s = stundeVon(jetzt);
            protokoll.length = 0;
            kaputt = true;
            m.nachricht(msg({ author: { id: 'c' }, content: 'abc' }));
            await m.schreibe();
            m.nachricht(msg({ author: { id: 'c' }, content: 'abc' }));
            await m.schreibe();
            const fehlerZeilen = protokoll.filter((p) => p[0] === 'error');
            assert.strictEqual(fehlerZeilen.length, 1, `Fehler ${fehlerZeilen.length}× im Log`);
            assert.ok(fehlerZeilen[0][2] instanceof Error, 'zweites Argument ist kein Error');
            kaputt = false;
            await m.schreibe();
            const z = await zeile(G, s);
            assert.deepStrictEqual([z.menschen, z.mitglied_minuten, z.inhalt_bytes].map(Number), [3, 2, 'neue Stunde'.length + 2 * 'abc'.length]);
        });

        await pruefe('10. Nach sieben Tagen und einer Stunde aus', async () => {
            const n = new Messprobe({ uhr: () => jetzt });
            // Älteste Zeile ist T0. Eine Stunde vor dem Ende zählt er noch.
            jetzt = T0 + 168 * 3_600_000;
            n.nachricht(msg({ content: 'vorletzte' }));
            await n.schreibe();
            assert.strictEqual(n.beendet, false, 'zu früh aus');
            protokoll.length = 0;
            jetzt = T0 + 169 * 3_600_000;
            n.nachricht(msg({ content: 'zu spät' }));
            await n.schreibe();
            assert.strictEqual(n.beendet, true, 'nicht aus');
            assert.ok(protokoll.some((p) => p[0] === 'info' && /sieben Tage/.test(p[1])), 'kein Logeintrag');
            assert.strictEqual(await zeile(G, stundeVon(jetzt)), undefined, 'nach dem Ende geschrieben');
            n.nachricht(msg({ content: 'danach' }));
            assert.strictEqual(n.eimer.size, 0, 'zählt nach dem Ende weiter');
            assert.strictEqual(n.zeitgeber, null);
        });

        if (m.zeitgeber) clearInterval(m.zeitgeber);
    } finally {
        await c.end();
    }

    console.log(fehler ? `\n${fehler} Prüfung(en) rot` : '\nalles grün');
    process.exit(fehler ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
