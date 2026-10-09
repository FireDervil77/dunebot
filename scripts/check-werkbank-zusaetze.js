#!/usr/bin/env node
/**
 * Werkbank: die Karten „Nach der Installation" und „Konsolenfilter" (2026-10-09).
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 *
 * Betreiber, 2026-10-09, mit Valheim als Beleg: Auch `console` und die Zusätze
 * von `install` standen noch unter „Unverändert übernommen".
 *
 *   install.entfernen   der Daemon löscht diese Namen in game/, nach allen
 *                       Schritten und nach jedem Update
 *   install.cache       `steam_depot: false` nimmt SteamCMD den geteilten Ordner
 *   console.noise       fb-init kennzeichnet passende Zeilen als Rauschen
 *
 * Die Probe ist dieselbe wie bei jeder Karte: Jedes eingelieferte Paket,
 * UNVERÄNDERT durch beide Formulare gespeichert, ergibt dasselbe Paket mit
 * derselben Prüfsumme.
 *
 * Dazu, was beim Tippen abgewiesen wird. Bei `entfernen` ist das dieselbe Regel
 * wie im Daemon (pkgspec.PruefeEntfernen) — dort wird gelöscht, hier soll der
 * Fehler kommen, bevor ein Durchlauf rot wird. Beim Konsolenfilter: was Go
 * (RE2) nicht kann, und ein Muster, das jede Zeile träfe.
 *
 * Gelesen wird aus der Datenbank, geschrieben nichts.
 *
 *   node scripts/check-werkbank-zusaetze.js
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
const lies = (...teile) => fs.readFileSync(path.join(...teile), 'utf8');

/** Beide Karten so im Formular, wie die Seite sie vorbelegt. */
const formularInstall = (stand) => ({ entfernen: stand.entfernen.join('\n'), steam_depot: stand.depotCache ? '1' : '' });
const formularFilter = (stand) => ({ noise: stand.muster.map(m => m.muster).join('\n') });

