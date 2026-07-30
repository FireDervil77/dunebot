#!/usr/bin/env node
/**
 * Prüft den Aufbau der Discord-Status-Panels (E4) ohne Datenbank und ohne Bot.
 *
 * Die beiden Bremsen gegen Discords Rate-Limits sind reine Rechenlogik – und
 * genau die Stelle, an der ein Fehler teuer wird: Zu scharf, und das Panel steht
 * still; zu locker, und jedes Panel schreibt im Poll-Takt identische Embeds.
 *
 *   node scripts/check-panel-presenter.js
 */

'use strict';

const assert = require('assert');
const path   = require('path');

const HELPERS = path.join(__dirname, '../plugins/gameserver/dashboard/helpers');
const { buildFields, formatValue, playerCountText, buildPanelPayload, payloadHash } =
    require(path.join(HELPERS, 'PanelPresenter'));
const PanelService = require(path.join(HELPERS, 'PanelService'));

let passed = 0;
function check(name, fn) {
    try {
        fn();
        console.log(`  ✓ ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ✗ ${name}\n    ${err.message}`);
        process.exitCode = 1;
    }
}

console.log('\nFeld-Formatierung');

check('ms hängt die Einheit an, null bleibt leer', () => {
    assert.strictEqual(formatValue(16, 'ms'), '16 ms');
    assert.strictEqual(formatValue(null, 'ms'), null);
});

check('lock antwortet nur bei echtem Boolean', () => {
    assert.strictEqual(formatValue(true, 'lock'), '🔒 Ja');
    assert.strictEqual(formatValue(false, 'lock'), '🔓 Nein');
    // Palworld: keine Query, also keine Antwort – "kein Passwort" wäre erfunden
    assert.strictEqual(formatValue(null, 'lock'), null);
    assert.strictEqual(formatValue(undefined, 'lock'), null);
});

check('code wird zu Discord-Inline-Code', () => {
    assert.strictEqual(formatValue('1.2.3.4:25007', 'code'), '`1.2.3.4:25007`');
});

check('duration rechnet Sekunden in Stunden und Minuten', () => {
    assert.strictEqual(formatValue(3900, 'duration'), '1 h 5 min');
    assert.strictEqual(formatValue(120, 'duration'), '2 min');
    assert.strictEqual(formatValue(0, 'duration'), null);
});

console.log('\nFeldliste aus display.fields');

const FIELDS = [
    { key: 'map',      label: 'Map',      source: 'map' },
    { key: 'ping',     label: 'Ping',     source: 'ping', format: 'ms' },
    { key: 'version',  label: 'Version',  source: ['extra.gameVersion', 'version'] },
    { key: 'bots',     label: 'Bots',     source: 'bots', hide_when: 'zero' },
];

check('leere Felder fallen weg statt "–" zu zeigen', () => {
    const out = buildFields(FIELDS, { map: null, ping: null, version: null, bots: null });
    assert.deepStrictEqual(out, []);
});

check('bots mit 0 wird ausgeblendet (hide_when)', () => {
    const out = buildFields(FIELDS, { map: 'de_dust2', bots: 0 });
    assert.deepStrictEqual(out.map(f => f.name), ['Map']);
});

check('erster belegter Pfad gewinnt bei mehreren Quellen', () => {
    const fromExtra = buildFields(FIELDS, { extra: { gameVersion: '1.7.0' }, version: '0.0.0' });
    assert.strictEqual(fromExtra.find(f => f.name === 'Version').value, '1.7.0');

    const fallback = buildFields(FIELDS, { version: '0.0.0' });
    assert.strictEqual(fallback.find(f => f.name === 'Version').value, '0.0.0');
});

console.log('\nSpielerzahl');

check('0 Spieler und "unbekannt" sind zwei verschiedene Aussagen', () => {
    assert.strictEqual(playerCountText({ players_current: 0,    players_max: 10 }), '0 / 10');
    assert.strictEqual(playerCountText({ players_current: null, players_max: 10 }), '? / 10');
    assert.strictEqual(playerCountText({ players_current: null, players_max: null }), 'unbekannt');
});

