#!/usr/bin/env node
/**
 * Die Konsole hängt sich beim Start an den NEUEN Prozess — nicht erst bei
 * „online", und nie an die Logs des alten Containers.
 *
 * ── Was hier gehalten wird (2026-10-14) ─────────────────────────────────────
 *
 * Betreiber: „wenn man den Server installiert und anschließend direkt startet,
 * dann wechselt die Konsole nicht automatisch auf den neuen Start." Server 216
 * (Forge, 340 Mods) stürzte nach vier Sekunden ab — in der Konsole stand davon
 * nichts, bis man neu lud.
 *
 * Drei Fehler lagen übereinander:
 *
 *   Browser    hängte sich erst bei „online" an; „online" heißt spielbereit und
 *              kommt bei Forge nach Minuten oder, bei einem Absturz, nie
 *   Route      meldete immer `success: true`, auch wenn der Daemon ablehnte —
 *              die Wiederholungen im Browser griffen deshalb nie
 *   Daemon     fiel bei einem noch nicht angelegten Container auf die Logs des
 *              ALTEN zurück (Path B) und spielte dessen letzte 200 Zeilen ab
 *
 * Still schiefgehen kann:
 *
 *   Vergleich  1.0.99 gilt als neuer als 1.0.123 (Textvergleich) → ein alter
 *              Daemon bekommt `nur_laufend` und liefert alte Absturzzeilen
 *   Manager    `nur_laufend` geht an einen alten Daemon, oder `verbunden` ist
 *              wahr, obwohl der Daemon abgelehnt hat
 *   Browser    „starting" löst nichts aus; eine Ablehnung wird als Erfolg
 *              gelesen; ein zu alter Daemon wird endlos wiederholt
 *
 * Gegenstück im Daemon: `internal/gameserver/start_markierung_test.go`.
 *
 *   node scripts/check-konsole-beim-start.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ServiceManager } = require('dunebot-core');

const WURZEL = path.join(__dirname, '..');
const still = () => {};
for (const name of ['Logger', 'dbService', 'ipmServer', 'sseManager', 'eventRouter']) {
    if (!ServiceManager.has(name)) {
        ServiceManager.register(name, name === 'Logger'
            ? { debug: still, info: still, warn: still, error: still, success: still }
            : {});
    }
}

const ConsoleManager = require(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/ConsoleManager.js'));
const { fassungMindestens, NUR_LAUFEND_AB } = ConsoleManager;

let bestanden = 0;
async function pruefe(text, fn) {
    await fn();
    bestanden++;
    console.log(`  ✓ ${text}`);
}

// ── Manager mit Attrappen: Datenbank liefert die Daemon-Fassung, der Daemon
//    nimmt an oder lehnt ab. Unbekannte Abfragen werfen — sonst prüfte der
//    Wächter eine Abfrage, die es nicht gibt.
function manager({ fassung, daemonAntwort }) {
    const m = Object.create(ConsoleManager.prototype);
    m.Logger = ServiceManager.get('Logger');
    m.activeClients = new Map();
    m.consoleHistory = new Map();
    m.maxHistoryLines = 500;
    m.gesendet = [];
    m.dbService = {
        query: async (sql) => {
            if (/FROM gameservers/.test(sql)) return [{ id: 216, name: 'x', status: 'starting', guild_id: 'g', rootserver_id: 54 }];
            if (/FROM rootserver/.test(sql)) return [{ id: 54, daemon_id: 'd54', daemon_version: fassung }];
            throw new Error('unbekannte Abfrage: ' + sql);
        }
    };
    m.ipmServer = {
        sendCommand: async (daemonId, command, payload) => {
            m.gesendet.push({ daemonId, command, payload });
            return daemonAntwort;
        }
    };
    return m;
}

// ── Browser: die echte Klasse aus console-client.js in einer VM, ohne xterm.
function browser() {
    const quelle = fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/assets/js/console-client.js'), 'utf8');
    const anfragen = [];
    const zeitgeber = [];
    let antwort = null;
    const quellen = [];
    const kontext = {
        console: { log: still, warn: still, error: still, debug: still },
        document: { getElementById: () => null },
        window: { addEventListener: still },
        setTimeout: (fn, ms) => { zeitgeber.push({ fn, ms }); return zeitgeber.length; },
        fetch: (url, opt) => {
            anfragen.push({ url, body: opt && opt.body ? JSON.parse(opt.body) : null });
            return Promise.resolve({ json: () => Promise.resolve(antwort) });
        },
        EventSource: class {
            constructor(url) { this.url = url; this.horcher = {}; quellen.push(this); }
            addEventListener(art, fn) { this.horcher[art] = fn; }
            close() {}
        },
    };
    vm.createContext(kontext);
    vm.runInContext(quelle + '\nthis.GameserverConsoleClient = GameserverConsoleClient;', kontext);

    const k = Object.create(kontext.GameserverConsoleClient.prototype);
    k.config = { apiBase: '/guild/g/plugins/gameserver/console/216', guildId: 'g', serverId: '216' };
    k.terminal = { writeln: still, write: still, refresh: still, scrollToBottom: still, rows: 24 };
    k.fitAddon = { fit: still };
    k.connected = true;
    k._ptyAttached = false;
    k.setupSSE();

    const melde = (status) => quellen[0].horcher.gameserver({
        data: JSON.stringify({ data: { action: 'status_changed', server_id: '216', status } })
    });
    const warte = () => new Promise(r => setImmediate(r));
    return { k, anfragen, zeitgeber, melde, warte, setzeAntwort: (a) => { antwort = a; } };
}

(async () => {
    console.log('\n▸ Fassungsvergleich');

    await pruefe('1.0.123 und neuer zählen, 1.0.122 nicht', () => {
        assert.strictEqual(NUR_LAUFEND_AB, '1.0.123');
        assert.strictEqual(fassungMindestens('1.0.123', NUR_LAUFEND_AB), true);
        assert.strictEqual(fassungMindestens('1.0.124', NUR_LAUFEND_AB), true);
        assert.strictEqual(fassungMindestens('1.1.0', NUR_LAUFEND_AB), true);
        assert.strictEqual(fassungMindestens('1.0.122', NUR_LAUFEND_AB), false);
    });
    await pruefe('Zahlen, nicht Text: 1.0.99 ist älter als 1.0.123', () => {
        assert.strictEqual(fassungMindestens('1.0.99', NUR_LAUFEND_AB), false);
        assert.strictEqual(fassungMindestens('1.0.1230', NUR_LAUFEND_AB), true);
    });
    await pruefe('Unbekannte Fassung gilt als alt', () => {
        for (const v of [null, undefined, '', 'dev', '1.0', '1.0.x']) {
            assert.strictEqual(fassungMindestens(v, NUR_LAUFEND_AB), false, String(v));
        }
    });

    console.log('\n▸ ConsoleManager.attach');

    await pruefe('Beim Start mit neuem Daemon: nur_laufend geht mit, verbunden ist wahr', async () => {
        const m = manager({ fassung: '1.0.123', daemonAntwort: { success: true, data: { history: [] } } });
        const r = await m.attach('g', '216', 'u-1', 'gs', { nurLaufend: true });
        assert.strictEqual(m.gesendet.length, 1);
        assert.strictEqual(m.gesendet[0].command, 'console:attach');
        assert.strictEqual(m.gesendet[0].payload.nur_laufend, true);
        assert.strictEqual(r.verbunden, true);
        assert.strictEqual(r.grund, null);
    });
    await pruefe('Beim Start mit altem Daemon: keine Anfrage, Grund daemon_alt', async () => {
        const m = manager({ fassung: '1.0.122', daemonAntwort: { success: true } });
        const r = await m.attach('g', '216', 'u-1', 'gs', { nurLaufend: true });
        assert.strictEqual(m.gesendet.length, 0, 'ein alter Daemon spielte die Logs des alten Containers ab');
        assert.strictEqual(r.verbunden, false);
        assert.strictEqual(r.grund, 'daemon_alt');
    });
    await pruefe('Daemon lehnt ab: verbunden ist falsch (Gegenprobe zum Erfolg)', async () => {
        const m = manager({ fassung: '1.0.123', daemonAntwort: { success: false, error: 'Server startet nicht' } });
        const r = await m.attach('g', '216', 'u-1', 'gs', { nurLaufend: true });
        assert.strictEqual(m.gesendet.length, 1);
        assert.strictEqual(r.verbunden, false);
        assert.strictEqual(r.grund, 'daemon_lehnt_ab');
    });
    await pruefe('Normales Öffnen der Konsole: alter Daemon wird gefragt, ohne nur_laufend', async () => {
        const m = manager({ fassung: '1.0.122', daemonAntwort: { success: true, data: { history: ['a'] } } });
        const r = await m.attach('g', '216', 'u-1', 'gs');
        assert.strictEqual(m.gesendet.length, 1);
        assert.strictEqual('nur_laufend' in m.gesendet[0].payload, false);
        assert.strictEqual(r.verbunden, true);
        assert.deepStrictEqual(r.history.map(h => h.line), ['a']);
    });

    console.log('\n▸ Konsole im Browser');

    await pruefe('„starting" hängt sich sofort an, mit nur_laufend', async () => {
        const b = browser();
        b.setzeAntwort({ success: true, verbunden: true, client_id: 'c' });
        b.melde('starting');
        await b.warte();
        assert.strictEqual(b.anfragen.length, 1, 'bei „starting" ging keine Anfrage raus');
        assert.ok(b.anfragen[0].url.endsWith('/attach'));
        assert.deepStrictEqual(b.anfragen[0].body, { nur_laufend: true });
        assert.strictEqual(b.k._ptyAttached, true);
    });
    await pruefe('Danach löst „online" keine zweite Anfrage aus', async () => {
        const b = browser();
        b.setzeAntwort({ success: true, verbunden: true });
        b.melde('starting');
        await b.warte();
        b.melde('online');
        await b.warte();
        assert.strictEqual(b.anfragen.length, 1);
    });
    await pruefe('success ohne verbunden ist kein Erfolg — es wird wiederholt', async () => {
        const b = browser();
        b.setzeAntwort({ success: true, verbunden: false, grund: 'daemon_lehnt_ab' });
        b.melde('starting');
        await b.warte();
        assert.strictEqual(b.k._ptyAttached, false);
        assert.strictEqual(b.zeitgeber.length, 1, 'keine Wiederholung geplant');
        b.setzeAntwort({ success: true, verbunden: true });
        b.zeitgeber[0].fn();
        await b.warte();
        assert.strictEqual(b.anfragen.length, 2);
        assert.deepStrictEqual(b.anfragen[1].body, { nur_laufend: true }, 'die Wiederholung verlor nur_laufend');
        assert.strictEqual(b.k._ptyAttached, true);
    });
    await pruefe('Zu alter Daemon: keine Wiederholung, „online" holt nach wie bisher', async () => {
        const b = browser();
        b.setzeAntwort({ success: true, verbunden: false, grund: 'daemon_alt' });
        b.melde('starting');
        await b.warte();
        assert.strictEqual(b.zeitgeber.length, 0);
        b.setzeAntwort({ success: true, verbunden: true });
        b.melde('online');
        await b.warte();
        assert.strictEqual(b.anfragen.length, 2);
        assert.deepStrictEqual(b.anfragen[1].body, {}, 'bei „online" darf nur_laufend nicht mitgehen');
        assert.strictEqual(b.k._ptyAttached, true);
    });
    await pruefe('Ein Dashboard ohne verbunden-Feld wird wie bisher an success gemessen', async () => {
        const b = browser();
        b.setzeAntwort({ success: true });
        b.melde('online');
        await b.warte();
        assert.strictEqual(b.k._ptyAttached, true);
    });

    console.log(`\n${bestanden} Prüfung(en) bestanden.`);
})().catch((fehler) => {
    console.error('\n✗', fehler.message);
    process.exit(1);
});
