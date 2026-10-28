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
    migrationen: [],           // jüngste Umzugszeile(n) des Servers für Umzugsstand.letzter
    vorrat: [],                // freie port_allocations am Ziel: { id, port }
    portBuch: [],              // was an port_allocations geschrieben wurde
    tx: [],                    // Anweisungen in der Transaktion
    txWirft: null,             // Fehlertext, wenn die Transaktion scheitern soll
    gescheitert: [],           // was als Fehlschlag eingetragen wurde
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
        // Das Paket des Servers (Paketfassung.ladePaketFuerServer): Spielport aus
        // dem Vorrat, query = game+1 — wie Core Keeper.
        if (/FROM gameservers gs\s+JOIN packages pk/.test(sql)) {
            return [{ paket_json: JSON.stringify({ identity: { name: 'Probe' }, ports: [
                { purpose: 'game', assign: 'pool', protocol: 'udp', required: true },
                { purpose: 'query', assign: 'game+1', protocol: 'udp', required: true }] }) }];
        }
        if (/SELECT id, port FROM port_allocations\s+WHERE rootserver_id = \? AND server_id IS NULL/.test(sql)) return this.vorrat;
        if (/UPDATE port_allocations SET server_id = 0, assigned_at = NOW\(\) WHERE id = \?/.test(sql)) {
            this.portBuch.push(['vorlaeufig', p[0]]); return {};
        }
        if (/UPDATE port_allocations SET server_id = NULL, assigned_at = NULL\s+WHERE id IN/.test(sql)) {
            this.portBuch.push(['frei', ...p]); return {};
        }
        if (/FROM gameserver_migrations WHERE server_id = \? ORDER BY id DESC LIMIT 1/.test(sql)) return this.migrationen;
        // Wie MySQL im strikten Modus: current_step ist VARCHAR(100).
        if (/UPDATE gameserver_migrations SET status = \?, progress_percent = \?, current_step = \?/.test(sql)
            && String(p[2] || '').length > 100) {
            throw new Error("Data too long for column 'current_step' at row 1");
        }
        if (/SET status = 'failed', progress_percent = 0, current_step = 'Fehlgeschlagen', error_message = \?/.test(sql)) {
            this.gescheitert.push(p[0]);
            return {};
        }
        if (/^\s*UPDATE (gameservers|gameserver_migrations)/.test(sql)) return {};
        throw new Error('Unerwartete Abfrage: ' + String(sql).trim().replace(/\s+/g, ' ').slice(0, 90));
    },
    async transaction(fn) {
        return fn({ query: async (sql, p) => {
            if (/SHOW TABLES/.test(sql)) return [[{ t: 'port_allocations' }]];
            this.tx.push([sql.replace(/\s+/g, ' ').trim(), p]);
            if (this.txWirft && /port_allocations/.test(sql)) throw new Error(this.txWirft);
            return {};
        } });
    },
};
const daemon = {
    auftraege: [],
    amZiel: [],                // db.liste am Ziel
    scheitern: {},             // befehl → Fehlertext
    alt: new Set(),            // Daemons vor 1.0.148: kennen `datenbanken` nicht
    isDaemonOnline: () => true,
    async syncSftpUsers() {},
    async sendCommand(id, befehl, nutzlast) {
        this.auftraege.push({ id, befehl, nutzlast });
        if (this.scheitern[befehl]) throw new Error(this.scheitern[befehl]);
        if (befehl === 'db.liste') return { success: true, datenbanken: id === 'dz' ? this.amZiel : [] };
        if (befehl === 'db.anlegen') return { success: true, zugang: { name: `s7_${nutzlast.nr}` } };
        // Wie der Daemon antwortet — ein alter lässt die Felder einfach weg.
        if (befehl === 'gameserver.migrate.backup') {
            return this.alt.has(id) ? { success: true } : { success: true, datenbanken: nutzlast.datenbanken };
        }
        if (befehl === 'gameserver.migrate.restore') {
            return this.alt.has(id) ? { success: true } : { success: true, eingespielt: nutzlast.datenbanken, hinweise: [] };
        }
        return { success: true };
    },
};
ServiceManager.register('dbService', db);
ServiceManager.register('ipmServer', daemon);
ServiceManager.register('sseManager', { broadcast: still });

