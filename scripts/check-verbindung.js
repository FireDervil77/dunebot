#!/usr/bin/env node
/**
 * Fällt eine Maschine aus, sagt das Panel, was es weiß (2026-11-02, F15).
 *
 * Bei der Wartung am 2026-11-02 war 55 eine Viertelstunde weg. Nur der Rootserver
 * stand auf offline, 7 Days zeigte weiter „Läuft", und nach dem Neustart der
 * Maschine blieb es dabei, obwohl das Spiel nicht mehr lief.
 *
 * Gefahren wird die Geschichte dieses Ausfalls mit der echten Wache und echtem SQL,
 * an TEMPORARY-Kopien von `rootserver` und `gameservers`, die nur diese Verbindung
 * sieht. Geschrieben wird am Bestand nichts.
 *
 *   node scripts/check-verbindung.js
 */
'use strict';
const path = require('path');
const assert = require('assert');
const fs = require('fs');

const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const { ServiceManager } = require('dunebot-core');

const meldungen = [];
ServiceManager.register('Logger', {
    warn: (t) => meldungen.push(t), info: (t) => meldungen.push(t), error: (t) => meldungen.push(t), debug: () => {},
});
const gesendet = [];
ServiceManager.register('sseManager', { broadcast: (g, ns, d) => gesendet.push({ g, ns, ...d }) });

const VerbindungsWache = require('../apps/dashboard/helpers/VerbindungsWache');
const Verbindung = require('../plugins/gameserver/dashboard/helpers/Verbindung');
const { baueZustand, baueMesswerte } = require('../plugins/gameserver/dashboard/helpers/Serverseite');
global.window = undefined;
const { knopfZustand, pillenZustand } = require('../plugins/gameserver/dashboard/assets/js/gameserver-live.js');
const migration = require('../plugins/masterserver/migrations/20261102_100000_rootserver_verbindung');
const bahnhofMigration = require('../plugins/masterserver/migrations/20261103_100000_rootserver_bahnhof_weg');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').join('\n      ')}`); }
}

