#!/usr/bin/env node
/**
 * Logging Stufe 1 (LG-1a, LG-1b Teil 1, K382, 2026-11-16).
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
 *                   Eingaben der Einstellseite; Anzeige
 *   3  Läufe        an TEMPORARY-Kopien aller `log_*`-Tabellen mit echtem
 *                   SQL: Ereignis landet mit allen Spalten, dasselbe zweimal
 *                   ergibt eine Zeile, Kategorie aus → nichts, Kategorie
 *                   nirgends an → keine Abfrage der Regeln, Ausschluss
 *                   Mitglied → nichts, kritisch trotzdem, neuer Name → neue
 *                   Zeile in `log_namen`
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
    const ohneWeg = dateien.filter((d) => !/require\('\.\.\/(mitglieder|struktur)'\)/.test(d.quelle) || !/\.melde\(/.test(d.quelle));
    assert.deepStrictEqual(ohneWeg.map((d) => d.name), [], 'geht nicht über mitglieder.js/struktur.js zum Erfasser');
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
