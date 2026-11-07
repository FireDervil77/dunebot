#!/usr/bin/env node
/**
 * Stoppen und Löschen — ohne Daemon, ohne Datenbank.
 *
 * ── Was hier geprüft wird (2026-09-14) ──────────────────────────────────────
 *
 * Der Daemon antwortet auf `gameserver.stop` mit `queued` und stoppt später.
 * Die Stopp-Route schrieb bis zu diesem Tag trotzdem sofort `offline`, und das
 * Löschen vertraute darauf — bei einem Daemon, der beim Deinstallieren den
 * Container NICHT stoppt. Geprüft wird deshalb die Reihenfolge, auf die es
 * ankommt:
 *
 *   Stoppen   `queued` → der Status bleibt `stopping`, der Browser erfährt es sofort
 *   Löschen   läuft er? → stoppen → auf die Meldung warten → erst dann deinstallieren
 *             kommt er nicht herunter → es wird NICHTS gelöscht
 *   Neu-      dasselbe vor `gameserver.install` (seit 2026-09-24, Baustelle 155:
 *   install.  #202 lief waehrend der Neuinstallation weiter und stand danach
 *             im Panel auf `offline`)
 *
 * Die Attrappen WERFEN bei unerwarteten Abfragen und Befehlen.
 *
 *   node scripts/check-server-stopp.js
 */
'use strict';

const assert = require('assert');
const path = require('path');
const { ServiceManager } = require('dunebot-core');

const still = () => {};
ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });

const db = {
    server: null,            // die eine Serverzeile
    geschrieben: [],         // [status, …] in Schreibreihenfolge
    geloescht: false,
    async query(sql, params) {
        const t = String(sql).replace(/\s+/g, ' ').trim();
        if (/^SELECT gs\.\*, r\.daemon_id FROM gameservers gs/.test(t)
            || /FROM gameservers gs LEFT JOIN rootserver r ON gs\.rootserver_id = r\.id LEFT JOIN addon_marketplace am/.test(t)) {
            return this.server ? [{ ...this.server }] : [];
        }
        if (/^UPDATE gameservers SET status = \?, last_status_update = NOW\(\) WHERE id = \?$/.test(t)) {
            this.server.status = params[0]; this.geschrieben.push(params[0]);
            return { affectedRows: 1 };
        }
        if (/^UPDATE gameservers SET status = \?, error_message = \?, last_status_update = NOW\(\) WHERE id = \?$/.test(t)) {
            this.server.status = params[0]; this.server.error_message = params[1]; this.geschrieben.push(params[0]);
            return { affectedRows: 1 };
        }
        if (/^SELECT status, error_message FROM gameservers WHERE id = \?$/.test(t)) {
            return this.server ? [{ status: this.server.status, error_message: this.server.error_message || null }] : [];
        }
        if (/^UPDATE port_allocations SET server_id = NULL/.test(t)) return { affectedRows: 1 };
        if (/^UPDATE gameservers SET status = \?, error_message = NULL WHERE id = \?$/.test(t)) {
            this.server.status = params[0]; this.geschrieben.push(params[0]);
            return { affectedRows: 1 };
        }
        if (/^DELETE FROM gameservers WHERE id = \?$/.test(t)) { this.geloescht = true; return { affectedRows: 1 }; }
        // Das Löschen läuft im Hintergrund: Auftrag annehmen, Ausgang festhalten.
        if (/^UPDATE gameservers SET loeschung_seit = NOW\(\), loeschung_fehler = NULL WHERE id = \? AND guild_id = \?/.test(t)) {
            return { affectedRows: 1 };
        }
        if (/^UPDATE gameservers SET loeschung_fehler = \? WHERE id = \?$/.test(t)) {
            this.server.loeschung_fehler = params[0];
            return { affectedRows: 1 };
        }
        // Geplanter Stopp (CronWorker, 2026-10-29): die Zeile für ServerStopp.
        if (/^SELECT id, name, status, last_status_update FROM gameservers WHERE id = \?$/.test(t)) {
            return this.server ? [{ id: this.server.id, name: this.server.name, status: this.server.status,
                last_status_update: this.server.last_status_update || null }] : [];
        }
        // Datenbanken des Servers (Stufe 11 S4): Die Löschroute fragt sie vor
        // dem Deinstallieren ab — dieser Server hat keine.
        if (/^SELECT nr, name, bytes, groesse_am, created_at FROM gameserver_datenbanken WHERE server_id = \? ORDER BY nr$/.test(t)) return [];
        throw new Error('Unerwartete Abfrage: ' + t.slice(0, 90));
    },
};

