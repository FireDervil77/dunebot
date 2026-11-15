#!/usr/bin/env node
/**
 * Leveling Stufe 1, erster Block (LV-1a, LV-1b, LV-1c, K382, 2026-11-15).
 *
 * Geprüft wird:
 *
 *   1  Verdrahtung  Bot-Events messageCreate/messageDelete rufen die Chat-XP,
 *                   das Dashboard hört `automod.verstoss` mit dem Hörer aus
 *                   `dashboard/hoerer.js`, automod meldet das Ereignis mit
 *                   festen Gründen, der Kern löscht beim Abschalten die
 *                   Fortschritte des Plugins (nicht in der Kontroll-Guild)
 *   2  Regeln       Ausschluss, „nur diese“, Faktoren (Kanal genauester,
 *                   Rolle höchster), Kette Thread → Kanal → Kategorie,
 *                   Menge, Taktung und gleicher Text
 *   3  Läufe        an TEMPORARY-Kopien von `level_*`, `fortschritt_*` und
 *                   `ereignisbuch` mit echtem SQL: nicht eingerichtet →
 *                   nichts, Startwerte, Buchung `msg:<id>`, Taktung, gleicher
 *                   Text, zu kurz, Bot, Ausschluss, Aufstieg meldet
 *                   `leveling.level.erreicht`, Löschen in der Frist storniert,
 *                   zu alt nicht, automod storniert, Zähler, Abschalten
 *                   löscht nur `leveling:*`
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
    dashboard: 'plugins/leveling/dashboard/index.js',
    automod: 'plugins/automod/bot/events/messageCreate.js',
    kern: 'apps/dashboard/helpers/PluginManager.js',
};

function pruefeVerdrahtung(t) {
    const aus = [];
    if (!/require\(['"]\.\.\/chatxp['"]\)/.test(t.erstellt) || !/beiNachricht\(message\)/.test(t.erstellt)) aus.push('messageCreate ruft beiNachricht nicht');
    if (!/require\(['"]\.\.\/chatxp['"]\)/.test(t.geloescht) || !/beiLoeschung\(message\)/.test(t.geloescht)) aus.push('messageDelete ruft beiLoeschung nicht');
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
        assert.ok(p.ereignisse.sendet.includes('leveling.level.erreicht') && p.ereignisse.hoert.includes('automod.verstoss'));
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

    // ── 3: Läufe an TEMPORARY-Kopien ─────────────────────────────────────────
    const mysql = require('mysql2/promise');
    const c = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
        supportBigNumbers: true, bigNumberStrings: true });
    const schreibt = /^\s*(INSERT|UPDATE|DELETE|REPLACE|TRUNCATE|CREATE|DROP|ALTER)\b/i;
    const KOPIEN = /\b(fortschritt_|level_|ereignisbuch\b)/;
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
    for (const s of ddl.filter((x) => /CREATE TABLE IF NOT EXISTS (fortschritt_|level_|ereignisbuch\b)/.test(x))) {
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

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✓ alles grün');
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