const mm = require(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/MigrationManager.js'));
mm._transferBackup = async () => {};
// Freier Vorrat am Ziel: 25007 + 25008 (25005 gehört dort schon Server 222).
const VORRAT = [{ id: 507, port: 25007 }, { id: 508, port: 25008 }, { id: 509, port: 25009 }];
mm._cleanup = async () => {};
mm._waitForServerStopped = async () => {};
mm._startStepTicker = () => () => {};

const befehle = (b, id) => daemon.auftraege.filter(a => a.befehl === b && (!id || a.id === id));

let bestanden = 0;
async function pruefe(name, fn) {
    db.nrs = []; db.ziel = { ...ZIEL }; db.migrationen = []; db.gescheitert = []; daemon.auftraege = []; daemon.amZiel = []; daemon.scheitern = {}; daemon.alt = new Set(); logs.length = 0;
    db.vorrat = VORRAT.map(z => ({ ...z })); db.portBuch = []; db.tx = []; db.txWirft = null;
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

    // Erfolg genauso prüfen: Ein Daemon vor 1.0.148 kennt `datenbanken` nicht
    // und meldet trotzdem Erfolg. Ohne diese Prüfung stünde am Ende eine LEERE
    // Datenbank am Ziel, und die alte wäre gelöscht.
    await pruefe('Alter Daemon an der Quelle: kein Umzug, nichts angelegt, nichts gelöscht', async () => {
        db.nrs = [1];
        daemon.alt.add('dq');
        const r = await umzug();
        assert.strictEqual(r.success, false);
        assert.match(r.error, /nicht ins Archiv gelegt/);
        assert.strictEqual(befehle('db.anlegen').length, 0);
        assert.strictEqual(befehle('db.loeschen').length, 0);
    });

    await pruefe('Alter Daemon am Ziel: kein Umzug, Ziel abgebaut, Quelle unberührt', async () => {
        db.nrs = [1];
        daemon.alt.add('dz');
        const r = await umzug();
        assert.strictEqual(r.success, false);
        assert.match(r.error, /nicht eingespielt/);
        assert.strictEqual(befehle('db.loeschen', 'dz').length, 1);
        assert.strictEqual(befehle('db.loeschen', 'dq').length, 0);
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

    console.log('\nSichtbarkeit und Sperre (2026-10-28, Umzug 16 / Server 217)');

    await pruefe('Ein langer Grund: Fehlschlag mit ganzem Text eingetragen, Fehlerzweig läuft zu Ende', async () => {
        db.nrs = [1];
        daemon.alt.add('dq'); // genau der Fall von Umzug 16: Grund länger als 100 Zeichen
        const r = await umzug();
        assert.strictEqual(r.success, false);
        assert.strictEqual(db.gescheitert.length, 1, 'kein Fehlschlag eingetragen');
        assert.match(db.gescheitert[0], /nicht ins Archiv gelegt/);
        assert.ok(db.gescheitert[0].length > 100, 'der Grund wurde gekürzt');
        assert.strictEqual(befehle('gameserver.migrate.cleanup', 'dq').length, 1, 'das Archiv an der Quelle wurde nicht aufgeräumt');
    });

    await pruefe('Läuft schon ein Umzug, wird kein zweiter gestartet', async () => {
        db.migrationen = [{ id: 15, status: 'backing_up', current_step: 'Backup wird erstellt...' }];
        const r = await mm._validate(7, 55, 'g1');
        assert.strictEqual(r.success, false);
        assert.match(r.error, /läuft schon ein Umzug \(Backup wird erstellt/);
        db.migrationen = [{ id: 15, status: 'failed' }];
        assert.strictEqual((await mm._validate(7, 55, 'g1')).success, true, 'nach einem gescheiterten darf man es erneut versuchen');
    });

    await pruefe('Zustand: ein laufender Umzug schlägt den Status — in Liste, Live-Route und Live-Skript', async () => {
        const { baueServerListe } = require(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/Serverseite.js'));
        const zeile = (status, umzug_status) => baueServerListe([{ id: 7, status, umzug_status, ports: '{}' }]).liste[0].zustand;
        assert.strictEqual(zeile('offline', 'transferring').text, 'Wird verschoben');
        assert.strictEqual(zeile('updating', 'pending').text, 'Wird verschoben');
        assert.strictEqual(zeile('offline', 'failed').text, 'Aus');
        assert.strictEqual(zeile('offline', null).text, 'Aus');
        const { SERVER_LISTE_SQL } = require(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/Serverliste.js'));
        assert.match(SERVER_LISTE_SQL, /FROM gameserver_migrations m\s+WHERE m\.server_id = gs\.id ORDER BY m\.id DESC LIMIT 1\) AS umzug_status/);
        // mysql2 ersetzt Platzhalter ohne Rücksicht auf Kommentare: Ein „?" in
        // einem `--`-Kommentar bekam die Guild-Kennung, das echte blieb leer
        // (gemessen 2026-10-28 — das Widget fiel still aus).
        assert.strictEqual((SERVER_LISTE_SQL.match(/\?/g) || []).length, 1, 'die Grundabfrage hat genau einen Platzhalter');
        const routen = fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/routes/servers.js'), 'utf8');
        assert.match(routen, /umzug:\s+require\('\.\.\/helpers\/Umzugsstand'\)\.laeuft\(s\.umzug_status\)/);
        const live = fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/assets/js/gameserver-live.js'), 'utf8');
        assert.match(live, /z\.umzug \? \{ text: 'Wird verschoben' \}/);
        assert.match(live, /umzug:\s+Boolean\(s\.umzug\)/);
    });

    await pruefe('Serverseite: Hinweis für laufenden und gescheiterten Umzug', async () => {
        const v = fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/views/guild/server-detail.ejs'), 'utf8');
        assert.match(v, /const uz = locals\.umzug; if \(uz\) \{/);
        assert.match(v, /Wird auf „<%= uz\.nach %>“ verschoben/);
        assert.match(v, /Umzug auf „<%= uz\.nach %>“ gescheitert/);
    });

    console.log('\nPorts am Ziel (2026-10-28, Umzug 17: Duplicate entry ...-25005)');

    await pruefe('Vor dem Umzug: zu wenig Vorrat am Ziel → abgelehnt, ohne zu buchen', async () => {
        db.vorrat = [{ id: 507, port: 25007 }]; // kein Nachbar für query = game+1
        const r = await mm._validate(7, 55, 'g1');
        assert.strictEqual(r.success, false);
        assert.match(r.error, /^Am Zielserver: Nicht genug freie Ports/);
        assert.strictEqual(db.portBuch.length, 0, 'die Prüfung hat gebucht');
        assert.strictEqual(daemon.auftraege.length, 0);
    });

    await pruefe('Umzug: Ziel-Ports aus dem Vorrat (game+1 gekoppelt), Quelle frei, Ziel auf den Server gebucht', async () => {
        const r = await umzug();
        assert.strictEqual(r.success, true, r.error);
        assert.deepStrictEqual(db.portBuch, [['vorlaeufig', 507], ['vorlaeufig', 508]], 'vorläufig 25007 + 25008');
        const sqls = db.tx.map(([s]) => s);
        const quelle = db.tx.find(([s]) => /SET server_id = NULL, assigned_at = NULL WHERE server_id = \? AND rootserver_id = \?/.test(s));
        assert.ok(quelle, 'die Quelle wird nicht freigegeben:\n' + sqls.join('\n'));
        assert.deepStrictEqual(quelle[1], [7, 54]);
        const ziel = db.tx.find(([s]) => /SET server_id = \?, assigned_at = NOW\(\) WHERE id IN \(\?,\?\) AND server_id = 0/.test(s));
        assert.ok(ziel, 'das Ziel wird nicht auf den Server gebucht');
        assert.deepStrictEqual(ziel[1], [7, 507, 508]);
        assert.ok(!sqls.some(s => /SET rootserver_id = \?, ip = \?/.test(s)), 'die alten Zeilen werden noch verschoben');
        const gs = db.tx.find(([s]) => /UPDATE gameservers SET rootserver_id/.test(s));
        assert.deepStrictEqual(JSON.parse(gs[1][1]).query, { internal: 25008, external: 25008, protocol: 'udp' });
    });

    await pruefe('Scheitert das Umschreiben: vorläufige Ziel-Ports wieder frei, Ziel-Datenbank abgebaut', async () => {
        db.nrs = [1];
        db.txWirft = "Duplicate entry '55-45.131.66.91-25005' for key 'uk_rootserver_ip_port'";
        const r = await umzug();
        assert.strictEqual(r.success, false);
        assert.deepStrictEqual(db.portBuch.filter(b => b[0] === 'frei'), [['frei', 507, 508]]);
        assert.strictEqual(befehle('db.loeschen', 'dz').length, 1, 'die Ziel-Datenbank bleibt liegen');
        assert.strictEqual(befehle('gameserver.migrate.cleanup', 'dz').length, 1, 'das Archiv am Ziel bleibt in /tmp liegen');
        assert.ok(logs.length === 0 || !logs.some(l => /nicht abgebaut/.test(l)));
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
