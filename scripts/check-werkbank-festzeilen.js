#!/usr/bin/env node
/**
 * Werkbank: die Karte „Feste Zeilen in Dateien" (Baustelle 175, 2026-10-08).
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 *
 * Die Karte bearbeitet den Abschnitt `config` — was das PAKET in eine Datei
 * schreibt, im Unterschied zu einer Einstellung, die der Betreiber wählt. Bei
 * geöffneten Paketen reiste er bisher nur mit; ein neu gebautes Paket konnte
 * ihn gar nicht bekommen.
 *
 * Anlass (Betreiber, 2026-10-08): Craftopia liest seinen Port allein aus
 * `ServerSetting.ini`. Im Probestart fiel das nicht auf, weil die Nummer der
 * Sitzung zufällig die Vorgabe des Spiels war — ein echter Server mit einer
 * anderen Nummer aus dem Pool wäre nicht erreichbar gewesen.
 *
 * Die Probe ist dieselbe wie bei jeder Karte:
 *
 *   Jede feste Zeile der eingelieferten Pakete, UNVERÄNDERT durch das Formular
 *   gespeichert, ergibt dasselbe Paket — und denselben Fingerabdruck.
 *
 * Dazu die Regeln:
 *
 *   - `config` ist im Paket eine LISTE. Sie zieht als Ganzes aus dem
 *     Durchgereichten in den Entwurf und bleibt eine Liste.
 *   - Ein Verweis, den der Daemon nicht auflösen kann, ließe ihn die Zeile
 *     auslassen. Port und Einstellung muss es deshalb im Entwurf geben — beim
 *     Speichern, und solange die Zeile steht (Entfernen ist gesperrt).
 *   - Eine Datei hat ein Format.
 *   - Schreibt eine Einstellung denselben Schlüssel, sagt die Karte es.
 *   - Ein Port, den nur eine feste Zeile dem Spiel nennt, gilt als genannt.
 *
 * Und der Vertrag mit dem Daemon: Feldnamen und Formate stehen in zwei
 * Repositories und im Schema — sie werden dort nachgelesen, nicht erinnert.
 *
 * Gelesen wird aus der Datenbank, geschrieben nichts.
 *
 *   node scripts/check-werkbank-festzeilen.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const WURZEL = path.join(__dirname, '..');
const DAEMON = '/home/firedervil/firebot_daemon';
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const Ajv = require('ajv');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

// Die Attrappe kennt genau: das Schreiben des Entwurfs (geht ins Leere) und die
// drei Fragen „läuft gerade etwas?". Alles andere ist ein Fehler.
let beschaeftigt = false;
ServiceManager.register('dbService', {
    query: async (sql) => {
        const t = sql.trim();
        if (/^UPDATE werkbank_sitzungen SET entwurf = \? WHERE id = \?$/.test(t)) return {};
        if (/FROM werkbank_pruefungen p JOIN werkbank_sitzungen s[\s\S]*p\.status = 'laeuft'/.test(t)) return beschaeftigt ? [{ pruefId: 1, guildId: 'g' }] : [];
        if (/^SELECT id FROM werkbank_schritte WHERE sitzung_id = \? AND status = 'laeuft' LIMIT 1$/.test(t)) return [];
        if (/FROM werkbank_laeufe l JOIN werkbank_sitzungen s[\s\S]*l\.status <> 'beendet'/.test(t)) return [];
        throw new Error(`Attrappe kennt die Abfrage nicht: ${t.slice(0, 90)}`);
    },
});
const still = () => {};
ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });
const S = require('../plugins/werkbank/dashboard/helpers/Sitzungen');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 4).join('\n      ')}`); }
}
const j = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const kopie = (v) => JSON.parse(JSON.stringify(v));
const sortiert = (v) => Array.isArray(v) ? v.map(sortiert)
    : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortiert(v[k])])) : v;
const gleich = (a, b, was) => assert.deepStrictEqual(sortiert(a), sortiert(b), was);
const wirft = (tun, muster) => assert.rejects(tun, (e) => { assert.match(e.message, muster); return true; });

/** Eine Zeile so im Formular, wie „Bearbeiten" sie hineinlegt. */
const formular = (z) => ({ file: z.file, parser: z.parser, key: z.key, value: z.value, alt_file: z.file, alt_key: z.key });

