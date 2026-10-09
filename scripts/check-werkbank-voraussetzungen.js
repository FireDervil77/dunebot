#!/usr/bin/env node
/**
 * Werkbank: die Karte „Voraussetzungen" (Baustelle 175, 2026-10-09).
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 *
 * Die Karte bearbeitet den Abschnitt `requirements` — was das SPIEL vom Image
 * verlangt. Bis heute reiste er bei geöffneten Paketen nur mit, und ein neu
 * gebautes Paket konnte ihn nicht bekommen.
 *
 * Anlass (Betreiber, 2026-10-09): Core Keeper „startet, lauscht aber auf keinen
 * Port". Tatsächlich stürzte es nach 35 s mit Signal 11 ab — dem Image fehlten
 * `xvfb` und `libxi6`, und einen Bildschirm stellte niemand auf. Im Panel stand
 * „Exit 139".
 *
 * Zwei Felder verschiedener Art:
 *
 *   os_packages   erklärt. Niemand installiert daraus etwas; der Daemon ZÄHLT
 *                 am Image nach, und der Prüfdurchlauf wird rot, bevor er
 *                 installiert.
 *   display       wirkt. `virtual` geht in den Startauftrag, fb-init stellt
 *                 vor dem Spiel einen Xvfb auf.
 *
 * Die Probe ist dieselbe wie bei jeder Karte:
 *
 *   Jedes eingelieferte Paket, UNVERÄNDERT durch das Formular gespeichert,
 *   ergibt dasselbe Paket — auch eines mit `os_packages: []` (Factorio,
 *   Minecraft) und eines ganz ohne `requirements`.
 *
 * Dazu die Regeln:
 *
 *   - Ein Paketname ist ein Paketname. Die Namen gehen beim Daemon als
 *     Argumente an dpkg-query; was mit „-" beginnt, wäre dort ein Schalter.
 *   - „Nicht geprüft" ist eine eigene Auskunft: Ein Befund gilt nur für die
 *     Liste und das Image, zu denen er gehört. Ändert sich eines, zeigt die
 *     Karte weder „da" noch „fehlt".
 *   - Antwortet der Daemon nicht, ist die Liste trotzdem gespeichert — mit dem
 *     Grund, und ohne grünes Wort.
 *   - Der Probestart und der Prüfdurchlauf schicken `requirements` mit.
 *
 * Und der Vertrag mit dem Daemon: Feldnamen, der Wert `virtual` und der Befehl
 * stehen in zwei Repositories und im Schema — sie werden dort nachgelesen.
 *
 * Gelesen wird aus der Datenbank, geschrieben nichts.
 *
 *   node scripts/check-werkbank-voraussetzungen.js
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
const { ohneKommentare, ohneKommentareEjs, ohneKommentareShell } = require('./lib/quelltext');

// Die Attrappe kennt genau: das Schreiben des Entwurfs (geht ins Leere), die
// drei Fragen „läuft gerade etwas?" und die Maschine der Sitzung. Alles andere
// ist ein Fehler.
let beschaeftigt = false;
ServiceManager.register('dbService', {
    query: async (sql) => {
        const t = sql.trim();
        if (/^UPDATE werkbank_sitzungen SET entwurf = \? WHERE id = \?$/.test(t)) return {};
        if (/FROM werkbank_pruefungen p JOIN werkbank_sitzungen s[\s\S]*p\.status = 'laeuft'/.test(t)) return beschaeftigt ? [{ pruefId: 1, guildId: 'g' }] : [];
        if (/^SELECT id FROM werkbank_schritte WHERE sitzung_id = \? AND status = 'laeuft' LIMIT 1$/.test(t)) return [];
        if (/FROM werkbank_laeufe l JOIN werkbank_sitzungen s[\s\S]*l\.status <> 'beendet'/.test(t)) return [];
        if (/^SELECT daemon_id FROM rootserver WHERE id = \?$/.test(t)) return [{ daemon_id: 'd1' }];
        throw new Error(`Attrappe kennt die Abfrage nicht: ${t.slice(0, 90)}`);
    },
});
const still = () => {};
ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });

// Der Daemon der Attrappe: `antwort` ist, was er als Nächstes sagt; `gefragt`
// hält fest, was ihn erreichte. `online: false` ist die Maschine, die weg ist.
const daemon = { online: true, antwort: null, gefragt: [] };
ServiceManager.register('ipmServer', {
    isDaemonOnline: () => daemon.online,
    sendCommand: async (id, befehl, nutzlast, frist) => {
        daemon.gefragt.push({ befehl, nutzlast, frist });
        if (daemon.antwort instanceof Error) throw daemon.antwort;
        return daemon.antwort;
    },
});
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

/** Die Karte so im Formular, wie die Seite sie vorbelegt. */
const formular = (stand) => ({ os_packages: stand.pakete.map(p => p.name).join('\n'), display: stand.bildschirm ? '1' : '' });

