#!/usr/bin/env node
'use strict';

/**
 * Wächter: Was eine einzelne Mod selbst als Pflicht nennt (K379).
 *
 * ── Woher er kommt ───────────────────────────────────────────────────────────
 *
 * `Modrinth.aufloesen` holt, was die Fassung bei Modrinth als `required`
 * führt. Gemessen 2026-11-13 an den 40 meistgeladenen Fabric-Mods für 1.21.1:
 * Jade 15.10.6 verlangt in `fabric.mod.json` `fabric-api`, Collective `fabric`
 * — Modrinth führt bei beiden keine Abhängigkeit. Ohne Fabric API bricht der
 * Lader beim Start ab. Beim Einspielen wird das jetzt genannt.
 *
 * Unterwegs gefunden: Connector (Sinytra) trägt seine Mod nur über die
 * Manifest-Angabe `Embedded-Dependencies-Mod` eingebettet. `ModBeschreibung`
 * kannte die Angabe nicht, und `connectormod` galt als fehlend — auch im
 * Pack-Befund (K226), der damit Pakete fälschlich ausgeblendet hätte.
 *
 * ── Was er hält ──────────────────────────────────────────────────────────────
 *
 * 1. `ModBeschreibung` liest eingebettete Jars aus dem Manifest und aus
 *    `META-INF/jarjar/`, auch ohne `metadata.json`.
 * 2. `ModPflichten.pruefe` an nachgebauten Fällen: fehlt, liegt auf dem
 *    Server, steckt eingebettet, Ordner nicht lesbar, altes Format.
 * 3. Der Weg durch `InhalteHolen`: Mod-Ordner per `files.list`, Jars per
 *    `/datei` mit Pfad unter dem Ablageort; die Prüfung wirft nie und läuft
 *    nur für Modrinth und Forge, NeoForge, Fabric.
 * 4. Vorschau und Ergebnis zeigen es (Route, Ansicht).
 *
 * Der echte Lauf (Modrinth, Mod-Ordner von Server 233 über den Daemon) steht
 * im Commit: Ein Wächter fragt keine fremden Dienste.
 *
 * Aufruf:  node scripts/check-mod-pflichten.js
 * Rückgabe: 0 = die Prüfung trägt.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { ohneKommentare } = require('./lib/quelltext');
const { baueZip, baueHost } = require('./lib/zipprobe');

const WURZEL = path.join(__dirname, '..');
const H = (d) => path.join(WURZEL, 'plugins/gameserver/dashboard/helpers', d);
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), 'utf8');

const { ServiceManager } = require('dunebot-core');
const gewarnt = [];
ServiceManager.register('Logger', { info() {}, warn: (t) => gewarnt.push(String(t)), error() {}, debug() {} });

const ZipFern = require(H('ZipFern'));
const ModBeschreibung = require(H('ModBeschreibung'));
const ModPflichten = require(H('ModPflichten'));
const PackBefund = require(H('PackBefund'));
const Abruf = require(H('Abruf'));

let fehler = 0;
let geprueft = 0;
async function pruefe(was, tun) {
    geprueft++;
    try { await tun(); console.log(`  ✅ ${was}`); }
    catch (e) { fehler++; console.log(`  ❌ ${was}\n       ${String(e.message).split('\n').slice(0, 6).join('\n       ')}`); }
}

// ── Mods bauen ──────────────────────────────────────────────────────────────
const fabricJar = (json, mehr = {}) => baueZip({ 'fabric.mod.json': JSON.stringify(json), ...mehr, 'fuellung.bin': Buffer.alloc(3000, 3) });
const forgeToml = (id, braucht = []) => `modLoader="javafml"\n[[mods]]\nmodId="${id}"\ndisplayName="${id}"\n`
    + braucht.map(b => `[[dependencies.${id}]]\n    modId="${b}"\n    mandatory=true\n    side="BOTH"\n`).join('');

/** Wie Fabric API 0.116.18: bietet `fabric-api` und `fabric`, Teilmodule eingebettet. */
const FABRIC_API = fabricJar({ id: 'fabric-api', provides: ['fabric'], depends: { fabricloader: '*', minecraft: '*' },
    jars: [{ file: 'META-INF/jars/fabric-api-base.jar' }] }, {
    'META-INF/jars/fabric-api-base.jar': fabricJar({ id: 'fabric-api-base' }),
});
/** Wie Jade 15.10.6+fabric: verlangt `fabric-api`, Modrinth nennt nichts. */
const JADE = fabricJar({ id: 'jade', name: 'Jade', depends: { fabricloader: '*', minecraft: '*', java: '*', 'fabric-api': '*' } });
const BASIS_NUTZER = fabricJar({ id: 'basisnutzer', name: 'Basisnutzer', depends: { 'fabric-api-base': '*' } });
const ZWEI = fabricJar({ id: 'zwei', name: 'Zwei', depends: { 'gibt-es-a': '*', 'gibt-es-b': '*' } });
const NUR_CLIENT = fabricJar({ id: 'optik', name: 'Optik', environment: 'client', depends: { 'gibt-es-nicht': '*' } });
/** Wie Connector 1.0.0-beta.49: außen nur das Manifest, die Mod steckt in jarjar. */
const CONNECTOR = baueZip({
    'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0\r\nEmbedded-Dependencies-Mod: META-INF/jarjar/Connector-1.0.0-beta.49+1.20.\r\n 1-mod.jar\r\nAutomatic-Module-Name: org.sinytra.connector\r\n',
    'META-INF/jarjar/Connector-1.0.0-beta.49+1.20.1-mod.jar': baueZip({ 'META-INF/mods.toml': forgeToml('connectormod') }),
});
const CONTINUITY = baueZip({ 'META-INF/mods.toml': forgeToml('continuity', ['connectormod', 'forge']) });
const ALT = baueZip({ 'mcmod.info': JSON.stringify([{ modid: 'jei', name: 'Just Enough Items' }]) });