/** Craftopia, wie es der Betreiber am 2026-10-08 gebaut hat: ein Port, den das Spiel nur aus der Datei liest. */
function frisch(mehr = {}) {
    return { id: 7, kennung: 'wbfest', guild_id: 'g1', rootserver_id: 1, image: { ref: 'fb/steam', tag: 'x' }, entwurf: {
        identity: { slug: 'probe', name: 'Probe', version: '1.0.0' },
        ports: [{ purpose: 'game', protocol: 'udp', assign: 'pool' }],
        start: { program: './Craftopia.x86_64', args: [{ key: 'batchmode', form: '-batchmode', from: 'fixed' }], ready_when: { port: 'game' } },
        settings: [
            { key: 'save_path', type: 'text', default: 'DedicatedServerSave/', apply: [{ target: 'file', file: 'ServerSetting.ini', parser: 'ini', path: 'Save.savePath' }] },
            { key: 'world_name', type: 'text', default: 'NoName', apply: [{ target: 'file', file: 'ServerSetting.ini', parser: 'ini', path: 'GameWorld.name' }] },
        ],
        werkbank: { portnummern: { game: 6587 } },
        ...mehr,
    } };
}
const PORT_ZEILE = { file: 'ServerSetting.ini', parser: 'ini', key: 'Host.port', value: '{{port:game}}' };

