#!/usr/bin/env node
'use strict';

/**
 * Wächter: Der Server-Befund je Modpack-Fassung (K226, vorher Baustelle 187).
 *
 * ── Woher er kommt ───────────────────────────────────────────────────────────
 *
 * Betreiber am 2026-10-14: „wichtig ist, dass die suche es schafft, modpacks
 * von client files zu unterscheiden, und das am besten schon am modpack."
 * Entschieden am 2026-10-29: Stufe 2 beim Auswählen, Unvollständiges für alle
 * ausblenden.
 *
 * ── Was er hält ──────────────────────────────────────────────────────────────
 *
 * 1. Der Archiv-Leser holt Teilstücke, nie das Archiv — und kommt mit dem
 *    zurecht, was am 2026-11-12 an cdn.modrinth.com gemessen wurde: „die
 *    letzten N Byte" gibt 501, und die angekündigte Größe stimmt nicht immer.
 * 2. Die Regeln der Stufe 2 an nachgebauten Fällen, je mit dem echten Vorbild:
 *      unvollständig     BMC4 v59 — FLIB, Temporal API, Twilight Forest
 *                        stehen nur in `missing_mods_checker.json`
 *      zwei Dateien      Immersive Lanterns 1.0.6 — `accessories` ist Pflicht
 *                        in `neoforge.mods.toml`, freiwillig in `mods.toml`
 *      ohne Client       One block horror 1.0.4 — läuft, wenn zehn Mods wegbleiben
 * 3. Ein Befund, eine Stelle: gespeichert, nicht doppelt gerechnet, bei
 *    älterer Regel neu; Einspielen und Suche lesen ihn.
 *
 * Der echte Lauf gegen Modrinth (drei Pakete) und gegen die Datenbank
 * (TEMPORARY-Tabelle) steht im Commit, nicht hier: Ein Wächter fragt keine
 * fremden Dienste und schreibt nicht in die Datenbank.
 *
 * Aufruf:  node scripts/check-pack-befund.js
 * Rückgabe: 0 = der Befund trägt.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { ohneKommentare } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const H = (d) => path.join(WURZEL, 'plugins/gameserver/dashboard/helpers', d);

const { ServiceManager } = require('dunebot-core');
const gewarnt = [];
ServiceManager.register('Logger', { info() {}, warn: (t) => gewarnt.push(String(t)), error() {}, debug() {} });

const ZipFern = require(H('ZipFern'));
const ModBeschreibung = require(H('ModBeschreibung'));
const PackBefund = require(H('PackBefund'));

let fehler = 0;
let geprueft = 0;
async function pruefe(was, tun) {
    geprueft++;
    try { await tun(); console.log(`  ✅ ${was}`); }
    catch (e) { fehler++; console.log(`  ❌ ${was}\n       ${String(e.message).split('\n').slice(0, 6).join('\n       ')}`); }
}

const { baueZip, baueHost } = require('./lib/zipprobe');

// ── Mods bauen ──────────────────────────────────────────────────────────────
const toml = (id, name, braucht = [], oben = '') => `modLoader="javafml"\n${oben}\n[[mods]]\nmodId="${id}"\ndisplayName="${name}"\n`
    + `description='''\nMehrzeilig, mit einer Falle:\n[[dependencies.${id}]]\nmodId="falle"\nmandatory=true\n'''\n`
    + braucht.map(b => `[[dependencies.${id}]]\n    modId="${b.id}" # Kommentar\n    ${b.type ? `type="${b.type}"` : `mandatory=${b.pflicht !== false}`}\n`
        + `    versionRange="[1,)"\n    side="${b.seite || 'BOTH'}"\n`).join('');

const forgeJar = (id, name, braucht, mehr = {}) => baueZip({
    'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0\n',
    'META-INF/mods.toml': toml(id, name, braucht, mehr.oben || ''),
    ...(mehr.dateien || {}),
    'fuellung.bin': Buffer.alloc(mehr.fuellung || 2000, 7),
});

/** Bytes, die sich nicht packen lassen — sonst wäre das Probearchiv ein paar Kilobyte groß. */
function rauschen(laenge) {
    const aus = Buffer.alloc(laenge);
    let x = 12345;
    for (let i = 0; i < laenge; i++) { x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff; aus[i] = (x >>> 16) & 0xff; }
    return aus;
}

const SHA = (z) => z.repeat(40);
const CDN = 'https://cdn.modrinth.com/data/';

/**
 * Das Probepaket — klein, aber mit jedem Fall, den die Regeln unterscheiden.
 * `umbau` ändert es für die einzelnen Prüfungen.
 */
