#!/usr/bin/env node
/**
 * Die Spielfassung eines Servers (Stufe 10 S3, 2026-10-27).
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 *
 *   Deuten     die echte Datei von Satisfactory (am 2026-10-27 vom Volume der
 *              Sitzung wbb853174f89 abgeschrieben) → Build 513885, „1.2.4.1";
 *              was fehlt oder kaputt ist, sagt warum
 *   Ein Weg    fuerMods: mit management.game_version der gespeicherte Build,
 *              sonst frisch gelesen und gemerkt; ohne Angabe wie bisher bei
 *              Minecraft (Einstellung, sonst Merkzettel) — über dieselbe Lesung
 *   Merken     ein Fehlschlag überschreibt den letzten Stand nicht
 *   Weiter     Installieren, Vorschau, Aktualisieren und die vorgemerkten Mods
 *              reichen die Spielfassung bis zur Auflösung durch
 *   Anzeige    „Spiel" im Paket-Block nur mit gelesenem Build
 *   Schema     game_version ist erlaubt, ein Pfad aus game/ hinaus nicht
 *   Datenbank  die Migration an einer TEMPORARY-Kopie, der Bestand unberührt
 *
 *   node scripts/check-spielfassung.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const HELFER = path.join(WURZEL, 'plugins/gameserver/dashboard/helpers');

// Die Datei, wie sie am Volume lag (2026-10-27).
const ECHT = '{\n\t"MajorVersion": 5,\n\t"MinorVersion": 6,\n\t"PatchVersion": 1,\n\t"Changelist": 513885,\n\t"CompatibleChangelist": 0,\n'
    + '\t"IsLicenseeVersion": 1,\n\t"IsPromotedBuild": 1,\n\t"BranchName": "++FactoryGame+rel-main-anniversary-2026",\n'
    + '\t"BuildId": "513885",\n\t"GameVersion": "1.2.4.1"\n}';
const ANGABE = { file: 'Engine/Binaries/Linux/FactoryServer-Linux-Shipping.version', build: 'Changelist', label: 'GameVersion' };
const PAKET = { identity: { slug: 'satisfactory' }, management: { game_version: ANGABE } };

// ── Attrappen: wer was gelesen und geschrieben hat ──────────────────────────
const still = () => {};
ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });
const spur = { gelesen: [], geschrieben: [], dateien: {}, online: true };
ServiceManager.register('dbService', {
    query: async (sql, w) => {
        const t = sql.trim();
        if (/^SELECT daemon_id FROM rootserver WHERE id = \?$/.test(t)) return [{ daemon_id: 'd1' }];
        if (/^UPDATE gameservers SET spielfassung_build = \?, spielfassung_label = \?, spielfassung_am = NOW\(\) WHERE id = \?$/.test(t)) {
            spur.geschrieben.push(w); return {};
        }
        // Werkbank (S5): Entwurf schreiben und „läuft gerade etwas?".
        if (/^UPDATE werkbank_sitzungen SET entwurf = \? WHERE id = \?$/.test(t)) return {};
        if (/FROM werkbank_pruefungen p JOIN werkbank_sitzungen s[\s\S]*p\.status = 'laeuft'/.test(t)) return [];
        if (/^SELECT id FROM werkbank_schritte WHERE sitzung_id = \? AND status = 'laeuft' LIMIT 1$/.test(t)) return [];
        if (/FROM werkbank_laeufe l JOIN werkbank_sitzungen s[\s\S]*l\.status <> 'beendet'/.test(t)) return [];
        throw new Error(`Attrappe kennt die Abfrage nicht: ${t.slice(0, 90)}`);
    },
});
ServiceManager.register('ipmServer', {
    isDaemonOnline: () => spur.online,
    async sendCommand(daemonId, befehl, n) {
        assert.strictEqual(befehl, 'gameserver.files.read');
        spur.gelesen.push(n.path);
        const text = spur.dateien[n.path];
        if (text === undefined) return { success: false, error: 'Datei nicht gefunden' };
        return { success: true, data: { content: Buffer.from(text, 'utf8').toString('base64') } };
    },
});

const Spielfassung = require(path.join(HELFER, 'Spielfassung.js'));
const SERVER = { id: 222, rootserver_id: 55, install_path: '222-satisfactory' };
const neu = () => { spur.gelesen = []; spur.geschrieben = []; spur.dateien = {}; spur.online = true; };
const DATEI = '/game/' + ANGABE.file;

let fehler = 0, bestanden = 0;
async function pruefe(was, tun) {
    neu();
    try { await tun(); bestanden++; console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 4).join('\n      ')}`); }
}

(async () => {
    console.log('\nDeuten');

    await pruefe('die echte Datei von Satisfactory: Build 513885, „1.2.4.1"', () => {
        assert.deepStrictEqual(Spielfassung.deute(ECHT, ANGABE), { build: '513885', label: '1.2.4.1' });
        assert.deepStrictEqual(Spielfassung.deute(ECHT, { ...ANGABE, label: undefined }), { build: '513885', label: null });
    });

    await pruefe('was nicht passt, sagt warum — nie eine geratene Fassung', () => {
        assert.match(Spielfassung.deute('kein json', ANGABE).fehler, /kein JSON/);
        assert.match(Spielfassung.deute('{"X":1}', ANGABE).fehler, /„Changelist" steht nicht in der Datei/);
        assert.match(Spielfassung.deute(`{"Changelist":"${'9'.repeat(60)}"}`, ANGABE).fehler, /keine Fassung/);
        assert.strictEqual(Spielfassung.angabe({ management: {} }), null);
        assert.strictEqual(Spielfassung.angabe({ management: { game_version: { file: 'x' } } }), null, 'ohne build ist es keine Angabe');
    });

    console.log('\nEin Weg für die Mod-Suche');

    await pruefe('mit Angabe und gespeichertem Build: kein Daemon-Aufruf', async () => {
        assert.strictEqual(await Spielfassung.fuerMods({ ...SERVER, spielfassung_build: '513885' }, PAKET), '513885');
        assert.deepStrictEqual(spur.gelesen, []);
    });

    await pruefe('mit Angabe, noch nie gelesen: liest die Datei unter game/ und merkt sie', async () => {
        spur.dateien[DATEI] = ECHT;
        assert.strictEqual(await Spielfassung.fuerMods({ ...SERVER, spielfassung_build: null }, PAKET), '513885');
        assert.deepStrictEqual(spur.gelesen, [DATEI]);
        assert.deepStrictEqual(spur.geschrieben, [['513885', '1.2.4.1', 222]]);
    });

    await pruefe('ohne Angabe wie bisher bei Minecraft: Einstellung, sonst Merkzettel', async () => {
        assert.strictEqual(await Spielfassung.fuerMods({ ...SERVER, paket_werte: '{"version":"1.21.1"}' }, { management: {} }), '1.21.1');
        assert.deepStrictEqual(spur.gelesen, []);
        spur.dateien['/.fb/minecraft-version'] = '1.21.4\n';
        assert.strictEqual(await Spielfassung.fuerMods({ ...SERVER, paket_werte: { version: 'latest' } }, null), '1.21.4');
        assert.deepStrictEqual(spur.gelesen, ['/.fb/minecraft-version']);
        assert.deepStrictEqual(spur.geschrieben, [], 'ohne Angabe wird nichts gemerkt');
    });

    await pruefe('ein Fehlschlag überschreibt den letzten Stand nicht', async () => {
        assert.strictEqual(await Spielfassung.aktualisiere(SERVER, PAKET), null, 'Datei fehlt');
        spur.online = false;
        assert.strictEqual(await Spielfassung.aktualisiere(SERVER, PAKET), null, 'Daemon weg');
        spur.online = true;
        spur.dateien[DATEI] = '{"Changelist": ""}';
        assert.strictEqual(await Spielfassung.aktualisiere(SERVER, PAKET), null, 'leerer Build');
        assert.deepStrictEqual(spur.geschrieben, []);
    });

    console.log('\nDurchgereicht bis zur Auflösung');

    await pruefe('Installieren, Vorschau, Aktualisieren und Vorgemerktes geben die Spielfassung weiter', async () => {
        const Quellen = require(path.join(HELFER, 'Quellen.js'));
        const Ficsit = Quellen.fuer('ficsit');
        const echt = { aufloesen: Ficsit.aufloesen, paket: Ficsit.paket };
        const gesehen = [];
        Ficsit.aufloesen = async (raum, kennung, fassung, optionen) => { gesehen.push(['aufloesen', optionen?.spielfassung]); return { pakete: [], fehlend: [] }; };
        Ficsit.paket = async (raum, kennung, fassung, optionen) => { gesehen.push(['paket', optionen?.spielfassung]); return { kennung, fassung: '1.0.0' }; };
        try {
            const H = require(path.join(HELFER, 'InhalteHolen.js'));
            const inhalt = { supported: true, sources: ['ficsit'], source_ids: { ficsit: 'satisfactory' }, path: 'game/FactoryGame/Mods/{{content:key}}' };
            await H.vorschau({ serverId: null, inhalt, quelle: 'ficsit', kennung: 'PowerChecker', spielfassung: '513885' });
            await H.aktualisiere({ server: SERVER, inhalt, guildId: 'g', zeile: { quelle: 'ficsit', kennung: 'PowerChecker', fassung: '1.0.0' }, spielfassung: '513885' });
        } finally { Object.assign(Ficsit, echt); }
        assert.deepStrictEqual(gesehen, [['aufloesen', '513885'], ['paket', '513885']]);
        // Die Routen und der Haken nach der Installation rufen mit — am Code, ohne Kommentare.
        const route = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/routes/inhalte.js'), 'utf8'));
        for (const aufruf of ['InhalteHolen.vorschau({', 'InhalteHolen.installiere({', 'InhalteHolen.holeGeplante({', 'InhalteHolen.aktualisiere({']) {
            const stelle = route.indexOf(aufruf);
            assert.ok(stelle > 0 && /spielfassung/.test(route.slice(stelle, route.indexOf('});', stelle))), `${aufruf} ohne spielfassung`);
        }
        assert.ok(/aktualisierungen\(raum, seine, \{ spielfassung \}\)/.test(route), 'die Aktualisierungen fragen ohne Spielfassung');
        const index = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/index.js'), 'utf8'));
        assert.ok(/holeGeplante\(\{\s*server, inhalt, guildId: server\.guild_id, spielfassung \}\)/.test(index), 'die vorgemerkten Mods nach der Installation ohne Spielfassung');
        assert.ok(/art === 'started'\)\s*\{\s*require\('\.\/helpers\/Spielfassung'\)\.aktualisiereServer\(server_id\)/.test(index), 'beim Start wird nicht nachgelesen');
    });

    console.log('\nAnzeige');

    await pruefe('„Spiel" im Paket-Block nur mit gelesenem Build', () => {
        const { bauePaketkarte } = require(path.join(HELFER, 'Serverseite.js'));
        const p = { identity: { slug: 'satisfactory', version: '1.0.3' }, image: {} };
        assert.strictEqual(bauePaketkarte({ spielfassung_build: '513885', spielfassung_label: '1.2.4.1' }, p).spiel, '1.2.4.1 (Build 513885)');
        assert.strictEqual(bauePaketkarte({ spielfassung_build: '513885' }, p).spiel, '513885');
        assert.strictEqual(bauePaketkarte({}, p).spiel, null);
        const ansicht = fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/views/guild/partials/server-detail-uebersicht.ejs'), 'utf8');
        assert.ok(ansicht.includes("['Spiel', u.paket.spiel]"), 'die Zeile steht nicht in der Seite');
    });

    console.log('\nWerkbank (S5): Karte „Spielfassung"');

    await pruefe('speichern, leeren, Pfad- und Schlüsselregeln — und das Paket trägt es', async () => {
        const S = require(path.join(WURZEL, 'plugins/werkbank/dashboard/helpers/Sitzungen.js'));
        const sitzung = { id: 1, kennung: 'probe', image: { ref: 'fb/steamcmd', tag: 'latest' },
            entwurf: { identity: { slug: 'satisfactory' }, management: { persist: [] } } };
        await S.spielfassungSpeichern(sitzung, { file: 'game/' + ANGABE.file, build: 'Changelist', label: 'GameVersion' });
        assert.deepStrictEqual(sitzung.entwurf.management.game_version, ANGABE, '„game/" vorn wird abgeschnitten, sonst unverändert');
        assert.deepStrictEqual(S.spielfassungStand(sitzung), { file: ANGABE.file, build: 'Changelist', label: 'GameVersion' });
        assert.deepStrictEqual(S.entwurfAlsPaket(sitzung, []).management.game_version, ANGABE, 'das Paket trägt es nicht');
        await S.spielfassungSpeichern(sitzung, { file: ANGABE.file, build: 'Changelist', label: '' });
        assert.ok(!('label' in sitzung.entwurf.management.game_version), 'eine leere Anzeige steht als Feld da');
        await S.spielfassungSpeichern(sitzung, { file: '', build: '', label: '' });
        assert.ok(!('game_version' in sitzung.entwurf.management), 'leeren nimmt es nicht weg');
        assert.deepStrictEqual(sitzung.entwurf.management, { persist: [] }, 'das Übrige in management ist angefasst');
        for (const [b, muster] of [[{ file: '../x', build: 'C' }, /ohne führenden/], [{ file: '/abs', build: 'C' }, /ohne führenden/],
            [{ file: 'a.version', build: '' }, /Build-Nummer gehört dazu/], [{ file: '', build: 'C' }, /ohne Datei/],
            [{ file: 'a.version', build: 'C', label: 'Game Version' }, /Anzeige aus Buchstaben/]]) {
            await assert.rejects(S.spielfassungSpeichern(sitzung, b), muster);
        }
        await assert.rejects(S.spielfassungProbe(sitzung, { file: '' }), /erst eine Datei/);
        assert.ok(S.EIGENE.management.includes('game_version'), 'ohne Karte fiele es ins Durchgereichte');
    });

    console.log('\nSchema und Datenbank');

    const c = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE });

    await pruefe('das Schema nimmt management.game_version — und keinen Pfad aus game/ hinaus', async () => {
        const Ajv = require('ajv');
        const schema = JSON.parse(fs.readFileSync(path.join(WURZEL, 'packages/fbpkg/schema/fbpkg-v1.schema.json'), 'utf8'));
        const pruefen = new Ajv({ allErrors: true, strict: false }).compile(schema);
        const [[v]] = await c.query(`SELECT v.fbpkg FROM package_versions v JOIN packages p ON p.id = v.package_id
            WHERE p.slug = 'satisfactory' ORDER BY v.id DESC LIMIT 1`);
        const paket = JSON.parse(v.fbpkg);
        const mit = (g) => ({ ...paket, management: { ...(paket.management || {}), game_version: g } });
        assert.ok(pruefen(mit(ANGABE)), JSON.stringify(pruefen.errors).slice(0, 300));
        for (const [g, was] of [[{ ...ANGABE, file: '../etc/passwd' }, '..'], [{ ...ANGABE, file: '/abs' }, 'absolut'],
            [{ file: ANGABE.file }, 'ohne build'], [{ ...ANGABE, parser: 'json' }, 'Formatfeld'], [{ ...ANGABE, zukunft: 1 }, 'fremdes Feld']]) {
            assert.ok(!pruefen(mit(g)), `${was} bestand das Schema`);
        }
    });

    const spalten = async () => (await c.query("SHOW COLUMNS FROM gameservers LIKE 'spielfassung%'"))[0].map(z => z.Field).sort();
    const vorher = await spalten();
    await pruefe('die Migration legt drei Spalten an — an der Kopie; zweimal laufen schadet nicht', async () => {
        await c.query('CREATE TEMPORARY TABLE fb_gs_form LIKE gameservers');
        await c.query('CREATE TEMPORARY TABLE gameservers LIKE fb_gs_form');
        const [[k]] = await c.query('SHOW CREATE TABLE gameservers');
        assert.match(k['Create Table'], /^CREATE TEMPORARY TABLE/, 'die Kopie verdeckt den Bestand nicht — abgebrochen');
        if (vorher.length === 3) return;   // Bestand hat sie schon — die Migration lief
        const m = require(path.join(WURZEL, 'plugins/gameserver/migrations/20261027_140000_spielfassung_am_server.js'));
        // information_schema sieht nur den Bestand: An der Kopie legt die
        // Migration an, was dem Bestand fehlt — genau das, was sie dort täte.
        // Wie dbService in der Produktion: execute, also Prepared Statements —
        // mit c.query lief am 2026-10-27 eine Migration grün, die dort scheiterte.
        const db = { query: async (sql, w = []) => (await c.execute(sql, w))[0] };
        await m.up(db);
        await m.up(db);   // zweites Mal: nichts zu tun
        assert.deepStrictEqual(await spalten(), ['spielfassung_am', 'spielfassung_build', 'spielfassung_label']);
    });
    await c.query('DROP TEMPORARY TABLE IF EXISTS gameservers');
    await c.query('DROP TEMPORARY TABLE IF EXISTS fb_gs_form');
    await pruefe('der Bestand ist unberührt', async () => assert.deepStrictEqual(await spalten(), vorher));
    await c.end();

    console.log(fehler ? `\n✗ ${fehler} gescheitert, ${bestanden} bestanden` : `\n✓ ${bestanden} bestanden`);
    process.exit(fehler ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