const daemon = {
    befehle: [],             // Reihenfolge der Befehle
    stoppAntwort: { success: true, task_id: 't-1' },
    online: true,
    isDaemonOnline() { return this.online; },
    async sendCommand(daemonId, befehl) {
        this.befehle.push(befehl);
        if (befehl === 'gameserver.stop') return this.stoppAntwort;
        if (befehl === 'gameserver.uninstall') return { success: true, deleted_files: 3 };
        if (befehl === 'gameserver.install') return { success: true, task_id: 't-2' };
        throw new Error('Unerwarteter Befehl: ' + befehl);
    },
    async syncSftpUsers() { return true; },
};

const sse = { gesendet: [], broadcast(guildId, kanal, daten) { this.gesendet.push(daten.status); } };

ServiceManager.register('dbService', db);
ServiceManager.register('ipmServer', daemon);
ServiceManager.register('sseManager', sse);

const HELFER = path.join(__dirname, '../plugins/gameserver/dashboard/helpers');
const ServerStopp = require(path.join(HELFER, 'ServerStopp.js'));

const LAUFEND = () => ({ id: 42, name: 'Bude', status: 'online', guild_id: 'g1',
    last_status_update: new Date().toISOString(), daemon_id: 'd1', rootserver_id: 55,
    install_path: '42-valheim', addon_slug: 'valheim',
    // Das echte Paket: Die Neuinstallation baut ihren Auftrag mit
    // baueInstallNutzlast, und der weist einen Server ohne Paket ab — dann
    // prüfte die Neuinstallation nur ihren eigenen Abbruch.
    paket_json: require('fs').readFileSync(path.join(__dirname, '../packages/fbpkg/beispiele/valheim.json'), 'utf8'),
    paket_werte: '{}', ports: '{}' });

