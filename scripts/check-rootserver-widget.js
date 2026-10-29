#!/usr/bin/env node
/**
 * Widget „RootServer" auf dem Hauptdashboard (Baustelle 207, 2026-10-28).
 *
 * Teil 1: Das Widget prüfte `rs.status` — die Spalte gibt es seit der Migration
 * `20260801_120000_drop_rootserver_status` nicht mehr, sie heißt
 * `daemon_status`; das Abzeichen stand immer auf „Offline".
 * Teil 2 (Betreiber: „JAP!"): Es zieht live nach. Der Herzschlag des Daemons
 * (alle 30 s) schickt in `host_stats` eine fertig gerechnete `anzeige` mit
 * (`helpers/Auslastung`), eine Trennung schickt `anzeige.online = false`; das
 * Skript im Widget zeichnet nur.
 * Teil 3 (Betreiber 2026-10-29: „3 Sekunden … nur senden, wenn jemand die
 * Daten haben möchte"): Der Daemon schickt `system:stats` alle 3 s, solange
 * das Dashboard es mit `system.messwerte` {sekunden} bestellt hat
 * (helpers/Messwertbestellung, Daemon internal/websocket/hostmesswerte.go).
 *
 *   Felder    jedes `rs.<feld>` im Widget ist eine Spalte von `rootserver`
 *   Zustand   gerendert mit den echten Zeilen: Abzeichen und Balken = Auslastung
 *   Rechnung  Zeile (DECIMAL als Text) und Messwerte ergeben dieselbe Anzeige
 *   Strom     Herzschlag und Live-Takt gehen durch _sendeHostStats (ein Format,
 *             mit `anzeige`); beide Offline-Wege melden sich
 *   Bestellung nur für Guilds mit Zuschauern, nur deren Daemons; Detailseite nur
 *             ihren; Ablehnung (alter Daemon) einmal gemeldet
 *   Vertrag   Befehl, Ereignis und Frist gleich auf beiden Seiten (Go-Quelle gelesen)
 *   Recht     der Filter liefert das Widget nur mit MASTERSERVER.ROOTSERVER.VIEW
 *             (wie das Gameserver-Widget mit GAMESERVER.VIEW, Betreiber 2026-10-29)
 *   Skript    ausgeführt (vm, Attrappe wirft bei unbekannten Selektoren):
 *             zeichnet online, offline, fremden Daemon nicht
 *
 * Gelesen wird aus der Datenbank, geschrieben nichts.
 *
 *   node scripts/check-rootserver-widget.js
 *   WIDGET_DATEI=/pfad/zu/kopie.ejs node scripts/check-rootserver-widget.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ejs = require('ejs');
const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');
const Auslastung = require('../plugins/masterserver/dashboard/helpers/Auslastung');

const WIDGET = process.env.WIDGET_DATEI || path.join(WURZEL, 'plugins/masterserver/dashboard/views/widgets/rootserver-status.ejs');
const ZAEHLSPALTEN = ['gameserver_count', 'gameserver_running_count'];

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 3).join('\n      ')}`); }
}

const quelle = fs.readFileSync(WIDGET, 'utf8');
const zeichne = (rootservers) => ejs.render(quelle,
    { guildId: 'g1', rootservers, auslastung: Auslastung.ausZeile }, { filename: WIDGET });
const abzeichen = (html) => [...html.matchAll(/data-rs-badge>\s*(Online|Offline)\s*</g)].map(m => m[1]);
const texte = (html) => [...html.matchAll(/data-rs-text>([^<]*)</g)].map(m => m[1]);

/** Ein Block, wie das Widget ihn zeichnet — nur die Haken, die das Skript anfasst. */
function attrappenBlock(daemonId) {
    const el = (extra = {}) => ({ className: '', textContent: '', style: {}, ...extra });
    const zeilen = {};
    for (const art of ['cpu', 'ram', 'disk']) {
        const balken = el({ className: 'progress-bar bg-x', style: { width: '0%' } });
        const text = el({ textContent: '–' });
        zeilen[art] = { balken, text, querySelector: (s) => {
            if (s === '.progress-bar') return balken;
            if (s === '[data-rs-text]') return text;
            throw new Error(`unbekannter Selektor in der Zeile: ${s}`);
        } };
    }
    const badge = el({ className: 'badge bg-secondary-lt', textContent: 'Offline' });
    return { dataset: { rsDaemon: daemonId }, badge, zeilen, querySelector: (s) => {
        if (s === '[data-rs-badge]') return badge;
        const m = s.match(/^\[data-rs-balken="(cpu|ram|disk)"\]$/);
        if (m) return zeilen[m[1]];
        throw new Error(`unbekannter Selektor im Block: ${s}`);
    } };
}

