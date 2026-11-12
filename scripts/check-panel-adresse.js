#!/usr/bin/env node
/**
 * Discord-Panel: Adresse wie auf der Serverseite, Schalter je Panel (K373).
 *
 * ── Was hier gehalten wird (2026-11-12) ─────────────────────────────────────
 *
 * Betreiber bei Stormforge (2026-11-11): Das Panel zeigt keine Adresse. Gemessen:
 * Das Feld entstand nur aus `connect` im Paket, und keines der 15 freigegebenen
 * Pakete hatte eines. Entscheidung (2026-11-12): Die Adresse zum Beitreten
 * genügt, ein Beitrittslink kommt nicht (nicht jedes Spiel kann ihn, einen
 * eigenen Dienst dafür will der Betreiber nicht). Wie immer mit Schalter.
 *
 *   Quelle     dieselbe Rechnung wie die Serverseite (baueAdresse, baueVerbindung):
 *              ohne connect die Adresszeilen als IP:Port, mit connect dessen
 *              Angabe (Windrose: Einladungscode)
 *   Zeilen     „Adresse“, oder bei eigenem Abfrageport „Serverliste“ und
 *              „Direktverbindung“ — je eine Zeile ein Feld, als Code zum Kopieren
 *   Schalter   `show_address` je Panel, Vorgabe AN (Bestand bekommt die Adresse
 *              beim nächsten Push); Recht GAMESERVER.EDIT wie die übrigen
 *              (Dashboard, IPC, /server panel-add/-edit)
 *
 *   node scripts/check-panel-adresse.js
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

const HELPERS = path.join(WURZEL, 'plugins/gameserver/dashboard/helpers');
const { buildPanelPayload, payloadHash } = require(path.join(HELPERS, 'PanelPresenter'));
const PanelService = require(path.join(HELPERS, 'PanelService'));

let bestanden = 0;
function pruefe(text, fn) {
    fn();
    bestanden++;
    console.log(`  ✓ ${text}`);
}
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), 'utf8');

// Server 186 (Valheim) wie ihn pushForServer liest: bind_ip = IP der Maschine, Name geprüft.
const VALHEIM = {
    id: 186, name: 'Fires Valheim Bude', status: 'online', paket_werte: '{}',
    bind_ip: '45.131.66.91', rootserver_ip: '45.131.66.91', fqdn: 'node2.firenetworks.de', fqdn_gilt: 1,
    ports: JSON.stringify({ game: { external: 25002 }, query: { external: 25003 } }),
};
// Server 235 (Stormforge): ein Port.
const STORMFORGE = { ...VALHEIM, id: 235, ports: JSON.stringify({ game: { external: 25008 } }) };
const PANEL = { id: 1, guild_id: 'g', channel_id: 'c', show_players: false, show_controls: false, show_refresh: true, show_password: false, show_address: true };
const SNAPSHOT = { online: true, players_current: 0, players_max: 4, source: 'daemon', extra: {} };
const nutzlast = (panel, verbindung) => buildPanelPayload({ panel, server: VALHEIM, snapshot: SNAPSHOT, display: { fields: [] }, verbindung });
const felder = (p) => p.embed.fields.filter(f => f.name !== 'Spieler').map(f => [f.name, f.value]);

console.log('\n▸ Quelle');

pruefe('ohne Paket und ohne connect: die Adresszeilen der Serverseite, als IP:Port', () => {
    assert.deepStrictEqual(PanelService._verbindung(null, VALHEIM), [
        { label: 'Serverliste', text: '45.131.66.91:25003' },
        { label: 'Direktverbindung', text: '45.131.66.91:25002' },
    ]);
    assert.deepStrictEqual(PanelService._verbindung({ settings: [] }, STORMFORGE), [
        { label: 'Adresse', text: '45.131.66.91:25008' },
    ]);
});

pruefe('ohne belegten Port keine Zeile — nichts Erfundenes', () => {
    assert.deepStrictEqual(PanelService._verbindung(null, { ...STORMFORGE, ports: null }), []);
});

pruefe('connect mit Einstellung (Einladungscode) ersetzt die Adresse; connect-Label gilt der Direktverbindung', () => {
    const code = { key: 'invite', type: 'text', name: { de: 'Einladungscode' } };
    const paket = { settings: [code], connect: { show: 'setting:invite' } };
    assert.deepStrictEqual(PanelService._verbindung(paket, { ...STORMFORGE, paket_werte: JSON.stringify({ invite: 'ABC-123' }) }),
        [{ label: 'Einladungscode', text: 'ABC-123' }]);
    assert.deepStrictEqual(PanelService._verbindung(paket, STORMFORGE), [{ label: 'Einladungscode', text: 'noch nicht festgelegt' }]);
    const beschriftet = PanelService._verbindung({ settings: [], connect: { show: 'address', label: { de: 'Im Spiel eingeben' } } }, VALHEIM);
    assert.deepStrictEqual(beschriftet.map(z => z.label), ['Serverliste', 'Im Spiel eingeben']);
});

console.log('\n▸ Anzeige im Panel');

pruefe('Schalter an: je Zeile ein Feld als Code; Schalter aus: kein Feld', () => {
    const zeilen = PanelService._verbindung(null, VALHEIM);
    assert.deepStrictEqual(felder(nutzlast(PANEL, zeilen)), [
        ['Serverliste', '`45.131.66.91:25003`'],
        ['Direktverbindung', '`45.131.66.91:25002`'],
    ]);
    assert.deepStrictEqual(felder(nutzlast({ ...PANEL, show_address: false }, zeilen)), []);
    assert.deepStrictEqual(felder(nutzlast(PANEL, [])), []);
    assert.deepStrictEqual(felder(nutzlast(PANEL, undefined)), []);
});

pruefe('die Adresse gehört zum Hash — ein Bestandspanel schreibt sich nach dem Rollout einmal neu', () => {
    const zeilen = PanelService._verbindung(null, VALHEIM);
    assert.notStrictEqual(payloadHash(nutzlast(PANEL, zeilen)), payloadHash(nutzlast({ ...PANEL, show_address: false }, zeilen)));
});

console.log('\n▸ Schalter: Tabelle, Dienst, Wege');

pruefe('Migration: Spalte show_address, Vorgabe TRUE', () => {
    const m = lies('plugins/gameserver/migrations/20261112_160000_panel_show_address.js');
    assert.match(m, /ADD COLUMN show_address BOOLEAN NOT NULL DEFAULT TRUE/);
});

pruefe('PanelService: normalisiert (fehlende Spalte = an), legt an, ändert', () => {
    assert.strictEqual(PanelService._normalizePanel({ show_address: 0 }).show_address, false);
    assert.strictEqual(PanelService._normalizePanel({ show_address: 1 }).show_address, true);
    assert.strictEqual(PanelService._normalizePanel({}).show_address, true);
    const q = ohneKommentare(lies('plugins/gameserver/dashboard/helpers/PanelService.js'));
    assert.match(q, /showAddress = true,/);
    assert.match(q, /show_address\s+= VALUES\(show_address\)/);
    assert.match(q, /sets\.push\('show_address = \?'\)/);
    assert.match(q, /verbindung: PanelService\._verbindung\(paket, server\)/);
});

pruefe('Dashboard-Route und IPC reichen show_address durch; Recht wie die übrigen Schalter', () => {
    const route = ohneKommentare(lies('plugins/gameserver/dashboard/routes/servers.js'));
    assert.match(route, /router\.post\('\/:serverId\/panels', requirePermission\('GAMESERVER\.EDIT'\)[\s\S]{0,1900}showAddress:\s+show_address\s+=== undefined \? true : toBool\(show_address\)/);
    assert.match(route, /router\.patch\('\/:serverId\/panels\/:panelId', requirePermission\('GAMESERVER\.EDIT'\)[\s\S]{0,1000}showAddress:\s+show_address\s+=== undefined \? undefined : toBool\(show_address\)/);
    assert.match(route, /show_password, show_address, last_pushed_at/);
    const ipc = ohneKommentare(lies('apps/dashboard/helpers/IPCServer.js'));
    assert.match(ipc, /showAddress:\s+payload\.show_address === undefined \|\| payload\.show_address === null \? true : !!payload\.show_address,/);
    assert.match(ipc, /showAddress:\s+payload\.show_address,/);
    assert.match(ipc, /p\.show_address,/);
});

pruefe('/server panel-add und panel-edit haben die Option adresse, beide Sprachen den Text', () => {
    const befehl = ohneKommentare(lies('plugins/gameserver/bot/commands/server.js'));
    assert.strictEqual((befehl.match(/name: 'adresse',\s*type: ApplicationCommandOptionType\.Boolean/g) || []).length, 2);
    assert.match(befehl, /show_address:\s+interaction\.options\.getBoolean\('adresse'\)\s+\?\? true,/);
    assert.match(befehl, /show_address:\s+interaction\.options\.getBoolean\('adresse'\),/);
    for (const sprache of ['de-DE', 'en-GB']) {
        const t = JSON.parse(lies(`plugins/gameserver/bot/locales/${sprache}.json`)).SERVER.OPT_PANEL_ADDRESS;
        assert.ok(t && t.length <= 100, `${sprache}: Text fehlt oder länger als Discord erlaubt`);
    }
});

pruefe('Formular: Schalter vorbelegt an, in der Liste umschaltbar, schickt show_address', () => {
    const ejs = ohneKommentareEjs(lies('plugins/gameserver/dashboard/views/guild/partials/server-detail-panels.ejs'));
    assert.match(ejs, /id="panel-address" checked/);
    assert.match(ejs, /toggle\(p, 'show_address', 'Adresse'\)/);
    assert.match(ejs, /show_address:\s+document\.getElementById\('panel-address'\)\.checked/);
});

console.log(`\n${bestanden} Prüfungen bestanden.`);
