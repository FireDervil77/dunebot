#!/usr/bin/env node
/**
 * Widget „Gameserver" auf dem Hauptdashboard (2026-10-25).
 *
 * Betreiber: „kann das gameserver plugin eventuell auch ein widget mitbringen,
 * das auf dem hauptdashboard anzeigt, welche server installiert sind?" —
 * Vorbild das RootServer-Widget des Masterservers.
 *
 *   Daten      dieselbe Aufbereitung wie die Übersicht (Serverliste.js →
 *              baueServerListe); die Route nimmt dieselbe Grundabfrage
 *   Rechte     nur mit GAMESERVER.VIEW, nur wenn das Plugin aktiv ist
 *   Anmeldung  _registerWidgets wird in onEnable gerufen (stand leer und
 *              ungerufen da) — und meldet den Filter nur einmal an
 *   Live       (2026-10-29) das Widget reiht `gameserver-live.js` ein und
 *              trägt dessen Haken; ein Statuswechsel zeichnet das Abzeichen
 *              aus der Beurteilung des Servers (`baueZustand`) — vorher
 *              änderte es sich erst nach dem Neuladen
 *
 * Gelesen wird aus der Datenbank, geschrieben nichts.
 *
 *   node scripts/check-gameserver-widget.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare } = require('./lib/quelltext');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 3).join('\n      ')}`); }
}
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), 'utf8');

(async () => {
    const c = await mysql.createConnection({ host: process.env.MYSQL_HOST, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE });
    const geschrieben = [];
    const still = () => {};
    ServiceManager.register('dbService', { query: async (s, p) => {
        if (!/^\s*SELECT/i.test(s)) { geschrieben.push(s.slice(0, 40)); return {}; }
        return (await c.query(s, p))[0];
    } });
    ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });
    let darf = true;
    ServiceManager.register('permissionManager', { hasPermission: async (u, g, k) => darf && k === 'GAMESERVER.VIEW' });
    const filter = [];
    ServiceManager.register('pluginManager', { hooks: { addFilter: (n, fn) => { if (n === 'guild_dashboard_widgets') filter.push(fn); } } });
    const eingereiht = [];
    ServiceManager.register('assetManager', { enqueueScript: (h) => { eingereiht.push(h); return true; } });
    ServiceManager.register('themeManager', { renderWidgetPartial: async (name, data) =>
        ejs.renderFile(path.join(WURZEL, 'plugins', data.plugin, 'dashboard/views/widgets', name + '.ejs'), data, { async: true }) });

    const Plugin = require('../plugins/gameserver/dashboard/index.js');
    const { ladeServerListe } = require('../plugins/gameserver/dashboard/helpers/Serverliste');
    const [guild] = (await c.query('SELECT guild_id, COUNT(*) n FROM gameservers GROUP BY guild_id ORDER BY n DESC LIMIT 1'))[0];
    const lauf = async (opt) => filter[0]([], { user: { info: { id: '1' } }, enabledPlugins: ['gameserver'], guildId: guild?.guild_id, ...opt });

    console.log('\nWidget „Gameserver"');

    await pruefe('onEnable ruft _registerWidgets; der Filter kommt nur einmal', async () => {
        assert.match(ohneKommentare(lies('plugins/gameserver/dashboard/index.js')), /this\._registerHooks\(\);\s*this\._registerWidgets\(\);/);
        Plugin.prototype._registerWidgets.call({});
        Plugin.prototype._registerWidgets.call({});
        assert.strictEqual(filter.length, 1);
    });

    await pruefe('dieselben Zahlen und Zustände wie die Übersicht', async () => {
        assert.ok(guild, 'keine Guild mit Gameservern — nichts zu vergleichen');
        const [w] = await lauf({});
        assert.ok(w && w.id === 'gameserver-uebersicht' && w.content);
        const { liste, zahlen } = await ladeServerListe(ServiceManager.get('dbService'), guild.guild_id);
        assert.ok(w.content.includes(`data-fb-live-summe="online">${zahlen.online}</strong> von <span data-fb-live-summe="alle">${zahlen.alle}</span> laufen`), 'Zähler weicht ab');
        for (const s of liste.slice(0, 8)) {
            assert.ok(w.content.includes(`/plugins/gameserver/servers/${s.id}"`), `Server ${s.id} fehlt`);
            assert.ok(w.content.includes(`>${s.zustand.text}</span>`), `Zustand von ${s.id} fehlt`);
        }
    });

    await pruefe('zieht live nach: Modul eingereiht, Haken je Server', async () => {
        eingereiht.length = 0;
        const [w] = await lauf({});
        assert.deepStrictEqual(eingereiht, ['gameserver-live'], 'Live-Modul nicht eingereiht');
        assert.ok(w.content.includes(`data-fb-live-guild="${guild.guild_id}"`), 'ohne data-fb-live-guild startet das Modul nicht');
        const { liste } = await ladeServerListe(ServiceManager.get('dbService'), guild.guild_id);
        for (const s of liste.slice(0, 8)) {
            for (const art of ['zustand-abzeichen', 'spieler-wenn']) {
                assert.ok(new RegExp(`data-fb-live="${art}" data-fb-server="${s.id}"`).test(w.content), `${art} fehlt an Server ${s.id}`);
            }
        }
        // Eine leere Guild hat nichts, das live werden könnte.
        eingereiht.length = 0;
        await lauf({ guildId: '1' });
        assert.deepStrictEqual(eingereiht, []);
    });

    await pruefe('Statuswechsel: Abzeichen und Spieler ohne Neuladen', async () => {
        const { LiveAnzeige } = require('../plugins/gameserver/dashboard/assets/js/gameserver-live.js');
        const { baueZustand } = require('../plugins/gameserver/dashboard/helpers/Serverseite');
        const abzeichen = { dataset: { fbLive: 'zustand-abzeichen' }, textContent: 'Aus', className: 'badge bg-secondary-lt' };
        const spieler = { dataset: { fbLive: 'spieler-wenn' }, textContent: '', hidden: true };
        global.CSS = { escape: String };
        global.document = { querySelectorAll: (sel) => sel.includes('data-fb-server="222"') ? [abzeichen, spieler] : [] };
        let status = 'offline';
        // So antwortet /servers/status: mit der Beurteilung aus baueZustand.
        global.fetch = async () => ({ ok: true, json: async () => ({ servers: [
            { id: 222, status, zustand: baueZustand({ status }), current_players: null, max_players: 8 }] }) });
        const hoerer = {};
        const sse = { on: (n, fn) => { (hoerer[n] = hoerer[n] || []).push(fn); } };
        const loese = (n, d) => (hoerer[n] || []).forEach(fn => fn(d));
        const ruhe = (ms) => new Promise(f => setTimeout(f, ms));

        new LiveAnzeige(sse, guild.guild_id);
        await ruhe(20);
        assert.strictEqual(abzeichen.textContent, 'Aus');

        status = 'online';
        loese('status_changed', { server_id: 222, status: 'online' });
        await ruhe(320);
        assert.strictEqual(abzeichen.textContent, 'Läuft', 'Abzeichen bleibt nach dem Statuswechsel stehen');
        assert.strictEqual(abzeichen.className, 'badge bg-success-lt');

        loese('resource_usage', { server_id: 222, current_players: 3, max_players: 8 });
        assert.strictEqual(spieler.hidden, false, 'Spielerzahl erscheint nicht');
        assert.strictEqual(spieler.textContent, '3 / 8');
        global.document = { querySelectorAll: () => [] };   // ausstehendes Zeichnen der Summen trifft nichts
    });

    await pruefe('ohne GAMESERVER.VIEW oder ohne aktives Plugin kein Widget', async () => {
        darf = false; assert.strictEqual((await lauf({})).length, 0); darf = true;
        assert.strictEqual((await lauf({ enabledPlugins: ['streaming'] })).length, 0);
        assert.strictEqual((await lauf({ user: null })).length, 0);
    });

    await pruefe('leere Guild: Hinweis mit Link zum Anlegen', async () => {
        const [w] = await lauf({ guildId: '1' });
        assert.match(w.content, /Noch kein Gameserver\.[\s\S]*\/plugins\/gameserver\/servers\/create/);
    });

    await pruefe('die Übersicht nimmt dieselbe Grundabfrage', async () => {
        const r = ohneKommentare(lies('plugins/gameserver/dashboard/routes/servers.js'));
        assert.match(r, /let query = SERVER_LISTE_SQL;/);
        assert.ok(!/FROM gameservers gs\s+LEFT JOIN addon_marketplace am ON gs\.addon_marketplace_id = am\.id\s+LEFT JOIN rootserver r ON gs\.rootserver_id = r\.id\s+WHERE gs\.guild_id = \?/.test(r),
            'die Abfrage der Liste steht wieder doppelt in der Route');
    });

    await pruefe('nichts geschrieben', async () => assert.deepStrictEqual(geschrieben, []));

    await c.end();
    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ Widget „Gameserver": dieselbe Liste wie die Übersicht, nur mit Recht');
    process.exit(fehler ? 1 : 0);
})();