(async () => {
    console.log('Anzeige');
    const jetzt = new Date();
    await pruefe('ohne Leitung überstimmt die Verbindung den Status, rot', () => {
        const z = baueZustand({ status: 'online', verbindung: 'maschine_weg' });
        assert.deepStrictEqual([z.schluessel, z.text, z.ton, z.gut], ['verbindung', 'Maschine nicht erreichbar', 'red', false]);
        assert.strictEqual(baueZustand({ status: 'offline', verbindung: 'daemon_weg' }).text, 'Daemon nicht erreichbar');
    });
    await pruefe('in der Gnadenfrist bleibt der Status stehen', () => {
        assert.strictEqual(baueZustand({ status: 'online', verbindung: 'neu_verbinden' }).text, 'Läuft');
        assert.strictEqual(baueZustand({ status: 'online', verbindung: 'da' }).text, 'Läuft');
        assert.strictEqual(baueZustand({ status: 'online' }).text, 'Läuft');
    });
    await pruefe('Löschen und Umzug schlagen die Verbindung weiter', () => {
        assert.strictEqual(baueZustand({ status: 'offline', verbindung: 'maschine_weg', umzug_status: 'transferring' }).schluessel, 'umzug');
    });
    await pruefe('der Messstreifen nennt Ausfall, Zeit und letzten Stand, auffällig', () => {
        const m = baueMesswerte({ status: 'online', verbindung: 'maschine_weg', verbindung_seit: jetzt, last_heartbeat: jetzt });
        assert.strictEqual(m.frisch, false, 'alte Zahlen sähen aus wie jetzt');
        assert.match(m.grund, /^Maschine nicht erreichbar seit \d\d:\d\d — letzter Stand: Läuft\.$/);
        assert.strictEqual(m.warnung, true);
    });
    await pruefe('„Letzte Meldung vor … s" ist eine Warnung, ein ausgeschalteter Server nicht', () => {
        const alt = new Date(Date.now() - 300000);
        assert.strictEqual(baueMesswerte({ status: 'online', last_heartbeat: alt }).warnung, true);
        assert.strictEqual(baueMesswerte({ status: 'offline' }).warnung, false);
        assert.strictEqual(baueMesswerte({ status: 'online', last_heartbeat: jetzt }).warnung, false);
    });
    await pruefe('„Beim Ausfall beendet" gilt, bis der Server wieder gestartet wurde', () => {
        const fall = { status: 'offline', last_crash_reason: Verbindung.AUSFALL_GRUND, last_crash_at: jetzt };
        assert.strictEqual(baueMesswerte({ ...fall, last_started_at: new Date(Date.now() - 60000) }).grund, Verbindung.AUSFALL_GRUND);
        assert.strictEqual(baueMesswerte({ ...fall, last_started_at: new Date(Date.now() + 60000) }).grund,
            'Der Server läuft nicht — es wird nichts gemessen.');
        assert.strictEqual(baueMesswerte({ status: 'offline', last_crash_reason: 'Absturz', last_crash_at: jetzt }).grund,
            'Der Server läuft nicht — es wird nichts gemessen.');
    });
    await pruefe('ohne Leitung ist jeder Knopf gesperrt, mit Grund, die Zeile bleibt gefüllt', () => {
        for (const verbindung of ['neu_verbinden', 'angekuendigt', 'daemon_weg', 'maschine_weg']) {
            const an = knopfZustand({ status: 'online', bereit: true, verbindung });
            assert.deepStrictEqual([an.stop.sichtbar, an.stop.aktiv, an.restart.aktiv], [true, false, false], verbindung);
            assert.ok(an.stop.grund, 'ein gesperrter Knopf ohne Grund ist eine Sackgasse');
            const aus = knopfZustand({ status: 'offline', verbindung });
            assert.deepStrictEqual([aus.start.sichtbar, aus.start.aktiv], [true, false], verbindung);
        }
        assert.strictEqual(knopfZustand({ status: 'offline', verbindung: 'da' }).start.aktiv, true);
    });
    await pruefe('„Spieler können rein" verschwindet ohne Leitung', () => {
        assert.strictEqual(pillenZustand({ status: 'online', bereit: true, verbindung: 'maschine_weg' }).sichtbar, false);
        assert.strictEqual(pillenZustand({ status: 'online', bereit: true, verbindung: 'neu_verbinden' }).sichtbar, true);
    });

    console.log('\nMaschine prüfen');
    await pruefe('ein abgewiesener Port zählt als Antwort, eine unsinnige Adresse nicht', async () => {
        assert.strictEqual(await VerbindungsWache.maschineAntwortet({ host: '127.0.0.1', ports: [1] }), true);
        assert.strictEqual(await VerbindungsWache.maschineAntwortet({ host: '-c 1; id', ports: [] }), false);
    });
    await pruefe('Live-Seite und Route tragen die Verbindung', () => {
        const live = fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/assets/js/gameserver-live.js'), 'utf8');
        assert.match(live, /sse\.on\('verbindung'/);
        assert.match(live, /verbindung: s\.verbindung \|\| 'da'/);
        const route = fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/routes/servers.js'), 'utf8');
        assert.strictEqual((route.match(/Verbindung'\)\.SPALTEN/g) || []).length, 2, 'Status und Serverseite');
        assert.match(fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/Serverliste.js'), 'utf8'), /Verbindung'\)\.SPALTEN/);
    });

    console.log('\nDer Ausfall vom 2026-11-02, an Kopien');
    const roh = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT, user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE, dateStrings: false,
    });
    const db = { query: async (sql, p) => { const [r] = await roh.query(sql, p); return r; } };
    try {
        for (const t of ['rootserver', 'gameservers']) {
            await db.query(`CREATE TEMPORARY TABLE kopie_${t} AS SELECT * FROM ${t}`);
            await db.query(`CREATE TEMPORARY TABLE ${t} AS SELECT * FROM kopie_${t}`);
        }
        const [da] = await db.query("SHOW COLUMNS FROM rootserver LIKE 'verbindung'");
        if (!da) await migration.up(db);
        // Zweimal: Die Migration läuft bei jedem Start und darf beim zweiten Mal nichts tun.
        await bahnhofMigration.up(db);
        await bahnhofMigration.up(db);
        await db.query("UPDATE rootserver SET verbindung = 'da', verbindung_seit = NULL");

        const [m] = await db.query('SELECT id, daemon_id, guild_id FROM rootserver WHERE daemon_id IS NOT NULL ORDER BY id LIMIT 1');
        const [g] = await db.query('SELECT id FROM gameservers ORDER BY id LIMIT 1');
        const [h] = await db.query('SELECT id FROM gameservers ORDER BY id DESC LIMIT 1');
        await db.query('UPDATE gameservers SET rootserver_id = 0');
        await db.query("UPDATE gameservers SET rootserver_id = ?, status = 'online', last_crash_reason = NULL WHERE id IN (?, ?)", [m.id, g.id, h.id]);

        let verbunden = true;
        let antwortet = false;
        const wache = new VerbindungsWache({ db: () => db, istVerbunden: () => verbunden, pruefe: async () => antwortet });
        const stand = async () => (await db.query('SELECT verbindung, verbindung_seit FROM rootserver WHERE id = ?', [m.id]))[0];
        const zeile = async (id) => (await db.query(
            `SELECT gs.*, ${Verbindung.SPALTEN} FROM gameservers gs WHERE gs.id = ?`, [id]))[0];

        await pruefe('der Ausschnitt SQL läuft und liest die Maschine', async () => {
            assert.strictEqual((await zeile(g.id)).verbindung, 'da');
        });
        await pruefe('die Trennung ist erst einmal kein Ausfall', async () => {
            verbunden = false;
            await wache.getrennt(m.daemon_id);
            wache.beende();
            const s = await stand();
            assert.strictEqual(s.verbindung, 'neu_verbinden');
            assert.ok(s.verbindung_seit);
        });
        await pruefe('nach der Frist antwortet die Maschine nicht: maschine_weg, der Browser erfährt es', async () => {
            gesendet.length = 0;
            await wache._pruefeNach(m.daemon_id);
            wache.beende();
            assert.strictEqual((await stand()).verbindung, 'maschine_weg');
            assert.deepStrictEqual(gesendet.map(x => [x.ns, x.action, x.verbindung]), [['gameserver', 'verbindung', 'maschine_weg']]);
            assert.strictEqual(String(gesendet[0].g), String(m.guild_id));
        });
        await pruefe('kommt die Maschine zurück, der Daemon aber nicht: daemon_weg, der Beginn bleibt', async () => {
            const vorher = (await stand()).verbindung_seit;
            antwortet = true;
            await new Promise(r => setTimeout(r, 1100));
            await wache._pruefeNach(m.daemon_id);
            wache.beende();
            const s = await stand();
            assert.strictEqual(s.verbindung, 'daemon_weg');
            assert.strictEqual(s.verbindung_seit.getTime(), vorher.getTime());
        });
        await pruefe('die Serverzeile zeigt den Ausfall', async () => {
            const z = await zeile(g.id);
            assert.strictEqual(baueZustand(z).text, 'Daemon nicht erreichbar');
            assert.match(baueMesswerte(z).grund, /letzter Stand: Läuft/);
        });
        await pruefe('der Daemon meldet sich an, die Anzeige stimmt sofort wieder', async () => {
            verbunden = true;
            await wache.angemeldet(m.daemon_id);
            const s = await stand();
            assert.deepStrictEqual([s.verbindung, s.verbindung_seit], ['da', null]);
        });
        await pruefe('nur wer nicht mehr läuft, gilt als beendet', async () => {
            gesendet.length = 0;
            await wache.herzschlag(m.daemon_id, [{ server_id: g.id, status: 'running' }, { server_id: h.id, status: 'stopped' }]);
            assert.strictEqual((await zeile(g.id)).status, 'online');
            const weg = await zeile(h.id);
            assert.strictEqual(weg.status, 'offline');
            assert.strictEqual(baueMesswerte({ ...weg, last_started_at: null }).grund, Verbindung.AUSFALL_GRUND);
            assert.deepStrictEqual(gesendet.map(x => [x.action, x.status]), [['status_changed', 'offline']]);
        });
        await pruefe('der Abgleich läuft einmal, nicht bei jedem Herzschlag', async () => {
            await wache.herzschlag(m.daemon_id, []);
            assert.strictEqual((await zeile(g.id)).status, 'online');
        });
        await pruefe('ein kurzer Abriss wird nie zum Abgleich', async () => {
            verbunden = false;
            await wache.getrennt(m.daemon_id);
            wache.beende();
            verbunden = true;
            await wache.angemeldet(m.daemon_id);
            await wache.herzschlag(m.daemon_id, []);
            assert.strictEqual((await zeile(g.id)).status, 'online');
        });
        await pruefe('verbunden, bevor die Frist um ist: kein Ausfall, auch nicht im letzten Moment', async () => {
            verbunden = false;
            await wache.getrennt(m.daemon_id);
            wache.beende();
            verbunden = true;
            await wache._pruefeNach(m.daemon_id);
            assert.strictEqual((await stand()).verbindung, 'neu_verbinden');
            await wache.angemeldet(m.daemon_id);
        });
        await pruefe('ein angekündigtes Update ist kein Ausfall', async () => {
            wache.kuendigeAn(m.daemon_id);
            verbunden = false;
            await wache.getrennt(m.daemon_id);
            wache.beende();
            assert.strictEqual((await stand()).verbindung, 'angekuendigt');
            const z = await zeile(g.id);
            assert.deepStrictEqual([baueZustand(z).text, baueZustand(z).ton], ['Daemon wird aktualisiert', 'blue']);
            verbunden = true;
            await wache.angemeldet(m.daemon_id);
        });
        await pruefe('nach einem Dashboard-Neustart bekommt jeder Daemon seine Frist, ein Ausfall bleibt ein Ausfall', async () => {
            await db.query("UPDATE rootserver SET verbindung = 'maschine_weg', verbindung_seit = '2026-11-02 09:34:32' WHERE id = ?", [m.id]);
            const [andere] = await db.query('SELECT id FROM rootserver WHERE id <> ? AND daemon_id IS NOT NULL LIMIT 1', [m.id]);
            await wache.beimStart();
            wache.beende();
            assert.strictEqual((await stand()).verbindung, 'maschine_weg');
            if (andere) {
                const [s] = await db.query('SELECT verbindung FROM rootserver WHERE id = ?', [andere.id]);
                assert.strictEqual(s.verbindung, 'neu_verbinden');
            }
        });

        console.log('\nBusbahnhof weg (seit 9340 abgeschaltet ist, 2026-11-03)');
        let bahnhof = true;
        let geklopft = 0;
        const ausgefallen = [];
        const bwache = new VerbindungsWache({
            db: () => db, istVerbunden: () => verbunden, bahnhofDa: () => bahnhof,
            pruefe: async () => { geklopft++; return true; },
            ausgefallen: async (id) => { ausgefallen.push(id); },
        });
        await db.query("UPDATE rootserver SET verbindung = 'da', verbindung_seit = NULL WHERE id = ?", [m.id]);
        await db.query("UPDATE gameservers SET status = 'online', last_crash_reason = NULL WHERE id IN (?, ?)", [g.id, h.id]);

        await pruefe('ohne Bahnhof wird nicht angeklopft und nichts offline gesetzt', async () => {
            bahnhof = false;
            verbunden = false;
            await bwache.getrennt(m.daemon_id);
            await bwache._pruefeNach(m.daemon_id);
            bwache.beende();
            assert.strictEqual((await stand()).verbindung, 'bahnhof_weg');
            assert.strictEqual(geklopft, 0, 'die Maschine wurde gefragt');
            assert.deepStrictEqual(ausgefallen, []);
        });
        await pruefe('die Serverzeile sagt, dass der Bahnhof fehlt, rot, Knöpfe gesperrt', async () => {
            const z = await zeile(g.id);
            assert.deepStrictEqual([baueZustand(z).text, baueZustand(z).ton], ['Busbahnhof nicht erreichbar', 'red']);
            assert.match(baueMesswerte(z).grund, /Busbahnhof nicht erreichbar seit .* letzter Stand: Läuft/);
            assert.strictEqual(knopfZustand({ status: 'online', verbindung: 'bahnhof_weg' }).stop.aktiv, false);
            assert.strictEqual(pillenZustand({ status: 'online', verbindung: 'bahnhof_weg' }).sichtbar, false);
        });
        await pruefe('kommt der Bahnhof mit dem Daemon zurück: da, und der Abgleich läuft einmal', async () => {
            bahnhof = true;
            await bwache.angedockt();
            verbunden = true;
            await bwache.angemeldet(m.daemon_id);
            bwache.beende();
            assert.strictEqual((await stand()).verbindung, 'da');
            await bwache.herzschlag(m.daemon_id, [{ server_id: g.id, status: 'running' }, { server_id: h.id, status: 'running' }]);
            assert.strictEqual(bwache.nachAusfall.has(m.daemon_id), false);
            assert.deepStrictEqual(ausgefallen, []);
        });
        await pruefe('kommt der Bahnhof ohne den Daemon zurück: nach der Frist ein Ausfall, offline genau einmal', async () => {
            bahnhof = false;
            verbunden = false;
            await bwache.getrennt(m.daemon_id);
            await bwache._pruefeNach(m.daemon_id);
            bahnhof = true;
            await bwache.angedockt();
            assert.ok(bwache.uhren.has(m.daemon_id), 'keine neue Frist nach dem Andocken');
            bwache.beende();
            await bwache._pruefeNach(m.daemon_id);
            await bwache._pruefeNach(m.daemon_id);
            bwache.beende();
            assert.strictEqual((await stand()).verbindung, 'daemon_weg');
            assert.deepStrictEqual(ausgefallen, [m.daemon_id]);
        });
        await pruefe('ein gewöhnlicher Ausfall setzt den Daemon nach der Frist offline', async () => {
            ausgefallen.length = 0;
            verbunden = true;
            await bwache.angemeldet(m.daemon_id);
            verbunden = false;
            await bwache.getrennt(m.daemon_id);
            await bwache._pruefeNach(m.daemon_id);
            bwache.beende();
            assert.deepStrictEqual(ausgefallen, [m.daemon_id]);
            verbunden = true;
            await bwache.angemeldet(m.daemon_id);
        });
    } finally {
        await roh.end();
    }

    console.log(fehler ? `\n❌ ${fehler} Prüfung(en) rot` : '\n✅ Das Panel sagt, was es weiß');
    process.exit(fehler ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
