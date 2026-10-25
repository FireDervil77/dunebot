#!/usr/bin/env node
/**
 * Discord-Panel: Beitrittspasswort als Spoiler (Stufe 9 S5).
 *
 * ── Was hier gehalten wird (2026-10-25) ─────────────────────────────────────
 *
 * Betreiber: „Für das Panel wäre es cool, wenn der Owner entscheiden könnte, ob
 * das Server-Passwort mit ***** und einem Schalter zum Anzeigen in Discord
 * angezeigt werden soll." Discord kennt dafür den Spoiler `||…||`.
 *
 *   Quelle     NUR die Einstellung mit `join_password` — nie „das erste
 *              Passwort": Das wäre bei Minecraft der RCON-Zugang, bei Factorio
 *              das Kennwort des factorio.com-Kontos (gemessen an der Registry)
 *   Schalter   `show_password` je Panel, Vorgabe AUS; Recht GAMESERVER.EDIT wie
 *              die übrigen Schalter (Dashboard, IPC, /server panel-add/-edit)
 *   Anzeige    Spoiler mit entschärftem Markdown (ein `|` bräche ihn auf);
 *              ohne gesetztes Passwort steht das da statt eines leeren Spoilers
 *   Formular   Schalter nur, wenn das Paket eines nennt; sagt ehrlich, dass
 *              ein Spoiler nicht schützt; der Wert geht nie an den Browser
 *   Werkbank   Kästchen am Passwort, höchstens eines je Paket
 *
 *   node scripts/check-panel-passwort.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const still = () => {};
if (!ServiceManager.has('Logger')) {
    ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });
}

const HELPERS = path.join(WURZEL, 'plugins/gameserver/dashboard/helpers');
const { buildPanelPayload, payloadHash, woertlich } = require(path.join(HELPERS, 'PanelPresenter'));
const { beitrittsPasswort } = require(path.join(HELPERS, 'Serverseite'));
const PanelService = require(path.join(HELPERS, 'PanelService'));
const Sitzungen = require(path.join(WURZEL, 'plugins/werkbank/dashboard/helpers/Sitzungen.js'));

let bestanden = 0;
function pruefe(text, fn) {
    fn();
    bestanden++;
    console.log(`  ✓ ${text}`);
}
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), 'utf8');

// Wie Minecraft: das erste Passwort ist der RCON-Zugang.
const rcon = { key: 'rcon_password', type: 'password', role: 'owner', name: { de: 'RCON-Passwort' }, default: 'geheim-rcon' };
const beitritt = { key: 'password', type: 'password', role: 'player', name: { de: 'Server-Passwort' }, join_password: true };
const direkt = { key: 'use_direct', type: 'boolean', default: false };
const server = (werte) => ({ paket_werte: JSON.stringify(werte) });

const PANEL = { id: 1, guild_id: 'g', channel_id: 'c', show_players: false, show_controls: false, show_refresh: true, show_password: false };
const SERVER = { id: 7, name: 'Testserver', status: 'online' };
const SNAPSHOT = { online: true, players_current: 0, players_max: 4, source: 'daemon', extra: {} };
const nutzlast = (panel, passwort) => buildPanelPayload({ panel, server: SERVER, snapshot: SNAPSHOT, display: { fields: [] }, passwort });
const feld = (p) => p.embed.fields.find(f => f.name === 'Server-Passwort');


console.log('\n▸ Quelle');

pruefe('ohne join_password kein Passwort — auch nicht das erste (RCON)', () => {
    assert.strictEqual(beitrittsPasswort({ settings: [rcon] }, server({})), null);
    assert.strictEqual(beitrittsPasswort({ settings: [rcon, { ...beitritt, join_password: undefined }] }, server({ password: 'x' })), null);
});

pruefe('mit join_password genau diese Einstellung, samt Vorgabe; leer heißt „keins"', () => {
    const paket = { settings: [rcon, beitritt] };
    assert.deepStrictEqual(beitrittsPasswort(paket, server({ password: 'abc|123' })), { key: 'password', name: 'Server-Passwort', wert: 'abc|123' });
    assert.strictEqual(beitrittsPasswort(paket, server({})).wert, null);
    assert.strictEqual(beitrittsPasswort({ settings: [{ ...beitritt, default: 'vorgabe1' }] }, server({})).wert, 'vorgabe1');
    assert.strictEqual(beitrittsPasswort({ settings: [{ ...beitritt, type: 'text' }] }, server({ password: 'x' })), null, 'join_password an einem Text');
});

pruefe('wirkt das Passwort gerade nicht (applies_when), zeigt das Panel nichts', () => {
    const paket = { settings: [direkt, { ...beitritt, applies_when: { from: 'setting:use_direct', when: 'true' } }] };
    assert.strictEqual(beitrittsPasswort(paket, server({ password: 'x', use_direct: '0' })), null);
    assert.strictEqual(beitrittsPasswort(paket, server({ password: 'x', use_direct: '1' })).wert, 'x');
});

console.log('\n▸ Anzeige im Panel');

pruefe('Schalter aus (auch Bestandspanel ohne Spalte): kein Feld, kein Wert in der Nutzlast', () => {
    const pw = { name: 'Server-Passwort', wert: 'sehrgeheim' };
    for (const panel of [PANEL, { ...PANEL, show_password: undefined }]) {
        const p = nutzlast(panel, pw);
        assert.strictEqual(feld(p), undefined);
        assert.ok(!JSON.stringify(p).includes('sehrgeheim'));
    }
});

pruefe('Schalter an: Spoiler, Markdown entschärft; ohne Passwort ein ehrlicher Satz; ohne Paketangabe nichts', () => {
    const an = { ...PANEL, show_password: true };
    assert.strictEqual(feld(nutzlast(an, { name: 'Server-Passwort', wert: 'abc' })).value, '||abc||');
    assert.strictEqual(feld(nutzlast(an, { name: 'Server-Passwort', wert: 'a||b*c' })).value, '||a\\|\\|b\\*c||');
    assert.strictEqual(feld(nutzlast(an, { name: 'Server-Passwort', wert: null })).value, 'kein Passwort gesetzt');
    assert.strictEqual(nutzlast(an, null).embed.fields.length, 1, 'nur die Spielerzahl');
    assert.strictEqual(woertlich('x\\y`z'), 'x\\\\y\\`z');
});

pruefe('ein geändertes Passwort ändert den Hash — das Panel schreibt sich neu', () => {
    const an = { ...PANEL, show_password: true };
    assert.notStrictEqual(payloadHash(nutzlast(an, { name: 'P', wert: 'eins' })), payloadHash(nutzlast(an, { name: 'P', wert: 'zwei' })));
});

console.log('\n▸ Schalter: Tabelle, Dienst, Wege');

pruefe('Migration: Spalte show_password, Vorgabe FALSE', () => {
    const m = lies('plugins/gameserver/migrations/20261025_150000_panel_show_password.js');
    assert.match(m, /ADD COLUMN show_password BOOLEAN NOT NULL DEFAULT FALSE/);
});

pruefe('PanelService: normalisiert, legt an, ändert, holt das Passwort über beitrittsPasswort', () => {
    assert.strictEqual(PanelService._normalizePanel({ show_password: 1 }).show_password, true);
    assert.strictEqual(PanelService._normalizePanel({}).show_password, false);
    const q = ohneKommentare(lies('plugins/gameserver/dashboard/helpers/PanelService.js'));
    assert.match(q, /showPassword = false,/);
    assert.match(q, /show_password\s+= VALUES\(show_password\)/);
    assert.match(q, /sets\.push\('show_password = \?'\)/);
    assert.match(q, /const pw = beitrittsPasswort\(paket, server\);/);
    assert.match(q, /passwort,\s*\}\);/, 'pushForServer reicht das Passwort nicht an den Presenter');
    // passwortVerfuegbar gibt dem Formular nur den Namen, nie den Wert.
    const verfuegbar = q.slice(q.indexOf('static async passwortVerfuegbar'), q.indexOf('static _shouldPush'));
    assert.match(verfuegbar, /return e \? \{ name: [^}]*\} : null;/);
    assert.ok(!/werte|paket_werte|geltendeWerte/.test(verfuegbar), 'passwortVerfuegbar liest Werte');
});

pruefe('Dashboard-Route und IPC reichen show_password durch; Recht wie die übrigen Schalter', () => {
    const route = ohneKommentare(lies('plugins/gameserver/dashboard/routes/servers.js'));
    assert.match(route, /router\.post\('\/:serverId\/panels', requirePermission\('GAMESERVER\.EDIT'\)[\s\S]{0,1800}showPassword: toBool\(show_password\)/);
    assert.match(route, /router\.patch\('\/:serverId\/panels\/:panelId', requirePermission\('GAMESERVER\.EDIT'\)[\s\S]{0,900}showPassword: show_password\s+=== undefined \? undefined : toBool\(show_password\)/);
    assert.match(route, /return res\.json\(\{ success: true, panels, channels, passwort \}\)/);
    const ipc = ohneKommentare(lies('apps/dashboard/helpers/IPCServer.js'));
    assert.match(ipc, /showPassword: !!payload\.show_password,/);
    assert.match(ipc, /showPassword: payload\.show_password,/);
    assert.match(ipc, /p\.show_password,/);
});

pruefe('/server panel-add und panel-edit haben die Option passwort, beide Sprachen den Text', () => {
    const befehl = ohneKommentare(lies('plugins/gameserver/bot/commands/server.js'));
    assert.strictEqual((befehl.match(/name: 'passwort',\s*type: ApplicationCommandOptionType\.Boolean/g) || []).length, 2);
    assert.match(befehl, /show_password:\s+interaction\.options\.getBoolean\('passwort'\)\s+\?\? false,/);
    assert.match(befehl, /show_password:\s+interaction\.options\.getBoolean\('passwort'\),/);
    for (const sprache of ['de-DE', 'en-GB']) {
        const t = JSON.parse(lies(`plugins/gameserver/bot/locales/${sprache}.json`)).SERVER.OPT_PANEL_PASSWORD;
        assert.ok(t && t.length <= 100, `${sprache}: Text fehlt oder länger als Discord erlaubt`);
    }
});

pruefe('Formular: Schalter nur mit Paketangabe, ehrlicher Hinweis, schickt show_password', () => {
    const ejs = ohneKommentareEjs(lies('plugins/gameserver/dashboard/views/guild/partials/server-detail-panels.ejs'));
    assert.match(ejs, /<div id="panel-password-block" hidden>/);
    assert.match(ejs, /das schützt nicht/);
    assert.match(ejs, /block\.hidden = !passwort;/);
    assert.match(ejs, /show_password:\s+!!passwort && document\.getElementById\('panel-password'\)\.checked/);
    assert.match(ejs, /\(passwort \|\| p\.show_password\)[\s\S]{0,40}toggle\(p, 'show_password'/);
});

console.log('\n▸ Werkbank und Paketprüfung');

const formular = (mehr) => ({
    key: 'password', name_de: 'Server-Passwort', type: 'password', role: 'player', takes_effect: 'restart',
    apply: [{ target: 'env', variable: 'SERVER_PASSWORD' }], ...mehr,
});

pruefe('Werkbank: Kästchen nur am Passwort, landet als join_password', () => {
    assert.strictEqual(Sitzungen.einstellungAusFormular(formular({ join_password: 'on' })).join_password, true);
    assert.ok(!('join_password' in Sitzungen.einstellungAusFormular(formular({}))));
    assert.throws(() => Sitzungen.einstellungAusFormular(formular({ type: 'text', join_password: 'on' })), /nur eine Einstellung vom Typ Passwort/);
    const q = ohneKommentare(lies('plugins/werkbank/dashboard/helpers/Sitzungen.js'));
    const felder = /const EINSTELLUNG_FELDER = \[([^\]]*)\]/.exec(q);
    assert.ok(felder && /'join_password'/.test(felder[1]), 'EINSTELLUNG_FELDER: eine abgewählte Markierung bliebe stehen');
    assert.match(q, /Beitrittspasswort ist schon/);
    assert.match(ohneKommentareEjs(lies('plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs')),
        /data-nur-typ="password"[\s\S]{0,200}name="join_password"/);
});

pruefe('check-pakete: zwei Beitrittspasswörter und eines an einem Text werden abgewiesen, eines geht durch', () => {
    const vorlage = JSON.parse(lies('packages/fbpkg/beispiele/valheim.json'));
    const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'check-panel-passwort-'));
    const lauf = (aendern) => {
        const p = JSON.parse(JSON.stringify(vorlage));
        aendern(p);
        const datei = path.join(ordner, 'paket.json');
        fs.writeFileSync(datei, JSON.stringify(p));
        try { return execFileSync(process.execPath, [path.join(__dirname, 'check-pakete.js'), datei], { encoding: 'utf8' }); }
        catch (f) { return String(f.stdout || '') + String(f.stderr || ''); }
    };
    const pw = (p) => p.settings.find(x => x.type === 'password');
    try {
        assert.ok(!/join_password/.test(lauf((p) => { pw(p).join_password = true; })), 'ein Beitrittspasswort bemängelt');
        assert.match(lauf((p) => { pw(p).join_password = true; p.settings.push({ ...pw(p), key: 'zweites' }); }),
            /join_password an "password" und "zweites"/);
        assert.match(lauf((p) => { p.settings.find(x => x.type === 'text').join_password = true; }),
            /join_password gilt nur für type "password"/);
    } finally {
        fs.rmSync(ordner, { recursive: true, force: true });
    }
});

console.log(`\n${bestanden} Prüfungen bestanden.`);
