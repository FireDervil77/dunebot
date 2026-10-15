#!/usr/bin/env node
/**
 * Einstellungen vom Typ `list` — eine Zeile je Eintrag, in json/yaml als echte
 * Liste geschrieben.
 *
 * ── Was hier gehalten wird (2026-10-15) ─────────────────────────────────────
 *
 * Betreiber: Enshrouded führt `bannedAccounts` als Liste und `userGroups` als
 * Liste von Gruppen — „wie würde ich die in die Settings aufnehmen?" Der
 * Schreiber im Container (fb-cfg) kann seit Daemon ef56fc6 Listen und die
 * Auswahl nach Feld. Hier wird die Dashboard-Seite gehalten:
 *
 *   Regel      Liste.js zerlegt wie der Daemon (leere Zeilen weg, Rand weg),
 *              prüft Höchstzahl und Regel je Eintrag, meldet eine kaputte Regel
 *   Anlegen    paketWerteAnlegen speichert die Liste ohne Leeres; die Route
 *              (Dashboard und Discord) weist einen falschen Eintrag ab
 *   Speichern  PUT …/variables prüft und normalisiert wie das Anlegen
 *   Anzeige    Panel und Anlegeformular zeigen ein mehrzeiliges Feld; das
 *              Panel erkennt Änderungen darin (sonst ginge nichts raus)
 *   Schema     `list`, `item_pattern`, `max_items`; check-pakete weist eine
 *              Liste außerhalb von json/yaml ab
 *
 * Gegenstück im Daemon: internal/parser/listen_test.go, lesen_test.go.
 *
 *   node scripts/check-liste.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const still = () => {};
if (!ServiceManager.has('Logger')) {
    ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });
}

const Liste = require(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/Liste.js'));
const { paketWerteAnlegen } = require(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/StartPayload.js'));
const Serverseite = require(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/Serverseite.js'));

let bestanden = 0;
function pruefe(text, fn) {
    fn();
    bestanden++;
    console.log(`  ✓ ${text}`);
}
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), 'utf8');

const sperren = {
    key: 'banned_accounts', type: 'list', role: 'owner', name: { de: 'Gesperrte Konten' },
    item_pattern: '[0-9]{17}', max_items: 3,
    apply: [{ target: 'file', file: 'enshrouded_server.json', parser: 'json', path: 'bannedAccounts' }],
};
const paket = { settings: [sperren, { key: 'name', type: 'text', role: 'player', default: 'X' }] };
const ID1 = '76561198000000001', ID2 = '76561198000000002';

console.log('\n▸ Regel (Liste.js)');

pruefe('Zerlegen wie der Daemon: leere Zeilen und Rand fallen weg, \\r\\n zählt als Umbruch', () => {
    assert.deepStrictEqual(Liste.eintraege(` ${ID1} \r\n\n${ID2}\n  \n`), [ID1, ID2]);
    assert.deepStrictEqual(Liste.eintraege(''), []);
    assert.deepStrictEqual(Liste.eintraege(undefined), []);
    assert.strictEqual(Liste.normalisiere(`\n${ID1}\n\n ${ID2} `), `${ID1}\n${ID2}`);
});

pruefe('Höchstzahl und Regel je Eintrag — Gegenprobe: ein gültiger Wert geht durch', () => {
    assert.strictEqual(Liste.fehlerDesWerts(sperren, `${ID1}\n${ID2}`), null);
    assert.strictEqual(Liste.fehlerDesWerts(sperren, ''), null, 'eine leere Liste ist erlaubt');
    assert.match(Liste.fehlerDesWerts(sperren, `${ID1}\n${ID2}\n${ID1}\n${ID2}`), /höchstens 3 Einträge, es sind 4/);
    assert.match(Liste.fehlerDesWerts(sperren, `${ID1}\nabc`), /„abc" passt nicht zur Regel/);
    // Die Regel gilt für den GANZEN Eintrag, nicht für ein Stück davon.
    assert.match(Liste.fehlerDesWerts(sperren, `x${ID1}`), /passt nicht/);
    assert.match(Liste.fehlerDesWerts({ ...sperren, item_pattern: '[' }, ID1), /kein gültiger Ausdruck/);
});

pruefe('fehlerInWerten nennt die Einstellung beim Namen, prüft nur Listen', () => {
    assert.strictEqual(Liste.fehlerInWerten(paket, { banned_accounts: ID1, name: 'irgendwas\nzweizeilig' }), null);
    assert.match(Liste.fehlerInWerten(paket, { banned_accounts: 'abc' }), /^„Gesperrte Konten": /);
    assert.strictEqual(Liste.fehlerInWerten(paket, {}), null);
});

console.log('\n▸ Anlegen und Speichern');

pruefe('paketWerteAnlegen speichert die Liste ohne Leeres', () => {
    const w = paketWerteAnlegen(paket, { banned_accounts: `\n ${ID1} \n\n` }, 'Server');
    assert.strictEqual(w.banned_accounts, ID1);
    assert.strictEqual(paketWerteAnlegen(paket, {}, 'Server').banned_accounts, undefined, 'ohne Eingabe und ohne Vorgabe kein Wert');
});

pruefe('Anlegeroute (Dashboard und Discord) und Speichern prüfen mit Liste.js', () => {
    const route = ohneKommentare(lies('plugins/gameserver/dashboard/routes/servers.js'));
    assert.match(route, /const listenFehler = Liste\.fehlerInWerten\(paket, paketWerte\);\s*if \(listenFehler\) return res\.status\(400\)/);
    assert.match(route, /if \(Liste\.istListe\(eintrag\)\) \{\s*const fehler = Liste\.fehlerDesWerts\(eintrag, wert\);\s*if \(fehler\) return res\.status\(400\)/);
    assert.match(route, /Liste\.istListe\(eintrag\) \? Liste\.normalisiere\(wert\) : wert/);
    const ipc = ohneKommentare(lies('apps/dashboard/helpers/IPCServer.js'));
    assert.match(ipc, /helpers\/Liste'\)\s*\.fehlerInWerten\(paket, paketWerte\);\s*if \(listenFehler\) return message\.reply/);
});

console.log('\n▸ Anzeige');

pruefe('Panel: die Karte trägt Regel und Höchstzahl, das Feld ist mehrzeilig und wird als geändert erkannt', () => {
    const server = { ansicht: 'fachlich', paket_werte: JSON.stringify({ banned_accounts: `${ID1}\n${ID2}` }) };
    const u = Serverseite.baueUebersicht(server, paket, {});
    const e = u.einstellungen.sichtbar.find(x => x.schluessel === 'banned_accounts');
    assert.ok(e, 'die Liste fehlt in der Karte');
    assert.deepStrictEqual(e.liste, { regel: '[0-9]{17}', hoechstens: 3 });
    assert.strictEqual(e.wert, `${ID1}\n${ID2}`);
    const ejs = ohneKommentareEjs(lies('plugins/gameserver/dashboard/views/guild/partials/server-detail-uebersicht.ejs'));
    assert.match(ejs, /e\.typ === 'list' && e\.liste[\s\S]{0,400}<textarea[^>]*data-fb-feld="<%= e\.variable %>"/);
    assert.match(ejs, /querySelectorAll\('input\[data-fb-feld\], textarea\[data-fb-feld\]'\)/,
        'das Panel hört nur auf <input> — eine geänderte Liste ginge nie raus');
});

pruefe('Anlegeformular: mehrzeiliges Feld unter setting_<schlüssel>', () => {
    const schritt = Serverseite.baueWerteSchritt({ settings: [{ ...sperren, role: 'player' }] }, null, false);
    const f = schritt.felder.find(x => x.schluessel === 'banned_accounts');
    assert.ok(f && f.liste && f.liste.hoechstens === 3);
    const ejs = ohneKommentareEjs(lies('plugins/gameserver/dashboard/views/guild/server-create-step3.ejs'));
    assert.match(ejs, /f\.typ === 'list' && f\.liste[\s\S]{0,400}<textarea[^>]*name="setting_<%= f\.schluessel %>"/);
});

console.log('\n▸ Schema und Paketprüfung');

pruefe('Schema kennt list, item_pattern, max_items', () => {
    const schema = require(path.join(WURZEL, 'packages/fbpkg/schema/fbpkg-v1.schema.json'));
    const s = schema.definitions.setting.properties;
    assert.ok(s.type.enum.includes('list'));
    assert.strictEqual(s.item_pattern.type, 'string');
    assert.strictEqual(s.max_items.type, 'integer');
});

pruefe('check-pakete weist eine Liste außerhalb von json/yaml und eine Auswahl in ini ab', () => {
    const quelle = ohneKommentare(lies('scripts/check-pakete.js'));
    assert.match(quelle, /s\.type === 'list'[\s\S]{0,300}\['json', 'yaml'\]\.includes\(z\.parser\)/);
    assert.match(quelle, /\/\[\[\\\]\]\/\.test\(z\.path \|\| ''\) && !\['json', 'yaml'\]\.includes\(z\.parser\)/);
});

console.log(`\n${bestanden} Prüfung(en) bestanden.`);