(async () => {
    const c = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE, dateStrings: true,
    });
    const [zeilen] = await c.query('SELECT v.fbpkg FROM package_versions v ORDER BY v.published_at, v.id');
    await c.end();
    const neueste = new Map();
    for (const z of zeilen) { const p = j(z.fbpkg); neueste.set(p.identity.slug, p); }
    assert.ok(neueste.size > 0, 'kein einziges Paket in der Datenbank — der Wächter mässe nichts');

    // ── 1) Unverändert speichern ändert nichts ───────────────────────────────
    console.log('\nBestandspakete: unverändert durch die Karte');
    const gesehen = { pakete: 0, dateien: 0, zeilen: 0, verweise: 0 };
    for (const [slug, paket] of neueste) {
        if (!Array.isArray(paket.config) || !paket.config.length) continue;
        gesehen.pakete++;
        const vorher = kopie(paket);
        const { entwurf, image, schritte } = S.entwurfAusPaket(paket);
        entwurf.werkbank = { portnummern: S.vorlaeufigePortnummern(entwurf.ports), geoeffnet: { slug, version: paket.identity.version, ziele: S.zieleAusPaket(paket) } };
        const sitzung = { id: 1, kennung: 'wbprobe', entwurf, image };
        const liste = schritte.map(schritt => ({ status: 'uebernommen', schritt }));

        await pruefe(`${slug}: die Liste liegt im Entwurf, nicht mehr im Durchgereichten — und ist eine Liste geblieben`, async () => {
            gleich(paket, vorher, 'das Zerlegen hat das Paket verändert');
            assert.strictEqual(entwurf.durchgereicht?.config, undefined, 'config steht noch im Durchgereichten');
            assert.ok(Array.isArray(entwurf.config), 'config ist im Entwurf keine Liste mehr');
            gleich(entwurf.config, paket.config);
            assert.ok(!S.durchgereichteTeile(paket).some(t => /^config\b/.test(t)), 'die Karte „Unverändert übernommen" nennt config noch');
            // Eine Sitzung aus der Zeit VOR der Karte: `ordne` zieht um, einmal.
            const einmal = S.ordne({ durchgereicht: { config: kopie(paket.config), files: { x: 1 } } });
            assert.ok(Array.isArray(einmal.config), 'ordne hat aus der Liste ein Objekt gemacht');
            gleich(einmal.config, paket.config);
            assert.strictEqual(einmal.durchgereicht?.config, undefined);
            gleich(einmal.durchgereicht, { files: { x: 1 } }, 'ordne hat ein fremdes Stück angefasst');
            gleich(S.ordne(kopie(einmal)), einmal, 'ordne ist nicht wiederholbar');
        });

        await pruefe(`${slug}: jede Zeile unverändert gespeichert — dasselbe Paket, derselbe Fingerabdruck`, async () => {
            const davor = kopie(S.entwurfAlsPaket(sitzung, liste));
            gleich(davor.config, paket.config, 'schon das Zusammensetzen ändert config');
            const stand = S.festzeilenStand(sitzung);
            for (const d of paket.config) { gesehen.dateien++; gesehen.zeilen += Object.keys(d.set).length; }
            assert.strictEqual(stand.length, paket.config.reduce((n, d) => n + Object.keys(d.set).length, 0), 'die Karte zeigt nicht jede Zeile');
            for (const z of stand) {
                if (/\{\{/.test(z.value)) gesehen.verweise++;
                await S.festzeileSpeichern(sitzung, formular(z));
            }
            const danach = S.entwurfAlsPaket(sitzung, liste);
            gleich(danach, davor, 'unverändert gespeichert, und das Paket ist ein anderes');
            assert.strictEqual(S.fingerabdruck(danach), S.fingerabdruck(davor));
            assert.deepStrictEqual(danach.config.map(d => d.file), paket.config.map(d => d.file), 'die Reihenfolge der Dateien hat sich geändert');
        });
    }
    await pruefe('es gab etwas zu messen', async () => {
        assert.ok(gesehen.pakete > 0 && gesehen.zeilen > 0 && gesehen.verweise > 0,
            `kein eingeliefertes Paket trägt config mit Verweisen (${JSON.stringify(gesehen)}) — die Probe oben liefe leer`);
    });

    // ── 2) Die Regeln ────────────────────────────────────────────────────────
    console.log('\nRegeln der Karte');
    await pruefe('eine neue Zeile steht in der Form des Pakets — und reist zum Daemon', async () => {
        const s = frisch();
        await S.festzeileSpeichern(s, PORT_ZEILE);
        gleich(s.entwurf.config, [{ file: 'ServerSetting.ini', parser: 'ini', set: { 'Host.port': '{{port:game}}' } }]);
        const paket = S.entwurfAlsPaket(s, []);
        gleich(paket.config, s.entwurf.config);
        assert.ok(S.LAUFZEIT_TEILE.includes('config'), 'Probestart und Durchlauf schicken config nicht mit');
    });
    await pruefe('der Fall Craftopia: ein Port, den nur die Datei dem Spiel nennt, gilt als genannt', async () => {
        const s = frisch();
        assert.deepStrictEqual(S.ungenutztePorts(S.entwurfAlsPaket(s, [])), ['game'], 'ohne feste Zeile müsste der Port als ungenutzt gelten');
        await S.festzeileSpeichern(s, PORT_ZEILE);
        assert.deepStrictEqual(S.ungenutztePorts(S.entwurfAlsPaket(s, [])), []);
    });
    await pruefe('zwei Zeilen einer Datei teilen sich einen Eintrag; eine Datei hat ein Format', async () => {
        const s = frisch();
        await S.festzeileSpeichern(s, PORT_ZEILE);
        await S.festzeileSpeichern(s, { file: 'ServerSetting.ini', parser: 'ini', key: 'Save.savePath', value: '/home/container/data/DedicatedServerSave/' });
        assert.strictEqual(s.entwurf.config.length, 1);
        gleich(Object.keys(s.entwurf.config[0].set), ['Host.port', 'Save.savePath']);
        await wirft(() => S.festzeileSpeichern(s, { file: 'ServerSetting.ini', parser: 'properties', key: 'x', value: '1' }), /schon als „ini" gelesen/);
        await S.festzeileSpeichern(s, { file: 'andere.properties', parser: 'properties', key: 'x', value: '' });
        assert.strictEqual(s.entwurf.config.length, 2);
        assert.strictEqual(s.entwurf.config[1].set.x, '', 'ein leerer Wert ist ein Wert');
    });
    await pruefe('doppelt geht nicht; bearbeiten ersetzt, umbenennen nimmt die alte Zeile mit', async () => {
        const s = frisch();
        await S.festzeileSpeichern(s, PORT_ZEILE);
        await wirft(() => S.festzeileSpeichern(s, { ...PORT_ZEILE, value: '1' }), /schon festgelegt/);
        await S.festzeileSpeichern(s, { ...PORT_ZEILE, value: '7777', alt_file: PORT_ZEILE.file, alt_key: PORT_ZEILE.key });
        assert.strictEqual(s.entwurf.config[0].set['Host.port'], '7777');
        await S.festzeileSpeichern(s, { ...PORT_ZEILE, key: 'Host.gamePort', alt_file: PORT_ZEILE.file, alt_key: PORT_ZEILE.key });
        gleich(s.entwurf.config, [{ file: 'ServerSetting.ini', parser: 'ini', set: { 'Host.gamePort': '{{port:game}}' } }]);
    });
    await pruefe('ein Verweis muss auflösbar sein — sonst ließe der Daemon die Zeile aus', async () => {
        const s = frisch();
        await wirft(() => S.festzeileSpeichern(s, { ...PORT_ZEILE, value: '{{game}}' }), /Den Platzhalter \{\{game\}\} gibt es nicht/);
        await wirft(() => S.festzeileSpeichern(s, { ...PORT_ZEILE, value: '{{Wert}}' }), /gibt es nicht/);
        await wirft(() => S.festzeileSpeichern(s, { ...PORT_ZEILE, value: '{{port:query}}' }), /Den Port „query" gibt es im Entwurf nicht/);
        await wirft(() => S.festzeileSpeichern(s, { ...PORT_ZEILE, value: '{{setting:nix}}' }), /Die Einstellung „nix" gibt es im Entwurf nicht/);
        await S.festzeileSpeichern(s, { ...PORT_ZEILE, key: 'a', value: '0.0.0.0:{{port:game}}' });
        await S.festzeileSpeichern(s, { ...PORT_ZEILE, key: 'b', value: '{{setting:world_name}}' });
        // content: und env: kennt nur der Daemon zur Laufzeit — sie gehen durch.
        await S.festzeileSpeichern(s, { ...PORT_ZEILE, key: 'c', value: '{{env:HOME}}/{{content:loader}}' });
        assert.strictEqual(Object.keys(s.entwurf.config[0].set).length, 3);
    });
    await pruefe('Datei, Format, Schlüssel und Wert werden geprüft', async () => {
        const s = frisch();
        await wirft(() => S.festzeileSpeichern(s, { ...PORT_ZEILE, file: '../x.ini' }), /ohne „\.\."/);
        await wirft(() => S.festzeileSpeichern(s, { ...PORT_ZEILE, file: '/etc/x.ini' }), /ohne führenden Schrägstrich/);
        await wirft(() => S.festzeileSpeichern(s, { ...PORT_ZEILE, parser: 'toml' }), /Format der Datei/);
        await wirft(() => S.festzeileSpeichern(s, { ...PORT_ZEILE, key: '' }), /gehören beide dazu/);
        await wirft(() => S.festzeileSpeichern(s, { ...PORT_ZEILE, value: 'a\nb' }), /eine Zeile/);
        await wirft(() => S.festzeileSpeichern(s, { ...PORT_ZEILE, value: 'x'.repeat(S.FESTZEILE.max.wert + 1) }), /höchstens/);
        assert.strictEqual(s.entwurf.config, undefined, 'eine abgewiesene Zeile hat den Entwurf verändert');
    });
    await pruefe('entfernen: die letzte Zeile nimmt den Teil mit; was es nicht gibt, ist ein Fehler', async () => {
        const s = frisch();
        await S.festzeileSpeichern(s, PORT_ZEILE);
        await S.festzeileSpeichern(s, { ...PORT_ZEILE, key: 'Host.bindAddress', value: '0.0.0.0' });
        await S.festzeileEntfernen(s, { file: PORT_ZEILE.file, key: 'Host.bindAddress' });
        gleich(Object.keys(s.entwurf.config[0].set), ['Host.port']);
        await wirft(() => S.festzeileEntfernen(s, { file: PORT_ZEILE.file, key: 'gibtsnicht' }), /gibt es im Entwurf nicht/);
        await S.festzeileEntfernen(s, { file: PORT_ZEILE.file, key: 'Host.port' });
        assert.strictEqual(s.entwurf.config, undefined);
        assert.strictEqual(S.entwurfAlsPaket(s, []).config, undefined, 'ein leerer Teil kommt ins Paket');
    });
    await pruefe('woran eine feste Zeile hängt, lässt sich nicht entfernen', async () => {
        const s = frisch();
        await S.festzeileSpeichern(s, PORT_ZEILE);
        await S.festzeileSpeichern(s, { ...PORT_ZEILE, key: 'GameWorld.name', value: '{{setting:world_name}}' });
        await wirft(() => S.portEntfernen(s, 'game'), /hängt noch die feste Zeile ServerSetting\.ini → Host\.port/);
        await wirft(() => S.einstellungEntfernen(s, 'world_name'), /verweist auf „world_name"/);
        await S.einstellungEntfernen(s, 'save_path');
        assert.ok(!s.entwurf.settings.some(x => x.key === 'save_path'));
    });
    await pruefe('schreibt eine Einstellung denselben Schlüssel, nennt die Karte sie', async () => {
        const s = frisch();
        await S.festzeileSpeichern(s, PORT_ZEILE);
        await S.festzeileSpeichern(s, { ...PORT_ZEILE, key: 'Save.savePath', value: '/home/container/data/DedicatedServerSave/' });
        const stand = S.festzeilenStand(s);
        gleich(stand.find(z => z.key === 'Host.port').ueberschreibt, []);
        gleich(stand.find(z => z.key === 'Save.savePath').ueberschreibt, ['save_path']);
    });
    await pruefe('die ersten zwei Vertipper in der Karte fallen auf: Dateiname und doppelter Verweis (Betreiber, 2026-10-08)', async () => {
        const s = frisch();
        await wirft(() => S.festzeileSpeichern(s, { ...PORT_ZEILE, value: '{{port:game}}{{port:game}}' }), /zweimal hintereinander/);
        // Zweimal derselbe Verweis mit etwas dazwischen ist gemeint.
        await S.festzeileSpeichern(s, { ...PORT_ZEILE, key: 'Host.beide', value: '{{port:game}},{{port:game}}' });
        // Ein fast gleicher Dateiname wird gespeichert — und an der Zeile genannt.
        await S.festzeileSpeichern(s, { ...PORT_ZEILE, file: 'ServerSettings.ini' });
        await S.festzeileSpeichern(s, { file: 'serversetting.INI'.toLowerCase(), parser: 'ini', key: 'a', value: '1' });
        await S.festzeileSpeichern(s, { file: 'ganz/anders.cfg', parser: 'ini', key: 'a', value: '1' });
        const stand = S.festzeilenStand(s);
        const zu = (datei) => stand.find(z => z.file === datei).aehnlich;
        assert.strictEqual(zu('ServerSettings.ini'), 'ServerSetting.ini');
        assert.strictEqual(zu('serversetting.ini'), 'ServerSetting.ini', 'Gross-/Kleinschreibung: unter Linux eine andere Datei');
        assert.strictEqual(zu('ServerSetting.ini'), null, 'die richtige Datei gilt als Tippfehler');
        assert.strictEqual(zu('ganz/anders.cfg'), null);
        const ansicht = ohneKommentareEjs(fs.readFileSync(path.join(WURZEL, 'plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs'), 'utf8'));
        assert.match(ansicht, /if \(z\.aehnlich\) \{ %>[\s\S]{0,200}Tippfehler\?/, 'die Karte zeigt den Verdacht nicht');
        assert.ok(!/id="fzWert"[^>]*placeholder="\{\{/.test(ansicht), 'der Platzhalter des Wertfelds sieht aus wie ein eingetragener Verweis');
    });
    await pruefe('solange etwas läuft, ändert die Karte nichts', async () => {
        const s = frisch();
        beschaeftigt = true;
        try {
            await wirft(() => S.festzeileSpeichern(s, PORT_ZEILE), /Prüfdurchlauf läuft/);
            await wirft(() => S.festzeileEntfernen(s, { file: 'a', key: 'b' }), /Prüfdurchlauf läuft/);
        } finally { beschaeftigt = false; }
        assert.strictEqual(s.entwurf.config, undefined);
    });
    await pruefe('eine feste Zeile ändert den Fingerabdruck — der grüne Durchlauf davor gilt nicht mehr', async () => {
        const s = frisch();
        const davor = S.fingerabdruck(S.entwurfAlsPaket(s, []));
        await S.festzeileSpeichern(s, PORT_ZEILE);
        assert.notStrictEqual(S.fingerabdruck(S.entwurfAlsPaket(s, [])), davor);
    });
    await pruefe('Veröffentlichen eines neu gebauten Pakets: ein Bestand mit config und eine Sitzung ohne — das fällt auf', async () => {
        const quelle = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/werkbank/dashboard/helpers/Sitzungen.js'), 'utf8'));
        assert.match(quelle, /if \(Array\.isArray\(alt\[k\]\)\) \{\s*if \(alt\[k\]\.length && paket\[k\] === undefined && !vonHier\) fehlt\.push\(k\);/,
            'die Verlustprüfung beim Veröffentlichen kennt die Liste nicht');
    });

    // ── 3) Der Vertrag: Schema und Daemon ────────────────────────────────────
    console.log('\nVertrag mit Schema und Daemon');
    const schema = JSON.parse(fs.readFileSync(path.join(WURZEL, 'packages/fbpkg/schema/fbpkg-v1.schema.json'), 'utf8'));
    await pruefe('die Formate der Karte sind die des Schemas', async () => {
        gleich([...S.FESTZEILE.parser].sort(), [...schema.properties.config.items.properties.parser.enum].sort());
    });
    await pruefe('was die Karte schreibt, besteht das Schema', async () => {
        const s = frisch();
        await S.festzeileSpeichern(s, PORT_ZEILE);
        await S.festzeileSpeichern(s, { file: 'config/a b.properties', parser: 'properties', key: 'server-port', value: '{{port:game}}' });
        const gilt = new Ajv({ allErrors: true }).compile(schema.properties.config);
        assert.ok(gilt(S.entwurfAlsPaket(s, []).config), JSON.stringify(gilt.errors));
    });
    await pruefe('der Daemon liest dieselben Feldnamen und setzt Verweise ein', async () => {
        const paketGo = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/pkgspec/paket.go'), 'utf8'));
        const typ = /type ConfigDatei struct \{([\s\S]*?)\n\}/.exec(paketGo);
        assert.ok(typ, 'ConfigDatei nicht gefunden');
        for (const feld of ['file', 'parser', 'set']) assert.ok(typ[1].includes(`json:"${feld}"`), `der Daemon liest „${feld}" nicht`);
        assert.match(paketGo, /Config\s+\[\]ConfigDatei\s+`json:"config,omitempty"`/);
        const baue = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/gameserver/auftrag/baue.go'), 'utf8'));
        assert.match(baue, /for _, datei := range p\.Config \{[\s\S]*?pkgspec\.ErsetzeVerweise\(datei\.Set\[k\]/, 'der Daemon setzt in config keine Verweise mehr ein');
    });

    // ── 4) Die Seite ─────────────────────────────────────────────────────────
    console.log('\nSeite und Routen');
    await pruefe('die Karte bekommt ihre Daten, schickt an die beiden Routen und sperrt ihre Knöpfe', async () => {
        const router = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/werkbank/dashboard/routes/guild.router.js'), 'utf8'));
        for (const k of ['festzeilen: Sitzungen.festzeilenStand(sitzung)', 'FESTZEILE: Sitzungen.FESTZEILE']) {
            assert.ok(router.includes(k), `die Ansicht bekommt „${k.split(':')[0]}" nicht`);
        }
        assert.match(router, /router\.post\('\/:kennung\/festzeilen', requirePermission\('WERKBANK\.BAUEN'\)/);
        assert.match(router, /router\.post\('\/:kennung\/festzeilen\/entfernen', requirePermission\('WERKBANK\.BAUEN'\)/);
        const ansicht = ohneKommentareEjs(fs.readFileSync(path.join(WURZEL, 'plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs'), 'utf8'));
        // Die nächste Karte im Reiter ist seit dem 2026-10-09 „Mods" — bis dorthin reicht diese.
        const von = ansicht.indexOf('id="karteFestzeilen"'), bis = ansicht.indexOf('id="karteMods"');
        assert.ok(von > 0 && bis > von, 'die Karte steht nicht vor der Karte „Mods"');
        assert.ok(ansicht.indexOf('id="karteHinweise"') > bis, 'die Hinweise stehen nicht mehr hinter den Karten des Reiters');
        const karte = ansicht.slice(von, bis);
        assert.ok(karte.includes('id="formFestzeile"'));
        for (const name of ['alt_file', 'alt_key', 'file', 'parser', 'key', 'value']) assert.ok(karte.includes(`name="${name}"`), `dem Formular fehlt „${name}"`);
        assert.strictEqual((karte.match(/beschaeftigt \? 'disabled' : ''/g) || []).length, 3, 'Bearbeiten, Entfernen und Speichern sind nicht alle gesperrt, wenn etwas läuft');
        assert.ok(ansicht.includes("schicke(hier + '/festzeilen', "));
        assert.ok(ansicht.includes("schicke(hier + '/festzeilen/entfernen', z)"));
        // Der Wert wird als Text gezeigt, nie als HTML — er kommt aus Paketen.
        assert.ok(karte.includes('<%= z.value %>') && !/<%-\s*z\./.test(karte), 'ein Wert aus dem Paket wird unescaped ausgegeben');
    });

    console.log(`\n  · gesehen: ${Object.entries(gesehen).map(([k, n]) => `${n} ${k}`).join(', ')}`);
    console.log(fehler === 0 ? '\n✅ Feste Zeilen: bearbeitbar, geprüft, und unverändert bleibt unverändert\n' : `\n❌ ${fehler} Abweichung(en)\n`);
    process.exit(fehler === 0 ? 0 : 1);
})().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
