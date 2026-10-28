#!/usr/bin/env node
/**
 * Stufe 11 S6 (2026-10-28): Die Sicherung nimmt die Datenbank mit, die
 * Wiederherstellung setzt sie zurück — die Dashboard-Hälfte.
 *
 * Der Daemon legt die Dumps ins Archiv und spielt sie ein (Tests dort:
 * gameserver/backup_datenbank_test.go, datenbank/echt_test.go). Hier wird
 * geprüft, dass beide Sicherungswege (von Hand, Cronjob) und die
 * Wiederherstellung ihm die Nummern nennen, und dass das Ergebnis — auch ein
 * Fehlschlag — in der Zeile steht, wo man es sieht.
 *
 *   node scripts/check-sicherung-datenbank.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { ServiceManager } = require('dunebot-core');
const still = () => {};
ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });

const WURZEL = path.join(__dirname, '..');

// ── Attrappen ───────────────────────────────────────────────────────────────
const db = {
    datenbanken: [],          // gameserver_datenbanken: nr
    backups: [],              // gameserver_backups
    async query(sql, p) {
        if (/SELECT nr FROM gameserver_datenbanken WHERE server_id = \? ORDER BY nr/.test(sql)) {
            return this.datenbanken.map(nr => ({ nr }));
        }
        if (/SELECT id, name, install_path FROM gameservers WHERE id = \? AND guild_id = \?/.test(sql)) {
            return [{ id: 7, name: 'Probe', install_path: '7-probe' }];
        }
        if (/SELECT daemon_id FROM rootserver r JOIN gameservers/.test(sql)) return [{ daemon_id: 'd1' }];
        if (/INSERT INTO gameserver_backups/.test(sql)) {
            const id = this.backups.length + 1;
            this.backups.push({ id, name: p[2], status: 'pending' });
            return { insertId: id };
        }
        if (/UPDATE gameserver_backups SET status = 'running'/.test(sql)) return {};
        if (/UPDATE gameserver_backups SET status = 'restoring'/.test(sql)) return {};
        if (/UPDATE gameserver_backups SET status = 'completed', size_bytes = \?, datenbanken = \?/.test(sql)) {
            Object.assign(this.backups.find(b => b.id === p[2]), { status: 'completed', size_bytes: p[0], datenbanken: p[1] });
            return {};
        }
        if (/UPDATE gameserver_backups SET status = 'completed', wiederhergestellt = \?/.test(sql)) {
            Object.assign(this.backups.find(b => b.id === Number(p[1])), { status: 'completed', wiederhergestellt: p[0] });
            return {};
        }
        if (/SELECT id, name FROM gameserver_backups WHERE id = \? AND server_id = \? AND guild_id = \? AND status = 'completed'/.test(sql)) {
            return this.backups.filter(b => b.id === Number(p[0]));
        }
        if (/SELECT gs\.id, gs\.install_path, gs\.status, r\.daemon_id FROM gameservers/.test(sql)) {
            return [{ id: 7, install_path: '7-probe', status: 'offline', daemon_id: 'd1' }];
        }
        if (/UPDATE gameserver_backups SET status = 'failed'/.test(sql)) {
            Object.assign(this.backups.find(b => b.id === p[1]), { status: 'failed', error_message: p[0] });
            return {};
        }
        throw new Error('Unerwartete Abfrage: ' + String(sql).trim().replace(/\s+/g, ' ').slice(0, 90));
    },
};
const daemon = {
    auftraege: [],
    antwort: {},
    scheitern: null,
    isDaemonOnline: () => true,
    async sendCommand(id, befehl, nutzlast) {
        this.auftraege.push({ befehl, nutzlast });
        if (this.scheitern) throw new Error(this.scheitern);
        return this.antwort[befehl] || {};
    },
};
ServiceManager.register('dbService', db);
ServiceManager.register('ipmServer', daemon);
ServiceManager.register('sseManager', { broadcast: still });

const router = require(path.join(WURZEL, 'plugins/gameserver/dashboard/routes/servers.js'));
const CronWorker = require(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/CronWorker.js'));
const Datenbanken = require(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/Datenbanken.js'));

function handler(methode, pfad) {
    const l = router.stack.find(x => x.route && x.route.path === pfad && x.route.methods[methode]);
    assert.ok(l, `Route ${methode} ${pfad} fehlt`);
    return l.route.stack.at(-1).handle;
}
async function rufe(methode, pfad, params = {}) {
    let status = 200, antwort = null;
    const res = { locals: { guildId: 'g1', user: { id: 'u1' } },
        status(s) { status = s; return this; }, json(o) { antwort = o; return this; } };
    await handler(methode, pfad)({ params: { serverId: '7', ...params }, body: {}, session: {} }, res);
    // Die Antwort an den Daemon läuft hinter der Antwort an den Browser weiter.
    for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
    return { status, antwort };
}

let bestanden = 0;
async function pruefe(name, fn) {
    db.datenbanken = []; db.backups = []; daemon.auftraege = []; daemon.antwort = {}; daemon.scheitern = null;
    try {
        await fn();
        console.log(`  ✓ ${name}`);
        bestanden++;
    } catch (fehler) {
        console.error(`  ✗ ${name}\n    ${fehler.message}`);
        process.exitCode = 1;
    }
}

(async () => {
    console.log('\nSichern');

    await pruefe('Von Hand: die Nummern gehen mit, die gesicherten stehen in der Zeile', async () => {
        db.datenbanken = [1];
        daemon.antwort['gameserver.backup'] = { size_bytes: 1234, datenbanken: [1] };
        const r = await rufe('post', '/:serverId/backups');
        assert.strictEqual(r.antwort.success, true);
        assert.deepStrictEqual(daemon.auftraege[0].nutzlast.datenbanken, [1]);
        assert.strictEqual(db.backups[0].datenbanken, '[1]');
        assert.strictEqual(db.backups[0].status, 'completed');
    });

    await pruefe('Ohne Datenbank: leere Liste, Spalte bleibt leer', async () => {
        daemon.antwort['gameserver.backup'] = { size_bytes: 1 };
        await rufe('post', '/:serverId/backups');
        assert.deepStrictEqual(daemon.auftraege[0].nutzlast.datenbanken, []);
        assert.strictEqual(db.backups[0].datenbanken, null);
    });

    await pruefe('Cronjob: derselbe Weg', async () => {
        db.datenbanken = [1, 2];
        daemon.antwort['gameserver.backup'] = { size_bytes: 9, datenbanken: [1, 2] };
        const w = new CronWorker();
        w._aufbewahrungAnwenden = async () => {};
        await w._executeBackup({ server_id: 7, guild_id: 'g1', server_name: 'Probe', install_path: '7-probe' },
            'd1', daemon, db, ServiceManager.get('Logger'));
        assert.deepStrictEqual(daemon.auftraege[0].nutzlast.datenbanken, [1, 2]);
        assert.strictEqual(db.backups[0].datenbanken, '[1,2]');
    });

    console.log('\nWiederherstellen');

    function gesichert() {
        db.backups.push({ id: 1, name: 'Probe_2026', status: 'completed', datenbanken: '[1]' });
    }

    await pruefe('Die Nummern, die der Server JETZT hat, gehen mit; das Ergebnis steht in der Zeile', async () => {
        gesichert();
        db.datenbanken = [1];
        daemon.antwort['gameserver.restore'] = { eingespielt: [1], hinweise: [] };
        const r = await rufe('post', '/:serverId/backups/:backupId/restore', { backupId: '1' });
        assert.strictEqual(r.antwort.success, true);
        assert.deepStrictEqual(daemon.auftraege[0].nutzlast.datenbanken, [1]);
        assert.match(db.backups[0].wiederhergestellt, /Datenbank 1 auf den Stand der Sicherung/);
    });

    await pruefe('Hinweise des Daemons stehen in der Zeile', async () => {
        gesichert();
        daemon.antwort['gameserver.restore'] = { eingespielt: [], hinweise: ['Datenbank 1 ist in der Sicherung, am Server gibt es sie nicht mehr — nicht eingespielt.'] };
        await rufe('post', '/:serverId/backups/:backupId/restore', { backupId: '1' });
        assert.match(db.backups[0].wiederhergestellt, /gibt es sie nicht mehr/);
    });

    await pruefe('Ein Fehlschlag steht in der Zeile — nicht nur im Log', async () => {
        gesichert();
        daemon.scheitern = 'dateien wiederhergestellt, datenbank nicht: datenbank 1: einspielen in s7_1 gescheitert — sie ist jetzt LEER';
        await rufe('post', '/:serverId/backups/:backupId/restore', { backupId: '1' });
        assert.match(db.backups[0].wiederhergestellt, /^Wiederherstellung gescheitert: .*LEER/);
    });

    await pruefe('Ohne etwas zu sagen: Spalte leer', async () => {
        assert.strictEqual(Datenbanken.wiederherstellungsText({ eingespielt: [], hinweise: [] }), null);
        assert.strictEqual(Datenbanken.wiederherstellungsText(undefined), null);
        assert.strictEqual(Datenbanken.sicherungsSpalte({ datenbanken: [] }), null);
    });

    console.log('\nAnzeige');

    await pruefe('Liste holt beide Spalten, der Reiter zeigt sie, die Rückfrage nennt die Datenbank', async () => {
        const routen = fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/routes/servers.js'), 'utf8');
        assert.match(routen, /SELECT id, name, size_bytes, datenbanken, status, note, created_by, created_at, completed_at,\s+error_message, wiederhergestellt/);
        const reiter = fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/views/guild/partials/server-detail-backups.ejs'), 'utf8');
        assert.match(reiter, /b\.datenbanken \? `[\s\S]{0,300}mit Datenbank/);
        assert.match(reiter, /b\.wiederhergestellt \? `/);
        assert.match(reiter, /Auch die Datenbank des Spiels wird auf den Stand der Sicherung zurückgesetzt/);
    });

    await pruefe('Migration legt beide Spalten an', async () => {
        const m = require(path.join(WURZEL, 'plugins/gameserver/migrations/20261028_120000_sicherung_datenbanken.js'));
        const sql = [];
        await m.up({ query: async (s) => { sql.push(s); return []; } });
        assert.ok(sql.some(s => /ADD COLUMN datenbanken/.test(s)) && sql.some(s => /ADD COLUMN wiederhergestellt/.test(s)));
    });

    console.log(`\n${bestanden} Prüfung(en) bestanden.`);
    process.exit(process.exitCode || 0);
})();
