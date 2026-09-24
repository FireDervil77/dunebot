#!/usr/bin/env node
/**
 * Werkbank, Stufe 1 — ohne Daemon, ohne Datenbank.
 *
 * ── Was hier gehalten wird (2026-09-24) ─────────────────────────────────────
 *
 * Die Werkbank spricht mit dem Daemon über Namen, die auf zwei Seiten stehen:
 *
 *   Befehle     werkbank.schritt · werkbank.verwerfen     (internal/websocket/client.go)
 *   Ereignisse  werkbank.status|output|fertig|fehlgeschlagen  (pkg/protocol/messages.go)
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
const { schrittAusFormular } = require('../plugins/werkbank/dashboard/routes/guild.router.js');

let bestanden = 0;
async function pruefe(name, fn) {
    db.schritte = []; db.updates = []; daemon.befehle = []; daemon.online = true;
    daemon.antwort = { success: true }; sse.gesendet = [];
    Ereignisse._laufend.clear(); Ereignisse._puffer.clear();
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
        const geschickt = [...plugin.matchAll(/sendCommand\([^,]+,\s*'(werkbank\.[a-z]+)'/g)].map(x => x[1]);
        assert.ok(geschickt.length >= 2, `zu wenige Befehle gefunden: ${geschickt}`);
        for (const b of geschickt) assert.ok(client.includes(`case "${b}":`), `${b} fehlt im Daemon`);
    });

    await pruefe('die Ereignisse, die der Daemon schickt, fängt das Plugin', async () => {
        const proto = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'pkg/protocol/messages.go'), 'utf8'));
        assert.match(proto, /NSWerkbank\s+Namespace\s*=\s*"werkbank"/);
        const aktionen = ['WerkbankStatus', 'WerkbankAusgabe', 'WerkbankFertig', 'WerkbankFehlgeschlagen']
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

    console.log(`\n${bestanden} Prüfung(en) bestanden.\n`);
    process.exit(process.exitCode || 0);
})();