console.log('\nPanel-Nutzlast');

const PANEL = {
    id: 1, guild_id: '123', channel_id: '456', message_id: null,
    show_players: false, show_controls: true, show_refresh: true, min_interval_s: 60,
};
const SERVER   = { id: 152, name: 'Palworld', status: 'online' };
const SNAPSHOT = {
    online: true, players_current: 2, players_max: 10, map: null, version: null,
    ping_ms: null, source: 'rcon', extra: {},
    players: [{ name: 'Alice' }, { name: 'Bob' }],
};

check('Spielernamen bleiben ohne show_players draußen', () => {
    const payload = buildPanelPayload({ panel: PANEL, server: SERVER, snapshot: SNAPSHOT, display: { fields: FIELDS } });
    const text = JSON.stringify(payload);
    assert.ok(!text.includes('Alice'), 'Name steht im Panel, obwohl show_players aus ist');
    assert.ok(text.includes('2 / 10'), 'Zählwert fehlt');
});

check('mit show_players erscheint die Liste', () => {
    const payload = buildPanelPayload({
        panel: { ...PANEL, show_players: true }, server: SERVER, snapshot: SNAPSHOT, display: { fields: FIELDS },
    });
    assert.ok(JSON.stringify(payload).includes('Alice'));
});

check('Buttons spiegeln den Zustand: online = starten aus, stoppen an', () => {
    const on  = buildPanelPayload({ panel: PANEL, server: SERVER, snapshot: SNAPSHOT, display: {} });
    assert.deepStrictEqual({ start: on.controls.can_start, stop: on.controls.can_stop }, { start: false, stop: true });

    const off = buildPanelPayload({
        panel: PANEL, server: { ...SERVER, status: 'offline' },
        snapshot: { ...SNAPSHOT, online: false }, display: {},
    });
    assert.deepStrictEqual({ start: off.controls.can_start, stop: off.controls.can_stop }, { start: true, stop: false });
});

check('nur "Neu laden": kein Start/Stop, aber Buttons bleiben', () => {
    // Der Fall für einen öffentlichen Kanal: aktualisieren darf jeder,
    // durchschalten niemand.
    const payload = buildPanelPayload({
        panel: { ...PANEL, show_controls: false, show_refresh: true },
        server: SERVER, snapshot: SNAPSHOT, display: {},
    });
    assert.ok(payload.controls, 'controls fehlt – dann verschwindet auch der Neu-laden-Button');
    assert.strictEqual(payload.controls.show_controls, false);
    assert.strictEqual(payload.controls.show_refresh, true);
    // can_start/can_stop dürfen nie true werden, wenn die Steuerung aus ist
    assert.strictEqual(payload.controls.can_start, false);
    assert.strictEqual(payload.controls.can_stop, false);
});

check('nur Start/Stop ohne Neu laden', () => {
    const payload = buildPanelPayload({
        panel: { ...PANEL, show_controls: true, show_refresh: false },
        server: SERVER, snapshot: SNAPSHOT, display: {},
    });
    assert.strictEqual(payload.controls.show_refresh, false);
    assert.strictEqual(payload.controls.can_stop, true);
});

check('beides aus → gar keine Buttons', () => {
    const payload = buildPanelPayload({
        panel: { ...PANEL, show_controls: false, show_refresh: false },
        server: SERVER, snapshot: SNAPSHOT, display: {},
    });
    assert.strictEqual(payload.controls, null);
});

check('ein umgelegter Button-Schalter ändert den Hash', () => {
    // Sonst bliebe die Nachricht mit den alten Buttons stehen, bis sich
    // zufällig die Spielerzahl ändert.
    const mit  = buildPanelPayload({ panel: PANEL, server: SERVER, snapshot: SNAPSHOT, display: {} });
    const ohne = buildPanelPayload({
        panel: { ...PANEL, show_controls: false }, server: SERVER, snapshot: SNAPSHOT, display: {},
    });
    assert.notStrictEqual(payloadHash(mit), payloadHash(ohne));
});

