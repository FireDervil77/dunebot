#!/usr/bin/env node
/**
 * Proben-Karenz je Ziel (Baustelle 71, Betreiber 2026-10-29: F14).
 *
 * Proben laufen durch dieselbe Ausgangsschlange wie echte Ankündigungen aller
 * Guilds. Eine Probe je Ziel alle 30 s; gezählt wird in der Schlange selbst.
 *
 *   Modell   probeVormerken: innerhalb von 30 s nach der letzten Probe des
 *            Ziels kein Eintrag, dafür die verbleibenden Sekunden; sonst Eintrag
 *   Route    meldet die Karenz als Warnung (Schlüssel `karenz`), nicht als Fehler
 *   Seite    kennt den Schlüssel `karenz` für den Weg ohne JavaScript
 *
 *   node scripts/check-streaming-probe-karenz.js
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
    let her = null;
    const eingetragen = [];
    const unbekannt = [];
    ServiceManager.register('dbService', { query: async (sql, p) => {
        if (/SELECT TIMESTAMPDIFF\(SECOND, MAX\(angelegt_am\), NOW\(3\)\) AS her\s+FROM streaming_outbox\s+WHERE target_id = \? AND aktion = 'probe'/.test(sql)) return [{ her }];
        if (/INSERT INTO streaming_outbox \(target_id, guild_id, aktion, nutzlast, zustand\)\s+VALUES \(\?, \?, 'probe', \?, 'offen'\)/.test(sql)) { eingetragen.push(p); return { affectedRows: 1 }; }
        unbekannt.push(sql.trim().slice(0, 60));
        return [];
    } });
    const still = () => {};
    ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still });
    const modelle = require('../plugins/streaming/shared/models');

    console.log('\nProben-Karenz (B71)');

    await pruefe('erste Probe des Ziels wird eingetragen', async () => {
        her = null; eingetragen.length = 0;
        assert.deepStrictEqual(await modelle.probeVormerken('g1', 5, false, 'live'), { vorgemerkt: true, nochSek: 0 });
        assert.strictEqual(eingetragen.length, 1);
        assert.deepStrictEqual(eingetragen[0].slice(0, 2), [5, 'g1']);
    });

    await pruefe('10 s nach der letzten: kein Eintrag, noch 20 s', async () => {
        her = 10; eingetragen.length = 0;
        assert.deepStrictEqual(await modelle.probeVormerken('g1', 5), { vorgemerkt: false, nochSek: 20 });
        assert.strictEqual(eingetragen.length, 0, 'trotz Karenz eingetragen');
    });

    await pruefe('nach 30 s geht die nächste', async () => {
        her = 30; eingetragen.length = 0;
        assert.strictEqual((await modelle.probeVormerken('g1', 5)).vorgemerkt, true);
        assert.strictEqual(modelle.PROBE_KARENZ_SEK, 30);
        assert.deepStrictEqual(unbekannt, [], `unbekannte Abfragen: ${unbekannt.join(' | ')}`);
    });

    await pruefe('Route meldet die Karenz als Warnung, Seite kennt den Schlüssel', async () => {
        const r = ohneKommentare(lies('plugins/streaming/dashboard/routes/guild.router.js'));
        const route = r.slice(r.indexOf("router.post('/ziele/:id/probe'"), r.indexOf("router.post('/ziele/:id/probe'") + 3000);
        assert.match(route, /if \(!probe\.vorgemerkt\) \{[\s\S]*?fehler: 'karenz', art: 'warning'/);
        assert.match(lies('plugins/streaming/dashboard/views/guild/streaming-ziele.ejs'), /karenz:\s+'Eben lief schon eine Probe/);
    });

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ Proben-Karenz: eine je Ziel alle 30 s');
    process.exit(fehler ? 1 : 0);
})();