function frisch(mehr = {}) {
    return { id: 7, kennung: 'wbzu', guild_id: 'g1', rootserver_id: 1, image: { ref: 'registry.firenetworks.de/fb/steamcmd', tag: '2026.10' }, entwurf: {
        identity: { slug: 'probe', name: 'Probe', version: '1.0.0' },
        ports: [{ purpose: 'game', protocol: 'udp', assign: 'pool' }],
        start: { program: './Server', args: [], ready_when: { port: 'game' } },
        werkbank: { portnummern: { game: 27015 } },
        ...mehr,
    } };
}

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
    const schema = JSON.parse(lies(WURZEL, 'packages/fbpkg/schema/fbpkg-v1.schema.json'));
    const ajv = new Ajv({ allErrors: true });
    const teil = (name) => ajv.compile({ ...schema.properties[name], definitions: schema.definitions });
    const giltInstall = teil('install'), giltConsole = teil('console');

    // ── 1) Unverändert speichern ändert nichts ───────────────────────────────
    console.log('\nBestandspakete: unverändert durch beide Karten');
    const gesehen = { pakete: 0, mit_entfernen: 0, mit_cache: 0, mit_filter: 0, ohne_alles: 0 };
    for (const [slug, paket] of neueste) {
        gesehen.pakete++;
        const i = paket.install || {}, k = paket.console;
        if (Array.isArray(i.entfernen)) gesehen.mit_entfernen++;
        if (i.cache !== undefined) gesehen.mit_cache++;
        if (Array.isArray(k?.noise)) gesehen.mit_filter++;
        if (!Array.isArray(i.entfernen) && i.cache === undefined && k === undefined) gesehen.ohne_alles++;

        await pruefe(`${slug}: dasselbe Paket, derselbe Fingerabdruck`, async () => {
            const vorher = kopie(paket);
            const { entwurf, image, schritte } = S.entwurfAusPaket(paket);
            entwurf.werkbank = { portnummern: S.vorlaeufigePortnummern(entwurf.ports), geoeffnet: { slug, version: paket.identity.version, ziele: S.zieleAusPaket(paket) } };
            const sitzung = { id: 1, kennung: 'wbprobe', rootserver_id: 1, entwurf, image };
            const liste = schritte.map(schritt => ({ status: 'uebernommen', schritt }));
            gleich(paket, vorher, 'das Zerlegen hat das Paket verändert');

            const d = entwurf.durchgereicht || {};
            assert.strictEqual(d.install, undefined, 'die Zusätze der Installation stehen noch im Durchgereichten');
            assert.strictEqual(d.console, undefined, 'console steht noch im Durchgereichten');
            gleich(entwurf.install?.entfernen, i.entfernen, 'der Entwurf trägt die Aufräumliste des Pakets nicht');
            gleich(entwurf.install?.cache, i.cache, 'der Entwurf trägt die Angabe zum Zwischenspeicher nicht');
            gleich(entwurf.console, k, 'der Entwurf trägt den Konsolenfilter des Pakets nicht');
            assert.ok(!S.durchgereichteTeile(paket).some(t => /^console\b/.test(t)), '„Unverändert übernommen" nennt console noch');

            const standI = S.nachInstallationStand(sitzung), standK = S.konsolenfilterStand(sitzung, []);
            gleich(standI.entfernen, i.entfernen || []);
            assert.strictEqual(standI.depotCache, i.cache?.steam_depot !== false);
            gleich(standK.muster.map(m => m.muster), k?.noise || []);
            for (const m of standK.muster) assert.strictEqual(m.treffer, null, 'ohne Probestart ist nichts gezählt — und das ist nicht „0"');

            const davor = kopie(S.entwurfAlsPaket(sitzung, liste));
            gleich(davor.install, paket.install, 'schon das Zusammensetzen ändert install');
            gleich(davor.console, paket.console, 'schon das Zusammensetzen ändert console');
            await S.nachInstallationSpeichern(sitzung, formularInstall(standI));
            await S.konsolenfilterSpeichern(sitzung, formularFilter(standK));
            const danach = S.entwurfAlsPaket(sitzung, liste);
            gleich(danach, davor, 'unverändert gespeichert, und das Paket ist anders');
            assert.strictEqual(S.fingerabdruck(danach), S.fingerabdruck(davor), 'der Fingerabdruck hat sich geändert — ein grüner Durchlauf gälte nicht mehr');
        });
    }
    await pruefe('gesehen wurden alle Sorten: Aufräumliste, Zwischenspeicher, Filter — und ein Paket ganz ohne', async () => {
        assert.ok(gesehen.mit_entfernen > 0, 'kein Paket mit install.entfernen');
        assert.ok(gesehen.mit_cache > 0, 'kein Paket mit install.cache');
        assert.ok(gesehen.mit_filter > 0, 'kein Paket mit console.noise');
        assert.ok(gesehen.ohne_alles > 0, 'kein Paket ohne die drei Stücke — „nichts bleibt nichts" ist ungeprüft');
    });
    await pruefe('eine Sitzung aus der Zeit vor den Karten zieht beim Laden um — einmal', async () => {
        const einmal = S.ordne({ durchgereicht: { install: { cache: { steam_depot: true }, entfernen: ['docker'] }, console: { noise: ['^x$'] }, content: { a: 1 } } });
        gleich(einmal.install, { cache: { steam_depot: true }, entfernen: ['docker'] });
        gleich(einmal.console, { noise: ['^x$'] });
        gleich(einmal.durchgereicht, { content: { a: 1 } }, 'ordne hat ein fremdes Stück angefasst oder eines mit Karte liegen lassen');
        gleich(S.ordne(kopie(einmal)), einmal, 'ordne ist nicht wiederholbar');
    });
    await pruefe('der Daemon bekommt beides: die Schritte tragen die Zusätze, `console` ist ein Laufzeit-Teil', async () => {
        const s = frisch();
        await S.nachInstallationSpeichern(s, { entfernen: 'docker', steam_depot: '' });
        await S.konsolenfilterSpeichern(s, { noise: '^Rauschen' });
        const paket = S.entwurfAlsPaket(s, [{ status: 'ok', schritt: { type: 'mkdir', path: 'x' } }]);
        gleich(paket.install, { steps: [{ type: 'mkdir', path: 'x' }], entfernen: ['docker'], cache: { steam_depot: false } });
        gleich(paket.console, { noise: ['^Rauschen'] });
        assert.ok(S.LAUFZEIT_TEILE.includes('console'));
    });

    // ── 2) Nach der Installation ─────────────────────────────────────────────
    console.log('\nNach der Installation');
    await pruefe('Liste und Schalter landen im Paket, wie das Schema sie will', async () => {
        const s = frisch();
        await S.nachInstallationSpeichern(s, { entfernen: ' docker \n\nchangelog.txt\ndocker\nstart_server*.sh', steam_depot: '1' });
        gleich(s.entwurf.install, { entfernen: ['docker', 'changelog.txt', 'start_server*.sh'] }, 'eingeschaltet ist die Vorgabe — sie wird nicht eigens hingeschrieben');
        await S.nachInstallationSpeichern(s, { entfernen: 'docker', steam_depot: '' });
        gleich(s.entwurf.install, { entfernen: ['docker'], cache: { steam_depot: false } });
        assert.strictEqual(S.nachInstallationStand(s).depotCache, false);
        assert.ok(giltInstall({ steps: [{ type: 'mkdir', path: 'x' }], ...s.entwurf.install }), JSON.stringify(giltInstall.errors));
        // Wieder eingeschaltet: Die Angabe stand da und wird umgestellt, nicht gelöscht.
        await S.nachInstallationSpeichern(s, { entfernen: 'docker', steam_depot: '1' });
        gleich(s.entwurf.install.cache, { steam_depot: true });
    });
    await pruefe('alles geleert in einer Sitzung, die nie etwas trug: der Teil verschwindet ganz', async () => {
        const s = frisch();
        await S.nachInstallationSpeichern(s, { entfernen: '', steam_depot: '1' });
        assert.ok(!('install' in s.entwurf), 'ein leeres Formular hat einen leeren Teil angelegt');
    });
    await pruefe('abgewiesen wird dasselbe wie im Daemon — dort wird gelöscht', async () => {
        const s = frisch();
        const mit = (entfernen) => S.nachInstallationSpeichern(s, { entfernen, steam_depot: '1' });
        await wirft(() => mit('docker/beispiel'), /ohne Schrägstrich/);
        await wirft(() => mit('docker\\beispiel'), /ohne Schrägstrich/);
        await wirft(() => mit('..'), /aus game\/ heraus/);
        await wirft(() => mit('a..b'), /aus game\/ heraus/);
        await wirft(() => mit('*'), /ganze Installation löschen/);
        await wirft(() => mit('*.sh*'), /höchstens ein/);
        await wirft(() => mit('x'.repeat(S.NACHINSTALL.max.zeichen + 1)), /höchstens/);
        await wirft(() => mit(Array.from({ length: S.NACHINSTALL.max.eintraege + 1 }, (_, n) => `d${n}`).join('\n')), /höchstens/);
        assert.ok(!('install' in s.entwurf), 'ein abgewiesenes Formular hat trotzdem etwas gespeichert');
        // Die Regeln des Daemons stehen dort als fünf Fälle — jeder hat hier sein Gegenstück.
        const go = /func PruefeEntfernen\(eintraege \[\]string\) \[\]string \{([\s\S]*?)\n\}/.exec(ohneKommentare(lies(DAEMON, 'internal/pkgspec/install.go')));
        assert.ok(go, 'pkgspec.PruefeEntfernen nicht gefunden');
        assert.strictEqual((go[1].match(/\bcase /g) || []).length, 5, 'der Daemon prüft install.entfernen anders als bisher — die Karte muss nachziehen');
        for (const stueck of ['strings.ContainsAny(e, `/\\`)', 'strings.Contains(e, "..")', 'strings.Count(e, "*") > 1', 'e == "*"']) {
            assert.ok(go[1].includes(stueck), `der Daemon prüft nicht mehr „${stueck}"`);
        }
        // Und was das Schema annimmt, nimmt die Karte an (und umgekehrt für die Verbote).
        const muster = new RegExp(schema.properties.install.properties.entfernen.items.pattern);
        for (const gut of ['docker', 'Valheim Dedicated Server Manual.pdf', 'start_server*.sh']) assert.ok(muster.test(gut));
        for (const schlecht of ['*', 'a/b', 'a..b']) assert.ok(!muster.test(schlecht), `das Schema nimmt „${schlecht}" an`);
        await mit('docker\nValheim Dedicated Server Manual.pdf\nstart_server*.sh');
        assert.strictEqual(s.entwurf.install.entfernen.length, 3);
    });
    await pruefe('der Daemon liest beide Felder unter diesen Namen', async () => {
        const go = ohneKommentare(lies(DAEMON, 'internal/pkgspec/install.go'));
        assert.match(go, /Entfernen \[\]string `json:"entfernen,omitempty"`/);
        assert.match(go, /Cache Cache\s+`json:"cache,omitempty"`/);
        assert.match(go, /SteamDepot \*bool `json:"steam_depot,omitempty"`/);
        assert.match(go, /return c\.SteamDepot == nil \|\| \*c\.SteamDepot/, 'fehlt die Angabe, gilt sie nicht mehr als eingeschaltet — der Schalter der Karte zeigt dann das Falsche');
        assert.match(ohneKommentare(lies(DAEMON, 'internal/gameserver/rezept/rezept.go')), /raeumeAuf\(p\.Install\.Entfernen,/);
        assert.match(ohneKommentare(lies(DAEMON, 'internal/gameserver/rezept/steamcmd.go')), /p\.Install\.Cache\.DepotCache\(\)/);
    });

    // ── 3) Konsolenfilter ────────────────────────────────────────────────────
    console.log('\nKonsolenfilter');
    await pruefe('Muster landen im Paket, wie das Schema sie will — und leer verschwindet', async () => {
        const s = frisch();
        await S.konsolenfilterSpeichern(s, { noise: ' ^\\(Filename:.*Line:\\s+\\d+\\)$ \n\n(?i)shader warning\n^\\(Filename:.*Line:\\s+\\d+\\)$' });
        gleich(s.entwurf.console, { noise: ['^\\(Filename:.*Line:\\s+\\d+\\)$', '(?i)shader warning'] });
        assert.ok(giltConsole(s.entwurf.console), JSON.stringify(giltConsole.errors));
        const neu = frisch();
        await S.konsolenfilterSpeichern(neu, { noise: '' });
        assert.ok(!('console' in neu.entwurf), 'ein leeres Formular hat einen leeren Teil angelegt');
        // Eine Liste, die da war, bleibt als leere stehen.
        await S.konsolenfilterSpeichern(s, { noise: '' });
        gleich(s.entwurf.console, { noise: [] });
    });
    await pruefe('abgewiesen: was Go (RE2) nicht kann, was kein Ausdruck ist, und was jede Zeile träfe', async () => {
        const s = frisch();
        const mit = (noise) => S.konsolenfilterSpeichern(s, { noise });
        await wirft(() => mit('foo(?=bar)'), /Vor- oder Rückschau/);
        await wirft(() => mit('foo(?!bar)'), /Vor- oder Rückschau/);
        await wirft(() => mit('(?<=foo)bar'), /Vor- oder Rückschau/);
        await wirft(() => mit('(?<!foo)bar'), /Vor- oder Rückschau/);
        await wirft(() => mit('(a)\\1'), /Rückverweis/);
        await wirft(() => mit('(unvollständig'), /kein gültiger regulärer Ausdruck/);
        for (const alles of ['.*', '^', 'x*', '(?i).*', '^\\s*$']) await wirft(() => mit(alles), /träfe jede Zeile/);
        await wirft(() => mit('x'.repeat(S.KONSOLENFILTER.max.zeichen + 1)), /höchstens/);
        await wirft(() => mit(Array.from({ length: S.KONSOLENFILTER.max.muster + 1 }, (_, n) => `m${n}`).join('\n')), /höchstens/);
        assert.ok(!('console' in s.entwurf), 'ein abgewiesenes Formular hat trotzdem etwas gespeichert');
        // Ein maskierter Rückstrich vor einer Ziffer ist kein Rückverweis.
        await mit('pfad\\\\1x');
        gleich(s.entwurf.console.noise, ['pfad\\\\1x']);
    });
    await pruefe('gezählt wird an der Konsole des letzten Probestarts — ohne die Marke von fb-init, ohne Leerzeilen', async () => {
        const s = frisch({ console: { noise: ['^\\(Filename:.*Line:\\s+\\d+\\)$', '(?i)SHADER', 'kommt nie vor'] } });
        const marke = S.KONSOLENFILTER.marke;
        const konsole = ['Server gestartet', `${marke}(Filename: a.cpp Line: 12)`, '', '(Filename: b.cpp Line: 7)', 'Shader geladen', '   '].join('\n');
        const stand = S.konsolenfilterStand(s, [{ konsole }, { konsole: '(Filename: alt.cpp Line: 1)' }]);
        assert.strictEqual(stand.zeilen, 4, 'Leerzeilen zählen mit, oder ein älterer Lauf wurde mitgezählt');
        gleich(stand.muster.map(m => m.treffer), [2, 1, 0]);
        // Kein Probestart: nicht gezählt — nicht „0 Treffer".
        const ohne = S.konsolenfilterStand(s, []);
        assert.strictEqual(ohne.zeilen, null);
        gleich(ohne.muster.map(m => m.treffer), [null, null, null]);
        // Ein Muster aus einem Paket, das sich hier nicht übersetzen lässt, bleibt stehen und zählt nicht.
        const fremd = frisch({ console: { noise: ['(?P<name>x)\\z'] } });
        gleich(S.konsolenfilterStand(fremd, [{ konsole }]).muster, [{ muster: '(?P<name>x)\\z', treffer: null }]);
    });
    await pruefe('fb-init: dieselbe Marke, und ein ungültiges Muster fällt dort hörbar weg', async () => {
        const go = lies(DAEMON, 'cmd/fb-init/output.go');
        const m = /const NoiseMarke = "((?:\\x[0-9a-f]{2}|[^"\\])*)"/.exec(ohneKommentare(go));
        assert.ok(m, 'NoiseMarke nicht gefunden');
        const marke = m[1].replace(/\\x([0-9a-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
        assert.strictEqual(marke, S.KONSOLENFILTER.marke, 'fb-init kennzeichnet Rauschen anders — die Zählung der Karte läge daneben');
        assert.match(ohneKommentare(go), /regexp\.Compile\(a\)/);
        assert.match(ohneKommentare(lies(DAEMON, 'internal/gameserver/auftrag/baue.go')), /Noise: p\.Console\.Noise/);
        assert.match(ohneKommentare(lies(DAEMON, 'internal/pkgspec/paket.go')), /Noise \[\]string `json:"noise,omitempty"`/);
    });
    await pruefe('läuft etwas, wird nichts gespeichert', async () => {
        const s = frisch();
        beschaeftigt = true;
        try {
            await wirft(() => S.nachInstallationSpeichern(s, { entfernen: 'docker', steam_depot: '1' }), /Prüfdurchlauf läuft/);
            await wirft(() => S.konsolenfilterSpeichern(s, { noise: '^x' }), /Prüfdurchlauf läuft/);
        } finally { beschaeftigt = false; }
        assert.ok(!('install' in s.entwurf) && !('console' in s.entwurf));
    });

    // ── 4) Routen und Ansicht ────────────────────────────────────────────────
    console.log('\nRouten und Ansicht');
    await pruefe('zwei Routen mit dem Recht zu bauen, und die Seite bekommt beide Stände', async () => {
        const router = ohneKommentare(lies(WURZEL, 'plugins/werkbank/dashboard/routes/guild.router.js'));
        assert.match(router, /router\.post\('\/:kennung\/nachinstallation', requirePermission\('WERKBANK\.BAUEN'\)/);
        assert.match(router, /router\.post\('\/:kennung\/konsolenfilter', requirePermission\('WERKBANK\.BAUEN'\)/);
        assert.match(router, /nachInstallation: Sitzungen\.nachInstallationStand\(sitzung\)/);
        assert.match(router, /konsolenfilter: Sitzungen\.konsolenfilterStand\(sitzung, laeufe\)/, 'ohne die Läufe wird nichts gezählt');
    });
    await pruefe('die Karten stehen in ihren Reitern, ohne rohes HTML, und sagen, was nicht gezählt ist', async () => {
        const ansicht = ohneKommentareEjs(lies(WURZEL, 'plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs'));
        const ausschnitt = (id, bisMarke) => {
            const von = ansicht.indexOf(`id="${id}"`), bis = ansicht.indexOf(bisMarke, von);
            assert.ok(von > 0 && bis > von, `die Karte ${id} ist nicht zu finden`);
            return ansicht.slice(von, bis);
        };
        const a = ausschnitt('karteNachInstallation', 'data-reiter="starten"');
        assert.ok(ansicht.indexOf('id="karteNachInstallation"') > ansicht.indexOf('data-reiter="aufbauen"'));
        for (const name of ['entfernen', 'steam_depot']) assert.ok(a.includes(`name="${name}"`), `dem Formular fehlt „${name}"`);
        // An/Aus ist ein Schalter, kein Kästchen.
        assert.match(a, /class="form-check form-switch[^"]*">\s*<input class="form-check-input" type="checkbox" name="steam_depot"/);
        const b = ausschnitt('karteKonsolenfilter', 'data-reiter="verbindung"');
        assert.ok(b.includes('name="noise"'));
        assert.ok(b.includes('<%= m.muster %>'), 'das Muster wird nicht als Text gezeigt');
        assert.ok(b.includes('m.treffer === null') && b.includes('nicht gezählt'), '„nicht gezählt" hat keine eigene Marke');
        assert.ok(b.includes('trifft keine Zeile'), 'ein Muster ohne Treffer fällt nicht auf');
        for (const karte of [a, b]) {
            assert.ok(karte.includes("beschaeftigt ? 'disabled' : ''"), 'Speichern ist nicht gesperrt, wenn etwas läuft');
            const roh = [...karte.matchAll(/<%-\s*([\s\S]*?)%>/g)].map(m => m[1].trim());
            for (const r of roh) assert.ok(/^include\('werkbank-hilfe'/.test(r), `unescaped ausgegeben: ${r.slice(0, 50)}`);
        }
        assert.ok(ansicht.includes("einfachesFormular('formNachInstallation', '/nachinstallation'"));
        assert.ok(ansicht.includes("einfachesFormular('formKonsolenfilter', '/konsolenfilter'"));
    });

    console.log(`\n  · gesehen: ${Object.entries(gesehen).map(([k, n]) => `${n} ${k}`).join(', ')}`);
    console.log(fehler === 0 ? '\n✅ Nach der Installation und Konsolenfilter: bearbeitbar, und unverändert bleibt unverändert\n' : `\n❌ ${fehler} Abweichung(en)\n`);
    process.exit(fehler === 0 ? 0 : 1);
})().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
