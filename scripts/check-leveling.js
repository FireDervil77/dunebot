#!/usr/bin/env node
/**
 * Leveling Stufe 1 (LV-1a bis LV-1e, K382, K394, 2026-11-15).
 *
 * Geprüft wird:
 *
 *   1  Verdrahtung  Bot-Events messageCreate/messageDelete/messageDeleteBulk
 *                   rufen die Chat-XP, der Minutentakt ruft die Sprach-XP,
 *                   Chat und Sprache gehen über `nachbuchung.js`, das
 *                   Dashboard hört `automod.verstoss` mit dem Hörer aus
 *                   `dashboard/hoerer.js` (und gleicht danach die
 *                   Belohnungen an), automod meldet das Ereignis mit festen
 *                   Gründen, der Kern löscht beim Abschalten die Fortschritte
 *                   des Plugins (nicht in der Kontroll-Guild), `/levels sync`
 *                   fragt das Recht LEVELING.REWARDS.MANAGE im Dashboard
 *   2  Regeln       Ausschluss, „nur diese“, Faktoren (Kanal genauester,
 *                   Rolle höchster), Kette Thread → Kanal → Kategorie,
 *                   Menge, Taktung und gleicher Text; Sprache (AFK, allein,
 *                   taub, stumm); Soll-Rollen je Stufe (geben, nehmen,
 *                   vorherige entfernen)
 *   3  Läufe        an TEMPORARY-Kopien von `level_*`, `fortschritt_*` und
 *                   `ereignisbuch` mit echtem SQL: nicht eingerichtet →
 *                   nichts, Startwerte, Buchung `msg:<id>`, Taktung, gleicher
 *                   Text, zu kurz, Bot, Ausschluss, Aufstieg meldet
 *                   `leveling.level.erreicht`, Löschen in der Frist storniert,
 *                   zu alt nicht, automod storniert, Zähler, Abschalten
 *                   löscht nur `leveling:*`; Sprach-XP `voice:<m>:<minute>`
 *                   ohne Doppel; gesammeltes Löschen storniert; Belohnungen
 *                   über `Rollen` (Discord als Attrappe, TEMPORARY-Kopie von
 *                   `rollen_vergaben`): geben, vorherige entfernen, Storno
 *                   nimmt, Rolle von Hand bleibt, `/levels sync` mit
 *                   ehrlichem Ergebnis
 *   4  Gegenproben  jede Prüfung aus 1 wird an eingebauten Fehlern rot
 *
 * Geschrieben wird nur in TEMPORARY-Tabellen dieser Verbindung.
 *
 *   node scripts/check-leveling.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare } = require('./lib/quelltext');

const gesehen = [];
ServiceManager.register('Logger', { debug() {}, info() {}, success() {}, warn() {}, error: (...a) => gesehen.push(a.map(String).join(' ')) });

const L = (p) => path.join(WURZEL, 'plugins/leveling', p);
const lies = (p) => ohneKommentare(fs.readFileSync(path.join(WURZEL, p), 'utf8'));

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 12).join('\n      ')}`); }
}

// ── 1: Verdrahtung, als reine Prüfungen für die Gegenproben ──────────────────

const DATEIEN = {
    erstellt: 'plugins/leveling/bot/events/messageCreate.js',
    geloescht: 'plugins/leveling/bot/events/messageDelete.js',
    gesammelt: 'plugins/leveling/bot/events/messageDeleteBulk.js',
    botIndex: 'plugins/leveling/bot/index.js',
    chatxp: 'plugins/leveling/bot/chatxp.js',
    sprachxp: 'plugins/leveling/bot/sprachxp.js',
    hoerer: 'plugins/leveling/dashboard/hoerer.js',
    levels: 'plugins/leveling/bot/commands/levels.js',
    ipc: 'apps/dashboard/helpers/IPCServer.js',
    dashboard: 'plugins/leveling/dashboard/index.js',
    automod: 'plugins/automod/bot/events/messageCreate.js',
    kern: 'apps/dashboard/helpers/PluginManager.js',
};

function pruefeVerdrahtung(t) {
    const aus = [];
    if (!/require\(['"]\.\.\/chatxp['"]\)/.test(t.erstellt) || !/beiNachricht\(message\)/.test(t.erstellt)) aus.push('messageCreate ruft beiNachricht nicht');
    if (!/require\(['"]\.\.\/chatxp['"]\)/.test(t.geloescht) || !/beiLoeschung\(message\)/.test(t.geloescht)) aus.push('messageDelete ruft beiLoeschung nicht');
    if (!/require\(['"]\.\.\/chatxp['"]\)/.test(t.gesammelt) || !/nachrichten\?\.values\?\.\(\)/.test(t.gesammelt) || !/beiLoeschung\(message\)/.test(t.gesammelt)) aus.push('messageDeleteBulk ruft beiLoeschung nicht je Nachricht');
    if (!/sprachxp\.takt\(\)/.test(t.botIndex)) aus.push('Minutentakt ruft sprachxp.takt nicht');
    for (const k of ['chatxp', 'sprachxp']) if (!/nachBuchung\(\{/.test(t[k])) aus.push(`${k} geht nicht über nachBuchung`);
    if (!/storniere\([\s\S]*?if \(s\.wechsel\) await nachBuchung/.test(t.chatxp)) aus.push('Storno beim Löschen gleicht die Belohnungen nicht an');
    if (!/if \(s\.wechsel\)[\s\S]*?Belohnungen\.gleicheAb\(/.test(t.hoerer)) aus.push('automod-Storno gleicht die Belohnungen nicht an');
    if (!/const RECHT = 'LEVELING\.REWARDS\.MANAGE'/.test(t.levels) || !/sendToDashboard\('core:RECHT_PRUEFEN'/.test(t.levels) || !/if \(!recht\.darf\) return/.test(t.levels)) aus.push('/levels sync fragt das Recht nicht im Dashboard');
    const rechtFall = /case 'RECHT_PRUEFEN':([\s\S]*?)case '/.exec(t.ipc);
    if (!rechtFall || !/permissionManager\.hasPermission\(String\(actorId\), String\(guildId\), String\(recht\)\)/.test(rechtFall[1])) aus.push('Dashboard prüft RECHT_PRUEFEN nicht mit dem PermissionManager');
    if (!/Ereignisse\.hoere\(\s*'automod\.verstoss'\s*,\s*'leveling'\s*,\s*require\('\.\/hoerer'\)\.automodVerstoss\s*\)/.test(t.dashboard)) aus.push('Dashboard hört automod.verstoss nicht mit hoerer.automodVerstoss');
    const m = /Ereignisse\.melde\(\s*'automod\.verstoss'[\s\S]*?\}\)\s*\.catch/.exec(t.automod);
    if (!m) aus.push('automod meldet automod.verstoss nicht');
    else {
        if (!/nachricht:\s*message\.id/.test(m[0])) aus.push('automod.verstoss ohne nachricht: message.id');
        if (!/gruende:\s*\[\.\.\.new Set\(gruende\)\]/.test(m[0])) aus.push('automod.verstoss ohne feste Gründe');
    }
    const felder = (t.automod.match(/fields\.push\(\{/g) || []).length;
    const gruende = (t.automod.match(/gruende\.push\('[a-z_]+'\);\s*\n\s*fields\.push\(\{/g) || []).length;
    if (felder !== gruende) aus.push(`automod: ${felder} Felder, aber nur ${gruende} mit festem Grund davor`);
    const schritt = /if \(!inhalteBleiben\) \{([\s\S]*?)\} catch \(tabellenFehler\)/.exec(t.kern);
    if (!schritt || !/Fortschritt\.loeschePlugin\(\{\s*guildId,\s*plugin:\s*pluginName\s*\}\)/.test(schritt[1])) aus.push('Kern löscht beim Abschalten die Fortschritte nicht (Schritt 2, außerhalb der Kontroll-Guild)');
    return aus;
}

(async () => {
    const texte = Object.fromEntries(Object.entries(DATEIEN).map(([k, p]) => [k, lies(p)]));

    console.log('\nVerdrahtung');
    await pruefe('1. Events, Hörer, automod-Meldung, Löschen beim Abschalten', () => {
        assert.deepStrictEqual(pruefeVerdrahtung(texte), []);
    });
    await pruefe('1b. package.json: Kennung, Tabellen, Mitglied, Ereignisse', () => {
        const p = require(L('package.json'));
        assert.deepStrictEqual(p.fortschritt?.map((e) => e.kennung), ['leveling:community']);
        assert.ok(p.nurKontrollGuild === true, 'nurKontrollGuild fehlt, Stufe 1 ist nicht fertig');
        const ddl = lies('plugins/leveling/migrations/20261115_130000_baseline.js');
        const tabellen = [...ddl.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((x) => x[1]);
        assert.deepStrictEqual([...p.guildInhalte.loeschen].sort(), [...tabellen].sort(), 'guildInhalte ≠ Tabellen der Migration');
        assert.ok(p.ereignisse.sendet.includes('leveling.level.erreicht') && p.ereignisse.sendet.includes('leveling.belohnung.vergeben') && p.ereignisse.hoert.includes('automod.verstoss'));
        assert.deepStrictEqual(p.rollen?.map((r) => r.besitzer), ['leveling:community'], 'Belohnungsrollen ohne Besitzer-Erklärung');
    });

    // ── 2: Regeln ────────────────────────────────────────────────────────────
    const Regeln = require(L('shared/regeln'));
    console.log('\nRegeln');
    await pruefe('2a. Ausschluss, nur diese, Faktoren', () => {
        const R = [
            { art: 'kanal', ziel_id: 'aus', wirkung: 'ausschliessen', quelle: null },
            { art: 'rolle', ziel_id: 'stumm', wirkung: 'ausschliessen', quelle: 'nachricht' },
            { art: 'rolle', ziel_id: 'r2', wirkung: 'faktor', faktor: 2, quelle: null },
            { art: 'rolle', ziel_id: 'r15', wirkung: 'faktor', faktor: 1.5, quelle: null },
            { art: 'kanal', ziel_id: 'kat', wirkung: 'faktor', faktor: 3, quelle: null },
            { art: 'kanal', ziel_id: 'k', wirkung: 'faktor', faktor: 0.5, quelle: null },
        ];
        assert.strictEqual(Regeln.pruefeRegeln(R, 'nachricht', ['t', 'aus', 'kat'], []).grund, 'kanal_ausgeschlossen', 'Thread im ausgeschlossenen Kanal');
        assert.strictEqual(Regeln.pruefeRegeln(R, 'nachricht', ['x'], ['stumm']).grund, 'rolle_ausgeschlossen');
        assert.ok(Regeln.pruefeRegeln(R, 'sprache', ['x'], ['stumm']).erlaubt, 'Regel mit Quelle gilt nur dort');
        assert.strictEqual(Regeln.pruefeRegeln(R, 'nachricht', ['k', 'kat'], ['r2', 'r15']).faktor, 1, 'Kanal 0,5 (genauer als Kategorie 3) × Rolle 2 (höchste)');
        assert.strictEqual(Regeln.pruefeRegeln(R, 'nachricht', ['z', 'kat'], []).faktor, 3, 'Kategorie, wenn der Kanal keine Regel hat');
        const nur = [{ art: 'kanal', ziel_id: 'ok', wirkung: 'nur', quelle: null }, { art: 'rolle', ziel_id: 'vip', wirkung: 'nur', quelle: null }];
        assert.strictEqual(Regeln.pruefeRegeln(nur, 'nachricht', ['x'], ['vip']).grund, 'kanal_nicht_erlaubt');
        assert.strictEqual(Regeln.pruefeRegeln(nur, 'nachricht', ['ok'], []).grund, 'rolle_nicht_erlaubt');
        assert.ok(Regeln.pruefeRegeln(nur, 'nachricht', ['t', 'ok'], ['vip']).erlaubt, 'Thread im erlaubten Kanal');
        assert.strictEqual(Regeln.pruefeRegeln([{ art: 'rolle', ziel_id: 'n', wirkung: 'faktor', faktor: 0, quelle: null }], 'nachricht', ['x'], ['n']).grund, 'faktor_null');
    });
    await pruefe('2b. Kanalkette, Menge, Taktung, gleicher Text', () => {
        assert.deepStrictEqual(Regeln.kanalKette({ channelId: 't', channel: { isThread: () => true, parentId: 'k', parent: { parentId: 'kat' } } }), ['t', 'k', 'kat']);
        assert.deepStrictEqual(Regeln.kanalKette({ channelId: 'k', channel: { isThread: () => false, parentId: 'kat' } }), ['k', 'kat']);
        assert.deepStrictEqual([Regeln.menge(15, 25, 1, () => 0), Regeln.menge(15, 25, 1, () => 0.99999), Regeln.menge(25, 15, 2, () => 0)], [15, 25, 30]);
        assert.strictEqual(Regeln.laenge('🔥🔥'), 2);
        let t = 0;
        const d = new Regeln.Drossel({ uhr: () => t });
        const a = (text) => d.pruefe({ guildId: 'g', mitglied: 'm', quelle: 'nachricht', taktungS: 60, text, fensterS: 300 });
        assert.ok(a('hallo').ja);
        t = 59_999; assert.strictEqual(a('anders').grund, 'taktung');
        t = 60_000; assert.strictEqual(a('hallo').grund, 'gleicher_text', 'gleicher Text im Fenster');
        assert.ok(a('anders').ja, 'gleicher Text blockiert nicht die Taktung');
        t = 400_000; assert.ok(a('hallo').ja, 'nach dem Fenster zählt er wieder');
        t = 405_000; d.aufraeumen(10); assert.strictEqual(d.zuletzt.size + d.texte.size, 2, 'Junges bleibt');
        t = 500_000; d.aufraeumen(10); assert.strictEqual(d.zuletzt.size + d.texte.size, 0, 'Altes geht');
    });

    const sprachxp = require(L('bot/sprachxp'));
    const Belohnungen = require(L('shared/belohnungen'));
    await pruefe('2c. Sprache: AFK, allein, taub, stumm, Bots zählen nicht', () => {
        const m = (id, x = {}) => ({ id, bot: false, taub: false, stumm: false, rollen: [], ...x });
        const k = sprachxp.kandidaten([
            { id: 'v1', parentId: 'kat', mitglieder: [m('a'), m('b', { stumm: true })] },
            { id: 'v2', parentId: null, mitglieder: [m('c'), m('bot', { bot: true })] },
            { id: 'v3', parentId: null, mitglieder: [m('d'), m('e', { taub: true })] },
            { id: 'afk', parentId: null, mitglieder: [m('f'), m('g')] },
        ], { afkKanal: 'afk', minMenschen: 2, stummZaehlt: true });
        assert.deepStrictEqual(Object.fromEntries(k.map((x) => [x.mitglied, x.grund])),
            { a: null, b: null, c: 'zu_wenige', d: 'zu_wenige', e: 'taub', f: 'afk', g: 'afk' });
        assert.deepStrictEqual(k.find((x) => x.mitglied === 'a').kette, ['v1', 'kat']);
        const ohneStumm = sprachxp.kandidaten([{ id: 'v1', parentId: null, mitglieder: [m('a'), m('b', { stumm: true })] }], { minMenschen: 2, stummZaehlt: false });
        assert.deepStrictEqual(ohneStumm.map((x) => x.grund), [null, 'stumm'], 'stumm zählt mit, bekommt aber nichts');
        assert.deepStrictEqual(sprachxp.kandidaten([{ id: 'v', parentId: null, mitglieder: [m('a')] }], { minMenschen: 1 }).map((x) => x.grund), [null], 'Mindestzahl 1 erlaubt allein');
    });
    await pruefe('2d. Soll-Rollen: höchste Stufe entscheidet, nehmen, vorherige entfernen', () => {
        const B = [
            { stufe: 1, art: 'rolle_geben', wert: '11111' }, { stufe: 5, art: 'rolle_geben', wert: '55555' },
            { stufe: 10, art: 'rolle_geben', wert: '10101' }, { stufe: 10, art: 'rolle_nehmen', wert: '11111' },
            { stufe: 5, art: 'rolle_geben', wert: '55556' }, { stufe: 3, art: 'abzeichen', wert: 'x' },
        ];
        const soll = (l, v = false) => [...Belohnungen.sollRollen(B, l, v)].sort();
        assert.deepStrictEqual(soll(0), []);
        assert.deepStrictEqual(soll(4), ['11111']);
        assert.deepStrictEqual(soll(7), ['11111', '55555', '55556']);
        assert.deepStrictEqual(soll(10), ['10101', '55555', '55556'], 'nehmen auf Stufe 10');
        assert.deepStrictEqual(soll(7, true), ['55555', '55556'], 'vorherige entfernen: nur die der höchsten Stufe');
        assert.deepStrictEqual(soll(12, true), ['10101']);
        assert.deepStrictEqual([...Belohnungen.sollRollen([{ stufe: 2, art: 'rolle_geben', wert: '22222' }, { stufe: 2, art: 'rolle_nehmen', wert: '22222' }], 2, false)], [], 'gleiche Stufe: nehmen gilt');
    });

    // ── 3: Läufe an TEMPORARY-Kopien ─────────────────────────────────────────
    const mysql = require('mysql2/promise');
    const c = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
        supportBigNumbers: true, bigNumberStrings: true });
    const schreibt = /^\s*(INSERT|UPDATE|DELETE|REPLACE|TRUNCATE|CREATE|DROP|ALTER)\b/i;
    const KOPIEN = /\b(fortschritt_|level_|ereignisbuch\b|rollen_vergaben\b)/;
    async function q(sql, werte) {
        const s = String(sql);
        if (schreibt.test(s) && !/^\s*CREATE TEMPORARY TABLE/i.test(s) && !KOPIEN.test(s)) throw new Error(`nur lesend: ${s.slice(0, 60)}`);
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

    const ddl = [];
    const fange = { query: async (s) => { ddl.push(String(s)); return []; } };
    await require(path.join(WURZEL, 'migrations/kern/20261114_235000_fortschritt.js')).up(fange);
    await require(path.join(WURZEL, 'migrations/kern/20261113_200000_ereignisbuch.js')).up(fange);
    await require(L('migrations/20261115_130000_baseline.js')).up(fange);
    await require(path.join(WURZEL, 'migrations/kern/20261114_230000_rollen_vergaben.js')).up(fange);
    for (const s of ddl.filter((x) => /CREATE TABLE IF NOT EXISTS (fortschritt_|level_|ereignisbuch\b|rollen_vergaben\b)/.test(x))) {
        await c.query(s.replace('CREATE TABLE IF NOT EXISTS', 'CREATE TEMPORARY TABLE').replace(/,\s*CONSTRAINT[\s\S]*?ON DELETE CASCADE/, ''));
    }

    const { SnowflakeUtil } = require('discord.js');
    const Fortschritt = require(path.join(WURZEL, 'packages/dunebot-sdk/lib/Fortschritt.js'));
    const chatxp = require(L('bot/chatxp'));
    const zaehler = require(L('bot/zaehler'));
    const { spieleStartwerteEin } = require(L('shared/vorgaben'));
    const { automodVerstoss } = require(L('dashboard/hoerer'));

    const G = '100000000000000001';
    const ANDERE = '100000000000000002';
    const K = 'leveling:community';
    let uhr = 1_000_000;
    chatxp.drossel.uhr = () => uhr;
    const id = (vor = 0) => String(SnowflakeUtil.generate({ timestamp: Date.now() - vor }));
    const nachricht = (mitglied, content, extra = {}) => ({
        id: id(), guildId: G, channelId: '200', channel: { isThread: () => false, parentId: '300' },
        author: { id: mitglied, bot: false }, member: { roles: { cache: new Map(extra.rollen?.map((r) => [r, {}]) || []) } },
        content, system: false, webhookId: null, ...extra,
    });
    const xp = async (m) => Number((await q('SELECT xp FROM fortschritt_stand WHERE guild_id = ? AND kennung = ? AND mitglied_id = ?', [G, K, m]))[0]?.xp ?? 0);
    const A = '300000000000000001';
    const B = '300000000000000002';

    console.log('\nLäufe (TEMPORARY-Kopien)');
    await pruefe('3a. Ohne Einstellungen vergibt der Bot nichts', async () => {
        const r = await chatxp.beiNachricht(nachricht(A, 'hallo zusammen'));
        assert.strictEqual(r.grund, 'nicht_eingerichtet');
        assert.strictEqual(await xp(A), 0);
    });
    await spieleStartwerteEin({ query: q }, G);
    await spieleStartwerteEin({ query: q }, G);
    Regeln.vergiss();
    let erste;
    await pruefe('3b. Startwerte zweimal → eine Zeile, Buchung msg:<id> mit 15–25 XP', async () => {
        assert.strictEqual((await q('SELECT COUNT(*) n FROM level_einstellungen WHERE guild_id = ?', [G]))[0].n, '1');
        assert.strictEqual((await q('SELECT COUNT(*) n FROM level_quellen WHERE guild_id = ?', [G]))[0].n, '2');
        erste = nachricht(A, 'hallo zusammen');
        const r = await chatxp.beiNachricht(erste);
        assert.ok(r.gebucht && r.ergebnis.schluessel === `msg:${erste.id}`, JSON.stringify(r));
        const x = await xp(A);
        assert.ok(x >= 15 && x <= 25, `XP ${x}`);
    });
    await pruefe('3c. Taktung, gleicher Text, zu kurz, Bot, Webhook', async () => {
        uhr += 30_000;
        assert.strictEqual((await chatxp.beiNachricht(nachricht(A, 'noch etwas'))).grund, 'taktung');
        uhr += 31_000;
        assert.strictEqual((await chatxp.beiNachricht(nachricht(A, '  HALLO   zusammen '))).grund, 'gleicher_text', 'Groß/klein und Leerraum zählen nicht');
        assert.strictEqual((await chatxp.beiNachricht(nachricht(A, 'ok'))).grund, 'zu_kurz');
        assert.strictEqual((await chatxp.beiNachricht(nachricht(B, 'ich bin ein bot', { author: { id: B, bot: true } }))).grund, 'kein_mensch');
        assert.strictEqual((await chatxp.beiNachricht(nachricht(B, 'webhook schreibt', { webhookId: '1' }))).grund, 'kein_mensch');
        assert.ok((await chatxp.beiNachricht(nachricht(A, 'etwas ganz neues'))).gebucht, 'nach der Taktung mit neuem Text');
    });
    await pruefe('3d. Ausgeschlossene Kategorie, Faktor einer Rolle', async () => {
        await q("INSERT INTO level_regeln (guild_id, art, ziel_id, wirkung) VALUES (?, 'kanal', '300', 'ausschliessen')", [G]);
        Regeln.vergiss();
        assert.strictEqual((await chatxp.beiNachricht(nachricht(B, 'in der kategorie'))).grund, 'kanal_ausgeschlossen');
        await q("DELETE FROM level_regeln WHERE guild_id = ?", [G]);
        await q("INSERT INTO level_regeln (guild_id, art, ziel_id, wirkung, faktor) VALUES (?, 'rolle', '777', 'faktor', '10.00')", [G]);
        await q("UPDATE level_quellen SET xp_von = 20, xp_bis = 20 WHERE guild_id = ? AND quelle = 'nachricht'", [G]);
        Regeln.vergiss();
        const r = await chatxp.beiNachricht(nachricht(B, 'mit faktor', { rollen: ['777'] }));
        assert.ok(r.gebucht && r.ergebnis.menge === 200, JSON.stringify(r.ergebnis));
    });
    await pruefe('3e. Aufstieg meldet leveling.level.erreicht (200 XP = Stufe 1 nach „ansteigend“, Stufe 2 erst ab 255)', async () => {
        const z = await q("SELECT name, betroffen, schluessel, daten FROM ereignisbuch WHERE guild_id = ? AND name = 'leveling.level.erreicht'", [G]);
        assert.strictEqual(z.length, 1, JSON.stringify(z));
        const daten = typeof z[0].daten === 'string' ? JSON.parse(z[0].daten) : z[0].daten;
        assert.ok(z[0].betroffen === B && daten.fortschritt === K && daten.stufe === 1 && daten.vorher === 0, JSON.stringify(z[0]));
    });
    await pruefe('3f. Löschen in der Frist storniert, zu alt nicht, ohne Buchung nichts', async () => {
        const vorher = await xp(A);
        const s = await chatxp.beiLoeschung({ id: erste.id, guildId: G });
        assert.ok(s.storniert, JSON.stringify(s));
        assert.ok(await xp(A) < vorher, 'Stand nicht gesunken');
        assert.strictEqual((await chatxp.beiLoeschung({ id: erste.id, guildId: G })).storniert, false, 'zweimal');
        assert.strictEqual((await chatxp.beiLoeschung({ id: id(11 * 60_000), guildId: G })).grund, 'zu_alt');
        assert.strictEqual((await chatxp.beiLoeschung({ id: id(), guildId: G })).grund, 'keine_buchung');
        await q('UPDATE level_einstellungen SET storno_loeschen_min = 0 WHERE guild_id = ?', [G]);
        Regeln.vergiss();
        assert.strictEqual((await chatxp.beiLoeschung({ id: id(), guildId: G })).grund, 'aus');
    });
    await pruefe('3g. automod.verstoss storniert die Nachricht, abschaltbar', async () => {
        uhr += 120_000;
        const n = nachricht(A, 'beanstandet von automod');
        assert.ok((await chatxp.beiNachricht(n)).gebucht);
        const vorher = await xp(A);
        const r = await automodVerstoss({ guild_id: G, daten: { nachricht: n.id, gruende: ['link'], strikes: 1 } });
        assert.ok(r.storniert, JSON.stringify(r));
        assert.ok(await xp(A) < vorher);
        const [b] = await q('SELECT storno_grund FROM fortschritt_buchungen WHERE guild_id = ? AND schluessel = ?', [G, `msg:${n.id}`]);
        assert.strictEqual(b.storno_grund, 'automod: link');
        await q('UPDATE level_einstellungen SET storno_automod = 0 WHERE guild_id = ?', [G]);
        assert.strictEqual((await automodVerstoss({ guild_id: G, daten: { nachricht: id(), gruende: [] } })).grund, 'aus');
        assert.strictEqual((await automodVerstoss({ guild_id: ANDERE, daten: { nachricht: id(), gruende: [] } })).grund, 'nicht_eingerichtet');
    });
    await pruefe('3h. Zähler: Nachrichten im Speicher, geschrieben als Zuwachs', async () => {
        const zeilen = await zaehler.schreibe({ query: q });
        assert.ok(zeilen >= 2, `geschrieben ${zeilen}`);
        const z = await q('SELECT mitglied_id, nachrichten, erste_nachricht FROM level_zaehler WHERE guild_id = ? ORDER BY mitglied_id', [G]);
        // A: 3b, 3c (6 Nachrichten, davon zu kurz/gleich/Taktung mitgezählt), 3g; B: 3d zweimal (eine ausgeschlossen, zählt nicht)
        assert.deepStrictEqual(z.map((x) => [x.mitglied_id, Number(x.nachrichten)]), [[A, 6], [B, 1]], JSON.stringify(z));
        assert.ok(z.every((x) => x.erste_nachricht), 'erste Nachricht fehlt');
        assert.strictEqual(await zaehler.schreibe({ query: q }), 0, 'nichts neu → nichts geschrieben');
    });
    await pruefe('3i. Abschalten löscht nur leveling:*, nicht andere Kennungen oder Guilds', async () => {
        await q("INSERT INTO fortschritt_stand (guild_id, kennung, mitglied_id, xp) VALUES (?, 'levelingx:probe', ?, 5), (?, ?, ?, 7)", [G, A, ANDERE, K, A]);
        await q("INSERT INTO fortschritt_saisons (guild_id, kennung, name, beginn, ende) VALUES (?, ?, 'S', NOW() - INTERVAL 1 DAY, NOW() + INTERVAL 1 DAY)", [G, K]);
        const [s] = await q('SELECT id FROM fortschritt_saisons WHERE guild_id = ? AND kennung = ?', [G, K]);
        await q('INSERT INTO fortschritt_saison_stand (saison_id, guild_id, mitglied_id, xp) VALUES (?, ?, ?, 3)', [s.id, G, A]);
        const weg = await Fortschritt.loeschePlugin({ guildId: G, plugin: 'leveling' });
        assert.ok(weg.fortschritt_stand === 2 && weg.fortschritt_buchungen === 4 && weg.fortschritt_stufen === 100 && weg.fortschritt_einstellungen === 1
            && weg.fortschritt_saisons === 1 && weg.fortschritt_saison_stand === 1, JSON.stringify(weg));
        const rest = await q('SELECT guild_id, kennung FROM fortschritt_stand ORDER BY guild_id');
        assert.deepStrictEqual(rest.map((x) => [x.guild_id, x.kennung]), [[G, 'levelingx:probe'], [ANDERE, K]], 'fremde Kennung oder Guild gelöscht');
        await assert.rejects(() => Fortschritt.loeschePlugin({ guildId: G, plugin: "x'; DROP" }), /ungültig/);
    });
    // ── LV-1d: Sprach-XP ─────────────────────────────────────────────────────
    const S = ['300000000000000011', '300000000000000012', '300000000000000013', '300000000000000014', '300000000000000015', '300000000000000016'];
    const vs = (id, kanal, x = {}) => [id, { id, channelId: kanal, channel: { parentId: 'kat' }, member: { user: { bot: Boolean(x.bot) }, roles: { cache: new Map() } },
        selfDeaf: Boolean(x.taub), serverDeaf: false, selfMute: Boolean(x.stumm), serverMute: false, suppress: false }];
    const sprachGuild = { id: G, afkChannelId: 'afk', voiceStates: { cache: new Map([
        vs(S[0], 'v1'), vs(S[1], 'v1', { stumm: true }),
        vs(S[2], 'v2'), vs('300000000000000099', 'v2', { bot: true }),
        vs(S[3], 'afk'), vs(S[4], 'afk'),
        vs(S[5], null),
    ]) } };
    const JETZT = 1_763_200_000_000;
    const MIN = Math.floor(JETZT / 60_000);
    await pruefe('3j. Sprach-XP: voice:<m>:<minute>, AFK/allein nicht, zweimal = einmal', async () => {
        Regeln.vergiss();
        const r = await sprachxp.guildTakt(sprachGuild, JETZT);
        assert.deepStrictEqual(r, { gebucht: 2, minuten: 2 }, JSON.stringify(r));
        const b = await q("SELECT mitglied_id, menge, schluessel FROM fortschritt_buchungen WHERE guild_id = ? AND quelle = 'sprache' ORDER BY mitglied_id", [G]);
        assert.deepStrictEqual(b.map((x) => [x.mitglied_id, Number(x.menge), x.schluessel]), [[S[0], 10, `voice:${S[0]}:${MIN}`], [S[1], 10, `voice:${S[1]}:${MIN}`]]);
        assert.deepStrictEqual(await sprachxp.guildTakt(sprachGuild, JETZT + 5_000), { gebucht: 0, minuten: 0 }, 'gleiche Minute');
        sprachxp._letzterTakt.clear();
        sprachxp._gezaehlt.clear();
        assert.deepStrictEqual(await sprachxp.guildTakt(sprachGuild, JETZT + 10_000), { gebucht: 0, minuten: 2 }, 'nach Neustart: Schlüssel schützt (Zähler zählt die Minute neu, wie nach jedem Neustart)');
        await q('UPDATE level_einstellungen SET sprache_stumm_zaehlt = 0 WHERE guild_id = ?', [G]);
        Regeln.vergiss();
        assert.deepStrictEqual(await sprachxp.guildTakt(sprachGuild, JETZT + 60_000), { gebucht: 1, minuten: 1 }, 'stumm ohne XP');
        await q("UPDATE level_quellen SET aktiv = 0 WHERE guild_id = ? AND quelle = 'sprache'", [G]);
        Regeln.vergiss();
        assert.deepStrictEqual(await sprachxp.guildTakt(sprachGuild, JETZT + 120_000), { gebucht: 0, minuten: 0 }, 'Quelle aus');
        await zaehler.schreibe({ query: q });
        const z = await q('SELECT mitglied_id, sprachminuten FROM level_zaehler WHERE guild_id = ? AND sprachminuten > 0 ORDER BY mitglied_id', [G]);
        assert.deepStrictEqual(z.map((x) => [x.mitglied_id, Number(x.sprachminuten)]), [[S[0], 3], [S[1], 2]], JSON.stringify(z));
    });

    // ── K394: gesammeltes Löschen ────────────────────────────────────────────
    await pruefe('3k. messageDeleteBulk storniert jede junge Nachricht der Sammlung', async () => {
        await q('UPDATE level_einstellungen SET storno_loeschen_min = 10 WHERE guild_id = ?', [G]);
        Regeln.vergiss();
        uhr += 120_000;
        const n1 = nachricht(A, 'erste im stapel');
        assert.ok((await chatxp.beiNachricht(n1)).gebucht);
        const alt = { id: id(30 * 60_000), guildId: G };
        const stapel = new Map([[n1.id, { id: n1.id, guildId: G }], [alt.id, alt], ['x', { id: id(), guildId: G }]]);
        const r = await require(L('bot/events/messageDeleteBulk'))(stapel, { id: '200', guildId: G });
        assert.deepStrictEqual(r, { storniert: 1, geprueft: 3 });
        const [b] = await q('SELECT storniert_am FROM fortschritt_buchungen WHERE guild_id = ? AND schluessel = ?', [G, `msg:${n1.id}`]);
        assert.ok(b?.storniert_am, 'nicht storniert');
    });

    // ── LV-1e: Belohnungen ───────────────────────────────────────────────────
    const R1 = '400000000000000001';
    const R2 = '400000000000000002';
    const RH = '400000000000000003';
    /** Discord als Attrappe: Rollen, Bot-Rang, Mitglieder mit ihren Rollen. */
    function welt(gid, mitglieder) {
        const rollen = new Map([
            [R1, { id: R1, name: 'Eins', position: 2, managed: false }],
            [R2, { id: R2, name: 'Zwei', position: 3, managed: false }],
            [RH, { id: RH, name: 'Hoch', position: 20, managed: false }],
        ]);
        const guild = { id: gid, roles: { cache: rollen }, members: { me: { permissions: { has: () => true }, roles: { highest: { comparePositionTo: (r) => 10 - r.position } } } } };
        const mm = new Map();
        for (const [mid, set] of Object.entries(mitglieder)) {
            mm.set(mid, { id: mid, guild, roles: { cache: { has: (r) => set.has(r) }, add: async (r) => { if (Array.isArray(r)) throw new Error('Liste'); set.add(r); }, remove: async (r) => { set.delete(r); } } });
        }
        guild.members.fetch = async ({ user }) => {
            const m = mm.get(String(user));
            if (!m) { const e = new Error('Unknown Member'); e.code = 10007; throw e; }
            return m;
        };
        return guild;
    }
    const buch = async (gid, m) => (await q("SELECT rolle_id FROM rollen_vergaben WHERE guild_id = ? AND mitglied_id = ? AND besitzer = 'leveling:community' ORDER BY rolle_id", [gid, m])).map((z) => z.rolle_id);
    const C = '300000000000000021';
    const D = '300000000000000022';
    const traegtC = new Set();
    const traegtD = new Set();
    const wG = welt(G, { [C]: traegtC, [D]: traegtD });
    await pruefe('3l. Belohnungen: geben, vorherige entfernen, Abstieg nimmt, von Hand bleibt', async () => {
        await q("INSERT INTO level_belohnungen (guild_id, stufe, art, wert) VALUES (?, 1, 'rolle_geben', ?), (?, 2, 'rolle_geben', ?)", [G, R1, G, R2]);
        let e = await Belohnungen.gleicheAb({ guildId: G, mitglied: C, level: 1, guild: wG });
        assert.deepStrictEqual([e.vergeben, [...traegtC], await buch(G, C)], [[R1], [R1], [R1]]);
        const [ev] = await q("SELECT betroffen, daten FROM ereignisbuch WHERE guild_id = ? AND name = 'leveling.belohnung.vergeben'", [G]);
        const daten = typeof ev?.daten === 'string' ? JSON.parse(ev.daten) : ev?.daten;
        assert.ok(ev?.betroffen === C && daten?.stufe === 1 && daten?.art === 'rolle' && daten?.rollen?.[0] === R1, JSON.stringify(ev));
        e = await Belohnungen.gleicheAb({ guildId: G, mitglied: C, level: 2, guild: wG });
        assert.deepStrictEqual([e.vergeben, [...traegtC].sort()], [[R2], [R1, R2]], 'vorherige bleiben (aus)');
        await q('UPDATE level_einstellungen SET vorherige_rollen_entfernen = 1 WHERE guild_id = ?', [G]);
        e = await Belohnungen.gleicheAb({ guildId: G, mitglied: C, level: 2, guild: wG });
        assert.deepStrictEqual([e.entzogen, [...traegtC], await buch(G, C)], [[R1], [R2], [R2]], 'vorherige entfernen');
        e = await Belohnungen.gleicheAb({ guildId: G, mitglied: C, level: 0, guild: wG });
        assert.deepStrictEqual([e.entzogen, [...traegtC], await buch(G, C)], [[R2], [], []], 'Abstieg');
        traegtC.add(R1);
        e = await Belohnungen.gleicheAb({ guildId: G, mitglied: C, level: 1, guild: wG });
        assert.deepStrictEqual([e.vergeben, await buch(G, C)], [[], []], 'von Hand getragen: nichts gebucht (Regel 2)');
        await Belohnungen.gleicheAb({ guildId: G, mitglied: C, level: 0, guild: wG });
        assert.ok(traegtC.has(R1), 'Rolle von Hand genommen');
        await q('UPDATE level_einstellungen SET vorherige_rollen_entfernen = 0 WHERE guild_id = ?', [G]);
    });
    await pruefe('3m. Chat: Aufstieg gibt die Rolle, Löschen der Nachricht nimmt sie wieder', async () => {
        uhr += 120_000;
        const n = { ...nachricht(D, 'mit faktor und rolle', { rollen: ['777'] }), guild: wG };
        const r = await chatxp.beiNachricht(n);
        assert.ok(r.gebucht && r.ergebnis.level === 1, JSON.stringify(r.ergebnis));
        assert.deepStrictEqual([[...traegtD], await buch(G, D)], [[R1], [R1]]);
        const s = await chatxp.beiLoeschung({ id: n.id, guildId: G, guild: wG });
        assert.ok(s.storniert);
        assert.deepStrictEqual([[...traegtD], await buch(G, D)], [[], []], 'Storno nahm die Rolle nicht');
    });
    await pruefe('3n. /levels sync: vergeben, entfernt, zu hoch, nicht mehr da, Prestige behält', async () => {
        const G3 = '100000000000000003';
        const [E, F, X, P] = ['300000000000000031', '300000000000000032', '300000000000000033', '300000000000000034'];
        const tE = new Set(); const tF = new Set([R1]); const tP = new Set();
        const w3 = welt(G3, { [E]: tE, [F]: tF, [P]: tP });
        await q("INSERT INTO level_belohnungen (guild_id, stufe, art, wert) VALUES (?, 1, 'rolle_geben', ?), (?, 2, 'rolle_geben', ?), (?, 2, 'rolle_geben', ?)", [G3, R1, G3, R2, G3, RH]);
        await Fortschritt.stufen({ guildId: G3, kennung: K });
        await q('INSERT INTO fortschritt_stand (guild_id, kennung, mitglied_id, xp, level, prestige) VALUES (?, ?, ?, 300, 2, 0), (?, ?, ?, 0, 0, 0), (?, ?, ?, 300, 2, 0), (?, ?, ?, 5, 0, 1)',
            [G3, K, E, G3, K, F, G3, K, X, G3, K, P]);
        await q("INSERT INTO rollen_vergaben (guild_id, mitglied_id, rolle_id, besitzer) VALUES (?, ?, ?, 'leveling:community')", [G3, F, R1]);
        const meldungen = [];
        const { sync } = require(L('bot/sync'));
        const e = await sync({ guild: w3, fortschritt: (s) => meldungen.push(s), abstandMs: 0 });
        assert.strictEqual(e.gesamt, 4);
        assert.strictEqual(e.vergeben, 4, 'E: R1, R2; P (Prestige → höchste Stufe): R1, R2');
        assert.strictEqual(e.entzogen, 1, 'F: R1');
        assert.strictEqual(e.fort, 1, 'X ist nicht mehr da');
        assert.deepStrictEqual(e.fehlgeschlagen.map((f) => [f.mitglied, f.rolle, f.grund]).sort(), [[E, RH, 'ZU_HOCH'], [P, RH, 'ZU_HOCH']]);
        assert.deepStrictEqual([[...tE].sort(), [...tF], [...tP].sort()], [[R1, R2], [], [R1, R2]]);
        assert.strictEqual(meldungen.length, 4, 'Fortschritt je Mitglied (Abstand 0)');
        assert.ok(!require(L('bot/sync'))._laufend.size, 'Sperre bleibt stehen');
        const zweimal = await Promise.all([sync({ guild: w3 }), sync({ guild: w3 })]);
        assert.ok(zweimal.some((z) => z.laeuftSchon), 'zwei Abgleiche gleichzeitig');
    });

    await c.end();
    assert.deepStrictEqual(gesehen, [], `Fehler im Log: ${gesehen.join(' | ')}`);

    // ── 4: Gegenproben ───────────────────────────────────────────────────────
    console.log('\nGegenproben');
    const mit = (feld, alt, neu) => ({ ...texte, [feld]: texte[feld].replace(alt, neu) });
    const rot = async (was, t) => pruefe(`rot: ${was}`, () => assert.ok(pruefeVerdrahtung(t).length > 0, 'bleibt grün'));
    await rot('messageCreate ohne Aufruf', mit('erstellt', 'beiNachricht(message)', 'null'));
    await rot('messageDelete ohne Aufruf', mit('geloescht', 'beiLoeschung(message)', 'null'));
    await rot('Hörer nicht eingetragen', mit('dashboard', "Ereignisse.hoere('automod.verstoss'", "Ereignisse.hoere('automod.raid'"));
    await rot('automod meldet nicht', mit('automod', "Ereignisse.melde('automod.verstoss'", "Ereignisse.melde('automod.raid'"));
    await rot('automod ohne Nachrichten-ID', mit('automod', 'nachricht: message.id', 'nachricht: null'));
    await rot('ein Feld ohne Grund', mit('automod', "gruende.push('link');", ''));
    await rot('Kern löscht Fortschritte nicht', mit('kern', 'Fortschritt.loeschePlugin({ guildId, plugin: pluginName })', 'null'));
    await rot('Kern löscht auch in der Kontroll-Guild', mit('kern', 'if (!inhalteBleiben) {', 'if (true) {'));
    await rot('messageDeleteBulk ohne Aufruf', mit('gesammelt', 'beiLoeschung(message)', 'null'));
    await rot('Sprach-Takt nicht im Minutentakt', mit('botIndex', 'sprachxp.takt()', 'null'));
    await rot('Sprach-XP ohne nachBuchung', mit('sprachxp', 'await nachBuchung({', 'await null; ({'));
    await rot('Löschen ohne Belohnungen danach', mit('chatxp', 'if (s.wechsel) await nachBuchung', 'if (false) await nachBuchung'));
    await rot('automod-Storno ohne Belohnungen danach', mit('hoerer', 'Belohnungen.gleicheAb(', 'Belohnungen.lade('));
    await rot('/levels sync ohne Rechtefrage', mit('levels', 'if (!recht.darf) return', 'if (false) return'));
    await rot('/levels sync mit anderem Recht', mit('levels', "const RECHT = 'LEVELING.REWARDS.MANAGE'", "const RECHT = 'LEVELING.VIEW'"));
    await rot('Dashboard prüft das Recht nicht', mit('ipc', 'permissionManager.hasPermission(String(actorId)', 'Boolean(String(actorId)'));

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✓ alles grün');
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