const CDN = 'https://cdn.modrinth.com/data/';
const dateien = new Map([
    [`${CDN}jade.jar`, JADE], [`${CDN}api.jar`, FABRIC_API], [`${CDN}basis.jar`, BASIS_NUTZER],
    [`${CDN}zwei.jar`, ZWEI], [`${CDN}optik.jar`, NUR_CLIENT], [`${CDN}connector.jar`, CONNECTOR],
    [`${CDN}continuity.jar`, CONTINUITY], [`${CDN}alt.jar`, ALT],
]);
const host = baueHost(dateien);
const umgebung = { abruf: host.abruf, erlaubt: (a) => String(a).startsWith(CDN), kopf: {} };
const paket = (name, datei) => ({ kennung: name, name, adresse: `${CDN}${datei}`, bytes: dateien.get(`${CDN}${datei}`)?.length || 0 });

/** Ein Mod-Ordner auf dem „Server" — gelesen über denselben Host. */
let ordnerNummer = 0;
const ordner = (namen) => ({
    schluessel: `probe-${++ordnerNummer}`,
    dateien: namen.map(n => ({ name: `${n}.jar`, groesse: dateien.get(`${CDN}${n}.jar`).length, zeit: 't' })),
    oeffne: (d) => ZipFern.fernQuelle(`${CDN}${d.name}`, { abruf: host.abruf, groesse: d.groesse, schwanz: ModPflichten.JAR_SCHWANZ }),
});

