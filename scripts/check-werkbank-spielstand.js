#!/usr/bin/env node
/**
 * Werkbank: die Karte „Dateien und Spielstand" (2026-10-09).
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 *
 * Die Karte bearbeitet drei Stücke, die bei einem geöffneten Paket bis heute
 * nur mitreisten und die ein in der Werkbank gebautes Spiel gar nicht bekommen
 * konnte (Betreiber, 2026-10-09: „offen ist in factorio unverändert übernommen
 * files und management"):
 *
 *   files.denylist       wirkt im Dateimanager des Servers (Sperrliste.js)
 *   management.saves     wird in der Serverübersicht angezeigt (Serverseite.js)
 *   management.persist   wirkt bei der Installation (Daemon: Umleitungen)
 *
 * Die Probe ist dieselbe wie bei jeder Karte:
 *
 *   Jedes eingelieferte Paket, UNVERÄNDERT durch das Formular gespeichert,
 *   ergibt dasselbe Paket — mit derselben Prüfsumme, sonst gälte ein grüner
 *   Durchlauf nach dem ersten Speichern nicht mehr.
 *
 * Dazu die Regeln der drei Listen, die Vorschläge aus dem Probestart und drei
 * Behauptungen, die auf der Karte und in ihren Hilfetexten stehen und die
 * jemand an anderer Stelle falsch machen kann:
 *
 *   - Die Umleitung legt NUR die Paket-Installation an (Prüfdurchlauf, Server),
 *     nicht der Probestart der Sitzung.
 *   - `management.update` liest niemand — deshalb hat es keine Karte.
 *   - Sperrliste und „Welten" haben genau die Leser, die die Karte nennt.
 *
 * Gelesen wird aus der Datenbank, geschrieben nichts.
 *
 *   node scripts/check-werkbank-spielstand.js
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

/** Die Karte so im Formular, wie die Seite sie vorbelegt. */
const formular = (stand) => ({
    denylist: stand.sperrliste.join('\n'), saves: stand.welten.join('\n'),
    persist: stand.umleitungen.map(u => ({ from: u.from, to: u.to })),
});

