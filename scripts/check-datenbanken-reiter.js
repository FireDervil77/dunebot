#!/usr/bin/env node
/**
 * Datenbanken je Server im Panel — Stufe 11 S3 (2026-10-27).
 *
 * Betreiber: „wo zum Henker kann ich das beim Gameserver anlegen überhaupt
 * einsehen?" Jetzt im Bereich „Datenbanken" der Serverseite.
 *
 *   Tabelle    Migration an einer TEMPORARY-Kopie, über execute wie dbService
 *   Regeln     stand(): wann anlegen geht und warum nicht; Grenze db_je_server
 *   Anlegen    Befehl an den Daemon des Servers, Kennwort nur verschlüsselt
 *              gespeichert (D4 = a), Zeile scheitert → im Container abbauen
 *   Löschen    „gibt es nicht" → Zeile weg; anderer Fehler → Zeile bleibt
 *   Größe      fehlt/fremd beim Abgleich mit db.liste
 *   Rechte     Zugang/Kennwort/Anlegen/Löschen nur mit FILES.MANAGE
 *   Ansicht    Knöpfe nur mit Recht; kein Kennwort im HTML; Löschen mit Namen
 *
 *   node scripts/check-datenbanken-reiter.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ejs = require('ejs');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const still = () => {};
const logs = [];
ServiceManager.register('Logger', { debug: still, info: still, warn: (t) => logs.push(t), error: still, success: still });

// ── Attrappen ────────────────────────────────────────────────────────────────
const spur = { zeilen: [], befehle: [], online: true, fehlerBei: {}, insertFehler: false };
ServiceManager.register('dbService', {
    query: async (sql, w = []) => {
        const t = sql.replace(/\s+/g, ' ').trim();
        if (/^SELECT nr, name, bytes, groesse_am, created_at FROM gameserver_datenbanken WHERE server_id = \? ORDER BY nr$/.test(t)) {
            return spur.zeilen.filter(z => z.server_id === w[0]).sort((a, b) => a.nr - b.nr);
        }
        if (/^INSERT INTO gameserver_datenbanken \(server_id, guild_id, nr, name, kennwort_ver\) VALUES/.test(t)) {
            if (spur.insertFehler) throw new Error('Duplicate entry');
            spur.zeilen.push({ server_id: w[0], guild_id: w[1], nr: w[2], name: w[3], kennwort_ver: w[4], bytes: null, groesse_am: null });
            return {};
        }
        if (/^SELECT name, kennwort_ver FROM gameserver_datenbanken WHERE server_id = \? AND nr = \?$/.test(t)
            || /^SELECT name FROM gameserver_datenbanken WHERE server_id = \? AND nr = \?$/.test(t)) {
            return spur.zeilen.filter(z => z.server_id === w[0] && z.nr === w[1]);
        }
        if (/^UPDATE gameserver_datenbanken SET kennwort_ver = \? WHERE server_id = \? AND nr = \?$/.test(t)) {
            spur.zeilen.filter(z => z.server_id === w[1] && z.nr === w[2]).forEach(z => { z.kennwort_ver = w[0]; });
            return {};
        }
        if (/^UPDATE gameserver_datenbanken SET bytes = \?, groesse_am = NOW\(\) WHERE server_id = \? AND nr = \?$/.test(t)) {
            spur.zeilen.filter(z => z.server_id === w[1] && z.nr === w[2]).forEach(z => { z.bytes = w[0]; z.groesse_am = new Date(); });
            return {};
        }
        if (/^DELETE FROM gameserver_datenbanken WHERE server_id = \? AND nr = \?$/.test(t)) {
            spur.zeilen = spur.zeilen.filter(z => !(z.server_id === w[0] && z.nr === w[1]));
            return {};
        }
        throw new Error('Attrappe kennt die Abfrage nicht: ' + t.slice(0, 100));
    },
});
ServiceManager.register('ipmServer', {
    isDaemonOnline: () => spur.online,
    async sendCommand(daemonId, aktion, nutzlast) {
        spur.befehle.push([daemonId, aktion, nutzlast]);
        if (spur.fehlerBei[aktion]) throw new Error(spur.fehlerBei[aktion]);
        const name = `s${nutzlast.server_id}_${nutzlast.nr}`;
        if (aktion === 'db.anlegen' || aktion === 'db.kennwort') {
            return { success: true, zugang: { name, benutzer: name, kennwort: 'K' + Math.random().toString(36).slice(2, 12), host: 'fb-datenbank', port: 3306 } };
        }
        if (aktion === 'db.loeschen') return { success: true, geloescht: true };
        if (aktion === 'db.liste') return { success: true, datenbanken: [{ name: 's222_1', bytes: 65536 }, { name: 's222_7', bytes: 0 }] };
        throw new Error('unerwartet: ' + aktion);
    },
});

const D = require(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/Datenbanken.js'));
const { decrypt } = require(path.join(WURZEL, 'apps/dashboard/helpers/utils.js'));
const SERVER = { id: 222, guild_id: 'g1', daemon_id: 'd55', db_gewuenscht: 1, db_moeglich: 1, db_grund: 'läuft', db_je_server: 2 };

let fehler = 0, bestanden = 0;
async function pruefe(was, tun) {
    spur.befehle = []; spur.online = true; spur.fehlerBei = {}; spur.insertFehler = false; logs.length = 0;
    try { await tun(); bestanden++; console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 4).join('\n      ')}`); }
}
const wirft = async (fn, muster, status) => {
    try { await fn(); } catch (e) {
        assert.match(e.message, muster);
        if (status) assert.strictEqual(e.status, status, `Status ${e.status} statt ${status}`);
        return e;
    }
    throw new Error('kein Fehler, erwartet ' + muster);
};

(async () => {
    console.log('\nTabelle');

    await pruefe('Migration legt die Tabelle an (an einer TEMPORARY-Kopie, über execute)', async () => {
        const mig = require(path.join(WURZEL, 'plugins/gameserver/migrations/20261027_200000_gameserver_datenbanken.js'));
        const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
            user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE });
        try {
            const gesehen = [];
            await mig.up({ query: async (sql) => {
                const kopie = sql.replace('CREATE TABLE IF NOT EXISTS gameserver_datenbanken', 'CREATE TEMPORARY TABLE fb_probe_datenbanken');
                assert.notStrictEqual(kopie, sql, 'die Anweisung hat sich geändert — der Wächter müsste nachziehen');
                gesehen.push(kopie);
                const [r] = await conn.execute(kopie);
                return r;
            } });
            const [spalten] = await conn.execute('SHOW COLUMNS FROM fb_probe_datenbanken');
            const namen = spalten.map(s => s.Field);
            for (const s of ['server_id', 'guild_id', 'nr', 'name', 'kennwort_ver', 'bytes', 'groesse_am']) assert.ok(namen.includes(s), `Spalte ${s} fehlt`);
            assert.ok(!namen.includes('kennwort'), 'eine Klartextspalte');
            await conn.execute("INSERT INTO fb_probe_datenbanken (server_id, guild_id, nr, name, kennwort_ver) VALUES (1,'g',1,'s1_1','x')");
            await assert.rejects(conn.execute("INSERT INTO fb_probe_datenbanken (server_id, guild_id, nr, name, kennwort_ver) VALUES (1,'g',1,'s1_9','x')"), /Duplicate/, 'zweimal Nummer 1');
            assert.ok(!/FOREIGN KEY/i.test(gesehen.join(' ')), 'Fremdschlüssel: CASCADE vergäße die Datenbank im Container, RESTRICT blockierte das Löschen des Servers');
        } finally { await conn.end(); }
    });

    console.log('\nRegeln');

    await pruefe('stand(): ohne Wunsch, ohne laufenden Container, ohne Rootserver — je ein Satz; Grenze zählt', () => {
        assert.match(D.stand({ ...SERVER, db_gewuenscht: 0 }, 0).grund, /bietet keine Datenbanken an/);
        assert.strictEqual(D.stand({ ...SERVER, db_moeglich: 0, db_grund: 'Gewünscht, läuft aber nicht: X' }, 0).grund, 'Gewünscht, läuft aber nicht: X');
        assert.match(D.stand({ ...SERVER, daemon_id: null }, 0).grund, /keinem Rootserver/);
        assert.deepStrictEqual(D.stand(SERVER, 1), { moeglich: true, grund: null, grenze: 2, anzahl: 1, frei: true });
        const voll = D.stand(SERVER, 2);
        assert.strictEqual(voll.frei, false);
        assert.match(voll.grund, /Grenze ist erreicht: 2/);
    });

    await pruefe('freieNummer: die kleinste freie, Lücken werden gefüllt', () => {
        assert.strictEqual(D.freieNummer([]), 1);
        assert.strictEqual(D.freieNummer([{ nr: 1 }, { nr: 3 }]), 2);
        assert.strictEqual(D.freieNummer(Array.from({ length: 99 }, (_, i) => ({ nr: i + 1 }))), null);
    });

    console.log('\nAnlegen, Zugang, Kennwort');

    await pruefe('anlegen: Befehl an den Daemon des Servers, Kennwort nur verschlüsselt gespeichert', async () => {
        spur.zeilen = [];
        const z = await D.anlegen(SERVER);
        assert.deepStrictEqual(spur.befehle[0].slice(0, 3), ['d55', 'db.anlegen', { server_id: 222, nr: 1 }]);
        assert.strictEqual(z.name, 's222_1');
        assert.strictEqual(z.host, 'fb-datenbank');
        const zeile = spur.zeilen[0];
        assert.ok(!zeile.kennwort_ver.includes(z.kennwort), 'Klartext gespeichert');
        assert.strictEqual(decrypt(zeile.kennwort_ver), z.kennwort, 'nicht zurückholbar');
    });

    await pruefe('anlegen: Grenze erreicht, Rootserver getrennt — kein Befehl, klarer Status', async () => {
        spur.zeilen = [{ server_id: 222, nr: 1, name: 's222_1' }, { server_id: 222, nr: 2, name: 's222_2' }];
        await wirft(() => D.anlegen(SERVER), /Grenze ist erreicht/, 409);
        spur.zeilen = [];
        spur.online = false;
        await wirft(() => D.anlegen(SERVER), /nicht verbunden/, 503);
        assert.strictEqual(spur.befehle.length, 0);
    });

    await pruefe('anlegen: Zeile scheitert → im Container wieder abbauen', async () => {
        spur.zeilen = [];
        spur.insertFehler = true;
        await wirft(() => D.anlegen(SERVER), /Duplicate/);
        assert.deepStrictEqual(spur.befehle.map(b => b[1]), ['db.anlegen', 'db.loeschen']);
    });

    await pruefe('anlegen: auch der Abbau scheitert → steht im Log und in der Meldung, nicht verschluckt', async () => {
        spur.zeilen = [];
        spur.insertFehler = true;
        spur.fehlerBei['db.loeschen'] = 'Container weg';
        await wirft(() => D.anlegen(SERVER), /s222_1 bleibt im Container, Abbau gescheitert: Container weg/);
        assert.ok(logs.some(l => /nicht wieder entfernt: Container weg/.test(l)), 'kein Logeintrag');
    });

    await pruefe('zugang entschlüsselt; neuesKennwort speichert das neue verschlüsselt', async () => {
        spur.zeilen = [];
        const erst = await D.anlegen(SERVER);
        assert.strictEqual((await D.zugang(SERVER, 1)).kennwort, erst.kennwort);
        const neu = await D.neuesKennwort(SERVER, 1);
        assert.notStrictEqual(neu.kennwort, erst.kennwort);
        assert.strictEqual((await D.zugang(SERVER, 1)).kennwort, neu.kennwort);
        await wirft(() => D.zugang(SERVER, 9), /gibt es nicht/, 404);
    });

    console.log('\nLöschen und Größe');

    await pruefe('löschen: „gibt es nicht" im Container → Zeile weg; anderer Fehler → Zeile bleibt', async () => {
        spur.zeilen = [];
        await D.anlegen(SERVER);
        await D.anlegen(SERVER);
        spur.fehlerBei['db.loeschen'] = 'datenbank gibt es nicht: s222_1';
        assert.deepStrictEqual(await D.loeschen(SERVER, 1), { name: 's222_1', schonWeg: true });
        spur.fehlerBei['db.loeschen'] = 'Container läuft nicht';
        await wirft(() => D.loeschen(SERVER, 2), /läuft nicht/);
        assert.deepStrictEqual(spur.zeilen.map(z => z.name), ['s222_2'], 'die Zeile von s222_2 muss bleiben');
    });

    await pruefe('Größe: gespeichert, als Text; fehlt/fremd beim Abgleich; nie gemessen ist keine 0', async () => {
        spur.zeilen = [];
        await D.anlegen(SERVER);
        await D.anlegen(SERVER);
        assert.strictEqual((await D.liste(222))[0].groesse, 'nie gemessen');
        const a = await D.groessenMessen(SERVER);
        assert.deepStrictEqual(a, { fehlt: ['s222_2'], fremd: ['s222_7'] });
        const l = await D.liste(222);
        assert.strictEqual(l[0].bytes, 65536);
        assert.strictEqual(l[0].groesse, '64 KB');
        assert.strictEqual(l[1].groesse, 'nie gemessen');
        assert.strictEqual(D.groesseText(0), '0 B');
        assert.strictEqual(D.groesseText(1536 * 1024), '1,5 MB');
    });

    console.log('\nRouten und Rechte');

    const quelle = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/routes/datenbanken.js'), 'utf8'));
    await pruefe('Zugang, Kennwort, Anlegen, Löschen verlangen GAMESERVER.FILES.MANAGE; Liste/Größe GAMESERVER.VIEW', () => {
        const recht = (methode, pfad) => {
            const m = quelle.match(new RegExp(`router\\.${methode}\\('${pfad.replace(/[/:]/g, c => '\\' + c)}', requirePermission\\('([A-Z.]+)'\\)`));
            return m && m[1];
        };
        assert.strictEqual(recht('get', '/:serverId/datenbanken'), 'GAMESERVER.VIEW');
        assert.strictEqual(recht('post', '/:serverId/datenbanken/groessen'), 'GAMESERVER.VIEW');
        for (const [m, p] of [['post', '/:serverId/datenbanken'], ['get', '/:serverId/datenbanken/:nr/zugang'],
            ['post', '/:serverId/datenbanken/:nr/kennwort'], ['delete', '/:serverId/datenbanken/:nr']]) {
            assert.strictEqual(recht(m, p), 'GAMESERVER.FILES.MANAGE', `${m} ${p}`);
        }
    });

    await pruefe('Löschen nur mit eingetipptem Namen', async () => {
        const router = require(path.join(WURZEL, 'plugins/gameserver/dashboard/routes/datenbanken.js'));
        const handle = router.stack.find(l => l.route?.path === '/:serverId/datenbanken/:nr' && l.route.methods.delete).route.stack.at(-1).handle;
        const echt = D.ladeServer;
        D.ladeServer = async () => SERVER;
        try {
            spur.zeilen = [];
            await D.anlegen(SERVER);
            const antwort = async (body) => {
                const a = {};
                await handle({ params: { serverId: '222', nr: '1' }, body }, { locals: { guildId: 'g1' },
                    status(c) { a.c = c; return this; }, json(o) { Object.assign(a, o); return this; } });
                return a;
            };
            const falsch = await antwort({ bestaetigung: 's222_2' });
            assert.strictEqual(falsch.c, 400);
            assert.match(falsch.message, /Namen eintippen: s222_1/);
            assert.strictEqual(spur.zeilen.length, 1);
            const recht = await antwort({ bestaetigung: 's222_1' });
            assert.strictEqual(recht.success, true);
            assert.strictEqual(spur.zeilen.length, 0);
        } finally { D.ladeServer = echt; }
    });

    await pruefe('der Router hängt VOR dem Dateimanager, der Bereich steht in Route und Navigation', () => {
        const idx = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/index.js'), 'utf8'));
        const a = idx.indexOf("require('./routes/datenbanken')"), b = idx.indexOf("this.guildRouter.use('/', filesRouter)");
        assert.ok(a > 0 && a < b, 'nicht oder hinter filesRouter eingehängt');
        const srv = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/routes/servers.js'), 'utf8'));
        assert.ok(/datenbanken: 'Datenbanken',/.test(srv), 'BEREICHE kennt datenbanken nicht');
        const detail = fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/views/guild/server-detail.ejs'), 'utf8');
        assert.ok(detail.includes("['datenbanken',  'Datenbanken']"), 'Navigation');
        assert.ok(detail.includes("include('partials/server-detail-datenbanken'"), 'Vorlage nicht eingebunden');
    });

    console.log('\nAnsicht');

    const VORLAGE = path.join(WURZEL, 'plugins/gameserver/dashboard/views/guild/partials/server-detail-datenbanken.ejs');
    const zeichne = (recht, datenbanken) => ejs.render(fs.readFileSync(VORLAGE, 'utf8'),
        { server: { id: 222 }, guildId: 'g1', userPermissions: { permissions: recht ? { 'GAMESERVER.FILES.MANAGE': true } : {} }, datenbanken },
        { filename: VORLAGE });
    const LISTE = [{ nr: 1, name: 's222_1', bytes: 65536, groesse: '64 KB', groesse_am: new Date(), created_at: new Date() }];

    await pruefe('mit Recht: Anlegen, Zugangsdaten, Kennwort, Löschen mit rotem Dialog — aber kein Kennwort im HTML', () => {
        const html = zeichne(true, { stand: D.stand(SERVER, 1), liste: LISTE });
        for (const t of ['id="dbAnlegen"', 'data-aktion="zugang"', 'data-aktion="kennwort"', 'data-aktion="loeschen"',
            'lässt sich nicht zurücknehmen', 'id="dbLoeschenEingabe"', '1</strong> von <strong>2', '64 KB']) {
            assert.ok(html.includes(t), `fehlt: ${t}`);
        }
        assert.ok(!/kennwort_ver|"kennwort":/.test(html), 'Kennwort im HTML');
    });

    await pruefe('ohne Recht: nur Liste und Messen; Grenze erreicht: kein Anlegen; nicht möglich: der Grund', () => {
        const ohne = zeichne(false, { stand: D.stand(SERVER, 1), liste: LISTE });
        for (const t of ['id="dbAnlegen"', 'data-aktion="zugang"', 'data-aktion="loeschen"', 'id="dbLoeschenModal"']) assert.ok(!ohne.includes(t), `ohne Recht sichtbar: ${t}`);
        assert.ok(ohne.includes('id="dbMessen"'));
        const voll = zeichne(true, { stand: D.stand(SERVER, 2), liste: LISTE });
        assert.ok(!voll.includes('id="dbAnlegen"') && voll.includes('Grenze ist erreicht'));
        const aus = zeichne(true, { stand: D.stand({ ...SERVER, db_gewuenscht: 0 }, 0), liste: [] });
        assert.ok(aus.includes('bietet keine Datenbanken an') && !aus.includes('id="dbAnlegen"'));
    });

    console.log(fehler ? `\n✗ ${fehler} gescheitert, ${bestanden} bestanden` : `\n✓ ${bestanden} bestanden`);
    process.exit(fehler ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