(async () => {
    console.log('\n▸ 1. Eingebettete Mods ohne metadata.json (Connector)');

    await pruefe('Manifest: Fortsetzungszeilen werden zusammengesetzt', async () => {
        const werte = ModBeschreibung.manifestWerte('A: 1\r\nEmbedded-Dependencies-Mod: META-INF/jarjar/a\r\n b.jar, c.jar\r\nX: y\r\n',
            'Embedded-Dependencies-Mod');
        assert.deepStrictEqual(werte, ['META-INF/jarjar/ab.jar', 'c.jar']);
    });
    await pruefe('Connector: Die Mod im Manifest wird gefunden, connectormod ist geboten', async () => {
        const quelle = ZipFern.pufferQuelle(CONNECTOR);
        const b = await ModBeschreibung.beschreibe(quelle, 'forge');
        assert.deepStrictEqual(b.eingebettet, ['META-INF/jarjar/Connector-1.0.0-beta.49+1.20.1-mod.jar']);
        const innen = await ModBeschreibung.eingebetteteKennungen(quelle, b, 'forge');
        assert.deepStrictEqual(innen.kennungen, ['connectormod']);
    });
    await pruefe('Ein Jar direkt in META-INF/jarjar/ zählt auch ohne jede Angabe', async () => {
        const nackt = baueZip({ 'META-INF/jarjar/x.jar': baueZip({ 'META-INF/mods.toml': forgeToml('xmod') }) });
        const quelle = ZipFern.pufferQuelle(nackt);
        const b = await ModBeschreibung.beschreibe(quelle, 'forge');
        assert.deepStrictEqual((await ModBeschreibung.eingebetteteKennungen(quelle, b, 'forge')).kennungen, ['xmod']);
    });
    await pruefe('Pack-Befund: Regel angehoben (Befunde nach Regel 1 kannten connectormod nicht)', async () => {
        assert.ok(PackBefund.REGEL >= 2, `REGEL ist ${PackBefund.REGEL}`);
    });

    console.log('\n▸ 2. Die Prüfung an nachgebauten Fällen');

    await pruefe('Jade auf leerem Server: fabric-api fehlt, der Satz nennt es (Einzahl)', async () => {
        const e = await ModPflichten.pruefe({ lader: 'fabric', pakete: [paket('Jade', 'jade.jar')], bestand: ordner([]), umgebung });
        assert.deepStrictEqual(e.fehlt, [{ kennung: 'fabric-api', gebraucht_von: ['Jade'] }]);
        const s = ModPflichten.satz(e);
        assert.strictEqual(s.ton, 'warn');
        assert.match(s.text, /eine Pflicht-Mod, die Modrinth nicht als Abhängigkeit führt und die auf dem Server fehlt: fabric-api \(verlangt von Jade\)/);
    });
    await pruefe('Jade mit Fabric API im Mod-Ordner: nichts fehlt', async () => {
        const e = await ModPflichten.pruefe({ lader: 'fabric', pakete: [paket('Jade', 'jade.jar')], bestand: ordner(['api']), umgebung });
        assert.deepStrictEqual(e.fehlt, []);
        assert.strictEqual(e.bestand, 1);
        assert.strictEqual(ModPflichten.satz(e).ton, 'gut');
    });
    await pruefe('Jade mit Fabric API als Modrinth-Abhängigkeit: nichts fehlt', async () => {
        const e = await ModPflichten.pruefe({ lader: 'fabric', bestand: ordner([]), umgebung,
            pakete: [paket('Fabric API', 'api.jar'), paket('Jade', 'jade.jar')] });
        assert.deepStrictEqual(e.fehlt, []);
    });
    await pruefe('Eine Pflicht, die nur eingebettet auf dem Server liegt (fabric-api-base), wird gefunden', async () => {
        const e = await ModPflichten.pruefe({ lader: 'fabric', pakete: [paket('Basisnutzer', 'basis.jar')], bestand: ordner(['api']), umgebung });
        assert.deepStrictEqual(e.fehlt, []);
    });
    await pruefe('Gegenprobe: ohne Fabric API fehlt fabric-api-base', async () => {
        const e = await ModPflichten.pruefe({ lader: 'fabric', pakete: [paket('Basisnutzer', 'basis.jar')], bestand: ordner(['jade']), umgebung });
        assert.deepStrictEqual(e.fehlt.map(f => f.kennung), ['fabric-api-base']);
    });
    await pruefe('Zwei fehlen: Mehrzahl im Satz', async () => {
        const e = await ModPflichten.pruefe({ lader: 'fabric', pakete: [paket('Zwei', 'zwei.jar')], bestand: ordner([]), umgebung });
        assert.match(ModPflichten.satz(e).text, /2 Pflicht-Mods, .* auf dem Server fehlen: gibt-es-a .*; gibt-es-b/);
    });
    await pruefe('Ordner nicht lesbar: genannt wird trotzdem, der Satz sagt es', async () => {
        const e = await ModPflichten.pruefe({ lader: 'fabric', pakete: [paket('Jade', 'jade.jar')],
            bestand: { grund: 'Der Daemon ist gerade nicht erreichbar' }, umgebung });
        assert.strictEqual(e.bestand, null);
        const s = ModPflichten.satz(e).text;
        assert.match(s, /die nicht mitkommt: fabric-api/);
        assert.match(s, /Mod-Ordner des Servers konnte ich nicht lesen \(Der Daemon ist gerade nicht erreichbar\)/);
    });
    await pruefe('Eine reine Client-Mod verlangt auf dem Server nichts', async () => {
        const e = await ModPflichten.pruefe({ lader: 'fabric', pakete: [paket('Optik', 'optik.jar')], bestand: ordner([]), umgebung });
        assert.deepStrictEqual(e.fehlt, []);
    });
    await pruefe('Continuity mit Connector (Forge): connectormod ist da, Connector gilt nicht als „nicht prüfbar"', async () => {
        const e = await ModPflichten.pruefe({ lader: 'forge', bestand: ordner([]), umgebung,
            pakete: [paket('Sinytra Connector', 'connector.jar'), paket('Continuity', 'continuity.jar')] });
        assert.deepStrictEqual(e.fehlt, []);
        assert.deepStrictEqual(e.nichtPruefbar, []);
    });
    await pruefe('Forge bis 1.12 (mcmod.info): „nicht prüfbar" statt „nichts fehlt"', async () => {
        const e = await ModPflichten.pruefe({ lader: 'forge', pakete: [paket('jei', 'alt.jar')], bestand: ordner([]), umgebung });
        assert.deepStrictEqual(e.nichtPruefbar, ['Just Enough Items']);
        assert.strictEqual(ModPflichten.satz(e).ton, 'leise');
        assert.match(ModPflichten.satz(e).text, /^Nicht prüfbar/);
    });
    await pruefe('Eine Adresse außerhalb von Modrinth wird nicht gelesen, sondern genannt', async () => {
        const e = await ModPflichten.pruefe({ lader: 'fabric', bestand: ordner([]), umgebung,
            pakete: [{ kennung: 'fremd', adresse: 'https://example.org/fremd.jar', bytes: 10 }] });
        assert.ok(!host.stand.abrufe.some(a => a.startsWith('https://example.org')), 'fremde Adresse abgerufen');
        assert.match(e.nichtGelesen.join(), /fremd: liegt nicht bei Modrinth/);
    });
    await pruefe('Paper und andere Plugin-Lader: keine Prüfung (null)', async () => {
        assert.strictEqual(await ModPflichten.pruefe({ lader: 'paper', pakete: [], bestand: ordner([]), umgebung }), null);
    });
    await pruefe('Zweiter Lauf liest aus dem Speicher, nicht noch einmal vom Host', async () => {
        const b = ordner(['api']);
        await ModPflichten.pruefe({ lader: 'fabric', pakete: [paket('Jade', 'jade.jar')], bestand: b, umgebung });
        const vorher = host.stand.abrufe.length;
        await ModPflichten.pruefe({ lader: 'fabric', pakete: [paket('Jade', 'jade.jar')], bestand: b, umgebung });
        assert.strictEqual(host.stand.abrufe.length, vorher);
    });

    console.log('\n▸ 3. Der Weg durch InhalteHolen');

    // Attrappen: Datenbank (daemonVon), Befehlsleitung (files.list), Abruf
    // (Maschine, Teilabruf). Der Teilabruf liefert die Jars desselben Hosts
    // unter dem Pfad, den `/datei` bekäme.
    const befehle = [];
    let daemonDa = true;
    let ordnerInhalt = [];
    ServiceManager.register('dbService', { query: async (sql) => (/FROM rootserver/.test(sql) ? [{ daemon_id: 'd-55' }] : []) });
    ServiceManager.register('ipmServer', {
        isDaemonOnline: () => daemonDa,
        sendCommand: async (id, befehl, nutzlast) => {
            befehle.push({ befehl, nutzlast });
            if (befehl !== 'gameserver.files.list') throw new Error(`unerwarteter Befehl ${befehl}`);
            return { success: true, data: { files: ordnerInhalt } };
        },
    });
    const pfadeGelesen = [];
    Abruf.maschineVon = async () => ({ host: '10.0.0.5', abruf_port: 9350, api_key: 'k', abruf_zertifikat: 'c' });
    Abruf.teilAbruf = () => ({
        abruf: (adresse, opt) => {
            const pfad = new URL(adresse).searchParams.get('pfad');
            pfadeGelesen.push(pfad);
            return host.abruf(`${CDN}${pfad.split('/').pop()}`, opt);
        },
        schliessen: () => { pfadeGelesen.push('geschlossen'); },
    });
    const InhalteHolen = require(H('InhalteHolen'));
    const server = { id: 4711, rootserver_id: 55, install_path: '4711-minecraft' };
    const inhalt = { supported: true, path: 'game/mods', sources: ['upload', 'modrinth'], source_ids: { modrinth: 'fabric' } };
    const echtPruefe = ModPflichten.pruefe;

    await pruefe('Mod-Ordner per files.list unter dem Ablageort, Jars per /datei mit /game/mods/<name>, danach geschlossen', async () => {
        ordnerInhalt = [
            { name: 'api.jar', size: FABRIC_API.length, is_dir: false, mod_time: '2026-11-13T08:00:00Z' },
            { name: 'config', size: 0, is_dir: true },
            { name: 'alt.jar.disabled', size: 5, is_dir: false },
        ];
        // Mit eigener Umgebung für die neuen Pakete: Der Host der Attrappe ist nicht cdn.modrinth.com im Netz.
        ModPflichten.pruefe = (a) => echtPruefe({ ...a, umgebung });
        const e = await InhalteHolen.pflichtenPruefen({ server, inhalt, quelle: 'modrinth', raum: 'fabric',
            pakete: [paket('Jade', 'jade.jar')] });
        assert.strictEqual(befehle[0].befehl, 'gameserver.files.list');
        assert.strictEqual(befehle[0].nutzlast.path, '/game/mods');
        assert.ok(pfadeGelesen.includes('/game/mods/api.jar'), `gelesen: ${pfadeGelesen.join(', ')}`);
        assert.ok(!pfadeGelesen.some(p => /config|disabled/.test(p)), 'Ordner oder abgeschaltete Datei gelesen');
        assert.strictEqual(pfadeGelesen[pfadeGelesen.length - 1], 'geschlossen');
        assert.deepStrictEqual(e.fehlt, []);
        assert.strictEqual(e.bestand, 1);
        assert.strictEqual(e.satz.ton, 'gut');
    });
    await pruefe('Daemon weg: geprüft wird trotzdem, der Grund steht im Satz', async () => {
        daemonDa = false;
        const e = await InhalteHolen.pflichtenPruefen({ server, inhalt, quelle: 'modrinth', raum: 'fabric',
            pakete: [paket('Jade', 'jade.jar')] });
        daemonDa = true;
        assert.deepStrictEqual(e.fehlt.map(f => f.kennung), ['fabric-api']);
        assert.match(e.satz.text, /Daemon ist gerade nicht erreichbar/);
    });
    await pruefe('Die Prüfung wirft nie: ein Fehler wird zum leisen Satz', async () => {
        ModPflichten.pruefe = async () => { throw new Error('Probefehler'); };
        const e = await InhalteHolen.pflichtenPruefen({ server, inhalt, quelle: 'modrinth', raum: 'fabric', pakete: [] });
        assert.strictEqual(e.satz.ton, 'leise');
        assert.match(e.satz.text, /Probefehler/);
    });
    ModPflichten.pruefe = echtPruefe;
    await pruefe('Nur Modrinth und Forge, NeoForge, Fabric — sonst null, ohne den Daemon zu fragen', async () => {
        const vorher = befehle.length;
        assert.strictEqual(await InhalteHolen.pflichtenPruefen({ server, inhalt, quelle: 'thunderstore', raum: 'fabric', pakete: [] }), null);
        assert.strictEqual(await InhalteHolen.pflichtenPruefen({ server, inhalt, quelle: 'modrinth', raum: 'paper', pakete: [] }), null);
        assert.strictEqual(befehle.length, vorher);
    });

    console.log('\n▸ 4. Quelltext: Einbau, Route, Anzeige');

    const holen = ohneKommentare(lies('plugins/gameserver/dashboard/helpers/InhalteHolen.js'));
    const route = ohneKommentare(lies('plugins/gameserver/dashboard/routes/inhalte.js'));
    const ansicht = lies('plugins/gameserver/dashboard/views/guild/partials/server-detail-inhalte.ejs');

    await pruefe('installiere prüft nach dem Auflösen und vor dem Ablegen, und das Ergebnis trägt es', async () => {
        const rumpf = holen.slice(holen.indexOf('async function installiere('), holen.indexOf('async function modOrdnerLesen('));
        const a = rumpf.indexOf('anbieter.aufloesen(');
        const p = rumpf.indexOf('pflichtenPruefen(');
        const l = rumpf.indexOf('legeAb(');
        assert.ok(a >= 0 && p > a && l > p, `Reihenfolge aufloesen ${a}, pflichtenPruefen ${p}, legeAb ${l}`);
        assert.match(rumpf, /ergebnis\.pflichten\s*=\s*pflichten/);
    });
    await pruefe('Die Jars kommen über Abruf.dateiAdresse und teilAbruf, nicht über die Befehlsleitung', async () => {
        const rumpf = holen.slice(holen.indexOf('async function modOrdnerLesen('), holen.indexOf('async function pflichtenPruefen('));
        assert.match(rumpf, /Abruf\.teilAbruf\(/);
        assert.match(rumpf, /Abruf\.dateiAdresse\(maschine, server\.id, `\/\$\{pfad\}\/\$\{d\.name\}`\)/);
        assert.ok(!/files\.read/.test(rumpf), 'files.read in modOrdnerLesen');
    });
    await pruefe('Route /inhalte/pflichten mit GAMESERVER.VIEW', async () => {
        assert.match(route, /router\.get\('\/:serverId\/inhalte\/pflichten', requirePermission\('GAMESERVER\.VIEW'\)/);
        assert.match(route, /InhalteHolen\.pflichten\(/);
    });
    await pruefe('Vorschau lädt die Zeile nach, das Ergebnis des Installierens meldet sie', async () => {
        assert.match(ansicht, /<div id="ts-pflichten"/);
        assert.match(ansicht, /pflichtenLaden\(kennung\);/);
        assert.match(ansicht, /\$\{BASIS\}\/pflichten\?quelle=/);
        assert.match(ansicht, /d\.pflichten && d\.pflichten\.satz && d\.pflichten\.fehlt && d\.pflichten\.fehlt\.length/);
        assert.match(ansicht, /escape\(p\.satz\.text\)/);
    });

    console.log(fehler
        ? `\n❌ ${fehler} von ${geprueft} Prüfungen rot`
        : `\n✅ Die Pflichten einzelner Mods tragen (${geprueft} Prüfungen)`);
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