let bestanden = 0;
async function pruefe(name, fn) {
    db.server = LAUFEND(); db.geschrieben = []; db.geloescht = false;
    daemon.befehle = []; daemon.stoppAntwort = { success: true, task_id: 't-1' }; daemon.online = true;
    sse.gesendet = [];
    try { await fn(); console.log(`  ✓ ${name}`); bestanden++; }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

(async () => {
    console.log('\nStoppen');

    await pruefe('Eingereiht heißt: der Status bleibt „stopping" — kein vorzeitiges offline', async () => {
        const e = await ServerStopp.stoppe({ server: db.server, guildId: 'g1' });
        assert.strictEqual(e.ok, true);
        assert.strictEqual(e.eingereiht, true);
        assert.deepStrictEqual(db.geschrieben, ['stopping'], 'offline schreibt allein die Meldung des Daemons');
        assert.deepStrictEqual(sse.gesendet, ['stopping'], 'der Browser muss den Übergang sofort sehen');
    });

    await pruefe('Ohne Aufgabenkennung hat der Daemon synchron gestoppt — dann offline', async () => {
        daemon.stoppAntwort = { success: true };
        const e = await ServerStopp.stoppe({ server: db.server, guildId: 'g1' });
        assert.strictEqual(e.eingereiht, false);
        assert.deepStrictEqual(db.geschrieben, ['stopping', 'offline']);
        assert.deepStrictEqual(sse.gesendet, ['stopping', 'offline']);
    });

    await pruefe('Scheitert der Befehl, kehrt der VORHERIGE Status zurück — nicht pauschal online', async () => {
        db.server.status = 'starting';
        daemon.stoppAntwort = { success: false, error: 'Container nicht gefunden' };
        const e = await ServerStopp.stoppe({ server: db.server, guildId: 'g1' });
        assert.strictEqual(e.ok, false);
        assert.deepStrictEqual(db.geschrieben, ['stopping', 'starting']);
        assert.match(e.grund, /Container nicht gefunden/);
    });

    await pruefe('Die Zustandslogik entscheidet: aus „offline" wird nichts gestoppt', async () => {
        db.server.status = 'offline';
        const e = await ServerStopp.stoppe({ server: db.server, guildId: 'g1' });
        assert.strictEqual(e.ok, false);
        assert.strictEqual(e.status, 409);
        assert.deepStrictEqual(daemon.befehle, [], 'kein Befehl an den Daemon');
    });

    await pruefe('Ein hängendes „starting" ohne Zeitstempel sperrt nicht (Baustelle 115)', async () => {
        db.server.status = 'starting'; db.server.last_status_update = null;
        const e = await ServerStopp.stoppe({ server: db.server, guildId: 'g1' });
        assert.strictEqual(e.ok, true);
    });

    console.log('\nWarten');

    await pruefe('Gewartet wird, bis die Datenbank „offline" sagt', async () => {
        db.server.status = 'stopping';
        setTimeout(() => { db.server.status = 'offline'; }, 30);
        const w = await ServerStopp.warteBisGestoppt(42, { fristMs: 2000, taktMs: 10 });
        assert.strictEqual(w.ok, true);
    });

    await pruefe('„error" gilt NICHT als gestoppt — daran hängt das Löschen von Dateien', async () => {
        db.server.status = 'error'; db.server.error_message = 'SIGKILL verweigert';
        const w = await ServerStopp.warteBisGestoppt(42, { fristMs: 500, taktMs: 10 });
        assert.strictEqual(w.ok, false);
        assert.match(w.grund, /SIGKILL verweigert/);
    });

    await pruefe('Nach der Frist ist Schluss — mit dem Zustand, in dem er hängt', async () => {
        db.server.status = 'stopping';
        const w = await ServerStopp.warteBisGestoppt(42, { fristMs: 60, taktMs: 10 });
        assert.strictEqual(w.zeitueberschreitung, true);
        assert.match(w.grund, /stopping/);
    });

    console.log('\nRouten');

    const router = require(path.join(__dirname, '../plugins/gameserver/dashboard/routes/servers.js'));
    const handler = (methode, pfad) => {
        const s = router.stack.find(l => l.route && l.route.path === pfad && l.route.methods[methode]);
        assert.ok(s, `Route ${methode.toUpperCase()} ${pfad} fehlt`);
        return s.route.stack[s.route.stack.length - 1].handle;
    };
    const rufe = async (methode, pfad, { query = {} } = {}) => {
        const body = methode === 'delete' ? { bestaetigung: 'löschen' } : {};
        let status = 200, antwort = null;
        const res = { locals: { guildId: 'g1' },
            status(x) { status = x; return this; }, json(o) { antwort = o; return this; } };
        // Das Löschen antwortet 202 und läuft danach weiter; der Aufruf kehrt erst
        // zurück, wenn es durch ist. So prüft dieser Lauf den ganzen Ablauf.
        await handler(methode, pfad)({ params: { serverId: '42' }, query, body }, res);
        return { status, antwort };
    };

    // Das Warten wird hier ersetzt: Geprüft wird die REIHENFOLGE in der Route,
    // nicht die Uhr (die hat ihre eigenen Prüfungen oben).
    const echtesWarten = ServerStopp.warteBisGestoppt;

    await pruefe('POST /stop antwortet „wird gestoppt" und lässt den Status auf stopping', async () => {
        const r = await rufe('post', '/:serverId/stop');
        assert.strictEqual(r.status, 200, JSON.stringify(r.antwort));
        assert.strictEqual(r.antwort.eingereiht, true);
        assert.match(r.antwort.message, /wird gestoppt/);
        assert.strictEqual(db.server.status, 'stopping');
    });

    await pruefe('Löschen eines laufenden Servers: stoppen → warten → erst dann deinstallieren', async () => {
        const ablauf = [];
        ServerStopp.warteBisGestoppt = async () => { ablauf.push('gewartet'); db.server.status = 'offline'; return { ok: true }; };
        const vorher = daemon.sendCommand.bind(daemon);
        daemon.sendCommand = async (d, b, n) => { ablauf.push(b); return vorher(d, b, n); };
        try {
            const r = await rufe('delete', '/:serverId');
            assert.strictEqual(r.status, 202, JSON.stringify(r.antwort));
            assert.deepStrictEqual(ablauf, ['gameserver.stop', 'gewartet', 'gameserver.uninstall'],
                'die Dateien dürfen erst weg, wenn der Server unten ist');
            assert.strictEqual(db.geloescht, true);
        } finally {
            ServerStopp.warteBisGestoppt = echtesWarten;
            daemon.sendCommand = vorher;
        }
    });

    await pruefe('Kommt er nicht herunter, wird NICHTS gelöscht', async () => {
        ServerStopp.warteBisGestoppt = async () => ({ ok: false, zeitueberschreitung: true,
            grund: 'Der Server steht nach 150 Sekunden noch auf „stopping"' });
        try {
            const r = await rufe('delete', '/:serverId');
            assert.strictEqual(r.status, 202, 'angenommen, der Ausgang kommt danach');
            assert.match(db.server.loeschung_fehler || '', /nichts gelöscht/, 'der Grund muss am Server stehen');
            assert.ok(!daemon.befehle.includes('gameserver.uninstall'), 'kein Deinstallieren');
            assert.strictEqual(db.geloescht, false, 'die Zeile bleibt');
        } finally { ServerStopp.warteBisGestoppt = echtesWarten; }
    });

    await pruefe('Ein laufender Stopp wird beim Löschen nicht doppelt ausgelöst', async () => {
        db.server.status = 'stopping';
        ServerStopp.warteBisGestoppt = async () => { db.server.status = 'offline'; return { ok: true }; };
        try {
            const r = await rufe('delete', '/:serverId');
            assert.strictEqual(r.status, 202, JSON.stringify(r.antwort));
            assert.deepStrictEqual(daemon.befehle, ['gameserver.uninstall'], 'kein zweiter Stopp-Befehl');
        } finally { ServerStopp.warteBisGestoppt = echtesWarten; }
    });

    await pruefe('Ein gestoppter Server wird gelöscht wie bisher — ohne Stopp, ohne Warten', async () => {
        db.server.status = 'offline';
        let gewartet = false;
        ServerStopp.warteBisGestoppt = async () => { gewartet = true; return { ok: true }; };
        try {
            const r = await rufe('delete', '/:serverId');
            assert.strictEqual(r.status, 202, JSON.stringify(r.antwort));
            assert.deepStrictEqual(daemon.befehle, ['gameserver.uninstall']);
            assert.strictEqual(gewartet, false);
        } finally { ServerStopp.warteBisGestoppt = echtesWarten; }
    });

    console.log('\nNeuinstallation (Baustelle 155)');

    await pruefe('Neuinstallation eines laufenden Servers: stoppen → warten → erst dann installieren', async () => {
        const ablauf = [];
        ServerStopp.warteBisGestoppt = async () => { ablauf.push('gewartet'); db.server.status = 'offline'; return { ok: true }; };
        const vorher = daemon.sendCommand.bind(daemon);
        daemon.sendCommand = async (d, b, n) => { ablauf.push(b); return vorher(d, b, n); };
        try {
            const r = await rufe('post', '/:serverId/reinstall');
            assert.strictEqual(r.status, 200, JSON.stringify(r.antwort));
            assert.deepStrictEqual(ablauf, ['gameserver.stop', 'gewartet', 'gameserver.install'],
                'installiert wird erst, wenn der Server unten ist');
            assert.strictEqual(r.antwort.gestoppt, true);
            assert.match(r.antwort.message, /wurde gestoppt/, 'der Betreiber erfährt, dass gestoppt wurde');
            assert.strictEqual(db.server.status, 'installing');
        } finally {
            ServerStopp.warteBisGestoppt = echtesWarten;
            daemon.sendCommand = vorher;
        }
    });

    await pruefe('Kommt er nicht herunter, wird NICHTS neu installiert', async () => {
        ServerStopp.warteBisGestoppt = async () => ({ ok: false, zeitueberschreitung: true,
            grund: 'Der Server steht nach 150 Sekunden noch auf „stopping"' });
        try {
            const r = await rufe('post', '/:serverId/reinstall');
            assert.strictEqual(r.status, 504);
            assert.match(r.antwort.message, /nichts neu installiert/);
            assert.ok(!daemon.befehle.includes('gameserver.install'), 'kein Installationsauftrag');
            assert.ok(!db.geschrieben.includes('installing'), 'der Status wird nicht auf installing gesetzt');
        } finally { ServerStopp.warteBisGestoppt = echtesWarten; }
    });

    await pruefe('Ein gestoppter Server wird neu installiert wie bisher — ohne Stopp, ohne Warten', async () => {
        db.server.status = 'offline';
        let gewartet = false;
        ServerStopp.warteBisGestoppt = async () => { gewartet = true; return { ok: true }; };
        try {
            const r = await rufe('post', '/:serverId/reinstall');
            assert.strictEqual(r.status, 200, JSON.stringify(r.antwort));
            assert.deepStrictEqual(daemon.befehle, ['gameserver.install']);
            assert.strictEqual(gewartet, false);
            assert.strictEqual(r.antwort.gestoppt, false);
            assert.doesNotMatch(r.antwort.message, /wurde gestoppt/);
        } finally { ServerStopp.warteBisGestoppt = echtesWarten; }
    });

    console.log('\nDiscord-Weg (seit 2026-10-28, Baustelle 119)');

    await pruefe('SERVER_STOP im Kern stoppt über den Anbieter, nicht mit eigenem Befehl', async () => {
        const { ohneKommentare } = require('./lib/quelltext');
        const ipc = ohneKommentare(require('fs').readFileSync(
            path.join(__dirname, '../apps/dashboard/helpers/IPCServer.js'), 'utf8'));
        const ab = ipc.indexOf("case 'SERVER_STOP'");
        assert.ok(ab > 0, 'case SERVER_STOP nicht gefunden');
        const fall = ipc.slice(ab, ipc.indexOf('case ', ab + 20));
        assert.match(fall, /ServersteuerungRegistry\.get\('gameserver'\)/);
        assert.match(fall, /\.stoppen\(guildId, serverId/);
        assert.doesNotMatch(fall, /'gameserver\.stop'/, 'eigener Stoppbefehl — zweiter Weg');
        assert.doesNotMatch(fall, /UPDATE gameservers/, 'eigenes Statusschreiben — zweiter Weg');
    });

    await pruefe('Der Anbieter stoppt über ServerStopp.stoppe', async () => {
        const { anbieter } = require('../plugins/gameserver/dashboard/helpers/Serversteuerung');
        const echt = ServerStopp.stoppe;
        let gerufen = null;
        ServerStopp.stoppe = async (auftrag) => { gerufen = auftrag; return { ok: true, eingereiht: true }; };
        try {
            const r = await anbieter.stoppen('g1', 7, { grund: 'Discord' });
            assert.deepStrictEqual(r, { ok: true, grund: undefined, eingereiht: true });
            assert.strictEqual(gerufen.guildId, 'g1');
        } finally { ServerStopp.stoppe = echt; }
    });

    console.log('\nGeplanter Stopp und Plugin-Abbau (2026-10-29, Baustelle 119 / F5)');

    await pruefe('Der CronWorker stoppt über ServerStopp — mit dem frisch aufgelösten Daemon', async () => {
        const CronWorker = require(path.join(HELFER, 'CronWorker.js'));
        const echt = ServerStopp.stoppe;
        let gerufen = null;
        ServerStopp.stoppe = async (auftrag) => { gerufen = auftrag; return { ok: true, eingereiht: true }; };
        db.server = LAUFEND(); daemon.befehle = [];
        try {
            await new CronWorker()._dispatchAction({ id: 1, action: 'stop', server_id: 42, guild_id: 'g1' },
                'daemon-neu', daemon, db, ServiceManager.get('Logger'));
            assert.ok(gerufen, 'ServerStopp.stoppe nicht gerufen');
            assert.strictEqual(gerufen.server.daemon_id, 'daemon-neu', 'nicht der frisch aufgelöste Daemon');
            assert.strictEqual(gerufen.guildId, 'g1');
            assert.deepStrictEqual(daemon.befehle, [], 'eigener gameserver.stop — zweiter Weg');
            ServerStopp.stoppe = async () => ({ ok: false, status: 500, grund: 'Daemon lehnt ab' });
            await assert.rejects(new CronWorker()._dispatchAction({ id: 1, action: 'stop', server_id: 42, guild_id: 'g1' },
                'daemon-neu', daemon, db, ServiceManager.get('Logger')), /Daemon lehnt ab/, 'eine Ablehnung wird nicht zum Erfolg');
        } finally { ServerStopp.stoppe = echt; }
    });

    // Seit 2026-11-07 (K067) löscht der Plugin-Abbau jeden Server über
    // Loeschung, wie der Knopf „Löschen" — und Loeschung.ablauf stoppt über
    // stoppeFallsLaeuft, bevor etwas gelöscht wird.
    await pruefe('Der Plugin-Abbau löscht über Loeschung, und die stoppt über stoppeFallsLaeuft', async () => {
        const { ohneKommentare } = require('./lib/quelltext');
        const quelle = (rel) => ohneKommentare(require('fs').readFileSync(path.join(__dirname, '..', rel), 'utf8'));
        const idx = quelle('plugins/gameserver/dashboard/index.js');
        const ab = idx.indexOf('async onGuildDisable(');
        const abbau = idx.slice(ab, idx.indexOf('\n    }\n', ab));
        assert.match(abbau, /Loeschung\.beginne\(server\.id, guildId\)/);
        assert.match(abbau, /Loeschung\.fuehreAus\(\{ server, guildId, erzwingen: true \}\)/);
        for (const eigen of ["'gameserver.stop'", "'gameserver.uninstall'", 'stoppeFallsLaeuft', 'setTimeout(resolve, 2000)']) {
            assert.ok(!abbau.includes(eigen), `${eigen} im Abbau — zweiter Weg neben Loeschung`);
        }
        const loeschung = quelle('plugins/gameserver/dashboard/helpers/Loeschung.js');
        const ablauf = loeschung.slice(loeschung.indexOf('async function ablauf('));
        assert.ok(ablauf.indexOf('ServerStopp.stoppeFallsLaeuft({ server, guildId })') < ablauf.indexOf("'gameserver.uninstall'"),
            'Loeschung deinstalliert vor dem Stopp');
    });

    await pruefe('Der Umzug ist als Ausnahme mit Grund benannt', async () => {
        const kopf = require('fs').readFileSync(path.join(HELFER, 'ServerStopp.js'), 'utf8');
        assert.match(kopf, /Ausnahme mit Grund: der Umzug/);
    });

    console.log(`\n${bestanden} Prüfung(en) bestanden.\n`);
    process.exit(process.exitCode || 0);
})();
