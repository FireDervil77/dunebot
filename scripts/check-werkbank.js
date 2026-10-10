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
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

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
    vorhandenesPaket: {},    // slug → zusätzliche Teile der neuesten Fassung (management, content …)
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
        // Seit dem 2026-10-08 fällt ein gescheiterter Schritt aus einem geöffneten
        // Paket (`uebernommen_aus`) auf `uebernommen` zurück statt auf `fehler`.
        // Die Schritte dieser Attrappe sind von Hand angelegt — den anderen Weg
        // prüft check-werkbank-oeffnen.js an der Datenbank.
        if (/^UPDATE werkbank_schritte SET status = IF\(\? = 'fehler' AND uebernommen_aus IS NOT NULL, 'uebernommen', \?\), fehler = \?, bytes = \?, dateien = \?, beendet_am = NOW\(\) WHERE id = \? AND status = 'laeuft'$/.test(t)) {
            const s = this.schritte.find(x => x.id === p[5] && x.status === 'laeuft');
            if (s) Object.assign(s, { status: (p[0] === 'fehler' && s.uebernommen_aus) ? 'uebernommen' : p[1], fehler: p[2], bytes: p[3], dateien: p[4] });
            return { affectedRows: s ? 1 : 0 };
        }
        // Nach einem gelungenen Schritt fragt die Kette, ob er übernommen war.
        if (/^SELECT status, uebernommen_aus FROM werkbank_schritte WHERE id = \?$/.test(t)) {
            return this.schritte.filter(x => x.id === p[0]).map(x => ({ status: x.status, uebernommen_aus: x.uebernommen_aus || null }));
        }
        // ── W2: Prüfsumme eintragen ──
        if (/^SELECT schritt FROM werkbank_schritte WHERE id = \?$/.test(t)) {
            return this.schritte.filter(x => x.id === p[0]).map(x => ({ schritt: x.schritt }));
        }
        if (/^UPDATE werkbank_schritte SET schritt = \? WHERE id = \?$/.test(t)) {
            const s = this.schritte.find(x => x.id === p[1]);
            if (s) s.schritt = p[0];
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
        // ── Ports eines Laufs (2026-10-08): was gerade lauscht UND was er je sah ──
        if (/^SELECT gesehen, ports FROM werkbank_laeufe WHERE id = \?$/.test(t)) {
            return this.laeufe.filter(x => x.id === p[0]).map(x => ({ gesehen: x.gesehen || null, ports: x.ports || null }));
        }
        if (/^UPDATE werkbank_laeufe SET ports = \?, gesehen = \? WHERE id = \?$/.test(t)) {
            const l = this.laeufe.find(x => x.id === p[2]);
            if (l) Object.assign(l, { ports: p[0], gesehen: p[1] });
            return { affectedRows: l ? 1 : 0 };
        }
        // Das Bild der Ports lädt die Sitzung, ihre Schritte und ihre Läufe.
        if (/^SELECT \* FROM werkbank_sitzungen WHERE guild_id = \? AND kennung = \?$/.test(t)) {
            if (p[1] !== this.sitzung.kennung) return [];
            return [{ ...this.sitzung, status: 'offen', image: JSON.stringify(this.sitzung.image), entwurf: JSON.stringify(this.entwurf || this.sitzung.entwurf || {}) }];
        }
        if (/^SELECT \* FROM werkbank_schritte WHERE sitzung_id = \? ORDER BY nr, id$/.test(t)) {
            return this.schritte.filter(s => s.sitzung_id === p[0]);
        }
        if (/^SELECT \* FROM werkbank_laeufe WHERE sitzung_id = \? ORDER BY id DESC LIMIT \?$/.test(t)) {
            return [...this.laeufe].filter(l => l.sitzung_id === p[0]).reverse().slice(0, p[1]);
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
        // Die neueste Fassung eines Slugs (Paketfassung.ladeNeuesteFassung) — die Werkbank
        // prüft daran, ob ein Veröffentlichen dem vorhandenen Paket etwas nähme (2026-10-07).
        if (/^SELECT pk\.id AS paket_id, pk\.slug, v\.version, v\.channel, v\.fbpkg FROM packages pk JOIN package_versions v ON v\.package_id = pk\.id WHERE pk\.slug = \? ORDER BY v\.published_at DESC, v\.id DESC LIMIT 1$/.test(t)) {
            const alle = this.fassungen[p[0]] || [];
            if (!alle.length) return [];
            const version = alle[alle.length - 1];
            const fbpkg = { identity: { slug: p[0], version }, ...(this.vorhandenesPaket[p[0]] || {}) };
            return [{ paket_id: 1, slug: p[0], version, channel: 'test', fbpkg: JSON.stringify(fbpkg) }];
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
        for (const b of ['werkbank.schritt', 'werkbank.verwerfen', 'werkbank.starten', 'werkbank.stoppen', 'werkbank.eingabe', 'werkbank.dateien', 'werkbank.pruefen', 'werkbank.schluessel', 'werkbank.startzeile']) {
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
        // Proton als Basis-Image heisst Windows-Build — sonst „Invalid platform" (Code 8).
        const steam = { type: 'steamcmd', app: '3809400', validate: 'on' };
        assert.strictEqual(schrittAusFormular(steam, { ref: 'registry.firenetworks.de/fb/proton', tag: 'x' }).platform, 'windows');
        assert.strictEqual(schrittAusFormular(steam, { ref: 'registry.firenetworks.de/fb/steamcmd' }).platform, undefined);
        assert.strictEqual(schrittAusFormular(steam).platform, undefined);
    });

    console.log('\nAusführen');

    await pruefe('ein Schritt geht als werkbank.schritt mit sitzung_id und dem Image der Sitzung', async () => {
        const r = await Sitzungen.schrittAusfuehren({ sitzung: db.sitzung, schritt: { type: 'mkdir', path: 'mods' } });
        assert.strictEqual(r.angenommen, true);
        const b = daemon.befehle[0];
        assert.strictEqual(b.befehl, 'werkbank.schritt');
        assert.strictEqual(b.nutzlast.sitzung_id, 'wbprobe');
        assert.ok(!('server_id' in b.nutzlast), 'eine server_id liesse das Dashboard einen Server suchen');
        // Image und Tag, kein Digest: Den legt der Daemon je Lauf fest (B166).
        // Der Tag ist seit 2026-10-09 der des NEUESTEN Baus — die Sitzung hat
        // 2026.09 gespeichert, gefragt wird `latest`: Sonst erreichte ein Bau im
        // neuen Monat keine einzige Sitzung.
        assert.deepStrictEqual(b.nutzlast.image, { ref: 'r/fb/base', tag: 'latest' });
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
        assert.deepStrictEqual(e.image, { ref: 'r/fb/base', tag: 'latest' }, 'der Entwurf trägt keinen Digest (B166) und keinen Monat (2026-10-09)');
    });

    console.log('\nProbestart (Stufe 2)');

    const sitzungMitStart = () => ({ ...db.sitzung, entwurf: {
        identity: { name: 'Factorio' },
        ports: [{ purpose: 'game', protocol: 'udp', assign: 'pool' }],
        start: { program: './bin/x64/factorio', args: [{ key: 'arg1', parts: [{ text: '{{port:game}}' }] }] },
        werkbank: { portnummern: { game: 34197 }, memory_mb: 2048, cpu_prozent: 150 },
    } });

    await pruefe('Formular → Startteil: Baukasten-Zeilen, Stoppfolge mit Frist, gültig nach Schema', async () => {
        const start = startAusFormular({ program: './bin/x64/factorio',
            zeilen: [{ form: '--start-server saves/welt.zip', quelle: 'fest' }, { form: '--port {{Wert}}', quelle: 'port:game' }],
            stop: 'command:/quit 30 beendet\nrcon:/save 60 weiter\nsigkill 5', ready_port: 'game', log_line: 'Hosting game', timeout_sec: '120' });
        assert.deepStrictEqual(start.args[1], { key: 'port', form: ['--port', '{{value}}'], from: 'port:game' });
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
        // Mit den Nummern geht das eingeordnete Bild hinaus — der Browser zeichnet nur.
        const meldung = sse.gesendet.filter(x => x.daten.action === 'ports').pop().daten;
        assert.deepStrictEqual(meldung.ports, [{ protocol: 'udp', port: 34197 }]);
        assert.ok(meldung.bild && Array.isArray(meldung.bild.beobachtet), 'die Meldung trägt kein Bild');
        assert.deepStrictEqual(meldung.bild.beobachtet.map(b => [b.port, b.protocol]), [[34197, 'udp']]);
        assert.strictEqual(meldung.bild.laeuft, true);
        // Was der Lauf je sah, bleibt — auch wenn später nichts mehr lauscht.
        await Ereignisse.beiPorts({ sitzung_id: 'wbprobe', ports: [{ protocol: 'tcp', port: 27015 }] });
        await Ereignisse.beiPorts({ sitzung_id: 'wbprobe', ports: [] });
        assert.deepStrictEqual(JSON.parse(lauf.ports), []);
        assert.deepStrictEqual(JSON.parse(lauf.gesehen), [{ port: 27015, protocol: 'tcp' }, { port: 34197, protocol: 'udp' }]);
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
        // Dieselbe Nummer, anderes Protokoll: beide — nicht das zweite statt des ersten.
        const rcon = () => db.entwurf.ports.find(p => p.purpose === 'rcon').protocol;
        await Sitzungen.portUebernehmen({ ...s, entwurf: db.entwurf }, { zweck: 'rcon', protocol: 'udp', port: 27015 });
        assert.strictEqual(rcon(), 'both');
        await Sitzungen.portUebernehmen({ ...s, entwurf: db.entwurf }, { zweck: 'rcon', protocol: 'udp', port: 27016 });
        assert.strictEqual(rcon(), 'udp', 'andere Nummer ersetzt');
    });

    await pruefe('Dateien: viele im selben Ordner werden eine Zeile, Einzelne bleiben', async () => {
        // Gemessen an Factorio: 52 von 53 neuen Dateien lagen unter temp/.
        const l = [{ pfad: 'game/.lock', groesse: 0 }, { pfad: 'game/factorio-previous.log', groesse: 2662 }];
        for (const x of ['af', 'ar', 'be', 'bg', 'ca', 'cs', 'da']) l.push({ pfad: `game/temp/currently-playing/locale/${x}/freeplay.cfg`, groesse: 100 });
        const g = Sitzungen.gruppiere(l);
        assert.deepStrictEqual(g.map(x => x.pfad || x.ordner), ['game/.lock', 'game/factorio-previous.log', 'game/temp/']);
        assert.strictEqual(g[2].anzahl, 7);
        assert.strictEqual(g[2].groesse, 700);
        // Zugeklappt, nicht weggelassen (2026-10-09): Der Ordner trägt seine Dateien mit,
        // sonst sucht man die Startdatei darin mit einem fremden Werkzeug.
        assert.strictEqual(g[2].dateien.length, 7);
        assert.deepStrictEqual(g[2].dateien[0], { pfad: 'game/temp/currently-playing/locale/af/freeplay.cfg', groesse: 100, vorher: undefined });
        const baustein = ohneKommentareEjs(fs.readFileSync(path.join(__dirname, '../plugins/werkbank/dashboard/views/guild/werkbank-dateien.ejs'), 'utf8'));
        assert.ok(/data-dateiliste style="max-height:[0-9]+rem;overflow:auto"/.test(baustein), 'die Dateiliste rollt nicht — bei vielen Dateien ist ihr Ende nicht zu erreichen');
        assert.ok(baustein.includes('<details>') && baustein.includes('(g.dateien || []).forEach'), 'ein Ordner mit vielen Dateien lässt sich nicht aufklappen');
        assert.ok(baustein.includes('weitere fehlen in dieser Liste'), 'die Liste sagt nicht, dass der Daemon sie gekürzt hat');
        const seite = ohneKommentareEjs(fs.readFileSync(path.join(__dirname, '../plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs'), 'utf8'));
        assert.ok(seite.includes("rolle.style.overflow = 'auto'") && seite.includes('(g.dateien || []).forEach'), '„Jetzt nachsehen" zeichnet die Liste ohne Rollen oder ohne aufklappbare Ordner');
        // Was sich starten lässt (2026-10-09): eine eigene Liste vom Daemon, unabhängig
        // von der 300er-Grenze. Drei Auskünfte, drei Texte — „nicht gezählt" ist nicht „keine".
        const go = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/gameserver/werkbank_dateien.go'), 'utf8'));
        assert.match(go, /Startbar\s+\[\]DateiAenderung `json:"startbar"`/, 'der Daemon nennt die Liste anders — oder lässt sie leer weg, dann sähe „keine" aus wie „nicht gezählt"');
        assert.match(go, /AnzahlStartbar\s+int\s+`json:"anzahl_startbar"`/);
        assert.ok(baustein.includes('Array.isArray(d.startbar) ? d.startbar : null'), 'der Baustein unterscheidet ein fehlendes Feld nicht von einer leeren Liste');
        for (const wort of ['startbar · <%= startbarAnzahl %>', 'startbar · 0', 'nicht gezählt', '<%= x.pfad %>']) assert.ok(baustein.includes(wort), `der Baustein zeigt „${wort}" nicht`);
        assert.ok(baustein.indexOf('data-startbar') < baustein.indexOf("['neu', 'bg-green-lt', 'neu']"), 'die startbaren Dateien stehen nicht oben in der Box');
        assert.ok(seite.includes('Array.isArray(x.dateien.startbar)') && seite.includes('Array.isArray(d.startbar) && d.startbar.length'), 'Schrittzeile oder „Jetzt nachsehen" kennen die startbaren Dateien nicht');
        // Wirklich gezeichnet, in allen drei Fällen.
        const zeichne = (d) => require('ejs').render(fs.readFileSync(path.join(__dirname, '../plugins/werkbank/dashboard/views/guild/werkbank-dateien.ejs'), 'utf8'), { d, gruppiere: Sitzungen.gruppiere, groesse: (n) => n + ' B' });
        const basis = { neu: [{ pfad: 'game/a.txt', groesse: 1 }], geaendert: [], weg: [], anzahl_neu: 1, anzahl_geaendert: 0, anzahl_weg: 0 };
        const mit = zeichne({ ...basis, startbar: [{ pfad: 'game/<b>Server</b>.x86_64', groesse: 5 }], anzahl_startbar: 1 });
        assert.ok(mit.includes('startbar · 1') && mit.includes('game/&lt;b&gt;Server&lt;/b&gt;.x86_64'), 'die startbare Datei wird nicht oder unescaped gezeigt');
        assert.ok(zeichne({ ...basis, startbar: [], anzahl_startbar: 0 }).includes('startbar · 0'));
        const alt = zeichne(basis);
        assert.ok(alt.includes('nicht gezählt') && !alt.includes('startbar · 0'), 'ein Vergleich ohne das Feld sieht aus wie „keine startbare Datei"');
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
    // Ein vollständiger Download — seit W2 meldet der Durchlauf einen ohne
    // Summe als Mangel (vorher genügte hier `{ type: 'download' }`).
    const liste = [{ status: 'ok', schritt: { type: 'download', url: 'https://x.de/a.zip', target: 'a.zip', checksum: 'sha256:' + 'ab'.repeat(32) } },
        { status: 'herausgenommen', schritt: { type: 'mkdir' } }];

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

    // Der Digest, den der Daemon für DIESEN Durchlauf gemeldet hat (B166) — und
    // seit 2026-10-09 die Kalenderfassung des Images, auf dem er lief.
    const LAUF_DIGEST = 'sha256:' + 'ab'.repeat(32);
    const LAUF_TAG = '2026.10';
    const gruenGeprueft = (s, liste, digest = LAUF_DIGEST, tag = LAUF_TAG) => ({ id: 3, status: 'gruen',
        beendet_am: new Date('2026-09-24T21:00:00Z'),
        ergebnis: { gruen: true, gruende: [], ...(digest ? { image_digest: digest } : {}), ...(tag ? { image_tag: tag } : {}) },
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
        // Grün, aber ohne aufgezeichneten Digest: nichts, was sich anheften ließe.
        st = await Sitzungen.veroeffentlichungsStand(s, liste, [gruenGeprueft(s, liste, null)]);
        assert.match(st.gruende.join(' '), /nennt sein Image nicht/);
        // Grün mit Digest, aber ohne den NAMEN des Standes (Daemon vor 1.0.116):
        // Im Paket stünde „latest". Abgewiesen — auch wenn der Daemon „latest" meldet.
        for (const ohne of [null, 'latest', 'latest-8']) {
            st = await Sitzungen.veroeffentlichungsStand(s, liste, [gruenGeprueft(s, liste, LAUF_DIGEST, ohne)]);
            assert.strictEqual(st.darf, false, `mit image_tag=${ohne} darf veröffentlicht werden`);
            assert.match(st.gruende.join(' '), /nennt die Fassung seines Images nicht/);
        }
        db.fassungen.factorio = ['1.0.0', '1.2.0'];
        st = await Sitzungen.veroeffentlichungsStand(s, liste, [g]);
        assert.match(st.gruende.join(' '), /bis 1\.2\.0/);
        assert.strictEqual(st.neueste, '1.2.0', '1.2.0 > 1.0.0 — nicht lexikalisch, sondern als Zahlen');
        db.fassungen.factorio = ['1.0.0', '1.0.10'];
        st = await Sitzungen.veroeffentlichungsStand(s, liste, [g]);
        assert.strictEqual(st.darf, true, st.gruende.join(' '));
        // Trägt das vorhandene Paket Teile, die diese Sitzung nicht hat, ginge das mit dem
        // Veröffentlichen verloren — abgewiesen, mit dem Rat, das Paket zu öffnen (2026-10-07).
        db.vorhandenesPaket.factorio = { management: { rcon: { port: 'rcon' } }, files: { denylist: ['bin'] } };
        st = await Sitzungen.veroeffentlichungsStand(s, liste, [g]);
        assert.strictEqual(st.darf, false);
        assert.match(st.gruende.join(' '), /trägt management\.rcon, files\.denylist — diese Sitzung nicht.*Öffne das Paket/);
        db.vorhandenesPaket = {};
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
        // Angeheftet ist der Digest des grünen Durchlaufs, nicht der der Sitzung
        // oder der, der gerade hinter dem Tag steht (B166).
        assert.strictEqual(paket.image.digest, LAUF_DIGEST);
        // Der Tag ist der des Durchlaufs, nicht der, mit dem die Sitzung angelegt
        // wurde: Die Sitzung trägt hier den Stand des Factorio-Pakets, geprüft
        // wurde auf 2026.10 — und genau das steht im Paket.
        assert.strictEqual(paket.image.tag, LAUF_TAG);
        assert.notStrictEqual(f.image.tag, LAUF_TAG, 'die Probe unterscheidet Sitzung und Durchlauf nicht mehr — LAUF_TAG ändern');
        assert.ok(!JSON.stringify(paket.image).includes('latest'), '„latest" steht im Paket');
        assert.match(paket.image.pinned_at, /^\d{4}-\d{2}-\d{2}$/);
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

    await pruefe('Hinweise für Betreiber: geprüft, im Paket, ohne neuen Durchlauf — und bestehen das Tor', async () => {
        const h = (x = {}) => ({ key: 'erste_einrichtung', when: 'run', text_de: 'Beim ersten Start neue Welt an.', text_en: '', ...x });
        assert.deepStrictEqual(Sitzungen.hinweisAusFormular(h()),
            { key: 'erste_einrichtung', when: 'run', text: { de: 'Beim ersten Start neue Welt an.' } });
        assert.deepStrictEqual(Sitzungen.hinweisAusFormular(h({ text_de: '', text_en: 'Join by IP.' })).text, { en: 'Join by IP.' });
        assert.throws(() => Sitzungen.hinweisAusFormular(h({ key: 'Erste Einrichtung' })), /Schlüssel/);
        assert.throws(() => Sitzungen.hinweisAusFormular(h({ when: 'immer' })), /Zeitpunkt/);
        assert.throws(() => Sitzungen.hinweisAusFormular(h({ text_de: '   ' })), /braucht einen Text/);
        assert.throws(() => Sitzungen.hinweisAusFormular(h({ text_de: 'x'.repeat(Sitzungen.HINWEIS.max + 1) })), /höchstens/);

        // Echte Bestandteile wie im Test darüber — sonst lehnt das Tor aus anderen Gründen ab.
        const f = require('../packages/fbpkg/beispiele/factorio.json');
        const s = mitAngaben();
        s.image = f.image;
        const echt = f.install.steps.map(schritt => ({ status: 'ok', schritt }));
        const geprueft = gruenGeprueft(s, echt);
        const vorher = Sitzungen.fingerabdruck(Sitzungen.entwurfAlsPaket(s, echt));

        // Speichern, ersetzen, umbenennen, doppelt, entfernen.
        await Sitzungen.hinweisSpeichern(s, h());
        await Sitzungen.hinweisSpeichern(s, h({ key: 'beitreten', when: 'create', text_de: 'Nur über die IP.', text_en: 'Join by IP only.' }));
        // Ein NEUER Hinweis mit vorhandenem Schlüssel ersetzt nichts still — wie bei den Einstellungen.
        await assert.rejects(Sitzungen.hinweisSpeichern(s, h({ text_de: 'anderer Text' })), /gibt es schon/);
        await Sitzungen.hinweisSpeichern(s, h({ alt: 'erste_einrichtung', text_de: 'Erst neue Welt, dann laden.' }));
        assert.deepStrictEqual(s.entwurf.hints.map(x => x.key), ['erste_einrichtung', 'beitreten']);
        assert.strictEqual(s.entwurf.hints[0].text.de, 'Erst neue Welt, dann laden.', 'Bearbeiten ersetzt an Ort und Stelle');
        await assert.rejects(Sitzungen.hinweisSpeichern(s, h({ key: 'beitreten', alt: 'erste_einrichtung' })), /gibt es schon/);
        await Sitzungen.hinweisSpeichern(s, h({ key: 'einrichtung', alt: 'erste_einrichtung', text_de: 'Erst neue Welt, dann laden.' }));
        assert.deepStrictEqual(s.entwurf.hints.map(x => x.key), ['einrichtung', 'beitreten'], 'umbenennen behält den Platz');

        // Hinweise gehören nicht zum Geprüften: derselbe Fingerabdruck, Veröffentlichen bleibt erlaubt.
        assert.strictEqual(Sitzungen.fingerabdruck(Sitzungen.entwurfAlsPaket(s, echt)), vorher);
        assert.ok(!('hints' in Sitzungen.technisch(Sitzungen.entwurfAlsPaket(s, echt))));
        assert.deepStrictEqual(Sitzungen.entwurfAlsPaket(s, echt).hints, s.entwurf.hints);

        // Ins Paket kommen die Hinweise von JETZT — auch die, die nach dem Durchlauf entstanden.
        const paket = Sitzungen.veroeffentlichungsPaket(s, echt, geprueft, 'firedervil');
        assert.deepStrictEqual(paket.hints, s.entwurf.hints);
        const einl = require('../packages/fbpkg/lib/einlieferung');
        const os = require('os');
        const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-check-'));
        try {
            const datei = path.join(d, 'factorio.json');
            fs.writeFileSync(datei, JSON.stringify(paket));
            const tor = einl.bestehtPruefung(datei);
            assert.ok(tor.ok, einl.grundZeilen(tor.text || '').join(' | '));
            // Gegenprobe: Das Tor liest das Feld wirklich — ein unbekannter Zeitpunkt fällt auf.
            fs.writeFileSync(datei, JSON.stringify({ ...paket, hints: [{ key: 'x', when: 'immer', text: { de: 'y' } }] }));
            assert.ok(!einl.bestehtPruefung(datei).ok, 'ein Zeitpunkt, den es nicht gibt, darf nicht durchgehen');
        } finally { fs.rmSync(d, { recursive: true, force: true }); }

        await Sitzungen.hinweisEntfernen(s, 'einrichtung');
        await Sitzungen.hinweisEntfernen(s, 'beitreten');
        assert.ok(!('hints' in s.entwurf), 'der letzte nimmt das Feld mit');
        assert.ok(!('hints' in Sitzungen.veroeffentlichungsPaket(s, echt, geprueft, 'firedervil')), 'ohne Hinweise kein leeres Feld im Paket');

        // Die Anzeige: nach Zeitpunkt gewählt, Sprache aufgelöst, nichts ergänzt.
        const { baueHinweise } = require('../plugins/gameserver/dashboard/helpers/Serverseite');
        const p2 = { hints: [
            { key: 'a', when: 'run', text: { de: 'Deutsch', en: 'English' } },
            { key: 'b', when: 'run', text: { en: 'Only English' } },
            { key: 'c', when: 'create', text: { de: 'Vor dem Anlegen' } },
            { key: 'd', when: 'install', text: { de: 'Während der Installation' } },
        ] };
        assert.deepStrictEqual(baueHinweise(p2, 'run'), [{ key: 'a', text: 'Deutsch' }, { key: 'b', text: 'Only English' }]);
        assert.deepStrictEqual(baueHinweise(p2, 'create'), [{ key: 'c', text: 'Vor dem Anlegen' }]);
        assert.deepStrictEqual(baueHinweise(p2, 'install'), [{ key: 'd', text: 'Während der Installation' }]);
        assert.deepStrictEqual(baueHinweise({}, 'run'), []);
        assert.deepStrictEqual(baueHinweise(null, 'run'), []);
    });

    // Seit dem 2026-10-08 fragt das Formular keine Kategorie mehr — Tags ersetzen
    // sie. Was ein Entwurf in `identity.category` trägt, bleibt stehen.
    await pruefe('Angaben: Slug, Fassung, Tags und Bildadressen werden geprüft', async () => {
        const s = mitAngaben();
        await assert.rejects(Sitzungen.angabenSpeichern(s, { name: 'x', slug: 'Mit Leerzeichen' }), /Slug/);
        await assert.rejects(Sitzungen.angabenSpeichern(s, { name: 'x', version: '1.0' }), /Fassung/);
        await assert.rejects(Sitzungen.angabenSpeichern(s, { name: 'x', tags: ['gut', 'mit,komma'] }), /Zeichen, das nicht geht/);
        await assert.rejects(Sitzungen.angabenSpeichern(s, { name: 'x', tags: Array.from({ length: 13 }, (_, i) => 'tag' + i) }), /Höchstens 12 Tags/);
        await assert.rejects(Sitzungen.angabenSpeichern(s, { name: 'x', icon_url: 'javascript:alert(1)' }), /Symbol/);
        await assert.rejects(Sitzungen.angabenSpeichern(s, { name: 'x', banner_url: 'http://unsicher/x.png' }), /Banner/);
        const kategorieVorher = db.entwurf?.identity?.category ?? s.entwurf.identity.category;
        await Sitzungen.angabenSpeichern(s, { name: 'Factorio', slug: 'factorio', version: '1.2.0', kategorie: 'erfunden',
            beschreibung_de: 'Fabriken', icon_url: '/uploads/media/g/1.png', banner_url: 'https://cdn.example/b.jpg',
            tags: ['Strategie', ' Fabrik-Aufbauspiel ', 'strategie'] });
        assert.deepStrictEqual(db.entwurf.werkbank.praesentation,
            { icon_url: '/uploads/media/g/1.png', banner_url: 'https://cdn.example/b.jpg', tags: ['Strategie', 'Fabrik-Aufbauspiel'] });
        assert.strictEqual(db.entwurf.identity.category, kategorieVorher, 'das Formular hat die Kategorie des Entwurfs angefasst');
        assert.strictEqual(db.entwurf.identity.version, '1.2.0');
        assert.deepStrictEqual(db.entwurf.werkbank.portnummern, { game: 34197 }, 'der Sitzungsteil bleibt erhalten');
        // Ohne `tags` in der Nutzlast (das Feld liess sich nicht laden) bleiben die gesetzten stehen …
        await Sitzungen.angabenSpeichern(s, { name: 'Factorio', slug: 'factorio', version: '1.2.0' });
        assert.deepStrictEqual(db.entwurf.werkbank.praesentation.tags, ['Strategie', 'Fabrik-Aufbauspiel'], 'fehlende Tags wurden als „keine" gelesen');
        // … eine leere Liste dagegen heisst „keine".
        await Sitzungen.angabenSpeichern(s, { name: 'Factorio', slug: 'factorio', version: '1.2.0', tags: [] });
        assert.deepStrictEqual(db.entwurf.werkbank.praesentation.tags, []);
        // Die Tags stehen NICHT im Paket — sie gehören dem Spiel im Panel.
        assert.ok(!JSON.stringify(Sitzungen.entwurfAlsPaket(s, [])).includes('"tags"'), 'die Tags stehen im Paket');
    });

    console.log('\nEinstellungen (Baukasten B1)');

    const formular = (x = {}) => ({ key: 'max_players', name_de: 'Maximale Spieler', type: 'number', default: '8',
        role: 'player', takes_effect: 'restart', risk: 'none',
        apply: [{ target: 'file', file: 'server-settings.json', parser: 'json', path: 'max_players' }], ...x });
    const mitEinstellungen = () => {
        const s = mitAngaben();
        s.entwurf.settings = [
            Sitzungen.einstellungAusFormular(formular()),
            Sitzungen.einstellungAusFormular(formular({ key: 'name', name_de: 'Servername', type: 'text', default: 'Fabrik',
                apply: [{ target: 'arg' }] })),
            Sitzungen.einstellungAusFormular(formular({ key: 'rcon_password', name_de: 'RCON-Passwort', type: 'password', default: '',
                role: 'expert', apply: [{ target: 'env', variable: 'RCON_PASSWORD' }] })),
            Sitzungen.einstellungAusFormular(formular({ key: 'oeffentlich', name_de: 'Öffentlich', type: 'boolean', default: '1',
                role: 'owner', apply: [{ target: 'file', file: 'server-settings.json', parser: 'json', path: 'visibility.public', as: 'true_false' }] })),
        ];
        s.entwurf.start.args.push({ key: 'arg3', parts: [{ text: '--name={{setting:name}}' }] });
        return s;
    };

    await pruefe('Vertrag: der Daemon liest das Feld „einstellungen" bei Start und Durchlauf', async () => {
        const go = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/websocket/werkbank.go'), 'utf8'));
        assert.strictEqual((go.match(/"einstellungen":\s*&a\.Einstellungen/g) || []).length, 2);
        // Durchgereichtes aus einem geöffneten Paket (2026-10-07): Start und Durchlauf lesen
        // dieselben vier Teile, die das Dashboard schickt — sonst prüfte der Durchlauf ein
        // anderes Paket als das, was eingeliefert wird.
        for (const teil of Sitzungen.LAUFZEIT_TEILE) {
            const feld = teil.charAt(0).toUpperCase() + teil.slice(1);
            assert.strictEqual((go.match(new RegExp(`"${teil}":\\s*&a\\.${feld}`, 'g')) || []).length, 2, `der Daemon liest „${teil}" nicht bei Start UND Durchlauf`);
        }
        const start = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/gameserver/werkbank_start.go'), 'utf8'));
        assert.match(start, /Management:\s*a\.Management,\s*Content:\s*a\.Content,\s*Config:\s*a\.Config,\s*Console:\s*a\.Console,/, 'der Probestart baut sein Paket ohne das Durchgereichte');
        const nw = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/gameserver/werkbank_nachweis.go'), 'utf8'));
        assert.match(nw, /NachweisAngekommen\s*=\s*"angekommen"/, 'der Zustand, den das Dashboard als Beleg liest');
        assert.match(nw, /json:"zustand"/);
        assert.match(nw, /json:"wo,omitempty"/);
    });

    await pruefe('Formular → Einstellung: gültig nach Schema, Fehler dort gesagt, wo getippt wird', async () => {
        const e = Sitzungen.einstellungAusFormular(formular({ type: 'choice', default: 'hard', choices: 'normal=Normal\nhard=Schwer' }));
        assert.deepStrictEqual(e.choices, [{ value: 'normal', name: { de: 'Normal' } }, { value: 'hard', name: { de: 'Schwer' } }]);
        const Ajv = require('ajv');
        const schema = require('../packages/fbpkg/schema/fbpkg-v1.schema.json');
        const ajv = new Ajv({ allErrors: true, strict: false });
        ajv.addSchema(schema, 'fbpkg');
        const pruef = ajv.compile({ $ref: 'fbpkg#/properties/settings/items' });
        for (const x of [e, ...mitEinstellungen().entwurf.settings]) assert.ok(pruef(x), x.key + ': ' + JSON.stringify(pruef.errors));
        assert.ok(!pruef({ ...e, erfunden: 1 }), 'die Schemaprüfung lässt Unbekanntes durch — sie prüft nichts');
        assert.throws(() => Sitzungen.einstellungAusFormular(formular({ key: 'Max Players' })), /Schlüssel/);
        assert.throws(() => Sitzungen.einstellungAusFormular(formular({ type: 'choice', choices: 'nur' })), /mindestens zwei/);
        assert.throws(() => Sitzungen.einstellungAusFormular(formular({ apply: [{ target: 'file', file: 'a.json', parser: 'json' }] })), /Schlüssel darin/);
        assert.throws(() => Sitzungen.einstellungAusFormular(formular({ apply: [{ target: 'file', file: '../x', parser: 'json', path: 'a' }] })), /ohne „\.\."/);
        assert.throws(() => Sitzungen.einstellungAusFormular(formular({ apply: [{ target: 'env', variable: 'mit leer' }] })), /Umgebungsvariable/);
        assert.throws(() => Sitzungen.einstellungAusFormular(formular({ apply: [] })), /Mindestens ein Ziel/);
        assert.throws(() => Sitzungen.einstellungAusFormular(formular({ default: 'viele' })), /keine Zahl/);
        assert.throws(() => Sitzungen.einstellungAusFormular(formular({ role: 'admin' })), /Rolle/);
        // An/Aus in einer Datei: die Schreibweise wird gewählt, nie still als 1/0 angenommen
        // (StarRupture, `"StartNewGame": 1` in DSSettings.txt, 2026-10-06).
        const schalter = (ziel) => formular({ key: 'neu', name_de: 'Neue Welt', type: 'boolean', default: '0', apply: [ziel] });
        const datei = { target: 'file', file: 'DSSettings.txt', parser: 'json', path: 'StartNewGame' };
        assert.throws(() => Sitzungen.einstellungAusFormular(schalter(datei)), /Wie steht An\/Aus in DSSettings\.txt.*true\/false, 1\/0/);
        assert.throws(() => Sitzungen.einstellungAusFormular(schalter({ ...datei, as: 'vielleicht' })), /Schreibweise für An\/Aus/);
        assert.strictEqual(Sitzungen.einstellungAusFormular(schalter({ ...datei, as: 'true_false' })).apply[0].as, 'true_false');
        assert.strictEqual(Sitzungen.einstellungAusFormular(schalter({ ...datei, as: 'one_zero' })).apply[0].as, 'one_zero', '1/0 bleibt wählbar');
        // Der Daemon übersetzt nur bei Dateien — an Umgebung und Startzeile gibt es nichts zu wählen.
        assert.ok(!('as' in Sitzungen.einstellungAusFormular(schalter({ target: 'env', variable: 'NEU' })).apply[0]));
        assert.ok(!('as' in Sitzungen.einstellungAusFormular(schalter({ target: 'arg' })).apply[0]));
        assert.ok(!('as' in Sitzungen.einstellungAusFormular(formular({ apply: [{ ...datei, as: 'true_false' }] })).apply[0]), 'keine Schreibweise an einer Zahl');
        const seite = ohneKommentare(fs.readFileSync(path.join(__dirname, '../plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs'), 'utf8'));
        assert.match(seite, /An\/Aus schreiben als<\/label>/, 'das Feld ist beschriftet');
        assert.ok(!/<option value="">An\/Aus als 1\/0<\/option>/.test(seite), 'keine stille Vorbelegung mit 1/0');
    });

    await pruefe('Speichern: anlegen, umbenennen samt Probewert, doppelter Schlüssel abgewiesen', async () => {
        const s = mitEinstellungen();
        s.entwurf.werkbank.werte = { max_players: '4' };
        await Sitzungen.einstellungSpeichern(s, formular({ alt: 'max_players', key: 'spieler' }));
        assert.deepStrictEqual(db.entwurf.settings.map(x => x.key), ['spieler', 'name', 'rcon_password', 'oeffentlich']);
        assert.deepStrictEqual(db.entwurf.werkbank.werte, { spieler: '4' }, 'der Probewert zieht mit');
        await assert.rejects(Sitzungen.einstellungSpeichern(s, formular({ key: 'name' })), /gibt es schon/);
    });

    await pruefe('Entwurf: env-Ziel wird ins Wurzelfeld verdrahtet (B169), ein vorhandener Eintrag bleibt', async () => {
        const s = mitEinstellungen();
        let p = Sitzungen.entwurfAlsPaket(s, liste);
        assert.deepStrictEqual(p.env, { RCON_PASSWORD: '{{setting:rcon_password}}' });
        assert.strictEqual(p.settings.length, 4);
        s.entwurf.env = { RCON_PASSWORD: 'fest' };
        p = Sitzungen.entwurfAlsPaket(s, liste);
        assert.deepStrictEqual(p.env, { RCON_PASSWORD: 'fest' }, 'was im Wurzelfeld steht, wird nicht überschrieben');
        const vorher = Sitzungen.fingerabdruck(Sitzungen.entwurfAlsPaket(mitEinstellungen(), liste));
        const t = mitEinstellungen();
        t.entwurf.settings[0].apply[0].path = 'anders';
        assert.notStrictEqual(Sitzungen.fingerabdruck(Sitzungen.entwurfAlsPaket(t, liste)), vorher, 'Einstellungen zählen zum technischen Teil');
    });

    // Ein Knopf für alle Probewerte (2026-10-08) — bis dahin je Zeile ein eigener
    // Weg, gesperrt, sobald etwas lief. Betreiber, mit laufendem Probestart: „der
    // Tab Einstellungen lässt mich nicht speichern".
    await pruefe('Probewerte: mehrere in einem Zug, leer entfernt, unbekannter Schlüssel speichert nichts halb', async () => {
        const s = mitEinstellungen();
        assert.deepStrictEqual(await Sitzungen.probewerteSetzen(s, { max_players: '16', name: 'Probe', oeffentlich: '0' }), { gesetzt: 3, entfernt: 0 });
        assert.deepStrictEqual(db.entwurf.werkbank.werte, { max_players: '16', name: 'Probe', oeffentlich: '0' });
        assert.deepStrictEqual(await Sitzungen.probewerteSetzen(s, { name: '', max_players: '32' }), { gesetzt: 1, entfernt: 1 });
        assert.deepStrictEqual(db.entwurf.werkbank.werte, { max_players: '32', oeffentlich: '0' });
        await assert.rejects(Sitzungen.probewerteSetzen(s, { max_players: '64', gibtsnicht: 'x' }), /Keine Einstellung „gibtsnicht"/);
        assert.deepStrictEqual(db.entwurf.werkbank.werte, { max_players: '32', oeffentlich: '0' }, 'ein abgelehnter Zug hat trotzdem etwas gespeichert');
        for (const unsinn of [undefined, null, {}, [], 'text']) await assert.rejects(Sitzungen.probewerteSetzen(s, unsinn), /nichts zu speichern/);
        // Der Sitzungsteil daneben bleibt, und der Entwurf des Pakets ändert sich nicht.
        assert.deepStrictEqual(db.entwurf.werkbank.portnummern, { game: 34197 });
        assert.ok(!JSON.stringify(Sitzungen.entwurfAlsPaket(s, [])).includes('"werte"'), 'Probewerte stehen im Paket');
    });
    await pruefe('Probewerte gehen auch, während das Spiel läuft — die Einstellung selbst nicht', async () => {
        const s = mitEinstellungen();
        const vorher = Sitzungen.fingerabdruck(Sitzungen.entwurfAlsPaket(s, []));
        db.laeufe.push({ id: 777, sitzung_id: s.id, status: 'laeuft', konsole: '' });
        try {
            await assert.rejects(Sitzungen.einstellungSpeichern(s, formular({ key: 'neu_waehrend_lauf' })), /Spiel der Sitzung läuft/);
            assert.deepStrictEqual(await Sitzungen.probewerteSetzen(s, { max_players: '12' }), { gesetzt: 1, entfernt: 0 });
            assert.strictEqual(db.entwurf.werkbank.werte.max_players, '12');
            assert.strictEqual(Sitzungen.fingerabdruck(Sitzungen.entwurfAlsPaket(s, [])), vorher, 'ein Probewert hat den Fingerabdruck verändert — ein grüner Durchlauf gälte nicht mehr');
        } finally { db.laeufe = []; }
    });
    await pruefe('Probewerte: ein Weg, ein Knopf — die Zeilenknöpfe und ihr Weg sind weg', async () => {
        const ansicht = ohneKommentareEjs(fs.readFileSync(path.join(__dirname, '..', 'plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs'), 'utf8'));
        assert.ok(ansicht.includes('id="knopfProbewerte"'), 'der Knopf fehlt');
        assert.ok(ansicht.includes("hier + '/einstellungen/probewerte'"), 'die Ansicht ruft den Sammelweg nicht auf');
        assert.ok(!/data-probewert-speichern/.test(ansicht), 'die Knöpfe je Zeile stehen noch da');
        assert.ok(!/id="knopfProbewerte"[^>]*beschaeftigt/.test(ansicht), 'der Knopf ist gesperrt, wenn etwas läuft');
        const router = ohneKommentare(fs.readFileSync(path.join(__dirname, '..', 'plugins/werkbank/dashboard/routes/guild.router.js'), 'utf8'));
        assert.ok(router.includes("router.post('/:kennung/einstellungen/probewerte', requirePermission('WERKBANK.BAUEN')"), 'der Sammelweg fehlt oder verlangt das Baurecht nicht');
        assert.ok(!router.includes("/einstellungen/:key/probewert'"), 'der Weg je Zeile steht noch da');
    });

    await pruefe('Start und Durchlauf schicken Definitionen, Probewerte (Vorgabe, Ja/Nein als 1/0) und die Verdrahtung', async () => {
        const s = mitEinstellungen();
        s.entwurf.start.ready_when = { port: 'game' };
        s.entwurf.werkbank.werte = { name: 'Probe' };
        await Sitzungen.starten(s, []);
        let n = daemon.befehle[0].nutzlast;
        assert.deepStrictEqual(n.settings, { max_players: '8', name: 'Probe', rcon_password: '', oeffentlich: '1' });
        assert.deepStrictEqual(n.einstellungen.map(x => x.key), ['max_players', 'name', 'rcon_password', 'oeffentlich']);
        assert.deepStrictEqual(n.env, { RCON_PASSWORD: '{{setting:rcon_password}}' });
        daemon.befehle = []; db.laeufe = []; Ereignisse._laeufe.clear();
        await Sitzungen.pruefen(s, liste);
        n = daemon.befehle[0].nutzlast;
        assert.strictEqual(n.settings.name, 'Probe');
        assert.strictEqual(n.einstellungen.length, 4);
        assert.deepStrictEqual(n.env, { RCON_PASSWORD: '{{setting:rcon_password}}' });
    });

    const nachweis = (x) => [
        { key: 'max_players', ziel: 'file', wo: 'server-settings.json: max_players', zustand: 'angekommen' },
        { key: 'name', ziel: 'arg', wo: 'Startzeile', zustand: 'angekommen' },
        { key: 'rcon_password', ziel: 'env', wo: 'RCON_PASSWORD', zustand: 'angekommen' },
        { key: 'oeffentlich', ziel: 'file', wo: 'server-settings.json: visibility.public', zustand: 'nicht_gefunden', hinweis: 'Schlüssel fehlt' },
        ...(x || []),
    ];
    const mitNachweis = (s, liste, n) => { const g = gruenGeprueft(s, liste); g.ergebnis.einstellungen = n; return g; };

    await pruefe('Belegt: nur angekommene Ziele, der Rest mit Grund — und seine env-Zeile geht mit', async () => {
        const s = mitEinstellungen();
        let b = Sitzungen.belegteEinstellungen(Sitzungen.entwurfAlsPaket(s, liste), { einstellungen: nachweis() });
        assert.deepStrictEqual(b.behalten.map(x => x.key), ['max_players', 'name', 'rcon_password']);
        assert.deepStrictEqual(b.weg, [{ key: 'oeffentlich', grund: 'file server-settings.json: visibility.public: nicht_gefunden — Schlüssel fehlt' }]);
        assert.deepStrictEqual(b.env, { RCON_PASSWORD: '{{setting:rcon_password}}' });
        const ohneEnv = nachweis().map(x => x.key === 'rcon_password' ? { ...x, zustand: 'nicht_verdrahtet' } : x);
        b = Sitzungen.belegteEinstellungen(Sitzungen.entwurfAlsPaket(s, liste), { einstellungen: ohneEnv });
        assert.deepStrictEqual(b.env, {}, 'die Zeile für eine weggefallene Einstellung bleibt nicht stehen');
        // Ein Nachweis für eine ANDERE Datei belegt dieses Ziel nicht.
        const falscheDatei = nachweis().map(x => x.key === 'max_players' ? { ...x, wo: 'andere.json: max_players' } : x);
        b = Sitzungen.belegteEinstellungen(Sitzungen.entwurfAlsPaket(s, liste), { einstellungen: falscheDatei });
        assert.ok(!b.behalten.some(x => x.key === 'max_players'));
        // Durchlauf ohne Nachweis (Daemon vor B1): nichts belegt, und das wird gesagt.
        b = Sitzungen.belegteEinstellungen(Sitzungen.entwurfAlsPaket(s, liste), { gruen: true });
        assert.strictEqual(b.behalten.length, 0);
        assert.match(b.weg[0].grund, /keinen Nachweis/);
    });

    await pruefe('Veröffentlichen sperrt, wenn eine unbelegte Einstellung in der Startzeile steht', async () => {
        const s = mitEinstellungen();
        const n = nachweis().map(x => x.key === 'name' ? { ...x, zustand: 'nicht_verdrahtet' } : x);
        let st = await Sitzungen.veroeffentlichungsStand(s, liste, [mitNachweis(s, liste, n)]);
        assert.match(st.gruende.join(' '), /„name" wird in Startzeile oder Schritten benutzt/);
        st = await Sitzungen.veroeffentlichungsStand(s, liste, [mitNachweis(s, liste, nachweis())]);
        assert.strictEqual(st.darf, true, st.gruende.join(' '));
    });

    await pruefe('das Paket mit Einstellungen besteht check-pakete und nennt, was fehlt', async () => {
        const f = require('../packages/fbpkg/beispiele/factorio.json');
        const s = mitEinstellungen();
        s.image = f.image;
        const echt = f.install.steps.map(schritt => ({ status: 'ok', schritt }));
        const paket = Sitzungen.veroeffentlichungsPaket(s, echt, mitNachweis(s, echt, nachweis()), 'firedervil');
        assert.deepStrictEqual(paket.settings.map(x => x.key), ['max_players', 'name', 'rcon_password']);
        assert.deepStrictEqual(paket.env, { RCON_PASSWORD: '{{setting:rcon_password}}' });
        const offen = paket.status.open.join('\n');
        assert.match(offen, /Einstellungen: 3 im Durchlauf #3 als angekommen belegt/);
        assert.match(offen, /Nicht aufgenommen: Einstellung „oeffentlich"/);
        assert.ok(!/Die Werkbank kennt sie noch nicht/.test(offen));
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

    await pruefe('configured: Nachweis als Konsolenzeilen, der Bereitschaftsstand bleibt unberührt', async () => {
        await Sitzungen.starten(sitzungMitStart(), []);
        const lauf = db.laeufe[0];
        await Ereignisse.beiGestartet({ sitzung_id: 'wbprobe' });
        await Ereignisse.beiBereitschaft({ sitzung_id: 'wbprobe', type: 'started' });
        const vorher = lauf.bereitschaft;
        await Ereignisse.beiBereitschaft({ sitzung_id: 'wbprobe', type: 'configured', results: [], nachweis: nachweis() });
        assert.strictEqual(lauf.bereitschaft, vorher, 'configured ist keine Bereitschaftsstufe');
        const z = sse.gesendet.find(x => x.daten.action === 'einstellungen');
        assert.ok(z, 'kein einstellungen-Ereignis');
        assert.match(z.daten.zeilen.join('\n'), /✓ max_players → file server-settings\.json: max_players: angekommen/);
        assert.match(z.daten.zeilen.join('\n'), /✗ oeffentlich .*nicht_gefunden — Schlüssel fehlt/);
    });


    console.log('\nVorschläge aus einer Datei (B2-1)');

    await pruefe('Vertrag: die Formate der Vorschläge sind genau die, die der Daemon liest', async () => {
        const go = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/parser/lesen.go'), 'utf8'));
        const block = go.slice(go.indexOf('switch schreiber {'), go.indexOf('default:', go.indexOf('switch schreiber {')));
        const liest = [...block.matchAll(/case "([a-z]+)":\s*\n\s*(?:err = )?lese/g)].map(x => x[1]).sort();
        assert.deepStrictEqual(liest, ['cfg', 'ini', 'json', 'properties', 'xml', 'yaml'], 'der Daemon liest: ' + liest);
        // text liest der Daemon ausdrücklich NICHT (Schreiber ersetzt ganze Zeilen).
        assert.match(block, /case "text", "file":\s*\n[\s\S]*?return Lesung\{\}, fmt\.Errorf/);
        const ejs = ohneKommentare(fs.readFileSync(path.join(__dirname, '../plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs'), 'utf8'));
        const m = ejs.match(/\['json', 'ini', 'yaml', 'properties', 'xml', 'cfg'\]\.forEach/);
        assert.ok(m, 'die Formatauswahl der Seite hat sich geändert — hier nachziehen');
        for (const f of ['json', 'ini', 'yaml', 'properties', 'xml', 'cfg']) assert.ok(Sitzungen.EINSTELLUNG.parser.includes(f));
        await assert.rejects(Sitzungen.schluesselLesen(mitEinstellungen(), { datei: 'server.cfg', parser: 'text' }), /Format/);
        assert.strictEqual(daemon.befehle.length, 0, 'text darf gar nicht erst beim Daemon ankommen');
    });

    // cfg kam am 2026-10-10 dazu (ET: Legacy, `set name "wert"`). Ein Format,
    // das nur an EINER der vier Stellen steht, scheitert spät: Die Werkbank
    // bietet es an, das Schema weist das Paket ab — oder fb-init den Auftrag.
    await pruefe('Vertrag: Auftrag des Daemons, Paketschema und Werkbank kennen dieselben Formate — cfg eingeschlossen', async () => {
        const validate = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'pkg/protocol/job_validate.go'), 'utf8'));
        const karte = validate.slice(validate.indexOf('var bekannteParser'), validate.indexOf('}', validate.indexOf('var bekannteParser')));
        const auftrag = [...karte.matchAll(/"([a-z]+)": true/g)].map(x => x[1]).sort();
        assert.ok(auftrag.includes('cfg'), 'der Auftrag kennt cfg nicht: ' + auftrag);

        const schema = require('../packages/fbpkg/schema/fbpkg-v1.schema.json');
        const listen = [];
        (function suche(k) {
            if (!k || typeof k !== 'object') return;
            if (k.parser && Array.isArray(k.parser.enum)) listen.push([...k.parser.enum].sort());
            for (const v of Object.values(k)) suche(v);
        })(schema);
        assert.strictEqual(listen.length, 3, 'das Schema nennt die Formate an ' + listen.length + ' Stellen — erwartet 3 (apply, config, files.patch)');
        for (const l of listen) assert.deepStrictEqual(l, auftrag, 'Schema und Auftrag weichen ab');
        assert.deepStrictEqual([...Sitzungen.EINSTELLUNG.parser].sort(), auftrag, 'Werkbank und Auftrag weichen ab');

        const schreibt = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/parser/bericht.go'), 'utf8'));
        assert.match(schreibt, /schreiber == "cfg"[\s\S]{0,80}parseCfgFile/, 'der Schreiber für cfg ist nicht eingehängt');

        // Lesen kommt beim Daemon an, die Endung schlägt das Format vor, und
        // was übernommen wird, ist nach dem Schema ein gültiges Ziel.
        daemon.antwort = { success: true, data: { funde: [{ pfad: 'g_xpSave', wert: '0', art: 'zahl' }], ausgelassen: [{ pfad: 'exec', grund: 'ist ein Befehl, keine Variable' }], anzahl_funde: 1 } };
        const l = await Sitzungen.schluesselLesen(mitEinstellungen(), { datei: 'game/etmain/legacy.cfg', parser: 'cfg' });
        assert.strictEqual(daemon.befehle[0].nutzlast.datei, 'etmain/legacy.cfg');
        assert.strictEqual(daemon.befehle[0].nutzlast.parser, 'cfg');
        assert.strictEqual(l.funde[0].vorschlag.key, 'g_xp_save');
        assert.deepStrictEqual(Sitzungen.vorschlagsDateien([{ dateien: { neu: [{ pfad: 'game/etmain/legacy.cfg' }] } }]).map(v => v.datei + ':' + v.format),
            ['etmain/legacy.cfg:cfg']);

        const s = mitEinstellungen();
        await Sitzungen.vorschlaegeUebernehmen(s, { datei: 'etmain/legacy.cfg', parser: 'cfg', auswahl: [{ pfad: 'g_xpSave' }] });
        const neu = s.entwurf.settings.find(x => x.key === 'g_xp_save');
        assert.deepStrictEqual(neu.apply[0], { target: 'file', file: 'etmain/legacy.cfg', parser: 'cfg', path: 'g_xpSave' });
        const Ajv = require('ajv');
        const ajv = new Ajv({ allErrors: true, strict: false });
        ajv.addSchema(schema, 'fbpkg');
        const pruef = ajv.compile({ $ref: 'fbpkg#/properties/settings/items' });
        assert.ok(pruef(neu), 'nach Schema ungültig: ' + JSON.stringify(pruef.errors));
        // Gegenprobe: ein erfundenes Format geht durch keine der Stellen.
        assert.ok(!pruef({ ...neu, apply: [{ ...neu.apply[0], parser: 'conf' }] }), 'das Schema nimmt ein unbekanntes Format an');
        await assert.rejects(Sitzungen.schluesselLesen(mitEinstellungen(), { datei: 'a.cfg', parser: 'conf' }), /Format/);
    });

    await pruefe('Kandidaten: nur game/, nur bekannte Endungen, relativ zu game/', async () => {
        const laeufe = [
            { dateien: { neu: [{ pfad: 'game/server-settings.json', groesse: 3 }, { pfad: 'game/factorio-current.log', groesse: 9 },
                { pfad: 'data/.config/x.json', groesse: 1 }], geaendert: [{ pfad: 'game/config/a.ini', groesse: 2 }] } },
            { dateien: JSON.stringify({ neu: [{ pfad: 'game/server-settings.json', groesse: 3 }], geaendert: [] }) },
            { dateien: null },
        ];
        assert.deepStrictEqual(Sitzungen.vorschlagsDateien(laeufe).map(v => v.datei + ':' + v.format),
            ['config/a.ini:ini', 'server-settings.json:json']);
        // Die Datei der Installation zuerst — auch wenn das Spiel sie nie anfasst (Factorio).
        const schritte = [{ type: 'template', file: 'data/server.json' }, { type: 'script' }, { type: 'template', file: 'README' }];
        assert.deepStrictEqual(Sitzungen.vorschlagsDateien([{ dateien: { neu: [{ pfad: 'game/b.json' }] } }], schritte).map(v => v.datei + ':' + v.herkunft),
            ['data/server.json:template', 'b.json:probestart']);
    });

    const lesung = () => ({ success: true, data: { funde: [
        { pfad: 'max_players', wert: '8', art: 'zahl' },
        { pfad: 'visibility.public', wert: 'true', art: 'janein', as: 'true_false' },
        { pfad: 'visibility.lan', wert: 'false', art: 'janein', as: 'true_false' },
        { pfad: 'game_password', wert: 'geheim', art: 'text' },
        { pfad: 'MaxPlayers', wert: '4', art: 'zahl' },
    ], ausgelassen: [{ pfad: 'tags', grund: 'eine Liste' }], anzahl_funde: 5 } });

    await pruefe('Lesen: Vorhandenes erkannt, freie Schlüssel, Kennwort ohne Vorgabe, game/-Präfix abgestreift', async () => {
        daemon.antwort = lesung();
        const l = await Sitzungen.schluesselLesen(mitEinstellungen(), { datei: 'game/server-settings.json', parser: 'json' });
        assert.strictEqual(daemon.befehle[0].befehl, 'werkbank.schluessel');
        assert.strictEqual(daemon.befehle[0].nutzlast.datei, 'server-settings.json');
        const nach = Object.fromEntries(l.funde.map(f => [f.pfad, f]));
        assert.strictEqual(nach['visibility.public'].vorhanden, 'oeffentlich');
        assert.strictEqual(nach.max_players.vorhanden, 'max_players');
        assert.strictEqual(nach['visibility.lan'].vorschlag.type, 'boolean');
        assert.strictEqual(nach.game_password.vorschlag.type, 'password');
        // max_players ist vergeben, MaxPlayers darf ihn nicht noch einmal bekommen
        assert.strictEqual(nach.MaxPlayers.vorschlag.key, 'max_players_2');
        assert.strictEqual(l.ausgelassen.length, 1);
        await assert.rejects(Sitzungen.schluesselLesen(mitEinstellungen(), { datei: '../geheim.json', parser: 'json' }), /ohne/);
    });

    await pruefe('Übernehmen: nur was der Daemon jetzt anbietet, als Experte/Neustart, gültig nach Schema', async () => {
        daemon.antwort = lesung();
        const s = mitEinstellungen();
        await Sitzungen.vorschlaegeUebernehmen(s, { datei: 'server-settings.json', parser: 'json', auswahl: [
            { pfad: 'visibility.lan', key: 'lan', name_de: 'Im LAN sichtbar' },
            { pfad: 'game_password' },
        ] });
        const neu = db.entwurf.settings.filter(x => ['lan', 'game_password'].includes(x.key));
        assert.strictEqual(neu.length, 2, JSON.stringify(db.entwurf.settings.map(x => x.key)));
        const lan = neu.find(x => x.key === 'lan');
        assert.deepStrictEqual([lan.role, lan.takes_effect, lan.type, lan.default], ['expert', 'restart', 'boolean', false]);
        assert.deepStrictEqual(lan.apply, [{ target: 'file', file: 'server-settings.json', parser: 'json', path: 'visibility.lan', as: 'true_false' }]);
        const pw = neu.find(x => x.key === 'game_password');
        assert.strictEqual(pw.type, 'password');
        assert.ok(!('default' in pw), 'der Wert aus der Datei darf bei Kennwörtern nicht Vorgabe werden');
        const Ajv = require('ajv');
        const ajv = new Ajv({ allErrors: true, strict: false });
        ajv.addSchema(require('../packages/fbpkg/schema/fbpkg-v1.schema.json'), 'fbpkg');
        const pruef = ajv.compile({ $ref: 'fbpkg#/properties/settings/items' });
        for (const x of neu) assert.ok(pruef(x), x.key + ': ' + JSON.stringify(pruef.errors));
        assert.strictEqual(daemon.befehle.filter(b => b.befehl === 'werkbank.schluessel').length, 1, 'vor dem Übernehmen neu gelesen');

        await assert.rejects(Sitzungen.vorschlaegeUebernehmen(mitEinstellungen(), { datei: 'server-settings.json', parser: 'json',
            auswahl: [{ pfad: 'erfunden.pfad' }] }), /nicht \(mehr\)/);
        await assert.rejects(Sitzungen.vorschlaegeUebernehmen(mitEinstellungen(), { datei: 'server-settings.json', parser: 'json',
            auswahl: [{ pfad: 'visibility.public' }] }), /schon als „oeffentlich"/);
        await assert.rejects(Sitzungen.vorschlaegeUebernehmen(mitEinstellungen(), { datei: 'server-settings.json', parser: 'json',
            auswahl: [] }), /Nichts angekreuzt/);
    });

    console.log('\nStartzeilen-Baukasten (S1)');
    const { argsAusZeilen, zeilenAusArgs } = require(path.join(HELFER, 'Startzeile.js'));
    const Ajv1 = require('ajv');
    const fbpkg1 = require('../packages/fbpkg/schema/fbpkg-v1.schema.json');
    const argGueltig = new Ajv1({ allErrors: true, strict: false })
        .compile({ ...fbpkg1.definitions.startArg, definitions: fbpkg1.definitions });

    await pruefe('Zeilen → start.args: Form, Quelle, Bedingung wie der Daemon sie liest, gültig nach Schema', async () => {
        const a = argsAusZeilen([
            { form: '-nographics', quelle: 'fest' },
            { form: '-name {{Wert}}', quelle: 'setting:name' },
            { form: '-Xmx{{Wert}}M', quelle: 'setting:memory' },
            { form: '-password {{Wert}}', quelle: 'setting:password', bedingung: 'not_empty' },
            { form: '-crossplay', quelle: 'setting:crossplay', bedingung: 'true' },
            { form: '@{{Wert}}_args.txt', quelle: 'setting:loader', bedingung: '=forge,neoforge' },
            { form: '--start-server "saves/meine welt.zip"', quelle: 'fest' },
            { form: '-QueryPort={{port:query}}', quelle: 'text' },
            { form: '?ServerPassword={{setting:pw}}', quelle: 'text', bedingung: 'not_empty' },
            { form: '   ', quelle: 'fest' },
        ]);
        for (const x of a) assert.ok(argGueltig(x), JSON.stringify(x) + ' ' + JSON.stringify(argGueltig.errors));
        assert.strictEqual(a.length, 9, 'leere Zeile fällt weg');
        assert.deepStrictEqual(a[1], { key: 'name', form: ['-name', '{{value}}'], from: 'setting:name' });
        assert.deepStrictEqual(a[2], { key: 'xmx', form: '-Xmx{{value}}M', from: 'setting:memory' });
        assert.deepStrictEqual(a[3].when, 'not_empty');
        assert.deepStrictEqual(a[5], { key: 'arg', form: '@{{value}}_args.txt', from: 'setting:loader', when: '=forge,neoforge' });
        assert.deepStrictEqual(a[6].form, ['--start-server', 'saves/meine welt.zip'], '"…" hält zusammen');
        assert.deepStrictEqual(a[7], { key: 'queryport', parts: [{ text: '-QueryPort={{port:query}}' }] });
        assert.deepStrictEqual(a[8].parts, [{ text: '?ServerPassword={{setting:pw}}', when: 'not_empty' }],
            'Bedingung am STÜCK — dort wertet BaueArgv sie aus, am Eintrag nicht');
    });

    await pruefe('Zeilen: was der Daemon nicht versteht, wird mit Grund abgewiesen', async () => {
        assert.throws(() => argsAusZeilen([{ form: '-port {{Wert}}', quelle: 'fest' }]), /Quelle/);
        assert.throws(() => argsAusZeilen([{ form: '-x', quelle: 'fest', bedingung: 'true' }]), /feste Zeile/);
        assert.throws(() => argsAusZeilen([{ form: '-x', quelle: 'setting:a' }]), /immer dabei/);
        // Unbekannter Platzhalter: beim Speichern, mit dem Vorschlag, nicht erst im Daemon.
        assert.throws(() => argsAusZeilen([{ form: '-Port={{game}}', quelle: 'port:game', bedingung: 'not_empty' }]),
            /\{\{game\}\} gibt es nicht.*-Port=\{\{Wert\}\}/);
        assert.throws(() => argsAusZeilen([{ form: '-Port={{game}}', quelle: 'text' }]), /\{\{port:game\}\}/);
        assert.throws(() => argsAusZeilen([{ form: '-Port={{game}}', quelle: 'fest' }]), /Text mit Verweisen/);
        assert.doesNotThrow(() => argsAusZeilen([{ form: '-Port={{Wert}}', quelle: 'port:game' }]));
        assert.doesNotThrow(() => argsAusZeilen([{ form: '-QueryPort={{port:query}}', quelle: 'text' }]));
        assert.throws(() => argsAusZeilen([{ form: '-q={{Wert}}', quelle: 'text' }]), /kein \{\{Wert\}\}/);
        // Ein echter Verweis ausserhalb von „Text": der Daemon setzt ihn dort nicht ein
        // (7 Days to Die, 2026-10-08 — gespeichert, beim Probestart „Auftrag unvollständig").
        assert.throws(() => argsAusZeilen([{ form: '-ServerPort={{port:game}}', quelle: 'fest' }]), /wörtlich an das Spiel.*Text mit Verweisen/);
        assert.throws(() => argsAusZeilen([{ form: '-port {{port:game}}', quelle: 'fest' }]), /Quelle „Port: game" und schreib „-port \{\{Wert\}\}"/);
        assert.throws(() => argsAusZeilen([{ form: '-port={{port:game}}', quelle: 'port:game', bedingung: 'not_empty' }]), /schreib „-port=\{\{Wert\}\}"/);
        assert.throws(() => argsAusZeilen([{ form: '-a={{Wert}}:{{port:query}}', quelle: 'port:game' }]), /nur \{\{Wert\}\} eingesetzt/);
        // „wenn an" an einem Text: beim Speichern, nicht als stumm fehlender Parameter
        // (StarRupture, -ServerName, 2026-10-05). Ohne bekannten Typ geht es durch.
        const typen = [{ key: 'name', type: 'text' }, { key: 'crossplay', type: 'boolean' }, { key: 'slots', type: 'number' }];
        assert.throws(() => argsAusZeilen([{ form: '-ServerName={{Wert}}', quelle: 'setting:name', bedingung: 'true' }], typen),
            /„wenn an" gilt nur für einen Schalter.*„name" ist vom Typ text.*„immer" oder „wenn gesetzt"/);
        assert.throws(() => argsAusZeilen([{ form: '-open', quelle: 'setting:slots', bedingung: 'false' }], typen), /„wenn aus".*Typ number/);
        assert.throws(() => argsAusZeilen([{ form: '-Port={{Wert}}', quelle: 'port:game', bedingung: 'true' }], typen), /ein Port ist eine Nummer/);
        assert.doesNotThrow(() => argsAusZeilen([{ form: '-crossplay', quelle: 'setting:crossplay', bedingung: 'true' }], typen));
        assert.doesNotThrow(() => argsAusZeilen([{ form: '-ServerName={{Wert}}', quelle: 'setting:name', bedingung: 'not_empty' }], typen));
        assert.doesNotThrow(() => argsAusZeilen([{ form: '-ServerName={{Wert}}', quelle: 'setting:name' }], typen));
        assert.doesNotThrow(() => argsAusZeilen([{ form: '-x', quelle: 'setting:gibtsnochnicht', bedingung: 'true' }], typen));
        assert.doesNotThrow(() => argsAusZeilen([{ form: '-x', quelle: 'setting:name', bedingung: 'true' }]), 'ohne Typen keine Aussage');
        assert.throws(() => argsAusZeilen([{ form: '-name "offen', quelle: 'fest' }]), /Anführungszeichen/);
        assert.throws(() => argsAusZeilen([{ form: '-a {{Wert}}', quelle: 'setting:a', bedingung: 'vielleicht' }]), /gibt es nicht/);
        assert.throws(() => argsAusZeilen([{ form: '-a', quelle: 'env:HOME' }]), /Quelle/);
    });

    await pruefe('Rundreise: alle Beispielpakete kommen unverändert zurück, Schlüssel bleiben', async () => {
        const ordner = path.join(__dirname, '../packages/fbpkg/beispiele');
        const gleich = (x) => JSON.stringify(x.map(a => (a.form === undefined ? a : { ...a, form: [].concat(a.form) })));
        for (const f of fs.readdirSync(ordner).filter(n => n.endsWith('.json'))) {
            const args = JSON.parse(fs.readFileSync(path.join(ordner, f), 'utf8')).start.args || [];
            assert.strictEqual(gleich(argsAusZeilen(zeilenAusArgs(args))), gleich(args), f);
        }
        const doppelt = argsAusZeilen([{ key: 'port', form: '-a {{Wert}}', quelle: 'port:game' },
            { key: 'port', form: '-b {{Wert}}', quelle: 'port:query' }]);
        assert.deepStrictEqual(doppelt.map(a => a.key), ['port', 'b'], 'doppelter Schlüssel wird neu vergeben');
    });

    await pruefe('Rundreise: was eine Zeile nicht ausdrücken kann, geht unverändert durch', async () => {
        const fremd = [
            { key: 'frei', form: ['-x', '{{value}}'], from: 'free' },
            { key: 'fest_bedingt', form: '-y', from: 'fixed', when: 'true' },
            { key: 'stuecke', parts: [{ text: '?A={{setting:a}}', when: 'not_empty' }, { text: '?B=1', when: 'true' }] },
        ];
        const z = zeilenAusArgs(fremd);
        assert.ok(z.every(x => x.roh), 'alle drei als roh');
        assert.deepStrictEqual(argsAusZeilen(z), fremd);
    });

    await pruefe('Vorschau: werkbank.startzeile mit Probewerten und Portnummern, nichts gespeichert', async () => {
        daemon.antwort = { success: true, data: { programm: './x', argumente: ['--port', '34197'], fehlend: ['xmx (setting:memory): …'] } };
        const s = { ...sitzungMitStart(), entwurf: { ...sitzungMitStart().entwurf,
            settings: [{ key: 'memory', type: 'number', default: 2048 }, { key: 'crossplay', type: 'boolean', default: true }] } };
        const r = await Sitzungen.startzeile(s, { program: './x', args: [] });
        const b = daemon.befehle[0];
        assert.strictEqual(b.befehl, 'werkbank.startzeile');
        assert.deepStrictEqual(b.nutzlast.portnummern, { game: 34197 });
        assert.deepStrictEqual(b.nutzlast.settings, { memory: '2048', crossplay: '1' }, 'dieselben Werte wie beim Probestart');
        assert.deepStrictEqual(r.argumente, ['--port', '34197']);
        assert.strictEqual(r.fehlend.length, 1);
        assert.strictEqual(db.entwurf, null, 'nichts geschrieben');
        daemon.antwort = { success: false, error: 'kaputt' };
        await assert.rejects(Sitzungen.startzeile(s, { program: './x' }), /kaputt/);
    });

    await pruefe('Oberfläche: Baukasten statt Textfeld, Zeilen ohne name, Vorschau über die Route', async () => {
        const view = ohneKommentare(fs.readFileSync(path.join(__dirname, '../plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs'), 'utf8'));
        const router = ohneKommentare(fs.readFileSync(path.join(__dirname, '../plugins/werkbank/dashboard/routes/guild.router.js'), 'utf8'));
        assert.ok(!/name="args"/.test(view), 'das alte Textfeld ist noch da');
        assert.match(view, /id="startBaukasten"/);
        assert.match(view, /n\.zeilen = baukasten \? zeilenEinsammeln\(\)/, 'Start/Speichern schicken die Zeilen');
        assert.match(view, /querySelectorAll\('input\[name\], textarea\[name\], select\[name\]'\)/,
            'nur benannte Felder einsammeln — sonst landen Zeilenfelder als Müll in der Nutzlast');
        assert.match(view, /schicke\(hier \+ '\/startzeile'/);
        assert.match(router, /router\.post\('\/:kennung\/startzeile'/);
        assert.strictEqual((router.match(/argsAusZeilen\(/g) || []).length, 2, 'Speichern und Vorschau übersetzen gleich');
    });

    console.log('\nDateien je Schritt und Prüfsumme (W1, W2)');
    const SUMME = 'sha256:' + 'ab'.repeat(32);
    const VERGLEICH = { neu: [{ pfad: 'game/downloader.zip', groesse: 9724217 }], geaendert: [], weg: [], anzahl_neu: 1, anzahl_geaendert: 0, anzahl_weg: 0 };

    await pruefe('W1: der Dateivergleich des Daemons wird am Schritt gespeichert — auch beim Scheitern', async () => {
        await Sitzungen.schrittAusfuehren({ sitzung: db.sitzung, schritt: { type: 'mkdir', path: 'mods' } });
        await Ereignisse.beiEnde({ sitzung_id: 'wbprobe', bytes: 1, dateien: VERGLEICH }, true);
        assert.deepStrictEqual(JSON.parse(db.schritte[0].dateien), VERGLEICH);
        db.schritte = [];
        await Sitzungen.schrittAusfuehren({ sitzung: db.sitzung, schritt: { type: 'mkdir', path: 'mods' } });
        await Ereignisse.beiEnde({ sitzung_id: 'wbprobe', error: 'Code 1', dateien: VERGLEICH }, false);
        assert.ok(db.schritte[0].dateien, 'auch ein gescheiterter Schritt zeigt, was er hinterließ');
        db.schritte = [];
        await Sitzungen.schrittAusfuehren({ sitzung: db.sitzung, schritt: { type: 'mkdir', path: 'mods' } });
        await Ereignisse.beiEnde({ sitzung_id: 'wbprobe', bytes: 1 }, true);
        assert.strictEqual(db.schritte[0].dateien, null, 'älterer Daemon: kein Vergleich, kein Fehler');
    });

    await pruefe('W2: gerechnete Summe wird in einen Download OHNE Summe eingetragen, vor dem Status', async () => {
        await Sitzungen.schrittAusfuehren({ sitzung: db.sitzung, schritt: { type: 'download', url: 'https://x.de/a.zip', target: 'a.zip', checksum: '' } });
        await Ereignisse.beiEnde({ sitzung_id: 'wbprobe', bytes: 1, pruefsumme: SUMME }, true);
        const s = db.schritte[0];
        assert.strictEqual(JSON.parse(s.schritt).checksum, SUMME);
        assert.match(s.ausgabe, /ausgerechnet und in den Schritt eingetragen/);
        assert.strictEqual(s.status, 'ok');
        const paket = Sitzungen.entwurfAlsPaket(db.sitzung, db.schritte.map(x => ({ ...x, schritt: JSON.parse(x.schritt) })));
        assert.strictEqual(paket.install.steps[0].checksum, SUMME, 'der Entwurf trägt sie');
    });

    await pruefe('W2: eine angegebene Summe wird nie überschrieben; gescheitert oder Unsinn trägt nichts ein', async () => {
        const eigene = 'sha1:' + 'c'.repeat(40);
        await Sitzungen.schrittAusfuehren({ sitzung: db.sitzung, schritt: { type: 'download', url: 'https://x.de/a.zip', target: 'a.zip', checksum: eigene } });
        await Ereignisse.beiEnde({ sitzung_id: 'wbprobe', bytes: 1, pruefsumme: SUMME }, true);
        assert.strictEqual(JSON.parse(db.schritte[0].schritt).checksum, eigene);
        db.schritte = [];
        await Sitzungen.schrittAusfuehren({ sitzung: db.sitzung, schritt: { type: 'download', url: 'https://x.de/a.zip', target: 'a.zip' } });
        await Ereignisse.beiEnde({ sitzung_id: 'wbprobe', error: 'curl', pruefsumme: SUMME }, false);
        assert.ok(!JSON.parse(db.schritte[0].schritt).checksum, 'gescheitert: keine Summe');
        assert.strictEqual(await Sitzungen.pruefsummeEintragen(db.schritte[0].id, 'md5:abc'), false);
        assert.strictEqual(await Sitzungen.pruefsummeEintragen(db.schritte[0].id, 'sha256:ABC'), false);
    });

    await pruefe('W2: ohne Summe kein Prüfdurchlauf — der Mangel sagt, was zu tun ist', async () => {
        const m = Sitzungen.durchlaufMaengel({ install: { steps: [{ type: 'download', url: 'https://x.de/a.zip', target: 'a.zip' }] },
            start: { program: 'x', ready_when: { port: 'game' }, stop: { sequence: [{ step: 'sigint' }, { step: 'sigkill' }] } }, ports: [] });
        assert.ok(m.some(x => /a\.zip hat keine Prüfsumme/.test(x)), m.join(' | '));
    });

    await pruefe('Vertrag: der Daemon schickt dateien und pruefsumme mit fertig, dateien mit fehlgeschlagen', async () => {
        const ws = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/websocket/werkbank.go'), 'utf8'));
        const fertig = ws.slice(ws.indexOf('fertig := map[string]interface{}{'));
        assert.match(fertig.slice(0, 300), /"dateien":\s*erg\.Dateien/);
        assert.match(fertig.slice(0, 500), /fertig\["pruefsumme"\]\s*=\s*erg\.Pruefsumme/);
        const fehl = ws.slice(ws.indexOf('protocol.WerkbankFehlgeschlagen'));
        assert.match(fehl.slice(0, 300), /"dateien":\s*erg\.Dateien/);
        const go = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/gameserver/werkbank.go'), 'utf8'));
        assert.match(go, /summeErmitteln:\s*summeErmitteln/, 'nur der Einzelschritt ermittelt');
        const pruef = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/gameserver/werkbank_pruefung.go'), 'utf8'));
        assert.ok(!/summeErmitteln|SummeErmitteln/.test(pruef), 'der Prüfdurchlauf darf nie ohne Summe laufen');
    });

    console.log('\nLive-Kanal und Programmfeld');

    await pruefe('Zustand: was läuft, für die Seite nach dem Verbinden', async () => {
        assert.deepStrictEqual(await Sitzungen.zustand('wbprobe'), { schritt: false, spiel: false, pruefung: false });
        await Sitzungen.schrittAusfuehren({ sitzung: db.sitzung, schritt: { type: 'mkdir', path: 'mods' } });
        assert.strictEqual((await Sitzungen.zustand('wbprobe')).schritt, true);
        assert.strictEqual((await Sitzungen.zustand('wbfremd')).schritt, false, 'fremde Sitzung');
    });

    await pruefe('Seite: fragt beim (Wieder-)Verbinden den Zustand ab und lädt bei verpasstem Ende neu', async () => {
        const view = ohneKommentare(fs.readFileSync(path.join(__dirname, '../plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs'), 'utf8'));
        const router = ohneKommentare(fs.readFileSync(path.join(__dirname, '../plugins/werkbank/dashboard/routes/guild.router.js'), 'utf8'));
        const offen = view.slice(view.indexOf("strom.addEventListener('open'"));
        assert.ok(offen.length > 30, 'kein open-Zuhörer am Live-Kanal');
        assert.match(offen.slice(0, 1200), /fetch\(hier \+ '\/zustand'/);
        assert.match(offen.slice(0, 1200), /werkbankSpiel === '1' && !jetzt\.spiel/);
        assert.match(offen.slice(0, 1200), /if \(vorbei \|\| wieder\)/, 'nach Wiederverbindung immer neu laden');
        assert.match(router, /router\.get\('\/:kennung\/zustand'/);
    });

    await pruefe('Programmfeld: ein Schalter darin wird mit Grund abgewiesen, ein Pfad mit Leerzeichen nicht', async () => {
        const basis = { stop: 'sigkill 10' };
        assert.throws(() => startAusFormular({ ...basis, program: './downloader/hytale-downloader-linux-amd64 --download-path hytale.zip' }),
            /Parameter „--download-path"/);
        assert.throws(() => startAusFormular({ ...basis, program: './x -download-path y' }), /-download-path/);
        assert.strictEqual(startAusFormular({ ...basis, program: './Astro Colony/Server.x86_64' }).program, './Astro Colony/Server.x86_64');
    });

    await pruefe('Konsole: Farbcodes der Spiele werden beim Anzeigen entfernt — an jeder Stelle', async () => {
        const roh = fs.readFileSync(path.join(__dirname, '../plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs'), 'utf8');
        const view = ohneKommentare(roh);
        // Die Regel selbst, an einer echten Hytale-Zeile (2026-10-01): `[m` landete in der Anmeldeadresse.
        const m = /function lesbar\(t\) \{ return String\([^)]*\)\.replace\((\/.+\/g), ''\); \}/.exec(view);
        assert.ok(m, 'lesbar() nicht gefunden');
        const lesbar = new Function('t', `return String(t).replace(${m[1]}, '');`);
        const zeile = '\x1b[m[2026/10/01 14:32:23   INFO] [AbstractCommand] Or visit: https://x/verify?user_code=ABCD1234\x1b[m';
        assert.strictEqual(lesbar(zeile), '[2026/10/01 14:32:23   INFO] [AbstractCommand] Or visit: https://x/verify?user_code=ABCD1234');
        assert.strictEqual(lesbar('\x1b[0;32mgrün\x1b[0m \x1b[38;5;226mgelb\x1b[0m'), 'grün gelb');
        assert.strictEqual((view.match(/function lesbar\(t\)/g) || []).length, 2, 'Server-Teil UND Skript');
        // Jede Stelle, die Spielausgabe zeigt, geht durch lesbar().
        for (const muster of [/lesbar\(x\.ausgabe\)/, /lesbar\(lauf && lauf\.konsole\)/, /lesbar\(pruefung && pruefung\.protokoll\)/,
            // Die drei Live-Wege gehen seit 2026-10-09 über Sammler (Zeichnen in
            // Schüben, scripts/check-werkbank-konsole.js) — bereinigt wird beim
            // Hineingeben, an jeder der drei Stellen.
            /insProtokoll\(lesbar\(d\.line\)\)/, /inKonsole\(lesbar\(d\.line\)\)/, /inLive\(\(d\.finding \? '⚑ ' : ''\) \+ lesbar\(d\.line\)\)/]) {
            assert.match(view, muster);
        }
        // Keine Live-Zeile geht an lesbar() vorbei — weder in einen Sammler
        // noch direkt in die Seite.
        const ohneBereinigte = view.replace(/lesbar\(d\.line\)/g, '');
        assert.ok(!/\bd\.line\b/.test(ohneBereinigte.slice(ohneBereinigte.indexOf("strom.addEventListener('werkbank'"))),
            'eine Live-Zeile geht roh in die Seite');
    });

    console.log(`\n${bestanden} Prüfung(en) bestanden.\n`);
    process.exit(process.exitCode || 0);
})();
