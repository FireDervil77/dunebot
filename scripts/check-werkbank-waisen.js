#!/usr/bin/env node
'use strict';

/**
 * Ein Werkbank-Schritt, den ein Daemon-Neustart verschluckte, bleibt nicht
 * mehr ewig auf „läuft" (Baustelle 199, 2026-10-16).
 *
 * „Cubic Odysey": Schritt begonnen 17:15:50, Daemon neu gestartet 17:16:21 —
 * der Container war weg, die Zeile stand auf `laeuft`, die Sitzung war
 * gesperrt. Seither meldet der Daemon beim Verbinden `schritte_aktiv` mit den
 * Sitzungen, in denen er gerade einen Schritt führt; Ereignisse.beiSchritteAktiv
 * schließt jeden anderen `laeuft`-Schritt seiner Maschinen ab.
 *
 * Geprüft an einer Attrappe (Datenbank, SSE) und am Daemon-Quelltext.
 *
 *   node scripts/check-werkbank-waisen.js
 */

const path = require('path');
const fs = require('fs');
const assert = require('assert');
const WURZEL = path.resolve(__dirname, '..');
const DAEMON = path.resolve(WURZEL, '../firebot_daemon');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare } = require('./lib/quelltext');

let welt;
function neueWelt(zeilen) {
    welt = { zeilen, beendet: [], gesendet: [], abfrage: null };
}
ServiceManager.register('dbService', {
    async query(sql, p) {
        const q = sql.replace(/\s+/g, ' ').trim();
        if (q.startsWith('SELECT x.id AS schrittId, s.kennung, s.guild_id AS guildId FROM werkbank_schritte x')) {
            welt.abfrage = { q, p };
            return welt.zeilen.filter(z => z.daemon === p[0]);
        }
        if (q.startsWith('UPDATE werkbank_schritte SET status = IF(')) {
            welt.beendet.push({ id: p[5], status: p[0], fehler: p[2] });
            return {};
        }
        throw new Error(`Attrappe kennt die Abfrage nicht: ${q.slice(0, 90)}`);
    },
});
ServiceManager.register('Logger', { info() {}, warn() {}, error() {}, debug() {} });
ServiceManager.register('sseManager', { broadcast: (g, ns, d) => welt.gesendet.push({ g, ns, d }) });

const E = require('../plugins/werkbank/dashboard/helpers/Ereignisse');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${e.message}`); }
}

(async () => {
    console.log('\nDashboard');

    await pruefe('Nach einem Neustart (leere Liste): der verwaiste Schritt wird abgeschlossen und der Browser erfährt es', async () => {
        neueWelt([{ schrittId: 126, kennung: 'wba266962627', guildId: 'g1', daemon: 'd54' }]);
        const n = await E.beiSchritteAktiv({ sitzungen: [] }, {}, { daemonId: 'd54' });
        assert.strictEqual(n, 1);
        assert.deepStrictEqual(welt.beendet.map(b => [b.id, b.status]), [[126, 'fehler']]);
        assert.match(welt.beendet[0].fehler, /führt diesen Schritt nicht mehr/);
        assert.deepStrictEqual(welt.gesendet.map(s => [s.g, s.d.action, s.d.sitzung_id]), [['g1', 'fehlgeschlagen', 'wba266962627']]);
    });

    await pruefe('Was der Daemon noch führt, bleibt laufen (Verbindungsabriss ohne Neustart)', async () => {
        neueWelt([{ schrittId: 7, kennung: 'wbaaaaaaaaaa', guildId: 'g1', daemon: 'd54' }]);
        assert.strictEqual(await E.beiSchritteAktiv({ sitzungen: ['wbaaaaaaaaaa'] }, {}, { daemonId: 'd54' }), 0);
        assert.strictEqual(welt.beendet.length, 0);
    });

    await pruefe('Nur die Maschinen DIESES Daemons, nur schon länger laufende Schritte', async () => {
        neueWelt([{ schrittId: 9, kennung: 'wbbbbbbbbbbb', guildId: 'g1', daemon: 'd55' }]);
        assert.strictEqual(await E.beiSchritteAktiv({ sitzungen: [] }, {}, { daemonId: 'd54' }), 0);
        assert.deepStrictEqual(welt.abfrage.p, ['d54']);
        assert.match(welt.abfrage.q, /WHERE r\.daemon_id = \? AND x\.status = 'laeuft'/);
        assert.match(welt.abfrage.q, /x\.begonnen_am < NOW\(\) - INTERVAL 30 SECOND/,
            'ein Schritt aus dem Augenblick des Verbindens würde mit abgeschlossen');
    });

    await pruefe('Ohne Daemon-Kennung oder ohne Liste (alter Daemon): nichts', async () => {
        neueWelt([{ schrittId: 1, kennung: 'wbcccccccccc', guildId: 'g1', daemon: 'd54' }]);
        assert.strictEqual(await E.beiSchritteAktiv({ sitzungen: [] }, {}, {}), 0);
        assert.strictEqual(await E.beiSchritteAktiv({}, {}, { daemonId: 'd54' }), 0);
        assert.strictEqual(welt.beendet.length, 0);
    });

    await pruefe('Angemeldet beim Event-Router', async () => {
        const q = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/werkbank/dashboard/helpers/Ereignisse.js'), 'utf8'));
        assert.match(q, /eventRouter\.register\(NS, 'schritte_aktiv', beiSchritteAktiv\)/);
    });

    console.log('\nDaemon');

    await pruefe('Er meldet schritte_aktiv beim Verbinden, aus der Volumesperre, ohne Prüfdurchläufe', async () => {
        const lies = (p) => ohneKommentare(fs.readFileSync(path.join(DAEMON, p), 'utf8'));
        assert.match(lies('pkg/protocol/messages.go'), /WerkbankSchritteAktiv = "schritte_aktiv"/);
        const wb = lies('internal/gameserver/werkbank.go');
        assert.match(wb, /for lauf := range m\.activeInstalls/);
        assert.match(wb, /istPruefKennung\(sitzung\)/);
        assert.match(lies('internal/websocket/client.go'), /WerkbankPruefresteAufraeumen\(\)[\s\S]{0,300}c\.serverManager\.WerkbankSchritteMelden\(\)/);
    });

    console.log(fehler ? `\n❌ ${fehler} Prüfung(en) fehlgeschlagen` : '\n✅ Verwaiste Werkbank-Schritte werden beim Verbinden abgeschlossen');
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