(async () => {
    const c = await mysql.createConnection({ host: process.env.MYSQL_HOST, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE });
    ServiceManager.register('dbService', {
        query: async (s, p) => {
            if (!/^\s*SELECT/i.test(s)) throw new Error('Wächter schreibt nicht: ' + s.slice(0, 40));
            return (await c.query(s, p))[0];
        },
        tableExists: async (t) => (await c.query('SHOW TABLES LIKE ?', [t]))[0].length > 0,
    });
    const RootServer = require('../plugins/masterserver/dashboard/models/RootServer');

    console.log('\nWidget „RootServer"');

    await pruefe('jedes rs.<feld> im Widget ist eine Spalte von rootserver', async () => {
        const spalten = (await c.query('SHOW COLUMNS FROM rootserver'))[0].map(z => z.Field);
        const benutzt = [...new Set([...ohneKommentareEjs(quelle).matchAll(/\brs\.([a-z_]+)/g)].map(m => m[1]))];
        const geraten = benutzt.filter(f => !spalten.includes(f) && !ZAEHLSPALTEN.includes(f));
        assert.deepStrictEqual(geraten, [], `keine Spalte: ${geraten.join(', ')}`);
    });

    await pruefe('mit den echten Zeilen: Abzeichen und Balken sind die Rechnung aus Auslastung', async () => {
        const [g] = (await c.query('SELECT guild_id FROM rootserver GROUP BY guild_id ORDER BY COUNT(*) DESC LIMIT 1'))[0];
        assert.ok(g, 'kein RootServer in der Datenbank — nichts zu vergleichen');
        const zeilen = await RootServer.getByGuild(g.guild_id);
        const html = zeichne(zeilen);
        const soll = zeilen.map(Auslastung.ausZeile);
        assert.deepStrictEqual(abzeichen(html), soll.map(a => a.online ? 'Online' : 'Offline'));
        assert.deepStrictEqual(texte(html), soll.flatMap(a => [a.cpu.text, a.ram.text, a.disk.text]));
        for (const z of zeilen) assert.ok(html.includes(`data-rs-daemon="${z.daemon_id}"`), `Haken für ${z.daemon_id} fehlt`);
    });

    await pruefe('Gegenprobe: online und offline unterscheiden sich im Abzeichen', async () => {
        assert.deepStrictEqual(abzeichen(zeichne([{ id: 1, name: 'a', daemon_id: 'a', daemon_status: 'online' },
            { id: 2, name: 'b', daemon_id: 'b', daemon_status: 'offline' }])), ['Online', 'Offline']);
    });

    await pruefe('eine Rechnung: Zeile (DECIMAL als Text) und Messwerte ergeben dieselbe Anzeige', async () => {
        const ausZeile = Auslastung.ausZeile({ daemon_status: 'online', cpu_usage_percent: '81.4',
            ram_usage_gb: '6.50', ram_total_gb: '10.00', disk_usage_gb: '20', disk_total_gb: '200' });
        const ausMesswert = Auslastung.baue({ online: true, cpu_percent: 81.4, ram_used_gb: 6.5, ram_total_gb: 10,
            disk_used_gb: 20, disk_total_gb: 200 });
        assert.deepStrictEqual(ausZeile, ausMesswert);
        assert.deepStrictEqual([ausZeile.cpu.farbe, ausZeile.ram.farbe, ausZeile.disk.farbe], ['danger', 'warning', 'primary']);
    });

    await pruefe('IPMServer: Herzschlag und Live-Takt durch _sendeHostStats, beide Offline-Wege melden sich', async () => {
        const ipm = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'apps/dashboard/helpers/IPMServer.js'), 'utf8'));
        assert.match(ipm, /this\._sendeHostStats\(conn\.metadata\.guild_id, daemonId,/, 'Herzschlag geht nicht durch _sendeHostStats');
        assert.match(ipm, /eventRouter\.register\('system', 'stats',[\s\S]{0,200}?this\._sendeHostStats\(context\.guildId, context\.daemonId,/,
            'system:stats wird nicht an den Browser gereicht');
        assert.strictEqual((ipm.match(/action: 'host_stats'/g) || []).length, 2, 'host_stats wird an mehr als zwei Stellen gebaut — zweites Format?');

        // Verhalten: das gesendete Format
        if (!ServiceManager.has('Logger')) {
            const still = () => {};
            ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });
        }
        const IPMServer = require('../apps/dashboard/helpers/IPMServer');
        const gesendet = [];
        ServiceManager.register('sseManager', { broadcast: (g, ns, d) => gesendet.push({ g, ns, d }) });
        IPMServer.prototype._sendeHostStats.call({}, 'g1', 'd1',
            { cpu_percent: 50, ram_used_gb: 2, ram_total_gb: 8, disk_used_gb: 1, disk_total_gb: 10 });
        assert.strictEqual(gesendet.length, 1);
        assert.strictEqual(gesendet[0].ns, 'metrics');
        assert.strictEqual(gesendet[0].d.action, 'host_stats');
        assert.strictEqual(gesendet[0].d.cpu_percent, 50, 'Rohwert für die Detailseite fehlt');
        assert.deepStrictEqual(gesendet[0].d.anzeige.ram, { pct: 25, farbe: 'info', text: '25%' });
        IPMServer.prototype._sendeHostStats.call({}, null, 'd1', {});
        assert.strictEqual(gesendet.length, 1, 'ohne Guild gesendet');
        const offline = ipm.match(/RootServer\.markOffline\(daemonId\)[\s\S]{0,300}?this\._meldeHostOffline\(daemonId,/g) || [];
        const alle = ipm.match(/RootServer\.markOffline\(daemonId\)/g) || [];
        assert.strictEqual(offline.length, alle.length, `${alle.length} markOffline, ${offline.length} davon melden es dem Browser`);
        assert.ok(alle.length >= 2);
    });

    const skript = (() => {
        const m = zeichne([{ id: 1, name: 'a', daemon_id: 'a', daemon_status: 'offline' }]).match(/<script>([\s\S]*?)<\/script>/);
        return m && m[1];
    })();

    await pruefe('der Filter: nur mit MASTERSERVER.ROOTSERVER.VIEW, nur bei aktivem Plugin — dann mit Strom', async () => {
        const still = () => {};
        ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: (m, e) => { throw e || new Error(m); }, success: still });
        let darf = true;
        ServiceManager.register('permissionManager', { hasPermission: async (u, g, k) => darf && k === 'MASTERSERVER.ROOTSERVER.VIEW' });
        const filter = [];
        ServiceManager.register('pluginManager', { hooks: { addFilter: (n, fn) => { if (n === 'guild_dashboard_widgets') filter.push(fn); } } });
        ServiceManager.register('themeManager', { renderWidgetPartial: async (name, data) => ejs.renderFile(WIDGET, data, { async: true }) });
        const Plugin = require('../plugins/masterserver/dashboard/index.js');
        Plugin.prototype._registerWidgets.call({});
        assert.strictEqual(filter.length, 1);
        const [g] = (await c.query('SELECT guild_id FROM rootserver GROUP BY guild_id ORDER BY COUNT(*) DESC LIMIT 1'))[0];
        const lauf = (opt) => filter[0]([], { user: { info: { id: '1' } }, enabledPlugins: ['masterserver'], guildId: g.guild_id, ...opt });

        const [w] = await lauf({});
        assert.ok(w && w.id === 'masterserver-rootserver-status' && w.content, 'mit Recht kein Widget');
        assert.ok(w.content.includes(`data-rs-strom="/guild/${g.guild_id}/plugins/masterserver/rootservers/events"`));
        assert.ok(w.content.includes('<script>'));
        darf = false; assert.strictEqual((await lauf({})).length, 0, 'ohne Recht trotzdem ein Widget'); darf = true;
        assert.strictEqual((await lauf({ user: null })).length, 0, 'ohne Anmeldung ein Widget');
        assert.strictEqual((await lauf({ enabledPlugins: ['gameserver'] })).length, 0, 'ohne aktives Plugin ein Widget');
    });

    await pruefe('Skript ausgeführt: zeichnet online und offline, fremden Daemon nicht', async () => {
        const a = attrappenBlock('a'), b = attrappenBlock('b');
        const widget = { dataset: { rsStrom: '/strom' }, querySelectorAll: (s) => {
            if (s === '[data-rs-daemon]') return [a, b];
            throw new Error(`unbekannter Selektor im Widget: ${s}`);
        } };
        const stroeme = [];
        class EventSource {
            constructor(url) { this.url = url; this.hoerer = {}; this.readyState = 1; stroeme.push(this); }
            addEventListener(n, f) { this.hoerer[n] = f; }
        }
        EventSource.CLOSED = 2;
        vm.runInNewContext(skript, { EventSource, setTimeout: () => {}, document: { querySelector: (s) => {
            if (s === '[data-rs-widget][data-rs-strom]') return widget;
            throw new Error(`unbekannter Selektor im Dokument: ${s}`);
        } } });
        assert.strictEqual(stroeme.length, 1);
        assert.strictEqual(stroeme[0].url, '/strom');
        const sende = (d) => stroeme[0].hoerer.metrics({ data: JSON.stringify(d) });

        const anzeige = Auslastung.baue({ online: true, cpu_percent: 85, ram_used_gb: 1, ram_total_gb: 4, disk_used_gb: 95, disk_total_gb: 100 });
        sende({ action: 'host_stats', daemon_id: 'a', anzeige });
        assert.strictEqual(a.badge.textContent, 'Online');
        assert.strictEqual(a.badge.className, 'badge bg-success-lt');
        assert.deepStrictEqual(['cpu', 'ram', 'disk'].map(k => [a.zeilen[k].balken.className, a.zeilen[k].balken.style.width, a.zeilen[k].text.textContent]),
            [['progress-bar bg-danger', '85%', '85%'], ['progress-bar bg-info', '25%', '25%'], ['progress-bar bg-danger', '95%', '95%']]);
        assert.strictEqual(b.badge.textContent, 'Offline', 'fremder Daemon wurde gezeichnet');

        sende({ action: 'host_stats', daemon_id: 'a', anzeige: { online: false } });
        assert.strictEqual(a.badge.textContent, 'Offline');
        assert.strictEqual(a.zeilen.cpu.text.textContent, '85%', 'offline löscht die letzten Messwerte nicht');

        sende({ action: 'server_stats', server_id: 1 });   // andere Nachricht im selben Strom
        sende({ action: 'host_stats', daemon_id: 'a', cpu_percent: 1 });   // altes Format ohne anzeige
        assert.strictEqual(a.zeilen.cpu.text.textContent, '85%');
    });

    console.log('\nLive-Takt auf Bestellung');
    const Bestellung = require('../plugins/masterserver/dashboard/helpers/Messwertbestellung');

    await pruefe('Vertrag mit dem Daemon: Befehl, Ereignis und Frist auf beiden Seiten gleich', async () => {
        const DAEMON = process.env.DAEMON_WURZEL || path.join(WURZEL, '../firebot_daemon');
        const go = fs.readFileSync(path.join(DAEMON, 'internal/websocket/hostmesswerte.go'), 'utf8');
        const proto = fs.readFileSync(path.join(DAEMON, 'pkg/protocol/messages.go'), 'utf8');
        assert.match(go, new RegExp(`hostMesswertBefehl\\s*=\\s*"${Bestellung.BEFEHL.replace('.', '\\.')}"`), 'Befehlsname weicht ab');
        assert.match(go, /protocol\.NewEvent\(protocol\.NSSystem, protocol\.SystemStats,/);
        assert.match(proto, /NSSystem Namespace = "system"/);
        assert.match(proto, /SystemStats\s*= "stats"/);
        const hoechst = Number((go.match(/hostMesswertHoechst\s*=\s*(\d+) \* time\.Second/) || [])[1]);
        assert.ok(Bestellung.FRIST_SEK <= hoechst, `Frist ${Bestellung.FRIST_SEK} s > Höchstfrist des Daemons ${hoechst} s`);
        assert.ok(Bestellung.FRIST_SEK * 1000 >= 2 * Bestellung.TAKT_MS, 'Frist kürzer als zwei Erneuerungen — Lücken beim Zusehen');
    });

    await pruefe('gewünscht: Widget will alle Daemons der Guild, Detailseite nur ihren, fremde Quellen nichts', async () => {
        const z = [
            { guildId: 'g1', metadata: { source: 'masterserver', daemonId: null } },
            { guildId: 'g2', metadata: { source: 'masterserver', daemonId: 'x' } },
            { guildId: 'g3', metadata: { source: 'gameserver' } },
        ];
        assert.deepStrictEqual(Bestellung.gewuenscht(z, 'g1'), { alle: true, daemons: new Set() });
        assert.deepStrictEqual(Bestellung.gewuenscht(z, 'g2'), { alle: false, daemons: new Set(['x']) });
        assert.deepStrictEqual(Bestellung.gewuenscht(z, 'g3'), { alle: false, daemons: new Set() });
    });

    await pruefe('bestellt wird nur bei Zuschauern, nur an deren Daemons; Ablehnung einmal gemeldet', async () => {
        const befehle = [];
        let lehneAb = false;
        const meldungen = [];
        const still = () => {};
        ServiceManager.register('Logger', { debug: still, warn: still, error: still, success: still, info: (m) => meldungen.push(m) });
        ServiceManager.register('ipmServer', {
            connections: new Map([['d1', { metadata: { guild_id: 'g1' } }], ['d2', { metadata: { guild_id: 'g1' } }],
                ['d9', { metadata: { guild_id: 'g9' } }]]),
            sendCommand: async (id, befehl, nutzlast) => { befehle.push([id, befehl, nutzlast.sekunden]); if (lehneAb) throw new Error('unknown action'); return {}; },
        });
        let zuschauer = [];
        ServiceManager.register('sseManager', { getClientInfo: () => zuschauer });
        const warte = () => new Promise(r => setImmediate(r));

        Bestellung.runde(); await warte();
        assert.deepStrictEqual(befehle, [], 'ohne Zuschauer bestellt');

        zuschauer = [{ guildId: 'g1', metadata: { source: 'masterserver', daemonId: 'd2' } }];
        Bestellung.runde(); await warte();
        assert.deepStrictEqual(befehle, [['d2', Bestellung.BEFEHL, Bestellung.FRIST_SEK]], 'Detailseite: nur ihr Daemon');

        befehle.length = 0;
        zuschauer = [{ guildId: 'g1', metadata: { source: 'masterserver' } }];
        Bestellung.runde(); await warte();
        assert.deepStrictEqual(befehle.map(b => b[0]).sort(), ['d1', 'd2'], 'Widget: alle der Guild, keine fremden');

        lehneAb = true;
        Bestellung.runde(); await warte();
        Bestellung.runde(); await warte();
        assert.strictEqual(meldungen.filter(m => /d1 liefert keine Live-Messwerte/.test(m)).length, 1, 'Ablehnung nicht genau einmal gemeldet');
    });

    await pruefe('die SSE-Route bestellt beim Verbinden', async () => {
        const r = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/masterserver/dashboard/routes/rootserver.router.js'), 'utf8'));
        const ab = r.indexOf("router.get('/events'");
        assert.ok(ab >= 0);
        const route = r.slice(ab, r.indexOf('router.', ab + 20));
        assert.match(route, /sseManager\.addClient\([\s\S]*Messwertbestellung'\)\.zuschauerDa\(guildId\)/);
    });

    await c.end();
    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✓ alles grün');
    process.exit(fehler ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