/** Core Keeper, wie es der Betreiber am 2026-10-09 gebaut hat — noch ohne Voraussetzungen. */
function frisch(mehr = {}) {
    return { id: 7, kennung: 'wbvor', guild_id: 'g1', rootserver_id: 1, image: { ref: 'registry.firenetworks.de/fb/steamcmd', tag: '2026.09' }, entwurf: {
        identity: { slug: 'corekeeper', name: 'Core Keeper', version: '1.0.1' },
        ports: [{ purpose: 'game', protocol: 'udp', assign: 'pool' }],
        start: { program: './CoreKeeperServer', args: [{ key: 'batchmode', form: '-batchmode', from: 'fixed' }], ready_when: { port: 'game' } },
        werkbank: { portnummern: { game: 27015 }, memory_mb: 4096 },
        ...mehr,
    } };
}
/** Was der Daemon am alten Image wirklich antwortet (gemessen 2026-10-09, fb/steamcmd:2026.09). */
const BEFUND_ALT = { success: true, data: { ergebnis: {
    image: 'registry.firenetworks.de/fb/steamcmd@sha256:alt',
    pakete: [{ name: 'libxi6', vorhanden: false }, { name: 'xvfb', vorhanden: false, wegen: 'display: virtual' }],
    fehlt: ['libxi6', 'xvfb'], display_verlangt: true, display_vorhanden: false,
} } };
const BEFUND_NEU = { success: true, data: { ergebnis: {
    image: 'registry.firenetworks.de/fb/steamcmd@sha256:neu',
    pakete: [{ name: 'libxi6', vorhanden: true }, { name: 'xvfb', vorhanden: true, wegen: 'display: virtual' }],
    fehlt: [], display_verlangt: true, display_vorhanden: true,
} } };

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
    const gesehen = { pakete: 0, mit_liste: 0, mit_leerer_liste: 0, ohne: 0, namen: 0 };
    daemon.antwort = { success: false, error: 'Attrappe: kein Befund' };
    for (const [slug, paket] of neueste) {
        gesehen.pakete++;
        const r = paket.requirements;
        if (r === undefined) gesehen.ohne++;
        else if (Array.isArray(r.os_packages) && r.os_packages.length) { gesehen.mit_liste++; gesehen.namen += r.os_packages.length; }
        else if (Array.isArray(r.os_packages)) gesehen.mit_leerer_liste++;

        await pruefe(`${slug}: ${r === undefined ? 'ohne requirements' : JSON.stringify(r).slice(0, 60)} — dasselbe Paket, derselbe Fingerabdruck`, async () => {
            const vorher = kopie(paket);
            const { entwurf, image, schritte } = S.entwurfAusPaket(paket);
            entwurf.werkbank = { portnummern: S.vorlaeufigePortnummern(entwurf.ports), geoeffnet: { slug, version: paket.identity.version, ziele: S.zieleAusPaket(paket) } };
            const sitzung = { id: 1, kennung: 'wbprobe', rootserver_id: 1, entwurf, image };
            const liste = schritte.map(schritt => ({ status: 'uebernommen', schritt }));
            gleich(paket, vorher, 'das Zerlegen hat das Paket verändert');
            assert.strictEqual(entwurf.durchgereicht?.requirements, undefined, 'requirements steht noch im Durchgereichten');
            gleich(entwurf.requirements, paket.requirements, 'der Entwurf trägt nicht, was das Paket trug');
            assert.ok(!S.durchgereichteTeile(paket).some(t => /^requirements\b/.test(t)), 'die Karte „Unverändert übernommen" nennt requirements noch');

            const davor = kopie(S.entwurfAlsPaket(sitzung, liste));
            gleich(davor.requirements, paket.requirements, 'schon das Zusammensetzen ändert requirements');
            await S.voraussetzungenSpeichern(sitzung, formular(S.voraussetzungenStand(sitzung)));
            const danach = S.entwurfAlsPaket(sitzung, liste);
            gleich(danach.requirements, paket.requirements, 'unverändert gespeichert, und requirements ist anders');
            gleich(danach, davor, 'unverändert gespeichert, und das Paket ist anders');
            assert.strictEqual(S.fingerabdruck(danach), S.fingerabdruck(davor), 'der Fingerabdruck hat sich geändert — ein grüner Durchlauf gälte nicht mehr');
        });
    }
    await pruefe('gesehen wurden alle drei Sorten: mit Liste, mit leerer Liste, ganz ohne', async () => {
        assert.ok(gesehen.mit_liste > 0, 'kein Paket mit Systempaketen — die Probe hätte nichts durchs Formular geschickt');
        assert.ok(gesehen.mit_leerer_liste > 0, 'kein Paket mit os_packages: [] — der Fall „leer bleibt leer" ist ungeprüft');
        assert.ok(gesehen.ohne > 0, 'kein Paket ohne requirements — der Fall „nichts bleibt nichts" ist ungeprüft');
    });
    await pruefe('eine Sitzung aus der Zeit vor der Karte zieht beim Laden um — einmal, und nur ihr Stück', async () => {
        const einmal = S.ordne({ durchgereicht: { requirements: { os_packages: ['libxi6'], min_ram_mb: 2048 }, files: { x: 1 } } });
        gleich(einmal.requirements, { os_packages: ['libxi6'], min_ram_mb: 2048 });
        gleich(einmal.durchgereicht, { files: { x: 1 } }, 'ordne hat ein fremdes Stück angefasst');
        gleich(S.ordne(kopie(einmal)), einmal, 'ordne ist nicht wiederholbar');
    });

    // ── 2) Die Regeln ────────────────────────────────────────────────────────
    console.log('\nRegeln');
    await pruefe('Core Keeper: Liste und Bildschirm landen im Paket, wie das Schema sie will', async () => {
        const s = frisch();
        daemon.antwort = BEFUND_ALT;
        await S.voraussetzungenSpeichern(s, { os_packages: 'libxi6', display: '1' });
        gleich(S.entwurfAlsPaket(s, []).requirements, { os_packages: ['libxi6'], display: 'virtual' });
        const schema = JSON.parse(fs.readFileSync(path.join(WURZEL, 'packages/fbpkg/schema/fbpkg-v1.schema.json'), 'utf8'));
        const gilt = new Ajv({ allErrors: true }).compile(schema.properties.requirements);
        assert.ok(gilt(S.entwurfAlsPaket(s, []).requirements), JSON.stringify(gilt.errors));
        assert.ok(!gilt({ display: 'virtuell' }), 'das Schema nimmt einen unbekannten Bildschirmwert an');
        assert.ok(!gilt({ display: '' }), 'das Schema nimmt einen leeren Bildschirmwert an — die Karte lässt das Feld dann weg');
    });
    await pruefe('Trennzeichen, Doppelte und der Schalter', async () => {
        const s = frisch();
        daemon.antwort = BEFUND_ALT;
        await S.voraussetzungenSpeichern(s, { os_packages: ' libxi6,libpulse0\n\nlibxi6 ; libstdc++6\tlibc6:i386 ', display: '' });
        gleich(s.entwurf.requirements, { os_packages: ['libxi6', 'libpulse0', 'libstdc++6', 'libc6:i386'] });
        // Ausgeschaltet heisst: das Feld fehlt — nicht `display: ""`.
        await S.voraussetzungenSpeichern(s, { os_packages: 'libxi6', display: '1' });
        assert.strictEqual(s.entwurf.requirements.display, 'virtual');
        await S.voraussetzungenSpeichern(s, { os_packages: 'libxi6', display: '' });
        assert.ok(!('display' in s.entwurf.requirements), 'ausgeschaltet steht display noch im Entwurf');
    });
    await pruefe('alles geleert in einer Sitzung, die nie etwas trug: der Teil verschwindet ganz', async () => {
        const s = frisch();
        daemon.antwort = BEFUND_ALT;
        await S.voraussetzungenSpeichern(s, { os_packages: 'libxi6', display: '1' });
        await S.voraussetzungenSpeichern(s, { os_packages: '', display: '' });
        // Die Liste stand da (wir haben sie eben angelegt) und bleibt als leere stehen —
        // das ist dieselbe Regel, die Factorios `os_packages: []` erhält.
        gleich(s.entwurf.requirements, { os_packages: [] });
        const nie = frisch();
        await S.voraussetzungenSpeichern(nie, { os_packages: '', display: '' });
        assert.strictEqual(nie.entwurf.requirements, undefined, 'aus nichts wurde ein leerer Teil');
        assert.strictEqual(S.entwurfAlsPaket(nie, []).requirements, undefined);
    });
    await pruefe('was mit „-" beginnt, Leerzeichen trägt oder gross geschrieben ist, ist kein Paketname', async () => {
        for (const boese of ['--admindir=/tmp', '-W', 'LIBXI6', 'lib_xi6', 'a', 'libxi6/../x', '$(reboot)']) {
            await wirft(() => S.voraussetzungenSpeichern(frisch(), { os_packages: boese }), /kein Paketname/);
        }
        await wirft(() => S.voraussetzungenSpeichern(frisch(), { os_packages: Array.from({ length: S.VORAUSSETZUNG.max + 1 }, (_, i) => `lib${i}x`).join(' ') }), /Höchstens/);
    });
    await pruefe('was ein Paket sonst trägt (min_ram_mb, glibc), bleibt stehen und wird gezeigt', async () => {
        const s = frisch({ requirements: { os_packages: ['libxi6'], min_ram_mb: 2048, glibc: '2.31' } });
        daemon.antwort = BEFUND_ALT;
        await S.voraussetzungenSpeichern(s, { os_packages: 'libxi6 libpulse0', display: '1' });
        gleich(s.entwurf.requirements, { os_packages: ['libxi6', 'libpulse0'], min_ram_mb: 2048, glibc: '2.31', display: 'virtual' });
        gleich(S.voraussetzungenStand(s).sonstiges.map(x => x.feld).sort(), ['glibc', 'min_ram_mb']);
    });
    await pruefe('läuft ein Durchlauf, wird nicht gespeichert', async () => {
        beschaeftigt = true;
        try { await wirft(() => S.voraussetzungenSpeichern(frisch(), { os_packages: 'libxi6' }), /Prüfdurchlauf läuft/); }
        finally { beschaeftigt = false; }
    });

    // ── 3) Der Befund: da, fehlt — oder nicht geprüft ────────────────────────
    console.log('\nBefund am Image');
    await pruefe('Speichern fragt den Daemon nach genau dieser Liste an genau diesem Image', async () => {
        const s = frisch();
        daemon.gefragt.length = 0; daemon.antwort = BEFUND_ALT;
        const antwort = await S.voraussetzungenSpeichern(s, { os_packages: 'libxi6', display: '1' });
        assert.strictEqual(daemon.gefragt.length, 1);
        const f = daemon.gefragt[0];
        assert.strictEqual(f.befehl, 'werkbank.voraussetzungen');
        assert.strictEqual(f.nutzlast.sitzung_id, 'wbvor');
        gleich(f.nutzlast.requirements, { os_packages: ['libxi6'], display: 'virtual' });
        gleich(f.nutzlast.image, S.sitzungsImage ? S.sitzungsImage(s) : f.nutzlast.image);
        assert.ok(f.nutzlast.image && f.nutzlast.image.ref, 'das Image der Sitzung ging nicht mit');
        gleich(antwort, { geprueft: true, grund: null, fehlt: ['libxi6', 'xvfb'] });
    });
    await pruefe('fehlt etwas, sagt die Karte es je Zeile — und der Bildschirm gilt als nicht stellbar', async () => {
        const s = frisch();
        daemon.antwort = BEFUND_ALT;
        await S.voraussetzungenSpeichern(s, { os_packages: 'libxi6', display: '1' });
        const stand = S.voraussetzungenStand(s);
        gleich(stand.pakete, [{ name: 'libxi6', vorhanden: false }]);
        assert.strictEqual(stand.bildschirmVorhanden, false);
        gleich(stand.fehlt, ['libxi6', 'xvfb']);
        assert.strictEqual(stand.ungeprueft, null);
        assert.ok(stand.geprueftAm && stand.geprueftAn.includes('sha256:alt'), 'die Karte nennt nicht, wann und woran gezählt wurde');
    });
    await pruefe('nach dem Image-Bau neu gezählt: alles da', async () => {
        const s = frisch();
        daemon.antwort = BEFUND_ALT;
        await S.voraussetzungenSpeichern(s, { os_packages: 'libxi6', display: '1' });
        daemon.antwort = BEFUND_NEU;
        gleich(await S.voraussetzungenPruefen(s), { geprueft: true, grund: null, fehlt: [] });
        const stand = S.voraussetzungenStand(s);
        gleich(stand.pakete, [{ name: 'libxi6', vorhanden: true }]);
        assert.strictEqual(stand.bildschirmVorhanden, true);
        gleich(stand.fehlt, []);
    });
    await pruefe('ein Befund gilt nur für seine Frage: andere Liste oder anderes Image → „nicht geprüft", nie „da"', async () => {
        const s = frisch();
        daemon.antwort = BEFUND_NEU;
        await S.voraussetzungenSpeichern(s, { os_packages: 'libxi6', display: '1' });
        // Die Liste ändert sich am Speichern vorbei (etwa durch ein neu geöffnetes Paket).
        s.entwurf.requirements.os_packages.push('libpulse0');
        let stand = S.voraussetzungenStand(s);
        gleich(stand.pakete.map(p => p.vorhanden), [null, null], 'ein alter Befund färbt eine neue Liste');
        assert.strictEqual(stand.bildschirmVorhanden, null);
        assert.match(stand.ungeprueft, /geändert/);
        assert.strictEqual(stand.geprueftAm, null);
        // Dieselbe Liste, anderes Image.
        const t = frisch();
        await S.voraussetzungenSpeichern(t, { os_packages: 'libxi6', display: '1' });
        t.image = { ref: 'registry.firenetworks.de/fb/proton', tag: '2026.09-GE-Proton10-32' };
        stand = S.voraussetzungenStand(t);
        gleich(stand.pakete.map(p => p.vorhanden), [null]);
        assert.match(stand.ungeprueft, /geändert/);
    });
    await pruefe('der Daemon ist weg, kennt den Befehl nicht oder wirft: gespeichert, Grund genannt, nichts grün', async () => {
        const faelle = [
            [() => { daemon.online = false; }, /nicht erreichbar/],
            [() => { daemon.antwort = { success: false, error: 'unbekannter Befehl' }; }, /unbekannter Befehl/],
            // Ein Daemon vor 1.0.115: Der Verteiler hält den Befehl für einen
            // Gameserver-Befehl. Die Karte sagt, was los ist — nicht, was er sagte.
            [() => { daemon.antwort = { success: false, error: 'Gameserver nicht gefunden' }; }, /kennt das Nachzählen noch nicht/],
            [() => { daemon.antwort = { success: true, data: {} }; }, /keinen Befund/],
            [() => { daemon.antwort = new Error('Zeitüberschreitung'); }, /Zeitüberschreitung/],
        ];
        for (const [stelle, muster] of faelle) {
            const s = frisch();
            daemon.online = true; stelle();
            try {
                const antwort = await S.voraussetzungenSpeichern(s, { os_packages: 'libxi6', display: '1' });
                gleich(s.entwurf.requirements, { os_packages: ['libxi6'], display: 'virtual' }, 'ohne Daemon wurde die Liste nicht gespeichert');
                assert.strictEqual(antwort.geprueft, false);
                assert.match(antwort.grund, muster);
                const stand = S.voraussetzungenStand(s);
                gleich(stand.pakete.map(p => p.vorhanden), [null]);
                assert.strictEqual(stand.bildschirmVorhanden, null);
                assert.match(stand.ungeprueft, muster);
                gleich(stand.fehlt, [], 'ohne Befund behauptet die Karte, es fehle etwas');
            } finally { daemon.online = true; }
        }
    });
    await pruefe('nichts verlangt: nichts gefragt, kein Befund, keine Warnung', async () => {
        const s = frisch();
        daemon.gefragt.length = 0; daemon.antwort = BEFUND_NEU;
        gleich(await S.voraussetzungenSpeichern(s, { os_packages: '', display: '' }), { geprueft: false, grund: null, fehlt: [] });
        assert.strictEqual(daemon.gefragt.length, 0, 'für eine leere Liste wurde ein Container gestartet');
        const stand = S.voraussetzungenStand(s);
        assert.strictEqual(stand.gefragt, false);
        assert.strictEqual(stand.ungeprueft, null);
    });
    await pruefe('der Befund gehört der Sitzung, nicht dem Paket', async () => {
        const s = frisch();
        daemon.antwort = BEFUND_ALT;
        await S.voraussetzungenSpeichern(s, { os_packages: 'libxi6', display: '1' });
        assert.ok(s.entwurf.werkbank.voraussetzungen, 'der Befund liegt nicht im Werkbank-Teil');
        assert.ok(!JSON.stringify(S.entwurfAlsPaket(s, [])).includes('sha256:alt'), 'der Befund ist ins Paket gewandert');
        // Die übrigen Angaben der Sitzung überleben das Merken.
        assert.strictEqual(s.entwurf.werkbank.memory_mb, 4096);
        gleich(s.entwurf.werkbank.portnummern, { game: 27015 });
    });

    // ── 4) Der Weg zum Daemon ────────────────────────────────────────────────
    console.log('\nVertrag mit dem Daemon');
    const helfer = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/werkbank/dashboard/helpers/Sitzungen.js'), 'utf8'));
    await pruefe('Probestart und Prüfdurchlauf schicken requirements mit', async () => {
        const teile = /const LAUFZEIT_TEILE = \[([^\]]*)\]/.exec(helfer);
        assert.ok(teile && teile[1].includes("'requirements'"), 'requirements gehört nicht zu den Laufzeit-Teilen — der Probestart liefe ohne Bildschirm');
        for (const name of ['starten', 'pruefen']) {
            const rumpf = new RegExp(`async function ${name}\\(sitzung, liste\\) \\{[\\s\\S]*?\\n\\}`).exec(helfer);
            assert.ok(rumpf && /\.\.\.laufzeitTeile\(/.test(rumpf[0]), `${name}() reicht die Laufzeit-Teile nicht weiter`);
        }
        const s = frisch({ requirements: { os_packages: ['libxi6'], display: 'virtual' } });
        gleich(S.entwurfAlsPaket(s, []).requirements, { os_packages: ['libxi6'], display: 'virtual' });
    });
    await pruefe('der Daemon liest dieselben Feldnamen, kennt „virtual" und reicht es in den Auftrag', async () => {
        const paketGo = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/pkgspec/paket.go'), 'utf8'));
        const typ = /type Requirements struct \{([\s\S]*?)\n\}/.exec(paketGo);
        assert.ok(typ, 'Requirements nicht gefunden');
        const schema = JSON.parse(fs.readFileSync(path.join(WURZEL, 'packages/fbpkg/schema/fbpkg-v1.schema.json'), 'utf8'));
        for (const feld of Object.keys(schema.properties.requirements.properties)) {
            assert.ok(typ[1].includes(`json:"${feld},omitempty"`), `das Schema kennt „${feld}", der Daemon liest es nicht`);
        }
        assert.match(paketGo, /Requirements\s+Requirements\s+`json:"requirements,omitempty"`/);
        const validate = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'pkg/protocol/job_validate.go'), 'utf8'));
        const wert = /const DisplayVirtual = "([^"]+)"/.exec(validate);
        assert.ok(wert, 'DisplayVirtual nicht gefunden');
        assert.strictEqual(wert[1], S.VORAUSSETZUNG.bildschirm, 'Dashboard und Daemon nennen den Bildschirm verschieden');
        gleich(schema.properties.requirements.properties.display.enum, [wert[1]]);
        const baue = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/gameserver/auftrag/baue.go'), 'utf8'));
        assert.match(baue, /Display:\s+p\.Requirements\.Display/, 'der Auftrag bekommt den Bildschirm nicht');
        const job = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'pkg/protocol/job.go'), 'utf8'));
        assert.match(job, /Display\s+string\s+`json:"display,omitempty"`/);
    });
    await pruefe('fb-init stellt den Bildschirm vor dem Spiel auf und bricht ab, wenn er nicht steht', async () => {
        const aufseher = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'cmd/fb-init/supervisor.go'), 'utf8'));
        const lauf = /func \(s \*Supervisor\) Lauf\(\) int \{[\s\S]*?\n\}/.exec(aufseher)[0];
        const b = lauf.indexOf('s.starteBildschirm()'), st = lauf.indexOf('s.Starte()');
        assert.ok(b > 0 && st > b, 'der Bildschirm wird nicht VOR dem Spiel aufgestellt');
        assert.match(lauf.slice(b, st), /"phase": "display"[\s\S]*return 126/, 'ein fehlender Bildschirm bricht den Start nicht ab');
        const bild = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'cmd/fb-init/bildschirm.go'), 'utf8'));
        assert.match(bild, /s\.Job\.Display != protocol\.DisplayVirtual/);
        assert.match(bild, /umgebung\["DISPLAY"\] = bildschirmAnzeige\(\)/, 'das Spiel erfährt nicht, wo sein Bildschirm ist');
    });
    await pruefe('der Daemon kennt den Befehl, nimmt requirements in Start und Durchlauf an und macht den Durchlauf rot', async () => {
        const verteiler = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/websocket/client.go'), 'utf8'));
        assert.match(verteiler, /case "werkbank\.voraussetzungen":\s*c\.handleWerkbankVoraussetzungen\(/);
        // Woran das Dashboard einen Daemon OHNE den Befehl erkennt — der Satz steht dort wörtlich.
        assert.ok(verteiler.includes('"Gameserver nicht gefunden"'), 'der Verteiler antwortet auf Unbekanntes anders als das Dashboard erwartet');
        const ws = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/websocket/werkbank.go'), 'utf8'));
        assert.strictEqual((ws.match(/"requirements": &a\.Requirements/g) || []).length, 2, 'Probestart und Prüfdurchlauf lesen requirements nicht beide');
        assert.match(ws, /"werkbank\.voraussetzungen", sitzung, true, "", map\[string\]interface\{\}\{"ergebnis": e\}/, 'die Antwort heisst nicht „ergebnis" — das Dashboard läse nichts');
        const start = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/gameserver/werkbank_start.go'), 'utf8'));
        assert.match(start, /Requirements:\s+a\.Requirements/, 'der Probestart baut sein Paket ohne requirements');
        const pruef = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/gameserver/werkbank_pruefung.go'), 'utf8'));
        const v = pruef.indexOf('m.WerkbankVoraussetzungen('), inst = pruef.indexOf('m.fuehreRezeptAus(');
        assert.ok(v > 0 && inst > v, 'der Durchlauf zählt nicht VOR der Installation nach');
        const vor = ohneKommentare(fs.readFileSync(path.join(DAEMON, 'internal/gameserver/werkbank_voraussetzungen.go'), 'utf8'));
        // Dieselben Feldnamen, die `voraussetzungenPruefen` liest.
        for (const feld of ['image', 'pakete', 'fehlt', 'display_verlangt', 'display_vorhanden', 'name', 'vorhanden']) {
            assert.ok(vor.includes(`json:"${feld}`), `der Daemon nennt „${feld}" nicht`);
        }
        // Dieselbe Namensregel auf beiden Seiten.
        const regel = /osPaketName = regexp\.MustCompile\(`([^`]+)`\)/.exec(vor);
        assert.ok(regel, 'die Namensregel des Daemons nicht gefunden');
        assert.ok(helfer.includes(`const RE_OS_PAKET = /${regel[1]}/;`), 'Dashboard und Daemon prüfen Paketnamen verschieden');
    });
    await pruefe('das Image bringt mit, was der Bildschirm braucht, und sagt es', async () => {
        // Im Dockerfile steht die Begründung in Kommentaren — und nennt beide
        // Pakete. Gezählt wird die Liste, nicht der Text darüber.
        const befehle = ohneKommentareShell(fs.readFileSync(path.join(DAEMON, 'images/steamcmd/Dockerfile'), 'utf8'));
        for (const p of ['xvfb', 'libxi6']) assert.match(befehle, new RegExp(`^\\s+${p} \\\\$`, 'm'), `${p} steht nicht in der Paketliste von fb/steamcmd`);
        for (const img of ['steamcmd', 'dotnet', 'proton']) {
            const d = ohneKommentareShell(fs.readFileSync(path.join(DAEMON, 'images', img, 'Dockerfile'), 'utf8'));
            assert.match(d, /\\?"display\\?": \\?"xvfb\\?"/, `image.json von fb/${img} nennt den Bildschirm nicht`);
        }
        const abnahme = ohneKommentareShell(fs.readFileSync(path.join(DAEMON, 'images/pruefe.sh'), 'utf8'));
        assert.match(abnahme, /^\s+display\)$/m, 'die Image-Abnahme prüft den Bildschirm nicht');
    });

    // ── 5) Die Seite ─────────────────────────────────────────────────────────
    console.log('\nSeite und Routen');
    await pruefe('die Karte bekommt ihre Daten, schickt an die beiden Routen und sperrt das Speichern', async () => {
        const router = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/werkbank/dashboard/routes/guild.router.js'), 'utf8'));
        for (const k of ['voraussetzungen: Sitzungen.voraussetzungenStand(sitzung)', 'VORAUSSETZUNG: Sitzungen.VORAUSSETZUNG']) {
            assert.ok(router.includes(k), `die Ansicht bekommt „${k.split(':')[0]}" nicht`);
        }
        assert.match(router, /router\.post\('\/:kennung\/voraussetzungen', requirePermission\('WERKBANK\.BAUEN'\)/);
        assert.match(router, /router\.post\('\/:kennung\/voraussetzungen\/pruefen', requirePermission\('WERKBANK\.BAUEN'\)/);
        const ansicht = ohneKommentareEjs(fs.readFileSync(path.join(WURZEL, 'plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs'), 'utf8'));
        const von = ansicht.indexOf('id="karteVoraussetzungen"'), bis = ansicht.indexOf('data-reiter="verbindung"');
        assert.ok(von > 0 && bis > von, 'die Karte steht nicht im Reiter „Starten"');
        const karte = ansicht.slice(von, bis);
        assert.ok(karte.includes('id="formVoraussetzungen"'));
        for (const name of ['os_packages', 'display']) assert.ok(karte.includes(`name="${name}"`), `dem Formular fehlt „${name}"`);
        // An/Aus ist ein Schalter, kein Kästchen.
        assert.match(karte, /class="form-check form-switch[^"]*">\s*<input class="form-check-input" type="checkbox" name="display"/);
        assert.ok(karte.includes("beschaeftigt ? 'disabled' : ''"), 'Speichern ist nicht gesperrt, wenn etwas läuft');
        assert.ok(ansicht.includes("schicke(hier + '/voraussetzungen', "));
        assert.ok(ansicht.includes("schicke(hier + '/voraussetzungen/pruefen')"));
        // Namen kommen aus Paketen: als Text, nie als HTML. Unescaped gehen nur
        // die Hilfe-Bausteine und die drei festen Marken hinaus.
        assert.ok(karte.includes('<%= p.name %>'), 'der Paketname wird nicht gezeigt');
        const roh = [...karte.matchAll(/<%-\s*([\s\S]*?)%>/g)].map(m => m[1].trim());
        for (const r of roh) assert.ok(/^include\('werkbank-hilfe'/.test(r) || /^vorMarke\(/.test(r), `unescaped ausgegeben: ${r.slice(0, 50)}`);
        // Drei Auskünfte, drei Meldungen — „nicht geprüft" ist eine eigene.
        for (const wort of ['Fehlt im Image: ', 'nicht geprüft: ', 'Das Image trägt alles']) assert.ok(ansicht.includes(wort), `die Seite meldet „${wort}" nicht`);
    });

    console.log(`\n  · gesehen: ${Object.entries(gesehen).map(([k, n]) => `${n} ${k}`).join(', ')}`);
    console.log(fehler === 0 ? '\n✅ Voraussetzungen: bearbeitbar, am Image gezählt, und unverändert bleibt unverändert\n' : `\n❌ ${fehler} Abweichung(en)\n`);
    process.exit(fehler === 0 ? 0 : 1);
})().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