/** Ein Spiel, das in der Werkbank gebaut wird und noch nichts davon trägt. */
function frisch(mehr = {}) {
    return { id: 7, kennung: 'wbsp', guild_id: 'g1', rootserver_id: 1, image: { ref: 'registry.firenetworks.de/fb/steamcmd', tag: '2026.10' }, entwurf: {
        identity: { slug: 'probe', name: 'Probe', version: '1.0.0' },
        ports: [{ purpose: 'game', protocol: 'udp', assign: 'pool' }],
        start: { program: './Server', args: [], ready_when: { port: 'game' } },
        werkbank: { portnummern: { game: 27015 } },
        ...mehr,
    } };
}
const lies = (...teile) => fs.readFileSync(path.join(...teile), 'utf8');

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
    // Die Teilschemata verweisen auf `#/definitions/…` — die reisen mit.
    const teil = (name) => ajv.compile({ ...schema.properties[name], definitions: schema.definitions });
    const giltManagement = teil('management');
    const giltFiles = teil('files');

    // ── 1) Unverändert speichern ändert nichts ───────────────────────────────
    console.log('\nBestandspakete: unverändert durch die Karte');
    const gesehen = { pakete: 0, mit_sperrliste: 0, mit_welten: 0, mit_umleitung: 0, mit_update: 0, ohne_alles: 0 };
    for (const [slug, paket] of neueste) {
        gesehen.pakete++;
        const m = paket.management || {}, f = paket.files || {};
        if (Array.isArray(f.denylist)) gesehen.mit_sperrliste++;
        if (Array.isArray(m.saves)) gesehen.mit_welten++;
        if (Array.isArray(m.persist)) gesehen.mit_umleitung++;
        if (m.update !== undefined) gesehen.mit_update++;
        if (!Array.isArray(f.denylist) && !Array.isArray(m.saves) && !Array.isArray(m.persist)) gesehen.ohne_alles++;

        await pruefe(`${slug}: dasselbe Paket, derselbe Fingerabdruck`, async () => {
            const vorher = kopie(paket);
            const { entwurf, image, schritte } = S.entwurfAusPaket(paket);
            entwurf.werkbank = { portnummern: S.vorlaeufigePortnummern(entwurf.ports), geoeffnet: { slug, version: paket.identity.version, ziele: S.zieleAusPaket(paket) } };
            const sitzung = { id: 1, kennung: 'wbprobe', rootserver_id: 1, entwurf, image };
            const liste = schritte.map(schritt => ({ status: 'uebernommen', schritt }));
            gleich(paket, vorher, 'das Zerlegen hat das Paket verändert');

            // Die drei Stücke liegen im Entwurf, nicht mehr im Durchgereichten.
            const d = entwurf.durchgereicht || {};
            assert.strictEqual(d.files?.denylist, undefined, 'files.denylist steht noch im Durchgereichten');
            assert.strictEqual(d.management?.saves, undefined, 'management.saves steht noch im Durchgereichten');
            assert.strictEqual(d.management?.persist, undefined, 'management.persist steht noch im Durchgereichten');
            gleich(entwurf.files?.denylist, f.denylist, 'der Entwurf trägt die Sperrliste des Pakets nicht');
            gleich(entwurf.management?.saves, m.saves, 'der Entwurf trägt die Welten des Pakets nicht');
            gleich(entwurf.management?.persist, m.persist, 'der Entwurf trägt die Umleitungen des Pakets nicht');
            // Was keine Karte hat, reist weiter mit — und wird weiter genannt.
            gleich(d.management?.update, m.update, 'management.update ist beim Zerlegen verloren gegangen');
            const genannt = S.durchgereichteTeile(paket).join(' | ');
            assert.ok(!/\b(saves|persist|denylist)\b/.test(genannt), `„Unverändert übernommen" nennt noch ein Stück mit Karte: ${genannt}`);
            if (m.update !== undefined) assert.match(genannt, /management \([^)]*update/, 'management.update wird nicht mehr als mitgereist genannt');

            const stand = S.dateiteilStand(sitzung, []);
            gleich(stand.sperrliste, f.denylist || []);
            gleich(stand.welten, m.saves || []);
            gleich(stand.umleitungen, m.persist || []);

            const davor = kopie(S.entwurfAlsPaket(sitzung, liste));
            gleich(davor.files, paket.files, 'schon das Zusammensetzen ändert files');
            gleich(davor.management, paket.management, 'schon das Zusammensetzen ändert management');
            await S.dateiteilSpeichern(sitzung, formular(stand));
            const danach = S.entwurfAlsPaket(sitzung, liste);
            gleich(danach, davor, 'unverändert gespeichert, und das Paket ist anders');
            assert.strictEqual(S.fingerabdruck(danach), S.fingerabdruck(davor), 'der Fingerabdruck hat sich geändert — ein grüner Durchlauf gälte nicht mehr');
        });
    }
    await pruefe('gesehen wurden alle Sorten: Sperrliste, Welten, Umleitung, das mitreisende update — und ein Paket ganz ohne', async () => {
        assert.ok(gesehen.mit_sperrliste > 0, 'kein Paket mit Sperrliste — die Probe hätte keine durchs Formular geschickt');
        assert.ok(gesehen.mit_welten > 0, 'kein Paket mit management.saves');
        assert.ok(gesehen.mit_umleitung > 0, 'kein Paket mit management.persist — die Umleitungen sind ungeprüft');
        assert.ok(gesehen.mit_update > 0, 'kein Paket mit management.update — „reist weiter mit" ist ungeprüft');
        assert.ok(gesehen.ohne_alles > 0, 'kein Paket ohne die drei Stücke — „nichts bleibt nichts" ist ungeprüft');
    });
    await pruefe('eine Sitzung aus der Zeit vor der Karte zieht beim Laden um — einmal, und nur die drei Stücke', async () => {
        const einmal = S.ordne({ durchgereicht: {
            management: { saves: ['saves'], persist: [{ from: 'game/a', to: 'data/a' }], update: { type: 'steamcmd', app: 1 } },
            files: { denylist: ['bin'], patch: { 'x.ini': { parser: 'ini', find: {} } } },
            content: { art: 'mods' },
        } });
        gleich(einmal.management, { saves: ['saves'], persist: [{ from: 'game/a', to: 'data/a' }] });
        gleich(einmal.files, { denylist: ['bin'] });
        gleich(einmal.durchgereicht, {
            management: { update: { type: 'steamcmd', app: 1 } },
            files: { patch: { 'x.ini': { parser: 'ini', find: {} } } },
            content: { art: 'mods' },
        }, 'ordne hat ein fremdes Stück angefasst oder eines mit Karte liegen lassen');
        gleich(S.ordne(kopie(einmal)), einmal, 'ordne ist nicht wiederholbar');
    });

    // ── 2) Die Regeln ────────────────────────────────────────────────────────
    console.log('\nRegeln');
    await pruefe('ein neues Spiel bekommt alle drei Stücke — so, wie das Schema sie will', async () => {
        const s = frisch();
        await S.dateiteilSpeichern(s, {
            denylist: ' bin \n\n*.lock\nbin\ngame/Engine',
            saves: 'data/saves\n',
            persist: [{ from: ' game/Spiel/Saved/SaveGames/ ', to: 'data/saves/' }, { from: '', to: '' }],
        });
        const paket = S.entwurfAlsPaket(s, []);
        gleich(paket.files, { denylist: ['bin', '*.lock', 'game/Engine'] });
        gleich(paket.management, { saves: ['data/saves'], persist: [{ from: 'game/Spiel/Saved/SaveGames', to: 'data/saves' }] });
        assert.ok(giltFiles(paket.files), JSON.stringify(giltFiles.errors));
        assert.ok(giltManagement(paket.management), JSON.stringify(giltManagement.errors));
        // Das Schema ist die zweite Schranke — sie muss dieselben Orte verlangen.
        assert.ok(!giltManagement({ persist: [{ from: 'data/x', to: 'data/y' }] }), 'das Schema nimmt eine Umleitung an, die nicht in game/ beginnt');
        assert.ok(!giltManagement({ persist: [{ from: 'game/x', to: 'cache/y' }] }), 'das Schema nimmt eine Umleitung an, die nicht nach data/ führt');
    });
    await pruefe('der Daemon bekommt die Umleitung mit: `management` gehört zu den Laufzeit-Teilen', async () => {
        assert.ok(S.LAUFZEIT_TEILE.includes('management'));
    });
    await pruefe('alles geleert in einer Sitzung, die nie etwas trug: beide Teile verschwinden ganz', async () => {
        const s = frisch();
        await S.dateiteilSpeichern(s, { denylist: '', saves: '', persist: [] });
        assert.ok(!('files' in s.entwurf) && !('management' in s.entwurf), 'ein leeres Formular hat leere Teile angelegt');
        const paket = S.entwurfAlsPaket(s, []);
        assert.ok(!('files' in paket) && !('management' in paket));
    });
    await pruefe('eine Liste, die da war, bleibt als leere stehen — und nimmt ihre Nachbarn nicht mit', async () => {
        const s = frisch({ management: { query: { protocol: 'a2s', port: 'game' }, saves: ['saves'] }, files: { denylist: ['bin'] } });
        await S.dateiteilSpeichern(s, { denylist: '', saves: '', persist: [] });
        gleich(s.entwurf.files, { denylist: [] });
        gleich(s.entwurf.management, { query: { protocol: 'a2s', port: 'game' }, saves: [] }, 'die Abfrage ist beim Speichern der Karte verloren gegangen');
    });
    await pruefe('Sperrliste: abgewiesen wird, was aus dem Volume führt oder alles sperrt', async () => {
        const s = frisch();
        const mit = (denylist) => S.dateiteilSpeichern(s, { denylist, saves: '', persist: [] });
        await wirft(() => mit('/etc/passwd'), /ohne führenden Schrägstrich/);
        await wirft(() => mit('game/../x'), /aus dem Volume/);
        await wirft(() => mit('game\\bin'), /mit „\/" getrennt/);
        for (const alles of ['*', '**', '?', '*/*', '/']) await wirft(() => mit(alles), /jede Datei|führenden Schrägstrich/);
        await wirft(() => mit('x'.repeat(S.DATEITEIL.max.zeichen + 1)), /höchstens/);
        await wirft(() => mit(Array.from({ length: S.DATEITEIL.max.sperren + 1 }, (_, i) => `d${i}`).join('\n')), /höchstens/);
        assert.ok(!('files' in s.entwurf), 'ein abgewiesenes Formular hat trotzdem etwas gespeichert');
        // Was die Bestandspakete tragen, geht durch — auch der Verweis von Minecraft.
        await mit('.env\nstart.sh\nfirebot.lock\n*.log\nserver.jar');
        assert.strictEqual(s.entwurf.files.denylist.length, 5);
    });
    await pruefe('Welten: Pfade im Volume, Verweise erlaubt', async () => {
        const s = frisch();
        const mit = (saves) => S.dateiteilSpeichern(s, { denylist: '', saves, persist: [] });
        await wirft(() => mit('/home/container/saves'), /ohne führenden Schrägstrich/);
        await wirft(() => mit('../saves'), /aus dem Volume/);
        await wirft(() => mit(Array.from({ length: S.DATEITEIL.max.welten + 1 }, (_, i) => `w${i}`).join('\n')), /höchstens/);
        await mit('{{setting:level_name}}\n.config/unity3d/IronGate/Valheim/worlds_local');
        gleich(s.entwurf.management.saves, ['{{setting:level_name}}', '.config/unity3d/IronGate/Valheim/worlds_local']);
    });
    await pruefe('Umleitung: von game/ nach data/, ein Ordner, nichts doppelt, nichts ineinander', async () => {
        const s = frisch();
        const mit = (...persist) => S.dateiteilSpeichern(s, { denylist: '', saves: '', persist });
        await wirft(() => mit({ from: 'game/Saved', to: '' }), /gehören beide dazu/);
        await wirft(() => mit({ from: '', to: 'data/saves' }), /gehören beide dazu/);
        await wirft(() => mit({ from: 'data/Saved', to: 'data/saves' }), /unter game\//);
        await wirft(() => mit({ from: 'game', to: 'data/saves' }), /unter game\//);
        await wirft(() => mit({ from: 'game/', to: 'data/saves' }), /unter game\//);
        await wirft(() => mit({ from: 'game/Saved', to: 'game/x' }), /unter data\//);
        await wirft(() => mit({ from: 'game/Saved', to: 'data' }), /unter data\//);
        await wirft(() => mit({ from: 'game/Saved', to: 'cache/saves' }), /unter data\//);
        await wirft(() => mit({ from: 'game/a/../../etc', to: 'data/x' }), /aus dem Volume/);
        await wirft(() => mit({ from: 'game/Saved', to: 'data/../x' }), /aus dem Volume/);
        await wirft(() => mit({ from: '/game/Saved', to: 'data/x' }), /ohne führenden Schrägstrich/);
        await wirft(() => mit({ from: 'game/a', to: 'data/a' }, { from: 'game/a', to: 'data/b' }), /wird schon umgeleitet/);
        await wirft(() => mit({ from: 'game/a', to: 'data/x' }, { from: 'game/b', to: 'data/x' }), /mischen ihre Dateien/);
        await wirft(() => mit({ from: 'game/a', to: 'data/a' }, { from: 'game/a/b', to: 'data/b' }), /liegen ineinander/);
        await wirft(() => mit({ from: 'game/a/b', to: 'data/b' }, { from: 'game/a', to: 'data/a' }), /liegen ineinander/);
        await wirft(() => mit(...Array.from({ length: S.DATEITEIL.max.umleitungen + 1 }, (_, i) => ({ from: `game/o${i}`, to: `data/o${i}` }))), /Höchstens/);
        assert.ok(!('management' in s.entwurf), 'eine abgewiesene Umleitung hat trotzdem etwas gespeichert');
        // Nebeneinander ist nicht ineinander: game/ab ist kein Kind von game/a.
        await mit({ from: 'game/a', to: 'data/a' }, { from: 'game/ab', to: 'data/ab' });
        assert.strictEqual(s.entwurf.management.persist.length, 2);
    });
    await pruefe('läuft etwas, wird nicht gespeichert', async () => {
        const s = frisch();
        beschaeftigt = true;
        try { await wirft(() => S.dateiteilSpeichern(s, { denylist: 'bin', saves: '', persist: [] }), /Prüfdurchlauf läuft/); }
        finally { beschaeftigt = false; }
        assert.ok(!('files' in s.entwurf));
    });
    await pruefe('veröffentlichen: das Stück, das ein gebautes Spiel nicht trägt, wird beim Namen genannt', async () => {
        // Der Satz steht in veroeffentlichungsStand; hier nur, dass die Zuordnung stimmt.
        assert.deepStrictEqual(S.EIGENE.files, ['denylist', 'public']);
        for (const f of ['saves', 'persist', 'query', 'rcon']) assert.ok(S.EIGENE.management.includes(f), `management.${f} hat keine Karte mehr`);
        assert.ok(!S.EIGENE.management.includes('update'), 'management.update hat eine Karte bekommen — dann stimmt ihr Hinweistext nicht mehr');
    });

    // ── 3) Vorschläge aus dem Probestart ─────────────────────────────────────
    console.log('\nVorschläge');
    await pruefe('Ordner unter game/ mit neuen Dateien — die häufigsten zuerst, ohne schon Umgeleitetes', async () => {
        const laeufe = [
            { dateien: JSON.stringify({ neu: [
                { pfad: 'game/Spiel/Saved/SaveGames/welt.sav' }, { pfad: 'game/Spiel/Saved/SaveGames/welt.bak' },
                { pfad: 'game/Spiel/Saved/Logs/spiel.log' }, { pfad: 'game/GameID.txt' }, { pfad: 'data/Steam/x.txt' },
            ], geaendert: [{ pfad: 'game/Spiel/Config/a.ini' }] }) },
            { dateien: { neu: [{ pfad: 'game/Spiel/Saved/SaveGames/welt2.sav' }] } },
            { dateien: null },
        ];
        const v = S.umleitungsVorschlaege(laeufe, []);
        gleich(v, [
            { from: 'game/Spiel/Saved/SaveGames', to: 'data/savegames', dateien: 3 },
            { from: 'game/Spiel/Saved/Logs', to: 'data/logs', dateien: 1 },
        ], 'Dateien direkt in game/, unter data/ oder nur geänderte dürfen nicht vorgeschlagen werden');
        gleich(S.umleitungsVorschlaege(laeufe, [{ from: 'game/Spiel/Saved', to: 'data/saved' }]), [], 'ein Ordner unter einer Umleitung wird noch vorgeschlagen');
        gleich(S.umleitungsVorschlaege(laeufe, [{ from: 'game/Spiel/Saved/SaveGames', to: 'data/saves' }]).map(x => x.from), ['game/Spiel/Saved/Logs']);
        gleich(S.umleitungsVorschlaege([], []), []);
        // Jeder Vorschlag ist eine Umleitung, die das Formular annimmt.
        const s = frisch();
        await S.dateiteilSpeichern(s, { denylist: '', saves: '', persist: v.map(x => ({ from: x.from, to: x.to })) });
        assert.strictEqual(s.entwurf.management.persist.length, 2);
        gleich(S.dateiteilStand(s, laeufe).vorschlaege, []);
    });
    await pruefe('höchstens so viele Vorschläge, wie die Karte zeigen will', async () => {
        const neu = Array.from({ length: 30 }, (_, i) => ({ pfad: `game/o${String(i).padStart(2, '0')}/x` }));
        assert.strictEqual(S.umleitungsVorschlaege([{ dateien: { neu } }], []).length, S.DATEITEIL.vorschlaege);
    });

    // ── 4) Was die Karte behauptet, steht so im Code ─────────────────────────
    console.log('\nVertrag');
    await pruefe('Daemon: `persist` mit `from`/`to`, und angelegt wird NUR bei der Paket-Installation', async () => {
        const paketGo = ohneKommentare(lies(DAEMON, 'internal/pkgspec/paket.go'));
        assert.match(paketGo, /Persist\s+\[\]Umleitung\s+`json:"persist,omitempty"`/);
        const typ = /type Umleitung struct \{([\s\S]*?)\n\}/.exec(paketGo);
        assert.ok(typ, 'pkgspec.Umleitung nicht gefunden');
        assert.match(typ[1], /`json:"from"`/);
        assert.match(typ[1], /`json:"to"`/);
        // Die Karte sagt: im Prüfdurchlauf und auf jedem Server, nicht im Probestart.
        const aufrufer = [];
        const ordner = path.join(DAEMON, 'internal/gameserver');
        for (const datei of fs.readdirSync(ordner).filter(n => n.endsWith('.go') && !n.endsWith('_test.go'))) {
            if (/\.Umleitungen\(/.test(ohneKommentare(lies(ordner, datei)))) aufrufer.push(datei);
        }
        assert.deepStrictEqual(aufrufer, ['install_paket.go'],
            'wer Umleitungen anlegt, hat sich geändert — der Hilfetext der Karte („nicht im Probestart") stimmt dann nicht mehr');
        // Und der Prüfdurchlauf reicht `management` an genau diese Installation.
        assert.match(ohneKommentare(lies(ordner, 'werkbank_pruefung.go')), /Management:\s+a\.Management,/);
    });
    await pruefe('Daemon und Dashboard: `management.update` liest niemand — deshalb reist es nur mit', async () => {
        const struktur = /type Management struct \{([\s\S]*?)\n\}/.exec(ohneKommentare(lies(DAEMON, 'internal/pkgspec/paket.go')));
        assert.ok(struktur, 'pkgspec.Management nicht gefunden');
        assert.doesNotMatch(struktur[1], /json:"update/, 'der Daemon liest management.update jetzt — dann braucht es eine Karte, und der Text unter „Unverändert übernommen" ist falsch');
        const helfer = path.join(WURZEL, 'plugins/gameserver/dashboard/helpers');
        for (const datei of fs.readdirSync(helfer).filter(n => n.endsWith('.js'))) {
            assert.ok(!/management\??\.update\b/.test(ohneKommentare(lies(helfer, datei))), `${datei} liest management.update`);
        }
    });
    await pruefe('Dashboard: die Sperrliste liest der Dateimanager, die Welten die Serverübersicht', async () => {
        assert.match(ohneKommentare(lies(WURZEL, 'plugins/gameserver/dashboard/helpers/Sperrliste.js')), /paket\?\.files\?\.denylist/);
        assert.match(ohneKommentare(lies(WURZEL, 'plugins/gameserver/dashboard/helpers/Serverseite.js')), /welten:\s+paket\.management\?\.saves/);
        // Ein Eintrag, den die Karte annimmt, sperrt im Dateimanager auch wirklich.
        const { gesperrt } = require('../plugins/gameserver/dashboard/helpers/Sperrliste');
        assert.strictEqual(gesperrt('/game/bin/x64/factorio', ['bin']), true);
        assert.strictEqual(gesperrt('/game/Engine/x', ['game/Engine']), true);
        assert.strictEqual(gesperrt('/data/Engine/x', ['game/Engine']), false);
        assert.strictEqual(gesperrt('/game/saves/welt.zip', ['bin', '*.lock']), false);
    });

    // ── 5) Route und Ansicht ─────────────────────────────────────────────────
    console.log('\nRoute und Ansicht');
    await pruefe('eine Route, mit dem Recht zu bauen — und die Seite bekommt den Stand samt Läufen', async () => {
        const router = ohneKommentare(lies(WURZEL, 'plugins/werkbank/dashboard/routes/guild.router.js'));
        assert.match(router, /router\.post\('\/:kennung\/spielstand', requirePermission\('WERKBANK\.BAUEN'\)/);
        assert.match(router, /Sitzungen\.dateiteilSpeichern\(await offeneSitzung\(req, res\), req\.body \|\| \{\}\)/);
        assert.match(router, /dateiteil: Sitzungen\.dateiteilStand\(sitzung, laeufe\)/, 'ohne die Läufe gibt es keine Vorschläge');
        assert.match(router, /DATEITEIL: Sitzungen\.DATEITEIL/);
    });
    await pruefe('die Karte steht im Reiter „Starten", mit ihren drei Feldern und ohne rohes HTML', async () => {
        const ansicht = ohneKommentareEjs(lies(WURZEL, 'plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs'));
        const von = ansicht.indexOf('id="karteSpielstand"'), bis = ansicht.indexOf('data-reiter="verbindung"');
        assert.ok(von > 0 && bis > von, 'die Karte steht nicht im Reiter „Starten"');
        assert.ok(von > ansicht.indexOf('id="karteVoraussetzungen"'), 'die Karte steht vor den Voraussetzungen');
        const karte = ansicht.slice(von, bis);
        assert.ok(karte.includes('id="formSpielstand"'));
        for (const name of ['from', 'to', 'saves', 'denylist']) assert.ok(karte.includes(`name="${name}"`), `dem Formular fehlt „${name}"`);
        assert.ok(karte.includes("beschaeftigt ? 'disabled' : ''"), 'Speichern ist nicht gesperrt, wenn etwas läuft');
        // Pfade kommen aus Paketen und vom Spiel: als Text, nie als HTML.
        const roh = [...karte.matchAll(/<%-\s*([\s\S]*?)%>/g)].map(m => m[1].trim());
        for (const r of roh) assert.ok(/^include\('werkbank-hilfe'/.test(r), `unescaped ausgegeben: ${r.slice(0, 50)}`);
        for (const wert of ['<%= u.from %>', '<%= u.to %>', '<%= v.from %>', '<%= v.to %>']) assert.ok(karte.includes(wert), `„${wert}" fehlt — oder wird anders ausgegeben`);
        // Was die Karte über ihre Wirkung sagt (die Belege stehen im Abschnitt „Vertrag").
        assert.ok(karte.includes('nicht im Probestart dieser Sitzung'), 'die Karte sagt nicht, wann die Umleitung angelegt wird');
        assert.ok(karte.includes('nicht über SFTP'), 'die Karte verschweigt, dass SFTP die Sperrliste nicht kennt');
        assert.ok(karte.includes('Wird in der Serverübersicht angezeigt.'), 'die Karte sagt nicht, dass „Welten" nur eine Anzeige ist');
    });
    await pruefe('das Skript schickt alle drei Listen und baut Zeilen als Elemente', async () => {
        const ansicht = ohneKommentareEjs(lies(WURZEL, 'plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs'));
        const von = ansicht.indexOf("var formSp = document.getElementById('formSpielstand');");
        const bis = ansicht.indexOf("var formH = document.getElementById('formHinweis');");
        assert.ok(von > 0 && bis > von, 'das Skript der Karte ist nicht zu finden');
        const skript = ansicht.slice(von, bis);
        assert.ok(skript.includes("schicke(hier + '/spielstand', {"));
        for (const feld of ['denylist:', 'saves:', 'persist:']) assert.ok(skript.includes(feld), `das Skript schickt „${feld}" nicht`);
        assert.ok(!/innerHTML|insertAdjacentHTML/.test(skript), 'eine Zeile entsteht aus HTML-Text — ein Ordnername des Spiels käme als HTML an');
        assert.ok(skript.includes("melde('error', fehler.message)") && skript.includes("melde('success'"), 'Erfolg oder Fehler wird nicht gemeldet');
        assert.ok(!/\balert\(|\bconfirm\(|\bprompt\(/.test(skript));
    });
    await pruefe('„Unverändert übernommen" beschreibt, was dort noch steht', async () => {
        const ansicht = ohneKommentareEjs(lies(WURZEL, 'plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs'));
        assert.ok(!ansicht.includes("'Spielstände, Umleitungen, Aktualisieren'"), 'management wird noch mit den Stücken beschrieben, die jetzt eine Karte haben');
        assert.ok(!ansicht.includes("files:        'Sperrliste im Dateimanager'"), 'files wird noch als Sperrliste beschrieben');
    });

    console.log(`\n  · gesehen: ${Object.entries(gesehen).map(([k, n]) => `${n} ${k}`).join(', ')}`);
    console.log(fehler === 0 ? '\n✅ Dateien und Spielstand: bearbeitbar, und unverändert bleibt unverändert\n' : `\n❌ ${fehler} Abweichung(en)\n`);
    process.exit(fehler === 0 ? 0 : 1);
})().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
