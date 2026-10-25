#!/usr/bin/env node
/**
 * Textregel — was ein Text- oder Passwortwert erfüllen muss (`pattern`,
 * `pattern_hint`, `min_length`).
 *
 * ── Was hier gehalten wird (2026-10-25, Stufe 9 S4) ─────────────────────────
 *
 * Betreiber: „Panel. bitte die Erfordernisse für die Kennung mitgeben." Der
 * Windrose-Einladungscode braucht mindestens 6 Zeichen aus 0–9, a–z, A–Z; ein
 * falscher Code fiel erst beim Start auf. Dazu kam ein Fund: `min_length`
 * stand seit Monaten im Schema (Valheim-Passwort: 5), geprüft hat es niemand.
 *
 *   Regel      Textregel.js: leerer Wert ungeprüft, sonst Mindestlänge, dann
 *              Regel ganz (`^(?:…)$`); der Wert steht nie in der Meldung
 *   Browser    assets/js/textregel.js rechnet Zeile für Zeile gleich — hier an
 *              derselben Tabelle verglichen
 *   Anlegen    Dashboard und Discord weisen einen falschen Wert ab
 *   Speichern  PUT …/variables ebenso; die Karte hält ihn schon am Feld auf
 *   Werkbank   Formular schreibt pattern/pattern_hint, Vorgabe und Probewerte
 *              gegen die Regel geprüft
 *   Schema     pattern, pattern_hint; check-pakete weist falschen Typ, kaputte
 *              Regel und eine Vorgabe gegen die eigene Regel ab
 *
 *   node scripts/check-textregel.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const still = () => {};
if (!ServiceManager.has('Logger')) {
    ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });
}

const Textregel = require(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/Textregel.js'));
const Serverseite = require(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/Serverseite.js'));
const Sitzungen = require(path.join(WURZEL, 'plugins/werkbank/dashboard/helpers/Sitzungen.js'));

let bestanden = 0;
function pruefe(text, fn) {
    fn();
    bestanden++;
    console.log(`  ✓ ${text}`);
}
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), 'utf8');

const HINWEIS = 'Mindestens 6 Zeichen, nur 0–9, a–z, A–Z; Groß-/Kleinschreibung zählt.';
const code = {
    key: 'invite_code', type: 'text', role: 'player', name: { de: 'Einladungscode' },
    pattern: '^[0-9A-Za-z]{6,}$', pattern_hint: { de: HINWEIS, en: 'At least 6 characters …' },
};
const kennwort = { key: 'password', type: 'password', role: 'player', name: { de: 'Kennwort' }, min_length: 5 };
const kaputt = { key: 'x', type: 'text', pattern: '[' };
const ohneWorte = { key: 'y', type: 'text', pattern: '[a-z]+' };

// Der Browser-Teil in einer eigenen Umgebung, ohne document — so wie er im
// Browser geladen wird, nur dass er sich nirgends anbindet.
const fenster = {};
vm.runInNewContext(lies('plugins/gameserver/dashboard/assets/js/textregel.js'), { window: fenster, globalThis: fenster, JSON });
const browser = fenster.fbTextregel;


console.log('\n▸ Regel');

pruefe('Einladungscode: 6+ Zeichen aus 0–9a–zA–Z; leer bleibt ungeprüft', () => {
    for (const gut of ['abc123', 'AbCdEf', '000000', 'aB3dE5fG7', '']) assert.strictEqual(Textregel.fehlerDesWerts(code, gut), null, gut);
    for (const schlecht of ['abc12', 'abc-123', 'abc 123', 'äbc123', 'abc123\n']) {
        assert.strictEqual(Textregel.fehlerDesWerts(code, schlecht), `erfüllt die Vorgabe nicht — ${HINWEIS}`, JSON.stringify(schlecht));
    }
});

pruefe('Regel gilt für den ganzen Wert, auch ohne ^…$ im Paket', () => {
    assert.strictEqual(Textregel.fehlerDesWerts(ohneWorte, 'abc'), null);
    assert.match(Textregel.fehlerDesWerts(ohneWorte, 'abc1'), /erfüllt die Vorgabe nicht — Regel: \[a-z\]\+/);
});

pruefe('min_length (bisher ungeprüft): Zahl in der Meldung, aber nie der Wert', () => {
    assert.strictEqual(Textregel.fehlerDesWerts(kennwort, 'abcd'), 'mindestens 5 Zeichen, es sind 4');
    assert.strictEqual(Textregel.fehlerDesWerts(kennwort, 'abcde'), null);
    assert.ok(!Textregel.fehlerDesWerts(kennwort, 'geh1').includes('geh1'), 'das Passwort stünde in der Meldung');
    assert.strictEqual(Textregel.hinweis(kennwort), 'mindestens 5 Zeichen');
});

pruefe('kaputte Regel wird gemeldet, nicht still durchgelassen; andere Typen bleiben unberührt', () => {
    assert.strictEqual(Textregel.fehlerDesWerts(kaputt, 'a'), 'die Prüfregel im Paket ist kein gültiger Ausdruck');
    assert.strictEqual(Textregel.fehlerDesWerts({ key: 'n', type: 'number', pattern: '[0-9]' }, '12'), null);
    assert.strictEqual(Textregel.fehlerDesWerts({ key: 'l', type: 'list', min_length: 3 }, 'a'), null);
    assert.strictEqual(Textregel.fehlerDesWerts(undefined, 'a'), null);
});

pruefe('fehlerInWerten nennt den Namen der Einstellung', () => {
    const paket = { settings: [kennwort, code] };
    assert.strictEqual(Textregel.fehlerInWerten(paket, { password: 'langgenug', invite_code: 'abc' }),
        `„Einladungscode": erfüllt die Vorgabe nicht — ${HINWEIS}`);
    assert.strictEqual(Textregel.fehlerInWerten(paket, { password: 'langgenug', invite_code: 'abc123' }), null);
});

console.log('\n▸ Browser rechnet dasselbe');

pruefe('assets/js/textregel.js liefert an der ganzen Tabelle dieselben Sätze', () => {
    const regeln = [code, kennwort, kaputt, ohneWorte, { key: 'z', type: 'text', min_length: 3, pattern: 'x+', pattern_hint: { en: 'only x' } }];
    const werte = ['', 'a', 'abcd', 'abcde', 'abc123', 'abc-123', 'xx', 'xxx', 'xxxy', 'ABCDEF', 'ä', '[', null, undefined];
    let n = 0;
    for (const e of regeln) for (const w of werte) {
        assert.strictEqual(browser.fehlerNachRegel(Textregel.fuerAnzeige(e), w), Textregel.fehlerDesWerts(e, w), `${e.key} / ${JSON.stringify(w)}`);
        n++;
    }
    assert.ok(n >= 70);
});

console.log('\n▸ Anlegen und Speichern');

pruefe('Anlegeroute (Dashboard und Discord) und Speichern prüfen mit Textregel.js', () => {
    const route = ohneKommentare(lies('plugins/gameserver/dashboard/routes/servers.js'));
    assert.match(route, /const textFehler = Textregel\.fehlerInWerten\(paket, paketWerte\);\s*if \(textFehler\) return res\.status\(400\)/);
    assert.match(route, /if \(Textregel\.hatRegel\(eintrag\)\) \{\s*const fehler = Textregel\.fehlerDesWerts\(eintrag, wert\);\s*if \(fehler\) return res\.status\(400\)/);
    // Vor dem INSERT, sonst stünde der Server schon da.
    assert.ok(route.indexOf('Textregel.fehlerInWerten(paket, paketWerte)') < route.indexOf('INSERT INTO gameservers'), 'Prüfung nach dem Anlegen');
    const ipc = ohneKommentare(lies('apps/dashboard/helpers/IPCServer.js'));
    assert.match(ipc, /helpers\/Textregel'\)\s*\.fehlerInWerten\(paket, paketWerte\);\s*if \(textFehler\) return message\.reply/);
});

console.log('\n▸ Anzeige');

pruefe('Panel: die Karte trägt die Regel, das Feld prüft vor, Speichern hält einen falschen Wert auf', () => {
    const paket = { settings: [code, kennwort] };
    const u = Serverseite.baueUebersicht({ ansicht: 'fachlich', paket_werte: JSON.stringify({ invite_code: 'abc123' }) }, paket, {});
    const e = u.einstellungen.sichtbar.find(x => x.schluessel === 'invite_code');
    assert.deepStrictEqual(e.regel, { muster: '^[0-9A-Za-z]{6,}$', mindestens: null, hinweis: HINWEIS, beschrieben: true });
    const ejs = ohneKommentareEjs(lies('plugins/gameserver/dashboard/views/guild/partials/server-detail-uebersicht.ejs'));
    assert.match(ejs, /<script src="\/assets\/plugins\/gameserver\/js\/textregel\.js"><\/script>/);
    assert.match(ejs, /data-fb-regel="<%= JSON\.stringify\(e\.regel\) %>"/);
    assert.match(ejs, /<%= e\.regel\.hinweis %>[\s\S]{0,200}data-fb-regel-meldung/);
    assert.match(ejs, /'fb-speichern'\)\.addEventListener\('click', function \(\) \{[\s\S]{0,400}fbTextregel\.pruefe\(feld\)[\s\S]{0,300}return;/);
    assert.ok(!/alert\('Nicht gespeichert/.test(ejs), 'Fehler beim Speichern wieder als alert()');
});

pruefe('Anlegeformular: Regel am Feld, setCustomValidity hält das Abschicken auf', () => {
    const schritt = Serverseite.baueWerteSchritt({ settings: [code] }, null, false);
    const f = schritt.felder.find(x => x.schluessel === 'invite_code');
    assert.ok(f && f.regel && f.regel.hinweis === HINWEIS, 'Regel fehlt im Anlegeschritt');
    const ejs = ohneKommentareEjs(lies('plugins/gameserver/dashboard/views/guild/server-create-step3.ejs'));
    assert.match(ejs, /<script src="\/assets\/plugins\/gameserver\/js\/textregel\.js"><\/script>/);
    assert.match(ejs, /data-fb-regel="<%= JSON\.stringify\(f\.regel\) %>"/);
    assert.match(lies('plugins/gameserver/dashboard/assets/js/textregel.js'), /feld\.setCustomValidity\(fehler \|\| ''\)/);
});

console.log('\n▸ Werkbank');

const formular = (mehr) => ({
    key: 'invite_code', name_de: 'Einladungscode', type: 'text', role: 'player', takes_effect: 'restart',
    apply: [{ target: 'file', file: 'R5/ServerDescription.json', parser: 'json', path: 'InviteCode' }], ...mehr,
});

pruefe('Formular schreibt pattern und pattern_hint; Fehler werden laut', () => {
    const e = Sitzungen.einstellungAusFormular(formular({ pattern: '[0-9A-Za-z]{6,}', pattern_hint_de: HINWEIS, pattern_hint_en: 'en' }));
    assert.deepStrictEqual([e.pattern, e.pattern_hint], ['[0-9A-Za-z]{6,}', { de: HINWEIS, en: 'en' }]);
    assert.throws(() => Sitzungen.einstellungAusFormular(formular({ pattern: '[' })), /kein gültiger Ausdruck/);
    assert.throws(() => Sitzungen.einstellungAusFormular(formular({ pattern_hint_de: 'nur Worte' })), /Hinweis ohne Regel/);
    assert.throws(() => Sitzungen.einstellungAusFormular(formular({ type: 'number', pattern: '[0-9]+' })), /nur für Text und Passwort/);
    assert.throws(() => Sitzungen.einstellungAusFormular(formular({ pattern: '[0-9A-Za-z]{6,}', default: 'abc' })), /Vorgabe: erfüllt die Vorgabe nicht/);
    const ohne = Sitzungen.einstellungAusFormular(formular({}));
    assert.ok(!('pattern' in ohne) && !('pattern_hint' in ohne));
});

pruefe('Werkbank: Formular hat die Felder, Bearbeiten füllt sie, Probewerte prüfen die Regel', () => {
    const ejs = ohneKommentareEjs(lies('plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs'));
    assert.match(ejs, /data-nur-typ="text password"[\s\S]{0,300}name="pattern"[\s\S]{0,300}name="pattern_hint_de"[\s\S]{0,300}name="pattern_hint_en"/);
    assert.match(ejs, /formE\.pattern\.value = e\.pattern \|\| ''/);
    const quelle = ohneKommentare(lies('plugins/werkbank/dashboard/helpers/Sitzungen.js'));
    assert.match(quelle, /'pattern', 'pattern_hint'\]/, 'EINSTELLUNG_FELDER: eine geleerte Regel bliebe stehen');
    assert.match(quelle, /const fehler = Textregel\.fehlerDesWerts\(einstellung, wert\);\s*if \(fehler\) throw/);
});

console.log('\n▸ Schema und Paketprüfung');

pruefe('Schema kennt pattern und pattern_hint', () => {
    const s = require(path.join(WURZEL, 'packages/fbpkg/schema/fbpkg-v1.schema.json')).definitions.setting.properties;
    assert.strictEqual(s.pattern.type, 'string');
    assert.strictEqual(s.pattern_hint.$ref, '#/definitions/text');
});

pruefe('check-pakete weist falschen Typ, kaputte Regel und eine Vorgabe gegen die Regel ab — und lässt die richtige durch', () => {
    const vorlage = JSON.parse(lies('packages/fbpkg/beispiele/valheim.json'));
    const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'check-textregel-'));
    const lauf = (aendern) => {
        const p = JSON.parse(JSON.stringify(vorlage));
        const e = p.settings.find(x => x.type === 'password');
        aendern(e, p);
        const datei = path.join(ordner, 'paket.json');
        fs.writeFileSync(datei, JSON.stringify(p));
        try { return execFileSync(process.execPath, [path.join(__dirname, 'check-pakete.js'), datei], { encoding: 'utf8' }); }
        catch (f) { return String(f.stdout || '') + String(f.stderr || ''); }
    };
    try {
        const gut = lauf((e) => { e.pattern = '[^ ]+'; e.pattern_hint = { de: 'keine Leerzeichen' }; });
        assert.ok(!/pattern/.test(gut), `richtige Regel bemängelt:\n${gut}`);
        assert.match(lauf((e, p) => { const z = p.settings.find(x => x.type === 'number'); z.pattern = '[0-9]+'; }),
            /pattern\/pattern_hint gelten nur für type "text" und "password"/);
        assert.match(lauf((e) => { e.pattern = '['; }), /pattern ist kein gültiger Ausdruck/);
        assert.match(lauf((e) => { e.default = 'ab'; }), /Vorgabe mindestens 5 Zeichen, es sind 2/);
    } finally {
        fs.rmSync(ordner, { recursive: true, force: true });
    }
});

console.log(`\n${bestanden} Prüfungen bestanden.`);
