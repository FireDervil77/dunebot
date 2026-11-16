#!/usr/bin/env node
/**
 * Logging Stufe 1 (LG-1a, LG-1b Teil 1 und 2, LG-1c, K382, 2026-11-16).
 *
 * Geprüft wird:
 *
 *   1  Verdrahtung  jede Datei unter bot/events heißt wie ein Ereignis von
 *                   discord.js und geht über `mitglieder.js`/`struktur.js`
 *                   zum Erfasser; jede Art steht in genau einer Kategorie und
 *                   hat Texte in beiden Sprachen, ebenso jedes Feld, das ein
 *                   Erfasser schreibt; jede Tabelle der Migration steht in
 *                   `guildInhalte`; Seiten mit Recht, Speichern mit CSRF;
 *                   die Einstellseite hat für jede Kategorie und Art einen
 *                   Schalter; der Bot liest nie `.content` (nur Metadaten,
 *                   bis Stufe 2 nach G-04 und F-LG2)
 *   2  Regeln       Vorgabe ohne Zeile, Kategorie/Art aus, Ausschlüsse,
 *                   „kritisch geht nie verloren“ (umgeht Ausschlüsse, nicht
 *                   Kategorie/Art), Menge „irgendwo an“; Rechte-Unterschiede
 *                   (Rolle, Überschreibung, @everyone), Schweren; Erfasser
 *                   für Mitglieder, Bots, Kanäle, Rollen, Server, Einladungen
 *                   mit Attrappen aus discord.js-Werten; Zeile, Schlüssel;
 *                   Eingaben der Einstellseite; Anzeige. Teil 2: Nachrichten
 *                   (nur Merkmale, Link-Vorschau zählt nicht), Sprache,
 *                   Emojis/Sticker, Threads/Foren, Termine; Arten mit
 *                   Vorgabe „aus“
 *   2c Zuordnung    (LG-1c) jede Art der Audit-Tabelle steht im Katalog,
 *                   jede Aktion gibt es in discord.js; Aufteilung nach
 *                   geänderten Feldern; Ziel und Kanal; Kick benennt um;
 *                   Zuordner: ohne Recht kein Warten, Ereignis zuerst,
 *                   Eintrag zuerst, zwei Täter → wahrscheinlich, Ablauf ohne
 *                   Eintrag, Bündel nur mit bekanntem Bündel nachgefragt
 *   3  Läufe        an TEMPORARY-Kopien aller `log_*`-Tabellen mit echtem
 *                   SQL: Ereignis landet mit allen Spalten, dasselbe zweimal
 *                   ergibt eine Zeile, Kategorie aus → nichts, Kategorie
 *                   nirgends an → keine Abfrage der Regeln, Ausschluss
 *                   Mitglied → nichts, kritisch trotzdem, neuer Name → neue
 *                   Zeile in `log_namen`; Art mit Vorgabe „aus“ erst nach
 *                   einer Zeile `aktiv = 1`; neue Nachricht ohne @everyone
 *                   → keine Abfrage; Kick mit Täter landet als
 *                   „gekickt“ mit Ankunftszeit, ausgeschlossener Täter → nichts
 *
 * Gegenproben: Jede Prüfung in 1 läuft einmal gegen eine eingebaute
 * Verletzung und muss dort rot werden.
 *
 *   node scripts/check-logging.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const { ohneKommentare } = require('./lib/quelltext');
const { ServiceManager } = require('dunebot-core');
const { Events, PermissionsBitField } = require('discord.js');

const L = (...p) => path.join(WURZEL, 'plugins/logging', ...p);
const lies = (p) => fs.readFileSync(p, 'utf8');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 6).join('\n      ')}`); }
}
/** Gegenprobe: `tun` muss werfen. */
function rot(was, tun) {
    let geworfen = false;
    try { tun(); } catch { geworfen = true; }
    if (!geworfen) throw new Error(`Gegenprobe blieb grün: ${was}`);
}

const gesehen = [];
ServiceManager.register('Logger', { debug() {}, info() {}, success() {}, warn() {}, error: (...a) => gesehen.push(a.map((x) => (x && x.message) || String(x)).join(' ')) });

const Katalog = require(L('shared/katalog'));
const Regeln = require(L('shared/regeln'));
const V = require(L('shared/vergleich'));
const Anzeige = require(L('shared/anzeige'));
const Erfasser = require(L('bot/erfasser'));
const M = require(L('bot/mitglieder'));
const S = require(L('bot/struktur'));
const N = require(L('bot/nachrichten'));
const Sp = require(L('bot/sprache'));
const Ad = require(L('bot/ausdruck'));
const T = require(L('bot/threads'));
const Te = require(L('bot/termine'));
const MODULE = 'mitglieder|struktur|nachrichten|sprache|ausdruck|threads|termine';

const GUILD = '100000000000000001';
const A = '200000000000000002';
const B = '200000000000000003';
const ROLLE = '300000000000000004';
const ADMIN = '300000000000000005';
const KANAL = '400000000000000006';
const bits = (...namen) => new PermissionsBitField(namen).bitfield;

// ── Prüfungen als Funktionen, damit die Gegenproben sie mit Verletzungen rufen ──

