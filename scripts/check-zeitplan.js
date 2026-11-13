#!/usr/bin/env node
/**
 * Zeitplan-Register, G-06 (2026-11-13).
 *
 * Läuft gegen die echte Datenbank, aber nur an einer TEMPORARY-Tabelle
 * derselben Verbindung (Kern-Migration, umgeschrieben). Die echte Tabelle wird
 * weder angelegt noch gelesen oder beschrieben.
 *
 * Quelltext:
 *   1. Das Dashboard startet den Zeitplan nach den Kern-Migrationen und vor
 *      den Plugins. Das SDK reicht `Zeitplan.eintragen` durch.
 *   2. Jeder Name in `Zeitplan.eintragen('plugin:aufgabe', …)` gehört dem
 *      Plugin der Datei (Kern: `core`), steht als Zeichenkette da und kommt
 *      nur einmal vor. Im Bot trägt niemand ein.
 *   3. Kein neuer `node-cron` neben dem Zeitplan. Die bestehenden stehen mit
 *      Grund in `BESTAND`.
 *
 * Läufe:
 *   4. Falscher Name, Takt (auch mit Sekundenfeld), Handler, Frist → wirft.
 *   5. Eintragen legt die Zeile an, `naechster_lauf` = nächster Cron-Termin.
 *   6. Ein Lauf über den Takt: Ergebnis gespeichert, Zähler, Dauer.
 *   7. Ein Lauf zur Zeit: Takt und „Jetzt“ während eines Laufs fallen aus,
 *      der Handler läuft einmal.
 *   8. Handler wirft: Fehler gezählt, Text gespeichert, Log mit Error-Objekt.
 *   9. Frist überschritten: Fehler im Log und in der Zeile, Sperre bleibt.
 *  10. Nachholen nach einem Neustart: verpasster Termin, abgebrochener Lauf;
 *      nicht bei geändertem Takt, nicht bei `nachholen: false`.
 *  11. Neu eintragen ersetzt, der alte Takt ist tot.
 *  12. Stand: eingetragene und nicht mehr eingetragene; vergessen nur diese.
 *  13. Gegenproben: ohne Sperre, ohne Nachholen, mit falschem Plugin wird es rot.
 *
 *   node scripts/check-zeitplan.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const cron = require('node-cron');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare } = require('./lib/quelltext');

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
const warte = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Bestehende Taktgeber mit `node-cron`, die bleiben, bis an ihnen gearbeitet
 * wird (Konzept G-06). Ein neuer Ort ist rot.
 */
const BESTAND = {
    'apps/dashboard/helpers/Zeitplan.js': 'der Zeitplan selbst',
    'apps/dashboard/index.js': 'Toast-Logs nach 7 Tagen löschen; zieht mit G-05 (Aufbewahrung) um',
    'plugins/gameserver/dashboard/helpers/CronWorker.js': 'Cronjobs, die Nutzer je Gameserver anlegen (eigene Tabelle), dazu Aufbewahrung und Kennzahlen nachts',
};

/** Alle .js-Dateien unter den Ordnern, ohne node_modules. */
function dateien(ordner) {
    const aus = [];
    const gehe = (rel) => {
        for (const e of fs.readdirSync(path.join(WURZEL, rel), { withFileTypes: true })) {
            if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
            const r = path.join(rel, e.name);
            if (e.isDirectory()) gehe(r);
            else if (e.name.endsWith('.js')) aus.push(r);
        }
    };
    for (const o of ordner) if (fs.existsSync(path.join(WURZEL, o))) gehe(o);
    return aus;
}

/** Wem eine Datei gehört: `plugins/<p>/…` → p, sonst der Kern. */
function besitzer(datei) {
    const m = /^plugins\/([^/]+)\//.exec(datei);
    return m ? m[1] : 'core';
}

/** Alle Eintragungen im Code: `Zeitplan.eintragen(<erstes Argument>`. */
function eintragungen() {
    const funde = [];
    for (const d of dateien(['apps', 'plugins', 'packages'])) {
        if (d === 'apps/dashboard/helpers/Zeitplan.js' || d === 'packages/dunebot-sdk/lib/Zeitplan.js') continue;
        const q = ohneKommentare(fs.readFileSync(path.join(WURZEL, d), 'utf8'));
        const re = /Zeitplan\.eintragen\(\s*([^,)]*)/g;
        let m;
        while ((m = re.exec(q))) funde.push({ datei: d, arg: m[1].trim() });
    }
    return funde;
}

