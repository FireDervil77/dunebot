#!/usr/bin/env node
/**
 * CPU je Gameserver in Kernen, gegen die eigene Buchung (Baustelle 211, 2026-10-29).
 *
 * Der Daemon misst seit 1.0.153 wie `docker stats` (100 = ein Kern). Vorher
 * kam unter cgroup v2 der Anteil an der ganzen Maschine an (÷ 8), und die
 * Anzeige zeigte die rohe Zahl: Valheim mit 0,1 gebuchtem Kern lief am
 * Anschlag und stand grün bei 1,3 %.
 *
 *   Rechnung   baueCpu: „2,6 von 8 Kernen", Balken = Anteil an der Buchung,
 *              gekappt bei 100; ohne Buchung nur Kerne, kein Balken
 *   Wege       Messstreifen (baueMesswerte), Kennzahl der Übersicht und der
 *              3-s-Push (_handleResourceUsage) sagen denselben Satz
 *   Abfragen   Liste, Serverseite und /status holen allocated_cpu_percent —
 *              ohne die Spalte fiele jeder Streifen stumm auf „ohne Buchung"
 *   Spalte     die Migration auf DECIMAL(6,2), sonst wirft der Herzschlag ab
 *              zehn Kernen im Strict-Modus
 *
 * Liest nur Dateien, keine Datenbank.
 *
 *   node scripts/check-cpu-kerne.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const WURZEL = path.join(__dirname, '..');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare } = require('./lib/quelltext');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 3).join('\n      ')}`); }
}
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), 'utf8');

(async () => {
    const S = require('../plugins/gameserver/dashboard/helpers/Serverseite');
    const laufend = (cpu, gebucht) => S.baueMesswerte({
        status: 'online', last_heartbeat: new Date(), cpu_percent: cpu, allocated_cpu_percent: gebucht,
        ram_used_mb: null, ram_total_mb: null,
    }).cpu;

    console.log('\nCPU in Kernen (Baustelle 211)');

    await pruefe('Kerne gegen die Buchung, Balken gekappt bei 100', async () => {
        assert.deepStrictEqual(
            (({ prozent, text, ton }) => ({ prozent, text, ton }))(S.baueCpu(260, 800)),
            { prozent: 32.5, text: '2,6 von 8 Kernen', ton: 'gruen' });
        // Der Fall aus dem Befund: 0,1 Kern gebucht, am Anschlag.
        assert.strictEqual(S.baueCpu(10, 10).text, '0,1 von 0,1 Kernen');
        assert.strictEqual(S.baueCpu(10, 10).ton, 'rot');
        assert.strictEqual(S.baueCpu(850, 800).prozent, 100);
        assert.strictEqual(S.baueCpu(100, 100).text, '1 von 1 Kern');
        assert.strictEqual(S.baueCpu(5, 800).text, '0,05 von 8 Kernen');
    });

    await pruefe('Fuß „x % der Buchung" vom Server, live gezeichnet', async () => {
        assert.strictEqual(S.baueCpu(24, 800).fuss, '3 % der Buchung');
        assert.strictEqual(S.baueCpu(24, null).fuss, 'keine Grenze gebucht');
        const v = lies('plugins/gameserver/dashboard/views/guild/server-detail.ejs');
        assert.ok(!/100 % ist ein Kern/.test(v), 'der alte Fuß steht noch da');
        assert.match(v, /data-fb-live="messfuss-cpu" data-fb-server="<%= server.id %>"><%= mw\.cpu \? mw\.cpu\.fuss/);
        assert.match(v, /data-fb-live="messfuss-ram" data-fb-server="<%= server.id %>"><%= mw\.ram \? mw\.ram\.fuss/);
        const { LiveAnzeige } = require('../plugins/gameserver/dashboard/assets/js/gameserver-live.js');
        const fuss = { dataset: { fbLive: 'messfuss-cpu' }, textContent: '' };
        global.CSS = { escape: String };
        global.document = { querySelectorAll: (sel) => sel.includes('"7"') ? [fuss] : [] };
        global.fetch = async () => ({ ok: false });
        const a = new LiveAnzeige({ on: () => {} }, '1');
        a.uebernimm(7, { messwerte: { frisch: true, cpu: S.baueCpu(400, 800) } }, true);
        assert.strictEqual(fuss.textContent, '50 % der Buchung');
        global.document = { querySelectorAll: () => [] };
    });

    await pruefe('ohne Buchung: Kerne, kein Balken', async () => {
        const c = S.baueCpu(250, null);
        assert.strictEqual(c.text, '2,5 Kerne');
        assert.strictEqual(c.prozent, null);
        assert.strictEqual(S.baueCpu(null, 800), null);
    });

    await pruefe('DECIMAL als Text („12.50") rechnet wie eine Zahl', async () => {
        assert.strictEqual(laufend('260.00', '800').text, '2,6 von 8 Kernen');
    });

    await pruefe('Kennzahl der Übersicht sagt denselben Satz wie der Streifen', async () => {
        const q = ohneKommentare(lies('plugins/gameserver/dashboard/helpers/Serverseite.js'));
        const kennzahlen = q.slice(q.indexOf('function baueKennzahlen'), q.indexOf('function baueCpu'));
        assert.match(kennzahlen, /cpuText = .*baueCpu\(cpu, zahlOderNull\(server\.allocated_cpu_percent\)\)\.text/);
        const vorlage = lies('plugins/gameserver/dashboard/views/guild/partials/server-detail-uebersicht.ejs');
        assert.ok(/u\.kennzahlen\.cpuText/.test(vorlage), 'die Übersicht zeigt cpuText nicht');
        assert.ok(!/kennzahlen\.cpu\.toFixed/.test(vorlage), 'die Übersicht formatiert die CPU wieder selbst');
    });

    await pruefe('3-s-Push: dieselbe Rechnung mit der Buchung aus der Datenbank, gemerkt', async () => {
        const abfragen = [];
        ServiceManager.register('dbService', { query: async (sql, p) => { abfragen.push(p); return [{ allocated_cpu_percent: 800 }]; } });
        const still = () => {};
        ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still });
        const gesendet = [];
        ServiceManager.register('sseManager', { broadcast: (g, art, d) => gesendet.push(d) });
        const Plugin = require('../plugins/gameserver/dashboard/index.js');
        Plugin._cpuBuchungen = new Map();
        const p = Object.create(Plugin.prototype);
        await p._handleResourceUsage({ server_id: 222, cpu: 260, ram: 1000, ram_total: 16000 }, {}, { guildId: '1' });
        await p._handleResourceUsage({ server_id: 222, cpu: 520, ram: 1000, ram_total: 16000 }, {}, { guildId: '1' });
        assert.strictEqual(gesendet.length, 2);
        assert.strictEqual(gesendet[0].messwerte.cpu.text, '2,6 von 8 Kernen');
        assert.strictEqual(gesendet[1].messwerte.cpu.prozent, 65);
        assert.strictEqual(abfragen.length, 1, `je Push eine Abfrage (${abfragen.length}) — der Merker greift nicht`);
    });

    await pruefe('Liste, Serverseite und /status holen die Buchung', async () => {
        const liste = ohneKommentare(lies('plugins/gameserver/dashboard/helpers/Serverliste.js'));
        assert.ok(/gs\.allocated_cpu_percent/.test(liste), 'Serverliste.js');
        const r = ohneKommentare(lies('plugins/gameserver/dashboard/routes/servers.js'));
        const detail = r.slice(r.indexOf("router.get('/:serverId', requirePermission('GAMESERVER.VIEW')"));
        assert.ok(/gs\.allocated_cpu_percent/.test(detail.slice(0, detail.indexOf("FROM gameservers gs"))), "Serverseite");
        const status = r.slice(r.indexOf("router.get('/status'"));
        assert.ok(/allocated_cpu_percent/.test(status.slice(0, status.indexOf('FROM gameservers'))), '/status');
    });

    await pruefe('Spalte: Migration auf DECIMAL(6,2), nach der, die sie anlegt', async () => {
        const ordner = path.join(WURZEL, 'plugins/masterserver/migrations');
        const dateien = fs.readdirSync(ordner).sort();
        const neu = dateien.indexOf('20261029_100000_cpu_messung_in_kernen.js');
        assert.ok(neu >= 0, 'Migration fehlt');
        // 20260921_180000 legt die Spalte an (Name ohne das alte Tabellenwort,
        // das check-platzgrenze im Code nicht mehr sehen will).
        const anlage = dateien.findIndex(d => d.startsWith('20260921_180000_'));
        assert.ok(anlage >= 0 && neu > anlage, 'läuft vor der, die die Spalte anlegt');
        assert.match(ohneKommentare(fs.readFileSync(path.join(ordner, dateien[neu]), 'utf8')), /MODIFY COLUMN cpu_percent DECIMAL\(6,2\)/);
    });

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ CPU in Kernen gegen die eigene Buchung, auf allen Wegen');
    process.exit(fehler ? 1 : 0);
})();