function bauePaket(umbau = () => {}) {
    const jars = {
        // Braucht `lib` (da), `kernlib` (steckt in einer „Client-Mod"), `innen`
        // (steckt in einem Jar im Jar), `optik` nur auf dem Client — und
        // `fehlmod`, das dem Paket nicht beiliegt.
        'a.jar': forgeJar('moda', 'Mod A', [
            { id: 'minecraft' }, { id: 'forge' }, { id: 'lib' }, { id: 'kernlib' }, { id: 'innen' },
            { id: 'optik', seite: 'CLIENT' }, { id: 'freiwillig', pflicht: false }, { id: 'fehlmod' },
        ]),
        'lib.jar': forgeJar('lib', 'Bibliothek', []),
        'optik.jar': forgeJar('optik', 'Optik', [{ id: 'nurclientlib' }]),
        'kern.jar': forgeJar('kernlib', 'Kern', []),
        'huelle.jar': forgeJar('huelle', 'Hülle', [], { dateien: {
            'META-INF/jarjar/metadata.json': JSON.stringify({ jars: [{ path: 'META-INF/jars/innen.jar' }] }),
            'META-INF/jars/innen.jar': forgeJar('innen', 'Innen', []),
        } }),
        // Ein Jar für mehrere Lader: In `neoforge.mods.toml` eine Pflicht mehr.
        'beide.jar': forgeJar('beide', 'Beide', [{ id: 'lib' }], { dateien: {
            'META-INF/neoforge.mods.toml': toml('beide', 'Beide', [{ id: 'lib' }, { id: 'nurneo', type: 'required' }]),
        } }),
        // Eine Fabric-Mod in einem Forge-Paket (Connector): verlangt hier nichts.
        'bruecke.jar': baueZip({ 'fabric.mod.json': JSON.stringify({ id: 'bruecke', depends: { fabricloader: '*', 'fabric-api': '*' } }) }),
        // Lädt der Lader auf dem Server nicht: verlangt dort nichts.
        'still.jar': forgeJar('still', 'Still', [{ id: 'gibtsnicht' }], { oben: 'clientSideOnly=true' }),
        'paketclient.jar': forgeJar('paketclient', 'Paket-Client', [{ id: 'gibtsauchnicht' }]),
    };
    const beigaben = {
        'overrides/mods/bei.jar': forgeJar('bei', 'Beigelegt', [{ id: 'lib' }]),
        'overrides/config/missing_mods_checker.json': JSON.stringify([
            { displayName: 'Fehl Mod', pattern: 'fehlmod-1.20.1-1.0.jar', url: 'https://www.curseforge.com/minecraft/mc-mods/fehl/download/1', destination: 'mods' },
            { displayName: 'Unbeteiligt', pattern: 'unbeteiligt-1.0.jar', url: 'https://www.curseforge.com/x', destination: 'mods' },
        ]),
        'overrides/options.txt': 'fov:1',
    };
    const sha = { 'optik.jar': SHA('a'), 'kern.jar': SHA('b') };
    const env = { 'paketclient.jar': { client: 'required', server: 'unsupported' } };
    const groessenfehler = { 'lib.jar': 1, 'huelle.jar': -1 };
    const p = { jars, beigaben, sha, env, groessenfehler, lader: 'forge' };
    umbau(p);

    const dateien = new Map();
    const index = { formatVersion: 1, files: [], dependencies: { minecraft: '1.20.1', forge: '47.4.0' } };
    let zaehler = 0;
    for (const [name, puffer] of Object.entries(p.jars)) {
        const adresse = `${CDN}${name}`;
        dateien.set(adresse, puffer);
        index.files.push({
            path: `mods/${name}`,
            hashes: { sha1: p.sha[name] || String(++zaehler).padStart(40, '0') },
            env: p.env[name] || { client: 'required', server: 'required' },
            downloads: [adresse],
            // Die Größe im Verzeichnis stimmt nicht immer (BMC4: 14 von 309).
            fileSize: Buffer.isBuffer(puffer) ? puffer.length + (p.groessenfehler[name] || 0) : 100,
        });
    }
    index.files.push({ path: 'resourcepacks/bunt.zip', hashes: { sha1: SHA('9') }, downloads: [`${CDN}bunt.zip`], fileSize: 5 });
    const archiv = baueZip({ 'modrinth.index.json': JSON.stringify(index), ...p.beigaben,
        'overrides/fuellung.bin': rauschen(2000000) });
    const archivAdresse = `${CDN}probe.mrpack`;
    dateien.set(archivAdresse, archiv);

    const version = {
        id: 'vprobe',
        files: [{ url: archivAdresse, size: archiv.length, primary: true }],
        dependencies: [
            { project_id: 'p-optik', version_id: 'v-optik' }, { project_id: 'p-kern', version_id: 'v-kern' },
            { project_id: 'p-a', version_id: 'v-a' }, { project_id: null, version_id: null, file_name: 'bei.jar' },
        ],
    };
    const eins = {
        client: [{ name: 'Optik', sha1: [SHA('a')] }, { name: 'Kern', sha1: [SHA('b')] }],
        einzelheiten: { mit_herkunft: 3, ohne_herkunft: 1 },
    };
    const host = baueHost(dateien);
    return { ...p, dateien, archiv, archivAdresse, version, eins, host,
        paket: { kennung: 'probe', name: 'Probepaket', fassung: '1.0', fassungId: 'vprobe', lader: p.lader } };
}

const erlaubt = (adresse) => String(adresse).startsWith(CDN);
const rechne = (p) => PackBefund.rechneZwei(p.paket, p.version, p.eins,
    { abruf: p.host.abruf, erlaubt, kopf: {} }, () => {});