/** Quelltext-Regel 2 an einer Liste von Funden. */
function namenPruefen(funde) {
    const fehler = [];
    const gesehen = new Map();
    for (const f of funde) {
        const m = /^'([a-z0-9][a-z0-9_-]*):([a-z0-9][a-z0-9_-]*)'$/.exec(f.arg);
        if (!m) { fehler.push(`${f.datei}: Name ${f.arg} ist keine Zeichenkette 'plugin:aufgabe'`); continue; }
        if (f.datei.startsWith('apps/bot/') || /^plugins\/[^/]+\/bot\//.test(f.datei)) fehler.push(`${f.datei}: trägt im Bot ein (${m[0]})`);
        if (m[1] !== besitzer(f.datei)) fehler.push(`${f.datei}: ${m[0]} gehört ${m[1]}, die Datei ${besitzer(f.datei)}`);
        const name = `${m[1]}:${m[2]}`;
        if (gesehen.has(name)) fehler.push(`${name} doppelt: ${gesehen.get(name)} und ${f.datei}`);
        gesehen.set(name, f.datei);
    }
    return fehler;
}

function mitschreiber() {
    const zeilen = [];
    const l = {};
    for (const s of ['info', 'warn', 'debug', 'success']) l[s] = (text) => zeilen.push(`${s}: ${text}`);
    l.error = (text, fehler) => zeilen.push(`error: ${text}${fehler instanceof Error ? ` [Error: ${fehler.message}]` : (fehler !== undefined ? ' [KEIN Error-Objekt]' : '')}`);
    l.zeilen = zeilen;
    return l;
}

(async () => {
    console.log('Zeitplan-Register (G-06)');

    // ── Quelltext ──────────────────────────────────────────────────────────
    await pruefe('Dashboard startet den Zeitplan nach den Kern-Migrationen, vor den Plugins', () => {
        const app = code('apps/dashboard/app.js');
        const kern = app.indexOf('MigrationRunner.runKern(');
        const start = app.indexOf("require('./helpers/Zeitplan').starten()");
        const plugins = app.indexOf('await this.loadPlugins()');
        assert(kern > 0 && start > 0 && plugins > 0, `nicht gefunden: runKern ${kern}, starten ${start}, loadPlugins ${plugins}`);
        assert(kern < start && start < plugins, 'Reihenfolge falsch');
        assert(/await require\('\.\/helpers\/Zeitplan'\)\.starten\(\)/.test(app), 'starten() wird nicht abgewartet');
    });
    await pruefe('SDK reicht Zeitplan.eintragen durch und wirft ohne Dashboard', () => {
        const sdk = require('dunebot-sdk');
        assert(sdk.Zeitplan && typeof sdk.Zeitplan.eintragen === 'function', 'SDK exportiert Zeitplan nicht');
        assert.throws(() => sdk.Zeitplan.eintragen('core:x', '* * * * *', () => {}), /nur im Dashboard/);
    });
    const funde = eintragungen();
    await pruefe(`Namen gehören dem Plugin der Datei, einmalig, nicht im Bot (${funde.length} Eintragung(en))`, () => {
        assert(funde.length > 0, 'keine Eintragung gefunden, der Zeitplan hätte keinen Aufrufer');
        assert.deepStrictEqual(namenPruefen(funde), []);
        assert(funde.some(f => f.datei === 'apps/dashboard/helpers/VerlasseneGuilds.js' && f.arg === "'core:verlassene-guilds'"),
            'VerlasseneGuilds trägt seinen stündlichen Lauf nicht ein');
    });
    await pruefe('Kein neuer node-cron neben dem Zeitplan', () => {
        const neu = [];
        for (const d of dateien(['apps', 'plugins', 'packages'])) {
            const q = ohneKommentare(fs.readFileSync(path.join(WURZEL, d), 'utf8'));
            if (/require\(\s*['"]node-cron['"]\s*\)/.test(q) && !BESTAND[d]) neu.push(d);
        }
        assert.deepStrictEqual(neu, [], 'neuer Taktgeber: Zeitplan.eintragen nehmen oder mit Grund in BESTAND');
        for (const d of Object.keys(BESTAND)) assert(fs.existsSync(path.join(WURZEL, d)), `BESTAND nennt ${d}, die Datei gibt es nicht mehr`);
    });

    // ── Läufe an einer TEMPORARY-Tabelle ───────────────────────────────────
    const c = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
    });
    const echteVorher = (await c.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE' AND Tables_in_" + process.env.MYSQL_DATABASE + " = 'zeitplan_laeufe'"))[0].length;
    const migration = require(path.join(WURZEL, 'migrations/kern/20261113_220000_zeitplan.js'));
    await migration.up({ query: (sql) => c.query(sql.replace(/CREATE TABLE IF NOT EXISTS/g, 'CREATE TEMPORARY TABLE')) });
    const logger = mitschreiber();
    ServiceManager.register('Logger', logger);
    ServiceManager.register('dbService', { async query(sql, params = []) { const [r] = await c.query(sql, params); return r; } });
    const zeile = async (name) => (await c.query('SELECT * FROM zeitplan_laeufe WHERE name = ?', [name]))[0][0];
    const log = () => logger.zeilen.join('\n');

    const Z = require(path.join(WURZEL, 'apps/dashboard/helpers/Zeitplan.js'));
    const { Zeitplan } = require('dunebot-sdk');

    // Zustand eines "letzten Laufs" vor dem Start, wie ihn ein Neustart hinterlässt.
    const vorher = [
        ['probe:verpasst', '0 3 * * *', 1, 'bereit', 'NOW(3) - INTERVAL 1 HOUR'],
        ['probe:abgebrochen', '0 3 * * *', 1, 'laeuft', 'NOW(3) + INTERVAL 1 HOUR'],
        ['probe:anderer-takt', '0 4 * * *', 1, 'bereit', 'NOW(3) - INTERVAL 1 HOUR'],
        ['probe:ohne-nachholen', '0 3 * * *', 0, 'bereit', 'NOW(3) - INTERVAL 1 HOUR'],
        ['probe:puenktlich', '0 3 * * *', 1, 'bereit', 'NOW(3) + INTERVAL 1 HOUR'],
        ['probe:gestrichen', '0 3 * * *', 1, 'bereit', 'NOW(3) - INTERVAL 1 HOUR'],
    ];
    for (const [name, takt, nh, zu, naechst] of vorher) {
        await c.query(`INSERT INTO zeitplan_laeufe (name, plugin, takt, nachholen, zustand, laeufe, naechster_lauf)
                       VALUES (?, 'probe', ?, ?, ?, 4, ${naechst})`, [name, takt, nh, zu]);
    }
    await Z.starten({ nachholenMs: 50 });

    await pruefe('Falscher Name, Takt, Handler oder Frist wirft', () => {
        const h = async () => {};
        assert.throws(() => Zeitplan.eintragen('ohnedoppelpunkt', '* * * * *', h), /plugin:aufgabe/);
        assert.throws(() => Zeitplan.eintragen('Core:Gross', '* * * * *', h), /plugin:aufgabe/);
        assert.throws(() => Zeitplan.eintragen('core:x', 'jede Stunde', h), /fünf Feldern/);
        assert.throws(() => Zeitplan.eintragen('core:x', '*/5 * * * * *', h), /fünf Feldern/);
        assert.throws(() => Zeitplan.eintragen('core:x', '61 * * * *', h), /fünf Feldern/);
        assert.throws(() => Zeitplan.eintragen('core:x', '* * * * *'), /Handler fehlt/);
        assert.throws(() => Zeitplan.eintragen('core:x', '* * * * *', h, { frist_min: 0 }), /frist_min/);
    });

    const aufrufe = [];
    let frei = null;
    let werfen = false;
    const handler = async (lauf) => {
        aufrufe.push(lauf);
        if (frei) await frei.promise;
        if (werfen) throw new Error('Probe wirft');
        return { geloescht: 3 };
    };
    const tor = () => { let auf; const promise = new Promise(r => { auf = r; }); return { promise, auf }; };

    Zeitplan.eintragen('probe:lauf', '17 3 * * *', handler);
    await warte(100);
    await pruefe('Eintragen legt die Zeile an, nächster Lauf ist der nächste Cron-Termin', async () => {
        const z = await zeile('probe:lauf');
        assert(z, 'keine Zeile');
        assert.strictEqual(z.plugin, 'probe');
        assert.strictEqual(z.takt, '17 3 * * *');
        assert.strictEqual(z.zustand, 'bereit');
        const erwartet = cron.createTask('17 3 * * *', () => {}, { timezone: 'Europe/Berlin' });
        erwartet.start();
        assert.strictEqual(new Date(z.naechster_lauf).getTime(), erwartet.getNextRun().getTime());
        erwartet.destroy();
        const berlin = new Date(z.naechster_lauf).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin' });
        assert.strictEqual(berlin, '03:17:00', `nicht in Berliner Zeit: ${berlin}`);
    });

    await pruefe('Ein Lauf über den Takt: Ergebnis, Zähler, Dauer gespeichert', async () => {
        const a = (await Z.stand()).find(x => x.name === 'probe:lauf');
        assert(a.eingetragen);
        aufrufe.length = 0;
        // Der Takt selbst, wie node-cron ihn ruft.
        const intern = require('node-cron').getTasks();
        const task = [...intern.values()].find(t => t.name === 'probe:lauf');
        assert(task, 'Cron-Task nicht registriert');
        await task.execute();
        await warte(50);
        assert.strictEqual(aufrufe.length, 1);
        assert.strictEqual(aufrufe[0].anlass, 'takt');
        assert.strictEqual(aufrufe[0].name, 'probe:lauf');
        const z = await zeile('probe:lauf');
        assert.strictEqual(z.zustand, 'bereit');
        assert.strictEqual(z.laeufe, 1);
        assert.strictEqual(z.fehler, 0);
        assert.strictEqual(z.letztes_ergebnis, '{"geloescht":3}');
        assert.strictEqual(z.letzter_anlass, 'takt');
        assert(z.letzter_erfolg_am && z.letzte_dauer_ms !== null, 'Erfolg oder Dauer fehlt');
    });

    await pruefe('Ein Lauf zur Zeit: Takt und „Jetzt“ fallen aus, solange einer geht', async () => {
        aufrufe.length = 0;
        frei = tor();
        assert.deepStrictEqual(Z.jetzt('probe:lauf'), { gestartet: true });
        await warte(50);
        const z1 = await zeile('probe:lauf');
        assert.strictEqual(z1.zustand, 'laeuft');
        const zweiter = Z.jetzt('probe:lauf');
        assert.strictEqual(zweiter.gestartet, false);
        const task = [...require('node-cron').getTasks().values()].find(t => t.name === 'probe:lauf');
        // Nicht abwarten: Ohne Sperre hinge der Takt am selben Tor wie der erste Lauf.
        task.execute().catch(() => {});
        await warte(50);
        const s = (await Z.stand()).find(x => x.name === 'probe:lauf');
        assert(s.laeuft && s.laeuft.anlass === 'von_hand', 'Stand zeigt den Lauf nicht');
        frei.auf();
        frei = null;
        await warte(80);
        assert.strictEqual(aufrufe.length, 1, `Handler ${aufrufe.length}-mal gerufen`);
        const z = await zeile('probe:lauf');
        assert.strictEqual(z.uebersprungen, 1);
        assert.strictEqual(z.laeufe, 2);
        assert.strictEqual(z.letzter_anlass, 'von_hand');
        assert(/warn: \[Zeitplan\] probe:lauf: takt fällt aus/.test(log()), log());
        assert.throws(() => Z.jetzt('probe:gibtsnicht'), /Keine Aufgabe/);
    });

    await pruefe('Handler wirft: Fehler gezählt, Text gespeichert, Log mit Error-Objekt', async () => {
        werfen = true;
        Z.jetzt('probe:lauf');
        await warte(80);
        werfen = false;
        const z = await zeile('probe:lauf');
        assert.strictEqual(z.fehler, 1);
        assert.strictEqual(z.letzter_fehler, 'Probe wirft');
        assert.strictEqual(z.zustand, 'bereit');
        assert(/error: \[Zeitplan\] probe:lauf \(von_hand\) gescheitert nach \d+ ms \[Error: Probe wirft\]/.test(log()), log());
    });

    await pruefe('Frist überschritten: Fehler im Log und in der Zeile, Sperre bleibt bis zum Ende', async () => {
        const t = tor();
        Zeitplan.eintragen('probe:lang', '0 5 * * *', async () => { await t.promise; return 'fertig'; }, { frist_min: 0.002 });
        await warte(100);
        Z.jetzt('probe:lang');
        await warte(250);
        const z = await zeile('probe:lang');
        assert(/läuft länger als 0.002 min/.test(z.letzter_fehler || ''), z.letzter_fehler);
        assert.strictEqual(z.zustand, 'laeuft');
        assert.strictEqual(Z.jetzt('probe:lang').gestartet, false);
        assert(/error: \[Zeitplan\] probe:lang läuft länger/.test(log()), log());
        t.auf();
        await warte(80);
        const z2 = await zeile('probe:lang');
        assert.strictEqual(z2.zustand, 'bereit');
        assert.strictEqual(z2.letztes_ergebnis, 'fertig');
    });

    // Nachholen: Die Zeilen von "vorher" werden jetzt eingetragen.
    const nach = {};
    const zaehler = (name) => async (lauf) => { (nach[name] = nach[name] || []).push(lauf.anlass); };
    Zeitplan.eintragen('probe:verpasst', '0 3 * * *', zaehler('probe:verpasst'));
    Zeitplan.eintragen('probe:abgebrochen', '0 3 * * *', zaehler('probe:abgebrochen'));
    Zeitplan.eintragen('probe:anderer-takt', '0 3 * * *', zaehler('probe:anderer-takt'));
    Zeitplan.eintragen('probe:ohne-nachholen', '0 3 * * *', zaehler('probe:ohne-nachholen'), { nachholen: false });
    Zeitplan.eintragen('probe:puenktlich', '0 3 * * *', zaehler('probe:puenktlich'));
    await warte(300);
    await pruefe('Nachholen: verpasst und abgebrochen ja, anderer Takt, nachholen:false, pünktlich nein', async () => {
        assert.deepStrictEqual(nach, { 'probe:verpasst': ['nachgeholt'], 'probe:abgebrochen': ['nachgeholt'] });
        const ab = await zeile('probe:abgebrochen');
        assert.strictEqual(ab.laeufe, 5);
        assert.strictEqual(ab.fehler, 1, 'Abbruch nicht als Fehler gezählt');
        assert.strictEqual(ab.letzter_fehler, Z.ABGEBROCHEN);
        assert(new Date(ab.letzter_erfolg_am) >= new Date(ab.letzter_fehler_am), 'Erfolg nach dem Abbruch fehlt');
        const ver = await zeile('probe:verpasst');
        assert(new Date(ver.naechster_lauf) > new Date(), 'nächster Lauf nicht aufgefrischt');
        assert.strictEqual((await zeile('probe:anderer-takt')).takt, '0 3 * * *');
        assert(/warn: \[Zeitplan\] Beim letzten Beenden liefen noch: probe:abgebrochen/.test(log()), log());
    });

    await pruefe('Neu eintragen ersetzt, der alte Takt ist tot', async () => {
        const vorherTasks = [...require('node-cron').getTasks().values()].filter(t => t.name === 'probe:lauf').length;
        const neu = [];
        Zeitplan.eintragen('probe:lauf', '18 3 * * *', async () => { neu.push(1); });
        await warte(100);
        const tasks = [...require('node-cron').getTasks().values()].filter(t => t.name === 'probe:lauf');
        assert.strictEqual(tasks.length, 1, `${tasks.length} Takte unter dem Namen (vorher ${vorherTasks})`);
        aufrufe.length = 0;
        await tasks[0].execute();
        await warte(50);
        assert.deepStrictEqual([neu.length, aufrufe.length], [1, 0], 'alter Handler lief oder neuer nicht');
        assert.strictEqual((await zeile('probe:lauf')).takt, '18 3 * * *');
    });

    await pruefe('Stand: nicht mehr eingetragen sichtbar, nur das lässt sich vergessen', async () => {
        const s = await Z.stand();
        const weg = s.find(x => x.name === 'probe:gestrichen');
        assert(weg && weg.eingetragen === false, 'gestrichene Zeile fehlt im Stand');
        assert(s.find(x => x.name === 'probe:verpasst').eingetragen === true);
        await assert.rejects(Z.vergessen('probe:verpasst'), /eingetragen/);
        assert.strictEqual(await Z.vergessen('probe:gestrichen'), true);
        assert.strictEqual(await zeile('probe:gestrichen'), undefined);
    });

    // ── Gegenproben ────────────────────────────────────────────────────────
    await pruefe('Gegenproben: falsches Plugin, Bot, doppelt, kein Literal werden rot', () => {
        assert.strictEqual(namenPruefen([{ datei: 'plugins/leveling/dashboard/index.js', arg: "'clan:saison'" }]).length, 1);
        assert.strictEqual(namenPruefen([{ datei: 'apps/bot/x.js', arg: "'core:x'" }]).length, 1);
        assert.strictEqual(namenPruefen([{ datei: 'apps/dashboard/a.js', arg: "'core:x'" }, { datei: 'apps/dashboard/b.js', arg: "'core:x'" }]).length, 1);
        assert.strictEqual(namenPruefen([{ datei: 'apps/dashboard/a.js', arg: 'NAME' }]).length, 1);
        assert.strictEqual(namenPruefen([{ datei: 'plugins/clan/dashboard/x.js', arg: "'clan:saison'" }]).length, 0);
    });

    Z.anhalten();
    const echteNachher = (await c.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE' AND Tables_in_" + process.env.MYSQL_DATABASE + " = 'zeitplan_laeufe'"))[0].length;
    await pruefe('Echte Tabelle unberührt', () => assert.strictEqual(echteNachher, echteVorher));
    await c.end();

    console.log(rot ? `\n${rot} rot` : '\nalles grün');
    process.exit(rot ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