console.log('\nSpiele ohne Live-Quelle (Quelle: daemon)');

check('laufender Server ohne Quelle gilt als online', () => {
    // Hytale und Windrose bieten weder Query noch RCON - ohne diesen Fall
    // zeigte das Panel dauerhaft "offline", obwohl der Container lief.
    const payload = buildPanelPayload({
        panel: PANEL, server: SERVER, display: {},
        snapshot: { online: true, players_current: null, players_max: 10, source: 'daemon', extra: {}, players: [] },
    });
    assert.ok(payload.embed.title.includes('Online'));
});

check('die Spielerzahl heißt "nicht abfragbar", nicht "? / 10"', () => {
    const text = playerCountText({ players_current: null, players_max: 10, source: 'daemon' });
    assert.strictEqual(text, 'nicht abfragbar (max. 10)');
    // Zum Vergleich: bei einem Spiel MIT Quelle bleibt es beim Fragezeichen,
    // denn dort ist der Wert wirklich nur gerade unbekannt.
    assert.strictEqual(playerCountText({ players_current: null, players_max: 10, source: 'query' }), '? / 10');
});

check('die Fußzeile erklärt, warum keine Spielerzahl dasteht', () => {
    const payload = buildPanelPayload({
        panel: PANEL, server: SERVER, display: {},
        snapshot: { online: true, players_current: null, players_max: 10, source: 'daemon', extra: {}, players: [] },
    });
    assert.ok(payload.embed.footer.includes('keine Spielerabfrage möglich'), payload.embed.footer);
});

console.log('\nHash (Bremse 2: kein Edit ohne Änderung)');

check('der Zeitstempel verändert den Hash nicht', () => {
    const a = buildPanelPayload({ panel: PANEL, server: SERVER, snapshot: SNAPSHOT, display: { fields: FIELDS } });
    const b = buildPanelPayload({ panel: PANEL, server: SERVER, snapshot: SNAPSHOT, display: { fields: FIELDS } });
    b.embed.timestamp = new Date(Date.now() + 600_000).toISOString();
    assert.strictEqual(payloadHash(a), payloadHash(b),
        'Ein Panel würde sich minütlich selbst neu schreiben, nur weil die Uhr weiterläuft');
});

check('eine geänderte Spielerzahl verändert den Hash', () => {
    const a = buildPanelPayload({ panel: PANEL, server: SERVER, snapshot: SNAPSHOT, display: { fields: FIELDS } });
    const b = buildPanelPayload({
        panel: PANEL, server: SERVER,
        snapshot: { ...SNAPSHOT, players_current: 3 }, display: { fields: FIELDS },
    });
    assert.notStrictEqual(payloadHash(a), payloadHash(b));
});

console.log('\nMindestabstand (Bremse 1)');

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

check('noch nie gepostet → immer schicken', () => {
    assert.strictEqual(PanelService._shouldPush({ message_id: null }, HASH_A), true);
});

check('gleicher Hash → nichts zu tun', () => {
    const panel = { message_id: '1', last_hash: HASH_A, last_pushed_at: new Date(Date.now() - 600_000), min_interval_s: 60 };
    assert.strictEqual(PanelService._shouldPush(panel, HASH_A), false);
});

check('geänderter Hash, aber zu früh → warten', () => {
    const panel = { message_id: '1', last_hash: HASH_A, last_pushed_at: new Date(Date.now() - 5_000), min_interval_s: 60 };
    assert.strictEqual(PanelService._shouldPush(panel, HASH_B), false);
});

check('geänderter Hash nach Ablauf des Abstands → schicken', () => {
    const panel = { message_id: '1', last_hash: HASH_A, last_pushed_at: new Date(Date.now() - 61_000), min_interval_s: 60 };
    assert.strictEqual(PanelService._shouldPush(panel, HASH_B), true);
});

console.log(`\n${passed} Prüfung(en) bestanden.${process.exitCode ? ' MIT FEHLERN.' : ''}\n`);