(async () => {
    // ════════════════════════════════════════════════════════════════════════
    console.log('\nDer Archiv-Leser holt Teilstücke, nicht das Archiv');
    // ════════════════════════════════════════════════════════════════════════
    const probe = bauePaket();

    await pruefe('Verzeichnis und eine Datei kosten einen Bruchteil des Archivs', async () => {
        const quelle = await ZipFern.fernQuelle(probe.archivAdresse, { abruf: probe.host.abruf, groesse: probe.archiv.length, schwanz: 4096 });
        const eintraege = await ZipFern.verzeichnis(quelle);
        const index = eintraege.find(e => e.name === 'modrinth.index.json');
        const text = (await ZipFern.liesEintrag(quelle, index, 1e6)).toString('utf8');
        assert.strictEqual(JSON.parse(text).formatVersion, 1);
        assert.ok(eintraege.some(e => e.name === 'overrides/mods/bei.jar'));
        assert.ok(probe.host.stand.bytes < probe.archiv.length / 10,
            `${probe.host.stand.bytes} von ${probe.archiv.length} Byte geholt`);
    });

    await pruefe('„die letzten N Byte" wird nie verlangt (cdn.modrinth.com antwortet darauf 501)', async () => {
        assert.ok(probe.host.stand.abrufe.length > 0);
        assert.ok(probe.host.stand.abrufe.every(a => /bytes=\d+-\d+$/.test(a)), probe.host.stand.abrufe.join('\n'));
    });

    await pruefe('ohne bekannte Größe wird sie erfragt, und eine falsch angekündigte wird berichtigt', async () => {
        for (const groesse of [undefined, probe.archiv.length - 1, probe.archiv.length + 5000]) {
            const quelle = await ZipFern.fernQuelle(probe.archivAdresse, { abruf: probe.host.abruf, groesse, schwanz: 4096 });
            assert.strictEqual(quelle.groesse, probe.archiv.length, `angekündigt ${groesse}`);
            assert.ok((await ZipFern.verzeichnis(quelle)).length > 3);
        }
    });

    await pruefe('gespeichert und gepackt, mit Kommentar am Ende, und der Zusatz im lokalen Kopf stört nicht', async () => {
        for (const packen of [true, false]) {
            const zip = baueZip({ 'a.txt': 'eins', 'b/c.txt': 'zwei'.repeat(500) }, { packen, kommentar: 'x'.repeat(3000) });
            const quelle = ZipFern.pufferQuelle(zip);
            const eintraege = await ZipFern.verzeichnis(quelle);
            assert.deepStrictEqual(eintraege.map(e => e.name), ['a.txt', 'b/c.txt']);
            assert.strictEqual((await ZipFern.liesEintrag(quelle, eintraege[1], 1e5)).toString(), 'zwei'.repeat(500));
        }
    });

    await pruefe('was kein Zip ist, zu groß ist oder am Host scheitert, wird gesagt — je anders', async () => {
        await assert.rejects(ZipFern.verzeichnis(ZipFern.pufferQuelle(Buffer.alloc(500, 1))), /kein Verzeichnisende/);
        const quelle = ZipFern.pufferQuelle(baueZip({ 'gross.bin': Buffer.alloc(5000) }));
        const [eintrag] = await ZipFern.verzeichnis(quelle);
        await assert.rejects(ZipFern.liesEintrag(quelle, eintrag, 1000), /erlaubt sind 1000/);
        const weg = await ZipFern.fernQuelle(`${CDN}gibtsnicht.jar`, { abruf: probe.host.abruf }).catch(f => f);
        assert.ok(weg instanceof Error && weg.netz === true && /404/.test(weg.message), String(weg));
    });

    // ════════════════════════════════════════════════════════════════════════
    console.log('\nWas eine Mod über sich sagt');
    // ════════════════════════════════════════════════════════════════════════

    await pruefe('Pflicht ist, was `mandatory=true` oder `type="required"` sagt und nicht nur den Client meint', async () => {
        const b = await ModBeschreibung.beschreibe(ZipFern.pufferQuelle(probe.jars['a.jar']), 'forge');
        assert.deepStrictEqual(b.kennungen, ['moda']);
        assert.strictEqual(b.name, 'Mod A');
        assert.deepStrictEqual([...b.braucht].sort(), ['fehlmod', 'forge', 'innen', 'kernlib', 'lib', 'minecraft']);
    });

    await pruefe('ein `[[dependencies…]]` in einer mehrzeiligen Beschreibung ist keine Abhängigkeit', async () => {
        const gelesen = ModBeschreibung.leseModsToml(toml('x', 'X', [{ id: 'echt' }]));
        assert.deepStrictEqual(gelesen.abhaengig.map(a => a.modId), ['echt']);
    });

    await pruefe('zwei Dateien in einem Jar: Forge liest nur `mods.toml`, NeoForge verlangt nur, was beide nennen', async () => {
        for (const lader of ['forge', 'neoforge']) {
            const b = await ModBeschreibung.beschreibe(ZipFern.pufferQuelle(probe.jars['beide.jar']), lader);
            assert.deepStrictEqual(b.braucht, ['lib'], `${lader}: ${b.braucht.join(', ')}`);
        }
        // Die andere Richtung, und sie unterscheidet die zwei Regeln: Eine
        // Pflicht nur in `mods.toml` gilt unter Forge ganz, unter NeoForge nicht.
        const nurForge = baueZip({
            'META-INF/mods.toml': toml('zwei', 'Zwei', [{ id: 'nurforge' }]),
            'META-INF/neoforge.mods.toml': toml('zwei', 'Zwei', []),
        });
        assert.deepStrictEqual((await ModBeschreibung.beschreibe(ZipFern.pufferQuelle(nurForge), 'forge')).braucht, ['nurforge']);
        assert.deepStrictEqual((await ModBeschreibung.beschreibe(ZipFern.pufferQuelle(nurForge), 'neoforge')).braucht, []);
        // Nur `neoforge.mods.toml`: Dann gilt sie.
        const nurNeo = baueZip({ 'META-INF/neoforge.mods.toml': toml('neo', 'Neo', [{ id: 'nurneo', type: 'required' }]) });
        assert.deepStrictEqual((await ModBeschreibung.beschreibe(ZipFern.pufferQuelle(nurNeo), 'neoforge')).braucht, ['nurneo']);
    });

    await pruefe('verlangt wird nur nach den Angaben der Laderfamilie; geboten wird alles', async () => {
        const inForge = await ModBeschreibung.beschreibe(ZipFern.pufferQuelle(probe.jars['bruecke.jar']), 'forge');
        assert.deepStrictEqual([inForge.kennungen, inForge.braucht], [['bruecke'], []]);
        const inFabric = await ModBeschreibung.beschreibe(ZipFern.pufferQuelle(probe.jars['bruecke.jar']), 'fabric');
        assert.deepStrictEqual(inFabric.braucht.sort(), ['fabric-api', 'fabricloader']);
        const client = baueZip({ 'fabric.mod.json': JSON.stringify({ id: 'c', environment: 'client', depends: { x: '*' }, provides: ['d'] }) });
        const c = await ModBeschreibung.beschreibe(ZipFern.pufferQuelle(client), 'fabric');
        assert.deepStrictEqual([c.kennungen, c.braucht], [['c', 'd'], []]);
    });

    await pruefe('eine Mod, die der Lader auf dem Server nicht lädt, verlangt dort nichts', async () => {
        const b = await ModBeschreibung.beschreibe(ZipFern.pufferQuelle(probe.jars['still.jar']), 'forge');
        assert.deepStrictEqual([b.kennungen, b.braucht], [['still'], []]);
    });

    // ════════════════════════════════════════════════════════════════════════
    console.log('\nStufe 2: Urteile');
    // ════════════════════════════════════════════════════════════════════════

    await pruefe('unvollständig: Die Pflicht-Mod steht nur in der Liste externer Downloads (BMC4 v59)', async () => {
        const p = bauePaket();
        const b = await rechne(p);
        assert.strictEqual(b.urteil, 'unvollstaendig');
        assert.deepStrictEqual(b.fehlt, [{ kennung: 'fehlmod', name: 'Fehl Mod', gebraucht_von: ['Mod A'], grund: 'extern', host: 'www.curseforge.com' }]);
        assert.deepStrictEqual(b.einzelheiten.nicht_gelesen, []);
        const satz = PackBefund.satzUnvollstaendig(p.paket, b);
        assert.match(satz, /Probepaket/);
        assert.match(satz, /Fehl Mod \(gebraucht von Mod A\)/);
        assert.match(satz, /holt nichts nach/);
    });

    await pruefe('eine „Client-Mod", die der Server braucht, bleibt — und wird genannt', async () => {
        const b = await rechne(bauePaket());
        assert.deepStrictEqual(b.einzelheiten.behalten, [{ name: 'Kern', kennung: 'kernlib', gebraucht_von: ['Mod A'] }]);
        assert.deepStrictEqual(b.auslassen, { sha1: [SHA('a')], namen: ['Optik'] });
    });

    await pruefe('was in einem Jar im Jar steckt, zählt — und wird erst geöffnet, wenn sonst etwas fehlte', async () => {
        const mit = bauePaket();
        assert.ok(!(await rechne(mit)).fehlt.some(f => f.kennung === 'innen'));
        // Fehlt nichts, bleibt das eingebettete Jar zu.
        const ohne = bauePaket((p) => {
            p.jars['a.jar'] = forgeJar('moda', 'Mod A', [{ id: 'lib' }]);
            p.jars['huelle.jar'] = forgeJar('huelle', 'Hülle', [], { fuellung: 300000, dateien: {
                'META-INF/jarjar/metadata.json': JSON.stringify({ jars: [{ path: 'META-INF/jars/innen.jar' }] }),
                'META-INF/jars/innen.jar': baueZip({ 'META-INF/mods.toml': toml('innen', 'Innen'), 'schwer.bin': Buffer.alloc(200000, 3) }, { packen: false }),
            } });
        });
        const b = await rechne(ohne);
        assert.strictEqual(b.fehlt.length, 0);
        const geholt = ohne.host.stand.abrufe.filter(a => a.includes('huelle.jar')).map(a => /bytes=(\d+)-(\d+)/.exec(a))
            .reduce((summe, m) => summe + Number(m[2]) - Number(m[1]) + 1, 0);
        assert.ok(geholt < 100000, `${geholt} Byte von huelle.jar geholt (${ohne.jars['huelle.jar'].length})`);
    });

    await pruefe('läuft ohne Client-Mods, wenn nichts fehlt (One block horror 1.0.4)', async () => {
        const p = bauePaket((x) => { x.jars['a.jar'] = forgeJar('moda', 'Mod A', [{ id: 'lib' }, { id: 'optik', seite: 'CLIENT' }]); });
        const b = await rechne(p);
        assert.strictEqual(b.urteil, 'laeuft_ohne_client');
        assert.deepStrictEqual(b.fehlt, []);
        assert.deepStrictEqual(b.auslassen.namen, ['Kern', 'Optik']);
        assert.strictEqual(b.einzelheiten.paket_client, 1);
        assert.strictEqual(b.einzelheiten.mods_beigelegt, 1);
    });

    await pruefe('läuft: nichts fehlt, nichts bleibt weg', async () => {
        const p = bauePaket((x) => {
            x.jars = { 'a.jar': forgeJar('moda', 'Mod A', [{ id: 'lib' }]), 'lib.jar': forgeJar('lib', 'Bibliothek', []) };
            x.sha = {}; x.env = {};
        });
        p.eins.client = [];
        assert.strictEqual((await rechne(p)).urteil, 'laeuft');
    });

    await pruefe('was die Client-Mods unter sich brauchen und was das Paket selbst als Client-Datei führt, zählt nicht', async () => {
        const b = await rechne(bauePaket());
        for (const kennung of ['nurclientlib', 'gibtsauchnicht', 'gibtsnicht', 'nurneo', 'fabricloader', 'optik', 'freiwillig', 'falle']) {
            assert.ok(!b.fehlt.some(f => f.kennung === kennung), `${kennung} gilt als fehlend`);
        }
        // Die Datei, die das Paket selbst als Client-Datei führt, wird gar nicht geholt.
        assert.ok(!bauePaket().host.stand.abrufe.some(a => a.includes('paketclient.jar')));
    });

    await pruefe('unklar statt unvollständig, sobald eine Datei nicht lesbar war', async () => {
        const kaputt = bauePaket((p) => { p.jars['kaputt.jar'] = Buffer.alloc(3000, 9); });
        const b = await rechne(kaputt);
        assert.strictEqual(b.urteil, 'unklar');
        assert.strictEqual(b.fehlt.length, 1);
        assert.match(b.einzelheiten.nicht_gelesen.join(' '), /kaputt\.jar: Zip: kein Verzeichnisende/);

        const fremd = bauePaket();
        const index = fremd.dateien.get(fremd.archivAdresse);
        assert.ok(index);
        const woanders = bauePaket((p) => { p.fremd = true; });
        // Eine Datei, die nicht bei Modrinth liegt, wird nicht geholt.
        const u = { abruf: woanders.host.abruf, erlaubt: (a) => erlaubt(a) && !String(a).endsWith('lib.jar'), kopf: {} };
        const c = await PackBefund.rechneZwei(woanders.paket, woanders.version, woanders.eins, u, () => {});
        assert.strictEqual(c.urteil, 'unklar');
        assert.match(c.einzelheiten.nicht_gelesen.join(' '), /lib\.jar: liegt nicht bei Modrinth/);
        assert.ok(!woanders.host.stand.abrufe.some(a => a.includes('lib.jar')));
    });

    await pruefe('scheitert ein Abruf am Netz, gibt es KEIN Urteil (später noch einmal)', async () => {
        const p = bauePaket((x) => { x.jars['weg.jar'] = 'netz'; });
        await assert.rejects(rechne(p), /fetch failed/);
    });

    await pruefe('die falsche Größe im Verzeichnis des Pakets hindert nicht am Lesen (BMC4: 14 von 309)', async () => {
        const b = await rechne(bauePaket());
        assert.deepStrictEqual(b.einzelheiten.nicht_gelesen, []);
        assert.ok(!b.fehlt.some(f => f.kennung === 'lib'));
    });

    await pruefe('das Archiv wird nicht geladen — auch nicht für eine beigelegte Mod', async () => {
        const p = bauePaket();
        await rechne(p);
        const vomArchiv = p.host.stand.abrufe.filter(a => a.startsWith(p.archivAdresse)).map(a => /bytes=(\d+)-(\d+)/.exec(a))
            .reduce((summe, m) => summe + Number(m[2]) - Number(m[1]) + 1, 0);
        assert.ok(vomArchiv < p.archiv.length / 4, `${vomArchiv} von ${p.archiv.length} Byte des Archivs geholt`);
    });

    // ════════════════════════════════════════════════════════════════════════
    console.log('\nEin Befund, eine Stelle');
    // ════════════════════════════════════════════════════════════════════════
    const baueUmgebung = (p) => {
        const zeilen = new Map();
        const stand = { api: [], schreiben: 0, unbekannt: [] };
        const db = { query: async (sql, werte) => {
            const s = sql.trim();
            if (/^SELECT \* FROM modpack_befunde WHERE quelle = \? AND fassung_id = \?$/.test(s)) {
                return zeilen.has(werte[1]) ? [{ ...zeilen.get(werte[1]) }] : [];
            }
            if (/^SELECT \* FROM modpack_befunde WHERE quelle = \? AND regel = \? AND fassung_id IN/.test(s)) {
                return werte.slice(2).filter(id => zeilen.has(id) && zeilen.get(id).regel === werte[1]).map(id => ({ ...zeilen.get(id) }));
            }
            if (/^INSERT INTO modpack_befunde/.test(s)) {
                stand.schreiben++;
                const spalten = /\(([^)]+)\)\s+VALUES/.exec(s)[1].split(',').map(x => x.trim());
                const zeile = {};
                let i = 0;
                for (const spalte of spalten) zeile[spalte] = spalte === 'geprueft_am' ? new Date() : werte[i++];
                zeilen.set(zeile.fassung_id, zeile);
                return { affectedRows: 1 };
            }
            stand.unbekannt.push(s.slice(0, 80));
            return [];
        } };
        const hole = async (pfad) => {
            stand.api.push(pfad);
            if (pfad === '/version/vprobe') return p.version;
            if (pfad.startsWith('/projects?')) {
                return [{ id: 'p-optik', title: 'Optik', server_side: 'unsupported' }, { id: 'p-kern', title: 'Kern', server_side: 'unsupported' },
                    { id: 'p-a', title: 'Mod A', server_side: 'required' }];
            }
            if (pfad.startsWith('/versions?')) {
                return [{ project_id: 'p-optik', files: [{ hashes: { sha1: SHA('A') } }] }, { project_id: 'p-kern', files: [{ hashes: { sha1: SHA('b') } }] }];
            }
            throw new Error(`Attrappe kennt ${pfad} nicht`);
        };
        return { zeilen, stand, umgebung: { db, hole, abruf: p.host.abruf, erlaubt, kopf: {} } };
    };

    await pruefe('Stufe 1 fragt nur die API, speichert, und der zweite Aufruf liest', async () => {
        const p = bauePaket();
        const u = baueUmgebung(p);
        const b = await PackBefund.befund(p.paket, { stufe: 1, umgebung: u.umgebung });
        assert.deepStrictEqual([b.urteil, b.stufe, b.auslassen.namen], ['laeuft_ohne_client', 1, ['Kern', 'Optik']]);
        assert.deepStrictEqual(b.auslassen.sha1.sort(), [SHA('a'), SHA('b')]);
        assert.strictEqual(p.host.stand.abrufe.length, 0, 'Stufe 1 hat das Archiv angefasst');
        assert.strictEqual(u.stand.api.length, 3);
        const noch = await PackBefund.befund(p.paket, { stufe: 1, umgebung: u.umgebung });
        assert.deepStrictEqual([noch.urteil, noch.stufe, noch.auslassen.namen], ['laeuft_ohne_client', 1, ['Kern', 'Optik']]);
        assert.deepStrictEqual([u.stand.api.length, u.stand.schreiben], [3, 1]);
    });

    await pruefe('Stufe 2 ersetzt Stufe 1, und danach liest auch die Frage nach Stufe 1 den gründlichen Befund', async () => {
        const p = bauePaket();
        const u = baueUmgebung(p);
        await PackBefund.befund(p.paket, { stufe: 1, umgebung: u.umgebung });
        const phasen = [];
        const b = await PackBefund.befund(p.paket, { stufe: 2, umgebung: u.umgebung, beiFortschritt: (f) => phasen.push(f.phase) });
        assert.deepStrictEqual([b.urteil, b.stufe, b.stufe2Fehler], ['unvollstaendig', 2, null]);
        assert.deepStrictEqual([...new Set(phasen)], ['befund_archiv', 'befund', 'befund_eingebettet']);
        const vorher = u.stand.api.length;
        const eins = await PackBefund.befund(p.paket, { stufe: 1, umgebung: u.umgebung });
        const zwei = await PackBefund.befund(p.paket, { stufe: 2, umgebung: u.umgebung });
        assert.deepStrictEqual([eins.stufe, zwei.urteil, zwei.fehlt[0].name, u.stand.api.length - vorher], [2, 'unvollstaendig', 'Fehl Mod', 0]);
        assert.deepStrictEqual(u.stand.unbekannt, []);
    });

    await pruefe('ein Befund mit älterer Regel gilt nicht — er wird neu gerechnet', async () => {
        const p = bauePaket();
        const u = baueUmgebung(p);
        await PackBefund.befund(p.paket, { stufe: 2, umgebung: u.umgebung });
        u.zeilen.get('vprobe').regel = PackBefund.REGEL - 1;
        u.zeilen.get('vprobe').urteil = 'laeuft';
        const b = await PackBefund.befund(p.paket, { stufe: 2, umgebung: u.umgebung });
        assert.strictEqual(b.urteil, 'unvollstaendig');
        assert.strictEqual(u.stand.schreiben, 2);
        assert.strictEqual((await PackBefund.gespeichert(['vprobe', 'fremd'], { umgebung: u.umgebung })).get('vprobe').urteil, 'unvollstaendig');
    });

    await pruefe('fällt Stufe 2 aus, steht Stufe 1 — gesagt, nicht verschluckt, und beim nächsten Mal wird es wieder versucht', async () => {
        const p = bauePaket((x) => { x.jars['weg.jar'] = 'netz'; });
        const u = baueUmgebung(p);
        gewarnt.length = 0;
        const b = await PackBefund.befund(p.paket, { stufe: 2, umgebung: u.umgebung });
        assert.deepStrictEqual([b.stufe, b.urteil], [1, 'laeuft_ohne_client']);
        assert.match(b.stufe2Fehler, /fetch failed/);
        assert.match(gewarnt.join('\n'), /Stufe 2 nicht möglich/);
        assert.strictEqual(u.zeilen.get('vprobe').stufe, 1);
        p.dateien.set(`${CDN}weg.jar`, forgeJar('weg', 'Weg', []));
        assert.strictEqual((await PackBefund.befund(p.paket, { stufe: 2, umgebung: u.umgebung })).stufe, 2);
    });

    await pruefe('zwei, die dieselbe Fassung zugleich wählen, rechnen einmal', async () => {
        const p = bauePaket();
        const u = baueUmgebung(p);
        const [a, b] = await Promise.all([
            PackBefund.befund(p.paket, { stufe: 2, umgebung: u.umgebung }),
            PackBefund.befund(p.paket, { stufe: 2, umgebung: u.umgebung }),
        ]);
        assert.strictEqual(a.urteil, b.urteil);
        assert.strictEqual(u.stand.schreiben, 1);
        assert.strictEqual(PackBefund.laeuft('vprobe'), false);
    });

    await pruefe('ohne Kennung der Fassung wird nicht geraten', async () => {
        await assert.rejects(PackBefund.befund({ kennung: 'probe', fassung: '1.0' }, { umgebung: baueUmgebung(bauePaket()).umgebung }), /nennt keine Kennung/);
    });

    // ════════════════════════════════════════════════════════════════════════
    console.log('\nTabelle, Einspielen, Modrinth');
    // ════════════════════════════════════════════════════════════════════════
    const lies = (p) => ohneKommentare(fs.readFileSync(path.join(WURZEL, p), 'utf8'));

    await pruefe('die Migration legt genau die Spalten an, die der Befund schreibt', async () => {
        const migration = lies('plugins/gameserver/migrations/20261112_200000_modpack_befunde.js');
        const tabelle = /CREATE TABLE modpack_befunde \(([\s\S]+?)\n\s+\) ENGINE/.exec(migration)[1];
        const angelegt = tabelle.split('\n').map(z => /^\s+([a-z_]+)\s+(?:VARCHAR|TINYINT|SMALLINT|LONGTEXT|DATETIME|INT)/.exec(z)).filter(Boolean).map(m => m[1]);
        const geschrieben = /INSERT INTO modpack_befunde\s+\(([^)]+)\)/.exec(lies('plugins/gameserver/dashboard/helpers/PackBefund.js'))[1].split(',').map(x => x.trim());
        assert.deepStrictEqual(angelegt.sort(), geschrieben.sort());
        assert.match(tabelle, /PRIMARY KEY \(quelle, fassung_id\)/);
    });

    await pruefe('die Fassung eines Modpacks trägt ihre Kennung — der Schlüssel des Befunds', async () => {
        assert.match(lies('plugins/gameserver/dashboard/helpers/Modrinth.js'), /fassungId:\s*gewaehlt\.id/);
    });

    await pruefe('Vorprüfung und Installation lesen den Befund und spielen Unvollständiges nicht ein', async () => {
        const holen = lies('plugins/gameserver/dashboard/helpers/InhalteHolen.js');
        const pruefen = holen.slice(holen.indexOf('async function pruefeModpack'), holen.indexOf('async function installiereModpack'));
        const installieren = holen.slice(holen.indexOf('async function installiereModpack'), holen.indexOf('async function fremdeModDateien'));
        assert.match(holen, /PackBefund\.befund\(paket, \{ stufe: 2/);
        // Vor dem Auftrag an den Daemon, und bei der Installation bevor das alte Paket weicht.
        assert.ok(pruefen.indexOf('abgleich.unvollstaendig') > 0
            && pruefen.indexOf('abgleich.unvollstaendig') < pruefen.indexOf("'gameserver.content.modpack.pruefen'"));
        assert.ok(installieren.indexOf('if (unvollstaendig)') > 0
            && installieren.indexOf('if (unvollstaendig)') < installieren.indexOf('entferneDateien('));
    });

    // ════════════════════════════════════════════════════════════════════════
    // Suche und Auswahl (Betreiber 2026-10-29: Stufe 2 beim Auswählen,
    // Unvollständiges für alle ausblenden)
    // ════════════════════════════════════════════════════════════════════════
    const TREFFER = [
        { kennung: 'gut', name: 'Gut', fassungId: 'v-gut' },
        { kennung: 'luecke', name: 'Lücke', fassungId: 'v-luecke' },
        { kennung: 'neu', name: 'Neu', fassungId: 'v-neu' },
        { kennung: 'vage', name: 'Vage', fassungId: 'v-vage' },
        { kennung: 'ohne', name: 'Ohne Fassung', fassungId: null },
    ];
    const zeile = (id, urteil, stufe, regel = PackBefund.REGEL) => ({ quelle: 'modrinth', fassung_id: id, kennung: id, fassung: '1',
        stufe, regel, urteil, auslassen: JSON.stringify({ sha1: ['x'], namen: ['Optik', 'Zoom'] }), fehlt: '[]', einzelheiten: '{}' });
    const BESTAND = [zeile('v-gut', 'laeuft_ohne_client', 2), zeile('v-luecke', 'unvollstaendig', 2), zeile('v-vage', 'unklar', 2)];
    const sucheDb = (bestand) => ({ query: async (sql, werte) => bestand.filter(z => z.regel === werte[1] && werte.slice(2).includes(z.fassung_id)) });

    await pruefe('Suche: was als unvollständig befunden ist, steht nicht in der Liste — und die Zahl steht da', async () => {
        const e = await PackBefund.fuerSuche({ treffer: TREFFER, gesamt: 5, seite: 1 }, { umgebung: { db: sucheDb(BESTAND) } });
        assert.deepStrictEqual(e.treffer.map(t => t.kennung), ['gut', 'neu', 'vage', 'ohne']);
        assert.deepStrictEqual([e.ausgeblendet, e.gesamt, e.seite], [1, 5, 1]);
        assert.deepStrictEqual(e.treffer[0].befund, { urteil: 'laeuft_ohne_client', stufe: 2, clientMods: 2 });
        assert.deepStrictEqual([e.treffer[1].befund, e.treffer[2].befund.urteil, e.treffer[3].befund], [null, 'unklar', null]);
    });

    await pruefe('Suche: ein Urteil nach älterer Regel blendet nichts aus', async () => {
        const alt = [zeile('v-luecke', 'unvollstaendig', 2, PackBefund.REGEL - 1)];
        const e = await PackBefund.fuerSuche({ treffer: TREFFER }, { umgebung: { db: sucheDb(alt) } });
        assert.deepStrictEqual([e.treffer.length, e.ausgeblendet], [5, 0]);
    });

    await pruefe('Suche: gerechnet wird dabei nichts — kein Abruf, eine Abfrage', async () => {
        let abfragen = 0;
        const db = { query: async () => { abfragen++; return []; } };
        const hole = async () => { throw new Error('die Suche hat Modrinth gefragt'); };
        await PackBefund.fuerSuche({ treffer: TREFFER }, { umgebung: { db, hole, abruf: hole } });
        assert.strictEqual(abfragen, 1);
        await PackBefund.fuerSuche({ treffer: [] }, { umgebung: { db, hole, abruf: hole } });
        assert.strictEqual(abfragen, 1, 'ohne Treffer keine Abfrage');
    });

    await pruefe('der Treffer der Suche nennt die Fassung, an der der Befund hängt', async () => {
        const Modrinth = require(H('Modrinth'));
        const echt = global.fetch;
        const antwort = (k) => ({ ok: true, status: 200, json: async () => k });
        global.fetch = async (adresse) => {
            const u = new URL(String(adresse));
            if (u.pathname === '/v2/search') return antwort({ total_hits: 2, hits: [
                { slug: 'eins', title: 'Eins', project_id: 'p1', latest_version: 'neueste-1' },
                { slug: 'zwei', title: 'Zwei', project_id: 'p2', latest_version: 'neueste-2' }] });
            if (u.pathname === '/v2/versions') return antwort([
                { id: 'neueste-1', project_id: 'p1', version_number: '9', loaders: ['forge'], game_versions: ['1.20.1'] },
                { id: 'neueste-2', project_id: 'p2', version_number: '9', loaders: ['fabric'], game_versions: ['1.20.1'] }]);
            if (u.pathname === '/v2/project/zwei/version') return antwort([
                { id: 'aeltere-2', project_id: 'p2', version_number: '8', loaders: ['forge'], game_versions: ['1.20.1'] }]);
            throw new Error(`Attrappe kennt ${u.pathname} nicht`);
        };
        try {
            // Ohne Lader (Anlegen): die neueste. Mit Lader: die, die passt.
            assert.deepStrictEqual((await Modrinth.sucheModpacks('', {})).treffer.map(t => t.fassungId), ['neueste-1', 'neueste-2']);
            assert.deepStrictEqual((await Modrinth.sucheModpacks('', { lader: 'forge' })).treffer.map(t => t.fassungId), ['neueste-1', 'aeltere-2']);
        } finally { global.fetch = echt; }
    });

    // Die Routen, echt — ersetzt sind nur Modrinth und der Befund.
    ServiceManager.register('dbService', { query: async () => [] });
    ServiceManager.register('ipmServer', { isDaemonOnline: () => true, sendCommand: async () => ({ success: true }) });
    const router = require(path.join(WURZEL, 'plugins/gameserver/dashboard/routes/inhalte.js'));
    const rufe = async (pfad, query) => {
        const schicht = router.stack.find(l => l.route && l.route.path === pfad && l.route.methods.get);
        const handler = schicht.route.stack[schicht.route.stack.length - 1].handle;
        const aus = { code: 200, d: null };
        await handler({ query, params: {} }, { locals: { guildId: 'g' }, status(c) { aus.code = c; return this; }, json(d) { aus.d = d; return this; } });
        return aus;
    };
    const Modrinth = require(H('Modrinth'));
    const echt = { suche: Modrinth.sucheModpacks, fassung: Modrinth.modpackFassung, befund: PackBefund.befund, fuerSuche: PackBefund.fuerSuche };
    const PAKET = { kennung: 'probe', name: 'Probepaket', fassung: '1.0', fassungId: 'vprobe', lader: 'forge', spielfassung: '1.20.1', bytes: 5 };
    const UNVOLLSTAENDIG = { urteil: 'unvollstaendig', stufe: 2, auslassen: { sha1: ['geheim'], namen: [] }, einzelheiten: {},
        fehlt: [{ kennung: 'flib', name: 'FLIB', gebraucht_von: ['Lager'], grund: 'extern', host: 'www.curseforge.com' }] };

    await pruefe('Route: die Suche beim Anlegen blendet aus und nennt die Zahl', async () => {
        Modrinth.sucheModpacks = async () => ({ treffer: TREFFER, gesamt: 5 });
        PackBefund.fuerSuche = (e) => echt.fuerSuche(e, { umgebung: { db: sucheDb(BESTAND) } });
        try {
            const a = await rufe('/modpacks/suche', { q: '' });
            assert.deepStrictEqual([a.code, a.d.success, a.d.ausgeblendet, a.d.treffer.length], [200, true, 1, 4]);
            assert.ok(!a.d.treffer.some(t => t.kennung === 'luecke'));
        } finally { Modrinth.sucheModpacks = echt.suche; PackBefund.fuerSuche = echt.fuerSuche; }
    });

    await pruefe('Route: beim Auswählen läuft Stufe 2, und die Antwort trägt den Satz — aber keine Prüfsummen', async () => {
        const gefragt = [];
        Modrinth.modpackFassung = async () => ({ ...PAKET });
        PackBefund.befund = async (paket, o) => { gefragt.push([paket.fassungId, o.stufe]); return UNVOLLSTAENDIG; };
        try {
            const a = await rufe('/modpacks/fassung', { kennung: 'probe' });
            assert.deepStrictEqual(gefragt, [['vprobe', 2]]);
            assert.deepStrictEqual([a.code, a.d.success, a.d.befund.urteil, a.d.befundFehler], [200, true, 'unvollstaendig', null]);
            assert.match(a.d.befund.satz, /FLIB \(gebraucht von Lager\)/);
            assert.ok(!JSON.stringify(a.d.befund).includes('geheim'));
        } finally { Modrinth.modpackFassung = echt.fassung; PackBefund.befund = echt.befund; }
    });

    await pruefe('Route: lässt sich der Befund nicht holen, bleibt die Auswahl möglich — und es wird gesagt', async () => {
        Modrinth.modpackFassung = async () => ({ ...PAKET });
        PackBefund.befund = async () => { throw new Error('Modrinth antwortete 502'); };
        try {
            const a = await rufe('/modpacks/fassung', { kennung: 'probe' });
            assert.deepStrictEqual([a.code, a.d.success, a.d.befund, a.d.befundFehler], [200, true, null, 'Modrinth antwortete 502']);
        } finally { Modrinth.modpackFassung = echt.fassung; PackBefund.befund = echt.befund; }
    });

    await pruefe('beide Suchen gehen durch den Befund, und das Anlegen lehnt Unvollständiges selbst ab', async () => {
        const routen = lies('plugins/gameserver/dashboard/routes/inhalte.js');
        assert.strictEqual((routen.match(/Modrinth\.sucheModpacks\(/g) || []).length, 2);
        assert.strictEqual((routen.match(/PackBefund\.fuerSuche\(\s*await Modrinth\.sucheModpacks\(/g) || []).length, 2);
        const anlegen = lies('plugins/gameserver/dashboard/routes/servers.js');
        const tor = anlegen.indexOf('befund.urteil === PackBefund.URTEIL.UNVOLLSTAENDIG');
        assert.ok(tor > 0 && tor < anlegen.indexOf('const paketWerte = paketWerteAnlegen('), 'das Tor steht nicht vor dem Anlegen');
        assert.match(anlegen.slice(tor, tor + 200), /res\.status\(400\)[\s\S]*satzUnvollstaendig\(mp, befund\)/);
    });

    await pruefe('Seiten: der Assistent wählt Unvollständiges nicht, beide Listen nennen das Ausgeblendete', async () => {
        const { ohneKommentareEjs } = require('./lib/quelltext');
        const liesEjs = (p) => ohneKommentareEjs(fs.readFileSync(path.join(WURZEL, p), 'utf8'));
        const assistent = liesEjs('plugins/gameserver/dashboard/views/guild/server-create-step3.ejs');
        const wahl = assistent.slice(assistent.indexOf('async function waehle('), assistent.indexOf("suche.addEventListener('input'"));
        // Zurückgesetzt und der Satz gezeigt, BEVOR die Kennung ins Formular geschrieben wird.
        const ab = wahl.indexOf("b.urteil === 'unvollstaendig'");
        assert.ok(ab > 0 && ab < wahl.indexOf('kennung.value = m.kennung'));
        assert.match(wahl.slice(ab, ab + 200), /zuruecksetzen\(\);\s*zeigeGewaehlt\(b\.satz, 'rot'\);\s*return;/);
        assert.match(assistent, /befundSatz\(b, d\.befundFehler\)/);
        assert.match(assistent, /if \(d\.ausgeblendet\)/);
        const reiter = liesEjs('plugins/gameserver/dashboard/views/guild/partials/server-detail-inhalte.ejs');
        assert.match(reiter, /const ausgeblendet = d\.ausgeblendet \?/);
        assert.match(reiter, /\.join\(''\) \+ ausgeblendet \+ blaettern/);
        assert.match(reiter, /befund_archiv:[^\n]+\n\s+befund:[^\n]+\n\s+befund_eingebettet:/);
    });

    await pruefe('Modrinth: Das Limit wird gelesen, und bei 429 wird einmal gewartet statt abgebrochen', async () => {
        const Modrinth = require(H('Modrinth'));
        const echt = { fetch: global.fetch, setTimeout: global.setTimeout };
        const gewartet = [];
        global.setTimeout = (tun, ms) => { gewartet.push(ms); return echt.setTimeout(tun, 0); };
        const kopf = (werte) => ({ get: (n) => werte[n] ?? null });
        const antworten = [
            { status: 429, ok: false, headers: kopf({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '7' }) },
            { status: 200, ok: true, headers: kopf({ 'x-ratelimit-remaining': '12', 'x-ratelimit-reset': '40' }), json: async () => ({ da: true }) },
        ];
        let abrufe = 0;
        global.fetch = async () => antworten[abrufe++];
        try {
            assert.deepStrictEqual(await Modrinth.hole('/probe'), { da: true });
            assert.strictEqual(abrufe, 2);
            assert.ok(gewartet.includes(7500), `gewartet: ${gewartet.join(', ')}`);
            assert.strictEqual(Modrinth.limitStand().rest, 12);
            // Zweimal 429 hintereinander: Dann wird es gesagt.
            abrufe = 0;
            antworten[1] = antworten[0];
            await assert.rejects(Modrinth.hole('/probe'), /Limit erreicht/);
        } finally {
            global.fetch = echt.fetch;
            global.setTimeout = echt.setTimeout;
        }
    });

    console.log(fehler
        ? `\n❌ ${fehler} von ${geprueft} Prüfungen schlagen fehl`
        : `\n✅ Der Pack-Befund trägt (${geprueft} Prüfungen)`);
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
