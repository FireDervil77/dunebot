#!/usr/bin/env node
/**
 * Werkbank, Stufe 1 — ohne Daemon, ohne Datenbank.
 *
 * ── Was hier gehalten wird (2026-09-24) ─────────────────────────────────────
 *
 * Die Werkbank spricht mit dem Daemon über Namen, die auf zwei Seiten stehen:
 *
 *   Befehle     werkbank.schritt · verwerfen · starten · stoppen · eingabe
 *               (internal/websocket/client.go)
 *   Ereignisse  werkbank.status|output|fertig|fehlgeschlagen, und seit Stufe 2
 *               gestartet|konsole|bereitschaft|ports|beendet  (pkg/protocol/messages.go)
 *   Kennung     reSitzung im Daemon  ↔  RE_KENNUNG im Plugin
 *
 * Ein Tippfehler auf einer Seite fällt nirgends auf: Der Schritt läuft, die
 * Ausgabe kommt nie an, der Status bleibt „läuft". Deshalb liest dieser
 * Wächter die Namen aus dem Daemon-Code, statt sie abzuschreiben.
 *
 * Dazu die Abläufe mit Attrappen, die bei unbekannten Abfragen WERFEN.
 *
 *   node scripts/check-werkbank.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare } = require('./lib/quelltext');

const DAEMON = '/home/firedervil/firebot_daemon';
const still = () => {};
ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });

// ── Attrappen ────────────────────────────────────────────────────────────────
const db = {
    schritte: [],            // {id, sitzung_id, nr, schritt, status, ausgabe, fehler, bytes}
    updates: [],             // geschriebene Ausgabe-Stücke
    laeufe: [],              // {id, sitzung_id, status, konsole, ports, ...}
    konsole: [],             // geschriebene Konsolen-Stücke
    entwurf: null,           // zuletzt geschriebener Entwurf
    pruefungen: [],          // {id, sitzung_id, status, entwurf, entwurf_hash, ergebnis, protokoll}
    pruefSchreiben: [],      // Protokoll-Stücke mit dem Status der Prüfung in dem Moment
    fassungen: {},           // slug → [version] in package_versions
    sitzung: { id: 7, kennung: 'wbprobe', guild_id: 'g1', rootserver_id: 54, image: { ref: 'r/fb/base', tag: '2026.09', digest: 'sha256:x' } },
    async query(sql, p) {
        const t = String(sql).replace(/\s+/g, ' ').trim();
        if (/^SELECT id FROM werkbank_schritte WHERE sitzung_id = \? AND status = 'laeuft' LIMIT 1$/.test(t)) {
            return this.schritte.filter(s => s.sitzung_id === p[0] && s.status === 'laeuft').slice(0, 1);
        }
        if (/^SELECT daemon_id FROM rootserver WHERE id = \?$/.test(t)) return [{ daemon_id: 'd1' }];
        if (/^SELECT COALESCE\(MAX\(nr\), 0\) \+ 1 AS naechste FROM werkbank_schritte WHERE sitzung_id = \?$/.test(t)) {
            return [{ naechste: this.schritte.reduce((m, s) => Math.max(m, s.nr), 0) + 1 }];
        }
        if (/^INSERT INTO werkbank_schritte \(sitzung_id, nr, schritt, status\) VALUES \(\?, \?, \?, 'laeuft'\)$/.test(t)) {
            const id = this.schritte.length + 100;
            this.schritte.push({ id, sitzung_id: p[0], nr: p[1], schritt: p[2], status: 'laeuft', ausgabe: '' });
            return { insertId: id };
        }
        if (/^UPDATE werkbank_schritte SET status = \?, fehler = \?, bytes = \?, beendet_am = NOW\(\) WHERE id = \? AND status = 'laeuft'$/.test(t)) {
            const s = this.schritte.find(x => x.id === p[3] && x.status === 'laeuft');
            if (s) Object.assign(s, { status: p[0], fehler: p[1], bytes: p[2] });
            return { affectedRows: s ? 1 : 0 };
        }
        if (/^UPDATE werkbank_schritte SET ausgabe = RIGHT\(CONCAT\(COALESCE\(ausgabe, ''\), \?\), \?\) WHERE id = \?$/.test(t)) {
            const s = this.schritte.find(x => x.id === p[2]);
            this.updates.push(p[0]);
            if (s) s.ausgabe = (s.ausgabe + p[0]).slice(-p[1]);
            return { affectedRows: 1 };
        }
        if (/^UPDATE werkbank_sitzungen SET updated_at = NOW\(\) WHERE id = \?$/.test(t)) return { affectedRows: 1 };
        if (/^SELECT x\.id AS schrittId, s\.guild_id AS guildId FROM werkbank_schritte x JOIN werkbank_sitzungen s ON s\.id = x\.sitzung_id WHERE s\.kennung = \? AND x\.status = 'laeuft'/.test(t)) {
            // Nur die Sitzung, nach der gefragt wird — die Attrappe bildet den
            // Filter der echten Abfrage ab, sonst prueft sie nichts.
            if (p[0] !== this.sitzung.kennung) return [];
            const s = this.schritte.find(x => x.status === 'laeuft' && x.sitzung_id === this.sitzung.id);
            return s ? [{ schrittId: s.id, guildId: 'g1' }] : [];
        }
        // ── Stufe 2 ──
        if (/^SELECT l\.id AS laufId, s\.guild_id AS guildId, l\.status FROM werkbank_laeufe l JOIN werkbank_sitzungen s ON s\.id = l\.sitzung_id WHERE s\.kennung = \? AND l\.status <> 'beendet' ORDER BY l\.id DESC LIMIT 1$/.test(t)) {
            if (p[0] !== this.sitzung.kennung) return [];
            const l = [...this.laeufe].reverse().find(x => x.status !== 'beendet' && x.sitzung_id === this.sitzung.id);
            return l ? [{ laufId: l.id, guildId: 'g1', status: l.status }] : [];
        }
        if (/^INSERT INTO werkbank_laeufe \(sitzung_id, status, memory_mb, cpu_prozent, start\) VALUES \(\?, 'startet', \?, \?, \?\)$/.test(t)) {
            const id = this.laeufe.length + 500;
            this.laeufe.push({ id, sitzung_id: p[0], status: 'startet', memory_mb: p[1], cpu_prozent: p[2], start: p[3], konsole: '' });
            return { insertId: id };
        }
        if (/^UPDATE werkbank_laeufe SET status = 'beendet', exit_code = \?, gestoppt = \?, fehler = \?, dateien = \?, beendet_am = NOW\(\) WHERE id = \? AND status <> 'beendet'$/.test(t)) {
            const l = this.laeufe.find(x => x.id === p[4] && x.status !== 'beendet');
            if (l) Object.assign(l, { status: 'beendet', exit_code: p[0], gestoppt: p[1], fehler: p[2], dateien: p[3] });
            return { affectedRows: l ? 1 : 0 };
        }
        if (/^UPDATE werkbank_laeufe SET status = 'stoppt' WHERE id = \? AND status <> 'beendet'$/.test(t)) {
            const l = this.laeufe.find(x => x.id === p[0] && x.status !== 'beendet');
            if (l) l.status = 'stoppt';
            return { affectedRows: l ? 1 : 0 };
        }
        if (/^UPDATE werkbank_laeufe SET konsole = RIGHT\(CONCAT\(COALESCE\(konsole, ''\), \?\), \?\) WHERE id = \?$/.test(t)) {
            const l = this.laeufe.find(x => x.id === p[2]);
            // Mit dem Stand des Laufs in dem Moment — die Reihenfolge ist die Aussage.
            this.konsole.push({ text: p[0], status: l && l.status });
            if (l) l.konsole = (l.konsole + p[0]).slice(-p[1]);
            return { affectedRows: 1 };
        }
        const setzen = t.match(/^UPDATE werkbank_laeufe SET ((?:(?:status|luecken|bereitschaft|ports) = \?(?:, )?)+) WHERE id = \?$/);
        if (setzen) {
            const spalten = setzen[1].split(', ').map(x => x.replace(' = ?', ''));
            const l = this.laeufe.find(x => x.id === p[spalten.length]);
            spalten.forEach((k, i) => { if (l) l[k] = p[i]; });
            return { affectedRows: l ? 1 : 0 };
        }
        // ── Stufe 3 ──
        if (/^SELECT p\.id AS pruefId, s\.guild_id AS guildId FROM werkbank_pruefungen p JOIN werkbank_sitzungen s ON s\.id = p\.sitzung_id WHERE s\.kennung = \? AND p\.status = 'laeuft' ORDER BY p\.id DESC LIMIT 1$/.test(t)) {
            if (p[0] !== this.sitzung.kennung) return [];
            const x = [...this.pruefungen].reverse().find(y => y.status === 'laeuft' && y.sitzung_id === this.sitzung.id);
            return x ? [{ pruefId: x.id, guildId: 'g1' }] : [];
        }
        if (/^INSERT INTO werkbank_pruefungen \(sitzung_id, status, entwurf, entwurf_hash\) VALUES \(\?, 'laeuft', \?, \?\)$/.test(t)) {
            const id = this.pruefungen.length + 900;
            this.pruefungen.push({ id, sitzung_id: p[0], status: 'laeuft', entwurf: p[1], entwurf_hash: p[2], protokoll: '' });
            return { insertId: id };
        }
        if (/^UPDATE werkbank_pruefungen SET protokoll = RIGHT\(CONCAT\(COALESCE\(protokoll, ''\), \?\), \?\) WHERE id = \?$/.test(t)) {
            const x = this.pruefungen.find(y => y.id === p[2]);
            this.pruefSchreiben.push({ text: p[0], status: x && x.status });
            if (x) x.protokoll = (x.protokoll + p[0]).slice(-p[1]);
            return { affectedRows: 1 };
        }
        if (/^UPDATE werkbank_pruefungen SET status = \?, ergebnis = \?, beendet_am = NOW\(\) WHERE id = \? AND status = 'laeuft'$/.test(t)) {
            const x = this.pruefungen.find(y => y.id === p[2] && y.status === 'laeuft');
            if (x) Object.assign(x, { status: p[0], ergebnis: p[1] });
            return { affectedRows: x ? 1 : 0 };
        }
        // ── Stufe 4 ──
        if (/^SELECT pv\.version FROM package_versions pv JOIN packages p ON p\.id = pv\.package_id WHERE p\.slug = \?$/.test(t)) {
            return (this.fassungen[p[0]] || []).map(version => ({ version }));
        }
        if (/^UPDATE werkbank_sitzungen SET entwurf = \? WHERE id = \?$/.test(t)) {
            this.entwurf = JSON.parse(p[0]);
            return { affectedRows: 1 };
        }
        throw new Error('Unerwartete Abfrage: ' + t.slice(0, 100));
    },
};
const daemon = {
    online: true, antwort: { success: true }, befehle: [],
    isDaemonOnline() { return this.online; },
    async sendCommand(d, befehl, nutzlast) { this.befehle.push({ befehl, nutzlast }); return this.antwort; },
};
const sse = { gesendet: [], broadcast(g, ns, daten) { this.gesendet.push({ g, ns, daten }); } };
ServiceManager.register('dbService', db);
ServiceManager.register('ipmServer', daemon);
ServiceManager.register('sseManager', sse);

const HELFER = path.join(__dirname, '../plugins/werkbank/dashboard/helpers');
const Sitzungen = require(path.join(HELFER, 'Sitzungen.js'));
const Ereignisse = require(path.join(HELFER, 'Ereignisse.js'));
const { schrittAusFormular, startAusFormular, startAlsFormular } = require('../plugins/werkbank/dashboard/routes/guild.router.js');

let bestanden = 0;
async function pruefe(name, fn) {
    db.schritte = []; db.updates = []; daemon.befehle = []; daemon.online = true;
    db.laeufe = []; db.konsole = []; db.entwurf = null; db.pruefungen = []; db.pruefSchreiben = []; db.fassungen = {};
    daemon.antwort = { success: true }; sse.gesendet = [];
    Ereignisse._laufend.clear(); Ereignisse._puffer.clear();
    Ereignisse._laeufe.clear(); Ereignisse._konsolenPuffer.clear();
    Ereignisse._pruefungen.clear(); Ereignisse._pruefPuffer.clear();
    try { await fn(); console.log(`  ✓ ${name}`); bestanden++; }
    catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

(async () => {
    console.log('\nVerträge mit dem Daemon');

    await pruefe('die Kennungsregel ist auf beiden Seiten dieselbe', async () => {
        const go = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/gameserver/werkbank.go'), 'utf8'));
        const m = go.match(/reSitzung\s*=\s*regexp\.MustCompile\(`([^`]+)`\)/);
        assert.ok(m, 'reSitzung nicht gefunden');
        assert.strictEqual(Sitzungen.RE_KENNUNG.source, m[1]);
    });

    await pruefe('die Befehle, die das Plugin schickt, kennt der Daemon', async () => {
        const client = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/websocket/client.go'), 'utf8'));
        const plugin = ohneKommentare(fs.readFileSync(path.join(HELFER, 'Sitzungen.js'), 'utf8'));
        // Zwei Schreibweisen: direkt, und über daemonFuer(...).senden('werkbank.x', …).
        const geschickt = [...plugin.matchAll(/(?:sendCommand\([^,]+,|senden\()\s*'(werkbank\.[a-z]+)'/g)].map(x => x[1]);
        for (const b of ['werkbank.schritt', 'werkbank.verwerfen', 'werkbank.starten', 'werkbank.stoppen', 'werkbank.eingabe', 'werkbank.dateien', 'werkbank.pruefen']) {
            assert.ok(geschickt.includes(b), `${b} wird nicht (mehr) geschickt — die Suche sieht ${geschickt}`);
        }
        for (const b of geschickt) assert.ok(client.includes(`case "${b}":`), `${b} fehlt im Daemon`);
    });

    await pruefe('die Ereignisse, die der Daemon schickt, fängt das Plugin', async () => {
        const proto = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'pkg/protocol/messages.go'), 'utf8'));
        assert.match(proto, /NSWerkbank\s+Namespace\s*=\s*"werkbank"/);
        const aktionen = ['WerkbankStatus', 'WerkbankAusgabe', 'WerkbankFertig', 'WerkbankFehlgeschlagen',
            'WerkbankGestartet', 'WerkbankKonsole', 'WerkbankBereitschaft', 'WerkbankPorts', 'WerkbankBeendet',
            'WerkbankPruefung']
            .map(k => (proto.match(new RegExp(k + '\\s*=\\s*"([a-z]+)"')) || [])[1]);
        const plugin = ohneKommentare(fs.readFileSync(path.join(HELFER, 'Ereignisse.js'), 'utf8'));
        for (const a of aktionen) {
            assert.ok(a, 'Aktion im Daemon nicht gefunden');
            assert.ok(plugin.includes(`register(NS, '${a}'`), `werkbank.${a} wird nicht gefangen`);
        }
    });

    console.log('\nFormular → Schritt');

    await pruefe('nur die Felder des Typs, Zahlen und Ja/Nein umgewandelt', async () => {
        const s = schrittAusFormular({ type: 'extract', archive: 'a.tar.xz', strip_components: '1',
            delete_archive: false, url: 'https://soll-nicht-mit', beschreibung: 'Auspacken' });
        assert.deepStrictEqual(s, { type: 'extract', description: { de: 'Auspacken' }, archive: 'a.tar.xz',
            strip_components: 1, delete_archive: false });
        const d = schrittAusFormular({ type: 'download', url: ' https://x/y ', target: 'y', checksum: 'SHA256:AB' });
        assert.strictEqual(d.url, 'https://x/y');
        assert.strictEqual(d.checksum, 'sha256:ab', 'Prüfsumme klein — das Schema verlangt [0-9a-f]');
        assert.strictEqual(schrittAusFormular({ type: 'steamcmd', app: '896660', validate: 'on' }).app, 896660);
    });

    console.log('\nAusführen');

    await pruefe('ein Schritt geht als werkbank.schritt mit sitzung_id und dem Image der Sitzung', async () => {
        const r = await Sitzungen.schrittAusfuehren({ sitzung: db.sitzung, schritt: { type: 'mkdir', path: 'mods' } });
        assert.strictEqual(r.angenommen, true);
        const b = daemon.befehle[0];
        assert.strictEqual(b.befehl, 'werkbank.schritt');
        assert.strictEqual(b.nutzlast.sitzung_id, 'wbprobe');
        assert.ok(!('server_id' in b.nutzlast), 'eine server_id liesse das Dashboard einen Server suchen');
        assert.deepStrictEqual(b.nutzlast.image, db.sitzung.image);
        assert.strictEqual(db.schritte[0].status, 'laeuft');
    });

    await pruefe('unbekannter Typ, beschäftigte Sitzung, Daemon weg → nichts wird geschickt', async () => {
        await assert.rejects(Sitzungen.schrittAusfuehren({ sitzung: db.sitzung, schritt: { type: 'chown', path: 'x' } }));
        db.schritte.push({ id: 1, sitzung_id: 7, nr: 1, status: 'laeuft' });
        await assert.rejects(Sitzungen.schrittAusfuehren({ sitzung: db.sitzung, schritt: { type: 'mkdir', path: 'x' } }), /läuft schon/);
        db.schritte = []; daemon.online = false;
        await assert.rejects(Sitzungen.schrittAusfuehren({ sitzung: db.sitzung, schritt: { type: 'mkdir', path: 'x' } }), /nicht erreichbar/);
        assert.strictEqual(daemon.befehle.length, 0);
    });

    await pruefe('weist der Daemon ab, steht der Schritt als gescheitert mit seinem Grund da', async () => {
        daemon.antwort = { success: false, error: 'der Schritt ist nicht ausfuehrbar: [checksum ""]' };
        const r = await Sitzungen.schrittAusfuehren({ sitzung: db.sitzung, schritt: { type: 'download', url: 'https://x', target: 'y' } });
        assert.strictEqual(r.angenommen, false);
        assert.strictEqual(db.schritte[0].status, 'fehler');
        assert.match(db.schritte[0].fehler, /checksum/);
    });

    console.log('\nEreignisse');

    await pruefe('Ausgabe sofort per SSE, in die Datenbank gebündelt — und VOR dem Status', async () => {
        await Sitzungen.schrittAusfuehren({ sitzung: db.sitzung, schritt: { type: 'mkdir', path: 'mods' } });
        const id = db.schritte[0].id;
        for (let i = 1; i <= 3; i++) await Ereignisse.beiAusgabe({ sitzung_id: 'wbprobe', line: 'Zeile ' + i });
        assert.strictEqual(sse.gesendet.filter(x => x.daten.action === 'output').length, 3, 'jede Zeile sofort');
        assert.strictEqual(db.updates.length, 0, 'noch nichts geschrieben — gebündelt');
        await Ereignisse.beiEnde({ sitzung_id: 'wbprobe', bytes: 11 }, true);
        assert.strictEqual(db.updates.length, 1, 'ein Schreibvorgang für drei Zeilen');
        const s = db.schritte.find(x => x.id === id);
        assert.strictEqual(s.ausgabe, 'Zeile 1\nZeile 2\nZeile 3\n');
        assert.strictEqual(s.status, 'ok');
        assert.strictEqual(s.bytes, 11);
        const ende = sse.gesendet.find(x => x.daten.action === 'fertig');
        assert.ok(ende && ende.ns === 'werkbank' && ende.g === 'g1');
    });

    await pruefe('fehlgeschlagen setzt den Grund; eine fremde Sitzung wird nicht angefasst', async () => {
        await Sitzungen.schrittAusfuehren({ sitzung: db.sitzung, schritt: { type: 'mkdir', path: 'mods' } });
        await Ereignisse.beiAusgabe({ sitzung_id: 'wbfremd', line: 'nicht meins' });
        assert.strictEqual(sse.gesendet.length, 0, 'fremde Sitzung ohne laufenden Schritt — nichts gesendet');
        await Ereignisse.beiEnde({ sitzung_id: 'wbprobe', error: 'Schritt endete mit Code 1' }, false);
        assert.strictEqual(db.schritte[0].status, 'fehler');
        assert.match(db.schritte[0].fehler, /Code 1/);
    });

    await pruefe('nach einem Neustart des Dashboards findet das Ende den Schritt über die Datenbank', async () => {
        db.schritte.push({ id: 55, sitzung_id: 7, nr: 1, status: 'laeuft', ausgabe: '' });
        await Ereignisse.beiEnde({ sitzung_id: 'wbprobe', bytes: 0 }, true);
        assert.strictEqual(db.schritte[0].status, 'ok');
    });

    console.log('\nEntwurf');

    await pruefe('nur Schritte „im Entwurf", in ihrer Reihenfolge — nichts doppelt gespeichert', async () => {
        const e = Sitzungen.entwurfAlsPaket({ ...db.sitzung, entwurf: { identity: { name: 'Terraria' } } }, [
            { nr: 1, status: 'ok', schritt: { type: 'download' } },
            { nr: 2, status: 'fehler', schritt: { type: 'extract' } },
            { nr: 3, status: 'herausgenommen', schritt: { type: 'mkdir' } },
            { nr: 4, status: 'ok', schritt: { type: 'template' } },
        ]);
        assert.deepStrictEqual(e.install.steps.map(s => s.type), ['download', 'template']);
        assert.strictEqual(e.identity.name, 'Terraria');
        assert.deepStrictEqual(e.image, db.sitzung.image);
    });

    console.log('\nProbestart (Stufe 2)');

    const sitzungMitStart = () => ({ ...db.sitzung, entwurf: {
        identity: { name: 'Factorio' },
        ports: [{ purpose: 'game', protocol: 'udp', assign: 'pool' }],
        start: { program: './bin/x64/factorio', args: [{ key: 'arg1', parts: [{ text: '{{port:game}}' }] }] },
        werkbank: { portnummern: { game: 34197 }, memory_mb: 2048, cpu_prozent: 150 },
    } });

    await pruefe('Formular → Startteil: eine Zeile ein Argument, Stoppfolge mit Frist, gültig nach Schema', async () => {
        const start = startAusFormular({ program: './bin/x64/factorio', args: '--start-server\nsaves/welt.zip\n{{port:game}}',
            stop: 'command:/quit 30 beendet\nrcon:/save 60 weiter\nsigkill 5', ready_port: 'game', log_line: 'Hosting game', timeout_sec: '120' });
        assert.deepStrictEqual(start.args[2], { key: 'arg3', parts: [{ text: '{{port:game}}' }] });
        assert.deepStrictEqual(start.stop.sequence, [
            { step: 'command:/quit', timeout_sec: 30, terminates: true },
            { step: 'rcon:/save', timeout_sec: 60, terminates: false },
            { step: 'sigkill', timeout_sec: 5, terminates: true },
        ]);
        const Ajv = require('ajv');
        const schema = require('../packages/fbpkg/schema/fbpkg-v1.schema.json');
        const pruefer = new Ajv({ allErrors: true, jsonPointers: true }).compile({ ...schema.properties.start, definitions: schema.definitions });
        assert.ok(pruefer(start), JSON.stringify(pruefer.errors));
        assert.deepStrictEqual(startAusFormular(startAlsFormular(start)), start, 'hin und zurück verlustfrei');
        assert.throws(() => startAusFormular({ program: 'x', stop: 'rm -rf /' }), /Stoppfolge/);
        // Job.Validate (Daemon + fb-init) verlangt sigkill am Ende — gemessen
        // am 2026-09-24 als „Beendet mit Code -1", weil das Formular es nicht sagte.
        assert.throws(() => startAusFormular({ program: 'x', stop: 'command:/quit 30 beendet' }), /sigkill/);
        assert.throws(() => startAusFormular({ program: 'x', stop: '' }), /Stoppfolge fehlt/);
        // Die Ausnahme von der Portpflicht — dieselben Regeln wie Job.Validate.
        const ausnahme = startAusFormular({ program: 'x', stop: 'sigkill 10', log_line: 'server create success', without_port: 'P2P' });
        assert.deepStrictEqual(ausnahme.ready_when, { log_line: 'server create success', without_port: 'P2P' });
        assert.ok(pruefer(ausnahme), JSON.stringify(pruefer.errors));
        assert.strictEqual(startAlsFormular(ausnahme).without_port, 'P2P', 'zurück ins Formular');
        assert.throws(() => startAusFormular({ program: 'x', stop: 'sigkill 10', ready_port: 'game', log_line: 'a', without_port: 'P2P' }), /nur ohne/);
        assert.throws(() => startAusFormular({ program: 'x', stop: 'sigkill 10', without_port: 'P2P' }), /Zeile/);
        // Das Schema lehnt ab, was Job.Validate ablehnen würde.
        const mit = (r) => pruefer({ ...ausnahme, ready_when: r });
        assert.ok(!mit({ log_line: 'x' }), 'Zeile ohne Port und ohne Ausnahme');
        assert.ok(!mit({ without_port: 'P2P' }), 'Ausnahme ohne Zeile');
        assert.ok(!mit({ port: 'game', without_port: 'P2P', log_line: 'x' }), 'Ausnahme neben Port');
        assert.ok(!mit({ without_port: 'P2P', log_line: ' ' }), 'leere Zeile');
        assert.ok(mit({ port: 'game' }), 'Port allein');
        assert.match(startAlsFormular(undefined).stop, /sigkill 10$/, 'leer: Vorschlag im Feld');
    });

    await pruefe('Starten schickt Startteil, Portnummern und RAM/CPU — und legt einen Lauf an', async () => {
        const s = sitzungMitStart();
        const r = await Sitzungen.starten(s, [{ status: 'ok', schritt: { type: 'download' } }, { status: 'fehler', schritt: { type: 'x' } }]);
        const b = daemon.befehle[0];
        assert.strictEqual(b.befehl, 'werkbank.starten');
        assert.strictEqual(b.nutzlast.sitzung_id, 'wbprobe');
        assert.deepStrictEqual(b.nutzlast.portnummern, { game: 34197 });
        assert.strictEqual(b.nutzlast.memory_mb, 2048);
        assert.strictEqual(b.nutzlast.cpu_prozent, 150);
        assert.deepStrictEqual(b.nutzlast.install.steps.map(x => x.type), ['download'], 'nur Schritte im Entwurf');
        assert.strictEqual(db.laeufe[0].id, r.laufId);
        assert.strictEqual(db.laeufe[0].status, 'startet');
    });

    await pruefe('ohne Bereitschaft: Erkundungsstart — Platzhalter nur im Start, nie im Entwurf', async () => {
        const s = sitzungMitStart();
        await Sitzungen.starten(s, []);
        const gesendet = daemon.befehle[0].nutzlast.start;
        // Portpflicht (Baustelle 158): ohne Port nur als begründete Ausnahme.
        assert.strictEqual(gesendet.ready_when.without_port, Sitzungen.ERKUNDUNG, 'Job.Validate braucht Port oder Ausnahme');
        assert.strictEqual(gesendet.ready_when.log_line, Sitzungen.ERKUNDUNG, 'die Ausnahme braucht eine Zeile');
        assert.ok(!s.entwurf.start.ready_when, 'der Entwurf bleibt ohne — Stufe 3 soll ihn weiter abweisen');
        assert.strictEqual(db.entwurf, null, 'nichts in den Entwurf geschrieben');
        daemon.befehle = []; db.laeufe = []; Ereignisse._laeufe.clear();
        s.entwurf.start.ready_when = { log_line: 'Hosting game' };
        await Sitzungen.starten(s, []);
        assert.deepStrictEqual(daemon.befehle[0].nutzlast.start.ready_when,
            { log_line: 'Hosting game', without_port: Sitzungen.ERKUNDUNG }, 'eine getippte Zeile wird in der Erkundung wirklich geprüft');
        daemon.befehle = []; db.laeufe = []; Ereignisse._laeufe.clear();
        s.entwurf.start.ready_when = { port: 'game' };
        await Sitzungen.starten(s, []);
        assert.deepStrictEqual(daemon.befehle[0].nutzlast.start.ready_when, { port: 'game' }, 'mit Bedingung: unverändert');
    });

    await pruefe('weist der Daemon den Start ab, ist der Lauf beendet mit Grund', async () => {
        daemon.antwort = { success: false, error: 'Arbeitsspeicher 40 MB: erlaubt sind 128 bis 262144 MB' };
        await assert.rejects(Sitzungen.starten(sitzungMitStart(), []), /Arbeitsspeicher/);
        assert.strictEqual(db.laeufe[0].status, 'beendet');
        assert.match(db.laeufe[0].fehler, /Arbeitsspeicher/);
    });

    await pruefe('während das Spiel läuft: kein Schritt, kein zweiter Start, kein Verwerfen', async () => {
        await Sitzungen.starten(sitzungMitStart(), []);
        daemon.befehle = [];
        await assert.rejects(Sitzungen.schrittAusfuehren({ sitzung: db.sitzung, schritt: { type: 'mkdir', path: 'x' } }), /läuft/);
        await assert.rejects(Sitzungen.starten(sitzungMitStart(), []), /läuft/);
        await assert.rejects(Sitzungen.verwerfen(db.sitzung), /läuft/);
        assert.strictEqual(daemon.befehle.length, 0);
    });

    await pruefe('Konsole gebündelt, Ports gespeichert, beim Ende erst die Konsole, dann der Status', async () => {
        await Sitzungen.starten(sitzungMitStart(), []);
        const lauf = db.laeufe[0];
        await Ereignisse.beiGestartet({ sitzung_id: 'wbprobe', luecken: ['start.stop: fehlt'] });
        assert.strictEqual(lauf.status, 'laeuft');
        for (let i = 1; i <= 3; i++) await Ereignisse.beiKonsole({ sitzung_id: 'wbprobe', line: 'K' + i });
        assert.strictEqual(sse.gesendet.filter(x => x.daten.action === 'konsole').length, 3);
        assert.strictEqual(db.konsole.length, 0, 'noch gebündelt');
        await Ereignisse.beiPorts({ sitzung_id: 'wbprobe', ports: [{ protocol: 'udp', port: 34197 }] });
        assert.deepStrictEqual(JSON.parse(lauf.ports), [{ protocol: 'udp', port: 34197 }]);
        await Ereignisse.beiBereitschaft({ sitzung_id: 'wbprobe', server_id: 'werkbank-wbprobe', type: 'ready', stage: 'port' });
        assert.ok(!('server_id' in JSON.parse(lauf.bereitschaft)), 'server_id des Daemons gehört nicht in die Anzeige');
        const dateien = { neu: [{ pfad: 'game/config/config.ini', groesse: 5 }], geaendert: [], weg: [],
            anzahl_neu: 1, anzahl_geaendert: 0, anzahl_weg: 0 };
        await Ereignisse.beiBeendet({ sitzung_id: 'wbprobe', exit_code: 0, gestoppt: true, dateien });
        assert.deepStrictEqual(JSON.parse(lauf.dateien), dateien, 'der Dateivergleich gehört zum Lauf');
        assert.strictEqual(lauf.konsole, 'K1\nK2\nK3\n');
        assert.notStrictEqual(db.konsole[0].status, 'beendet', 'die Konsole muss VOR dem Status „beendet" geschrieben sein');
        assert.strictEqual(lauf.status, 'beendet');
        assert.strictEqual(lauf.exit_code, 0);
        assert.ok(sse.gesendet.some(x => x.daten.action === 'beendet'));
    });

    await pruefe('Ereignisse einer fremden Sitzung fassen keinen Lauf an', async () => {
        await Sitzungen.starten(sitzungMitStart(), []);
        await Ereignisse.beiKonsole({ sitzung_id: 'wbfremd', line: 'nicht meins' });
        await Ereignisse.beiBeendet({ sitzung_id: 'wbfremd', exit_code: 1 });
        assert.strictEqual(db.laeufe[0].status, 'startet');
        assert.strictEqual(sse.gesendet.length, 0);
    });

    await pruefe('Port übernehmen: Zweck ins Paket, Nummer zur Sitzung', async () => {
        const s = sitzungMitStart();
        await assert.rejects(Sitzungen.portUebernehmen(s, { zweck: 'Game Port', protocol: 'udp', port: 1 }), /Zweck/);
        await assert.rejects(Sitzungen.portUebernehmen(s, { zweck: 'rcon', protocol: 'udp', port: 70000 }), /Portnummer/);
        await Sitzungen.portUebernehmen(s, { zweck: 'rcon', protocol: 'tcp', port: 27015 });
        assert.deepStrictEqual(db.entwurf.ports.map(p => p.purpose), ['game', 'rcon']);
        assert.strictEqual(db.entwurf.werkbank.portnummern.rcon, 27015);
        const paket = Sitzungen.entwurfAlsPaket(s, []);
        assert.ok(!('werkbank' in paket), 'Sitzungsteil gehört nicht ins Paket');
        assert.ok(!JSON.stringify(paket).includes('27015'), 'I2: keine Portnummer im Paket');
        assert.strictEqual(paket.start.program, './bin/x64/factorio');
    });

    await pruefe('Dateien: viele im selben Ordner werden eine Zeile, Einzelne bleiben', async () => {
        // Gemessen an Factorio: 52 von 53 neuen Dateien lagen unter temp/.
        const l = [{ pfad: 'game/.lock', groesse: 0 }, { pfad: 'game/factorio-previous.log', groesse: 2662 }];
        for (const x of ['af', 'ar', 'be', 'bg', 'ca', 'cs', 'da']) l.push({ pfad: `game/temp/currently-playing/locale/${x}/freeplay.cfg`, groesse: 100 });
        const g = Sitzungen.gruppiere(l);
        assert.deepStrictEqual(g.map(x => x.pfad || x.ordner), ['game/.lock', 'game/factorio-previous.log', 'game/temp/']);
        assert.strictEqual(g[2].anzahl, 7);
        assert.strictEqual(g[2].groesse, 700);
        // Fünf in einem Ordner bleiben einzeln — erst ab sechs lohnt die Zeile.
        const wenige = ['a', 'b', 'c', 'd', 'e'].map(x => ({ pfad: `game/config/${x}.ini`, groesse: 1 }));
        assert.strictEqual(Sitzungen.gruppiere(wenige).length, 5);
        assert.deepStrictEqual(Sitzungen.gruppiere(undefined), []);
    });

    await pruefe('ein übernommener Port, auf den nichts verweist, wird gemeldet', async () => {
        const paket = (args, extra = {}) => ({ ports: [{ purpose: 'game', protocol: 'udp', assign: 'pool', ...extra }],
            start: { program: 'x', args }, install: { steps: [] } });
        // Der Fall vom 2026-09-24: Factorio ohne --port lief nur, weil 34197 sein Standard ist.
        assert.deepStrictEqual(Sitzungen.ungenutztePorts(paket([{ key: 'arg1', parts: [{ text: '--start-server' }] }])), ['game']);
        assert.deepStrictEqual(Sitzungen.ungenutztePorts(paket([{ key: 'arg1', parts: [{ text: '{{port:game}}' }] }])), []);
        assert.deepStrictEqual(Sitzungen.ungenutztePorts(paket([{ key: 'port', form: ['--port', '{{value}}'], from: 'port:game' }])), [], 'form/from zählt');
        assert.deepStrictEqual(Sitzungen.ungenutztePorts(paket([], { variable: 'SERVER_PORT' })), [], 'variable zählt');
        const f = require('../packages/fbpkg/beispiele/factorio.json');
        // Alle Beispielpakete: keins darf gemeldet werden. Beim ersten Wurf fielen
        // Minecraft (Ports über `config`) und Valheim (query = game+1) durch.
        const ordner = path.join(__dirname, '../packages/fbpkg/beispiele');
        for (const d of fs.readdirSync(ordner).filter(x => x.endsWith('.json'))) {
            const u = Sitzungen.ungenutztePorts(JSON.parse(fs.readFileSync(path.join(ordner, d), 'utf8')));
            assert.deepStrictEqual(u, [], `${d}: ${u} gemeldet — ein Paket, das läuft, ist kein Befund`);
        }
    });

    console.log('\nPrüfdurchlauf (Stufe 3)');

    await pruefe('der Suffix ist auf beiden Seiten derselbe', async () => {
        const go = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/gameserver/werkbank_pruefung.go'), 'utf8'));
        const m = go.match(/PruefSuffix\s*=\s*"([^"]+)"/);
        assert.ok(m, 'PruefSuffix nicht gefunden');
        assert.strictEqual(Sitzungen.PRUEF_SUFFIX, m[1]);
    });

    const pruefbar = () => {
        const s = sitzungMitStart();
        s.entwurf.start.args.push({ key: 'arg2', parts: [{ text: '--port' }] });
        s.entwurf.start.ready_when = { port: 'game' };
        s.entwurf.start.stop = { sequence: [{ step: 'command:/quit', timeout_sec: 30, terminates: true }, { step: 'sigkill', timeout_sec: 10, terminates: true }] };
        return s;
    };
    const liste = [{ status: 'ok', schritt: { type: 'download' } }, { status: 'herausgenommen', schritt: { type: 'mkdir' } }];

    await pruefe('Durchlauf schickt den Entwurf und hält ihn samt Fingerabdruck fest', async () => {
        const s = pruefbar();
        await Sitzungen.pruefen(s, liste);
        const b = daemon.befehle[0];
        assert.strictEqual(b.befehl, 'werkbank.pruefen');
        assert.deepStrictEqual(b.nutzlast.install.steps.map(x => x.type), ['download'], 'nur Schritte im Entwurf');
        assert.deepStrictEqual(b.nutzlast.portnummern, { game: 34197 });
        const x = db.pruefungen[0];
        assert.strictEqual(x.status, 'laeuft');
        assert.strictEqual(x.entwurf_hash, Sitzungen.fingerabdruck(Sitzungen.entwurfAlsPaket(s, liste)));
        assert.ok(!JSON.parse(x.entwurf).werkbank, 'geprüft wird das Paket, nicht der Sitzungsteil');
    });

    await pruefe('was sicher rot würde, wird vorher gesagt — nichts geht an den Daemon', async () => {
        const ohnePort = pruefbar(); ohnePort.entwurf.start.ready_when = { log_line: 'Hosting game' };
        await assert.rejects(Sitzungen.pruefen(ohnePort, liste), /Bereit, wenn Port/);
        // Die begründete Ausnahme ist kein Mangel (Baustelle 158).
        assert.ok(!Sitzungen.durchlaufMaengel({ ...Sitzungen.entwurfAlsPaket(pruefbar(), liste),
            start: { ...pruefbar().entwurf.start, ready_when: { log_line: 'Hosting game', without_port: 'P2P' } } })
            .some(x => /Bereit, wenn Port/.test(x)), 'Ausnahme mit Zeile gilt');
        const nurKill = pruefbar(); nurKill.entwurf.start.stop = { sequence: [{ step: 'sigkill' }] };
        await assert.rejects(Sitzungen.pruefen(nurKill, liste), /sigkill/);
        const ungenutzt = pruefbar(); ungenutzt.entwurf.start.args = [];
        await assert.rejects(Sitzungen.pruefen(ungenutzt, liste), /verweist nichts/);
        const ohneNummer = pruefbar(); ohneNummer.entwurf.werkbank.portnummern = {};
        await assert.rejects(Sitzungen.pruefen(ohneNummer, liste), /keine Nummer/);
        await assert.rejects(Sitzungen.pruefen(pruefbar(), []), /keinen Schritt/);
        assert.strictEqual(daemon.befehle.length, 0);
        assert.strictEqual(db.pruefungen.length, 0);
    });

    await pruefe('Zwischenmeldungen <kennung>-pruefung landen im Protokoll, nicht bei Schritt oder Lauf', async () => {
        await Sitzungen.pruefen(pruefbar(), liste);
        // Ein Probestart der Sitzung selbst gibt es nicht — trotzdem darf nichts verlorengehen.
        const v = (a, p) => Ereignisse.verteile(a, () => { throw new Error(a + ' ging an den normalen Handler'); })(p);
        await v('status', { sitzung_id: 'wbprobe-pruefung', message: 'Schritt 1/1: download' });
        await v('output', { sitzung_id: 'wbprobe-pruefung', line: '==> Lade' });
        await v('konsole', { sitzung_id: 'wbprobe-pruefung', line: 'Hosting game' });
        await v('ports', { sitzung_id: 'wbprobe-pruefung', ports: [] });
        const zeilen = sse.gesendet.filter(x => x.daten.action === 'pruefung_zeile');
        assert.deepStrictEqual(zeilen.map(x => x.daten.line), ['── Schritt 1/1: download', '==> Lade', 'Hosting game']);
        assert.ok(zeilen.every(x => x.daten.sitzung_id === 'wbprobe'), 'an die Seite der Sitzung, ohne Suffix');
        await Ereignisse.beiPruefung({ sitzung_id: 'wbprobe', ergebnis: { gruen: true, gruende: [] } });
        const x = db.pruefungen[0];
        assert.strictEqual(x.status, 'gruen');
        assert.strictEqual(x.protokoll, '── Schritt 1/1: download\n==> Lade\nHosting game\n');
        assert.strictEqual(db.pruefSchreiben[0].status, 'laeuft', 'Protokoll VOR dem Urteil geschrieben');
    });

    await pruefe('rotes Urteil, und während des Durchlaufs geht kein Schritt und kein Start', async () => {
        await Sitzungen.pruefen(pruefbar(), liste);
        daemon.befehle = [];
        await assert.rejects(Sitzungen.schrittAusfuehren({ sitzung: db.sitzung, schritt: { type: 'mkdir', path: 'x' } }), /Prüfdurchlauf/);
        await assert.rejects(Sitzungen.starten(sitzungMitStart(), []), /Prüfdurchlauf/);
        await assert.rejects(Sitzungen.pruefen(pruefbar(), liste), /Prüfdurchlauf/);
        assert.strictEqual(daemon.befehle.length, 0);
        await Ereignisse.beiPruefung({ sitzung_id: 'wbprobe', ergebnis: { gruen: false, gruende: ['erst SIGKILL'] } });
        assert.strictEqual(db.pruefungen[0].status, 'rot');
    });

    await pruefe('der Fingerabdruck hängt am Inhalt, nicht an der Reihenfolge der Schlüssel', async () => {
        const a = { start: { program: 'x', args: [1, 2] }, ports: [{ purpose: 'game', protocol: 'udp' }] };
        const b = { ports: [{ protocol: 'udp', purpose: 'game' }], start: { args: [1, 2], program: 'x' } };
        assert.strictEqual(Sitzungen.fingerabdruck(a), Sitzungen.fingerabdruck(b));
        assert.notStrictEqual(Sitzungen.fingerabdruck(a), Sitzungen.fingerabdruck({ ...a, start: { program: 'x', args: [2, 1] } }));
    });

    console.log('\nVeröffentlichen (Stufe 4)');

    const gruenGeprueft = (s, liste) => ({ id: 3, status: 'gruen', beendet_am: new Date('2026-09-24T21:00:00Z'),
        entwurf: Sitzungen.entwurfAlsPaket(s, liste) });
    const mitAngaben = () => {
        const s = pruefbar();
        s.entwurf.identity = { name: 'Factorio', slug: 'factorio', version: '1.1.0', category: 'strategy', description: { de: 'Fabriken' } };
        return s;
    };

    await pruefe('Name, Beschreibung und Bild ändern den Fingerabdruck nicht — Schritte schon', async () => {
        const a = mitAngaben();
        const vorher = Sitzungen.fingerabdruck(Sitzungen.entwurfAlsPaket(a, liste));
        a.entwurf.identity.description = { de: 'ganz anders' };
        a.entwurf.werkbank.praesentation = { icon_url: '/uploads/media/g/x.png' };
        assert.strictEqual(Sitzungen.fingerabdruck(Sitzungen.entwurfAlsPaket(a, liste)), vorher);
        const andere = [...liste, { status: 'ok', schritt: { type: 'mkdir', path: 'mods' } }];
        assert.notStrictEqual(Sitzungen.fingerabdruck(Sitzungen.entwurfAlsPaket(a, andere)), vorher);
    });

    await pruefe('veröffentlichen verlangt: letzter Durchlauf grün, technisch unverändert, Slug, höhere Fassung', async () => {
        const s = mitAngaben();
        let st = await Sitzungen.veroeffentlichungsStand(s, liste, []);
        assert.match(st.gruende.join(' '), /kein Prüfdurchlauf/);
        st = await Sitzungen.veroeffentlichungsStand(s, liste, [{ status: 'rot', entwurf: {} }]);
        assert.match(st.gruende.join(' '), /rot/);
        const g = gruenGeprueft(s, liste);
        st = await Sitzungen.veroeffentlichungsStand(s, [...liste, { status: 'ok', schritt: { type: 'mkdir', path: 'x' } }], [g]);
        assert.match(st.gruende.join(' '), /technische Teil geändert/);
        db.fassungen.factorio = ['1.0.0', '1.2.0'];
        st = await Sitzungen.veroeffentlichungsStand(s, liste, [g]);
        assert.match(st.gruende.join(' '), /bis 1\.2\.0/);
        assert.strictEqual(st.neueste, '1.2.0', '1.2.0 > 1.0.0 — nicht lexikalisch, sondern als Zahlen');
        db.fassungen.factorio = ['1.0.0', '1.0.10'];
        st = await Sitzungen.veroeffentlichungsStand(s, liste, [g]);
        assert.strictEqual(st.darf, true, st.gruende.join(' '));
    });

    await pruefe('das gebaute Paket besteht check-pakete — dasselbe Tor wie die Kommandozeile', async () => {
        // Echte Bestandteile: Image und Schritte aus dem Factorio-Paket — mit
        // Attrappen-Werten (Digest „x", Download ohne Adresse) lehnt das Tor
        // zu Recht ab, und genau das soll es auch.
        const f = require('../packages/fbpkg/beispiele/factorio.json');
        const s = mitAngaben();
        s.image = f.image;
        const echt = f.install.steps.map(schritt => ({ status: 'ok', schritt }));
        const paket = Sitzungen.veroeffentlichungsPaket(s, echt, gruenGeprueft(s, echt), 'firedervil');
        assert.strictEqual(paket.identity.origin.type, 'installer');
        assert.ok(!paket.werkbank && !JSON.stringify(paket).includes('34197'), 'Sitzungsteil und Portnummern bleiben draußen');
        const einl = require('../packages/fbpkg/lib/einlieferung');
        const os = require('os');
        const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-check-'));
        try {
            const datei = path.join(d, 'factorio.json');
            fs.writeFileSync(datei, JSON.stringify(paket));
            const tor = einl.bestehtPruefung(datei);
            assert.ok(tor.ok, einl.grundZeilen(tor.text || '').join(' | '));
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await pruefe('Angaben: Slug, Fassung, Kategorie und Bildadressen werden geprüft', async () => {
        const s = mitAngaben();
        await assert.rejects(Sitzungen.angabenSpeichern(s, { name: 'x', slug: 'Mit Leerzeichen' }), /Slug/);
        await assert.rejects(Sitzungen.angabenSpeichern(s, { name: 'x', version: '1.0' }), /Fassung/);
        await assert.rejects(Sitzungen.angabenSpeichern(s, { name: 'x', kategorie: 'erfunden' }), /Kategorie/);
        await assert.rejects(Sitzungen.angabenSpeichern(s, { name: 'x', icon_url: 'javascript:alert(1)' }), /Symbol/);
        await assert.rejects(Sitzungen.angabenSpeichern(s, { name: 'x', banner_url: 'http://unsicher/x.png' }), /Banner/);
        await Sitzungen.angabenSpeichern(s, { name: 'Factorio', slug: 'factorio', version: '1.2.0', kategorie: 'strategy',
            beschreibung_de: 'Fabriken', icon_url: '/uploads/media/g/1.png', banner_url: 'https://cdn.example/b.jpg' });
        assert.deepStrictEqual(db.entwurf.werkbank.praesentation, { icon_url: '/uploads/media/g/1.png', banner_url: 'https://cdn.example/b.jpg' });
        assert.strictEqual(db.entwurf.identity.version, '1.2.0');
        assert.deepStrictEqual(db.entwurf.werkbank.portnummern, { game: 34197 }, 'der Sitzungsteil bleibt erhalten');
    });

    console.log(`\n${bestanden} Prüfung(en) bestanden.\n`);
    process.exit(process.exitCode || 0);
})();
