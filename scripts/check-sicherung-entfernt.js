#!/usr/bin/env node
/**
 * Von der Aufbewahrung entfernte Sicherungen (K350, 2026-11-12).
 *
 * Die Aufbewahrung löscht das Archiv beim Daemon und setzt nur `pruned_at`;
 * `status` bleibt 'completed' (Migration 2026-08-10: „sollen als solche
 * erkennbar bleiben, statt einfach zu verschwinden"). Bis zum 2026-11-12
 * standen diese Zeilen als „Fertig" mit Herunterladen und Wiederherstellen in
 * der Liste, die Übersichtskarte zählte sie zu den letzten fünf, und beide
 * Routen fragten erst den Daemon — gemessen an Server 186: 3 von 5.
 *
 * Geprüft: Die Routen weisen eine entfernte Sicherung mit 410 ab, ohne den
 * Daemon zu fragen; die Übersicht lässt sie aus; die Liste klappt sie ein und
 * bietet für sie weder Herunterladen noch Wiederherstellen an.
 *
 *   node scripts/check-sicherung-entfernt.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

const still = () => {};
ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });

const WURZEL = path.join(__dirname, '..');

// Eine Zeile, wie die Aufbewahrung sie hinterlässt: fertig, Archiv weg.
const ENTFERNT = {
    id: 139, name: 'Probe_cron_2026-10-01', status: 'completed', pruned_at: new Date('2026-10-03T01:01:43Z'),
    host: '127.0.0.1', fqdn: 'x', fqdn_gilt: 1, abruf_port: 1, api_key: 'k', abruf_zertifikat: 'z',
};
const abfragen = [];
ServiceManager.register('dbService', { async query(sql) { abfragen.push(String(sql)); return [ENTFERNT]; } });
let daemonGefragt = 0;
ServiceManager.register('ipmServer', {
    isDaemonOnline: () => true,
    sendCommand: async () => { daemonGefragt++; return { success: true }; },
});

const router = require(path.join(WURZEL, 'plugins/gameserver/dashboard/routes/servers.js'));
const handler = (pfad, methode) => router.stack
    .find(l => l.route && l.route.path === pfad && l.route.methods[methode]).route.stack.at(-1).handle;
const rufe = (h) => new Promise((fertig) => {
    const res = {
        locals: { guildId: 'g1' }, headersSent: false,
        status(c) { this.code = c; return this; },
        json(d) { fertig({ code: this.code || 200, d }); },
    };
    h({ params: { serverId: '186', backupId: '139' }, headers: {} }, res);
});

let bestanden = 0;
async function pruefe(name, fn) {
    abfragen.length = 0; daemonGefragt = 0;
    try { await fn(); console.log(`  ✓ ${name}`); bestanden++; }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

(async () => {
    console.log('\nEntfernte Sicherung (pruned_at gesetzt, status completed)');

    await pruefe('Herunterladen: 410 mit Grund, der Daemon wird nicht gefragt', async () => {
        const a = await rufe(handler('/:serverId/backups/:backupId/download', 'get'));
        assert.strictEqual(a.code, 410, JSON.stringify(a.d));
        assert.match(a.d.message, /Aufbewahrung/);
        assert.strictEqual(daemonGefragt, 0);
    });

    await pruefe('Wiederherstellen: 410 mit Grund, kein „restoring", der Daemon wird nicht gefragt', async () => {
        const a = await rufe(handler('/:serverId/backups/:backupId/restore', 'post'));
        assert.strictEqual(a.code, 410, JSON.stringify(a.d));
        assert.match(a.d.message, /Aufbewahrung/);
        assert.ok(!abfragen.some(s => /restoring/.test(s)), 'die Zeile wurde auf restoring gesetzt');
        assert.strictEqual(daemonGefragt, 0);
    });

    console.log('\nÜbersicht und Liste');
    const lies = (datei, ohne = ohneKommentare) => ohne(fs.readFileSync(path.join(WURZEL, datei), 'utf8'));
    const routen = lies('plugins/gameserver/dashboard/routes/servers.js');

    await pruefe('Die Übersichtskarte (letzte fünf) lässt entfernte aus', async () => {
        const m = /SELECT id, name, size_bytes, completed_at FROM gameserver_backups[\s\S]{0,300}?LIMIT 5/.exec(routen);
        assert.ok(m, 'Abfrage der letzten fünf nicht gefunden');
        assert.match(m[0], /pruned_at IS NULL/);
    });

    await pruefe('Die Liste klappt entfernte ein; Herunterladen und Wiederherstellen nur für vorhandene', async () => {
        const seite = lies('plugins/gameserver/dashboard/views/guild/partials/server-detail-backups.ejs', ohneKommentareEjs);
        assert.match(seite, /id="backups-entfernt"/);
        assert.match(seite, /CAN_DOWNLOAD && ABRUF_MOEGLICH && !entfernt && b\.status === 'completed'/);
        assert.match(seite, /CAN_RESTORE && !entfernt && b\.status === 'completed'/);
        assert.match(seite, /window\.zeigeEntfernteSicherungen/);
    });

    await pruefe('Löschdialog des Servers und Aufbewahrung zählen entfernte nicht mit', async () => {
        const aktionen = lies('plugins/gameserver/dashboard/assets/js/server-actions.js');
        assert.match(aktionen, /b\.status === 'completed' && !b\.pruned_at/);
        const cron = lies('plugins/gameserver/dashboard/helpers/CronWorker.js');
        assert.match(cron, /AND status = 'completed' AND pruned_at IS NULL/);
    });

    console.log(`\n${bestanden} Prüfung(en) bestanden.`);
    process.exit(process.exitCode || 0);
})();
