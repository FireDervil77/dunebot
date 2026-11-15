#!/usr/bin/env node
/**
 * Leveling Stufe 1 (LV-1a bis LV-1h, K382, K394, 2026-11-15).
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
 *                   fragt das Recht LEVELING.REWARDS.MANAGE im Dashboard;
 *                   nach jedem Aufstieg die Level-up-Nachricht mit dem Kanal
 *                   der XP (LV-1f), `/xp` mit Recht LEVELING.XP.MANAGE,
 *                   Akteur, Pflichtgrund, Ereignis und Bestätigung beim
 *                   Zurücksetzen (LV-1h), `/rank` und `/leaderboard` über
 *                   Bildkarte und Fortschritt (LV-1g), Speichern der
 *                   Nachrichten mit CSRF und Recht, Hinweis „kein Level-Kanal“
 *   2  Regeln       Ausschluss, „nur diese“, Faktoren (Kanal genauester,
 *                   Rolle höchster), Kette Thread → Kanal → Kategorie,
 *                   Menge, Taktung und gleicher Text; Sprache (AFK, allein,
 *                   taub, stumm); Soll-Rollen je Stufe (geben, nehmen,
 *                   vorherige entfernen); Level-up: Meilensteine, wann,
 *                   wohin, Platzhalter, Vorgabe in beiden Sprachen;
 *                   Rangkarte: Werte passen zur Schablone
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
 *                   ehrlichem Ergebnis; Level-up-Nachricht (Kanal, gesperrt,
 *                   Vorlage, Meilenstein, Direktnachricht, aus), `/xp` mit
 *                   Recht/Akteur/Grund/Ereignis/Kürzen/Bestätigung,
 *                   `/leaderboard` mit Seiten, `/rank` mit Karte
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
    recht: 'plugins/leveling/bot/recht.js',
    nachbuchung: 'plugins/leveling/bot/nachbuchung.js',
    xp: 'plugins/leveling/bot/commands/xp.js',
    rank: 'plugins/leveling/bot/commands/rank.js',
    leaderboard: 'plugins/leveling/bot/commands/leaderboard.js',
    router: 'plugins/leveling/dashboard/routes/guild.router.js',
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
    if (!/sendToDashboard\('core:RECHT_PRUEFEN', \{ guild_id: guild\.id, actor_user_id: user\.id, recht \}/.test(t.recht)) aus.push('bot/recht.js fragt nicht core:RECHT_PRUEFEN mit dem verlangten Recht');
    if (!/const RECHT = 'LEVELING\.REWARDS\.MANAGE'/.test(t.levels) || !/await darf\(guild, user, RECHT\)/.test(t.levels) || !/if \(!recht\.darf\) return/.test(t.levels)) aus.push('/levels sync fragt das Recht nicht im Dashboard');
    // LV-1f: nach jedem Aufstieg im Bot die Level-up-Nachricht, mit dem Kanal der XP
    if (!/if \(ergebnis\.aufstieg && ergebnis\.buchung_id\) \{[^}]*if \(guild\) await Ausgabe\.beiAufstieg\(\{ guild, mitglied, ergebnis, kanal \}\)/.test(t.nachbuchung)) aus.push('nachBuchung sendet nach dem Aufstieg keine Level-up-Nachricht');
    if (!/nachBuchung\(\{[^}]*kanal: String\(message\.channelId\)/.test(t.chatxp)) aus.push('Chat-XP nennen den Kanal der Nachricht nicht');
    if (!/nachBuchung\(\{[^}]*kanal: k\.kanal/.test(t.sprachxp)) aus.push('Sprach-XP nennen den Sprachkanal nicht');
    // LV-1h: /xp nur mit Recht, Buchung mit Akteur und Grund, Zurücksetzen erst nach Bestätigung
    if (!/const RECHT = 'LEVELING\.XP\.MANAGE'/.test(t.xp) || !/await darf\(guild, user, RECHT\)/.test(t.xp) || !/if \(!recht\.darf\) return/.test(t.xp)) aus.push('/xp fragt das Recht LEVELING.XP.MANAGE nicht');
    const buchung = /Fortschritt\.buche\(\{([\s\S]*?)\}\)/.exec(t.xp);
    if (!buchung || !/quelle: 'hand'/.test(buchung[1]) || !/akteur: user\.id/.test(buchung[1]) || !/grund: `\$\{art\}: \$\{grund\}`/.test(buchung[1])) aus.push('/xp bucht ohne Quelle hand, Akteur oder Grund');
    if (!/required: true, maxLength: 255/.test(t.xp)) aus.push('/xp ohne Pflichtgrund');
    if (!/if \(art === 'reset'\) \{\s*const ok = await bestaetige\([^)]*\);\s*if \(!ok\) return null;/.test(t.xp) || !/if \(!nameStimmt\(fenster\.fields\.getTextInputValue\('name'\), ziel\.username\)\)/.test(t.xp)) aus.push('/xp reset ohne Bestätigung mit eingetipptem Namen');
    if (!/Ereignisse\.melde\('leveling\.xp\.korrigiert'/.test(t.xp) || !/await nachBuchung\(\{ guildId: guild\.id, mitglied: ziel\.id, ergebnis: e, guild/.test(t.xp)) aus.push('/xp meldet nichts oder lässt den Stufenwechsel liegen');
    // LV-1g: Rangkarte nur über den Kern, Rangliste aus dem Kern
    if (!/Karte\.zeichne\(member, s\)/.test(t.rank) || !/Fortschritt\.rangliste\(/.test(t.leaderboard) || !/Fortschritt\.position\(/.test(t.leaderboard)) aus.push('/rank oder /leaderboard rechnen nicht über Kern und Bildkarte');
    // LV-1f: Speichern der Nachrichten mit CSRF und Recht, Vorlage über den Kern
    if (!/router\.put\('\/nachrichten', csrfProtection, requirePermission\('LEVELING\.CONFIGURE'\)/.test(t.router) || !/Vorlage\.speichere\(guildId, Ausgabe\.ANLASS, vorlage\)/.test(t.router)) aus.push('Nachrichten speichern ohne CSRF, Recht oder Vorlage.speichere');
    const meldung = /addFilter\('guild_notices'([\s\S]*?)return meldungen;\s*\}\);/.exec(t.dashboard);
    if (!meldung || !/Ausgabe\.kanalFehlt\(e\)/.test(meldung[1]) || !/hasPermission\(user\.id, guildId, 'LEVELING\.CONFIGURE'\)/.test(meldung[1])) aus.push('Hinweis „kein Level-Kanal“ fehlt oder fragt das Recht nicht');
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
        // LV-1f/LV-1g/LV-1h
        assert.deepStrictEqual(Object.keys(p.vorlagen?.anlaesse || {}), ['aufstieg'], 'Vorlage leveling:aufstieg nicht erklärt');
        assert.strictEqual(p.vorlagen.recht, 'LEVELING.CONFIGURE');
        const ph = p.vorlagen.anlaesse.aufstieg.platzhalter;
        assert.deepStrictEqual([...ph].sort(), Object.keys(require(L('shared/ausgabe')).platzhalter({})).sort(), 'erklärte Platzhalter ≠ gefüllte');
        assert.ok(p.bildkarten?.['kern:rangkarte']?.stand === 'shared/rangkarte.js', 'Rangkarte nicht unter bildkarten erklärt');
        assert.ok(p.ereignisse.sendet.includes('leveling.xp.korrigiert'));
        const liste = JSON.parse(fs.readFileSync(path.join(WURZEL, 'packages/dunebot-sdk/ereignisse/liste.json'), 'utf8'));
        const ev = (liste.ereignisse || liste).find?.((x) => x.name === 'leveling.xp.korrigiert');
        assert.ok(ev?.stand === 'aktiv' && ev.felder.art && ev.felder.xp && ev.felder.grund, 'leveling.xp.korrigiert nicht aktiv oder ohne Felder');
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

    const Ausgabe = require(L('shared/ausgabe'));
    const Rangkarte = require(L('shared/rangkarte'));
    await pruefe('2e. Level-up: Meilensteine, wann, wohin, Hinweis, Platzhalter', () => {
        assert.deepStrictEqual(Ausgabe.meilensteine('25, 5;10 5 x 0 1001'), [5, 10, 25]);
        assert.deepStrictEqual(Ausgabe.meilensteine('[10, 5]'), [5, 10]);
        assert.deepStrictEqual([Ausgabe.meilensteine(null), Ausgabe.meilensteine(''), Ausgabe.meilensteine([3])], [[], [], [3]]);
        const e = (x = {}) => ({ ausgabe_modus: 'level_kanal', ausgabe_kanal: '500', nur_meilensteine: 0, meilensteine: null, ...x });
        const v = (level, prestige = 0) => ({ level, prestige });
        assert.ok(Ausgabe.sollMelden(e(), v(0), v(1)).ja);
        assert.strictEqual(Ausgabe.sollMelden(e(), v(2), v(1)).grund, 'kein_aufstieg', 'Abstieg meldet nichts');
        assert.strictEqual(Ausgabe.sollMelden(e({ ausgabe_modus: 'aus' }), v(0), v(1)).grund, 'aus');
        const m = e({ nur_meilensteine: 1, meilensteine: '[5, 10]' });
        assert.strictEqual(Ausgabe.sollMelden(m, v(0), v(4)).grund, 'kein_meilenstein');
        assert.ok(Ausgabe.sollMelden(m, v(4), v(5)).ja, 'genau auf dem Meilenstein');
        assert.ok(Ausgabe.sollMelden(m, v(3), v(7)).ja, 'über den Meilenstein gesprungen');
        assert.strictEqual(Ausgabe.sollMelden(m, v(5), v(9)).grund, 'kein_meilenstein', 'Meilenstein schon vorher erreicht');
        assert.ok(Ausgabe.sollMelden(m, v(12), v(6, 1)).ja, 'Prestige zählt ab Stufe 0');
        assert.strictEqual(Ausgabe.sollMelden(e({ nur_meilensteine: 1 }), v(0), v(5)).grund, 'kein_meilenstein', 'ohne Liste nie');
        assert.deepStrictEqual(Ausgabe.ziel(e(), { kanal: '200' }), { art: 'kanal', kanal: '500', grund: null }, 'Level-Kanal schlägt den Kanal der XP');
        assert.strictEqual(Ausgabe.ziel(e({ ausgabe_kanal: null }), { kanal: '200' }).grund, 'kein_level_kanal', 'ohne Level-Kanal keine Nachricht (F-LV1)');
        assert.deepStrictEqual(Ausgabe.ziel(e({ ausgabe_modus: 'kanal_der_nachricht' }), { kanal: '200' }).kanal, '200');
        assert.deepStrictEqual(Ausgabe.ziel(e({ ausgabe_modus: 'kanal_der_nachricht' }), {}).kanal, '500', 'ohne Kanal der XP der Level-Kanal');
        assert.strictEqual(Ausgabe.ziel(e({ ausgabe_modus: 'kanal_der_nachricht', ausgabe_kanal: null }), {}).grund, 'kein_kanal');
        assert.strictEqual(Ausgabe.ziel(e({ ausgabe_modus: 'direktnachricht' }), {}).art, 'direkt');
        assert.deepStrictEqual([Ausgabe.kanalFehlt(e({ ausgabe_kanal: null })), Ausgabe.kanalFehlt(e()), Ausgabe.kanalFehlt(e({ ausgabe_modus: 'aus', ausgabe_kanal: null })), Ausgabe.kanalFehlt(null)], [true, false, false, false]);
        assert.deepStrictEqual(Ausgabe.platzhalter({ level: 3, xp: 400, vorher: { level: 2 }, stufe: { name: 'Bronze' }, naechste: { fehlt: 85 } }, { rang: 7 }),
            { level: '3', 'level:vorher': '2', 'level:name': 'Bronze', xp: '400', 'xp:fehlt': '85', rang: '7' });
        const de = Ausgabe.vorgabe(Ausgabe.texteAus('de-DE'));
        const en = Ausgabe.vorgabe(Ausgabe.texteAus('en-GB'));
        assert.ok(de.text.includes('{member:mention}') && de.text.includes('{level}') && en.text !== de.text, 'Vorgabe fehlt in einer Sprache');
        assert.strictEqual(Ausgabe.vorgabe(Ausgabe.texteAus('xx-YY')).text, de.text, 'unbekannte Sprache: Deutsch');
    });
    await pruefe('2f. Rangkarte: Balken im Level, höchste Stufe voll, ohne Platz ein Strich', () => {
        const w = Rangkarte.werte({ xp: 400, level: 3, stufe: { schwelle: 355 }, naechste: { schwelle: 520 } }, { platz: 2, system: 'Community' });
        assert.deepStrictEqual([w.level, w.position, w.xp_level, w.xp_level_max, w.xp_gesamt], ['3', '2', '45', '165', '400']);
        const oben = Rangkarte.werte({ xp: 9000, level: 100, stufe: { schwelle: 8000 }, naechste: null }, { platz: null, system: 'x' });
        assert.deepStrictEqual([oben.position, oben.xp_level, oben.xp_level_max], ['–', '1000', '1000']);
        const null0 = Rangkarte.werte({ xp: 0, level: 0, stufe: null, naechste: { schwelle: 100 } }, { system: 'x' });
        assert.deepStrictEqual([null0.xp_level, null0.xp_level_max], ['0', '100']);
        const karte = JSON.parse(fs.readFileSync(path.join(WURZEL, 'packages/dunebot-sdk/bildkarten/rangkarte.json'), 'utf8'));
        assert.deepStrictEqual(Object.keys(w).sort(), karte.werte.filter((x) => !x.einstellbar).map((x) => x.name).sort(), 'Laufzeitwerte ≠ Schablone');
    });

    // ── 3: Läufe an TEMPORARY-Kopien ─────────────────────────────────────────
    const mysql = require('mysql2/promise');
    const c = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
        supportBigNumbers: true, bigNumberStrings: true });
    const schreibt = /^\s*(INSERT|UPDATE|DELETE|REPLACE|TRUNCATE|CREATE|DROP|ALTER)\b/i;
    const KOPIEN = /\b(fortschritt_|level_|ereignisbuch\b|rollen_vergaben\b|guild_vorlagen\b)/;
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
    // Vorlagen (LV-1f): Schema wie in der Datenbank, als leere TEMPORARY-Kopie.
    const [[vorlagenDdl]] = await c.query('SHOW CREATE TABLE guild_vorlagen');
    await c.query(vorlagenDdl['Create Table'].replace(/^CREATE TABLE/, 'CREATE TEMPORARY TABLE').replace(/,\s*CONSTRAINT[^\n]*/g, ''));

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

    // ── LV-1f, LV-1g, LV-1h: Discord als Attrappe ────────────────────────────
    const deTexte = Ausgabe.texteAus('de-DE');
    const getT = (k, w = {}) => deTexte(k).replace(/\{\{(\w+)\}\}/g, (x, n) => (w[n] !== undefined ? String(w[n]) : x));
    const gesendet = [];
    function attrappe(gid, { kanaele = {}, leute = {} } = {}) {
        const guild = { id: gid, name: 'Probe', memberCount: 3, locale: 'de-DE', premiumSubscriptionCount: 0, premiumTier: 0, iconURL: () => null, getT,
            members: { me: { id: '999' }, cache: new Map() }, channels: { cache: new Map() } };
        for (const [kid, darf] of Object.entries(kanaele)) {
            guild.channels.cache.set(kid, { id: kid, name: `k${kid}`, isTextBased: () => true,
                permissionsFor: () => ({ has: (p) => (Array.isArray(p) ? darf.senden : darf.bilder) }),
                send: async (n) => { gesendet.push({ wo: kid, n }); return {}; } });
        }
        for (const [mid, name] of Object.entries(leute)) {
            guild.members.cache.set(mid, { id: mid, displayName: name, guild, joinedAt: new Date(), toString: () => `<@${mid}>`, displayAvatarURL: () => '',
                user: { id: mid, username: name.toLowerCase(), tag: name.toLowerCase(), discriminator: '0', bot: false, createdAt: new Date() },
                send: async (n) => { gesendet.push({ wo: 'dm', n }); return {}; } });
        }
        guild.members.fetch = async (x) => { const m = guild.members.cache.get(String(x?.user ?? x)); if (!m) throw new Error('Unknown Member'); return m; };
        return guild;
    }
    const G4 = '100000000000000004';
    const [M1, M2, ADMIN] = ['300000000000000041', '300000000000000042', '300000000000000049'];
    const g4 = attrappe(G4, { kanaele: { 200: { senden: true, bilder: true }, 500: { senden: true, bilder: true }, 501: { senden: false, bilder: false } }, leute: { [M1]: 'Anna', [M2]: 'Bert', [ADMIN]: 'Chef' } });
    const { nachBuchung } = require(L('bot/nachbuchung'));
    const Vorlage = require(path.join(WURZEL, 'packages/dunebot-sdk/lib/Vorlage.js'));
    const setze = async (spalten) => { await q(`UPDATE level_einstellungen SET ${Object.keys(spalten).map((k) => `${k} = ?`).join(', ')} WHERE guild_id = ?`, [...Object.values(spalten), G4]); Regeln.vergiss(); };
    let schl = 0;
    const steige = async (m, menge) => nachBuchung({ guildId: G4, mitglied: m, guild: g4, kanal: '200',
        ergebnis: await Fortschritt.buche({ guildId: G4, kennung: K, mitglied: m, menge, quelle: 'nachricht', schluessel: `probe:${++schl}` }) });

    await spieleStartwerteEin({ query: q }, G4);
    Regeln.vergiss();
    await pruefe('3o. Level-up: ohne Level-Kanal nichts, Level-Kanal, gesperrt, Kanal der XP, Vorlage, Meilenstein, Direktnachricht', async () => {
        // Stufen nach „ansteigend“: 1 ab 100, 2 ab 255, 3 ab 475, 4 ab 770, 5 ab 1.150, 6 ab 1.625 XP.
        await steige(M1, 120);
        assert.strictEqual(gesendet.length, 0, 'Vorgabe ohne Level-Kanal sendet nichts (F-LV1)');
        await setze({ ausgabe_kanal: '500' });
        await steige(M1, 200);
        assert.strictEqual(gesendet.length, 1, 'Aufstieg auf Stufe 2 nicht gemeldet');
        assert.strictEqual(gesendet[0].wo, '500');
        assert.strictEqual(gesendet[0].n.content, `🎉 <@${M1}> hat Level 2 erreicht!`);
        assert.deepStrictEqual(gesendet[0].n.allowedMentions, { parse: [], users: [M1], repliedUser: false }, 'pingt mehr als das Mitglied');
        await steige(M1, 1);
        assert.strictEqual(gesendet.length, 1, 'ohne Aufstieg eine Nachricht');
        await setze({ ausgabe_kanal: '501' });
        await steige(M2, 120);
        await setze({ ausgabe_kanal: '502' });
        await steige(M2, 200);
        assert.strictEqual(gesendet.length, 1, 'gesperrter oder fehlender Kanal sendete');
        await setze({ ausgabe_modus: 'kanal_der_nachricht' });
        await Vorlage.speichere(G4, 'leveling:aufstieg', { form: 'text', text: '{member:nick}: {level:vorher} → {level}, Platz {rang}, noch {xp:fehlt} XP, gesamt {xp}' });
        await steige(M2, 200);
        assert.strictEqual(gesendet[1]?.wo, '200', 'Kanal der XP');
        const st = await Fortschritt.stand({ guildId: G4, kennung: K, mitglied: M2 });
        assert.strictEqual(gesendet[1].n.content, `Bert: 2 → 3, Platz 1, noch ${st.naechste.fehlt} XP, gesamt 520`);
        await setze({ nur_meilensteine: 1, meilensteine: '[5]' });
        await steige(M2, 300);
        assert.strictEqual(gesendet.length, 2, 'Stufe 4 ist kein Meilenstein');
        await steige(M2, 900);
        assert.strictEqual(gesendet.length, 3, 'von 4 auf 6 über Meilenstein 5 gesprungen');
        await setze({ nur_meilensteine: 0, ausgabe_modus: 'direktnachricht' });
        await Vorlage.loesche(G4, 'leveling:aufstieg');
        await steige(M1, 200);
        assert.strictEqual(gesendet[3]?.wo, 'dm', 'Direktnachricht');
        await setze({ ausgabe_modus: 'aus' });
        await steige(M1, 300);
        assert.strictEqual(gesendet.length, 4, 'Modus aus sendete');
    });

    const xpBefehl = require(L('bot/commands/xp'));
    let erlaubt = false;
    const gefragt = [];
    ServiceManager.register('ipcClient', { sendToDashboard: async (aktion, daten) => { gefragt.push([aktion, daten.recht, daten.actor_user_id]); return { success: true, data: { darf: erlaubt } }; } });
    const antworten = [];
    const befehl = (unter, { ziel = M2, amount = null, reason = 'Probe', name = null } = {}) => {
        const zielUser = ziel === 'bot' ? { id: '300000000000000048', username: 'robo', bot: true } : g4.members.cache.get(ziel).user;
        const fenster = { fields: { getTextInputValue: () => name }, update: async (n) => { antworten.push(n); } };
        const klick = { id: id(), user: { id: ADMIN }, customId: null, showModal: async () => {}, awaitModalSubmit: async () => (name == null ? Promise.reject(new Error('Zeit')) : fenster) };
        const antwort = { awaitMessageComponent: async ({ filter }) => { klick.customId = `leveling-xp-reset-${ia.id}`; return filter(klick) ? klick : null; } };
        const ia = { id: id(), guild: g4, user: { id: ADMIN }, channelId: '200',
            options: { getSubcommand: () => unter, getUser: () => zielUser, getString: () => reason, getInteger: () => amount },
            editReply: async (n) => { antworten.push(n); return antwort; } };
        return xpBefehl.interactionRun({ interaction: ia }).then(() => ia);
    };
    const stand = async (m) => (await Fortschritt.stand({ guildId: G4, kennung: K, mitglied: m })).xp;
    const text = (n) => n?.content || n?.embeds?.[0]?.data?.description || '';
    await pruefe('3p. /xp: Recht, add/remove/set mit Akteur und Grund, Ereignis, Kürzen, reset nur mit Namen, Bot nicht', async () => {
        const vorher = await stand(M2);
        await befehl('add', { amount: 50 });
        assert.deepStrictEqual(gefragt.at(-1), ['core:RECHT_PRUEFEN', 'LEVELING.XP.MANAGE', ADMIN]);
        assert.ok(text(antworten.at(-1)).includes('LEVELING.XP.MANAGE') && await stand(M2) === vorher, 'ohne Recht gebucht');
        erlaubt = true;
        const ia = await befehl('add', { amount: 50, reason: 'Turnier gewonnen' });
        const [b] = await q('SELECT menge, quelle, akteur, grund, schluessel FROM fortschritt_buchungen WHERE guild_id = ? AND schluessel = ?', [G4, `hand:${ia.id}`]);
        assert.deepStrictEqual([Number(b?.menge), b?.quelle, b?.akteur, b?.grund], [50, 'hand', ADMIN, 'add: Turnier gewonnen'], JSON.stringify(b));
        const [ev] = await q("SELECT akteur, betroffen, daten FROM ereignisbuch WHERE guild_id = ? AND name = 'leveling.xp.korrigiert' ORDER BY id DESC LIMIT 1", [G4]);
        const d = typeof ev?.daten === 'string' ? JSON.parse(ev.daten) : ev?.daten;
        assert.ok(ev?.akteur === ADMIN && ev.betroffen === M2 && d?.art === 'add' && d.xp === 50 && d.grund === 'Turnier gewonnen' && d.fortschritt === K, JSON.stringify(ev));
        await befehl('set', { amount: 1000 });
        assert.strictEqual(await stand(M2), 1000);
        await befehl('remove', { amount: 5000 });
        assert.strictEqual(await stand(M2), 0, 'Abzug nicht auf den Stand gekürzt');
        assert.ok(text(antworten.at(-1)).includes('bis 0'), 'Kürzen nicht gemeldet');
        await befehl('set', { amount: 400 });
        await befehl('reset', { name: 'falsch' });
        assert.strictEqual(await stand(M2), 400, 'falscher Name setzte zurück');
        await befehl('reset');
        assert.strictEqual(await stand(M2), 400, 'ohne Fenster setzte zurück');
        await befehl('reset', { name: ' BERT ' });
        assert.strictEqual(await stand(M2), 0, 'richtiger Name setzte nicht zurück');
        await befehl('add', { ziel: 'bot', amount: 5 });
        assert.ok(text(antworten.at(-1)).includes('Bots'), 'Bot bekam XP');
        const rechte = gefragt.filter((f) => f[0] === 'core:RECHT_PRUEFEN');
        assert.ok(rechte.length === 8 && rechte.every((f) => f[1] === 'LEVELING.XP.MANAGE'), `anderes Recht gefragt: ${JSON.stringify(rechte)}`);
    });
    await pruefe('3q. /xp gibt einen Aufstieg weiter: Nachricht im Kanal des Befehls', async () => {
        await setze({ ausgabe_modus: 'kanal_der_nachricht' });
        const n = gesendet.length;
        await befehl('add', { amount: 300 });
        assert.strictEqual(gesendet.length, n + 1, 'kein Level-up nach /xp');
        assert.strictEqual(gesendet.at(-1).wo, '200');
        await setze({ ausgabe_modus: 'aus' });
    });

    const lb = require(L('bot/commands/leaderboard'));
    await pruefe('3r. /leaderboard: zehn je Seite, Knöpfe, eigener Platz, Woche ohne Buchungen leer', async () => {
        const G5 = '100000000000000005';
        const leute = {};
        const zeilen = [];
        for (let i = 1; i <= 12; i++) {
            const mid = `3000000000000005${String(i).padStart(2, '0')}`;
            leute[mid] = `Leute${i}`;
            zeilen.push(G5, K, mid, 1300 - i * 100, 1, 0);
        }
        await q(`INSERT INTO fortschritt_stand (guild_id, kennung, mitglied_id, xp, level, prestige) VALUES ${Array(12).fill('(?, ?, ?, ?, ?, ?)').join(', ')}`, zeilen);
        const g5 = attrappe(G5, { leute });
        const ich = Object.keys(leute)[11];
        const fertig = [];
        const lauf = (zeitraum) => lb.interactionRun({ interaction: { guild: g5, user: { id: ich }, options: { getString: () => zeitraum }, editReply: async (n) => { fertig.push(n); return {}; } } });
        await lauf(null);
        const e = fertig[0].embeds[0].data;
        const z = e.description.split('\n');
        assert.ok(z[0].includes('1.') && z[0].includes('Leute1') && z[0].includes('1.200 XP'), z[0]);
        assert.strictEqual(z.filter((x) => /^`\s*\d+\.`/.test(x)).length, 10);
        assert.ok(e.description.includes('Dein Platz: **12** von 12'), e.description);
        assert.strictEqual(e.footer.text, 'Seite 1 von 2 · 12 Mitglieder');
        const knoepfe = fertig[0].components[0].components.map((k) => k.data.disabled);
        assert.deepStrictEqual(knoepfe, [true, false], 'Zurück auf Seite 1 nicht gesperrt');
        assert.deepStrictEqual(fertig[0].allowedMentions, { parse: [] });
        await lauf('woche');
        assert.ok(fertig[1].embeds[0].data.description.startsWith('In diesem Zeitraum hat noch niemand'), fertig[1].embeds[0].data.description);
        assert.deepStrictEqual(fertig[1].components, [], 'eine Seite braucht keine Knöpfe');
    });

    const rank = require(L('bot/commands/rank'));
    await pruefe('3s. /rank zeichnet die Rangkarte über den Kern, Bots nicht', async () => {
        const fertig = [];
        const ia = { guild: g4, user: { id: M1 }, options: { getUser: () => null }, editReply: async (n) => { fertig.push(n); return {}; } };
        await Promise.race([rank.interactionRun({ interaction: ia }), new Promise((_, nein) => setTimeout(() => nein(new Error('Rangkarte hängt')), 30_000))]);
        const n = fertig[0];
        const datei = n?.files?.[0];
        // Ein Bild, kein Ersatztext: Schriften und Schablone sind auf der Anlage da (check-bildkarten).
        assert.ok(datei && /^rank\.(png|jpe?g)$/.test(datei.name || ''), `kein Bild: ${JSON.stringify(n).slice(0, 300)}`);
        assert.ok(Buffer.isBuffer(datei.attachment) && datei.attachment.length > 1000, 'Bild leer');
        const botIa = { ...ia, options: { getUser: () => ({ id: '300000000000000048' }) } };
        g4.members.cache.set('300000000000000048', { id: '300000000000000048', user: { bot: true }, guild: g4 });
        await rank.interactionRun({ interaction: botIa });
        assert.strictEqual(fertig[1].content, 'Bots sammeln keine XP.');
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
    await rot('bot/recht.js fragt ein festes Recht', mit('recht', 'actor_user_id: user.id, recht }', "actor_user_id: user.id, recht: 'LEVELING.VIEW' }"));
    await rot('Aufstieg ohne Level-up-Nachricht', mit('nachbuchung', 'if (guild) await Ausgabe.beiAufstieg(', 'if (false) await Ausgabe.beiAufstieg('));
    await rot('Chat-XP ohne Kanal', mit('chatxp', 'kanal: String(message.channelId)', 'kanal: null'));
    await rot('/xp ohne Rechtefrage', mit('xp', 'if (!recht.darf) return', 'if (false) return'));
    await rot('/xp mit anderem Recht', mit('xp', "const RECHT = 'LEVELING.XP.MANAGE'", "const RECHT = 'LEVELING.VIEW'"));
    await rot('/xp ohne Akteur', mit('xp', 'akteur: user.id', 'akteur: null'));
    await rot('/xp ohne Pflichtgrund', mit('xp', 'required: true, maxLength: 255', 'required: false, maxLength: 255'));
    await rot('/xp reset ohne Bestätigung', mit('xp', 'if (!ok) return null;', ''));
    await rot('/xp ohne Ereignis', mit('xp', "Ereignisse.melde('leveling.xp.korrigiert'", "Ereignisse.melde('leveling.xp.anders'"));
    await rot('Nachrichten speichern ohne CSRF', mit('router', "router.put('/nachrichten', csrfProtection, ", "router.put('/nachrichten', "));
    await rot('Hinweis ohne Rechtefrage', mit('dashboard', "hasPermission(user.id, guildId, 'LEVELING.CONFIGURE')", 'true'));
    await rot('/rank ohne Rangkarte', mit('rank', 'Karte.zeichne(member, s)', 'null'));

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✓ alles grün');
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
