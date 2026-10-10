#!/usr/bin/env node
/**
 * Abruf für Spieler: was ein Paket freigibt, liefert der Daemon aus
 * (`files.public`, Weg `/dl/`, 2026-10-10).
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 *
 * Betreiber, 2026-10-10 (ET: Legacy): *„die maps und karten campaigns kann ich
 * über einen sv_wwwDownload zum schnelleren download anbieten, wie machen wir
 * das?"* — abgesprochen: Der Daemon liefert selbst aus, über den Zuhörer der
 * Sicherungen; das Paket sagt per Muster, welche Dateien; die Adresse erfährt
 * das Spiel über `{{env:FB_DOWNLOAD_URL}}`.
 *
 * Ausgeliefert wird OHNE Anmeldung. Neben den Karten liegt die Konfiguration
 * des Servers mit seinen Kennwörtern. Deshalb hängt alles an den Mustern — und
 * daran, dass drei Stellen sie gleich verstehen:
 *
 *   1. Die Regel: Werkbank (packages/fbpkg/lib/oeffentlich.js) und Daemon
 *      (internal/pkgspec/oeffentlich.go) weisen dieselben Muster ab. Die Liste
 *      der gesperrten Endungen wird im Daemon NACHGELESEN, nicht erinnert.
 *   2. Die Adresse: eine Rechnung für „wie heisst die Maschine von aussen"
 *      (gameserver/helpers/Abruf.js), für Sicherungen und für den Abruf.
 *   3. Die Werkbank: das Feld der Karte „Dateien und Spielstand", der Verweis
 *      in festen Zeilen (nur mit Freigabe), und was Probestart und
 *      Prüfdurchlauf dem Daemon mitgeben.
 *   4. Die Paketprüfung: ein Verweis auf die Adresse ohne Freigabe, oder ein
 *      gesperrtes Muster, hält die Einlieferung an.
 *   5. Der Vertrag mit dem Daemon: Feldnamen, Variable, Weg.
 *
 * Das Ausliefern selbst — Verknüpfungen, Pfade mit `..`, fremde Volumes —
 * prüfen die Tests des Daemons mit echten Dateien (oeffentlich_test.go).
 *
 * Der Startauftrag: scripts/check-startpayload.js („Abruf für Spieler").
 *
 *   node scripts/check-fastdl.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const WURZEL = path.join(__dirname, '..');
const DAEMON = '/home/firedervil/firebot_daemon';
const Ajv = require('ajv');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

// Die Attrappe kennt: das Schreiben des Entwurfs, die drei Fragen „läuft
// gerade etwas?" und die Maschine einer Sitzung. Alles andere ist ein Fehler.
let maschine = { host: '91.200.102.182', fqdn: 'node1.firenetworks.de', fqdn_gilt: 1, abruf_port: 8081 };
const gefragt = [];
ServiceManager.register('dbService', {
    query: async (sql, p) => {
        const t = sql.replace(/\s+/g, ' ').trim();
        if (/^UPDATE werkbank_sitzungen SET entwurf = \? WHERE id = \?$/.test(t)) return {};
        if (/FROM werkbank_pruefungen p JOIN werkbank_sitzungen s .*p\.status = 'laeuft'/.test(t)) return [];
        if (/^SELECT id FROM werkbank_schritte WHERE sitzung_id = \? AND status = 'laeuft' LIMIT 1$/.test(t)) return [];
        if (/FROM werkbank_laeufe l JOIN werkbank_sitzungen s .*l\.status <> 'beendet'/.test(t)) return [];
        if (t === 'SELECT host, fqdn, fqdn_gilt, abruf_port FROM rootserver WHERE id = ?') { gefragt.push(p[0]); return maschine ? [maschine] : []; }
        throw new Error(`Attrappe kennt die Abfrage nicht: ${t.slice(0, 90)}`);
    },
});
const still = () => {};
ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });

const S = require('../plugins/werkbank/dashboard/helpers/Sitzungen');
const Abruf = require('../plugins/gameserver/dashboard/helpers/Abruf');
const Oeffentlich = require('../packages/fbpkg/lib/oeffentlich');
const einl = require('../packages/fbpkg/lib/einlieferung');
const schema = require('../packages/fbpkg/schema/fbpkg-v1.schema.json');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 5).join('\n      ')}`); }
}
const sitzung = (entwurf = {}) => ({ id: 7, kennung: 'wb1a2b3c4d5e', guild_id: 'g', rootserver_id: 54, image: { ref: 'registry.firenetworks.de/fb/base', tag: 'latest' },
    entwurf: { identity: { slug: 'etlegacy', name: 'ET: Legacy', version: '1.0.2' }, ports: [{ purpose: 'game', protocol: 'udp' }],
        start: { program: './etlded.x86_64', args: [], stop: { sequence: ['sigterm', 'sigkill'] }, ready_when: { port: 'game' } }, ...entwurf } });
const karte = (x = {}) => ({ denylist: '', saves: '', persist: [], 'public': '', ...x });

(async () => {
    console.log('\nDie Regel für Muster');

    // Dieselben Fälle wie in internal/pkgspec/oeffentlich_test.go.
    const GUT = ['etmain/*.pk3', 'legacy/*.pk3', '*.pk3', 'cstrike/maps/*.bsp', 'etmain/oasis_night.pk3', 'tf/custom/*.vpk', 'cstrike/maps/*.bsp.bz2'];
    const SCHLECHT = {
        '*': 'keine Endung', 'etmain/*': 'keine Endung', 'etmain/*.*': 'keine Endung',
        '**/*.pk3': '**', 'etmain/**': '**',
        'etmain/*.cfg': 'nicht freigegeben', 'etmain/*.CFG': 'nicht freigegeben', 'legacy/*.so': 'nicht freigegeben', 'legacy/*.db': 'nicht freigegeben',
        '/etc/*.pk3': 'beginnt mit', '../*.pk3': 'führt aus', 'etmain/../*.pk3': 'führt aus',
        'etmain//*.pk3': 'Schrägstrich', 'etmain/*.pk3/': 'Schrägstrich', 'etmain\\*.pk3': 'getrennt',
        '.etlegacy/*.pk3': 'versteckte', 'etmain/.*.pk3': 'versteckte',
        'etmain/[a-z]*.pk3': 'erlaubt sind', 'etmain/ka rte.pk3': 'erlaubt sind', 'etmain/{a,b}.pk3': 'erlaubt sind',
        '': 'leeres Muster', ['a'.repeat(250) + '.pk3']: 'zu lang',
    };

    await pruefe('gültige Muster gehen durch, gefährliche werden mit Grund abgewiesen', async () => {
        for (const m of GUT) assert.strictEqual(Oeffentlich.pruefeMuster(m), '', `„${m}" abgewiesen`);
        for (const [m, erwartet] of Object.entries(SCHLECHT)) {
            const grund = Oeffentlich.pruefeMuster(m);
            assert.ok(grund.includes(erwartet), `„${m}": Grund „${grund}", erwartet etwas mit „${erwartet}"`);
        }
        assert.deepStrictEqual(Oeffentlich.pruefe(GUT), []);
        assert.strictEqual(Oeffentlich.pruefe(Array(Oeffentlich.MAX_MUSTER + 1).fill('etmain/*.pk3')).length, 1);
        assert.ok(Oeffentlich.pruefe('etmain/*.pk3').length, 'eine Zeichenkette statt einer Liste ging durch');
    });

    await pruefe('Vertrag: der Daemon sperrt GENAU dieselben Endungen und dieselbe Anzahl Muster', async () => {
        const go = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/pkgspec/oeffentlich.go'), 'utf8'));
        const block = go.slice(go.indexOf('var gesperrteEndungen'), go.indexOf('}', go.indexOf('var gesperrteEndungen')));
        const imDaemon = [...block.matchAll(/"([a-z0-9]+)": true/g)].map(x => x[1]).sort();
        assert.ok(imDaemon.length > 20, 'die Liste des Daemons wurde nicht gefunden');
        assert.deepStrictEqual([...Oeffentlich.GESPERRT].sort(), imDaemon, 'Werkbank und Daemon sperren verschiedene Endungen');
        assert.match(go, new RegExp(`MaxOeffentlicheMuster = ${Oeffentlich.MAX_MUSTER}\\b`));
        assert.match(go, new RegExp(`maxMusterLaenge\\s+= ${Oeffentlich.MAX_LAENGE}\\b`));
        // Und er wendet die Regel beim AUSLIEFERN an, nicht nur beim Einliefern.
        const abruf = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/sicherungsabruf/oeffentlich.go'), 'utf8'));
        assert.match(abruf, /!pkgspec\.IstOeffentlich\(muster, rel\)/);
        assert.match(go, /func IstOeffentlich[\s\S]*?PruefeOeffentlichesMuster\(m\) != ""[\s\S]*?continue/, 'ein Muster, das die Prüfung nicht besteht, gäbe beim Ausliefern trotzdem frei');
    });

    await pruefe('Schema: files.public mit Form — und das Grobe fängt schon das Muster des Schemas', async () => {
        const ajv = new Ajv({ allErrors: true, strict: false });
        ajv.addSchema(schema, 'fbpkg');
        const pruef = ajv.compile({ $ref: 'fbpkg#/properties/files' });
        assert.ok(pruef({ public: GUT, denylist: ['bin'] }), JSON.stringify(pruef.errors));
        for (const m of ['etmain/*', '**/*.pk3', '/etc/*.pk3', '../*.pk3', '.x/*.pk3', 'etmain/.*.pk3', 'a b/*.pk3', 'etmain/*.pk3/']) {
            assert.ok(!pruef({ public: [m] }), `das Schema nimmt „${m}"`);
        }
        assert.ok(!pruef({ public: Array(21).fill('etmain/*.pk3') }));
        assert.ok(!pruef({ public: 'etmain/*.pk3' }));
        assert.ok(!pruef({ oeffentlich: [] }), 'das Schema lässt Unbekanntes durch — es prüft nichts');
    });

    console.log('\nDie Adresse');

    await pruefe('eine Rechnung für „wie heisst die Maschine von aussen" — für Sicherungen und für den Abruf', async () => {
        assert.strictEqual(Abruf.basis(maschine), 'http://node1.firenetworks.de:8081');
        assert.strictEqual(Abruf.basis({ ...maschine, fqdn_gilt: 0 }), 'http://91.200.102.182:8081', 'ein Name, den niemand gemessen hat');
        assert.strictEqual(Abruf.basis({ host: '2a01:4f8::1', abruf_port: 8081 }), 'http://[2a01:4f8::1]:8081');
        assert.strictEqual(Abruf.downloadAdresse(maschine, '209'), 'http://node1.firenetworks.de:8081/dl/209');
        for (const m of [null, {}, { host: 'x' }, { host: 'x', abruf_port: 0 }, { host: 'x', abruf_port: 70000 }, { host: '', abruf_port: 8081 },
            { host: 'node1/pfad', abruf_port: 8081 }, { host: 'a b', abruf_port: 8081 }, { host: 'x" ; quit', abruf_port: 8081 }]) {
            assert.strictEqual(Abruf.basis(m), null, JSON.stringify(m));
        }
        assert.strictEqual(Abruf.downloadAdresse(maschine, '../x'), null);
        // Was das Dashboard baut, nimmt der Daemon auch an — dieselbe Form.
        const abruf = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/sicherungsabruf/oeffentlich.go'), 'utf8'));
        assert.match(abruf, /const PfadOeffentlich = "\/dl\/"/);
        const reBasis = /var reBasis = regexp\.MustCompile\(`([^`]+)`\)/.exec(abruf);
        assert.ok(reBasis, 'die Form der Basis im Daemon wurde nicht gefunden');
        for (const b of ['http://node1.firenetworks.de:8081', 'http://91.200.102.182:8081', 'http://[2a01:4f8::1]:8081']) {
            assert.ok(new RegExp(reBasis[1]).test(b), `der Daemon wiese „${b}" ab`);
        }
        // Die Sicherungen nehmen dieselbe Rechnung, keine eigene.
        const routen = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/routes/servers.js'), 'utf8'));
        assert.match(routen, /const wirt = require\('\.\.\/helpers\/Abruf'\)\.wirt\(zeile\)/);
        assert.doesNotMatch(routen, /fqdn_gilt && zeile\.fqdn\) \? zeile\.fqdn : zeile\.host/, 'die alte Rechnung steht noch daneben');
    });

    console.log('\nDie Werkbank');

    await pruefe('Karte: Muster je Zeile, „game/" davor wird abgenommen, Gefährliches mit Grund abgewiesen', async () => {
        const f = S.dateiteilAusFormular(karte({ 'public': 'etmain/*.pk3\ngame/legacy/*.pk3\n\netmain/*.pk3' }));
        assert.deepStrictEqual(f.oeffentlich, ['etmain/*.pk3', 'legacy/*.pk3']);
        assert.throws(() => S.dateiteilAusFormular(karte({ 'public': 'etmain/*.cfg' })), /Für Spieler abrufbar: „etmain\/\*\.cfg" — die Endung \.cfg wird nicht freigegeben/);
        assert.throws(() => S.dateiteilAusFormular(karte({ 'public': 'etmain/*' })), /nennt keine Endung/);
        assert.throws(() => S.dateiteilAusFormular(karte({ 'public': Array(21).fill(0).map((_, i) => `a${i}/*.pk3`).join('\n') })), /höchstens 20 Muster/);
        assert.deepStrictEqual(S.dateiteilAusFormular(karte()).oeffentlich, []);
    });

    await pruefe('Speichern: files.public steht im Entwurf und im Paket — und gibt nichts mehr frei, wenn die Liste leer ist', async () => {
        const s = sitzung();
        await S.dateiteilSpeichern(s, karte({ 'public': 'etmain/*.pk3\nlegacy/*.pk3', denylist: 'bin' }));
        assert.deepStrictEqual(s.entwurf.files, { denylist: ['bin'], public: ['etmain/*.pk3', 'legacy/*.pk3'] });
        assert.deepStrictEqual(S.dateiteilStand(s).oeffentlich, ['etmain/*.pk3', 'legacy/*.pk3']);
        const paket = S.entwurfAlsPaket(s, []);
        assert.deepStrictEqual(paket.files.public, ['etmain/*.pk3', 'legacy/*.pk3']);
        assert.ok(S.EIGENE.files.includes('public') && S.LAUFZEIT_TEILE.includes('files'));
        // Geleert bleibt die Liste als leere Liste stehen — wie Sperrliste und
        // Welten in derselben Karte (dateiteilSpeichern). Entscheidend ist, dass
        // sie NICHTS mehr freigibt und keine Adresse mehr mitgeht.
        await S.dateiteilSpeichern(s, karte({ denylist: 'bin' }));
        assert.deepStrictEqual(s.entwurf.files.denylist, ['bin']);
        assert.deepStrictEqual(s.entwurf.files.public || [], [], 'die Freigabe gilt nach dem Leeren weiter');
        assert.strictEqual(Abruf.gibtFrei(S.entwurfAlsPaket(s, [])), false);
        assert.deepStrictEqual(await S.downloadNutzlast(s, S.entwurfAlsPaket(s, [])), {});
        // Ein Paket ohne den Teil bleibt unverändert, wenn die Karte leer gespeichert wird.
        const ohne = sitzung();
        await S.dateiteilSpeichern(ohne, karte());
        assert.strictEqual(ohne.entwurf.files, undefined);
    });

    await pruefe('feste Zeile: der Verweis auf die Adresse geht nur MIT Freigabe — und die Freigabe nicht weg, solange er dasteht', async () => {
        const zeile = { file: 'etmain/etl_server.cfg', parser: 'cfg', key: 'sv_wwwBaseURL', value: S.DATEITEIL.verweis };
        const s = sitzung();
        await assert.rejects(S.festzeileSpeichern(s, zeile), /Download-Adresse gibt es erst, wenn .*Für Spieler abrufbar/);
        assert.strictEqual(s.entwurf.config, undefined, 'abgewiesen, aber trotzdem geschrieben');
        await S.dateiteilSpeichern(s, karte({ 'public': 'etmain/*.pk3' }));
        await S.festzeileSpeichern(s, zeile);
        assert.deepStrictEqual(s.entwurf.config, [{ file: 'etmain/etl_server.cfg', parser: 'cfg', set: { sv_wwwBaseURL: '{{env:FB_DOWNLOAD_URL}}' } }]);
        assert.deepStrictEqual(S.downloadVerweise(s.entwurf), ['etmain/etl_server.cfg → sv_wwwBaseURL']);
        await assert.rejects(S.dateiteilSpeichern(s, karte()), /etmain\/etl_server\.cfg → sv_wwwBaseURL verweist auf die Download-Adresse/);
        assert.deepStrictEqual(s.entwurf.files.public, ['etmain/*.pk3'], 'die Freigabe ist trotz hängender Zeile weg');
        await S.festzeileEntfernen(s, { file: 'etmain/etl_server.cfg', key: 'sv_wwwBaseURL' });
        await S.dateiteilSpeichern(s, karte());
        assert.strictEqual(Abruf.gibtFrei(s.entwurf), false, 'ohne die Zeile ließ sich die Freigabe trotzdem nicht leeren');
    });

    await pruefe('Probestart und Prüfdurchlauf: die Basis der Maschine geht mit — nur mit Freigabe, nur wenn sie ausliefert', async () => {
        const mit = { files: { public: ['etmain/*.pk3'] } }, ohne = { files: { denylist: ['bin'] } };
        gefragt.length = 0;
        assert.deepStrictEqual(await S.downloadNutzlast(sitzung(), ohne), {});
        assert.deepStrictEqual(await S.downloadNutzlast(sitzung(), {}), {});
        assert.strictEqual(gefragt.length, 0, 'ohne Freigabe wurde die Maschine trotzdem gefragt');
        assert.deepStrictEqual(await S.downloadNutzlast(sitzung(), mit), { download_basis: 'http://node1.firenetworks.de:8081' });
        assert.deepStrictEqual(gefragt, [54], 'gefragt wird die Maschine DER SITZUNG');
        assert.strictEqual(await S.downloadAdresse(sitzung()), 'http://node1.firenetworks.de:8081/dl/werkbank-wb1a2b3c4d5e');
        const merk = maschine;
        try {
            maschine = { ...merk, abruf_port: 0 };
            assert.deepStrictEqual(await S.downloadNutzlast(sitzung(), mit), {});
            assert.strictEqual(await S.downloadAdresse(sitzung()), null);
            maschine = null;
            assert.deepStrictEqual(await S.downloadNutzlast(sitzung(), mit), {});
        } finally { maschine = merk; }
        // Beide Wege reichen es weiter.
        const helfer = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/werkbank/dashboard/helpers/Sitzungen.js'), 'utf8'));
        for (const name of ['starten', 'pruefen']) {
            const rumpf = new RegExp(`async function ${name}\\(sitzung, liste\\) \\{[\\s\\S]*?\\n\\}`).exec(helfer);
            assert.ok(rumpf && /\.\.\.\(await downloadNutzlast\(sitzung, (ganz|paket)\)\)/.test(rumpf[0]), `${name}() gibt die Basis nicht mit`);
            assert.ok(/\.\.\.laufzeitTeile\(/.test(rumpf[0]), `${name}() schickt files nicht mit`);
        }
    });

    console.log('\nDie Paketprüfung');

    await pruefe('Einlieferung: Freigabe samt Verweis besteht — Verweis ohne Freigabe und gesperrtes Muster nicht', async () => {
        const basis = JSON.parse(fs.readFileSync(path.join(WURZEL, 'packages/fbpkg/beispiele/valheim.json'), 'utf8'));
        const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'fastdl-'));
        const tor = (aendern) => {
            const p = JSON.parse(JSON.stringify(basis));
            aendern(p);
            const datei = path.join(ordner, 'valheim.json');
            fs.writeFileSync(datei, JSON.stringify(p, null, 2));
            const r = einl.bestehtPruefung(datei);
            return { ok: r.ok, text: r.ok ? '' : einl.grundZeilen(r.text).join(' · ').slice(0, 900) };
        };
        const zeile = { file: 'server.cfg', parser: 'cfg', set: { sv_downloadurl: '{{env:FB_DOWNLOAD_URL}}' } };
        try {
            const vorher = tor(() => {});
            assert.ok(vorher.ok, 'das Beispielpaket besteht die Prüfung schon ohne Änderung nicht — die Probe mässe nichts: ' + vorher.text);
            const gut = tor((p) => { p.files = { ...(p.files || {}), public: ['maps/*.bsp'] }; p.config = [...(p.config || []), zeile]; });
            assert.ok(gut.ok, gut.text);
            const ohneFreigabe = tor((p) => { p.config = [...(p.config || []), zeile]; });
            assert.ok(!ohneFreigabe.ok && /FB_DOWNLOAD_URL.*files\.public gibt nichts frei/.test(ohneFreigabe.text), ohneFreigabe.text);
            const gesperrt = tor((p) => { p.files = { ...(p.files || {}), public: ['cfg/*.cfg'] }; });
            assert.ok(!gesperrt.ok && /files\.public: „cfg\/\*\.cfg": die Endung \.cfg wird nicht freigegeben/.test(gesperrt.text), gesperrt.text);
            // Der Grund steht VORN — so zeigt ihn die Werkbank beim Veröffentlichen,
            // nicht erst hinter den offenen Punkten des Pakets.
            assert.ok(ohneFreigabe.text.indexOf('FB_DOWNLOAD_URL') < 400, 'der Grund ginge in der Meldung der Werkbank unter: ' + ohneFreigabe.text.slice(0, 200));
        } finally { fs.rmSync(ordner, { recursive: true, force: true }); }
    });

    console.log('\nVertrag mit dem Daemon');

    await pruefe('Feldnamen, Variable und Weg stehen auf beiden Seiten gleich', async () => {
        const lies = (p) => ohneKommentare(fs.readFileSync(path.join(DAEMON, p), 'utf8'));
        // Die Variable: der Verweis der Werkbank nennt, was der Daemon setzt.
        assert.match(lies('pkg/protocol/volume.go'), /const EnvDownloadURL = "FB_DOWNLOAD_URL"/);
        assert.strictEqual(S.DATEITEIL.verweis, '{{env:FB_DOWNLOAD_URL}}');
        assert.match(lies('internal/gameserver/auftrag_ablage.go'), /env\[protocol\.EnvDownloadURL\] = adresse/);
        // Die Basis: Server-Start und beide Wege der Werkbank lesen `download_basis`.
        assert.match(lies('internal/gameserver/nutzlast.go'), /payload\["download_basis"\]\.\(string\)\s*\n\s*srv\.SetDownloadBasis\(basis\)/);
        const werkbankGo = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/websocket/werkbank.go'), 'utf8'));
        assert.strictEqual((werkbankGo.match(/a\.DownloadBasis, _ = payload\["download_basis"\]\.\(string\)/g) || []).length, 2,
            'Probestart UND Prüfdurchlauf müssen die Basis lesen');
        const start = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/StartPayload.js'), 'utf8'));
        assert.match(start, /payload\.download_basis = basis/);
        // Das Paket: der Daemon liest files.public.
        assert.match(lies('internal/pkgspec/paket.go'), /Files Dateien `json:"files,omitempty"`[\s\S]*Public \[\]string `json:"public,omitempty"`/);
        assert.match(lies('internal/gameserver/werkbank_start.go'), /Files:\s+a\.Files,/, 'der Probestart baut sein Paket ohne die Freigabe');
        // Die Freigabe liegt nicht im Volume und nicht im Laufzeitordner.
        const ablage = lies('internal/gameserver/oeffentlich.go');
        assert.match(ablage, /const oeffentlichOrdner = "\.oeffentlich"/);
        assert.match(ablage, /filepath\.Join\(m\.volumeManager\.BaseDir\(\), oeffentlichOrdner, kennung\+"\.json"\)/);
        // Und der Zuhörer ist verdrahtet.
        assert.match(lies('cmd/daemon/main.go'), /abrufDienst\.SetzeOeffentlich\(serverManager\.Oeffentlich\)/);
    });

    console.log('\nDie Seite');

    await pruefe('Karte „Dateien und Spielstand": das Feld, sein Hinweis, die Adresse — und der Verweis in der Auswahl', async () => {
        const seite = ohneKommentareEjs(fs.readFileSync(path.join(WURZEL, 'plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs'), 'utf8'));
        assert.match(seite, /<textarea[^>]*id="spielstandOeffentlich" name="public"/);
        assert.match(seite, /'public': document\.getElementById\('spielstandOeffentlich'\)\.value/, 'das Skript schickt das Feld nicht mit');
        assert.match(seite, /Ohne Anmeldung, für jeden\./, 'dass es öffentlich ist, steht nicht mehr auf der Seite');
        assert.match(seite, /<%= dtAdresse %>/);
        assert.match(seite, /<option value="<%= \(locals\.DATEITEIL \|\| \{\}\)\.verweis %>">Download-Adresse für Spieler<\/option>/);
        const router = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/werkbank/dashboard/routes/guild.router.js'), 'utf8'));
        assert.match(router, /downloadAdresse: await Sitzungen\.downloadAdresse\(sitzung\)/);
    });

    console.log(fehler ? `\n❌ ${fehler} Prüfung(en) fehlgeschlagen` : '\n✅ Abruf für Spieler: eine Regel für Muster, eine Rechnung für die Adresse, und ohne Freigabe geht nichts heraus');
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
