#!/usr/bin/env node
/**
 * Stufe 11 S7 (2026-10-28): Der Umzug auf einen anderen Rootserver nimmt die
 * Datenbank mit — die Dashboard-Hälfte.
 *
 * Betreiber: „vor dem umzug geprüft werden ob auf dem zielserver die
 * verwendung von datenbank überhaupt erlaubt ist bzw. ob die datenbank
 * vorhanden ist". Entschieden: dasselbe Kennwort am Ziel, die alte Datenbank
 * nach einem gelungenen Umzug löschen.
 *
 * Gefahren wird der echte MigrationManager mit Attrappen für Datenbank und
 * Daemons; Übertragung, Ports und Aufräumen sind ersetzt (sie haben nichts
 * mit der Datenbank zu tun). Der Daemon hat seine Tests
 * (gameserver/backup_datenbank_test.go: TestUmzugNimmtDieDatenbankMit).
 *
 *   node scripts/check-umzug-datenbank.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || 'waechter-schluessel-nur-fuer-die-pruefung';

const { ServiceManager } = require('dunebot-core');
const still = () => {};
const logs = [];
ServiceManager.register('Logger', { debug: still, info: still, warn: (t) => logs.push(t), error: still, success: still });

const WURZEL = path.join(__dirname, '..');
const { encrypt } = require(path.join(WURZEL, 'apps/dashboard/helpers/utils'));

const QUELLE = { id: 54, name: 'Quelle', daemon_id: 'dq', host: '1.1.1.1', guild_id: 'g1',
    db_gewuenscht: 1, db_moeglich: 1, db_je_server: 1 };
const ZIEL = { id: 55, name: 'Ziel', daemon_id: 'dz', host: '2.2.2.2', guild_id: 'g1',
    db_gewuenscht: 1, db_moeglich: 1, db_je_server: 1 };

const db = {
    nrs: [],
    ziel: { ...ZIEL },
    async query(sql, p) {
        if (/FROM gameservers gs\s+LEFT JOIN rootserver r ON gs\.rootserver_id = r\.id\s+WHERE gs\.id = \? AND gs\.guild_id = \?/.test(sql)) {
            return [{ id: 7, name: 'Probe', guild_id: 'g1', rootserver_id: 54, status: 'offline',
                install_path: '7-probe', ports: '{}', source_daemon_id: 'dq' }];
        }
        if (/SELECT \* FROM rootserver WHERE id = \? AND guild_id = \?/.test(sql)) return [this.ziel];
        if (/SELECT \* FROM rootserver WHERE id = \?/.test(sql)) return [QUELLE];
        if (/SELECT nr FROM gameserver_datenbanken/.test(sql)) return this.nrs.map(nr => ({ nr }));
        if (/SELECT name, kennwort_ver FROM gameserver_datenbanken WHERE server_id = \? AND nr = \?/.test(sql)) {
            return [{ name: `s7_${p[1]}`, kennwort_ver: encrypt('AltesKennwort0123') }];
        }
        if (/INSERT INTO gameserver_migrations/.test(sql)) return { insertId: 1 };
        if (/^\s*UPDATE (gameservers|gameserver_migrations)/.test(sql)) return {};
        throw new Error('Unerwartete Abfrage: ' + String(sql).trim().replace(/\s+/g, ' ').slice(0, 90));
    },
    async transaction(fn) {
        return fn({ query: async (sql) => (/SHOW TABLES/.test(sql) ? [[]] : {}) });
    },
};
const daemon = {
    auftraege: [],
    amZiel: [],                // db.liste am Ziel
    scheitern: {},             // befehl → Fehlertext
    isDaemonOnline: () => true,
    async syncSftpUsers() {},
    async sendCommand(id, befehl, nutzlast) {
        this.auftraege.push({ id, befehl, nutzlast });
        if (this.scheitern[befehl]) throw new Error(this.scheitern[befehl]);
        if (befehl === 'db.liste') return { success: true, datenbanken: id === 'dz' ? this.amZiel : [] };
        if (befehl === 'db.anlegen') return { success: true, zugang: { name: `s7_${nutzlast.nr}` } };
        return { success: true };
    },
};
ServiceManager.register('dbService', db);
ServiceManager.register('ipmServer', daemon);
ServiceManager.register('sseManager', { broadcast: still });

const mm = require(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/MigrationManager.js'));
mm._transferBackup = async () => {};
mm._adjustPorts = async () => ({});
mm._cleanup = async () => {};
mm._waitForServerStopped = async () => {};
mm._startStepTicker = () => () => {};

const befehle = (b, id) => daemon.auftraege.filter(a => a.befehl === b && (!id || a.id === id));

let bestanden = 0;
async function pruefe(name, fn) {
    db.nrs = []; db.ziel = { ...ZIEL }; daemon.auftraege = []; daemon.amZiel = []; daemon.scheitern = {}; logs.length = 0;
    try {
        await fn();
        console.log(`  ✓ ${name}`);
        bestanden++;
    } catch (fehler) {
        console.error(`  ✗ ${name}\n    ${fehler.message}`);
        process.exitCode = 1;
    }
}

async function umzug() {
    const v = await mm._validate(7, 55, 'g1');
    if (!v.success) return v;
    let fehler = null;
    try {
        await mm._executeMigration(1, v.data.server, v.data.sourceRootServer, v.data.targetRootServer, 'g1', v.data.datenbanken);
    } catch (e) { fehler = e; }
    return { success: !fehler, error: fehler?.message };
}

(async () => {
    console.log('\nVorher prüfen — bevor irgendetwas angehalten wird');

    for (const [fall, ziel, muster] of [
        ['Ziel bietet keine Datenbanken an', { db_gewuenscht: 0 }, /bietet keine Datenbanken an/],
        ['Container am Ziel läuft nicht', { db_moeglich: 0, db_grund: 'Container fb-datenbank fehlt' }, /fb-datenbank fehlt/],
        ['Grenze am Ziel zu klein', { db_je_server: 0 }, /höchstens 0 je Gameserver/],
    ]) {
        await pruefe(`${fall}: abgelehnt, mit Grund — ohne einen Befehl an einen Daemon`, async () => {
            db.nrs = [1];
            Object.assign(db.ziel, ziel);
            const r = await mm._validate(7, 55, 'g1');
            assert.strictEqual(r.success, false);
            assert.match(r.error, muster);
            assert.match(r.error, /Zielserver kann sie nicht aufnehmen/);
            assert.strictEqual(daemon.auftraege.length, 0);
        });
    }

    await pruefe('Am Ziel liegt schon eine Datenbank dieses Servers: abgelehnt', async () => {
        db.nrs = [1];
        daemon.amZiel = [{ name: 's7_1', server_id: 7, nr: 1, bytes: 0 }];
        const r = await mm._validate(7, 55, 'g1');
        assert.strictEqual(r.success, false);
        assert.match(r.error, /liegt schon s7_1/);
    });

    await pruefe('Ohne Datenbank: kein Hindernis, und das Ziel wird nicht einmal gefragt', async () => {
        Object.assign(db.ziel, { db_gewuenscht: 0 });
        const r = await mm._validate(7, 55, 'g1');
        assert.strictEqual(r.success, true);
        assert.deepStrictEqual(r.data.datenbanken, []);
        assert.strictEqual(befehle('db.liste').length, 0);
    });

    console.log('\nDer Umzug');

    await pruefe('Mit Datenbank: ins Archiv, am Ziel mit DEMSELBEN Kennwort angelegt, eingespielt, an der Quelle gelöscht', async () => {
        db.nrs = [1];
        const r = await umzug();
        assert.strictEqual(r.success, true, r.error);
        assert.deepStrictEqual(befehle('gameserver.migrate.backup')[0].nutzlast.datenbanken, [1]);
        const anlegen = befehle('db.anlegen', 'dz');
        assert.strictEqual(anlegen.length, 1);
        assert.strictEqual(anlegen[0].nutzlast.kennwort, 'AltesKennwort0123');
        const reihe = daemon.auftraege.map(a => a.befehl);
        assert.ok(reihe.indexOf('db.anlegen') < reihe.indexOf('gameserver.migrate.restore'), 'erst anlegen, dann einspielen');
        assert.deepStrictEqual(befehle('gameserver.migrate.restore')[0].nutzlast.datenbanken, [1]);
        assert.strictEqual(befehle('db.loeschen', 'dq').length, 1, 'die alte an der Quelle geht');
        assert.strictEqual(befehle('db.loeschen', 'dz').length, 0, 'die neue am Ziel bleibt');
    });

    await pruefe('Auspacken am Ziel scheitert: Ziel-Datenbank wieder weg, Quelle unberührt', async () => {
        db.nrs = [1];
        daemon.scheitern['gameserver.migrate.restore'] = 'dateien ausgepackt, datenbank nicht: ERROR 1064';
        const r = await umzug();
        assert.strictEqual(r.success, false);
        assert.strictEqual(befehle('db.loeschen', 'dz').length, 1, 'am Ziel abgebaut');
        assert.strictEqual(befehle('db.loeschen', 'dq').length, 0, 'an der Quelle nichts gelöscht');
    });

    await pruefe('Anlegen am Ziel scheitert: kein Auspacken, nichts gelöscht', async () => {
        db.nrs = [1];
        daemon.scheitern['db.anlegen'] = 'datenbank-container läuft nicht';
        const r = await umzug();
        assert.strictEqual(r.success, false);
        assert.strictEqual(befehle('gameserver.migrate.restore').length, 0);
        assert.strictEqual(befehle('db.loeschen').length, 0);
    });

    await pruefe('Ohne Datenbank: der Umzug wie vorher, kein db.*-Befehl', async () => {
        const r = await umzug();
        assert.strictEqual(r.success, true, r.error);
        assert.strictEqual(daemon.auftraege.filter(a => a.befehl.startsWith('db.')).length, 0);
        assert.deepStrictEqual(befehle('gameserver.migrate.backup')[0].nutzlast.datenbanken, []);
    });

    console.log('\nDialog');

    await pruefe('Der Umzugsdialog graut Ziele aus, die die Datenbank nicht aufnehmen — mit Grund', async () => {
        const Datenbanken = require(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/Datenbanken.js'));
        assert.strictEqual(Datenbanken.umzugGrund({ ...ZIEL, db_gewuenscht: 0 }, 0), null, 'ohne Datenbank taugt jedes Ziel');
        assert.match(Datenbanken.umzugGrund({ ...ZIEL, db_gewuenscht: 0 }, 1), /bietet keine Datenbanken an/);
        const routen = fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/routes/servers.js'), 'utf8');
        assert.match(routen, /rs\.umzug_grund = Datenbanken\.umzugGrund\(rs, anzahl\)/);
        assert.match(routen, /r\.db_gewuenscht, r\.db_moeglich, r\.db_grund, r\.db_je_server/);
        const ansicht = fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/views/guild/server-detail.ejs'), 'utf8');
        assert.match(ansicht, /<% if \(rs\.umzug_grund\) \{ %>\s*<option value="<%= rs\.id %>" disabled/);
    });

    console.log(`\n${bestanden} Prüfung(en) bestanden.`);
    process.exit(process.exitCode || 0);
})();