function pruefeEreignisDateien(dateien) {
    const bekannt = new Set(Object.values(Events));
    const falsch = dateien.filter((d) => !bekannt.has(d.name));
    assert.deepStrictEqual(falsch.map((d) => d.name), [], 'kein Ereignis von discord.js');
    // guildAuditLogEntryCreate schreibt keine Zeile, es beantwortet „wer war's“ (LG-1c).
    const weg = (d) => (d.name === 'guildAuditLogEntryCreate'
        ? /require\('\.\.\/zuordner'\)/.test(d.quelle) && /\.eintrag\(/.test(d.quelle)
        : new RegExp(`require\\('\\.\\./(${MODULE})'\\)`).test(d.quelle) && /\.melde\(/.test(d.quelle));
    const ohneWeg = dateien.filter((d) => !weg(d));
    assert.deepStrictEqual(ohneWeg.map((d) => d.name), [], `geht nicht über ${MODULE} zum Erfasser`);
}

function pruefeTexte(katalog, de, en, felder) {
    const fehlt = [];
    const arten = new Map();
    for (const [k, v] of Object.entries(katalog)) {
        for (const sprache of [['de', de], ['en', en]]) {
            if (!sprache[1].KATEGORIEN?.[k.toUpperCase()]) fehlt.push(`${sprache[0]} KATEGORIEN.${k.toUpperCase()}`);
            if (!sprache[1].KATEGORIEN?.[`${k.toUpperCase()}_TEXT`]) fehlt.push(`${sprache[0]} KATEGORIEN.${k.toUpperCase()}_TEXT`);
        }
        for (const a of v.arten) {
            if (arten.has(a)) fehlt.push(`Art ${a} in ${arten.get(a)} und ${k}`);
            arten.set(a, k);
            const s = a.replace('.', '_').toUpperCase();
            if (!de.ARTEN?.[s]) fehlt.push(`de ARTEN.${s}`);
            if (!en.ARTEN?.[s]) fehlt.push(`en ARTEN.${s}`);
        }
    }
    for (const f of felder) {
        if (!de.FELDER?.[f.toUpperCase()]) fehlt.push(`de FELDER.${f.toUpperCase()}`);
        if (!en.FELDER?.[f.toUpperCase()]) fehlt.push(`en FELDER.${f.toUpperCase()}`);
    }
    assert.deepStrictEqual(fehlt, [], 'Texte fehlen');
}

function pruefeOhneInhalt(quellen) {
    const treffer = quellen.filter((q) => /\.(content|cleanContent)\b/.test(q.quelle)).map((q) => q.name);
    assert.deepStrictEqual(treffer, [], 'liest Nachrichteninhalt (Stufe 1 speichert nur Metadaten)');
}

function pruefeAuditTabelle(tabelle, katalog) {
    const { AuditLogEvent } = require('discord.js');
    const fehlt = [];
    for (const [name, z] of Object.entries(tabelle)) {
        if (typeof AuditLogEvent[name] !== 'number') fehlt.push(`Aktion ${name} gibt es in discord.js nicht`);
        for (const a of z.arten) if (!katalog.kategorieVon(a)) fehlt.push(`${name}: Art ${a} steht in keiner Kategorie`);
        for (const [k, arten] of Object.entries(z.schluessel || {})) {
            for (const a of arten) if (!z.arten.includes(a)) fehlt.push(`${name}.${k}: ${a} nicht unter arten`);
        }
        if (z.wird) for (const a of z.arten) if (/\.verlassen$/.test(a) && !katalog.kategorieVon(a.replace(/\.verlassen$/, `.${z.wird}`))) fehlt.push(`${name}: ${a} → ${z.wird} steht in keiner Kategorie`);
    }
    assert.deepStrictEqual(fehlt, [], 'Audit-Tabelle passt nicht zum Katalog');
}

function pruefeGuildInhalte(migration, paket) {
    const tabellen = [...migration.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]).sort();
    assert.deepStrictEqual([...(paket.guildInhalte?.loeschen || [])].sort(), tabellen, 'guildInhalte.loeschen ≠ Tabellen der Migration');
}

(async () => {
    console.log('\nLogging Stufe 1 (LG-1a, LG-1b Teil 1)');

    // ── 1: Verdrahtung ───────────────────────────────────────────────────────
    const eventsOrt = L('bot/events');
    const dateien = fs.readdirSync(eventsOrt).filter((f) => f.endsWith('.js'))
        .map((f) => ({ name: f.replace(/\.js$/, ''), quelle: ohneKommentare(lies(path.join(eventsOrt, f))) }));
    await pruefe(`${dateien.length} Ereignis-Dateien heißen wie Ereignisse von discord.js und gehen zum Erfasser`, () => {
        pruefeEreignisDateien(dateien);
        rot('falscher Name', () => pruefeEreignisDateien([...dateien, { name: 'memberJoin', quelle: dateien[0].quelle }]));
        rot('ohne Erfasser', () => pruefeEreignisDateien([{ name: 'roleCreate', quelle: 'module.exports = () => {};' }]));
        rot('fremdes Modul', () => pruefeEreignisDateien([{ name: 'roleCreate', quelle: "const X = require('../anderes'); X.melde();" }]));
        rot('Audit ohne Zuordner', () => pruefeEreignisDateien([{ name: 'guildAuditLogEntryCreate', quelle: "const S = require('../struktur'); S.melde();" }]));
        assert.ok(dateien.some((d) => d.name === 'guildAuditLogEntryCreate'), 'LG-1c: guildAuditLogEntryCreate fehlt');
        const erwartet = ['messageDelete', 'messageUpdate', 'messageDeleteBulk', 'messageCreate', 'voiceStateUpdate', 'emojiCreate', 'emojiDelete',
            'emojiUpdate', 'stickerCreate', 'stickerDelete', 'stickerUpdate', 'threadCreate', 'threadDelete', 'threadUpdate', 'threadMembersUpdate',
            'guildScheduledEventCreate', 'guildScheduledEventDelete', 'guildScheduledEventUpdate', 'guildScheduledEventUserAdd', 'guildScheduledEventUserRemove'];
        const fehlt = erwartet.filter((n) => !dateien.some((d) => d.name === n));
        assert.deepStrictEqual(fehlt, [], 'Teil 2: Ereignis-Datei fehlt');
    });

    const de = JSON.parse(lies(L('dashboard/locales/de-DE.json')));
    const en = JSON.parse(lies(L('dashboard/locales/en-GB.json')));
    // Felder, die die Erfasser schreiben: aus einem Lauf jeder Bauform gesammelt (unten in 2), hier vorab die festen.
    const felder = new Set();
    const sammle = (liste) => { for (const e of liste) for (const f of [...Object.keys(e.vorher || {}), ...Object.keys(e.nachher || {})]) if (!['dazu', 'weg', 'rechte', 'erlaubt'].includes(f)) felder.add(f); return liste; };

    await pruefe('Einstellseite: Schalter für jede Kategorie und Art, Seiten mit Recht, Speichern mit CSRF', () => {
        const ansicht = ohneKommentare(lies(L('dashboard/views/guild/logging-einstellungen.ejs')));
        assert.ok(/data-kategorie="<%= k %>"/.test(ansicht) && /Object\.entries\(katalog\)/.test(ansicht), 'Karte je Kategorie fehlt');
        assert.ok(/data-art="<%= a %>"/.test(ansicht) && /v\.arten\.forEach/.test(ansicht), 'Schalter je Art fehlt');
        assert.ok(/include\('shared\/aufbewahrung', \{ guildId, tr, plugin: 'logging' \}\)/.test(ansicht), 'Kern-Teil Fristen fehlt');
        const router = ohneKommentare(lies(L('dashboard/routes/guild.router.js')));
        assert.ok(/router\.get\('\/ereignisse', requirePermission\('LOGGING\.VIEW'\)/.test(router), '/ereignisse ohne LOGGING.VIEW');
        assert.ok(/router\.get\('\/einstellungen', requirePermission\('LOGGING\.CONFIGURE'\)/.test(router), '/einstellungen ohne LOGGING.CONFIGURE');
        assert.ok(/router\.put\('\/einstellungen', csrfProtection, requirePermission\('LOGGING\.CONFIGURE'\)/.test(router), 'Speichern ohne CSRF/Recht');
        const nav = ohneKommentare(lies(L('dashboard/index.js')));
        assert.ok(/url: `\$\{basis\}\/einstellungen`,[^}]*capability: 'LOGGING\.CONFIGURE'/.test(nav), 'Menü Einstellungen mit anderem Recht als die Seite');
        assert.ok(/url: `\$\{basis\}\/ereignisse`,[^}]*capability: 'LOGGING\.VIEW'/.test(nav), 'Menü Ereignisse mit anderem Recht als die Seite');
    });

    await pruefe('Bot liest nie Nachrichteninhalt', () => {
        const quellen = fs.readdirSync(L('bot')).filter((f) => f.endsWith('.js'))
            .map((f) => ({ name: f, quelle: ohneKommentare(lies(L('bot', f))) }))
            .concat(dateien);
        pruefeOhneInhalt(quellen);
        rot('liest content', () => pruefeOhneInhalt([{ name: 'x.js', quelle: 'const t = message.content;' }]));
    });

    await pruefe('Jede Tabelle der Migration steht in guildInhalte, Fristen nennen nur eigene Tabellen', () => {
        const mig = lies(L('migrations/20261116_090000_baseline.js'));
        const paket = JSON.parse(lies(L('package.json')));
        pruefeGuildInhalte(mig, paket);
        rot('Tabelle fehlt', () => pruefeGuildInhalte(mig + '\nCREATE TABLE IF NOT EXISTS log_neu (', paket));
        const tabellen = new Set(paket.guildInhalte.loeschen);
        for (const f of paket.aufbewahrung) assert.ok(tabellen.has(f.tabelle), `Frist ${f.name} auf fremder Tabelle ${f.tabelle}`);
        assert.ok(paket.nurKontrollGuild === true, 'Stufe 1 bleibt nurKontrollGuild bis zur Probe');
    });

    // ── 2: Regeln ────────────────────────────────────────────────────────────
    await pruefe('Vorgabe ohne Zeile, Kategorie/Art aus, Ausschlüsse, kritisch umgeht nur Ausschlüsse', () => {
        const leer = Regeln.ordne([]);
        const e = { kategorie: 'mitglieder', art: 'mitglied.rollen', schwere: 'info', betroffen: A, rollen: [ROLLE], kanaele: [KANAL] };
        assert.deepStrictEqual(Regeln.darf(leer, e), { erlaubt: true, grund: null }, 'Vorgabe an');
        assert.strictEqual(Regeln.darf(leer, { ...e, kategorie: 'gibtsnicht' }).grund, 'kategorie_aus');
        const r = Regeln.ordne([
            { regel: 'kategorie', ziel: 'server', aktiv: 0 }, { regel: 'art', ziel: 'mitglied.avatar', aktiv: 0 },
            { regel: 'mitglied', ziel: B, aktiv: 1 }, { regel: 'rolle', ziel: ROLLE, aktiv: 1 },
            { regel: 'kanal', ziel: KANAL, aktiv: 1 }, { regel: 'bots', ziel: '', aktiv: 1 },
        ]);
        assert.strictEqual(Regeln.darf(r, { kategorie: 'server', art: 'rolle.rechte', schwere: 'kritisch' }).grund, 'kategorie_aus', 'kritisch umgeht keine abgeschaltete Kategorie');
        assert.strictEqual(Regeln.darf(r, { kategorie: 'mitglieder', art: 'mitglied.avatar', schwere: 'kritisch' }).grund, 'art_aus');
        assert.strictEqual(Regeln.darf(r, { ...e, rollen: [], kanaele: [], betroffen: B }).grund, 'mitglied');
        assert.strictEqual(Regeln.darf(r, { ...e, rollen: [], kanaele: [], betroffen: A, akteur: B }).grund, 'mitglied', 'Akteur ausgeschlossen');
        assert.strictEqual(Regeln.darf(r, { ...e, kanaele: [] }).grund, 'rolle');
        assert.strictEqual(Regeln.darf(r, { ...e, rollen: [] }).grund, 'kanal');
        assert.strictEqual(Regeln.darf(r, { ...e, rollen: [], kanaele: [], akteurIstBot: true }).grund, 'bots');
        assert.deepStrictEqual(Regeln.darf(r, { ...e, betroffen: B, schwere: 'kritisch', akteurIstBot: true }), { erlaubt: true, grund: null }, 'kritisch geht nie verloren');
        assert.ok(Regeln.kategorieAn(Regeln.ordne([{ regel: 'kategorie', ziel: 'mitglieder', aktiv: 0 }]), 'mitglieder') === false);
        // Arten mit Vorgabe „aus“ (Teil 2)
        assert.ok(Katalog.VORGABE_AUS.has('sprache.selbst_stumm') && !Katalog.VORGABE_AUS.has('sprache.beigetreten'));
        for (const a of Katalog.VORGABE_AUS) assert.ok(Katalog.kategorieVon(a), `Vorgabe aus: ${a} steht in keiner Kategorie`);
        const v = { kategorie: 'sprache', art: 'sprache.selbst_stumm', schwere: 'info' };
        assert.strictEqual(Regeln.darf(leer, v).grund, 'art_aus', 'Vorgabe aus ohne Zeile');
        assert.strictEqual(Regeln.darf(leer, { ...v, art: 'sprache.beigetreten' }).erlaubt, true);
        const an = Regeln.ordne([{ regel: 'art', ziel: 'sprache.selbst_stumm', aktiv: 1 }, { regel: 'art', ziel: 'sprache.beigetreten', aktiv: 0 }]);
        assert.strictEqual(Regeln.darf(an, v).erlaubt, true, 'Zeile aktiv=1 schaltet an');
        assert.strictEqual(Regeln.artAn(an, 'sprache.beigetreten'), false);
        assert.strictEqual(Regeln.darf(an, { ...v, schwere: 'kritisch', art: 'sprache.beigetreten' }).grund, 'art_aus');
    });

    await pruefe('Menge „irgendwo an“: nur Guilds mit Logging, Vorgabe zählt, abgeschaltet zählt nicht', () => {
        const alle = Object.keys(Katalog.KATEGORIEN).filter((k) => Katalog.KATEGORIEN[k].vorgabe);
        assert.deepStrictEqual([...Regeln.mengeAus(new Set([GUILD]), [])].sort(), alle.sort());
        assert.deepStrictEqual([...Regeln.mengeAus(new Set(), [{ guild_id: GUILD, ziel: 'server', aktiv: 1 }])], [], 'ohne Guild mit Logging nichts');
        const aus = alle.map((k) => ({ guild_id: GUILD, ziel: k, aktiv: 0 }));
        assert.deepStrictEqual([...Regeln.mengeAus(new Set([GUILD]), aus)], []);
        assert.deepStrictEqual([...Regeln.mengeAus(new Set([GUILD, '9'.repeat(18)]), aus)].sort(), alle.sort(), 'zweite Guild mit Vorgabe');
    });

    await pruefe('Rechte lesbar: Rolle, Überschreibung, @everyone; Schweren', () => {
        assert.deepStrictEqual(V.rechteUnterschied(bits('SendMessages'), bits('SendMessages', 'ManageRoles')), { neu: ['ManageRoles'], weg: [] });
        const u = V.ueberschreibungen(
            [{ id: ROLLE, type: 0, allow: bits('ViewChannel'), deny: 0n }, { id: A, type: 1, allow: 0n, deny: bits('SendMessages') }],
            [{ id: ROLLE, type: 0, allow: bits('ViewChannel', 'SendMessages'), deny: 0n }, { id: GUILD, type: 0, allow: 0n, deny: bits('ViewChannel') }]);
        assert.deepStrictEqual(u.map((x) => [x.ziel, x.typ, x.zustand, x.erlaubt.neu, x.verboten.neu, x.verboten.weg]), [
            [GUILD, 'rolle', 'neu', [], ['ViewChannel'], []],
            [A, 'mitglied', 'weg', [], [], ['SendMessages']],
            [ROLLE, 'rolle', 'geaendert', ['SendMessages'], [], []],
        ]);
        assert.deepStrictEqual(V.ueberschreibungen([{ id: ROLLE, type: 0, allow: 1n, deny: 0n }], [{ id: ROLLE, type: 0, allow: 1n, deny: 0n }]), [], 'gleich → nichts');
        assert.strictEqual(V.rechteSchwere({ neu: ['Administrator'] }, false), 'kritisch');
        assert.strictEqual(V.rechteSchwere({ neu: ['ManageGuild'] }, true), 'kritisch', 'Gefährliches an @everyone');
        assert.strictEqual(V.rechteSchwere({ neu: ['ManageGuild'] }, false), 'warnung');
        assert.strictEqual(V.rechteSchwere({ neu: ['SendMessages'] }, true), 'warnung');
        assert.strictEqual(V.schwerste('info', 'kritisch', 'warnung'), 'kritisch');
        assert.strictEqual(V.unterschied({ a: 1, b: null }, { a: 1, b: undefined }, ['a', 'b']), null, 'null = undefined');
    });

    // Attrappen in der Form, die discord.js liefert (nur gelesene Felder).
    const rollenCache = (ids) => new Map(ids.map((id) => [id, { id }]));
    const guildRollen = new Map([[ADMIN, { id: ADMIN, permissions: { bitfield: bits('Administrator') } }],
        [ROLLE, { id: ROLLE, permissions: { bitfield: bits('SendMessages') } }]]);
    const guild = { id: GUILD, roles: { cache: guildRollen } };
    const mitglied = (o = {}) => ({
        id: A, guild, partial: false, nickname: null, avatar: null, communicationDisabledUntilTimestamp: null, premiumSinceTimestamp: null,
        joinedTimestamp: Date.parse('2026-01-01T00:00:00Z'), displayName: 'Anna',
        user: { id: A, username: 'anna', globalName: 'Anna', bot: false, createdTimestamp: Date.parse('2020-01-01T00:00:00Z') },
        roles: { cache: rollenCache([GUILD]) }, ...o,
    });

    await pruefe('Mitglieder und Bots: Partial nichts, Spitzname, Rollen (Administrator kritisch), Timeout, Boost, Bot getrennt', () => {
        // So liefert discord.js ein ungecachtes altes Mitglied (G-13): leer, nur @everyone.
        const leeresAltes = { id: A, guild, partial: true, nickname: null, avatar: null, communicationDisabledUntilTimestamp: null,
            premiumSinceTimestamp: null, user: mitglied().user, roles: { cache: rollenCache([GUILD]) } };
        assert.deepStrictEqual(M.geaendert(leeresAltes, mitglied({ nickname: 'X', roles: { cache: rollenCache([GUILD, ROLLE]) },
            premiumSinceTimestamp: Date.now() })), [], 'Partial → nichts');
        const alt = mitglied();
        const neu = mitglied({ nickname: 'An', roles: { cache: rollenCache([GUILD, ADMIN]) },
            communicationDisabledUntilTimestamp: Date.now() + 600000, premiumSinceTimestamp: Date.now() });
        const e = sammle(M.geaendert(alt, neu));
        assert.deepStrictEqual(e.map((x) => [x.art, x.schwere]), [
            ['mitglied.spitzname', 'info'], ['mitglied.rollen', 'kritisch'], ['mitglied.timeout', 'warnung'], ['mitglied.boost', 'info'],
        ]);
        assert.deepStrictEqual(e[1].nachher, { dazu: [ADMIN], weg: [] });
        const ende = sammle(M.geaendert(mitglied({ communicationDisabledUntilTimestamp: Date.now() + 1000 }), mitglied()));
        assert.deepStrictEqual(ende.map((x) => x.art), ['mitglied.timeout_ende']);
        const bot = (o) => mitglied({ user: { id: B, username: 'botty', bot: true }, id: B, ...o });
        assert.deepStrictEqual(M.geaendert(bot(), bot({ roles: { cache: rollenCache([GUILD, ROLLE]) }, avatar: 'x' })).map((x) => [x.art, x.schwere]),
            [['bot.rollen', 'info']], 'Bot: Rollen unter bots, kein Avatar');
        assert.deepStrictEqual(sammle(M.beigetreten(mitglied())).map((x) => [x.art, x.nachher.konto_erstellt]), [['mitglied.beigetreten', '2020-01-01T00:00:00.000Z']]);
        const weg = sammle(M.verlassen(mitglied({ roles: { cache: rollenCache([GUILD, ROLLE]) } })));
        assert.deepStrictEqual(weg[0].vorher.rollen, [ROLLE], 'ohne @everyone');
        assert.strictEqual(M.verlassen({ id: A, partial: true, user: { id: A } })[0].vorher, null, 'Partial ohne Vorher');
        assert.strictEqual(M.gebannt({ user: { id: A } })[0].schwere, 'warnung');
        sammle(M.entbannt({ user: { id: A } }));
    });

    const kanal = (o = {}) => ({
        id: KANAL, guild, name: 'allgemein', type: 0, parentId: null, topic: null, nsfw: false, rateLimitPerUser: 0, bitrate: null, userLimit: null,
        rawPosition: 1, permissionOverwrites: { cache: new Map() }, ...o,
    });
    const ow = (id, type, allow, deny) => [id, { id, type, allow: { bitfield: allow }, deny: { bitfield: deny } }];
    const rolle = (o = {}) => ({ id: ROLLE, guild, name: 'Mod', hexColor: '#000000', hoist: false, mentionable: false, icon: null, unicodeEmoji: null,
        managed: false, permissions: { bitfield: bits('SendMessages') }, position: 3, ...o });
    const server = (o = {}) => ({ id: GUILD, name: 'Probe', icon: null, banner: null, description: null, ownerId: A, verificationLevel: 2,
        explicitContentFilter: 2, mfaLevel: 1, defaultMessageNotifications: 1, systemChannelId: null, rulesChannelId: null,
        publicUpdatesChannelId: null, afkChannelId: null, afkTimeout: 300, vanityURLCode: null, preferredLocale: 'de', nsfwLevel: 0, ...o });

    await pruefe('Kanäle, Rollen, Server, Webhooks, Einladungen: Position allein nichts, Rechte getrennt, Schweren', () => {
        assert.deepStrictEqual(S.kanalGeaendert(kanal(), kanal({ rawPosition: 5 })), [], 'Position allein → nichts');
        const k = sammle(S.kanalGeaendert(kanal(), kanal({ name: 'neu', permissionOverwrites: { cache: new Map([ow(GUILD, 0, bits('MentionEveryone'), 0n)]) } })));
        assert.deepStrictEqual(k.map((x) => [x.art, x.schwere]), [['kanal.geaendert', 'info'], ['kanal.rechte', 'kritisch']]);
        assert.deepStrictEqual(k[0].vorher, { name: 'allgemein' });
        const angelegt = sammle(S.kanalAngelegt(kanal({ permissionOverwrites: { cache: new Map([ow(ROLLE, 0, bits('ViewChannel'), 0n)]) } })));
        assert.deepStrictEqual([angelegt[0].art, angelegt[0].schwere, angelegt[0].nachher.rechte.length], ['kanal.angelegt', 'info', 1], 'Überschreibung beim Anlegen ist keine Warnung');
        assert.strictEqual(sammle(S.kanalGeloescht(kanal()))[0].schwere, 'warnung');
        assert.deepStrictEqual(S.rolleGeaendert(rolle(), rolle({ position: 9 })), [], 'Position allein → nichts');
        const r = sammle(S.rolleGeaendert(rolle(), rolle({ name: 'Admin', permissions: { bitfield: bits('SendMessages', 'Administrator') } })));
        assert.deepStrictEqual(r.map((x) => [x.art, x.schwere]), [['rolle.geaendert', 'info'], ['rolle.rechte', 'kritisch']]);
        const ev = S.rolleGeaendert(rolle({ id: GUILD }), rolle({ id: GUILD, permissions: { bitfield: bits('SendMessages', 'ManageGuild') } }));
        assert.strictEqual(ev[0].schwere, 'kritisch', '@everyone bekommt Gefährliches');
        assert.deepStrictEqual(sammle(S.rolleAngelegt(rolle({ permissions: { bitfield: bits('BanMembers') } }))).map((x) => x.schwere), ['warnung']);
        sammle(S.rolleGeloescht(rolle()));
        assert.deepStrictEqual(S.serverGeaendert(server(), server()), []);
        assert.strictEqual(sammle(S.serverGeaendert(server(), server({ ownerId: B })))[0].schwere, 'kritisch', 'neuer Besitzer');
        assert.strictEqual(sammle(S.serverGeaendert(server(), server({ verificationLevel: 0 })))[0].schwere, 'warnung', 'Verifizierung herab');
        assert.strictEqual(sammle(S.serverGeaendert(server(), server({ name: 'X', verificationLevel: 3 })))[0].schwere, 'info');
        sammle(S.serverGeaendert(server(), server({ icon: 'a', banner: 'b', description: 'c', explicitContentFilter: 1, mfaLevel: 0,
            defaultMessageNotifications: 0, systemChannelId: KANAL, rulesChannelId: KANAL, publicUpdatesChannelId: KANAL, afkChannelId: KANAL,
            afkTimeout: 60, vanityURLCode: 'x', preferredLocale: 'en-GB', nsfwLevel: 1 })));
        sammle(S.kanalGeaendert(kanal(), kanal({ type: 2, parentId: KANAL, topic: 't', nsfw: true, rateLimitPerUser: 5, bitrate: 64000, userLimit: 4 })));
        sammle(S.rolleGeaendert(rolle(), rolle({ hexColor: '#ff0000', hoist: true, mentionable: true, icon: 'i', unicodeEmoji: '🔥', managed: true })));
        assert.strictEqual(S.webhooksGeaendert(kanal())[0].kanal, KANAL);
        const inv = sammle(S.einladungAngelegt({ code: 'abc', inviter: { id: A }, channelId: KANAL, maxUses: 5, maxAge: 3600, temporary: false }));
        assert.deepStrictEqual([inv[0].akteur, inv[0].zuordnung, inv[0].objekt.name], [A, 'sicher', 'abc']);
        assert.strictEqual(S.einladungGeloescht({ code: 'abc', channelId: KANAL })[0].akteur, undefined);
        assert.deepStrictEqual(S.kette(kanal({ parentId: '500000000000000007' })), [KANAL, '500000000000000007']);
    });


    // ── Teil 2: Nachrichten, Sprache, Emojis/Sticker, Threads/Foren, Termine ──
    const sammlung = (ids) => new Map(ids.map((id) => [id, { id }]));
    const nachricht = (o = {}) => ({
        id: '600000000000000008', guildId: GUILD, channelId: KANAL, partial: false, createdTimestamp: Date.parse('2026-11-16T09:00:00Z'),
        editedTimestamp: null, pinned: false, webhookId: null, author: { id: A, username: 'anna', bot: false },
        attachments: sammlung([]), embeds: [], mentions: { users: sammlung([]), roles: sammlung([]), everyone: false }, ...o,
    });

    await pruefe('Nachrichten: nur Merkmale, Partial ehrlich, Link-Vorschau zählt nicht, Massenlöschung, @everyone', () => {
        const g = sammle(N.geloescht(nachricht({ attachments: sammlung(['1', '2']), mentions: { users: sammlung([B]), roles: sammlung([ROLLE]), everyone: true } })));
        assert.deepStrictEqual([g[0].art, g[0].betroffen, g[0].akteur, g[0].kanal], ['nachricht.geloescht', A, undefined, KANAL]);
        assert.deepStrictEqual(g[0].vorher, { erstellt_am: '2026-11-16T09:00:00.000Z', anhaenge: 2, embeds: 0, erwaehnungen: 2, everyone: true,
            bot: false, webhook: false, angeheftet: false }, 'Merkmale (Geisterping erkennbar), kein Text');
        const p = sammle(N.geloescht({ id: '1', guildId: GUILD, channelId: KANAL, partial: true, author: null }));
        assert.deepStrictEqual([p[0].betroffen, p[0].vorher], [null, { im_speicher: false }], 'Partial → unbekannt, nicht geraten');
        assert.deepStrictEqual(N.geloescht({ id: '1', guildId: null }), [], 'DM → nichts');
        const t = Date.parse('2026-11-16T10:00:00Z');
        assert.deepStrictEqual(N.bearbeitet(nachricht({ editedTimestamp: t }), nachricht({ editedTimestamp: t, embeds: [{}] }), t + 5000), [], 'Link-Vorschau → nichts');
        const b = sammle(N.bearbeitet(nachricht(), nachricht({ editedTimestamp: t, attachments: sammlung(['1']) }), t + 1000));
        assert.deepStrictEqual([b[0].art, b[0].akteur, b[0].zuordnung], ['nachricht.bearbeitet', A, 'sicher'], 'nur der Autor bearbeitet');
        assert.deepStrictEqual([b[0].vorher.anhaenge, b[0].nachher.anhaenge], [0, 1]);
        const altPartial = { id: '1', partial: true };
        assert.deepStrictEqual(N.bearbeitet(altPartial, nachricht({ editedTimestamp: t }), t + N.FRISCH_MS + 1), [], 'ungecacht, alte Bearbeitung → nichts');
        const f = sammle(N.bearbeitet(altPartial, nachricht({ editedTimestamp: t }), t + 1000));
        assert.deepStrictEqual([f[0].art, f[0].vorher.im_speicher], ['nachricht.bearbeitet', false]);
        assert.deepStrictEqual(N.bearbeitet(nachricht(), nachricht({ pinned: true })).map((x) => x.art), ['nachricht.angeheftet']);
        assert.deepStrictEqual(N.bearbeitet(nachricht({ pinned: true }), nachricht()).map((x) => x.art), ['nachricht.losgeheftet']);
        const m = sammle(N.massenloeschung([nachricht({ id: '1', author: { id: B } }), nachricht({ id: '2' }), nachricht({ id: '3', author: { id: B } }),
            { id: '4', partial: true }], { id: KANAL, guildId: GUILD, name: 'allgemein' }));
        assert.deepStrictEqual([m[0].art, m[0].schwere, m[0].vorher.anzahl, m[0].vorher.im_speicher, m[0].vorher.autoren], ['nachricht.massenloeschung', 'warnung', 4, 3, [A, B]]);
        assert.deepStrictEqual(N.everyone(nachricht()), [], 'ohne @everyone nichts');
        const e = sammle(N.everyone(nachricht({ mentions: { users: sammlung([]), roles: sammlung([]), everyone: true } })));
        assert.deepStrictEqual([e[0].art, e[0].akteur, e[0].zuordnung], ['nachricht.everyone', A, 'sicher']);
        assert.deepStrictEqual(N.ketteVon({ id: '7', parentId: KANAL, parent: { parentId: '500000000000000007' } }), ['7', KANAL, '500000000000000007'], 'Thread → Kanal → Kategorie');
    });

    await pruefe('Sprache: Beitritt (sicher), Verlassen/Wechsel (offen), Schalter, Bühne', () => {
        const vs = (o = {}) => ({ id: A, channelId: KANAL, serverMute: false, serverDeaf: false, selfMute: false, selfDeaf: false, selfVideo: false,
            streaming: false, suppress: false, requestToSpeakTimestamp: null, ...o });
        const j = sammle(Sp.aenderungen(vs({ channelId: null }), vs()));
        assert.deepStrictEqual([j[0].art, j[0].akteur, j[0].zuordnung, j[0].kanal], ['sprache.beigetreten', A, 'sicher', KANAL]);
        const l = sammle(Sp.aenderungen(vs(), vs({ channelId: null })));
        assert.deepStrictEqual([l[0].art, l[0].akteur], ['sprache.verlassen', undefined], 'Trennen kann ein Moderator sein');
        const w = sammle(Sp.aenderungen(vs(), vs({ channelId: '7' })));
        assert.deepStrictEqual([w[0].art, w[0].vorher.kanal, w[0].nachher.kanal], ['sprache.gewechselt', KANAL, '7']);
        assert.deepStrictEqual(Sp.aenderungen(vs(), vs()), [], 'nichts geändert');
        const s = sammle(Sp.aenderungen(vs(), vs({ serverMute: true, selfDeaf: true, selfVideo: true, streaming: true, serverDeaf: true, selfMute: true })));
        assert.deepStrictEqual(s.map((x) => [x.art, x.akteur || null]), [['sprache.server_stumm', null], ['sprache.server_taub', null],
            ['sprache.selbst_stumm', A], ['sprache.selbst_taub', A], ['sprache.kamera', A], ['sprache.bildschirm', A]]);
        const b = sammle(Sp.aenderungen(vs({ suppress: true }), vs({ suppress: false, requestToSpeakTimestamp: Date.now() })));
        assert.deepStrictEqual(b.map((x) => x.art), ['sprache.buehne', 'sprache.meldung']);
        assert.deepStrictEqual(b[0].nachher, { sprecher: true });
    });

    await pruefe('Emojis und Sticker: anlegen, ändern (nur Unterschied), löschen', () => {
        const emoji = (o = {}) => ({ id: '700000000000000009', name: 'feuer', animated: false, managed: false, roles: { cache: new Map() }, guild, ...o });
        assert.deepStrictEqual(sammle(Ad.emojiAngelegt(emoji())).map((x) => [x.art, x.objekt.typ]), [['emoji.angelegt', 'emoji']]);
        assert.deepStrictEqual(Ad.emojiGeaendert(emoji(), emoji()), []);
        const g = sammle(Ad.emojiGeaendert(emoji(), emoji({ name: 'flamme', roles: { cache: new Map([[ROLLE, {}]]) } })));
        assert.deepStrictEqual([g[0].vorher, g[0].nachher], [{ name: 'feuer', rollen: [] }, { name: 'flamme', rollen: [ROLLE] }]);
        sammle(Ad.emojiGeaendert(emoji(), emoji({ animated: true, managed: true })));
        sammle(Ad.emojiGeloescht(emoji()));
        const st = (o = {}) => ({ id: '700000000000000010', guildId: GUILD, name: 'hallo', description: 'winkt', tags: 'wave', format: 1, ...o });
        sammle(Ad.stickerAngelegt(st()));
        const sg = sammle(Ad.stickerGeaendert(st(), st({ tags: 'hi', description: 'x', name: 'h', format: 2 })));
        assert.strictEqual(sg[0].art, 'sticker.geaendert');
        assert.deepStrictEqual(Ad.stickerGeaendert(st(), st()), []);
        sammle(Ad.stickerGeloescht(st()));
    });

    await pruefe('Threads und Foren: nur neu angelegte, Forum getrennt, Tags mit Namen, Archiv allein eigene Art, Mitglieder', () => {
        const forum = { id: KANAL, type: 15, parentId: '500000000000000007', availableTags: [{ id: '11', name: 'Hilfe' }, { id: '12', name: 'Gelöst' }] };
        const textkanal = { id: KANAL, type: 0, parentId: null };
        const th = (o = {}) => ({ id: '800000000000000011', guildId: GUILD, name: 'Frage', type: 11, archived: false, locked: false,
            autoArchiveDuration: 1440, rateLimitPerUser: 0, invitable: null, ownerId: A, parentId: KANAL, parent: textkanal, appliedTags: [], ...o });
        assert.deepStrictEqual(T.angelegt(th(), false), [], 'beim ersten Sehen → nichts');
        const a = sammle(T.angelegt(th(), true));
        assert.deepStrictEqual([a[0].art, a[0].akteur, a[0].zuordnung, a[0].nachher.tags], ['thread.angelegt', A, 'sicher', null]);
        const fa = sammle(T.angelegt(th({ parent: forum, appliedTags: ['12', '11'] }), true));
        assert.deepStrictEqual([fa[0].art, fa[0].nachher.tags], ['forum.beitrag_angelegt', ['Gelöst', 'Hilfe']]);
        assert.deepStrictEqual(sammle(T.geaendert(th(), th({ archived: true }))).map((x) => x.art), ['thread.archiviert'], 'nur archiviert → eigene Art');
        const g = sammle(T.geaendert(th(), th({ archived: true, name: 'Frage (gelöst)', locked: true, autoArchiveDuration: 60, rateLimitPerUser: 5 })));
        assert.deepStrictEqual(g.map((x) => x.art), ['thread.geaendert']);
        const pt = sammle(T.geaendert(th({ type: 12, invitable: true }), th({ type: 12, invitable: false })));
        assert.deepStrictEqual(pt[0].nachher, { einladbar: false });
        const ft = sammle(T.geaendert(th({ parent: forum, appliedTags: ['11'] }), th({ parent: forum, appliedTags: ['12'] })));
        assert.deepStrictEqual([ft[0].art, ft[0].vorher.tags, ft[0].nachher.tags], ['forum.beitrag_geaendert', ['Hilfe'], ['Gelöst']]);
        assert.deepStrictEqual(T.geaendert(null, th()), [], 'ohne alten Stand nichts');
        assert.deepStrictEqual(sammle(T.geloescht(th({ parent: forum }))).map((x) => x.art), ['forum.beitrag_geloescht']);
        const mi = T.mitglieder(new Map([[B, { id: B }]]), new Map([[A, { id: A }]]), th());
        assert.deepStrictEqual(mi.map((x) => [x.art, x.betroffen]), [['thread.mitglied_dazu', B], ['thread.mitglied_weg', A]]);
        const tags = sammle(T.forumTags({ ...forum, name: 'hilfe' }, { ...forum, name: 'hilfe', availableTags: [{ id: '11', name: 'Hilfe' }] }));
        assert.deepStrictEqual([tags[0].art, tags[0].vorher.tags, tags[0].nachher.tags], ['forum.tags_geaendert', ['Gelöst', 'Hilfe'], ['Hilfe']]);
        assert.deepStrictEqual(T.forumTags(kanal(), kanal({ name: 'x' })), [], 'kein Forum → nichts');
    });

    await pruefe('Termine: angelegt (Anleger sicher), Status eigene Art, Änderung, Interesse', () => {
        const te = (o = {}) => ({ id: '900000000000000012', guildId: GUILD, name: 'Spieleabend', scheduledStartTimestamp: Date.parse('2026-11-20T18:00:00Z'),
            scheduledEndTimestamp: null, channelId: KANAL, entityMetadata: null, entityType: 2, privacyLevel: 2, status: 1, creatorId: A, ...o });
        const a = sammle(Te.angelegt(te()));
        assert.deepStrictEqual([a[0].art, a[0].akteur, a[0].zuordnung, a[0].nachher.start], ['termin.angelegt', A, 'sicher', '2026-11-20T18:00:00.000Z']);
        assert.ok(!('beschreibung' in a[0].nachher), 'Beschreibung ist freier Text, bleibt draußen');
        assert.deepStrictEqual(sammle(Te.geaendert(te(), te({ status: 2 }))).map((x) => x.art), ['termin.gestartet']);
        assert.deepStrictEqual(Te.geaendert(te({ status: 2 }), te({ status: 3 })).map((x) => x.art), ['termin.beendet']);
        assert.deepStrictEqual(Te.geaendert(te(), te({ status: 4, name: 'Abgesagt' })).map((x) => x.art), ['termin.abgesagt', 'termin.geaendert']);
        sammle(Te.geaendert(te(), te({ scheduledEndTimestamp: Date.now(), channelId: null, entityMetadata: { location: 'Draußen' }, entityType: 3, privacyLevel: 1 })));
        assert.deepStrictEqual(Te.geaendert(te(), te()), []);
        assert.deepStrictEqual(Te.interesse(te(), { id: B }, true).map((x) => [x.art, x.betroffen, x.zuordnung]), [['termin.interessiert', B, 'sicher']]);
        assert.deepStrictEqual(Te.interesse(te(), { id: B }, false).map((x) => x.art), ['termin.nicht_interessiert']);
        sammle(Te.geloescht(te()));
    });

    await pruefe('Texte: jede Kategorie, Art und jedes geschriebene Feld in beiden Sprachen', () => {
        pruefeTexte(Katalog.KATEGORIEN, de, en, felder);
        rot('fehlender Text', () => pruefeTexte(Katalog.KATEGORIEN, de, en, new Set([...felder, 'gibtsnicht'])));
        rot('Art doppelt', () => pruefeTexte({ ...Katalog.KATEGORIEN, x: { arten: ['mitglied.beigetreten'] } }, de, en, felder));
    });

    await pruefe('Zeile: Kategorie aus der Art, Schlüssel stabil je Sekunde, Zuordnung nur mit Akteur', () => {
        const t = new Date('2026-11-16T10:00:00.400Z');
        const e = { art: 'rolle.rechte', schwere: 'kritisch', objekt: { typ: 'rolle', id: ROLLE, name: 'Mod' }, nachher: { erlaubt: { neu: ['Administrator'], weg: [] } }, zuordnung: 'sicher' };
        const z = Erfasser.zeile(GUILD, e, t);
        assert.deepStrictEqual(z.slice(0, 6), [GUILD, t, 'server', 'rolle.rechte', 'kritisch', 'discord']);
        assert.strictEqual(z[14], 'unbekannt', 'ohne Akteur keine Zuordnung');
        assert.strictEqual(Erfasser.zeile(GUILD, { ...e, akteur: A }, t)[14], 'sicher');
        assert.strictEqual(Erfasser.zeile(GUILD, e, new Date('2026-11-16T10:00:00.900Z'))[15], z[15], 'gleiche Sekunde → gleicher Schlüssel');
        assert.notStrictEqual(Erfasser.zeile(GUILD, e, new Date('2026-11-16T10:00:01.000Z'))[15], z[15]);
        assert.notStrictEqual(Erfasser.zeile(GUILD, { ...e, nachher: {} }, t)[15], z[15]);
        assert.strictEqual(Erfasser.zeile(GUILD, { ...e, schwere: 'egal' }, t)[4], 'info');
        assert.throws(() => Erfasser.zeile(GUILD, { art: 'gibt.es.nicht' }), /keiner Kategorie/);
    });

    await pruefe('Einstellseite: Eingabe gegen den Katalog', () => {
        const { pruefeEinstellungen } = require(L('dashboard/routes/guild.router.js'));
        assert.deepStrictEqual(pruefeEinstellungen({ kategorien: { server: false }, arten: { 'mitglied.avatar': 'true' }, bots: true }),
            { kategorien: [['server', false]], arten: [['mitglied.avatar', true]], bots: true });
        assert.strictEqual(pruefeEinstellungen({}).bots, null, 'fehlt → bleibt');
        assert.throws(() => pruefeEinstellungen({ kategorien: { gibtsnicht: true } }), (e) => e.eingabe);
        assert.throws(() => pruefeEinstellungen({ arten: { 'x.y': false } }), (e) => e.eingabe);
    });

    await pruefe('Anzeige: Felder, Rollen, Rechte; IDs zum Auflösen', () => {
        const z = Anzeige.zeilen({ vorher: JSON.stringify({ name: 'a' }), nachher: JSON.stringify({ name: 'b', dazu: [ROLLE], weg: [],
            rechte: [{ ziel: A, typ: 'mitglied', zustand: 'neu', erlaubt: { neu: ['ViewChannel'], weg: [] }, verboten: { neu: [], weg: [] } }] }) });
        assert.deepStrictEqual(z.map((x) => x.art), ['rollen', 'rechte', 'feld']);
        assert.deepStrictEqual(z[2], { art: 'feld', feld: 'name', vorher: 'a', nachher: 'b' });
        assert.deepStrictEqual(Anzeige.rollenIds([z]), [ROLLE]);
        assert.deepStrictEqual(Anzeige.mitgliedIds([z]), [A]);
        assert.deepStrictEqual(Anzeige.zeilen({ vorher: null, nachher: '{kaputt' }), [], 'kaputtes JSON → nichts, kein Wurf');
    });

    // ── 2c: Zuordnung (LG-1c) ────────────────────────────────────────────────
    const Au = require(L('bot/audit'));
    const { Zuordner } = require(L('bot/zuordner'));
    const { AuditLogEvent: AE, PermissionFlagsBits } = require('discord.js');
    const C = '200000000000000009';
    const eintrag = (aktion, o = {}) => ({ action: AE[aktion], id: o.id || '900000000000000001', executorId: 'von' in o ? o.von : C,
        targetId: o.ziel ?? null, changes: o.changes || [], extra: o.extra ?? null });
    /** Attrappe einer Guild: Recht ja/nein, Mitglieder-Speicher, Abruf zählt mit. */
    function attrappe({ recht = true, abruf = [] } = {}) {
        const g = {
            abrufe: 0,
            members: {
                me: { permissions: { has: (f) => recht && f === PermissionFlagsBits.ViewAuditLog } },
                cache: new Map([[C, { displayName: 'Mod', user: { id: C, username: 'mod', bot: false } }]]),
            },
            fetchAuditLogs: async () => { g.abrufe++; return { entries: new Map(abruf.map((x) => [x.id, x])) }; },
        };
        return g;
    }
    const warte = (ms) => new Promise((r) => setTimeout(r, ms));

    await pruefe('Audit-Tabelle: jede Art im Katalog, jede Aktion in discord.js, Schlüssel unter arten', () => {
        pruefeAuditTabelle(Au.TABELLE, Katalog);
        rot('fremde Art', () => pruefeAuditTabelle({ RoleCreate: { arten: ['rolle.erfunden'] } }, Katalog));
        rot('falsche Aktion', () => pruefeAuditTabelle({ RoleErfunden: { arten: ['rolle.angelegt'] } }, Katalog));
        rot('Schlüssel außerhalb', () => pruefeAuditTabelle({ RoleUpdate: { arten: ['rolle.geaendert'], schluessel: { permissions: ['rolle.rechte'] } } }, Katalog));
        assert.ok(Au.ARTEN_MIT_AUDIT.has('mitglied.verlassen') && !Au.ARTEN_MIT_AUDIT.has('mitglied.avatar') && !Au.ARTEN_MIT_AUDIT.has('sprache.selbst_stumm'));
        assert.ok(Katalog.kategorieVon('mitglied.gekickt') === 'mitglieder' && Katalog.kategorieVon('bot.gekickt') === 'bots');
    });

    await pruefe('Audit-Eintrag → Kandidaten: Felder teilen auf, Ziel und Kanal, Güte, Kick benennt um', () => {
        const k1 = Au.kandidaten(eintrag('RoleUpdate', { ziel: ROLLE, changes: [{ key: 'permissions' }] }))[0];
        assert.deepStrictEqual([...k1.arten], ['rolle.rechte']);
        assert.deepStrictEqual([...Au.kandidaten(eintrag('RoleUpdate', { ziel: ROLLE, changes: [{ key: 'name' }, { key: 'permissions' }] }))[0].arten].sort(), ['rolle.geaendert', 'rolle.rechte']);
        const mu = (key) => [...Au.kandidaten(eintrag('MemberUpdate', { ziel: A, changes: [{ key }] }))[0].arten];
        assert.deepStrictEqual(mu('nick'), ['mitglied.spitzname', 'bot.spitzname']);
        assert.deepStrictEqual(mu('communication_disabled_until'), ['mitglied.timeout', 'mitglied.timeout_ende']);
        assert.deepStrictEqual(mu('avatar_hash'), [], 'unbekanntes Feld ohne * → keine Art');
        assert.deepStrictEqual(Au.kandidaten(eintrag('RoleUpdate', { von: null })), [], 'ohne Täter kein Kandidat');
        assert.deepStrictEqual(Au.kandidaten({ action: 9999, executorId: C }), [], 'unbekannte Aktion');
        const rolleE = S.rolleGeaendert(rolle(), rolle({ permissions: { bitfield: bits('ManageRoles') } }))[0];
        assert.ok(Au.passt(k1, rolleE), 'Rolle mit Rechten passt');
        assert.ok(!Au.passt({ ...k1, ziel: ADMIN }, rolleE), 'andere Rolle passt nicht');
        const md = Au.kandidaten(eintrag('MessageDelete', { ziel: A, extra: { channel: { id: KANAL }, count: 1 } }))[0];
        assert.ok(md.guete === 'wahrscheinlich' && md.buendel && md.kanal === KANAL);
        const geloescht = { art: 'nachricht.geloescht', betroffen: A, kanal: KANAL, objekt: { typ: 'nachricht', id: '1' } };
        assert.ok(Au.passt(md, geloescht));
        assert.ok(!Au.passt(md, { ...geloescht, kanal: '400000000000000099' }), 'anderer Kanal');
        assert.ok(!Au.passt(md, { ...geloescht, betroffen: B }), 'anderer Autor');
        assert.ok(Au.passt(md, { ...geloescht, betroffen: null }), 'ungecacht: Kanal genügt');
        const pin = Au.kandidaten(eintrag('MessagePin', { ziel: A, extra: { channel: { id: KANAL }, messageId: '77' } }))[0];
        assert.ok(Au.passt(pin, { art: 'nachricht.angeheftet', betroffen: A, kanal: KANAL, objekt: { id: '77' } }));
        assert.ok(!Au.passt(pin, { art: 'nachricht.angeheftet', betroffen: A, kanal: KANAL, objekt: { id: '78' } }));
        const inv = Au.kandidaten(eintrag('InviteDelete', { changes: [{ key: 'code', old: 'abc' }] }))[0];
        assert.ok(Au.passt(inv, S.einladungGeloescht({ code: 'abc', channelId: KANAL })[0]));
        const kick = Au.kandidaten(eintrag('MemberKick', { ziel: A }))[0];
        const weg = M.verlassen(mitglied())[0];
        assert.ok(Au.passt(kick, weg));
        const w = Au.wende(weg, kick);
        assert.deepStrictEqual([w.art, w.schwere, w.akteur, w.zuordnung], ['mitglied.gekickt', 'warnung', C, 'sicher']);
        const ban = Au.wende(weg, Au.kandidaten(eintrag('MemberBanAdd', { ziel: A }))[0]);
        assert.deepStrictEqual([ban.art, ban.akteur], ['mitglied.verlassen', C], 'Bann benennt nicht um');
    });

    await pruefe('Zuordner: ohne Recht sofort; Ereignis zuerst; Eintrag zuerst; zwei Täter → wahrscheinlich; Ablauf ohne Eintrag', async () => {
        const rolleE = () => S.rolleGeloescht(rolle())[0];
        const ohne = new Zuordner({ guild: () => attrappe({ recht: false }), fenster: 30 });
        const t0 = Date.now();
        const r0 = await ohne.ordneZu(GUILD, rolleE());
        assert.ok(r0.akteur === null && Date.now() - t0 < 20, 'ohne Recht gewartet');
        assert.strictEqual(ohne.anzahlWartend, 0);

        const z = new Zuordner({ guild: () => attrappe(), fenster: 200 });
        const p = z.ordneZu(GUILD, rolleE());
        assert.strictEqual(z.anzahlWartend, 1);
        assert.strictEqual(z.eintrag(GUILD, eintrag('RoleDelete', { ziel: ROLLE })), 1);
        const r1 = await p;
        assert.deepStrictEqual([r1.e.akteur, r1.e.zuordnung, r1.akteur.name?.name], [C, 'sicher', 'mod']);
        assert.strictEqual(z.anzahlWartend, 0);

        const z2 = new Zuordner({ guild: () => attrappe(), fenster: 200 });
        z2.eintrag(GUILD, eintrag('RoleDelete', { ziel: ROLLE }));
        const t1 = Date.now();
        const r2 = await z2.ordneZu(GUILD, rolleE());
        assert.ok(r2.e.akteur === C && Date.now() - t1 < 20, 'Eintrag zuerst: sofort');
        z2.eintrag(GUILD, eintrag('RoleDelete', { ziel: ROLLE, von: B, id: '900000000000000002' }));
        const r3 = await z2.ordneZu(GUILD, rolleE());
        assert.strictEqual(r3.e.zuordnung, 'wahrscheinlich', 'zwei Täter');

        const z3 = new Zuordner({ guild: () => attrappe(), fenster: 30 });
        const r4 = await z3.ordneZu(GUILD, rolleE());
        assert.ok(r4.akteur === null && r4.e.akteur == null, 'Ablauf ohne Eintrag');
        const r5 = await z3.ordneZu(GUILD, M.geaendert(mitglied(), mitglied({ avatar: 'x' }))[0]);
        assert.strictEqual(r5.akteur, null, 'Avatar hat keinen Audit-Eintrag');
        assert.strictEqual(z3.anzahlWartend, 0);
        const sicher = await z3.ordneZu(GUILD, S.einladungAngelegt({ code: 'z', inviter: { id: B }, channelId: KANAL })[0]);
        assert.strictEqual(sicher.e.akteur, B, 'schon sicher bleibt');

        await warte(40);
        const t2 = Date.now();
        const z4 = new Zuordner({ guild: () => attrappe(), fenster: 30 });
        z4.eintrag(GUILD, eintrag('RoleDelete', { ziel: ROLLE }));
        await warte(45);
        const r6 = await z4.ordneZu(GUILD, rolleE());
        assert.ok(r6.akteur === null && Date.now() - t2 >= 45, 'alter Eintrag gilt nach dem Fenster nicht mehr');
    });

    await pruefe('Zuordner: Bündel nur nachgefragt, wenn eins bekannt ist; Zähler höher → wahrscheinlich, gleich → unbekannt', async () => {
        const geloescht = () => ({ art: 'nachricht.geloescht', schwere: 'info', betroffen: A, kanal: KANAL, objekt: { typ: 'nachricht', id: String(Math.random()).slice(2, 12) } });
        const roh = eintrag('MessageDelete', { ziel: A, extra: { channel: { id: KANAL }, count: 1 } });
        const g = attrappe({ abruf: [{ ...roh, extra: { channel: { id: KANAL }, count: 2 } }] });
        const z = new Zuordner({ guild: () => g, fenster: 25 });
        const ohneBuendel = await z.ordneZu(GUILD, geloescht());
        assert.ok(ohneBuendel.akteur === null && g.abrufe === 0, 'ohne bekanntes Bündel abgefragt');
        const p1 = z.ordneZu(GUILD, geloescht());
        z.eintrag(GUILD, roh);
        assert.strictEqual((await p1).e.zuordnung, 'wahrscheinlich');
        await warte(30);
        const r2 = await z.ordneZu(GUILD, geloescht());
        assert.deepStrictEqual([r2.e.akteur, r2.e.zuordnung, g.abrufe], [C, 'wahrscheinlich', 1], 'zweite Löschung im Bündel');
        await warte(1100);
        const r3 = await z.ordneZu(GUILD, geloescht());
        assert.deepStrictEqual([r3.akteur, g.abrufe], [null, 2], 'Zähler unverändert → eigene Löschung');
        const anders = await z.ordneZu(GUILD, { ...geloescht(), betroffen: B });
        assert.deepStrictEqual([anders.akteur, g.abrufe], [null, 2], 'anderer Autor: kein Bündel, keine Abfrage');
    });

    // ── 3: Läufe an TEMPORARY-Kopien ─────────────────────────────────────────
    const mysql = require('mysql2/promise');
    const c = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
        supportBigNumbers: true, bigNumberStrings: true });
    const schreibt = /^\s*(INSERT|UPDATE|DELETE|REPLACE|TRUNCATE|CREATE|DROP|ALTER)\b/i;
    const abfragen = [];
    let loggingAn = [GUILD];
    async function q(sql, werte) {
        const s = String(sql);
        abfragen.push(s);
        if (schreibt.test(s) && !/^\s*CREATE TEMPORARY TABLE/i.test(s) && !/\blog_\w+/.test(s)) throw new Error(`nur lesend: ${s.slice(0, 60)}`);
        if (/FROM guild_plugins WHERE plugin_name = 'logging'/.test(s)) return loggingAn.map((g) => ({ guild_id: g }));
        return (await c.query(s, werte))[0];
    }
    ServiceManager.register('dbService', { query: q });
    try {
        const ddl = [];
        await require(L('migrations/20261116_090000_baseline.js')).up({ query: async (s) => { ddl.push(String(s)); return []; } });
        for (const s of ddl) {
            const t = s.replace(/CREATE TABLE IF NOT EXISTS/, 'CREATE TEMPORARY TABLE IF NOT EXISTS');
            assert.ok(/CREATE TEMPORARY TABLE/.test(t), `keine Tabelle: ${s.slice(0, 60)}`);
            await q(t);
        }
        const neu = () => { Regeln.vergiss(); Regeln.vergissGlobal(); abfragen.length = 0; };
        const zeilen = async () => q('SELECT * FROM log_ereignisse WHERE guild_id = ? ORDER BY id', [GUILD]);

        await pruefe('Lauf: Ereignis landet mit allen Spalten, dasselbe zweimal ist eine Zeile, Name gemerkt', async () => {
            neu();
            const alt = mitglied();
            const n = mitglied({ nickname: 'An', roles: { cache: rollenCache([GUILD, ADMIN]) } });
            await M.melde(GUILD, M.geaendert(alt, n), n);
            await M.melde(GUILD, M.geaendert(alt, n), n);
            const z = await zeilen();
            assert.deepStrictEqual(z.map((x) => [x.kategorie, x.art, x.schwere, x.betroffen_id, x.objekt_typ, x.zuordnung]), [
                ['mitglieder', 'mitglied.spitzname', 'info', A, 'mitglied', 'unbekannt'],
                ['mitglieder', 'mitglied.rollen', 'kritisch', A, 'mitglied', 'unbekannt'],
            ]);
            assert.deepStrictEqual(JSON.parse(z[1].nachher), { dazu: [ADMIN], weg: [] });
            const namen = await q('SELECT name, anzeigename FROM log_namen WHERE guild_id = ? AND mitglied_id = ?', [GUILD, A]);
            assert.deepStrictEqual(namen.map((x) => [x.name, x.anzeigename]), [['anna', 'Anna']]);
            await M.melde(GUILD, M.beigetreten(mitglied({ displayName: 'Anni' })), mitglied({ displayName: 'Anni' }));
            assert.strictEqual((await q('SELECT COUNT(*) AS n FROM log_namen WHERE mitglied_id = ?', [A]))[0].n, '2', 'neuer Anzeigename → zweite Zeile');
            assert.deepStrictEqual(gesehen, [], 'keine Fehler im Log');
        });

        await pruefe('Lauf: Kategorie aus → nichts; nirgends an → keine Abfrage der Regeln', async () => {
            await q('DELETE FROM log_ereignisse');
            await q("INSERT INTO log_regeln (guild_id, regel, ziel, aktiv) VALUES (?, 'kategorie', 'server', 0)", [GUILD]);
            neu();
            const r = await S.melde(GUILD, S.rolleGeloescht(rolle()));
            assert.strictEqual(r, undefined);
            assert.strictEqual((await zeilen()).length, 0, 'abgeschaltete Kategorie gespeichert');
            assert.ok(!abfragen.some((s) => /FROM log_regeln WHERE guild_id/.test(s)), 'nirgends an, trotzdem Regeln gefragt');
            loggingAn = [];
            neu();
            const x = await Erfasser.erfasse(GUILD, M.gebannt({ user: { id: A } })[0]);
            assert.deepStrictEqual(x, { gespeichert: false, grund: 'nirgends_an' }, 'Logging in keiner Guild');
            loggingAn = [GUILD];
        });

        await pruefe('Lauf: Ausschluss Mitglied → nichts, kritisch trotzdem; Bots erst mit Akteur', async () => {
            await q("INSERT INTO log_regeln (guild_id, regel, ziel, aktiv) VALUES (?, 'mitglied', ?, 1), (?, 'bots', '', 1)", [GUILD, A, GUILD]);
            neu();
            const n = mitglied({ nickname: 'Weg' });
            assert.strictEqual((await Erfasser.erfasse(GUILD, M.geaendert(mitglied(), n)[0], { rollen: [] })).grund, 'mitglied');
            const krit = M.geaendert(mitglied(), mitglied({ roles: { cache: rollenCache([GUILD, ADMIN]) } }))[0];
            assert.deepStrictEqual(await Erfasser.erfasse(GUILD, krit, { rollen: [ADMIN] }), { gespeichert: true, grund: null });
            const inv = S.einladungAngelegt({ code: 'z', inviter: { id: B }, channelId: KANAL })[0];
            assert.strictEqual((await Erfasser.erfasse(GUILD, inv, { akteurIstBot: true })).grund, 'bots');
            assert.strictEqual((await Erfasser.erfasse(GUILD, inv, { akteurIstBot: false })).gespeichert, true);
            const z = await zeilen();
            assert.deepStrictEqual(z.map((x) => [x.art, x.akteur_id, x.zuordnung]), [['mitglied.rollen', null, 'unbekannt'], ['einladung.angelegt', B, 'sicher']]);
            assert.deepStrictEqual(gesehen, [], 'keine Fehler im Log');
        });

        await pruefe('Lauf: Art mit Vorgabe „aus“ erst nach Zeile aktiv=1; neue Nachricht ohne @everyone fragt nichts', async () => {
            await q('DELETE FROM log_ereignisse');
            await q('DELETE FROM log_regeln');
            neu();
            const vs = (o) => ({ id: B, channelId: KANAL, selfMute: false, ...o });
            await Sp.melde(GUILD, Sp.aenderungen(vs(), vs({ selfMute: true })), vs(), vs({ selfMute: true }));
            assert.strictEqual((await zeilen()).length, 0, 'selbst stumm ohne Zeile gespeichert');
            await q("INSERT INTO log_regeln (guild_id, regel, ziel, aktiv) VALUES (?, 'art', 'sprache.selbst_stumm', 1)", [GUILD]);
            neu();
            await Sp.melde(GUILD, Sp.aenderungen(vs(), vs({ selfMute: true })), vs(), vs({ selfMute: true }));
            assert.deepStrictEqual((await zeilen()).map((x) => [x.kategorie, x.art, x.akteur_id, x.zuordnung]), [['sprache', 'sprache.selbst_stumm', B, 'sicher']]);
            neu();
            const r = await require(L('bot/events/messageCreate.js'))(nachricht());
            assert.strictEqual(r, undefined);
            assert.deepStrictEqual(abfragen, [], 'neue Nachricht ohne @everyone hat abgefragt');
            await require(L('bot/events/messageCreate.js'))(nachricht({ mentions: { users: sammlung([]), roles: sammlung([]), everyone: true } }));
            assert.ok((await zeilen()).some((x) => x.art === 'nachricht.everyone'), '@everyone nicht gespeichert');
            assert.deepStrictEqual(gesehen, [], 'keine Fehler im Log');
        });

        await pruefe('Lauf: Kick mit Täter → „gekickt“ mit Ankunftszeit und Namen; ausgeschlossener Täter → nichts', async () => {
            await q('DELETE FROM log_ereignisse');
            await q('DELETE FROM log_regeln');
            neu();
            const g = attrappe();
            const z = new Zuordner({ guild: () => g, fenster: 2000 });
            const vorher = Date.now();
            const lauf = Erfasser.erfasse(GUILD, M.verlassen(mitglied())[0], { rollen: [] }, { zuordnen: z });
            await warte(1100);
            z.eintrag(GUILD, eintrag('MemberKick', { ziel: A }));
            assert.deepStrictEqual(await lauf, { gespeichert: true, grund: null });
            const [x] = await zeilen();
            assert.deepStrictEqual([x.kategorie, x.art, x.schwere, x.akteur_id, x.zuordnung], ['mitglieder', 'mitglied.gekickt', 'warnung', C, 'sicher']);
            assert.ok(new Date(x.zeit).getTime() - vorher < 1000, `Zeit ist das Ende des Wartens, nicht die Ankunft (${x.zeit})`);
            const n = await q('SELECT name FROM log_namen WHERE guild_id = ? AND mitglied_id = ?', [GUILD, C]);
            assert.deepStrictEqual(n.map((y) => y.name), ['mod'], 'Täter nicht in log_namen');
            await q("INSERT INTO log_regeln (guild_id, regel, ziel, aktiv) VALUES (?, 'mitglied', ?, 1)", [GUILD, C]);
            neu();
            z.eintrag(GUILD, eintrag('RoleDelete', { ziel: ROLLE }));
            const r = await Erfasser.erfasse(GUILD, S.rolleGeloescht(rolle())[0], {}, { zuordnen: z });
            assert.deepStrictEqual(r, { gespeichert: false, grund: 'mitglied' }, 'Täter aus dem Audit-Log ausgeschlossen, trotzdem gespeichert');
            await q('DELETE FROM log_regeln');
            assert.deepStrictEqual(gesehen, [], 'keine Fehler im Log');
        });

        await pruefe('Lauf: Fehler beim Speichern landet im Log, nicht beim Aufrufer', async () => {
            neu();
            ServiceManager.register('dbService', { query: async (s, w) => { if (/INSERT INTO log_ereignisse/.test(s)) throw new Error('Probe'); return q(s, w); } });
            const r = await Erfasser.erfasse(GUILD, M.entbannt({ user: { id: B } })[0]);
            ServiceManager.register('dbService', { query: q });
            assert.deepStrictEqual(r, { gespeichert: false, grund: 'fehler' });
            assert.ok(gesehen.some((g) => /mitglied\.entbannt .* nicht erfasst/.test(g) && /Probe/.test(g)), 'nicht im Log');
            gesehen.length = 0;
        });
    } finally {
        await c.end();
    }

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✓ alles grün');
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
