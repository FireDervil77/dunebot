#!/usr/bin/env node
/**
 * SFTP für eigene Programme (Baustelle 203, 2026-10-27).
 *
 * Betreiber: SFTP für externe Programme (FileZilla & Co.) wird geschaltet wie
 * Datenbank und FastDL — Häkchen am Rootserver, über die Absicht an den
 * Wizard, Befund beim Verbinden. Vorgabe aus. Der Dateimanager im Panel hängt
 * nicht daran.
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 *
 *   Regel      leiteSftpAb: Wunsch gegen Port/Grund des Daemons, in Worten
 *   Absicht    die Anmeldung schickt `sftp` an den Wizard mit
 *   Befund     uebernimmSftp schreibt Port (auch NULL), möglich und Grund
 *   Formular   Anlegen nimmt den Wunsch an; Bearbeiten auch — mit „aus"
 *   Karte      Reiter „Dateien": Zugangsdaten nur bei möglich; Knopf nur mit
 *              GAMESERVER.FILES.MANAGE; sonst ein Satz, warum nicht
 *   Recht      Passwort setzen verlangt GAMESERVER.FILES.MANAGE
 *   Datenbank  Migration an einer TEMPORARY-Kopie, über execute wie dbService
 *
 *   node scripts/check-sftp.js
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
ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });

const spur = { abfragen: [], zeile: { sftp_gewuenscht: 1 } };
ServiceManager.register('dbService', {
    query: async (sql, w) => {
        spur.abfragen.push([sql.trim(), w]);
        if (/^SELECT sftp_gewuenscht FROM rootserver WHERE daemon_id = \?$/.test(sql.trim())) return spur.zeile ? [spur.zeile] : [];
        if (/^UPDATE rootserver SET sftp_port = \?, sftp_moeglich = \?, sftp_grund = \? WHERE daemon_id = \?$/.test(sql.trim())) return {};
        if (/^UPDATE rootserver SET sftp_fingerprint = \? WHERE daemon_id = \?$/.test(sql.trim())) return {};
        if (/^SELECT MIN\(port\) AS von, MAX\(port\) AS bis FROM port_allocations WHERE rootserver_id = \?$/.test(sql.trim())) return [{ von: 25000, bis: 26000 }];
        throw new Error('Attrappe kennt die Abfrage nicht: ' + sql.trim().slice(0, 80));
    },
});

const M = require(path.join(WURZEL, 'plugins/masterserver/dashboard/helpers/Maschinenbefund.js'));
const RootServer = require(path.join(WURZEL, 'plugins/masterserver/dashboard/models/RootServer.js'));

let fehler = 0, bestanden = 0;
async function pruefe(was, tun) {
    spur.abfragen = [];
    try { await tun(); bestanden++; console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 4).join('\n      ')}`); }
}

(async () => {
    console.log('\nRegel und Befund');

    await pruefe('leiteSftpAb: möglich nur mit Wunsch UND laufendem Dienst — sonst ein Satz, was fehlt', () => {
        assert.deepStrictEqual(M.leiteSftpAb(true, 2022, null), { moeglich: 1, grund: 'Läuft auf Port 2022.' });
        assert.deepStrictEqual(M.leiteSftpAb(false, null, null), { moeglich: 0, grund: 'Nicht angefordert.' });
        assert.match(M.leiteSftpAb(false, 2022, null).grund, /nicht gewünscht — angeboten wird er nicht/);
        assert.match(M.leiteSftpAb(true, null, 'abgeschaltet (sftp.enabled: false)').grund, /noch nicht übernommen — er tut es bei der nächsten Anmeldung/);
        assert.match(M.leiteSftpAb(true, null, 'Start gescheitert: Port belegt').grund, /läuft aber nicht: Start gescheitert: Port belegt/);
        assert.match(M.leiteSftpAb(true, null, null).grund, /meldet keinen SFTP-Server/);
        assert.strictEqual(M.leiteSftpAb(true, 0, null).moeglich, 0, 'Port 0 ist kein Port');
    });

    await pruefe('sftpPortFehler: leer = 2022; nur 1024–65535, nicht SSH/Web/MySQL/Daemon/Abruf, nicht im Spielport-Bereich', () => {
        for (const leer of [null, undefined, '', '  ']) assert.strictEqual(M.sftpPortFehler(leer), null);
        assert.strictEqual(M.sftpPortFehler('2222', { von: 25000, bis: 26000 }), null);
        assert.match(M.sftpPortFehler('80'), /1024 bis 65535/);
        assert.match(M.sftpPortFehler('70000'), /1024 bis 65535/);
        assert.match(M.sftpPortFehler('22.5'), /ganze Zahl/);
        assert.match(M.sftpPortFehler(9340), /gehört Daemon/);
        assert.match(M.sftpPortFehler(9350), /gehört Sicherungsabruf/);
        assert.match(M.sftpPortFehler(3306), /gehört MySQL/);
        assert.match(M.sftpPortFehler(25500, { von: 25000, bis: 26000 }), /Bereich der Spielports \(25000–26000\)/);
    });

    await pruefe('uebernimmSftp: Port, möglich und Grund — und ein Port, der nicht mehr läuft, wird gelöscht', async () => {
        await RootServer.uebernimmSftp('d1', { port: 2022, grund: null });
        assert.deepStrictEqual(spur.abfragen[1][1], [2022, 1, 'Läuft auf Port 2022.', 'd1']);
        spur.abfragen = [];
        await RootServer.uebernimmSftp('d1', { port: null, grund: 'in der daemon.yaml abgeschaltet (sftp.enabled: false)' });
        assert.strictEqual(spur.abfragen[1][1][0], null, 'der alte Port bliebe stehen');
        assert.strictEqual(spur.abfragen[1][1][1], 0);
    });

    await pruefe('die Absicht an den Wizard trägt sftp — und die Anmeldung übernimmt den Befund in beiden Wegen', () => {
        const ipm = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'apps/dashboard/helpers/IPMServer.js'), 'utf8'));
        assert.ok(/sftp:\s*!!zeile\.sftp_gewuenscht/.test(ipm), 'die Absicht nennt sftp nicht');
        assert.ok(/sftp_port:\s*Number\(zeile\.sftp_port_wunsch\) \|\| 0/.test(ipm), 'die Absicht nennt den Port nicht');
        assert.ok(/eventRouter\.register\('sftp', 'befund'/.test(ipm), 'der Befund nach dem Anwenden wird nicht übernommen');
        assert.ok(/sftp_port, sftp_grund,/.test(ipm), 'sftp_grund wird nicht gelesen');
        assert.strictEqual((ipm.match(/await RootServer\.uebernimmSftp\(daemon_id, \{ port: sftp_port \|\| null, grund: sftp_grund \|\| null \}\)/g) || []).length, 2,
            'Wiederanmeldung UND Erstanmeldung übernehmen den Befund');
    });

    console.log('\nFormular und Recht');

    await pruefe('Anlegen nimmt den Wunsch an; Bearbeiten auch „aus" — und ohne Feld bleibt er', async () => {
        const router = require(path.join(WURZEL, 'plugins/masterserver/dashboard/routes/rootserver.router.js'));
        const handle = (methode, pfad) => router.stack.find(l => l.route?.path === pfad && l.route.methods[methode]).route.stack.at(-1).handle;
        const echt = { getById: RootServer.getById, update: RootServer.update };
        const gesehen = [];
        RootServer.getById = async () => ({ id: 54, guild_id: 'g1' });
        RootServer.update = async (id, daten) => { gesehen.push(daten.sftp_gewuenscht); };
        const res = { locals: { guildId: 'g1' }, status() { return this; }, json() { return this; } };
        try {
            for (const wert of ['true', 'false', undefined]) {
                await handle('put', '/:id')({ params: { id: '54' }, body: { name: 'x', ...(wert === undefined ? {} : { sftp_gewuenscht: wert }) } }, res);
            }
            // Port: im Spielport-Bereich abgewiesen, ehe etwas gespeichert wird; leer = Vorgabe.
            let antwort = null;
            const res2 = { locals: { guildId: 'g1' }, status(c) { this.c = c; return this; }, json(o) { antwort = { c: this.c, ...o }; return this; } };
            await handle('put', '/:id')({ params: { id: '54' }, body: { name: 'x', sftp_port_wunsch: '25500' } }, res2);
            assert.strictEqual(antwort.c, 400);
            assert.match(antwort.message, /Bereich der Spielports/);
            await handle('put', '/:id')({ params: { id: '54' }, body: { name: 'x', sftp_gewuenscht: 'true', sftp_port_wunsch: '2222' } }, res2);
            assert.match(antwort.message, /SFTP: gilt, sobald der Daemon sich wieder anmeldet/, 'ohne verbundenen Daemon sagt die Antwort, wann es gilt');
        } finally { Object.assign(RootServer, echt); }
        assert.deepStrictEqual(gesehen, [1, 0, undefined, 1]);
        const quelle = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/masterserver/dashboard/routes/rootserver.router.js'), 'utf8'));
        assert.ok(/sftpGewuenscht: sftpGewuenscht === 'true' \|\| sftpGewuenscht === true/.test(quelle), 'Anlegen reicht den Wunsch nicht weiter');
        const modell = fs.readFileSync(path.join(WURZEL, 'plugins/masterserver/dashboard/models/RootServer.js'), 'utf8');
        assert.ok(/db_gewuenscht, db_je_server, sftp_gewuenscht,/.test(modell) && /data\.sftpGewuenscht \? 1 : 0/.test(modell), 'das INSERT kennt sftp_gewuenscht nicht');
        const detail = fs.readFileSync(path.join(WURZEL, 'plugins/masterserver/dashboard/views/guild/masterserver-rootserver-detail.ejs'), 'utf8');
        const v = detail.indexOf('name="sftp_gewuenscht" value="false"'), k = detail.indexOf('id="editSftp" name="sftp_gewuenscht" value="true"');
        assert.ok(v > 0 && k > v, 'das versteckte „false" muss VOR dem Kästchen stehen');
    });

    await pruefe('Passwort setzen verlangt GAMESERVER.FILES.MANAGE', () => {
        const s = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/routes/servers.js'), 'utf8'));
        assert.ok(/router\.post\('\/:serverId\/sftp\/reset-password', requirePermission\('GAMESERVER\.FILES\.MANAGE'\)/.test(s));
    });

    console.log('\nKarte im Reiter „Dateien"');

    const VORLAGE = path.join(WURZEL, 'plugins/gameserver/dashboard/views/guild/partials/server-detail-sftp.ejs');
    const zeichne = (server, canManage) => ejs.render(fs.readFileSync(VORLAGE, 'utf8'), { server, guildId: 'g1', canManage }, { filename: VORLAGE });
    const SERVER = { id: 223, sftp_username: 'gs-00000223', rootserver_ip: '91.200.102.182', rootserver_sftp_port: 2022,
        sftp_fingerprint: 'SHA256:abc', rootserver_sftp_gewuenscht: 1, rootserver_sftp_moeglich: 1, rootserver_sftp_grund: 'Läuft auf Port 2022.' };

    await pruefe('möglich: Host, Port, Benutzer, Fingerabdruck — der Knopf nur mit Dateirecht', () => {
        const mit = zeichne(SERVER, true);
        for (const t of ['91.200.102.182', '>2022<', 'gs-00000223', 'SHA256:abc', 'noch nie angezeigt', 'id="sftpNeuKnopf"', 'nur jetzt sichtbar']) {
            assert.ok(mit.includes(t), `fehlt: ${t}`);
        }
        const ohne = zeichne(SERVER, false);
        assert.ok(ohne.includes('gs-00000223') && !ohne.includes('sftpNeuKnopf') && !ohne.includes('<script'), 'ohne Recht kein Knopf und kein Skript');
        assert.ok(zeichne({ ...SERVER, fqdn: 'rs1.firenetworks.de', fqdn_gilt: 1 }, true).includes('rs1.firenetworks.de'), 'ein geprüfter Name schlägt die IP');
        assert.ok(!zeichne({ ...SERVER, fqdn: 'falsch.example', fqdn_gilt: 0 }, true).includes('falsch.example'), 'ein ungeprüfter Name wird nicht angeboten');
    });

    await pruefe('nicht möglich: keine Zugangsdaten — ein Satz, und der Grund nur, wo SFTP gewünscht ist', () => {
        const aus = zeichne({ ...SERVER, rootserver_sftp_moeglich: 0, rootserver_sftp_grund: 'Gewünscht, aber in der daemon.yaml aus …' }, true);
        assert.ok(!aus.includes('gs-00000223') && !aus.includes('sftpNeuKnopf'));
        assert.match(aus, /gibt es auf dieser Maschine nicht — Gewünscht, aber in der daemon\.yaml aus/);
        const nie = zeichne({ ...SERVER, rootserver_sftp_gewuenscht: 0, rootserver_sftp_moeglich: 0, rootserver_sftp_grund: 'Nicht angefordert.' }, true);
        assert.match(nie, /gibt es auf dieser Maschine nicht\./);
        assert.ok(/Dateimanager hier geht trotzdem/.test(nie));
    });

    console.log('\nDatenbank (TEMPORARY-Kopie, über execute)');

    const c = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE });
    const spalten = async () => (await c.query("SHOW COLUMNS FROM rootserver LIKE 'sftp%'"))[0].map(z => z.Field).sort();
    const vorher = await spalten();
    await pruefe('die Migrationen legen Wunsch, Port, möglich und Grund an — an der Kopie; zweimal laufen schadet nicht', async () => {
        await c.query('CREATE TEMPORARY TABLE fb_rs_form LIKE rootserver');
        await c.query('CREATE TEMPORARY TABLE rootserver LIKE fb_rs_form');
        const [[k]] = await c.query('SHOW CREATE TABLE rootserver');
        assert.match(k['Create Table'], /^CREATE TEMPORARY TABLE/, 'die Kopie verdeckt den Bestand nicht — abgebrochen');
        const m = require(path.join(WURZEL, 'plugins/masterserver/migrations/20261027_160000_sftp_wunsch.js'));
        // Wie dbService in der Produktion: execute (Prepared Statements).
        const db = { query: async (sql, w = []) => (await c.execute(sql, w))[0] };
        await m.up(db);
        await m.up(db);
        const m2 = require(path.join(WURZEL, 'plugins/masterserver/migrations/20261027_180000_sftp_port_wunsch.js'));
        await m2.up(db);
        await m2.up(db);
        const neu = await spalten();
        for (const s of ['sftp_gewuenscht', 'sftp_moeglich', 'sftp_grund', 'sftp_port_wunsch']) assert.ok(neu.includes(s), `${s} fehlt`);
    });
    await c.query('DROP TEMPORARY TABLE IF EXISTS rootserver');
    await c.query('DROP TEMPORARY TABLE IF EXISTS fb_rs_form');
    await pruefe('der Bestand ist unberührt', async () => assert.deepStrictEqual(await spalten(), vorher));
    await c.end();

    console.log(fehler ? `\n✗ ${fehler} gescheitert, ${bestanden} bestanden` : `\n✓ ${bestanden} bestanden`);
    process.exit(fehler ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
